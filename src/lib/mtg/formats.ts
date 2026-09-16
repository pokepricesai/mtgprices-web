// src/lib/mtg/formats.ts
// Server-only DB helpers for MTG formats. Pure data + types live in
// ./formats.data.ts so client components can import the format list
// without pulling in the service-role client.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export { FORMATS, FORMAT_GROUPS, FORMAT_BY_KEY, type FormatDef, type FormatKey } from './formats.data'
import type { FormatKey } from './formats.data'

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
