#!/usr/bin/env node
// scripts/backfill-set-value-daily.mjs
//
// One-off administrative backfill for mtg_set_value_daily. Runs
// per-date SQL through `supabase db query` (direct DB connection),
// which avoids PostgREST's short statement_timeout that keeps
// killing this workload when called via .rpc().
//
// Idempotent: uses ON CONFLICT DO UPDATE inside the SQL.
// Resumable: skips dates that already have >= EXPECTED_ROWS rows
//   for the basis unless --force.
// Bounded concurrency: default 3, tunable via --concurrency.
// Retries failed dates once.
//
// Usage:
//   node scripts/backfill-set-value-daily.mjs --days 90
//   node scripts/backfill-set-value-daily.mjs --from 2026-06-15 --to 2026-09-20 --concurrency 3
//   node scripts/backfill-set-value-daily.mjs --days 90 --force

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const EXPECTED_ROWS_MIN = 800   // a complete date should have >=800 sets

function loadEnv() {
  try {
    const raw = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  } catch {}
}
loadEnv()

function argFlag(name, def) {
  const i = process.argv.findIndex((a) => a === `--${name}`)
  if (i < 0) return def
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return true
  return v
}
function argBool(name) { return process.argv.includes(`--${name}`) }

function daysAgoIso(days) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10)
}

function upsertSqlForDate(iso, provider = 'tcgplayer', currency = 'USD', market = 'paper', priceType = 'retail') {
  return `
INSERT INTO public.mtg_set_value_daily (
  set_code, observed_on, provider, currency, market, price_type,
  eligible_count, priced_count, basket_value, refreshed_at
)
WITH day_obs AS (
  SELECT o.printing_finish_id, MIN(o.price) AS price
  FROM public.mtg_price_observations o
  WHERE o.observed_on = '${iso}'::date
    AND o.provider   = '${provider}'
    AND o.currency   = '${currency}'
    AND o.market     = '${market}'
    AND o.price_type = '${priceType}'
    AND o.price > 0
    AND (o.is_anomalous IS NULL OR o.is_anomalous = false)
  GROUP BY o.printing_finish_id
),
basket AS (
  SELECT cf.set_code, cf.printing_id, d.price
  FROM public.mtg_canonical_finish cf
  JOIN day_obs d ON d.printing_finish_id = cf.finish_id
),
per_set AS (
  SELECT set_code, COUNT(*)::int AS eligible_count FROM public.mtg_canonical_finish GROUP BY set_code
),
agg AS (
  SELECT
    e.set_code,
    e.eligible_count,
    COALESCE(COUNT(b.printing_id), 0)::int      AS priced_count,
    COALESCE(ROUND(SUM(b.price)::numeric, 2), 0) AS basket_value
  FROM per_set e
  LEFT JOIN basket b USING (set_code)
  GROUP BY e.set_code, e.eligible_count
)
SELECT
  set_code, '${iso}'::date, '${provider}', '${currency}', '${market}', '${priceType}',
  eligible_count, priced_count, basket_value, now()
FROM agg
ON CONFLICT (set_code, observed_on, provider, currency, market, price_type)
DO UPDATE SET
  eligible_count = EXCLUDED.eligible_count,
  priced_count   = EXCLUDED.priced_count,
  basket_value   = EXCLUDED.basket_value,
  refreshed_at   = now();
`
}

