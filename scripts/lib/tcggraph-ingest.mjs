// scripts/lib/tcggraph-ingest.mjs
// Node-side ingest helpers used by scripts/tcggraph-bootstrap.mjs.
// Not part of the app runtime; never imported by src/. Server-only
// credentials (TCGGRAPH_API_KEY, SUPABASE_SERVICE_ROLE_KEY) are read
// from .env.local and NEVER logged.
//
// Everything here operates on the schema defined in
// migrations/2026-09-21-tcg-shared-schema.sql.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

export function loadEnv() {
  try {
    const raw = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  } catch {}
}

export function requireEnv(name) {
  const v = (process.env[name] ?? '').trim()
  if (!v) throw new Error(`missing env: ${name}`)
  return v
}

export function getSupabase() {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    global: { fetch: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(60_000) }) },
    auth: { persistSession: false },
  })
}

// ---------------------------------------------------------------------
// TCGGraph fetch primitive.
// ---------------------------------------------------------------------
export async function tcgFetch(path, query = {}) {
  const url = new URL('https://api.tcggraph.com/v1' + (path.startsWith('/') ? path : '/' + path))
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + requireEnv('TCGGRAPH_API_KEY'),
      'user-agent': 'MTGPrices-slice2-bootstrap/0.1',
    },
  })
  const body = res.status === 200 ? await res.json() : null
  return {
    status: res.status,
    body,
    cost:              Number(res.headers.get('x-credits-cost'))       || 0,
    creditsRemaining:  Number(res.headers.get('x-credits-remaining'))  || null,
    dailyRemaining:    Number(res.headers.get('x-daily-remaining'))    || null,
    dailyLimit:        Number(res.headers.get('x-daily-limit'))        || null,
    creditsLimit:      Number(res.headers.get('x-credits-limit'))      || null,
    retryAfter:        Number(res.headers.get('retry-after'))          || null,
  }
}

// ---------------------------------------------------------------------
// Finish alias table. TCGGraph 'printings[].key' -> our normalised
// finish name. Matches docs/network/05-mtg-mapping-report.md.
// ---------------------------------------------------------------------
export const FINISH_ALIAS = {
  normal:        'nonfoil',
  foil:          'foil',
  etched:        'etched',
  'holofoil':    'holofoil',
  'reverse-foil':'reverse_foil',
  '1st-edition': '1st_edition',
  unlimited:     'unlimited',
  parallel:      'parallel',
  hyperspace:    'hyperspace',
  prestige:      'prestige',
  showcase:      'showcase',
}
export function normaliseFinish(key) { return FINISH_ALIAS[key] ?? String(key ?? '').replace(/-/g, '_') }

// ---------------------------------------------------------------------
// ID helpers.
// ---------------------------------------------------------------------
export function tcgSetId(gameId, code)              { return `${gameId}:set:${String(code).toLowerCase()}` }
export function tcgCardId(gameId, tcggraphCardId)    { return `${gameId}:card:${tcggraphCardId}` }
export function tcgPrintingId(gameId, tcggraphCardId, printingKey, language) {
  return `${gameId}:print:${tcggraphCardId}:${printingKey}:${language}`
}

