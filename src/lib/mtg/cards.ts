// src/lib/mtg/cards.ts
// Server-only MTG card + printing queries. Every read goes through the
// service-role client because the price tables are RLS-gated and we
// want a single uniform API for MTG data.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runStrictQueryWithRetry } from './strictRetry'

export type MtgOracleCard = {
  id: string
  oracle_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  oracle_text: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  colors: string[] | null
  color_identity: string[] | null
  keywords: string[] | null
  layout: string | null
  card_faces: unknown
  produced_mana: string[] | null
  reserved: boolean | null
  game_changer: boolean | null
  capabilities: string[]
}

export type MtgPrinting = {
  id: string
  oracle_card_id: string
  set_id: string
  scryfall_id: string
  set_code: string
  collector_number: string | null
  lang: string | null
  name: string
  layout: string | null
  rarity: string | null
  artist: string | null
  image_uri: string | null
  image_uri_small: string | null
  art_crop_uri: string | null
  released_at: string | null
  borderless: boolean | null
  full_art: boolean | null
  promo: boolean | null
  digital: boolean | null
  scryfall_uri: string | null
  reprint: boolean | null
  textless: boolean | null
  variation: boolean | null
}

export type MtgFinish = {
  id: string           // printing_finish id (used by prices)
  finish: string       // 'nonfoil' | 'foil' | 'etched'
}

export type MtgLegality = { format: string; legality: string }
export type MtgRuling  = { source: string; published_at: string | null; comment: string }

// Pure slug helpers live in ./slug so client components can import
// them without pulling in the server-only Supabase client.
export { slugifyCardName, buildCardSlug, parseCardSlug, candidateCardSlugSplits } from './slug'
import { slugifyCardName, candidateCardSlugSplits } from './slug'

// ─── Set → card grid ─────────────────────────────────────────────────────

export type MtgSetCard = MtgPrinting & {
  oracle_name: string
  oracle_type_line: string | null
  oracle_mana_cost: string | null
  oracle_colors: string[] | null
}

// Shared row mapper so the fail-closed and strict variants cannot
// drift. Any new field we project in the SELECT belongs here too.
function mapMtgSetCardRow(r: any): MtgSetCard {
  return {
    id: r.id,
    oracle_card_id: r.oracle_card_id,
    set_id: r.set_id,
    scryfall_id: r.scryfall_id,
    set_code: r.set_code,
    collector_number: r.collector_number,
    lang: r.lang,
    name: r.name,
    layout: r.layout,
    rarity: r.rarity,
    artist: r.artist,
    image_uri: r.image_uri,
    image_uri_small: r.image_uri_small,
    art_crop_uri: r.art_crop_uri,
    released_at: r.released_at,
    borderless: r.borderless,
    full_art: r.full_art,
    promo: r.promo,
    digital: r.digital,
    scryfall_uri: r.scryfall_uri,
    reprint: r.reprint ?? null,
    textless: r.textless ?? null,
    variation: r.variation ?? null,
    oracle_name: r.oracle?.name ?? r.name,
    oracle_type_line: r.oracle?.type_line ?? null,
    oracle_mana_cost: r.oracle?.mana_cost ?? null,
    oracle_colors: r.oracle?.colors ?? null,
  }
}

const MTG_SET_PRINTINGS_SELECT = `
  id, oracle_card_id, set_id, scryfall_id, set_code, collector_number, lang, name,
  layout, rarity, artist, image_uri, image_uri_small, art_crop_uri, released_at,
  borderless, full_art, promo, digital, scryfall_uri, reprint, textless, variation,
  oracle:mtg_oracle_cards ( name, type_line, mana_cost, colors )
`

