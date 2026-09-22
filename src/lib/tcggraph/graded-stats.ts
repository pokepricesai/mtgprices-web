// src/lib/tcggraph/graded-stats.ts
//
// Server-only helpers that build the public /graded discovery page
// and the homepage graded promo section from real production data.
// Nothing here interpolates or fabricates values. If a lookup fails
// the caller gets a null-safe fallback and the UI stays quiet.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildCardSlug } from '@/lib/mtg/slug'

export type GradedNetworkStats = {
  /** Distinct MTG printings that carry at least one slabbed (non-raw)
   *  graded quote. Live query - no hardcoded values. */
  distinctSlabPrintings: number
  /** Distinct MTG printings with a stored raw quote. */
  distinctRawPrintings: number
  /** Whether the query returned successfully. False on failure so the
   *  UI can hide numeric copy rather than showing 0. */
  reliable: boolean
}

/** Homepage / promo top-line count. Cached at Next's revalidate layer
 *  by callers. Uses PostgREST + a lightweight scan; if the resulting
 *  distinct set exceeds 10 000 rows we cap at that number for latency,
 *  which is fine because the number is displayed as "10,000+". */
export async function getGradedNetworkStats(): Promise<GradedNetworkStats> {
  const sb = getSupabaseServiceClient()
  try {
    //  Query 1: slabbed printing IDs only (grader != raw). Two-clause
    //  filter keeps the scan tight. Page in 1000-row chunks until done.
    const slabIds = new Set<string>()
    const rawIds  = new Set<string>()
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb
        .from('tcg_graded_prices_current')
        .select('tcg_printing_id')
        .eq('game_id', 'mtg')
        .not('grader', 'in', '("raw")')
        .range(offset, offset + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      for (const r of data) slabIds.add(r.tcg_printing_id)
      if (data.length < 1000) break
      if (offset >= 100_000) break   // absolute ceiling
    }
    //  Query 2: raw printing IDs.
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb
        .from('tcg_graded_prices_current')
        .select('tcg_printing_id')
        .eq('game_id', 'mtg')
        .eq('grader', 'raw')
        .range(offset, offset + 999)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      for (const r of data) rawIds.add(r.tcg_printing_id)
      if (data.length < 1000) break
      if (offset >= 200_000) break
    }
    //  Map slab tcg_printings.id -> mtg_printings_id. Chunked at 100 to
    //  stay under PostgREST URL-length limits.
    const ids = Array.from(slabIds)
    const mappedSet = new Set<string>()
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100)
      const { data, error } = await sb
        .from('tcg_printings')
        .select('mtg_printings_id')
        .in('id', slice)
        .not('mtg_printings_id', 'is', null)
      if (error) throw new Error(error.message)
      for (const r of data ?? []) if (r.mtg_printings_id) mappedSet.add(r.mtg_printings_id)
    }
    return { distinctSlabPrintings: mappedSet.size, distinctRawPrintings: rawIds.size, reliable: true }
  } catch (err) {
    console.error('[graded-stats] getGradedNetworkStats failed', err instanceof Error ? err.message : String(err))
    return { distinctSlabPrintings: 0, distinctRawPrintings: 0, reliable: false }
  }
}

export type GradedFeatureRow = {
  mtgPrintingId: string
  cardName: string
  setCode: string
  setName: string | null
  collectorNumber: string | null
  releasedAt: string | null
  imageUri: string | null
  cardHref: string
  headline: {
    grader: string
    grade: string
    price: number
    currency: string
  }
  raw?: {
    price: number
    currency: string
  }
  premiumPercent?: number
}

/** Top slabbed printings by PSA-10 price (fallback: BGS/CGC/SGC 10, any
 *  grade-10 if no slab-branded 10 exists). Live query. */
