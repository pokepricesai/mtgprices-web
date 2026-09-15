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
}

export type MtgFinish = {
  id: string           // printing_finish id (used by prices)
  finish: string       // 'nonfoil' | 'foil' | 'etched'
}

export type MtgLegality = { format: string; legality: string }
export type MtgRuling  = { source: string; published_at: string | null; comment: string }

/** Convert "Massacre Girl, Known Killer" → "massacre-girl-known-killer". */
export function slugifyCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** URL slug format: "{collector_number}-{card-name-slug}".
 *  Splits on the first "-" after the leading collector-number segment. */
export function parseCardSlug(slug: string): { collectorNumber: string; nameSlug: string } | null {
  if (!slug) return null
  const m = slug.match(/^([^-\s]+)(?:-(.+))?$/)
  if (!m) return null
  return { collectorNumber: m[1], nameSlug: m[2] ?? '' }
}

export function buildCardSlug(collectorNumber: string, cardName: string): string {
  return `${collectorNumber}-${slugifyCardName(cardName)}`
}

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
      borderless, full_art, promo, digital, scryfall_uri,
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
  const parsed = parseCardSlug(cardSlug)
  if (!set || !parsed) return null

  // 1. Printing lookup by (set_code, collector_number). English preferred.
  const { data: printings, error: pErr } = await supabase
    .from('mtg_printings')
    .select(`
      id, oracle_card_id, set_id, scryfall_id, set_code, collector_number, lang, name,
      layout, rarity, artist, image_uri, image_uri_small, art_crop_uri, released_at,
      borderless, full_art, promo, digital, scryfall_uri
    `)
    .eq('set_code', set)
    .eq('collector_number', parsed.collectorNumber)
    .order('lang', { ascending: true })   // 'en' comes before other langs alphabetically
    .limit(5)
  if (pErr) {
    console.error('getCardBySlug printing error:', pErr)
    return null
  }
  const printing = (printings ?? []).find((p: any) => p.lang === 'en') ?? printings?.[0]
  if (!printing) return null

  // 2. Oracle card
  const { data: oracle, error: oErr } = await supabase
    .from('mtg_oracle_cards')
    .select('id, oracle_id, name, mana_cost, mana_value, type_line, oracle_text, power, toughness, loyalty, defense, colors, color_identity, keywords, layout, card_faces')
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
      borderless, full_art, promo, digital, scryfall_uri
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

/** Simple name-search. English printings only. Returns the freshest
 *  printing per oracle_card_id to avoid drowning the results in reprints. */
export async function searchCards(query: string, limit = 40): Promise<MtgSearchHit[]> {
  const supabase = getSupabaseServiceClient()
  const q = query.trim()
  if (q.length < 2) return []

  // ilike over mtg_oracle_cards.name — Scryfall convention is exact name;
  // ilike gives us forgiving substring matching.
  const { data: oracles, error: oErr } = await supabase
    .from('mtg_oracle_cards')
    .select('id, name, type_line, mana_cost, colors')
    .ilike('name', `%${q}%`)
    .limit(limit * 2)
  if (oErr || !oracles || oracles.length === 0) {
    if (oErr) console.error('searchCards oracle error:', oErr)
    return []
  }

  const oracleIds = oracles.map((o: any) => o.id)
  const { data: printings, error: pErr } = await supabase
    .from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, name, image_uri_small, rarity, released_at')
    .in('oracle_card_id', oracleIds)
    .eq('lang', 'en')
    .eq('digital', false)
    .order('released_at', { ascending: false, nullsFirst: false })
  if (pErr) {
    console.error('searchCards printing error:', pErr)
    return []
  }

  // Freshest printing per oracle_card_id
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
