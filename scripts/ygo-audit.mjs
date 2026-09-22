#!/usr/bin/env node
// scripts/ygo-audit.mjs
//
// Read-only. Quantifies:
//  * total YGO cards, cards with >1 printing, sets/years
//  * graded-row distribution across '1st-edition' vs 'normal' vs other keys
//  * high-value affected cards
//  * baseline latency for name-search variants (blue eye / blue-eyes / etc.)
//
// Writes to .tmp/ygo-integrity/audit.json

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadEnv, requireEnv, getSupabase } from '../src/lib/tcggraph/ingest-core.mjs'

loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_DIR = join(REPO_ROOT, '.tmp', 'ygo-integrity')
mkdirSync(OUT_DIR, { recursive: true })

const sb = getSupabase()
const out = {}

// ---- 1. Card & printing totals ----------------------------------------
const { count: totalCards } = await sb.from('tcg_cards').select('*', { count: 'exact', head: true }).eq('game_id', 'ygo')
out.totalYgoCards = totalCards

// Cards with >1 printing: page tcg_printings + tally
const printCountByCard = new Map()
for (let offset = 0, page = 0; ; offset += 1000, page++) {
  const { data, error } = await sb
    .from('tcg_printings')
    .select('tcggraph_card_id, tcggraph_printing_key, finish, edition')
    .eq('game_id', 'ygo')
    .range(offset, offset + 999)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) break
  for (const r of data) {
    const arr = printCountByCard.get(r.tcggraph_card_id) ?? []
    arr.push(r)
    printCountByCard.set(r.tcggraph_card_id, arr)
  }
  if (data.length < 1000) break
}
out.totalPrintings = Array.from(printCountByCard.values()).reduce((n, arr) => n + arr.length, 0)
const cardsWithMultiplePrintings = Array.from(printCountByCard.entries()).filter(([, arr]) => arr.length > 1)
out.cardsWithMultiplePrintings = cardsWithMultiplePrintings.length

// Cards with both 1st-edition and (normal|unlimited)
const cardsWithFirstAndBase = cardsWithMultiplePrintings.filter(([, arr]) => {
  const keys = new Set(arr.map((r) => r.tcggraph_printing_key))
  return keys.has('1st-edition') && (keys.has('normal') || keys.has('unlimited'))
})
out.cardsWithFirstAndBase = cardsWithFirstAndBase.length

// Print key histogram
const keyHist = new Map()
for (const [, arr] of Array.from(printCountByCard.entries())) {
  for (const r of arr) keyHist.set(r.tcggraph_printing_key, (keyHist.get(r.tcggraph_printing_key) || 0) + 1)
}
out.printingKeyHistogram = Object.fromEntries(Array.from(keyHist.entries()).sort((a, b) => b[1] - a[1]))

// ---- 2. Graded distribution ------------------------------------------
// Page tcg_graded_prices_current and split by tcggraph_printing_key (via join).
// Instead of a real join, we group graded rows by tcg_printing_id and then
// look up their printing_key via printCountByCard-derived index.
const keyByPrintId = new Map()
for (const [tcggraphCardId, arr] of Array.from(printCountByCard.entries())) {
  for (const r of arr) {
    const pid = `ygo:print:${tcggraphCardId}:${r.tcggraph_printing_key}:en`
    keyByPrintId.set(pid, r.tcggraph_printing_key)
  }
}
const gradedByKey = new Map()
let totalGradedRows = 0
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb
    .from('tcg_graded_prices_current')
    .select('tcg_printing_id, grader, grade, price, currency')
    .eq('game_id', 'ygo')
    .range(offset, offset + 999)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) break
  for (const r of data) {
    totalGradedRows++
    const k = keyByPrintId.get(r.tcg_printing_id) ?? '__unknown_pid__'
    const bucket = gradedByKey.get(k) ?? { rows: 0, slabRows: 0, rawRows: 0, cards: new Set() }
    bucket.rows += 1
    if (String(r.grader).toLowerCase() === 'raw') bucket.rawRows += 1
    else bucket.slabRows += 1
    bucket.cards.add(r.tcg_printing_id.replace(/:en$/, '').replace(/^ygo:print:/, '').split(':')[0])
    gradedByKey.set(k, bucket)
  }
  if (data.length < 1000) break
}
out.totalGradedRows = totalGradedRows
out.gradedRowsByPrintingKey = Object.fromEntries(
  Array.from(gradedByKey.entries()).map(([k, v]) => [k, { rows: v.rows, slabRows: v.slabRows, rawRows: v.rawRows, distinctCards: v.cards.size }])
)

