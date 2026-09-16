// src/lib/mtg/cards.ts
// Server-only MTG card + printing queries. Every read goes through the
// service-role client because the price tables are RLS-gated and we
// want a single uniform API for MTG data.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

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

/** All English printings in a given set, ordered by collector number. */
export async function listPrintingsForSet(setCode: string, opts: { includeDigital?: boolean } = {}): Promise<MtgSetCard[]> {
  const supabase = getSupabaseServiceClient()
  const normalised = setCode.trim().toLowerCase()
  if (!normalised) return []

  let q = supabase
    .from('mtg_printings')
    .select(`
      id, oracle_card_id, set_id, scryfall_id, set_code, collector_number, lang, name,
      layout, rarity, artist, image_uri, image_uri_small, art_crop_uri, released_at,
      borderless, full_art, promo, digital, scryfall_uri, reprint, textless, variation,
      oracle:mtg_oracle_cards ( name, type_line, mana_cost, colors )
    `)
    .eq('set_code', normalised)
    .eq('lang', 'en')
    .order('collector_number', { ascending: true })
    .limit(3000)

  if (!opts.includeDigital) q = q.eq('digital', false)

  const { data, error } = await q
  if (error) {
    console.error('listPrintingsForSet error:', error)
    return []
  }
  return (data ?? []).map((r: any) => ({
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
  }))
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

export async function getCardBySlug(setCode: string, cardSlug: string): Promise<MtgCardDetail | null> {
  const supabase = getSupabaseServiceClient()
  const set = setCode.trim().toLowerCase()
  const splits = candidateCardSlugSplits(cardSlug)
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
  const printing =
    rows.find((p: any) => p.lang === 'en' && `${p.collector_number}-${slugifyCardName(p.name)}` === cardSlug) ??
    rows.find((p: any) => `${p.collector_number}-${slugifyCardName(p.name)}` === cardSlug) ??
    rows.find((p: any) => p.lang === 'en') ??
    rows[0]
  if (!printing) return null

  // 2. Oracle card
  const { data: oracle, error: oErr } = await supabase
    .from('mtg_oracle_cards')
    .select('id, oracle_id, name, mana_cost, mana_value, type_line, oracle_text, power, toughness, loyalty, defense, colors, color_identity, keywords, layout, card_faces, produced_mana, reserved, game_changer')
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
  /** Include colourless as "C" — the field literally checks `colors=[]`. */
  colorless?: boolean
  /** Include only cards legal in this format. */
  legalIn?: string
  /** Rarity of the returned printing (applied to mtg_printings). */
  rarity?: string
}

/** Multi-filter card search. Name is optional — pass filters alone and
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

  // Step 1 — apply oracle-level filters.
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

  // Step 2 — narrow by format legality if requested.
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

  // Step 3 — fetch printings for the surviving oracles.
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
