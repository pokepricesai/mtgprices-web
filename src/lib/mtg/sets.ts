// src/lib/mtg/sets.ts
// Server-only MTG set queries. Uses the service-role Supabase client
// because mtg_current_prices / mtg_price_observations are RLS-gated to
// service_role, and colocating all MTG catalogue reads under the same
// client keeps the API surface uniform.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export type MtgSet = {
  id: string
  code: string             // lowercase Scryfall set code, e.g. 'mkm'
  name: string
  set_type: string | null  // 'expansion' | 'core' | 'commander' | 'draft_innovation' | 'masters' | …
  released_at: string | null // ISO date (yyyy-mm-dd)
  card_count: number | null
  parent_set_code: string | null
  block: string | null
  digital: boolean | null
  foil_only: boolean | null
  nonfoil_only: boolean | null
  icon_svg_uri: string | null
}

/** Types considered "public-catalogue" for the browse page.
 *  Excludes tokens, memorabilia, minigames, funny sets, art series. */
const PUBLIC_SET_TYPES = new Set([
  'core',
  'expansion',
  'commander',
  'draft_innovation',
  'masters',
  'masterpiece',
  'starter',
  'planechase',
  'archenemy',
  'from_the_vault',
  'premium_deck',
  'duel_deck',
  'spellbook',
  'promo',
])

export async function listSets(opts: {
  limit?: number
  includeDigital?: boolean
  includeNonPublicTypes?: boolean
  /** ISO yyyy-mm-dd. Exclude sets released after this date. Use for
   *  homepage "Latest set" / "Recently released" tiles so future
   *  spoiler-only sets don't get labelled as if they already exist. */
  releasedBy?: string
} = {}): Promise<MtgSet[]> {
  const supabase = getSupabaseServiceClient()
  const {
    limit = 200,
    includeDigital = false,
    includeNonPublicTypes = false,
    releasedBy,
  } = opts

  let q = supabase
    .from('mtg_sets')
    .select(
      'id, code, name, set_type, released_at, card_count, parent_set_code, block, digital, foil_only, nonfoil_only, icon_svg_uri'
    )
    .order('released_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (!includeDigital) q = q.eq('digital', false)
  if (releasedBy) q = q.lte('released_at', releasedBy)

  const { data, error } = await q
  if (error) {
    console.error('listSets error:', error)
    return []
  }
  const rows = (data ?? []) as MtgSet[]
  if (includeNonPublicTypes) return rows
  return rows.filter((s) => !s.set_type || PUBLIC_SET_TYPES.has(s.set_type))
}

/** Sets whose release date is strictly in the future. Used to power
 *  a small "Upcoming sets" section without confusing the "latest" or
 *  "recently released" surfaces. Same public-type / non-digital
 *  filter as listSets(). */
export async function listUpcomingSets(opts: {
  limit?: number
  afterDate?: string
} = {}): Promise<MtgSet[]> {
  const supabase = getSupabaseServiceClient()
  const { limit = 6, afterDate = todayIso() } = opts
  const { data, error } = await supabase
    .from('mtg_sets')
    .select(
      'id, code, name, set_type, released_at, card_count, parent_set_code, block, digital, foil_only, nonfoil_only, icon_svg_uri'
    )
    .eq('digital', false)
    .gt('released_at', afterDate)
    .order('released_at', { ascending: true, nullsFirst: false })
    .limit(limit * 4)
  if (error) { console.error('listUpcomingSets error:', error); return [] }
  return ((data ?? []) as MtgSet[])
    .filter((s) => !s.set_type || PUBLIC_SET_TYPES.has(s.set_type))
    .slice(0, limit)
}

/** Count of sets exposed on /browse (matches the sitemap
 *  sitemap-sets.xml inventory). Non-digital + public-type. */
export async function countPublicSets(): Promise<number> {
  const supabase = getSupabaseServiceClient()
  // set_type filter is done client-side to stay consistent with
  // listSets. mtg_sets has <1500 rows so the small over-fetch is
  // cheap and lets both surfaces share the exact same
  // PUBLIC_SET_TYPES definition.
  const { data, error } = await supabase
    .from('mtg_sets')
    .select('set_type', { count: 'exact' })
    .eq('digital', false)
  if (error) { console.error('countPublicSets error:', error); return 0 }
  return ((data ?? []) as { set_type: string | null }[])
    .filter((s) => !s.set_type || PUBLIC_SET_TYPES.has(s.set_type))
    .length
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function getSetByCode(code: string): Promise<MtgSet | null> {
  const supabase = getSupabaseServiceClient()
  const normalised = code.trim().toLowerCase()
  if (!normalised) return null
  const { data, error } = await supabase
    .from('mtg_sets')
    .select(
      'id, code, name, set_type, released_at, card_count, parent_set_code, block, digital, foil_only, nonfoil_only, icon_svg_uri'
    )
    .eq('code', normalised)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getSetByCode error:', error)
    return null
  }
  return (data ?? null) as MtgSet | null
}
