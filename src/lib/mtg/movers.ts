// src/lib/mtg/movers.ts
// Server-only helper. Computes top mover cards from
// mtg_price_observations against the seeded MTGJSON historical series.
//
// The previous implementation asked the DB for the OLDEST 8000 rows in
// the window (`.order('observed_on', ascending: true).limit(8000)`), so
// on any busy DB the query would run out of budget before it saw recent
// observations. That returned zero mover results and the homepage
// misleadingly said "waiting for three days of comparable data".
//
// This version:
//   1) picks candidate printings from mtg_current_prices (bounded, cheap,
//      indexed by observed_on desc) so we know upfront which finish IDs
//      are worth inspecting.
//   2) reads observations for exactly those finish IDs, chunked, so we
//      never blow the row budget.
//   3) computes earliest and latest observation per finish inside the
//      requested window and returns deltas.
//
// Basis is locked (paper / USD / retail / tcgplayer) so all deltas are
// like for like. `is_anomalous` filters allow NULL to include historical
// rows that were not tagged during backfill.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildCardHref } from './slug'

const PROVIDER = 'tcgplayer'
const CURRENCY = 'USD'
const MARKET = 'paper'
const PRICE_TYPE = 'retail'

// How many high-value candidates to inspect. Kept high enough that the
// top ranked movers won't miss any high-price cards, but low enough that
// the second-pass IN() queries stay cheap.
const CANDIDATE_LIMIT = 1200

// Chunk size for the observation IN() query. PostgREST + supabase-js
// slow down or truncate very large IN() lists.
const IN_CHUNK = 120

// Reject noise below this current headline price. Movers on penny cards
// swamp the ranking without meaning much.
const MIN_PRICE_USD = 2

// Reject tiny absolute movement so the "biggest riser" isn't a $2 card
// that shifted by a cent.
const MIN_ABS_DELTA_USD = 0.25

// Require at least a ~half-window span between the two datapoints we
// compare, so a rise/fall is real trend rather than a one-off tick.
function minSpanDays(windowDays: number): number {
  if (windowDays <= 7) return 3
  if (windowDays <= 30) return 10
  return 21
}

export type MoverWindow = 7 | 30 | 90

export type MoverCard = {
  finish_id: string
  printing_id: string
  oracle_card_id: string
  name: string
  set_code: string
  set_name: string
  collector_number: string | null
  image_uri_small: string | null
  finish: string
  card_href: string
  start_price: number
  latest_price: number
  abs_delta: number
  pct_delta: number
  currency: 'USD'
  provider: string
  period_days: number
}

export type MarketMovers = {
  risers: MoverCard[]
  fallers: MoverCard[]
  active: MoverCard[]
  mostValuable: MoverCard[]
  windowDays: MoverWindow
  currency: 'USD'
  provider: string
  market: 'paper'
  priceType: 'retail'
  candidatesScanned: number
  candidatesWithMovement: number
}

export type GetMoversOpts = {
  windowDays?: MoverWindow
  topN?: number
}

/** FAIL-CLOSED: returns `null` on candidate/finishes/printings errors,
 *  silently drops observation chunks that error. Safe for callers that
 *  treat a degraded result as a visible "no movers" state (homepage
 *  market-pulse section, AI assistant tool call). **Do NOT use from a
 *  route that participates in Full Route Cache / ISR** — a transient
 *  Supabase blip would cache the EmptyPanel lie or a confidently
 *  incomplete mover list for the entire revalidate window. Use
 *  `getMarketMoversStrict` on cacheable routes. */
