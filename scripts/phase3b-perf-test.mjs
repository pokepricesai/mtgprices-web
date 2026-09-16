// scripts/phase3b-perf-test.mjs
// Compare the old two-query pattern vs the new RPC single round-trip
// against a warm connection. We report N runs and drop outliers.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}
const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const RUNS = 5
async function timed(fn) {
  const t = performance.now()
  await fn()
  return performance.now() - t
}
function median(arr) { const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)] }
async function bench(label, fn) {
  const timings = []
  for (let i = 0; i < RUNS; i++) timings.push(await timed(fn))
  console.log(`  ${label.padEnd(60)} p50 ${median(timings).toFixed(0)}ms  runs=[${timings.map(t=>t.toFixed(0)).join(', ')}]`)
}

console.log('=== Phase 3B search perf ===\n')

// A. Old two-query pattern (find candidates then filter by legality).
await bench('OLD  cap=card-draw + color=U + mv<=3 (2 queries + join)', async () => {
  const { data: oracles } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .contains('capabilities', ['card-draw'])
    .overlaps('colors', ['U'])
    .lte('mana_value', 3)
    .limit(400)
  const ids = (oracles ?? []).map(o => o.id)
  if (ids.length === 0) return
  await s.from('mtg_oracle_legalities')
    .select('oracle_card_id')
    .in('oracle_card_id', ids)
    .eq('format', 'commander')
    .eq('legality', 'legal')
})

// B. New RPC — one round-trip.
await bench('NEW  same query via mtg_search_oracle_cards RPC', async () => {
  await s.rpc('mtg_search_oracle_cards', {
    p_capabilities: ['card-draw'],
    p_colors: ['U'],
    p_mv_max: 3,
    p_legal_in: 'commander',
    p_limit: 60,
  })
})

// C. Multi-cap AND (creature-removal + instant).
await bench('OLD  cap=creature-removal + cap=instant (2 queries)', async () => {
  const { data: oracles } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .contains('capabilities', ['creature-removal', 'instant'])
    .limit(400)
  const ids = (oracles ?? []).map(o => o.id)
  if (ids.length === 0) return
  await s.from('mtg_oracle_legalities').select('oracle_card_id').in('oracle_card_id', ids).eq('format', 'modern').eq('legality', 'legal')
})
await bench('NEW  creature-removal + instant + modern via RPC', async () => {
  await s.rpc('mtg_search_oracle_cards', {
    p_capabilities: ['creature-removal', 'instant'],
    p_legal_in: 'modern',
    p_limit: 60,
  })
})

// D. Exclude-list check.
await bench('NEW  card-draw + commander + exclude 12 oracles', async () => {
  const { data: some } = await s.from('mtg_oracle_cards').select('id').limit(12)
  const exclude = (some ?? []).map(r => r.id)
  await s.rpc('mtg_search_oracle_cards', {
    p_capabilities: ['card-draw'],
    p_legal_in: 'commander',
    p_exclude_oracles: exclude,
    p_limit: 60,
  })
})

console.log('\n=== done ===')
process.exit(0)
