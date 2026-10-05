// src/lib/mtg/formats.ts
// Server-only DB helpers for MTG formats. Pure data + types live in
// ./formats.data.ts so client components can import the format list
// without pulling in the service-role client.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export { FORMATS, FORMAT_GROUPS, FORMAT_BY_KEY, type FormatDef, type FormatKey } from './formats.data'
import type { FormatKey } from './formats.data'

export type FormatCounts = { legal: number; banned: number; restricted: number }

// ─── Retry helper for strict variants ──────────────────────────────
// Shared by getFormatCountsStrict + getFormatSpotlightStrict so the
// backoff / throw / log contract is identical across every stage.

const MAX_FORMAT_ATTEMPTS = 3
const FORMAT_BACKOFF_MS = [100, 200, 400] as const

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type QueryAttempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** Run a Supabase query with retry + throw-on-persistent-failure.
 *  `runQuery` is called afresh on each attempt. It must resolve to
 *  { ok: true, value } on success or { ok: false, error } on a
 *  retryable failure. A thrown exception also counts as a retryable
 *  failure. */
async function runFormatQueryWithRetry<T>(
  label: string,
  runQuery: () => Promise<QueryAttempt<T>>,
): Promise<T> {
  const errorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message
    if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
    return String(e)
  }
  let lastError: unknown = null
  for (let attempt = 1; attempt <= MAX_FORMAT_ATTEMPTS; attempt++) {
    try {
      const r = await runQuery()
      if (r.ok) {
        return r.value
      }
      // TypeScript's control-flow narrowing on this discriminated
      // union is flaky under this project's `strict: false` tsconfig,
      // so pull `error` through an explicit cast rather than relying
      // on the else-branch inference.
      const err = (r as { ok: false; error: unknown }).error
      lastError = err
      console.warn(`[${label}] attempt=${attempt}/${MAX_FORMAT_ATTEMPTS} error: ${errorMessage(err)}`)
    } catch (e) {
      lastError = e
      console.warn(`[${label}] attempt=${attempt}/${MAX_FORMAT_ATTEMPTS} threw: ${errorMessage(e)}`)
    }
    if (attempt < MAX_FORMAT_ATTEMPTS) await sleep(FORMAT_BACKOFF_MS[attempt - 1])
  }
  throw new Error(`${label}: failed after ${MAX_FORMAT_ATTEMPTS} attempts: ${errorMessage(lastError)}`)
}

/** Per-format counts used on the /formats index. Cheap, three
 *  head-count queries per format.
 *
 *  FAIL-CLOSED: coerces any Supabase error to count=0 for that bucket.
 *  Safe for callers that treat a missing-count tile as a degraded
 *  display. **Do NOT use from a route that participates in Full Route
 *  Cache / ISR** — a transient DB blip would cache a "0 Banned" tile
 *  for formats with real bans. Use `getFormatCountsStrict` on
 *  cacheable routes. */
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

/** Small preview list of banned/restricted cards for the format page.
 *
 *  FAIL-CLOSED: silently returns [] (or a partial list) on any
 *  Supabase/network error. Safe for callers that treat an empty list
 *  as a degraded display. **Do NOT use from a route that participates
 *  in Full Route Cache / ISR** — a transient DB blip would cache a
 *  "No cards are currently banned in {Format}" lie for 24 h. Use
 *  `getFormatSpotlightStrict` on cacheable routes. */
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

// ─── Strict variants for cacheable callers ─────────────────────────
// Mirrors the fail-closed functions above but retries transient
// failures and throws on persistent failure. Next.js skips caching a
// thrown render, so a transient Supabase blip during ISR regeneration
// no longer gets memorialised as "0 Banned" or "No cards are
// currently banned in …" for the entire revalidate window.

/** Strict variant of `getFormatCounts`. Retries each of the three
 *  head-count queries up to 3 times with bounded backoff and throws
 *  if any still fails. A genuine `count = 0` on a successful query
 *  is a legitimate zero (and is returned as such). */
