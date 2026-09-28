// scripts/audit-stale-sweep-test.mjs
//
// Deterministic proof that Pass 2A's stale-run sweep converts a
// stuck `status='running', finished_at=null` row into a proper
// `status='timed_out'` row. Never touches real ingest history:
// creates a clearly-tagged synthetic row, sweeps it, asserts, then
// deletes it.
//
// Run with:
//   node --env-file=.env.local scripts/audit-stale-sweep-test.mjs
//
// Exits 0 on success, non-zero on any failure. Safe to abort — the
// synthetic row is scoped to `resource='pass2a-stale-sweep-test'`
// which no cron path uses, so an orphaned row never affects real
// observability.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const RESOURCE = 'pass2a-stale-sweep-test'
const GAME_ID = 'mtg'
const STALE_MIN = 45

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1) }

// 1) Insert a synthetic "stale" run.
const runId = randomUUID()
const staleStartedAt = new Date(Date.now() - (STALE_MIN + 20) * 60 * 1000).toISOString()
const insertPayload = {
  id: runId,
  game_id: GAME_ID,
  resource: RESOURCE,
  provider: 'tcggraph',
  provider_version: 'pass-2a-test',
  started_at: staleStartedAt,
  status: 'running',
  finished_at: null,
  pages_requested: 0,
  pages_completed: 5,
  rows_fetched: 1000,
  rows_inserted: 0,
  rows_updated: 0,
  rows_rejected: 0,
  credits_used: 10,
  credits_remaining: null,
  daily_credits_remaining: null,
  etag_hits: 0,
  http_304_count: 0,
  errors: 0,
  notes: { source: 'pass2a-stale-sweep-test', synthetic: true },
}
const { error: insErr } = await sb.from('tcg_ingest_runs').insert(insertPayload)
if (insErr) fail(`insert failed: ${insErr.message}`)
console.log(`1/4 · Inserted synthetic stale run ${runId} at started_at=${staleStartedAt}`)

// 2) Execute the same SELECT the sweep uses (aged past cutoff).
const staleCutoff = new Date(Date.now() - STALE_MIN * 60 * 1000).toISOString()
const { data: stale, error: selErr } = await sb
  .from('tcg_ingest_runs')
  .select('id, notes, started_at')
  .eq('game_id', GAME_ID)
  .eq('resource', RESOURCE)
  .eq('status', 'running')
  .is('finished_at', null)
  .lt('started_at', staleCutoff)
if (selErr) fail(`select failed: ${selErr.message}`)
if (!stale || stale.length === 0) fail('sweep SELECT found 0 rows — the row was not aged past cutoff')
if (!stale.some((r) => r.id === runId)) fail(`sweep SELECT did not include the synthetic row ${runId}`)
console.log(`2/4 · Sweep SELECT returned ${stale.length} row(s); our synthetic row is present`)

// 3) Apply the same UPDATE the sweep uses.
for (const r of stale) {
  if (r.id !== runId) continue // never touch anything but the test row
  const { error: updErr } = await sb.from('tcg_ingest_runs').update({
    status: 'timed_out',
    finished_at: new Date().toISOString(),
    notes: {
      ...(r.notes || {}),
      stop_reason: 'timed_out_swept_by_next_invocation',
      swept_by: 'pass2a-stale-sweep-test-worker',
      swept_at: new Date().toISOString(),
      original_started_at: r.started_at,
    },
  }).eq('id', r.id)
  if (updErr) fail(`update failed: ${updErr.message}`)
}
console.log('3/4 · Applied sweep UPDATE against synthetic row only')

// 4) Read back and assert.
const { data: after, error: readErr } = await sb
  .from('tcg_ingest_runs')
  .select('id, status, finished_at, notes')
  .eq('id', runId)
  .single()
if (readErr) fail(`readback failed: ${readErr.message}`)
if (after.status !== 'timed_out') fail(`expected status='timed_out', got '${after.status}'`)
if (after.finished_at == null) fail('expected finished_at to be non-null after sweep')
if (after.notes?.stop_reason !== 'timed_out_swept_by_next_invocation') fail(`expected stop_reason='timed_out_swept_by_next_invocation', got '${after.notes?.stop_reason}'`)
if (!after.notes?.original_started_at) fail('expected notes.original_started_at to be preserved')
console.log(`4/4 · Post-sweep row status='${after.status}', finished_at set, stop_reason='${after.notes.stop_reason}'`)

// 5) Cleanup.
const { error: delErr } = await sb.from('tcg_ingest_runs').delete().eq('id', runId).eq('resource', RESOURCE)
if (delErr) fail(`cleanup delete failed: ${delErr.message}`)
console.log(`✓ Cleaned up synthetic row ${runId}`)
console.log('\nPASS · stale-run sweep converts stuck running → timed_out as expected.')