/** All English printings in a given set, ordered by collector number.
 *  Paginates in 1000-row windows because PostgREST enforces a
 *  1000-row max regardless of the `.limit(3000)` hint. Secret Lair
 *  (SLD) has 2,700+ printings; without pagination we silently
 *  truncated the grid + set-completion denominator.
 *
 *  FAIL-CLOSED: returns `[]` on any error. Suitable for callers where
 *  a transient DB blip should degrade to an empty state rather than
 *  propagate. **Do NOT use from a route that participates in
 *  Full Route Cache / ISR** — a cached empty-state response can
 *  be pinned for the entire revalidate window. Use
 *  `listPrintingsForSetStrict` on cacheable routes. */
export async function listPrintingsForSet(setCode: string, opts: { includeDigital?: boolean } = {}): Promise<MtgSetCard[]> {
  const supabase = getSupabaseServiceClient()
  const normalised = setCode.trim().toLowerCase()
  if (!normalised) return []

  const PAGE = 1000
  const all: any[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from('mtg_printings')
      .select(MTG_SET_PRINTINGS_SELECT)
      .eq('set_code', normalised)
      .eq('lang', 'en')
      .order('collector_number', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (!opts.includeDigital) q = q.eq('digital', false)

    const { data, error } = await q
    if (error) {
      console.error('listPrintingsForSet error:', error)
      return []
    }
    const chunk = data ?? []
    all.push(...chunk)
    // Break when we got a partial page (i.e. no more rows).
    if (chunk.length < PAGE) break
    // Belt-and-braces cap so a malformed set can't spin forever.
    if (offset + PAGE >= 10_000) break
  }
  return all.map(mapMtgSetCardRow)
}

/** Strict variant of `listPrintingsForSet` for callers whose render
 *  result will be cached (ISR / Full Route Cache). Retries on error
 *  with short bounded backoff and THROWS if all attempts fail — this
 *  prevents a transient DB blip from being memorialised as an empty
 *  set page for the entire revalidate window.
 *
 *  Semantics:
 *   - genuine "no rows" success → returns `[]` (legitimate empty set)
 *   - transient error on one page → retried up to `MAX_ATTEMPTS` times
 *   - persistent failure → throws
 *   - identical row shape and ordering as `listPrintingsForSet` on
 *     success */
export async function listPrintingsForSetStrict(
  setCode: string,
  opts: { includeDigital?: boolean } = {},
): Promise<MtgSetCard[]> {
  const supabase = getSupabaseServiceClient()
  const normalised = setCode.trim().toLowerCase()
  if (!normalised) return []

  const PAGE = 1000
  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [100, 200, 400] as const

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  const all: any[] = []
  for (let offset = 0; ; offset += PAGE) {
    let chunk: any[] | null = null
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let q = supabase
          .from('mtg_printings')
          .select(MTG_SET_PRINTINGS_SELECT)
          .eq('set_code', normalised)
          .eq('lang', 'en')
          .order('collector_number', { ascending: true })
          .range(offset, offset + PAGE - 1)
        if (!opts.includeDigital) q = q.eq('digital', false)

        const { data, error } = await q
        if (error) {
          lastError = error
          console.warn(`[listPrintingsForSetStrict] set=${normalised} offset=${offset} attempt=${attempt}/${MAX_ATTEMPTS} error: ${error.message}`)
        } else {
          chunk = data ?? []
          break
        }
      } catch (e) {
        lastError = e
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[listPrintingsForSetStrict] set=${normalised} offset=${offset} attempt=${attempt}/${MAX_ATTEMPTS} threw: ${msg}`)
      }
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1])
    }
    if (chunk === null) {
      const msg = lastError instanceof Error ? lastError.message : String(lastError)
      // Throw a plain Error with the set code so Next.js prerender /
      // ISR logs make the failing slug obvious. Does not expose keys.
      throw new Error(`listPrintingsForSetStrict: set=${normalised} failed after ${MAX_ATTEMPTS} attempts: ${msg}`)
    }
    all.push(...chunk)
    if (chunk.length < PAGE) break
    if (offset + PAGE >= 10_000) break
  }
  return all.map(mapMtgSetCardRow)
}

// ─── Card page lookup ────────────────────────────────────────────────────

export type MtgCardDetail = {
  printing: MtgPrinting
  oracle: MtgOracleCard
  finishes: MtgFinish[]
  legalities: MtgLegality[]
  rulings: MtgRuling[]
  otherPrintings: MtgPrinting[]     // other printings of the same oracle
}

/** FAIL-CLOSED. Returns `null` on query errors, coercing an
 *  infrastructure failure into a 404 path at the caller. Suitable for
 *  tolerant callers; **do NOT use from a route that participates in
 *  Full Route Cache / ISR** — a transient Supabase blip would cache
 *  a 404 for the whole revalidate window. Use `getCardBySlugStrict`
 *  on cacheable routes. */
export async function getCardBySlug(setCode: string, cardSlug: string): Promise<MtgCardDetail | null> {
  const supabase = getSupabaseServiceClient()
  const set = setCode.trim().toLowerCase()
  // Next.js does not URL-decode non-ASCII characters in dynamic route
  // segments, so a request for /set/7ed/card/91%E2%98%85-opportunity
  // arrives here with cardSlug = '91%E2%98%85-opportunity'. Decode
  // once so the collector-number split matches the DB value ('91★').
  // decodeURIComponent throws on malformed input, treat that as 404.
  let decoded: string
  try { decoded = decodeURIComponent(cardSlug) } catch { return null }
  const splits = candidateCardSlugSplits(decoded)
  if (!set || splits.length === 0) return null

  // Both collector_number and name-slug can contain "-", so the split
  // between them is ambiguous. Query all candidate collector numbers
  // and pick the one whose printing name slugifies back to the URL.
  const candidates = splits.map((s) => s.collectorNumber)
  const { data: printings, error: pErr } = await supabase
    .from('mtg_printings')
    .select(`
      id, oracle_card_id, set_id, scryfall_id, set_code, collector_number, lang, name,
      layout, rarity, artist, image_uri, image_uri_small, art_crop_uri, released_at,
      borderless, full_art, promo, digital, scryfall_uri, reprint, textless, variation
    `)
    .eq('set_code', set)
    .in('collector_number', candidates)
    .order('lang', { ascending: true })
    .limit(50)
  if (pErr) {
    console.error('getCardBySlug printing error:', pErr)
    return null
  }
  const rows = printings ?? []
  // Strict match: the printing's name must slugify back to the URL. If
  // no printing at these candidate collector numbers has a matching
  // name, treat it as a 404 rather than silently returning whichever
  // card happens to sit at that collector number. That fallback used
  // to render, for example, /set/tdm/card/262-narset-veil-witch as
  // "Mystic Monastery" (the actual card at TDM 262), producing wrong
  // canonicals and duplicate SEO surface.
  const printing =
    rows.find((p: any) => p.lang === 'en' && `${p.collector_number}-${slugifyCardName(p.name)}` === decoded) ??
    rows.find((p: any) => `${p.collector_number}-${slugifyCardName(p.name)}` === decoded) ??
    null
  if (!printing) return null

  // 2. Oracle card
  const { data: oracle, error: oErr } = await supabase
    .from('mtg_oracle_cards')
    .select('id, oracle_id, name, mana_cost, mana_value, type_line, oracle_text, power, toughness, loyalty, defense, colors, color_identity, keywords, layout, card_faces, produced_mana, reserved, game_changer, capabilities')
    .eq('id', printing.oracle_card_id)
    .maybeSingle()
  if (oErr || !oracle) {
    console.error('getCardBySlug oracle error:', oErr)
    return null
  }

  // 3. Finishes for this printing
  const { data: finishes } = await supabase
    .from('mtg_printing_finishes')
    .select('id, finish')
    .eq('printing_id', printing.id)
    .order('finish')

  // 4. Legalities (Oracle-level)
  const { data: legalities } = await supabase
    .from('mtg_oracle_legalities')
    .select('format, legality')
    .eq('oracle_card_id', oracle.id)

  // 5. Rulings (small; a few dozen rows max)
  const { data: rulings } = await supabase
    .from('mtg_rulings')
    .select('source, published_at, comment')
    .eq('oracle_card_id', oracle.id)
    .order('published_at', { ascending: false })
    .limit(50)

  // 6. Other printings of the same oracle
  const { data: others } = await supabase
    .from('mtg_printings')
    .select(`
      id, oracle_card_id, set_id, scryfall_id, set_code, collector_number, lang, name,
      layout, rarity, artist, image_uri, image_uri_small, art_crop_uri, released_at,
      borderless, full_art, promo, digital, scryfall_uri, reprint, textless, variation
    `)
    .eq('oracle_card_id', oracle.id)
    .eq('lang', 'en')
    .neq('id', printing.id)
    .order('released_at', { ascending: false })
    .limit(40)

  return {
    printing: printing as MtgPrinting,
    oracle: oracle as MtgOracleCard,
    finishes: (finishes ?? []) as MtgFinish[],
    legalities: (legalities ?? []) as MtgLegality[],
    rulings: (rulings ?? []) as MtgRuling[],
    otherPrintings: ((others ?? []) as MtgPrinting[]),
  }
}

const MTG_PRINTING_SELECT = `
  id, oracle_card_id, set_id, scryfall_id, set_code, collector_number, lang, name,
  layout, rarity, artist, image_uri, image_uri_small, art_crop_uri, released_at,
  borderless, full_art, promo, digital, scryfall_uri, reprint, textless, variation
`

/** Strict variant of `getCardBySlug` for cacheable callers.
 *
 *  Semantics:
 *   - genuinely nonexistent card (query succeeds, zero rows, OR no row
 *     slugifies back to the URL) → returns `null`. The caller may call
 *     notFound(). This is the ONLY legitimate null path.
 *   - transient Supabase/network error in any required stage → retried
 *     up to 3 times with 100/200/400ms backoff.
 *   - persistent failure in any required stage → throws. The caller
 *     MUST NOT interpret the throw as "card does not exist"; Next.js
 *     skips caching a thrown render so the next request retries
 *     fresh.
 *
 *  All six internal sub-queries (primary printing, oracle, finishes,
 *  legalities, rulings, other-printings) are strict. Partial section
 *  silence (e.g. losing the Rulings query to a blip) would otherwise
 *  cache a card page with a missing section for the whole revalidate
 *  window. */
export async function getCardBySlugStrict(setCode: string, cardSlug: string): Promise<MtgCardDetail | null> {
  const supabase = getSupabaseServiceClient()
  const set = setCode.trim().toLowerCase()
  // decodeURIComponent throws on malformed input — same semantics as
  // the non-strict path. Malformed slug = 404, not an infra error.
  let decoded: string
  try { decoded = decodeURIComponent(cardSlug) } catch { return null }
  const splits = candidateCardSlugSplits(decoded)
  if (!set || splits.length === 0) return null

  const label = (stage: string) => `getCardBySlugStrict set=${set} slug=${decoded} stage=${stage}`
  const candidates = splits.map((s) => s.collectorNumber)

  // Stage 1 — primary printing by candidate collector number.
  const printings = await runStrictQueryWithRetry<any[]>(
    label('printings'),
    async () => {
      const { data, error } = await supabase
        .from('mtg_printings')
        .select(MTG_PRINTING_SELECT)
        .eq('set_code', set)
        .in('collector_number', candidates)
        .order('lang', { ascending: true })
        .limit(50)
      if (error) return { ok: false, error }
      return { ok: true, value: (data ?? []) as any[] }
    },
  )

  // Strict slug match — a legitimate miss (zero rows, or no row's name
  // slugifies back to the URL) → 404. This is NOT an infra failure.
  const printing =
    printings.find((p: any) => p.lang === 'en' && `${p.collector_number}-${slugifyCardName(p.name)}` === decoded) ??
    printings.find((p: any) => `${p.collector_number}-${slugifyCardName(p.name)}` === decoded) ??
    null
  if (!printing) return null

  // Stages 2-6 fire in parallel — all strict.
  const [oracleRow, finishes, legalities, rulings, others] = await Promise.all([
    runStrictQueryWithRetry<any | null>(
      label('oracle'),
      async () => {
        const { data, error } = await supabase
          .from('mtg_oracle_cards')
          .select('id, oracle_id, name, mana_cost, mana_value, type_line, oracle_text, power, toughness, loyalty, defense, colors, color_identity, keywords, layout, card_faces, produced_mana, reserved, game_changer, capabilities')
          .eq('id', printing.oracle_card_id)
          .maybeSingle()
        if (error) return { ok: false, error }
        return { ok: true, value: data }
      },
    ),
    runStrictQueryWithRetry<any[]>(
      label('finishes'),
      async () => {
        const { data, error } = await supabase
          .from('mtg_printing_finishes')
          .select('id, finish')
          .eq('printing_id', printing.id)
          .order('finish')
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
    runStrictQueryWithRetry<any[]>(
      label('legalities'),
      async () => {
        const { data, error } = await supabase
          .from('mtg_oracle_legalities')
          .select('format, legality')
          .eq('oracle_card_id', printing.oracle_card_id)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
    runStrictQueryWithRetry<any[]>(
      label('rulings'),
      async () => {
        const { data, error } = await supabase
          .from('mtg_rulings')
          .select('source, published_at, comment')
          .eq('oracle_card_id', printing.oracle_card_id)
          .order('published_at', { ascending: false })
          .limit(50)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
    runStrictQueryWithRetry<any[]>(
      label('other-printings'),
      async () => {
        const { data, error } = await supabase
          .from('mtg_printings')
          .select(MTG_PRINTING_SELECT)
          .eq('oracle_card_id', printing.oracle_card_id)
          .eq('lang', 'en')
          .neq('id', printing.id)
          .order('released_at', { ascending: false })
          .limit(40)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
  ])

  // Missing oracle row for a found printing is a data-integrity edge,
  // not an infra failure — treat as 404 like the non-strict variant.
  if (!oracleRow) return null

  return {
    printing: printing as MtgPrinting,
    oracle: oracleRow as MtgOracleCard,
    finishes: finishes as MtgFinish[],
    legalities: legalities as MtgLegality[],
    rulings: rulings as MtgRuling[],
    otherPrintings: others as MtgPrinting[],
  }
}

// ─── Search ─────────────────────────────────────────────────────────────

export type MtgSearchHit = {
  printing_id: string
  oracle_card_id: string
  set_code: string
  collector_number: string | null
  name: string
  image_uri_small: string | null
  rarity: string | null
  type_line: string | null
  mana_cost: string | null
  colors: string[] | null
  released_at: string | null
}

export type MtgSearchFilters = {
  /** Substring match on oracle name (case-insensitive). Blank = any. */
  name?: string
  /** Substring match on type_line (case-insensitive). Blank = any. */
  type?: string
  /** Substring match on oracle_text (case-insensitive). Blank = any. */
  text?: string
  /** Match if the card's colors include ANY of these. Blank = any. */
  colors?: string[]
  /** Match if the card's color_identity is a SUBSET of these letters. */
  colorIdentity?: string[]
  /** Include colourless as "C", the field literally checks `colors=[]`. */
  colorless?: boolean
  /** Include only cards legal in this format. */
  legalIn?: string
  /** Rarity of the returned printing (applied to mtg_printings). */
  rarity?: string
}

/** Multi-filter card search. Name is optional, pass filters alone and
 *  you get an arbitrary slice of the DB matching the constraints. */
export async function searchCards(
  filters: MtgSearchFilters,
  limit = 60,
): Promise<MtgSearchHit[]> {
  const supabase = getSupabaseServiceClient()
  const name = (filters.name ?? '').trim()
  const type = (filters.type ?? '').trim()
  const text = (filters.text ?? '').trim()
  const colors = (filters.colors ?? []).filter((c) => 'WUBRG'.includes(c.toUpperCase())).map((c) => c.toUpperCase())
  const colorId = (filters.colorIdentity ?? []).filter((c) => 'WUBRG'.includes(c.toUpperCase())).map((c) => c.toUpperCase())
  const legalIn = (filters.legalIn ?? '').trim()
  const rarity = (filters.rarity ?? '').trim()
  const anyFilter = name.length >= 2 || type.length >= 2 || text.length >= 2 || colors.length > 0 || colorId.length > 0 || legalIn.length > 0 || rarity.length > 0 || filters.colorless
  if (!anyFilter) return []

  // Step 1, apply oracle-level filters.
  let oraclesQ = supabase
    .from('mtg_oracle_cards')
    .select('id, name, type_line, mana_cost, colors')
    .limit(300)   // upper bound before we page through
  if (name.length >= 2)  oraclesQ = oraclesQ.ilike('name', `%${name}%`)
  if (type.length >= 2)  oraclesQ = oraclesQ.ilike('type_line', `%${type}%`)
  if (text.length >= 2)  oraclesQ = oraclesQ.ilike('oracle_text', `%${text}%`)
  if (colors.length > 0) oraclesQ = oraclesQ.overlaps('colors', colors)
  if (filters.colorless) oraclesQ = oraclesQ.eq('colors', '{}')
  if (colorId.length > 0) oraclesQ = oraclesQ.containedBy('color_identity', colorId)
  const { data: oracles, error: oErr } = await oraclesQ
  if (oErr || !oracles || oracles.length === 0) {
    if (oErr) console.error('searchCards oracle error:', oErr)
    return []
  }
  let oracleIds: string[] = oracles.map((o: any) => o.id)

  // Step 2, narrow by format legality if requested.
  if (legalIn.length > 0) {
    const { data: legals } = await supabase
      .from('mtg_oracle_legalities')
      .select('oracle_card_id')
      .in('oracle_card_id', oracleIds)
      .eq('format', legalIn)
      .eq('legality', 'legal')
    const kept = new Set<string>((legals ?? []).map((r: any) => r.oracle_card_id))
    oracleIds = oracleIds.filter((id) => kept.has(id))
    if (oracleIds.length === 0) return []
  }

  // Step 3, fetch printings for the surviving oracles.
  let printingsQ = supabase
    .from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, name, image_uri_small, rarity, released_at')
    .in('oracle_card_id', oracleIds)
    .eq('lang', 'en')
    .eq('digital', false)
    .order('released_at', { ascending: false, nullsFirst: false })
  if (rarity.length > 0) printingsQ = printingsQ.eq('rarity', rarity)
  const { data: printings, error: pErr } = await printingsQ
  if (pErr) {
    console.error('searchCards printing error:', pErr)
    return []
  }

  // Freshest printing per oracle.
  const seen = new Set<string>()
  const oracleById = new Map<string, any>(oracles.map((o: any) => [o.id, o]))
  const hits: MtgSearchHit[] = []
  for (const p of printings ?? []) {
    if (seen.has(p.oracle_card_id)) continue
    seen.add(p.oracle_card_id)
    const o = oracleById.get(p.oracle_card_id)
    hits.push({
      printing_id: p.id,
      oracle_card_id: p.oracle_card_id,
      set_code: p.set_code,
      collector_number: p.collector_number,
      name: p.name,
      image_uri_small: p.image_uri_small,
      rarity: p.rarity,
      type_line: o?.type_line ?? null,
      mana_cost: o?.mana_cost ?? null,
      colors: o?.colors ?? null,
      released_at: p.released_at,
    })
    if (hits.length >= limit) break
  }
  return hits
}
