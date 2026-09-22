#!/usr/bin/env node
// scripts/ygo-search-benchmark.mjs
//
// Repeats the exact same search queries the pre-index baseline used
// (5 samples per term, min/median/max). Same shape:
//   sb.from('tcg_cards').select('id, name, set_id, collector_number')
//     .eq('game_id','ygo').ilike('name', `%${term}%`).limit(50)
//
// Prints a before/after table.

import { loadEnv, requireEnv, getSupabase } from '../src/lib/tcggraph/ingest-core.mjs'
loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const sb = getSupabase()

const BASELINE = [
  { term: 'blue eye',      min: 109, median: 111, max: 119 },
  { term: 'blue-eyes',     min: 64,  median: 67,  max: 70  },
  { term: 'dark magician', min: 63,  median: 65,  max: 89  },
  { term: 'sky striker',   min: 62,  median: 64,  max: 64  },
  { term: 'white dragon',  min: 71,  median: 75,  max: 86  },
]

async function timeOne(term) {
  const t0 = Date.now()
  await sb.from('tcg_cards')
    .select('id, name, set_id, collector_number')
    .eq('game_id', 'ygo').ilike('name', `%${term}%`).limit(50)
  return Date.now() - t0
}

const results = []
for (const b of BASELINE) {
  //  1 warmup + 5 sampled runs (same as baseline).
  await timeOne(b.term)
  const samples = []
  for (let i = 0; i < 5; i++) samples.push(await timeOne(b.term))
  samples.sort((a, b) => a - b)
  results.push({
    term: b.term,
    before: b,
    after: { min: samples[0], median: samples[2], max: samples[4], samples },
  })
}

console.log('\nYGO name-search: before (baseline pre-trgm) vs after (post-trgm)')
console.log('term'.padEnd(16), 'before min/med/max'.padEnd(22), 'after min/med/max'.padEnd(22), 'delta (median)')
for (const r of results) {
  const before = `${r.before.min}/${r.before.median}/${r.before.max} ms`
  const after  = `${r.after.min}/${r.after.median}/${r.after.max} ms`
  const delta  = `${r.after.median - r.before.median >= 0 ? '+' : ''}${r.after.median - r.before.median} ms`
  console.log(r.term.padEnd(16), before.padEnd(22), after.padEnd(22), delta)
}

console.log('\nRaw samples per term:')
for (const r of results) console.log(`  ${r.term.padEnd(16)} ${JSON.stringify(r.after.samples)}`)
