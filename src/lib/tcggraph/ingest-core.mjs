// src/lib/tcggraph/ingest-core.mjs
//
// Shared TCGGraph ingest primitives. Consumed by BOTH the CLI
// bootstrap script and the production Vercel Cron route. There
// must be exactly one implementation of upsert semantics, row
// builders, credit accounting and MTG mapping.
//
// This file must remain runtime-agnostic (no 'server-only' import)
// so the CLI can import it directly under plain Node without going
// through the Next.js compiler. Both call sites are still server-
// only in practice: reads .env.local for CLI, and Vercel Function
// runtime for cron. The API key never crosses the network boundary.
//
// If you want to add anything that logs the API key, or that runs
// under a client-side runtime, do it somewhere else.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// src/lib/tcggraph/ -> repo root is three levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..')

// ---------------------------------------------------------------------
// Env plumbing.
// ---------------------------------------------------------------------

/** CLI convenience: parse .env.local into process.env. No-op if the
 *  file does not exist (as in Vercel Production). Silent on any read
 *  error - production hosts should never rely on this. */
export function loadEnv() {
  try {
    const raw = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
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
// Game registry.
// ---------------------------------------------------------------------

/** TCGGraph slug -> internal short id (matches tcg_games.id). Never
 *  rename existing ids; downstream tables FK to them. */
export const SUPPORTED_GAMES = Object.freeze({
  'magic-the-gathering':  'mtg',
  'yugioh':               'ygo',
  'one-piece':            'onepiece',
  'disney-lorcana':       'lorcana',
  'star-wars-unlimited':  'swu',
})

/** Games the scheduled cron may automatically refresh. MTG runs every
 *  other day (larger catalogue, ~2 112 credits/run). Lorcana and One
 *  Piece run daily (cheap catalogues, <200 credits combined per day).
 *  YGO is still refreshed manually - PokePrices owns that pipeline. */
export const SCHEDULED_ALLOWLIST = Object.freeze({
  'magic-the-gathering': 'mtg',
  'one-piece':           'onepiece',
  'disney-lorcana':      'lorcana',
})

// ---------------------------------------------------------------------
// Credit safety.
// ---------------------------------------------------------------------

/** Bootstrap-time daily reserve. Bootstraps are one-shot and human-
 *  initiated, so a smaller reserve is acceptable. */
export const BOOTSTRAP_DAILY_RESERVE = 100
/** Production cron reserves. Refuses to start a job that could push us
 *  below these thresholds and refuses to keep going once we are within
 *  them. Higher than bootstrap because live pricing takes priority. */
export const PRODUCTION_DAILY_RESERVE = 500
export const PRODUCTION_MONTHLY_RESERVE = 5_000

/** Freshness thresholds (hours) for Slice 5 status output. */
export const FRESHNESS_HEALTHY_HOURS = 36
export const FRESHNESS_WARNING_HOURS = 72

// ---------------------------------------------------------------------
// TCGGraph fetch primitive.
// ---------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 120_000

export async function tcgFetch(path, query = {}) {
  const url = new URL('https://api.tcggraph.com/v1' + (path.startsWith('/') ? path : '/' + path))
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  //  Two attempts with exponential-ish backoff, gated by a 120s per-call
  //  budget. Real-world observation: intermittent 10-15s hangs on the
  //  first fetch of a session (likely DNS/TLS warm-up) then normal
  //  <500 ms responses. Retrying protects the CLI from those.
  const maxAttempts = 2
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer ' + requireEnv('TCGGRAPH_API_KEY'),
          'user-agent': 'MTGPrices-tcg/1.0',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      const body = res.status === 200 ? await res.json() : null
      return {
        status: res.status,
        body,
        cost:              Number(res.headers.get('x-credits-cost'))       || 0,
        creditsRemaining:  numberOrNull(res.headers.get('x-credits-remaining')),
        dailyRemaining:    numberOrNull(res.headers.get('x-daily-remaining')),
        dailyLimit:        numberOrNull(res.headers.get('x-daily-limit')),
        creditsLimit:      numberOrNull(res.headers.get('x-credits-limit')),
        retryAfter:        numberOrNull(res.headers.get('retry-after')),
      }
    } catch (err) {
      lastErr = err
      //  Only retry on network-level failures (abort, ECONN*). HTTP
      //  status errors do NOT throw here so they are already returned.
      if (attempt < maxAttempts) {
        await sleep(1000 * attempt)
        continue
      }
    }
  }
  throw lastErr
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function numberOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------
// Finish alias table.
// ---------------------------------------------------------------------

export const FINISH_ALIAS = Object.freeze({
  normal:         'nonfoil',
  foil:           'foil',
  etched:         'etched',
  'holofoil':     'holofoil',
  'reverse-foil': 'reverse_foil',
  '1st-edition':  '1st_edition',
  unlimited:      'unlimited',
  parallel:       'parallel',
  hyperspace:     'hyperspace',
  prestige:       'prestige',
  showcase:       'showcase',
})
export function normaliseFinish(key) { return FINISH_ALIAS[key] ?? String(key ?? '').replace(/-/g, '_') }

// ---------------------------------------------------------------------
// ID helpers.
// ---------------------------------------------------------------------

export function tcgSetId(gameId, code)                                        { return `${gameId}:set:${String(code).toLowerCase()}` }
export function tcgCardId(gameId, tcggraphCardId)                              { return `${gameId}:card:${tcggraphCardId}` }
export function tcgPrintingId(gameId, tcggraphCardId, printingKey, language)   { return `${gameId}:print:${tcggraphCardId}:${printingKey}:${language}` }

// ---------------------------------------------------------------------
// MTG deterministic mapping. See docs/network/05-mtg-mapping-report.md.
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
  const results = new Map()
  for (const { setCode, lang, cns, byCn } of Array.from(bySet.values())) {
    if (cns.size === 0) continue
    const cnArr = Array.from(cns)
    const { data, error } = await sb
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, lang')
      .eq('set_code', setCode)
      .eq('lang', lang)
      .in('collector_number', cnArr)
      .limit(cnArr.length * 3)
    if (error) throw new Error(`mtg_printings lookup failed for ${setCode}: ${error.message}`)
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

export function buildPrintingRows(gameId, card, mtgMap) {
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

export function buildMarketRows(gameId, card, runId) {
  const out = []
  const prices = Array.isArray(card.prices) ? card.prices : []
  const printKeys = Array.isArray(card.printings) && card.printings.length > 0
    ? card.printings.map((p) => p.key)
    : ['normal']
  const lang = card.language ?? 'en'
  for (const pk of printKeys) {
    const tcgId = tcgPrintingId(gameId, card.id, pk, lang)
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

/**
 * Decide the attribution mode for a card's graded quotes.
 *
 * TCGGraph's gradedPrices[] payload carries no per-printing metadata
 * whatsoever - only {grader, grade, currency, price, salesVolume,
 * updatedAt}. Verified against LOB-001/005/070/124 and against the
 * broader foil-vs-nonfoil sample (Earthbound Spirit DB1-EN249, etc.).
 * The quotes are card-level aggregates. Attaching them to any single
 * printing implies a precision the provider does not offer.
 *
 * Contract:
 *   * If the card has MORE THAN ONE physical printing AND upstream did
 *     not include an explicit per-quote printing/edition hint, mark
 *     the quotes as attribution='card'. A canonical anchor printing
 *     is chosen deterministically ('1st-edition' preferred, then
 *     'normal', then 'unlimited', then printings[0]) so the row PK
 *     stays valid, BUT read paths must never treat the anchor as
 *     provenance - they must key off tcg_card_id + attribution='card'.
 *   * If the card has exactly one printing, keep attribution='printing'
 *     (there is nothing to be ambiguous about).
 *   * If upstream ever DOES include a per-quote printing hint, honour
 *     it and keep attribution='printing'.
 *
 * This predicate MUST match the SQL rule in migrations/2026-09-22-
 * ygo-graded-ambiguity.sql. If you change one, change the other.
 *
 * Frontends must NEVER surface an attribution='card' row inside an
 * exact-printing display without a clear "edition-ambiguous" label.
 * See src/lib/tcggraph/read-model.ts for the enforced boundary.
 */
export function resolveGradedAttribution(card) {
  const prints = Array.isArray(card.printings) && card.printings.length > 0 ? card.printings : []
  const graded = Array.isArray(card.gradedPrices) ? card.gradedPrices : []
  const gradedHasPrintingHint = graded.some((g) =>
    g && (g.printingKey != null || g.printing != null || g.edition != null || g.variant != null),
  )
  const multiPrinting = prints.length > 1
  const isCardScoped = multiPrinting && !gradedHasPrintingHint
  //  Deterministic canonical anchor. For card-scoped quotes, prefer
  //  '1st-edition' since it is what collectors most often ask for.
  //  The choice is otherwise arbitrary and consumers MUST NOT rely on
  //  the specific anchor key. For printing-scoped quotes, keep
  //  printings[0] (existing behaviour) so MTG and single-printing
  //  games are unchanged.
  let anchorKey
  if (isCardScoped) {
    const byKey = new Map(prints.map((p) => [p.key, p]))
    anchorKey = byKey.has('1st-edition') ? '1st-edition'
              : byKey.has('normal')       ? 'normal'
              : byKey.has('unlimited')    ? 'unlimited'
              : prints[0]?.key ?? 'normal'
  } else {
    anchorKey = prints[0]?.key ?? 'normal'
  }
  return { attribution: isCardScoped ? 'card' : 'printing', anchorKey }
}

export function buildGradedRows(gameId, card, runId) {
  const out = []
  const graded = Array.isArray(card.gradedPrices) ? card.gradedPrices : []
  if (graded.length === 0) return out
  const lang = card.language ?? 'en'
  const { attribution, anchorKey } = resolveGradedAttribution(card)
  const tcgId = tcgPrintingId(gameId, card.id, anchorKey, lang)
  const cardId = tcgCardId(gameId, card.id)
  const volume = graded[0]?.salesVolume ?? null
  for (const g of graded) {
    if (g?.price == null) continue
    out.push({
      tcg_printing_id: tcgId,
      tcg_card_id: cardId,
      attribution,
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
// Upserts.
// ---------------------------------------------------------------------

export async function upsertChunked(sb, table, rows, primaryKey, chunkSize = 500) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0, updated: 0 }
  const onConflict = Array.isArray(primaryKey) ? primaryKey.join(',') : primaryKey
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
