#!/usr/bin/env node
// scripts/tcggraph-history-probe.mjs
//
// Slice 4 Phase K live historical-API probe. Reads the current sample
// of TCGGraph card ids we already have in tcg_cards for MTG, YGO, One
// Piece, and (once bootstrapped) Lorcana, and tries every plausible
// historical endpoint variant against ONE high-value card per game.
// Records HTTP status, credit cost, response shape, observation
// count and date range. Never writes to Supabase.
//
// Endpoint hypotheses (in order):
//   1. GET /cards/{id}/history                (Pokemon-provider style)
//   2. GET /cards/{id}/prices/history         (mtggo/scryfall style)
//   3. GET /prices/history?card=<id>
//   4. GET /history/prices?card=<id>&game=X
//   5. GET /cards/{id}?include=history
//   6. GET /cards/{id}?fields=priceHistory
//   7. GET /history?card=<id>
//
// For each attempt we log: HTTP status, x-credits-cost, response
// keys, observation count if the payload looks time-seriesish, and
// the first/last observation date. We stop probing an endpoint after
// its first 200; different variants are tried across the four cards
// so we don't waste all credits on one URL family.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadEnv, getSupabase, tcgFetch } from './lib/tcggraph-ingest.mjs'

loadEnv()

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_DIR = join(REPO_ROOT, '.tmp', 'history-probe')
mkdirSync(OUT_DIR, { recursive: true })

const HYPOTHESES = [
  { name: 'a-history',           path: (id) => `/cards/${id}/history` },
  { name: 'b-prices-history',    path: (id) => `/cards/${id}/prices/history` },
  { name: 'c-prices-query',      path: (id) => `/prices/history`,       query: (id) => ({ card: id }) },
  { name: 'd-history-prices',    path: (id) => `/history/prices`,       query: (id) => ({ card: id }) },
  { name: 'e-include-history',   path: (id) => `/cards/${id}`,          query: () => ({ include: 'history' }) },
  { name: 'f-fields-history',    path: (id) => `/cards/${id}`,          query: () => ({ fields: 'priceHistory' }) },
  { name: 'g-history-query',     path: (id) => `/history`,              query: (id) => ({ card: id }) },
  { name: 'h-cards-history-q',   path: () => `/cards/history`,          query: (id) => ({ card: id }) },
  { name: 'i-timeseries',        path: () => `/prices/timeseries`,      query: (id) => ({ card: id }) },
]

async function pickHighValueCard(sb, gameId) {
  // Pick the printing with the highest current market price for a
  // realistic "chase card" test. Fall back to any card.
  const { data: hi } = await sb.from('tcg_market_prices_current')
    .select('tcg_printing_id, price')
    .eq('game_id', gameId)
    .order('price', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (hi?.tcg_printing_id) {
    const { data: pr } = await sb.from('tcg_printings')
      .select('tcggraph_card_id, tcggraph_printing_key, collector_number')
      .eq('id', hi.tcg_printing_id)
      .maybeSingle()
    if (pr) return { tcggraph_card_id: pr.tcggraph_card_id, marketPrice: hi.price, cn: pr.collector_number }
  }
  const { data: any } = await sb.from('tcg_cards').select('tcggraph_card_id').eq('game_id', gameId).limit(1).maybeSingle()
  if (any) return { tcggraph_card_id: any.tcggraph_card_id }
  return null
}

function summariseResponse(status, cost, body) {
  if (status === 200 && body && typeof body === 'object') {
    const keys = Object.keys(body)
    const data = Array.isArray(body?.data) ? body.data : Array.isArray(body?.observations) ? body.observations : Array.isArray(body?.history) ? body.history : Array.isArray(body) ? body : null
    if (data) {
      const firstDate = data[0]?.observedAt ?? data[0]?.date ?? data[0]?.timestamp ?? null
      const lastDate  = data[data.length - 1]?.observedAt ?? data[data.length - 1]?.date ?? data[data.length - 1]?.timestamp ?? null
      return { keys, observation_count: data.length, firstDate, lastDate, sample: data[0] ?? null }
    }
    return { keys, note: 'no array-of-observations found', top_level_sample: JSON.stringify(body).slice(0, 400) }
  }
  return { status, cost, snippet: body ? JSON.stringify(body).slice(0, 200) : '(no body)' }
}

async function main() {
  const sb = getSupabase()
  const games = ['mtg', 'ygo', 'onepiece', 'lorcana']
  console.log('[history-probe] picking one high-value card per game...')
  const targets = {}
  for (const gid of games) {
    const c = await pickHighValueCard(sb, gid)
    if (!c) console.log(`  ${gid}: (no cards - skipping)`); else console.log(`  ${gid}: card=${c.tcggraph_card_id}  market=${c.marketPrice ?? '?'}`)
    if (c) targets[gid] = c
  }
  if (Object.keys(targets).length === 0) { console.log('no games with data; abort'); process.exit(2) }

  const findings = []
  let credits = 0
  for (const [gid, card] of Object.entries(targets)) {
    console.log(`\n[history-probe] game=${gid} card=${card.tcggraph_card_id}`)
    for (const h of HYPOTHESES) {
      const path  = h.path(card.tcggraph_card_id)
      const query = h.query ? h.query(card.tcggraph_card_id) : {}
      const r = await tcgFetch(path, query)
      credits += r.cost
      const summary = summariseResponse(r.status, r.cost, r.body)
      console.log(`  ${h.name}  ${r.status}  cost=${r.cost}  daily_remaining=${r.dailyRemaining}  ${r.status === 200 ? 'OK' : ''}`)
      findings.push({ game: gid, card: card.tcggraph_card_id, hypothesis: h.name, path, query, status: r.status, cost: r.cost, summary })
      // Dump full body when 200 for inspection.
      if (r.status === 200) writeFileSync(join(OUT_DIR, `${gid}-${h.name}.json`), JSON.stringify({ path, query, body: r.body }, null, 2))
      // Stop iterating this game if we've had a 200 or if we're bleeding credits.
      if (r.dailyRemaining != null && r.dailyRemaining < 200) { console.log('  (stopping - below daily reserve 200)'); break }
    }
  }

  writeFileSync(join(OUT_DIR, 'findings.json'), JSON.stringify(findings, null, 2))
  console.log(`\n[history-probe] done. total credits ~${credits}. findings: ${OUT_DIR}/findings.json`)
  const winners = findings.filter((f) => f.status === 200)
  console.log(`  200 responses: ${winners.length}`)
  for (const w of winners) {
    console.log(`    ${w.game}  ${w.path}   observations=${w.summary?.observation_count ?? '?'}   firstDate=${w.summary?.firstDate ?? '?'}   lastDate=${w.summary?.lastDate ?? '?'}`)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
