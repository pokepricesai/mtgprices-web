#!/usr/bin/env node
// Read-only: check tcg_ingest_runs for prior YGO bootstrap credit cost
// and TCGGraph current daily/monthly headers.
import { loadEnv, requireEnv, getSupabase, tcgFetch } from '../src/lib/tcggraph/ingest-core.mjs'
loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY'); requireEnv('TCGGRAPH_API_KEY')
const sb = getSupabase()

const { data: runs } = await sb.from('tcg_ingest_runs')
  .select('id, started_at, finished_at, status, pages_completed, rows_fetched, credits_used, credits_remaining, daily_credits_remaining, notes')
  .eq('game_id', 'ygo').order('started_at', { ascending: false }).limit(10)

console.log('Recent YGO ingest_runs:')
for (const r of runs ?? []) {
  console.log(`  ${r.started_at} | ${r.status} | pages=${r.pages_completed} | rows=${r.rows_fetched} | credits_used=${r.credits_used} | source=${r.notes?.source} | stop=${r.notes?.stop_reason ?? '-'}`)
}

const successes = (runs ?? []).filter((r) => r.status === 'success')
if (successes.length) {
  const s = successes[0]
  console.log(`\nMost recent SUCCESS credits_used: ${s.credits_used}  pages: ${s.pages_completed}`)
}

const pre = await tcgFetch('/games')
console.log(`\nLive TCGGraph headers: status=${pre.status} cost=${pre.cost} dailyRemaining=${pre.dailyRemaining} monthlyRemaining=${pre.creditsRemaining}`)