export async function getMarketMovers(
  optsOrTopN: GetMoversOpts | number = {},
): Promise<MarketMovers | null> {
  const opts: GetMoversOpts = typeof optsOrTopN === 'number'
    ? { topN: optsOrTopN }
    : optsOrTopN
  const windowDays: MoverWindow = opts.windowDays ?? 30
  const topN = opts.topN ?? 4

  const supabase = getSupabaseServiceClient()

  // 1) Candidate pool: high value current-priced finishes on the basis.
  const { data: candidates, error: candErr } = await supabase
    .from('mtg_current_prices')
    .select('printing_finish_id, price, observed_on')
    .eq('provider', PROVIDER)
    .eq('currency', CURRENCY)
    .eq('market', MARKET)
    .eq('price_type', PRICE_TYPE)
    .gte('price', MIN_PRICE_USD)
    .order('price', { ascending: false })
    .limit(CANDIDATE_LIMIT)
  if (candErr || !candidates || candidates.length === 0) {
    if (candErr) console.error('getMarketMovers current-price error:', candErr)
    return null
  }

  const finishIds = candidates.map((c: any) => c.printing_finish_id as string)

  // 2) Pull observations for exactly those finishes within the window.
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - windowDays)
  const sinceIso = since.toISOString().slice(0, 10)

  const chunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) chunks.push(finishIds.slice(i, i + IN_CHUNK))

  type Agg = { earliest: { d: string; p: number }; latest: { d: string; p: number } }
  const byFinish = new Map<string, Agg>()

  const obsResults = await Promise.all(chunks.map((chunk) =>
    supabase
      .from('mtg_price_observations')
      .select('printing_finish_id, observed_on, price')
      .eq('provider', PROVIDER)
      .eq('currency', CURRENCY)
      .eq('market', MARKET)
      .eq('price_type', PRICE_TYPE)
      // Historical bootstrap rows may not have is_anomalous set; treat
      // NULL as "not flagged bad".
      .or('is_anomalous.is.null,is_anomalous.eq.false')
      .gte('observed_on', sinceIso)
      .in('printing_finish_id', chunk),
  ))

  for (const { data, error } of obsResults) {
    if (error) { console.error('getMarketMovers observation chunk error:', error); continue }
    for (const row of (data ?? []) as any[]) {
      const id = row.printing_finish_id as string
      const d = row.observed_on as string
      const p = Number(row.price)
      if (!Number.isFinite(p) || p <= 0) continue
      const cur = byFinish.get(id)
      if (!cur) { byFinish.set(id, { earliest: { d, p }, latest: { d, p } }); continue }
      if (d < cur.earliest.d) cur.earliest = { d, p }
      if (d > cur.latest.d)   cur.latest   = { d, p }
    }
  }

  // 3) Score.
  const minSpan = minSpanDays(windowDays)
  type Scored = {
    finish_id: string
    start: number
    latest: number
    abs: number
    pct: number
    days: number
  }
  const scored: Scored[] = []
  for (const [id, a] of Array.from(byFinish.entries())) {
    if (a.earliest.d === a.latest.d) continue
    if (a.latest.p < MIN_PRICE_USD) continue
    const days = daysBetween(a.earliest.d, a.latest.d)
    if (days < minSpan) continue
    const abs = a.latest.p - a.earliest.p
    if (Math.abs(abs) < MIN_ABS_DELTA_USD) continue
    const pct = abs / a.earliest.p
    scored.push({ finish_id: id, start: a.earliest.p, latest: a.latest.p, abs, pct, days })
  }

  if (scored.length === 0) return null

  // Rankings.
  const risers  = scored.filter((s) => s.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, topN)
  const fallers = scored.filter((s) => s.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, topN)
  const active  = scored.slice().sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs)).slice(0, topN)
  const mostValuable = scored.slice().sort((a, b) => b.latest - a.latest).slice(0, topN)

  const needFinish = Array.from(new Set([
    ...risers, ...fallers, ...active, ...mostValuable,
  ].map((s) => s.finish_id)))

  const [{ data: finishRows }, ] = await Promise.all([
    supabase.from('mtg_printing_finishes').select('id, printing_id, finish').in('id', needFinish),
  ])
  if (!finishRows) return null

  const printingIds = Array.from(new Set(finishRows.map((f: any) => f.printing_id as string)))
  const { data: prints } = await supabase
    .from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, image_uri_small, name, digital, lang')
    .in('id', printingIds)
  if (!prints) return null

  const printById = new Map<string, any>()
  for (const p of prints as any[]) printById.set(p.id as string, p)

  const setCodes = Array.from(new Set(prints.map((p: any) => p.set_code as string)))
  const { data: sets } = await supabase.from('mtg_sets').select('code, name').in('code', setCodes)
  const setNameByCode = new Map<string, string>()
  for (const s of (sets ?? []) as any[]) setNameByCode.set(s.code, s.name)

  const finishById = new Map<string, any>()
  for (const f of finishRows as any[]) finishById.set(f.id as string, f)

  function hydrate(s: Scored): MoverCard | null {
    const f = finishById.get(s.finish_id)
    if (!f) return null
    const pr = printById.get(f.printing_id)
    if (!pr) return null
    if (pr.digital) return null
    if (pr.lang && pr.lang !== 'en') return null
    const name = pr.name as string
    return {
      finish_id: s.finish_id,
      printing_id: pr.id,
      oracle_card_id: pr.oracle_card_id,
      name,
      set_code: pr.set_code,
      set_name: setNameByCode.get(pr.set_code) ?? pr.set_code.toUpperCase(),
      collector_number: pr.collector_number,
      image_uri_small: pr.image_uri_small,
      finish: f.finish,
      card_href: buildCardHref(pr.set_code, pr.collector_number, name),
      start_price: round2(s.start),
      latest_price: round2(s.latest),
      abs_delta: round2(s.abs),
      pct_delta: s.pct,
      currency: 'USD',
      provider: PROVIDER,
      period_days: s.days,
    }
  }

  const hydratedRisers = risers.map(hydrate).filter(Boolean) as MoverCard[]
  const hydratedFallers = fallers.map(hydrate).filter(Boolean) as MoverCard[]
  const hydratedActive = active.map(hydrate).filter(Boolean) as MoverCard[]
  const hydratedMostValuable = mostValuable.map(hydrate).filter(Boolean) as MoverCard[]

  if (
    hydratedRisers.length === 0 &&
    hydratedFallers.length === 0 &&
    hydratedActive.length === 0
  ) return null

  return {
    risers: hydratedRisers,
    fallers: hydratedFallers,
    active: hydratedActive,
    mostValuable: hydratedMostValuable,
    windowDays,
    currency: 'USD',
    provider: PROVIDER,
    market: 'paper',
    priceType: 'retail',
    candidatesScanned: candidates.length,
    candidatesWithMovement: scored.length,
  }
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso + 'T00:00:00Z')
  const b = Date.parse(bIso + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round(Math.abs(b - a) / 86400000)
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Strict variant for cacheable callers ──────────────────────────
// Mirrors getMarketMovers but retries every required Supabase stage
// (candidates, every observation chunk, printing_finishes, printings)
// and throws on persistent failure. Next.js skips caching a thrown
// render, so a transient Supabase blip during ISR regeneration no
// longer gets memorialised as an "EmptyPanel: no movers cleared the
// filters" lie for the whole revalidate window. Set-name lookup
// (mtg_sets) stays fail-open — a missing set name just falls back to
// the uppercase set code, which is cosmetic rather than a factual
// claim about movers.

const MOVERS_MAX_ATTEMPTS = 3
const MOVERS_BACKOFF_MS = [100, 200, 400] as const

const moversSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type MoversQueryAttempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

function moversErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

async function runMoversQueryWithRetry<T>(
  label: string,
  runQuery: () => Promise<MoversQueryAttempt<T>>,
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= MOVERS_MAX_ATTEMPTS; attempt++) {
    try {
      const r = await runQuery()
      if (r.ok) return r.value
      lastError = (r as { ok: false; error: unknown }).error
      console.warn(`[${label}] attempt=${attempt}/${MOVERS_MAX_ATTEMPTS} error: ${moversErrorMessage(lastError)}`)
    } catch (e) {
      lastError = e
      console.warn(`[${label}] attempt=${attempt}/${MOVERS_MAX_ATTEMPTS} threw: ${moversErrorMessage(e)}`)
    }
    if (attempt < MOVERS_MAX_ATTEMPTS) await moversSleep(MOVERS_BACKOFF_MS[attempt - 1])
  }
  throw new Error(`${label}: failed after ${MOVERS_MAX_ATTEMPTS} attempts: ${moversErrorMessage(lastError)}`)
}