// Cards where a 1st-edition printing exists AND all graded rows land on non-1st-ed printing
const affectedCards = []
for (const [tid, arr] of cardsWithFirstAndBase) {
  const firstEdPid = `ygo:print:${tid}:1st-edition:en`
  const basePid = arr.find((r) => r.tcggraph_printing_key === 'normal') ? `ygo:print:${tid}:normal:en` : `ygo:print:${tid}:unlimited:en`
  affectedCards.push({ tcggraph_card_id: tid, firstEdPid, basePid })
}
out.candidateAmbiguousCards = affectedCards.length

// ---- 3. Set/era breakdown -------------------------------------------
// Fetch sets to know released_at.
const { data: sets } = await sb.from('tcg_sets').select('id, code, name, released_at').eq('game_id', 'ygo')
const setById = new Map((sets ?? []).map((s) => [s.id, s]))

// For each candidate card, find its set via tcg_cards. Do this in chunks.
const affectedByYear = new Map()
const affectedSetIds = new Set()
const affectedCardIds = Array.from(cardsWithFirstAndBase.map(([tid]) => `ygo:card:${tid}`))
for (let i = 0; i < affectedCardIds.length; i += 500) {
  const slice = affectedCardIds.slice(i, i + 500)
  const { data } = await sb.from('tcg_cards').select('id, set_id, name, tcggraph_card_id').in('id', slice)
  for (const c of data ?? []) {
    affectedSetIds.add(c.set_id)
    const yr = setById.get(c.set_id)?.released_at?.slice(0, 4) ?? 'unknown'
    affectedByYear.set(yr, (affectedByYear.get(yr) || 0) + 1)
  }
}
out.affectedSetCount = affectedSetIds.size
out.affectedByYear = Object.fromEntries(Array.from(affectedByYear.entries()).sort())

// Total unique YGO sets
const { count: setCount } = await sb.from('tcg_sets').select('*', { count: 'exact', head: true }).eq('game_id', 'ygo')
out.totalYgoSets = setCount

// ---- 4. High-value affected examples --------------------------------
// Top 20 highest-price graded rows currently on candidate ambiguous cards.
if (affectedCards.length > 0) {
  const wrongPids = affectedCards.map((c) => c.basePid).concat(affectedCards.map((c) => c.firstEdPid))
  // Chunk .in() to keep URLs short
  const rows = []
  for (let i = 0; i < wrongPids.length; i += 200) {
    const slice = wrongPids.slice(i, i + 200)
    const { data } = await sb
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id, grader, grade, price, currency')
      .in('tcg_printing_id', slice)
    for (const r of data ?? []) rows.push(r)
  }
  rows.sort((a, b) => b.price - a.price)
  const seen = new Set()
  const topCards = []
  for (const r of rows) {
    const cardKey = r.tcg_printing_id.split(':')[2]
    if (seen.has(cardKey)) continue
    seen.add(cardKey)
    topCards.push({ tcggraph_card_id: cardKey, grader: r.grader, grade: r.grade, price: r.price, currency: r.currency, printing_id: r.tcg_printing_id })
    if (topCards.length >= 15) break
  }
  // Hydrate names
  const { data: names } = await sb.from('tcg_cards')
    .select('tcggraph_card_id, name, collector_number, set_id')
    .in('tcggraph_card_id', topCards.map((t) => t.tcggraph_card_id))
  const nameByTid = new Map((names ?? []).map((n) => [n.tcggraph_card_id, n]))
  out.top15AmbiguousHighValue = topCards.map((t) => ({
    ...t,
    name: nameByTid.get(t.tcggraph_card_id)?.name ?? null,
    setId: nameByTid.get(t.tcggraph_card_id)?.set_id ?? null,
    collectorNumber: nameByTid.get(t.tcggraph_card_id)?.collector_number ?? null,
  }))
}

// ---- 5. Baseline search timings -------------------------------------
async function timeQuery(fn) {
  const t0 = Date.now()
  const r = await fn()
  return { ms: Date.now() - t0, count: (r.data ?? []).length, error: r.error?.message ?? null }
}
const searchTerms = ['blue eye', 'blue-eyes', 'dark magician', 'sky striker', 'white dragon']
const searchTimings = []
for (const term of searchTerms) {
  // 5 samples each, keep min/median/max
  const runs = []
  for (let i = 0; i < 5; i++) {
    const t = await timeQuery(() => sb.from('tcg_cards')
      .select('id, name, set_id, collector_number')
      .eq('game_id', 'ygo').ilike('name', `%${term}%`).limit(50))
    runs.push(t.ms)
  }
  runs.sort((a, b) => a - b)
  searchTimings.push({ term, min: runs[0], median: runs[2], max: runs[4], samples: runs })
}
out.baselineSearchTimings = searchTimings

// ---- 6. Verify other games are separate ------------------------------
const gameCounts = {}
for (const g of ['mtg', 'ygo', 'onepiece', 'lorcana', 'swu']) {
  const { count } = await sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', g)
  gameCounts[g] = count
}
out.gradedRowsByGame = gameCounts

writeFileSync(join(OUT_DIR, 'audit.json'), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
