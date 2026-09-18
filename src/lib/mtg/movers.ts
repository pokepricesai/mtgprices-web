// src/lib/mtg/movers.ts
// Server-only helper — compute top-mover cards from mtg_price_observations.
//
// This is intentionally conservative. It:
//   • locks the basis to paper / USD / retail so we don't mix currencies
//   • locks the provider to a single headline provider (tcgplayer) so
//     changes are like-for-like (comparing two different providers over
//     time would be nonsense)
//   • filters is_anomalous rows
//   • ignores cards with < 2 valid observations spanning ≥ 3 days
//   • ignores cards whose latest price < $2 (movers on penny cards are
//     mostly noise and would drown out anything meaningful)
//   • bounds the observation scan hard so this stays cheap on the
//     homepage (revalidate = 300)
//
// Returns three parallel lists: risers, fallers, most active. Each entry
// is a joined card+set summary the homepage can render directly.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

const WINDOW_DAYS = 7
const MIN_PRICE_USD = 2
const MIN_ABS_DELTA_USD = 0.25
const PROVIDER = 'tcgplayer'

// Cap the raw observation scan. Even at full DB size this stays well
// under a normal 1s Postgres budget on the (finish, observed_on) index.
const RAW_LIMIT = 8000

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
  card_href: string          // canonical /set/{code}/card/{collector-slug} URL
  start_price: number
  latest_price: number
  abs_delta: number
  pct_delta: number          // 0.12 == +12%
  currency: 'USD'
  provider: string
  period_days: number
}

export type MarketMovers = {
  risers: MoverCard[]
  fallers: MoverCard[]
  active: MoverCard[]
  windowDays: number
  currency: 'USD'
  provider: string
}

export async function getMarketMovers(topN = 4): Promise<MarketMovers | null> {
  const supabase = getSupabaseServiceClient()

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - WINDOW_DAYS)
  const sinceIso = since.toISOString().slice(0, 10)

  // 1) Pull recent observations for the fixed basis.
  const { data: obs, error: obsErr } = await supabase
    .from('mtg_price_observations')
    .select('printing_finish_id, observed_on, price')
    .eq('provider', PROVIDER)
    .eq('market', 'paper')
    .eq('currency', 'USD')
    .eq('price_type', 'retail')
    .eq('is_anomalous', false)
    .gte('observed_on', sinceIso)
    .order('observed_on', { ascending: true })
    .limit(RAW_LIMIT)

  if (obsErr || !obs || obs.length === 0) {
    if (obsErr) console.error('getMarketMovers observation error:', obsErr)
    return null
  }

  // 2) Group by finish; compute earliest+latest.
  type Agg = { earliest: { d: string; p: number }; latest: { d: string; p: number } }
  const byFinish = new Map<string, Agg>()
  for (const row of obs as any[]) {
    const id = row.printing_finish_id as string
    const d = row.observed_on as string
    const p = Number(row.price)
    if (!Number.isFinite(p) || p <= 0) continue
    const cur = byFinish.get(id)
    if (!cur) { byFinish.set(id, { earliest: { d, p }, latest: { d, p } }); continue }
    if (d < cur.earliest.d) cur.earliest = { d, p }
    if (d > cur.latest.d)   cur.latest   = { d, p }
  }

  // 3) Score. Require ≥ 3-day span, latest ≥ min price, non-zero delta.
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
    if (days < 3) continue
    const abs = a.latest.p - a.earliest.p
    if (Math.abs(abs) < MIN_ABS_DELTA_USD) continue
    const pct = abs / a.earliest.p
    scored.push({ finish_id: id, start: a.earliest.p, latest: a.latest.p, abs, pct, days })
  }
  if (scored.length === 0) return null

  const risers  = scored.filter((s) => s.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, topN)
  const fallers = scored.filter((s) => s.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, topN)
  const active  = scored.slice().sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs)).slice(0, topN)

  // Union of finishes we need to hydrate.
  const finishIds = Array.from(new Set([...risers, ...fallers, ...active].map((s) => s.finish_id)))
  if (finishIds.length === 0) return null

  const { data: finishes, error: finErr } = await supabase
    .from('mtg_printing_finishes')
    .select('id, printing_id, finish')
    .in('id', finishIds)
  if (finErr || !finishes) {
    console.error('getMarketMovers finish error:', finErr)
    return null
  }

  const printingIds = Array.from(new Set(finishes.map((f: any) => f.printing_id as string)))
  const { data: prints, error: prErr } = await supabase
    .from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, image_uri_small, name, digital, lang')
    .in('id', printingIds)
  if (prErr || !prints) {
    console.error('getMarketMovers printings error:', prErr)
    return null
  }
  const printById = new Map<string, any>()
  for (const p of prints as any[]) printById.set(p.id as string, p)

  // Set names
  const setCodes = Array.from(new Set(prints.map((p: any) => p.set_code as string)))
  const { data: sets } = await supabase
    .from('mtg_sets')
    .select('code, name')
    .in('code', setCodes)
  const setNameByCode = new Map<string, string>()
  for (const s of (sets ?? []) as any[]) setNameByCode.set(s.code, s.name)

  const finishById = new Map<string, any>()
  for (const f of finishes as any[]) finishById.set(f.id as string, f)

  function hydrate(s: Scored): MoverCard | null {
    const f = finishById.get(s.finish_id)
    if (!f) return null
    const pr = printById.get(f.printing_id)
    if (!pr) return null
    // Skip digital/non-English defensively.
    if (pr.digital) return null
    if (pr.lang && pr.lang !== 'en') return null
    const name = pr.name as string
    const collectorSegment = pr.collector_number ? `${pr.collector_number}-${slug(name)}` : slug(name)
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
      card_href: `/set/${pr.set_code}/card/${collectorSegment}`,
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

  if (hydratedRisers.length === 0 && hydratedFallers.length === 0 && hydratedActive.length === 0) {
    return null
  }

  return {
    risers: hydratedRisers,
    fallers: hydratedFallers,
    active: hydratedActive,
    windowDays: WINDOW_DAYS,
    currency: 'USD',
    provider: PROVIDER,
  }
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso + 'T00:00:00Z')
  const b = Date.parse(bIso + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round(Math.abs(b - a) / 86400000)
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

import { slugifyCardName as slug } from './slug'
