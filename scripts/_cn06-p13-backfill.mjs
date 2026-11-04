#!/usr/bin/env node
// scripts/_cn06-p13-backfill.mjs
//
// CN-06.01-P13 historical backfill — fills missing mtg_set_value_daily
// aggregates for dates where mtg_price_observations is complete but
// the daily aggregate was never written. Uses the existing RPC
// mtg_set_value_daily_upsert; no migrations, no new infrastructure.
//
// Bounded + idempotent:
//   * Explicit date list (no inference). Operator must pass --dates.
//   * Per-date pre-check: skip the date if mtg_set_value_daily already
//     has >= EXPECTED_SET_ROWS rows for the basis (957 as of audit).
//   * Each RPC call wraps ON CONFLICT DO UPDATE so re-running is safe.
//   * Serial execution with a per-call timeout log. No concurrency.
//   * --dry-run flag runs all checks and prints the plan without the
//     RPC call.
//
// Usage:
//   node scripts/_cn06-p13-backfill.mjs --dates 2026-11-02,2026-11-03 --dry-run
//   node scripts/_cn06-p13-backfill.mjs --dates 2026-11-02,2026-11-03
//
// No cron schedule change. No vercel.json change. No DB migration.
// Safe to run standalone with service-role credentials; does not
// touch the scheduled handler's regression guard.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const BASIS = { provider: 'tcgplayer', currency: 'USD', market: 'paper', priceType: 'retail' }
const OBS_SANITY_MIN = 10_000       // match the handler's secondary gate
const EXPECTED_SET_ROWS = 950       // audit showed 957 per complete day; 950 is a conservative floor
const RPC_TIMEOUT_MS = 90_000

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

function arg(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`)
  if (i < 0) return null
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return true
  return v
}
function bool(name) { return process.argv.includes(`--${name}`) }

const datesArg = arg('dates')
if (!datesArg || typeof datesArg !== 'string') {
  console.error('ERROR: --dates is required (comma-separated YYYY-MM-DD).')
  console.error('Example: node scripts/_cn06-p13-backfill.mjs --dates 2026-11-02,2026-11-03 --dry-run')
  process.exit(2)
}
const dates = datesArg.split(',').map((d) => d.trim()).filter(Boolean)
for (const d of dates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    console.error(`ERROR: invalid date "${d}"`)
    process.exit(2)
  }
}
const dryRun = bool('dry-run')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(2)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

console.log('CN-06.01-P13 historical backfill')
console.log('  dates:  ', dates.join(', '))
console.log('  dry run:', dryRun)
console.log('  basis:  ', BASIS)
console.log('')

let plannedCalls = 0, skipped = 0, failed = 0, ok = 0
const totalStart = Date.now()
for (const date of dates) {
  console.log(`--- ${date} ---`)

  // Pre-check 1: upstream observations exist with sufficient volume.
  const { count: obsCount, error: obsErr } = await sb
    .from('mtg_price_observations')
    .select('*', { count: 'exact', head: true })
    .eq('observed_on', date)
    .eq('provider', BASIS.provider).eq('currency', BASIS.currency)
    .eq('market', BASIS.market).eq('price_type', BASIS.priceType)
  if (obsErr) { console.error(`  FAIL obs-count error: ${obsErr.message}`); failed++; continue }
  console.log(`  observations for ${date}: ${obsCount}`)
  if ((obsCount ?? 0) < OBS_SANITY_MIN) {
    console.error(`  SKIP ${date}: observations=${obsCount} < OBS_SANITY_MIN=${OBS_SANITY_MIN} — refusing to backfill incomplete upstream data`)
    skipped++
    continue
  }

  // Pre-check 2: destination already complete?
  const { count: svdCount, error: svdErr } = await sb
    .from('mtg_set_value_daily')
    .select('*', { count: 'exact', head: true })
    .eq('observed_on', date)
    .eq('provider', BASIS.provider).eq('currency', BASIS.currency)
    .eq('market', BASIS.market).eq('price_type', BASIS.priceType)
  if (svdErr) { console.error(`  FAIL svd-count error: ${svdErr.message}`); failed++; continue }
  console.log(`  mtg_set_value_daily rows for ${date}: ${svdCount}`)
  if ((svdCount ?? 0) >= EXPECTED_SET_ROWS) {
    console.log(`  SKIP ${date}: already backfilled (${svdCount} >= ${EXPECTED_SET_ROWS})`)
    skipped++
    continue
  }

  plannedCalls++
  if (dryRun) {
    console.log(`  DRY-RUN: would call mtg_set_value_daily_upsert(observed_on=${date}, basis=${BASIS.provider}/${BASIS.currency}/${BASIS.market}/${BASIS.priceType})`)
    continue
  }

  // Execute the RPC.
  const t0 = Date.now()
  const { data, error } = await sb.rpc('mtg_set_value_daily_upsert', {
    p_observed_on: date,
    p_provider: BASIS.provider,
    p_currency: BASIS.currency,
    p_market: BASIS.market,
    p_price_type: BASIS.priceType,
  })
  const ms = Date.now() - t0
  if (error) {
    console.error(`  FAIL rpc error (${ms}ms): ${error.message}`)
    failed++
    continue
  }
  console.log(`  OK rpc returned ${data} rows in ${ms}ms`)
  ok++
}

const totalMs = Date.now() - totalStart
console.log('')
console.log(`=== Summary (${totalMs}ms) ===`)
console.log(`  planned RPC calls: ${plannedCalls}`)
console.log(`  skipped:           ${skipped}`)
console.log(`  succeeded:         ${ok}`)
console.log(`  failed:            ${failed}`)
if (dryRun) console.log(`  (dry-run: no DB writes performed)`)
process.exit(failed > 0 ? 1 : 0)
