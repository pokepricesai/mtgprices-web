#!/usr/bin/env node
// scripts/tcggraph-slice1-phase2.mjs
//
// Second-pass proof. Uses the discoveries from phase 1:
//   * base = https://api.tcggraph.com/v1
//   * auth = Bearer, real header names are x-credits-*
//   * /cards, /sets, /games are real; /printings, /prices are NOT
//   * cards ship with inline printings[], prices[], gradedPrices[],
//     externalIds{cardmarketId, tcgplayerId}
//
// This phase runs the substantive proofs:
//   D. MTG mapping via DB cross-check on (lower(set_code),
//      collector_number, language). Also cross-check
//      cardmarketId / tcgplayerId presence.
//   E. Find real graded quotes by paging deep into MTG for
//      priceStatus.graded='priced' AND gradedPrices with a real grader
//      (PSA/BGS/CGC/SGC).
//   F. Sample market-price shape on a card known to be well-covered.
//   G. Real credit counts per endpoint pattern.
//   H. Probe more bulk-endpoint paths.
//
// Never prints the API key. Writes only to .tmp/. Small credit budget.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_DIR = join(REPO_ROOT, '.tmp', 'tcggraph-slice1')
mkdirSync(OUT_DIR, { recursive: true })

function loadEnv() {
  const raw = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
loadEnv()

const KEY = process.env.TCGGRAPH_API_KEY
const BASE = (process.env.TCGGRAPH_API_BASE ?? 'https://api.tcggraph.com/v1').replace(/\/$/, '')
if (!KEY) { console.error('missing TCGGRAPH_API_KEY'); process.exit(1) }

const HARD_CREDIT_BUDGET  = 400
const HARD_REQUEST_BUDGET = 120
let creditsUsed = 0
let requestsMade = 0
const requestLog = []

async function call(path, { query = null, method = 'GET', saveAs = null, ifNoneMatch = null } = {}) {
  if (creditsUsed >= HARD_CREDIT_BUDGET) throw new Error('credit budget exhausted')
  if (requestsMade >= HARD_REQUEST_BUDGET) throw new Error('request budget exhausted')
  const url = new URL(BASE + (path.startsWith('/') ? path : '/' + path))
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  requestsMade += 1
  const t0 = Date.now()
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${KEY}`,
      'user-agent': 'MTGPrices-slice1-phase2/0.1',
      ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}),
    },
  })
  const ms = Date.now() - t0
  const cost = Number(res.headers.get('x-credits-cost'))
  if (Number.isFinite(cost)) creditsUsed += cost
  const rec = {
    path: url.pathname + url.search,
    status: res.status,
    ms,
    cost: Number.isFinite(cost) ? cost : null,
    creditsRemaining: Number(res.headers.get('x-credits-remaining')) || null,
    dailyRemaining:   Number(res.headers.get('x-daily-remaining'))   || null,
    etag:            res.headers.get('etag'),
  }
  requestLog.push(rec)
  const body = res.status === 200 ? await res.json().catch(() => null) : null
  if (saveAs) {
    if (body != null) writeFileSync(join(OUT_DIR, `${saveAs}.body.json`), JSON.stringify(body, null, 2))
    writeFileSync(join(OUT_DIR, `${saveAs}.meta.json`), JSON.stringify({
      record: rec,
      headers: Object.fromEntries([...res.headers.entries()]),
    }, null, 2))
  }
  return { status: res.status, body, record: rec }
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return createClient(url, key, { global: { fetch: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(30000) }) } })
}

// =====================================================================
// D. MTG mapping proof via DB cross-check.
// =====================================================================
async function mtgMappingProof() {
  console.log('\n[phase2] === D. MTG deterministic mapping proof ===')
  // Pull TCGGraph MTG cards varied by set era. Take 50 evenly-spaced
  // pages from the 35,281 pages, but respect budget - do 5 pages.
  const sampled = []
  for (const page of [1, 500, 1500, 5000, 15000, 30000]) {
    if (creditsUsed > HARD_CREDIT_BUDGET * 0.35) break
    try {
      const r = await call('/cards', { query: { game: 'magic-the-gathering', page, limit: 20 }, saveAs: `D_mtg_page_${page}` })
      if (r.status === 200 && r.body?.data) sampled.push(...r.body.data)
    } catch (e) { console.log(`  page ${page} error:`, e.message) }
  }
  console.log(`  TCGGraph MTG sample size: ${sampled.length}`)
  // Filter to en cards to keep the check meaningful.
  const en = sampled.filter((c) => c.language === 'en')
  console.log(`  EN cards: ${en.length}`)

  const s = supa()
  const results = { exact: 0, high_confidence: 0, ambiguous: 0, unmapped: 0, tested: 0, cases: [] }
  for (const c of en.slice(0, 100)) {
    const setCode = String(c.set?.code || '').toLowerCase()
    const cn = String(c.collectorNumber || '')
    if (!setCode || !cn) { results.unmapped += 1; results.cases.push({ id: c.id, name: c.name, why: 'missing_set_or_cn' }); continue }
    const { data, error } = await s
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, lang')
      .eq('set_code', setCode)
      .eq('collector_number', cn)
      .eq('lang', 'en')
      .limit(5)
    results.tested += 1
    if (error) { results.unmapped += 1; results.cases.push({ id: c.id, name: c.name, why: 'db_error', err: error.message }); continue }
    const rows = data ?? []
    if (rows.length === 0) {
      results.unmapped += 1
      results.cases.push({ id: c.id, name: c.name, set: setCode, cn, why: 'no_db_row' })
    } else if (rows.length === 1) {
      // Name normalisation for confirmation. Both sides should agree.
      const nameA = String(c.name).replace(/[’']/g, "'").toLowerCase()
      const nameB = String(rows[0].name).replace(/[’']/g, "'").toLowerCase()
      if (nameA === nameB) results.exact += 1
      else { results.high_confidence += 1; results.cases.push({ id: c.id, tcggraph_name: c.name, db_name: rows[0].name, why: 'name_mismatch_but_key_unique' }) }
    } else {
      results.ambiguous += 1
      results.cases.push({ id: c.id, name: c.name, set: setCode, cn, why: 'multiple_db_rows', matched: rows.length })
    }
  }
  writeFileSync(join(OUT_DIR, 'D_mtg_mapping_result.json'), JSON.stringify(results, null, 2))
  console.log(`  RESULT: exact=${results.exact}  hi=${results.high_confidence}  amb=${results.ambiguous}  unmap=${results.unmapped}  tested=${results.tested}`)
  return results
}

// =====================================================================
// E. Graded price probe. Scan pages until we find real PSA/BGS/CGC quotes.
// =====================================================================
async function gradedProbe() {
  console.log('\n[phase2] === E. Graded prices discovery ===')
  const gradedByGame = {}
  for (const game of ['magic-the-gathering', 'yugioh', 'one-piece', 'star-wars-unlimited']) {
    if (creditsUsed > HARD_CREDIT_BUDGET * 0.7) break
    const found = []
    for (const page of [1, 100, 500, 1000]) {
      if (creditsUsed > HARD_CREDIT_BUDGET * 0.8) break
      const r = await call('/cards', { query: { game, page, limit: 50 }, saveAs: `E_${slug(game)}_p${page}` })
      if (r.status !== 200 || !r.body?.data) continue
      for (const c of r.body.data) {
        if (c.priceStatus?.graded === 'priced' && Array.isArray(c.gradedPrices)) {
          const nonRaw = c.gradedPrices.filter((g) => g.grader && String(g.grader).toLowerCase() !== 'raw')
          if (nonRaw.length) {
            found.push({ id: c.id, name: c.name, set: c.set?.code, cn: c.collectorNumber, gradedPrices: c.gradedPrices })
            if (found.length >= 8) break
          }
        }
      }
      if (found.length >= 8) break
    }
    gradedByGame[game] = found
    console.log(`  ${game}: found ${found.length} cards with non-raw graded quotes`)
  }
  writeFileSync(join(OUT_DIR, 'E_graded_by_game.json'), JSON.stringify(gradedByGame, null, 2))
  return gradedByGame
}

// =====================================================================
// F. Market price shape survey. Sample one well-covered MTG card
//    fully (single-card endpoint if any) so we can document every
//    market-price field in the spec.
// =====================================================================
async function marketShape() {
  console.log('\n[phase2] === F. Market price shape survey ===')
  // Try single-card retrieval by id.
  const r = await call('/cards/mtg_84f2c8f5-8e1', { saveAs: 'F_single_card_probe' })
  console.log(`  /cards/{id} -> ${r.status}`)
  return r
}

// =====================================================================
// H. Bulk export path probes.
// =====================================================================
async function bulkProbes() {
  console.log('\n[phase2] === H. Bulk export path probes ===')
  const paths = ['/exports/list', '/downloads', '/data-exports', '/catalog/export', '/bulk-catalogs', '/data/download', '/exports/catalog']
  for (const p of paths) {
    try {
      const r = await call(p, { saveAs: `H_probe_${slug(p)}` })
      console.log(`  ${p} -> ${r.status}${r.record.cost ? ' cost=' + r.record.cost : ''}`)
    } catch (e) { console.log(`  ${p} error: ${e.message}`) }
  }
}

// =====================================================================
async function main() {
  const results = { runId: new Date().toISOString().replace(/[:.]/g, '-') }
  results.mapping = await mtgMappingProof()
  results.graded = await gradedProbe()
  const market = await marketShape()
  results.marketProbe = market ? { status: market.status } : null
  await bulkProbes()
  results.totals = { credits: creditsUsed, requests: requestsMade }
  results.requestLog = requestLog
  writeFileSync(join(OUT_DIR, `_phase2_summary_${results.runId}.json`), JSON.stringify(results, null, 2))
  console.log(`\n[phase2] DONE. credits=${creditsUsed}/${HARD_CREDIT_BUDGET}  requests=${requestsMade}/${HARD_REQUEST_BUDGET}`)
}

function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') }

main().catch((err) => { console.error('[phase2] FATAL:', err.message); process.exit(2) })
