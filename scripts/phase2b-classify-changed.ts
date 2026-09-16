// scripts/phase2b-classify-changed.ts
//
// Incremental capability classifier — the permanent freshness path.
// Only touches rows that need re-classifying:
//
//   --empty-only          (default) rows whose `capabilities` array is
//                         still the default '{}'. Ideal for classifying
//                         cards freshly ingested by Stage 1D.
//   --since=YYYY-MM-DD    rows updated on/after that date. Use after a
//                         Scryfall Oracle re-print or a taxonomy change.
//   --oracle-id=UUID      one specific oracle_card row. Useful for
//                         debugging a single mis-classification.
//   --all                 same as the initial backfill script — every
//                         row. Rarely needed.
//
// Imports the same classifier the app uses
// (src/lib/mtg/capabilities.ts) so there is no synchronisation risk.
//
// FUTURE HOOK (documented, not wired here):
//
//   After Stage 1D writes new/updated Oracle rows, invoke:
//     npx tsx scripts/phase2b-classify-changed.ts --empty-only
//   or
//     npx tsx scripts/phase2b-classify-changed.ts --since=<run-start>
//
//   No Stage 1D edits happen in this pass — Stage 1D wiring is a
//   separate, later-approved change.
//
// Usage:
//   npx tsx scripts/phase2b-classify-changed.ts
//   npx tsx scripts/phase2b-classify-changed.ts --since=2026-09-16
//   npx tsx scripts/phase2b-classify-changed.ts --oracle-id=<uuid>
//   npx tsx scripts/phase2b-classify-changed.ts --all

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { classify, type CardCapability } from '../src/lib/mtg/capabilities'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}

const args = process.argv.slice(2)
const arg = (k: string) => {
  const hit = args.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return undefined
  if (hit === `--${k}`) return ''
  return hit.split('=').slice(1).join('=')
}
const emptyOnly = arg('empty-only') !== undefined || (arg('since') === undefined && arg('oracle-id') === undefined && arg('all') === undefined)
const since = arg('since') || null
const oracleId = arg('oracle-id') || null
const all = arg('all') !== undefined

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type Row = {
  id: string
  type_line: string | null
  oracle_text: string | null
  keywords: string[] | null
  card_faces: unknown
  produced_mana: string[] | null
}

async function main() {
console.log(`Incremental classifier`)
if (all)         console.log('  mode: --all  (every oracle row)')
else if (oracleId) console.log(`  mode: --oracle-id=${oracleId}`)
else if (since)  console.log(`  mode: --since=${since}`)
else             console.log('  mode: --empty-only (default)')
console.log()

const t0 = performance.now()
const PAGE = 1000
let offset = 0
let total = 0
let empty = 0
const capCounts = new Map<CardCapability, number>()

while (true) {
  let q = s.from('mtg_oracle_cards')
    .select('id, type_line, oracle_text, keywords, card_faces, produced_mana')
    .order('id', { ascending: true })
    .range(offset, offset + PAGE - 1)

  if (oracleId)      q = q.eq('id', oracleId)
  else if (since)    q = q.gte('updated_at', since)
  else if (!all)     q = q.or('capabilities.is.null,capabilities.eq.{}')  // --empty-only

  const { data, error } = await q
  if (error) { console.error('fetch error:', error); process.exit(1) }
  if (!data || data.length === 0) break

  const payload = (data as Row[]).map((row) => {
    const caps = classify({
      type_line: row.type_line,
      oracle_text: row.oracle_text,
      keywords: row.keywords,
      produced_mana: row.produced_mana,
      card_faces: row.card_faces,
    })
    if (caps.length === 0) empty++
    for (const c of caps) capCounts.set(c, (capCounts.get(c) ?? 0) + 1)
    return { id: row.id, capabilities: caps }
  })

  const { data: updated, error: rpcErr } = await s.rpc('mtg_bulk_update_capabilities', { payload })
  if (rpcErr) { console.error('rpc error:', rpcErr); process.exit(1) }
  total += data.length
  offset += PAGE
  console.log(`  batch ${offset / PAGE}: +${updated} rows  (${Math.round(performance.now() - t0)}ms elapsed)`)
  if (data.length < PAGE) break
  if (oracleId) break  // single-row path
}

console.log(`\nDone in ${Math.round((performance.now() - t0) / 1000)}s.`)
console.log(`Rows re-classified: ${total.toLocaleString()}  (empty=${empty.toLocaleString()})`)
if (capCounts.size > 0) {
  console.log('\nCapabilities set in this run:')
  for (const [k, v] of Array.from(capCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${v.toLocaleString()}`)
  }
}
process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