/** Strict variant of `getMarketMovers`. Semantics:
 *   - genuine zero result (no candidates match the min-price filter,
 *     or no scored movers survive the thresholds) → returns `null`
 *     so the page renders its EmptyPanel ("no movers cleared the
 *     filters") as a legitimate factual statement.
 *   - transient failure on any required stage (candidates, any one of
 *     the ~10 observation chunks, printing_finishes lookup, printings
 *     lookup) → retried up to 3 times with bounded backoff; persistent
 *     failure throws so the caching layer cannot memorialise the
 *     failure as "no movers". Set-name lookup is deliberately
 *     fail-open (cosmetic fallback to uppercase set code). */
export async function getMarketMoversStrict(
  optsOrTopN: GetMoversOpts | number = {},
): Promise<MarketMovers | null> {
  const opts: GetMoversOpts = typeof optsOrTopN === 'number'
    ? { topN: optsOrTopN }
    : optsOrTopN
  const windowDays: MoverWindow = opts.windowDays ?? 30
  const topN = opts.topN ?? 4

  const supabase = getSupabaseServiceClient()
  const stageLabel = (name: string) => `getMarketMoversStrict window=${windowDays} stage=${name}`

  // Stage 1 — candidate pool.
  const candidates = await runMoversQueryWithRetry<Array<{ printing_finish_id: string; price: number; observed_on: string }>>(
    stageLabel('candidates'),
    async () => {
      const { data, error } = await supabase
        .from('mtg_current_prices')
        .select('printing_finish_id, price, observed_on')
        .eq('provider', PROVIDER)
        .eq('currency', CURRENCY)
        .eq('market', MARKET)
        .eq('price_type', PRICE_TYPE)
        .gte('price', MIN_PRICE_USD)
        .order('price', { ascending: false })
        .limit(CANDIDATE_LIMIT)
      if (error) return { ok: false, error }
      return { ok: true, value: (data ?? []) as any[] }
    },
  )
  if (candidates.length === 0) return null  // legitimate "no priced candidates" — zero not an error
  const finishIds = candidates.map((c) => c.printing_finish_id)

  // Stage 2 — observations for each chunk. Any chunk persistently
  // failing is a hard error — silently dropping a chunk would hide
  // ~10% of inputs from the ranking.
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - windowDays)
  const sinceIso = since.toISOString().slice(0, 10)

  const chunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) chunks.push(finishIds.slice(i, i + IN_CHUNK))

  type Agg = { earliest: { d: string; p: number }; latest: { d: string; p: number } }
  const byFinish = new Map<string, Agg>()

  const obsResults = await Promise.all(chunks.map((chunk, idx) =>
    runMoversQueryWithRetry<Array<{ printing_finish_id: string; observed_on: string; price: number }>>(
      stageLabel(`observations-chunk-${idx + 1}/${chunks.length}`),
      async () => {
        const { data, error } = await supabase
          .from('mtg_price_observations')
          .select('printing_finish_id, observed_on, price')
          .eq('provider', PROVIDER)
          .eq('currency', CURRENCY)
          .eq('market', MARKET)
          .eq('price_type', PRICE_TYPE)
          .or('is_anomalous.is.null,is_anomalous.eq.false')
          .gte('observed_on', sinceIso)
          .in('printing_finish_id', chunk)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
  ))

  for (const rows of obsResults) {
    for (const row of rows) {
      const id = row.printing_finish_id
      const d = row.observed_on
      const p = Number(row.price)
      if (!Number.isFinite(p) || p <= 0) continue
      const cur = byFinish.get(id)
      if (!cur) { byFinish.set(id, { earliest: { d, p }, latest: { d, p } }); continue }
      if (d < cur.earliest.d) cur.earliest = { d, p }
      if (d > cur.latest.d)   cur.latest   = { d, p }
    }
  }

  // Stage 3 — score + rank (pure CPU, no DB).
  const minSpan = minSpanDays(windowDays)
  type Scored = { finish_id: string; start: number; latest: number; abs: number; pct: number; days: number }
  const scored: Scored[] = []
  for (const [id, a] of Array.from(byFinish.entries())) {
    if (a.earliest.d === a.latest.d) continue
    if (a.latest.p < MIN_PRICE_USD) continue
    const days = daysBetween(a.earliest.d, a.latest.d)
    if (days < minSpan) continue
    const abs = a.latest.p - a.earliest.p
    if (Math.abs(abs) < MIN_ABS_DELTA_USD) continue
    const pct = abs / a.earliest.p
    scored.push({ finish_id: id, start: a.earliest.p, latest: a.latest.p, abs, pct, days })
  }
  if (scored.length === 0) return null  // legitimate "no movers survived filters"

  const risers       = scored.filter((s) => s.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, topN)
  const fallers      = scored.filter((s) => s.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, topN)
  const active       = scored.slice().sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs)).slice(0, topN)
  const mostValuable = scored.slice().sort((a, b) => b.latest - a.latest).slice(0, topN)

  const needFinish = Array.from(new Set(
    [...risers, ...fallers, ...active, ...mostValuable].map((s) => s.finish_id),
  ))

  // Stage 4 — printing_finishes lookup. Strict.
  const finishRows = await runMoversQueryWithRetry<Array<{ id: string; printing_id: string; finish: string }>>(
    stageLabel('printing-finishes'),
    async () => {
      const { data, error } = await supabase
        .from('mtg_printing_finishes')
        .select('id, printing_id, finish')
        .in('id', needFinish)
      if (error) return { ok: false, error }
      return { ok: true, value: (data ?? []) as any[] }
    },
  )

  const printingIds = Array.from(new Set(finishRows.map((f) => f.printing_id)))

  // Stage 5 — printings lookup. Strict.
  const prints = await runMoversQueryWithRetry<Array<{ id: string; oracle_card_id: string; set_code: string; collector_number: string | null; image_uri_small: string | null; name: string; digital: boolean | null; lang: string | null }>>(
    stageLabel('printings'),
    async () => {
      const { data, error } = await supabase
        .from('mtg_printings')
        .select('id, oracle_card_id, set_code, collector_number, image_uri_small, name, digital, lang')
        .in('id', printingIds)
      if (error) return { ok: false, error }
      return { ok: true, value: (data ?? []) as any[] }
    },
  )

  const printById = new Map<string, any>()
  for (const p of prints) printById.set(p.id, p)

  // Stage 6 — set-name lookup. INTENTIONALLY fail-open: a missing set
  // name just falls back to the uppercase set code. Cosmetic, not
  // factually load-bearing.
  const setCodes = Array.from(new Set(prints.map((p) => p.set_code)))
  const { data: sets } = await supabase.from('mtg_sets').select('code, name').in('code', setCodes)
  const setNameByCode = new Map<string, string>()
  for (const s of (sets ?? []) as any[]) setNameByCode.set(s.code, s.name)

  const finishById = new Map<string, any>()
  for (const f of finishRows) finishById.set(f.id, f)

  function hydrate(s: Scored): MoverCard | null {
    const f = finishById.get(s.finish_id)
    if (!f) return null
    const pr = printById.get(f.printing_id)
    if (!pr) return null
    if (pr.digital) return null
    if (pr.lang && pr.lang !== 'en') return null
    const name = pr.name as string
    return {
      finish_id: s.finish_id,
      printing_id: pr.id,
      oracle_card_id: pr.oracle_card_id,
      name,
      set_code: pr.set_code,
      set_name: setNameByCode.get(pr.set_code) ?? pr.set_code.toUpperCase(),
      collector_number: pr.collector_number,
      image_uri_small: pr.image_uri_small,
      finish: f.finish,
      card_href: buildCardHref(pr.set_code, pr.collector_number, name),
      start_price: round2(s.start),
      latest_price: round2(s.latest),
      abs_delta: round2(s.abs),
      pct_delta: s.pct,
      currency: 'USD',
      provider: PROVIDER,
      period_days: s.days,
    }
  }

  const hydratedRisers       = risers.map(hydrate).filter(Boolean) as MoverCard[]
  const hydratedFallers      = fallers.map(hydrate).filter(Boolean) as MoverCard[]
  const hydratedActive       = active.map(hydrate).filter(Boolean) as MoverCard[]
  const hydratedMostValuable = mostValuable.map(hydrate).filter(Boolean) as MoverCard[]

  if (hydratedRisers.length === 0 && hydratedFallers.length === 0 && hydratedActive.length === 0) {
    return null
  }

  return {
    risers: hydratedRisers,
    fallers: hydratedFallers,
    active: hydratedActive,
    mostValuable: hydratedMostValuable,
    windowDays,
    currency: 'USD',
    provider: PROVIDER,
    market: 'paper',
    priceType: 'retail',
    candidatesScanned: candidates.length,
    candidatesWithMovement: scored.length,
  }
}