function runSupabaseCli(sqlFile) {
  return new Promise((resolve) => {
    const proc = spawn('supabase', ['db', 'query', '--linked', '--file', sqlFile], {
      shell: true,
      env: { ...process.env },
    })
    let stdout = '', stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function processDate(observedOn, workerId) {
  const tmpDir = join(tmpdir(), 'mtg-backfill'); try { mkdirSync(tmpDir, { recursive: true }) } catch {}
  const path = join(tmpDir, `upsert-${observedOn}.sql`)
  writeFileSync(path, upsertSqlForDate(observedOn))
  const t = Date.now()
  const res = await runSupabaseCli(path)
  const ms = Date.now() - t
  try { unlinkSync(path) } catch {}
  const combined = (res.stdout + '\n' + res.stderr)
  const ok = res.code === 0 && !combined.includes('"_tag":"Error"') && !combined.includes('ERROR:')
  return { ok, ms, error: ok ? null : combined.slice(-300) }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { fetch: (u, opts) => fetch(u, { ...opts, signal: AbortSignal.timeout(30_000) }) },
  })

  // Args
  let from, to
  const daysArg = argFlag('days')
  const fromArg = argFlag('from')
  const toArg   = argFlag('to')
  if (fromArg && toArg) { from = String(fromArg); to = String(toArg) }
  else if (daysArg) {
    const n = Number(daysArg)
    if (!Number.isFinite(n) || n <= 0) throw new Error('--days must be a positive number')
    to = todayIso(); from = daysAgoIso(n - 1)
  } else { to = todayIso(); from = daysAgoIso(89) }
  const force = argBool('force')
  const concurrency = Math.max(1, Number(argFlag('concurrency', 3)))

  const dates = []
  for (let d = from; d <= to; d = nextDay(d)) dates.push(d)
  console.log(`[backfill] range ${from} .. ${to}  (${dates.length} dates)  concurrency=${concurrency}  force=${force}`)

  // Pre-fetch existing row counts to skip complete dates.
  const existing = await fetchExistingRowCounts(supabase, from, to)
  console.log(`[backfill] daily table currently has ${existing.size} dates in range`)

  const queue = [...dates]
  const stats = { requested: dates.length, skipped: 0, succeeded: 0, failed: [], perDateMs: [] }

  async function worker(id) {
    while (queue.length) {
      const observedOn = queue.shift()
      if (!observedOn) return
      if (!force && (existing.get(observedOn) ?? 0) >= EXPECTED_ROWS_MIN) {
        stats.skipped += 1
        console.log(`[${id}] SKIP ${observedOn} (${existing.get(observedOn)} rows)`)
        continue
      }
      const r = await processDate(observedOn, id)
      if (r.ok) {
        stats.succeeded += 1
        stats.perDateMs.push(r.ms)
        console.log(`[${id}] OK   ${observedOn} in ${r.ms}ms`)
      } else {
        stats.failed.push(observedOn)
        console.log(`[${id}] FAIL ${observedOn} in ${r.ms}ms  ${r.error?.slice(0, 200)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)))

  // Retry pass.
  if (stats.failed.length) {
    console.log(`[backfill] retrying ${stats.failed.length} dates...`)
    const retryQ = [...stats.failed]; stats.failed = []
    async function retryWorker(id) {
      while (retryQ.length) {
        const observedOn = retryQ.shift(); if (!observedOn) return
        const r = await processDate(observedOn, `retry-${id}`)
        if (r.ok) { stats.succeeded += 1; stats.perDateMs.push(r.ms); console.log(`[retry-${id}] OK ${observedOn} in ${r.ms}ms`) }
        else     { stats.failed.push(observedOn); console.log(`[retry-${id}] FAIL ${observedOn}`) }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.floor(concurrency / 2)) }, (_, i) => retryWorker(i)))
  }

  // Reconciliation report.
  const after = await fetchExistingRowCounts(supabase, from, to)
  const missing = dates.filter((d) => !after.has(d))
  const avgMs = stats.perDateMs.length ? Math.round(stats.perDateMs.reduce((a, b) => a + b, 0) / stats.perDateMs.length) : 0
  console.log('\n[backfill] === RECONCILIATION ===')
  console.log(`  requested dates:       ${stats.requested}`)
  console.log(`  succeeded (upserted):  ${stats.succeeded}`)
  console.log(`  skipped (had data):    ${stats.skipped}`)
  console.log(`  failed (after retry):  ${stats.failed.length}${stats.failed.length ? ' -> ' + stats.failed.join(', ') : ''}`)
  console.log(`  average per-date time: ${avgMs} ms`)
  console.log(`  daily table now covers: ${after.size} of ${dates.length} requested dates`)
  if (missing.length) console.log(`  missing dates: ${missing.join(', ')}`)
  process.exitCode = missing.length ? 1 : 0
}

async function fetchExistingRowCounts(supabase, from, to) {
  const { data, error } = await supabase.rpc('mtg_set_value_daily_row_counts', {
    p_from: from, p_to: to,
    p_provider: 'tcgplayer', p_currency: 'USD', p_market: 'paper', p_price_type: 'retail',
  })
  if (error) {
    console.warn('[backfill] row-count RPC error:', error.message)
    return new Map()
  }
  const m = new Map()
  for (const row of (data ?? [])) m.set(row.observed_on, Number(row.n))
  return m
}

main().catch((err) => { console.error(err); process.exit(2) })