export async function getTopValueGradedPrintings(limit = 12): Promise<GradedFeatureRow[]> {
  const sb = getSupabaseServiceClient()
  try {
    //  Pull the top-price slab quotes, then join to mtg_printings.
    const { data: quotes, error } = await sb
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id, grader, grade, price, currency')
      .eq('game_id', 'mtg')
      .in('grader', ['psa', 'bgs', 'cgc', 'sgc'])
      .eq('grade', '10')
      .order('price', { ascending: false })
      .limit(limit * 6) // headroom to dedupe by mtg_printings.id
    if (error) throw new Error(error.message)
    if (!quotes || quotes.length === 0) return []

    //  Map each tcg_printing_id -> mtg_printings_id.
    const tcgIds = Array.from(new Set(quotes.map((q) => q.tcg_printing_id)))
    const { data: prints } = await sb
      .from('tcg_printings')
      .select('id, mtg_printings_id')
      .in('id', tcgIds)
      .not('mtg_printings_id', 'is', null)
    const mtgByTcg = new Map<string, string>()
    for (const p of prints ?? []) if (p.mtg_printings_id) mtgByTcg.set(p.id, p.mtg_printings_id)

    //  Pull mtg_printings metadata.
    const mtgIds = Array.from(new Set(Array.from(mtgByTcg.values())))
    const { data: mtgRows } = await sb
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, released_at, image_uri, lang')
      .in('id', mtgIds)
    const mtgById = new Map<string, { id: string; name: string; set_code: string; collector_number: string | null; released_at: string | null; image_uri: string | null; lang: string | null }>()
    for (const r of mtgRows ?? []) mtgById.set(r.id, r as { id: string; name: string; set_code: string; collector_number: string | null; released_at: string | null; image_uri: string | null; lang: string | null })

    //  Set name lookup - one query.
    const setCodes = Array.from(new Set(Array.from(mtgById.values()).map((r) => r.set_code)))
    const { data: setRows } = await sb.from('mtg_sets').select('code, name').in('code', setCodes)
    const setNameByCode = new Map<string, string>()
    for (const r of setRows ?? []) setNameByCode.set(r.code, r.name)

    //  Build rows, dedupe by mtg_printings_id, cap.
    const seen = new Set<string>()
    const out: GradedFeatureRow[] = []
    for (const q of quotes) {
      const mtgId = mtgByTcg.get(q.tcg_printing_id)
      if (!mtgId || seen.has(mtgId)) continue
      seen.add(mtgId)
      const mtg = mtgById.get(mtgId)
      if (!mtg || (mtg.lang && mtg.lang !== 'en')) continue
      out.push({
        mtgPrintingId: mtgId,
        cardName: mtg.name,
        setCode: mtg.set_code,
        setName: setNameByCode.get(mtg.set_code) ?? null,
        collectorNumber: mtg.collector_number ?? null,
        releasedAt: mtg.released_at ?? null,
        imageUri: mtg.image_uri ?? null,
        cardHref: `/set/${mtg.set_code}/card/${buildCardSlug(mtg.collector_number ?? '', mtg.name)}`,
        headline: { grader: q.grader.toUpperCase(), grade: q.grade, price: q.price, currency: q.currency },
      })
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    console.error('[graded-stats] getTopValueGradedPrintings failed', err instanceof Error ? err.message : String(err))
    return []
  }
}

/** Biggest same-currency raw-to-slab-10 premiums. We deliberately only
 *  compute the premium when raw and slab are for the same tcg_printing_id
 *  AND same currency - otherwise no comparison. */
export async function getTopPremiumPrintings(limit = 12): Promise<GradedFeatureRow[]> {
  const sb = getSupabaseServiceClient()
  try {
    //  Pull all raw rows for MTG + all slab-10 rows for MTG. Match on
    //  tcg_printing_id + currency, keep top ratios.
    const [{ data: rawRows }, { data: slabRows }] = await Promise.all([
      sb.from('tcg_graded_prices_current')
        .select('tcg_printing_id, price, currency')
        .eq('game_id', 'mtg').eq('grader', 'raw')
        .range(0, 9999),
      sb.from('tcg_graded_prices_current')
        .select('tcg_printing_id, grader, grade, price, currency')
        .eq('game_id', 'mtg')
        .in('grader', ['psa', 'bgs', 'cgc', 'sgc'])
        .eq('grade', '10')
        .range(0, 9999),
    ])
    if (!rawRows || !slabRows) return []
    const rawByKey = new Map<string, { price: number; currency: string }>()
    for (const r of rawRows) {
      if (r.price == null || r.price <= 0) continue
      rawByKey.set(`${r.tcg_printing_id}|${r.currency}`, { price: r.price, currency: r.currency })
    }
    type Candidate = { tcgPrintingId: string; slabGrader: string; slabPrice: number; rawPrice: number; currency: string; premium: number }
    const candidates: Candidate[] = []
    for (const s of slabRows) {
      const raw = rawByKey.get(`${s.tcg_printing_id}|${s.currency}`)
      if (!raw) continue
      const premium = s.price / raw.price
      if (!Number.isFinite(premium) || premium <= 1) continue
      candidates.push({
        tcgPrintingId: s.tcg_printing_id,
        slabGrader: s.grader.toUpperCase(),
        slabPrice: s.price,
        rawPrice: raw.price,
        currency: s.currency,
        premium,
      })
    }
    candidates.sort((a, b) => b.premium - a.premium)

    //  Take the top candidates, map to mtg_printings, hydrate.
    const tcgIds = Array.from(new Set(candidates.slice(0, limit * 6).map((c) => c.tcgPrintingId)))
    const { data: prints } = await sb.from('tcg_printings').select('id, mtg_printings_id').in('id', tcgIds).not('mtg_printings_id', 'is', null)
    const mtgByTcg = new Map<string, string>()
    for (const p of prints ?? []) if (p.mtg_printings_id) mtgByTcg.set(p.id, p.mtg_printings_id)
    const mtgIds = Array.from(new Set(Array.from(mtgByTcg.values())))
    if (mtgIds.length === 0) return []
    const { data: mtgRows } = await sb.from('mtg_printings')
      .select('id, name, set_code, collector_number, released_at, image_uri, lang')
      .in('id', mtgIds)
    const mtgById = new Map<string, { id: string; name: string; set_code: string; collector_number: string | null; released_at: string | null; image_uri: string | null; lang: string | null }>()
    for (const r of mtgRows ?? []) mtgById.set(r.id, r as { id: string; name: string; set_code: string; collector_number: string | null; released_at: string | null; image_uri: string | null; lang: string | null })
    const setCodes = Array.from(new Set(Array.from(mtgById.values()).map((r) => r.set_code)))
    const { data: setRows } = await sb.from('mtg_sets').select('code, name').in('code', setCodes)
    const setNameByCode = new Map<string, string>()
    for (const r of setRows ?? []) setNameByCode.set(r.code, r.name)

    const seen = new Set<string>()
    const out: GradedFeatureRow[] = []
    for (const c of candidates) {
      const mtgId = mtgByTcg.get(c.tcgPrintingId)
      if (!mtgId || seen.has(mtgId)) continue
      seen.add(mtgId)
      const mtg = mtgById.get(mtgId)
      if (!mtg || (mtg.lang && mtg.lang !== 'en')) continue
      out.push({
        mtgPrintingId: mtgId,
        cardName: mtg.name,
        setCode: mtg.set_code,
        setName: setNameByCode.get(mtg.set_code) ?? null,
        collectorNumber: mtg.collector_number ?? null,
        releasedAt: mtg.released_at ?? null,
        imageUri: mtg.image_uri ?? null,
        cardHref: `/set/${mtg.set_code}/card/${buildCardSlug(mtg.collector_number ?? '', mtg.name)}`,
        headline: { grader: c.slabGrader, grade: '10', price: c.slabPrice, currency: c.currency },
        raw: { price: c.rawPrice, currency: c.currency },
        premiumPercent: Math.round((c.premium - 1) * 100),
      })
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    console.error('[graded-stats] getTopPremiumPrintings failed', err instanceof Error ? err.message : String(err))
    return []
  }
}