export async function getFormatCountsStrict(key: FormatKey): Promise<FormatCounts> {
  const supabase = getSupabaseServiceClient()
  const countFor = (legality: 'legal' | 'banned' | 'restricted') =>
    runFormatQueryWithRetry<number>(`getFormatCountsStrict format=${key} legality=${legality}`, async () => {
      const { count, error } = await supabase
        .from('mtg_oracle_legalities')
        .select('*', { count: 'exact', head: true })
        .eq('format', key)
        .eq('legality', legality)
      if (error) return { ok: false, error }
      // count === null on a successful head-count is Supabase's way of
      // saying "I could not compute an exact count" — treat it as a
      // retryable failure rather than silently returning 0.
      if (count === null || count === undefined) {
        return { ok: false, error: new Error('head-count returned null count without error') }
      }
      return { ok: true, value: count }
    })
  const [legal, banned, restricted] = await Promise.all([
    countFor('legal'),
    countFor('banned'),
    countFor('restricted'),
  ])
  return { legal, banned, restricted }
}

/** Strict variant of `getFormatSpotlight`. Each of the three stages
 *  (legalities lookup, oracle lookup, printing lookup) is retried
 *  independently; a persistent failure in any required stage throws.
 *  A legitimate zero legalities result returns `[]` without firing
 *  the oracle or printing stages. */
export async function getFormatSpotlightStrict(
  key: FormatKey,
  legality: 'banned' | 'restricted',
  limit = 40,
): Promise<FormatCardHit[]> {
  const supabase = getSupabaseServiceClient()
  const label = `getFormatSpotlightStrict format=${key} legality=${legality}`

  // Stage 1 — legalities for this format × legality bucket.
  const legals = await runFormatQueryWithRetry<Array<{ oracle_card_id: string; legality: string }>>(
    `${label} stage=legalities`,
    async () => {
      const { data, error } = await supabase
        .from('mtg_oracle_legalities')
        .select('oracle_card_id, legality')
        .eq('format', key)
        .eq('legality', legality)
        .limit(limit)
      if (error) return { ok: false, error }
      return { ok: true, value: (data ?? []) as Array<{ oracle_card_id: string; legality: string }> }
    },
  )
  if (legals.length === 0) return []
  const oracleIds = legals.map((r) => r.oracle_card_id)

  // Stage 2 + 3 — oracle lookup and printing lookup in parallel.
  const [oracles, prints] = await Promise.all([
    runFormatQueryWithRetry<Array<{ id: string; name: string; type_line: string | null; mana_cost: string | null; colors: string[] | null }>>(
      `${label} stage=oracles`,
      async () => {
        const { data, error } = await supabase
          .from('mtg_oracle_cards')
          .select('id, name, type_line, mana_cost, colors')
          .in('id', oracleIds)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
    runFormatQueryWithRetry<Array<{ oracle_card_id: string; set_code: string; collector_number: string | null; image_uri_small: string | null; released_at: string | null }>>(
      `${label} stage=prints`,
      async () => {
        const { data, error } = await supabase
          .from('mtg_printings')
          .select('oracle_card_id, set_code, collector_number, image_uri_small, released_at')
          .in('oracle_card_id', oracleIds)
          .eq('lang', 'en')
          .eq('digital', false)
          .order('released_at', { ascending: false, nullsFirst: false })
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any[] }
      },
    ),
  ])

  const oracleById = new Map(oracles.map((o) => [o.id, o]))
  const printByOracle = new Map<string, any>()
  for (const p of prints) {
    if (printByOracle.has(p.oracle_card_id)) continue  // keep freshest (data is ordered desc)
    printByOracle.set(p.oracle_card_id, p)
  }

  const hits: FormatCardHit[] = []
  for (const r of legals) {
    const o = oracleById.get(r.oracle_card_id)
    if (!o) continue  // dangling FK — real data integrity edge, not a transient failure
    const p = printByOracle.get(r.oracle_card_id)
    hits.push({
      oracle_card_id: o.id,
      name: o.name,
      type_line: o.type_line,
      mana_cost: o.mana_cost,
      colors: o.colors,
      legality: r.legality,
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
