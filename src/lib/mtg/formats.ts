// src/lib/mtg/formats.ts
// Canonical MTG format list — mirrored to what is actually populated in
// mtg_oracle_legalities. Grouped for display and used by the /formats
// area, card page legality matrix and search filters.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export type FormatKey =
  | 'standard'
  | 'pioneer'
  | 'modern'
  | 'legacy'
  | 'vintage'
  | 'commander'
  | 'pauper'
  | 'historic'
  | 'timeless'
  | 'brawl'
  | 'standardbrawl'
  | 'alchemy'
  | 'oathbreaker'
  | 'premodern'
  | 'penny'
  | 'gladiator'
  | 'oldschool'
  | 'predh'
  | 'future'
  | 'duel'

export type FormatDef = {
  key: FormatKey
  label: string
  group: 'Primary' | 'Eternal' | 'Digital' | 'Casual' | 'Historical'
  blurb: string
}

/** Presentation-facing format list — ordered inside each group. Only
 *  formats that we know exist in `mtg_oracle_legalities`. */
export const FORMATS: FormatDef[] = [
  { key: 'standard',      label: 'Standard',        group: 'Primary',    blurb: 'Rotating format built around the newest sets. WOTC ban list applies.' },
  { key: 'pioneer',       label: 'Pioneer',         group: 'Primary',    blurb: 'Non-rotating format from Return to Ravnica forward. No fetchlands.' },
  { key: 'modern',        label: 'Modern',          group: 'Primary',    blurb: 'Non-rotating format from 8th Edition forward.' },

  { key: 'legacy',        label: 'Legacy',          group: 'Eternal',    blurb: 'Deep card pool. Ban list, no restrictions.' },
  { key: 'vintage',       label: 'Vintage',         group: 'Eternal',    blurb: 'Nearly every card is legal. Uses a restricted list.' },
  { key: 'pauper',        label: 'Pauper',          group: 'Eternal',    blurb: 'Commons only — every card must have been printed at common somewhere.' },

  { key: 'commander',     label: 'Commander',       group: 'Casual',     blurb: '100-card singleton around a legendary commander.' },
  { key: 'oathbreaker',   label: 'Oathbreaker',     group: 'Casual',     blurb: '60-card singleton around a planeswalker + signature spell.' },
  { key: 'brawl',         label: 'Brawl',           group: 'Casual',     blurb: 'Standard-legal singleton with a legendary commander. Historic pool on Arena.' },
  { key: 'standardbrawl', label: 'Standard Brawl',  group: 'Casual',     blurb: 'Brawl restricted to Standard-legal cards.' },

  { key: 'historic',      label: 'Historic',        group: 'Digital',    blurb: 'MTG Arena non-rotating format. Includes Arena-only cards.' },
  { key: 'timeless',      label: 'Timeless',        group: 'Digital',    blurb: 'MTG Arena eternal format. Broadest legal pool on Arena.' },
  { key: 'alchemy',       label: 'Alchemy',         group: 'Digital',    blurb: 'MTG Arena format with digital-only rebalances.' },
  { key: 'gladiator',     label: 'Gladiator',       group: 'Digital',    blurb: 'MTG Arena Historic singleton. 100-card, no commander.' },
  { key: 'penny',         label: 'Penny Dreadful',  group: 'Digital',    blurb: 'Only cards under a small price ceiling are legal.' },

  { key: 'premodern',     label: 'Premodern',       group: 'Historical', blurb: '4th Edition through Scourge. Community-run.' },
  { key: 'oldschool',     label: 'Old School',      group: 'Historical', blurb: 'Very early cardpool — Alpha through Fallen Empires-era.' },
  { key: 'predh',         label: 'PreDH',           group: 'Historical', blurb: 'Commander using pre-2011 cards only.' },
  { key: 'future',        label: 'Future Standard', group: 'Historical', blurb: 'What Standard will look like once the current block rotates in.' },
  { key: 'duel',          label: 'Duel Commander', group: 'Historical', blurb: '1v1 Commander variant with its own ban list.' },
]

export const FORMAT_GROUPS: FormatDef['group'][] = ['Primary', 'Eternal', 'Casual', 'Digital', 'Historical']

/** Format key → definition. */
export const FORMAT_BY_KEY: Record<string, FormatDef> = Object.fromEntries(FORMATS.map((f) => [f.key, f]))

export type FormatCounts = { legal: number; banned: number; restricted: number }

/** Per-format counts used on the /formats index. Cheap — three
 *  head-count queries per format. */
export async function getFormatCounts(key: FormatKey): Promise<FormatCounts> {
  const supabase = getSupabaseServiceClient()
  const [legal, banned, restricted] = await Promise.all([
    supabase.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', key).eq('legality', 'legal'),
    supabase.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', key).eq('legality', 'banned'),
    supabase.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', key).eq('legality', 'restricted'),
  ])
  return {
    legal: legal.count ?? 0,
    banned: banned.count ?? 0,
    restricted: restricted.count ?? 0,
  }
}

export type FormatCardHit = {
  oracle_card_id: string
  name: string
  type_line: string | null
  mana_cost: string | null
  colors: string[] | null
  legality: string
  freshest_printing: {
    set_code: string
    collector_number: string | null
    image_uri_small: string | null
    released_at: string | null
  } | null
}

/** Small preview list of banned/restricted cards for the format page. */
export async function getFormatSpotlight(key: FormatKey, legality: 'banned' | 'restricted', limit = 40): Promise<FormatCardHit[]> {
  const supabase = getSupabaseServiceClient()
  const { data: legals } = await supabase
    .from('mtg_oracle_legalities')
    .select('oracle_card_id, legality')
    .eq('format', key)
    .eq('legality', legality)
    .limit(limit)
  if (!legals || legals.length === 0) return []

  const oracleIds = legals.map((r: any) => r.oracle_card_id)
  const { data: oracles } = await supabase
    .from('mtg_oracle_cards')
    .select('id, name, type_line, mana_cost, colors')
    .in('id', oracleIds)
  const oracleById = new Map<string, any>()
  for (const o of oracles ?? []) oracleById.set((o as any).id, o)

  const { data: prints } = await supabase
    .from('mtg_printings')
    .select('oracle_card_id, set_code, collector_number, image_uri_small, released_at')
    .in('oracle_card_id', oracleIds)
    .eq('lang', 'en')
    .eq('digital', false)
    .order('released_at', { ascending: false, nullsFirst: false })
  const seen = new Set<string>()
  const printByOracle = new Map<string, any>()
  for (const p of prints ?? []) {
    if (seen.has((p as any).oracle_card_id)) continue
    seen.add((p as any).oracle_card_id)
    printByOracle.set((p as any).oracle_card_id, p)
  }

  const hits: FormatCardHit[] = []
  for (const r of legals) {
    const o = oracleById.get((r as any).oracle_card_id)
    if (!o) continue
    const p = printByOracle.get((r as any).oracle_card_id)
    hits.push({
      oracle_card_id: o.id,
      name: o.name,
      type_line: o.type_line,
      mana_cost: o.mana_cost,
      colors: o.colors,
      legality: (r as any).legality,
      freshest_printing: p
        ? {
            set_code: p.set_code,
            collector_number: p.collector_number,
            image_uri_small: p.image_uri_small,
            released_at: p.released_at,
          }
        : null,
    })
  }
  return hits
}