// ---------------------------------------------------------------------
// MTG deterministic mapping. From docs/network/05-mtg-mapping-report.md:
//   (LOWER(TCGGraph.set.code), TCGGraph.collectorNumber, TCGGraph.language)
// -> mtg_printings.(set_code, collector_number, lang)
// Returns { row, confidence } where confidence in
// 'exact'|'high_confidence'|'ambiguous'|'unmapped'.
//
// Batched for efficiency (one query per set_code + all collector numbers
// in the current page).
// ---------------------------------------------------------------------
export async function batchMapMtgCards(sb, cards) {
  const bySet = new Map()
  for (const c of cards) {
    if (c.game !== 'magic-the-gathering') continue
    const setCode = String(c.set?.code || '').toLowerCase()
    const cn = String(c.collectorNumber || '')
    const lang = String(c.language || 'en')
    if (!setCode || !cn) continue
    const key = `${setCode}|${lang}`
    if (!bySet.has(key)) bySet.set(key, { setCode, lang, cns: new Set(), byCn: new Map() })
    bySet.get(key).cns.add(cn)
    bySet.get(key).byCn.set(cn, c)
  }
  const results = new Map()   // tcggraph card.id -> {mtg_row, confidence}
  for (const { setCode, lang, cns, byCn } of Array.from(bySet.values())) {
    if (cns.size === 0) continue
    const cnArr = Array.from(cns)
    const { data, error } = await sb
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, lang')
      .eq('set_code', setCode)
      .eq('lang', lang)
      .in('collector_number', cnArr)
      .limit(cnArr.length * 3)   // margin for duplicate rows
    if (error) throw new Error(`mtg_printings lookup failed for ${setCode}: ${error.message}`)
    // Bucket DB rows by collector_number to detect ambiguity.
    const dbByCn = new Map()
    for (const row of data ?? []) {
      const k = row.collector_number
      if (!dbByCn.has(k)) dbByCn.set(k, [])
      dbByCn.get(k).push(row)
    }
    for (const cn of cnArr) {
      const c = byCn.get(cn)
      const rows = dbByCn.get(cn) ?? []
      if (rows.length === 0) { results.set(c.id, { mtg: null, confidence: 'unmapped' }); continue }
      if (rows.length > 1)   { results.set(c.id, { mtg: null, confidence: 'ambiguous', candidates: rows.length }); continue }
      const row = rows[0]
      const nameA = String(c.name || '').replace(/[’']/g, "'").toLowerCase()
      const nameB = String(row.name || '').replace(/[’']/g, "'").toLowerCase()
      const conf = nameA === nameB ? 'exact' : 'high_confidence'
      results.set(c.id, { mtg: row, confidence: conf })
    }
  }
  return results
}

// ---------------------------------------------------------------------
// Row builders.
// ---------------------------------------------------------------------
export function buildSetRow(gameId, setBlock) {
  if (!setBlock?.code) return null
  const code = String(setBlock.code).toLowerCase()
  const releasedAt = setBlock.releasedAt && /^\d{4}-\d{2}-\d{2}/.test(setBlock.releasedAt) ? setBlock.releasedAt : null
  return {
    id: tcgSetId(gameId, code),
    game_id: gameId,
    code,
    name: String(setBlock.name ?? code),
    released_at: releasedAt,
    tcggraph_meta: {},
    updated_at: new Date().toISOString(),
  }
}

export function buildCardRow(gameId, card) {
  return {
    id: tcgCardId(gameId, card.id),
    game_id: gameId,
    tcggraph_card_id: card.id,
    name: card.name,
    english_id: card.englishId ?? null,
    language: card.language ?? 'en',
    rarity: card.rarity ?? null,
    artist: card.artist ?? null,
    rules_text: card.text ?? null,
    images: card.images ?? {},
    gamedata: card.gameData ?? {},
    set_id: card.set?.code ? tcgSetId(gameId, card.set.code) : null,
    collector_number: card.collectorNumber ?? null,
    updated_at: new Date().toISOString(),
  }
}

/** Every printings[] variant becomes a tcg_printings row.
 *  For MTG rows carry mtg_printings_id when the mapping resolved.
 */
export function buildPrintingRows(gameId, card, mtgMap /* Map<tcggraph_card_id, {mtg, confidence}> */) {
  const rows = []
  const prints = Array.isArray(card.printings) && card.printings.length > 0
    ? card.printings
    : [{ key: 'normal', label: 'Normal', kind: 'surface', externalIds: card.externalIds ?? {}, prices: card.prices ?? [] }]
  const lang = card.language ?? 'en'
  const mtgMatch = mtgMap ? mtgMap.get(card.id) : null
  for (const p of prints) {
    const printingKey = String(p.key ?? 'normal')
    const setCode = String(card.set?.code || '').toLowerCase() || null
    const setId = setCode ? tcgSetId(gameId, setCode) : null
    rows.push({
      id: tcgPrintingId(gameId, card.id, printingKey, lang),
      game_id: gameId,
      tcg_card_id: tcgCardId(gameId, card.id),
      set_id: setId,
      tcggraph_card_id: card.id,
      tcggraph_printing_key: printingKey,
      finish: p.kind === 'surface' ? normaliseFinish(printingKey) : null,
      edition: p.kind === 'edition' ? normaliseFinish(printingKey) : null,
      language: lang,
      collector_number: card.collectorNumber ?? null,
      mtg_printings_id: gameId === 'mtg' && mtgMatch?.mtg ? mtgMatch.mtg.id : null,
      cardmarket_id: (p.externalIds?.cardmarketId ?? card.externalIds?.cardmarketId) || null,
      tcgplayer_id:  (p.externalIds?.tcgplayerId  ?? card.externalIds?.tcgplayerId)  || null,
      mapping_confidence: gameId === 'mtg' ? (mtgMatch?.confidence ?? 'unmapped') : 'exact',
      updated_at: new Date().toISOString(),
    })
  }
  return rows
}

/** Extract market rows from a card into tcg_market_prices_current shape. */
export function buildMarketRows(gameId, card, runId) {
  const out = []
  const prices = Array.isArray(card.prices) ? card.prices : []
  const printKeys = Array.isArray(card.printings) && card.printings.length > 0
    ? card.printings.map((p) => p.key)
    : ['normal']
  const lang = card.language ?? 'en'
  for (const pk of printKeys) {
    const tcgId = tcgPrintingId(gameId, card.id, pk, lang)
    // Each price entry maps to a printing key via price.finish.
    for (const pr of prices) {
      const finishKey = String(pr.finish ?? 'normal')
      if (finishKey !== pk) continue
      const source = pr.source ? `tcggraph.${pr.source}` : 'tcggraph.unknown'
      const listType = pr.listType ?? 'retail'
      const currency = pr.currency ?? 'USD'
      out.push({
        tcg_printing_id: tcgId,
        game_id: gameId,
        source,
        list_type: listType,
        region: pr.region ?? null,
        currency,
        finish: normaliseFinish(finishKey),
        price:       toNum(pr.market),
        price_low:   toNum(pr.low),
        price_trend: toNum(pr.trend),
        avg_1d:      toNum(pr.avg1),
        avg_7d:      toNum(pr.avg7),
        avg_30d:     toNum(pr.avg30),
        updated_at:  pr.updatedAt ?? null,
        source_run_id: runId,
      })
    }
  }
  return out
}

/** Extract graded rows. */
export function buildGradedRows(gameId, card, runId) {
  const out = []
  const graded = Array.isArray(card.gradedPrices) ? card.gradedPrices : []
  if (graded.length === 0) return out
  // Graded prices are per-CARD, not per-printing-key in the current
  // TCGGraph response shape. Attach them to the 'normal' (or first)
  // printing so the FK resolves; document this in the schema notes.
  const lang = card.language ?? 'en'
  const primaryPk = (card.printings?.[0]?.key) ?? 'normal'
  const tcgId = tcgPrintingId(gameId, card.id, primaryPk, lang)
  const volume = graded[0]?.salesVolume ?? null
  for (const g of graded) {
    if (g?.price == null) continue
    out.push({
      tcg_printing_id: tcgId,
      game_id: gameId,
      grader: String(g.grader),
      grade:  String(g.grade),
      currency: g.currency ?? 'USD',
      price: toNum(g.price),
      card_sales_volume: g.salesVolume ?? volume,
      updated_at: g.updatedAt ?? null,
      source_run_id: runId,
    })
  }
  return out
}

function toNum(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------
// External IDs bookkeeping.
// ---------------------------------------------------------------------
export function buildExternalIdRows(gameId, card, mtgMap) {
  const rows = []
  const cardTcgId = tcgCardId(gameId, card.id)
  rows.push({
    scope: 'card', source: 'tcggraph', external_id: card.id,
    ref_table: 'tcg_cards', ref_id: cardTcgId, game_id: gameId, confidence: 'exact',
  })
  const cm = card.externalIds?.cardmarketId
  if (cm) rows.push({ scope: 'card', source: 'cardmarket', external_id: String(cm), ref_table: 'tcg_cards', ref_id: cardTcgId, game_id: gameId, confidence: 'exact' })
  const tp = card.externalIds?.tcgplayerId
  if (tp) rows.push({ scope: 'card', source: 'tcgplayer', external_id: String(tp), ref_table: 'tcg_cards', ref_id: cardTcgId, game_id: gameId, confidence: 'exact' })
  if (gameId === 'mtg') {
    const m = mtgMap?.get(card.id)
    if (m?.mtg?.id) {
      rows.push({
        scope: 'printing', source: 'mtg-printing', external_id: m.mtg.id,
        ref_table: 'tcg_printings',
        ref_id: tcgPrintingId(gameId, card.id, (card.printings?.[0]?.key ?? 'normal'), card.language ?? 'en'),
        game_id: gameId,
        confidence: m.confidence,
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------
// Upserts (chunked - Postgrest recommends <=500 rows per call).
// ---------------------------------------------------------------------
export async function upsertChunked(sb, table, rows, primaryKey /* string | string[] */, chunkSize = 500) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, updated: 0 }
  const onConflict = Array.isArray(primaryKey) ? primaryKey.join(',') : primaryKey
  // Postgres refuses "ON CONFLICT DO UPDATE affecting the same row
  // twice in one batch". Dedupe within THIS call by the conflict-key
  // tuple; last row wins.
  const keyCols = onConflict.split(',').map((s) => s.trim())
  const dedup = new Map()
  for (const r of rows) {
    const k = keyCols.map((c) => r[c] ?? '__null__').join('|')
    dedup.set(k, r)
  }
  const clean = Array.from(dedup.values())
  let done = 0
  for (let i = 0; i < clean.length; i += chunkSize) {
    const slice = clean.slice(i, i + chunkSize)
    const { error } = await sb.from(table).upsert(slice, { onConflict, ignoreDuplicates: false })
    if (error) throw new Error(`upsert ${table} error at rows ${i}-${i + slice.length - 1}: ${error.message}`)
    done += slice.length
  }
  return { inserted: done, updated: 0 }
}
