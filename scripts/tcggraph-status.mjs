#!/usr/bin/env node
// scripts/tcggraph-status.mjs
// Internal summary command. Prints TCGGraph credit state + per-game
// catalogue counts + last ingest run + failure signals. Read-only.
// Never prints the API key.

import { loadEnv, requireEnv, getSupabase, tcgFetch } from './lib/tcggraph-ingest.mjs'
loadEnv()

async function main() {
  const sb = getSupabase()
  // Credit probe: cheapest endpoint is /games (1 credit).
  const probe = await tcgFetch('/games')
  const line = (...s) => console.log(s.join(' '))

  line('\nTCGGRAPH STATUS')
  line('===============')
  line('Plan:                Starter (25,000 credits/month, 2,500/day) - inferred from x-credits-limit')
  line(`Monthly used:        ${(probe.creditsLimit ?? 0) - (probe.creditsRemaining ?? 0)} / ${probe.creditsLimit ?? '?'}`)
  line(`Monthly remaining:   ${probe.creditsRemaining ?? '?'}`)
  line(`Daily remaining:     ${probe.dailyRemaining ?? '?'} / ${probe.dailyLimit ?? '?'}`)

  const games = ['mtg', 'ygo', 'onepiece', 'swu']
  for (const gid of games) {
    line('')
    line(`GAME: ${gid}`)
    line('-'.repeat(gid.length + 7))
    const [cards, printings, mapped, market, graded, run] = await Promise.all([
      sb.from('tcg_cards').select('*', { count: 'exact', head: true }).eq('game_id', gid),
      sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', gid),
      sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', gid).not('mtg_printings_id', 'is', null),
      sb.from('tcg_market_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', gid),
      sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', gid),
      sb.from('tcg_ingest_runs').select('id, resource, status, started_at, finished_at, pages_completed, rows_fetched, credits_used, daily_credits_remaining, notes').eq('game_id', gid).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    line(`cards:               ${cards.count ?? 0}`)
    line(`printings:           ${printings.count ?? 0}`)
    if (gid === 'mtg') line(`  with mtg_printings_id: ${mapped.count ?? 0}`)
    line(`market rows:         ${market.count ?? 0}`)
    line(`graded rows:         ${graded.count ?? 0}`)
    if (run.data) {
      const r = run.data
      line(`last ingest run:     ${r.resource}  status=${r.status}  pages=${r.pages_completed}  fetched=${r.rows_fetched}  credits=${r.credits_used}`)
      line(`  started:           ${r.started_at}`)
      line(`  finished:          ${r.finished_at ?? '(still running)'}`)
      if (r.notes?.mapping_counts) line(`  mapping counts:    ${JSON.stringify(r.notes.mapping_counts)}`)
      if (r.notes?.stop_reason) line(`  stop reason:       ${r.notes.stop_reason}`)
    } else {
      line(`last ingest run:     (none)`)
    }
  }

  // Failures overview.
  line('')
  line('FAILURES / SIGNALS')
  line('==================')
  const { data: amb } = await sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('mapping_confidence', 'ambiguous')
  const { data: unm } = await sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('mapping_confidence', 'unmapped')
  const { data: hi }  = await sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('mapping_confidence', 'high_confidence')
  line(`printings with mapping_confidence=ambiguous:      ${amb ?? 0}`)
  line(`printings with mapping_confidence=high_confidence:${hi ?? 0}`)
  line(`printings with mapping_confidence=unmapped:       ${unm ?? 0}`)
  const { data: staleRuns } = await sb
    .from('tcg_ingest_runs')
    .select('id, game_id, resource, started_at, status')
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 4 * 3600 * 1000).toISOString())
  if (staleRuns && staleRuns.length) {
    line(`stale 'running' runs (>4h old):`)
    for (const r of staleRuns) line(`  ${r.game_id}.${r.resource}  since ${r.started_at}`)
  } else {
    line(`stale runs:                                       0`)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
