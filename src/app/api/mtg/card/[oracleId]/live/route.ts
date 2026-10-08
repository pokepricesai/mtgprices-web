// src/app/api/mtg/card/[oracleId]/live/route.ts
//
// Public, CDN-cached, cookie-free live market payload for the MTG
// card page's client-side refresh island. Serves the price-sensitive
// slice of what /set/[setCode]/card/[cardSlug] renders on the server
// (current finish prices, market summary, graded bundle) so the
// structural page HTML can live on a long-lived ISR TTL while
// user-visible prices refresh independently through this endpoint.
//
// Response caching:
//   Cache-Control: public, max-age=0, s-maxage=21600,
//                  stale-while-revalidate=604800, must-revalidate
// The edge treats each distinct (oracleId, printingId, finishIds)
// variant as its own cache entry. 6h fresh + 7d SWR keeps users
// materially fresher than the 24h whole-page ISR snapshot without
// hammering Supabase per crawler visit.
//
// Failure semantics:
//   Invalid params → 400 + no-store (so random query strings cannot
//                    fan out into unique CDN cache entries).
//   Strict helper threw → 500 + no-store (so the CDN never pins a
//                    transient Supabase blip as a confident empty
//                    response). Legitimate "no priced data" still
//                    returns 200 with marketSummary === null and is
//                    safe to cache — that is a factual answer.
//
// This endpoint intentionally uses the SAME strict helpers the page
// uses on cold ISR regeneration, so page and endpoint stay in sync by
// construction. Note the small duplicate-DB-work overhead:
// getCurrentPricesForFinishesStrict and getCardMarketSummaryStrict
// both read mtg_current_prices (the summary reads a superset across
// all English paper finishes). Keeping both avoids reshaping the
// summary's output; the extra round-trip is cheap at CDN cadence and
// disappears entirely from the hot path (CDN serves 99% of requests).

import { NextResponse } from 'next/server'
import {
  getCurrentPricesForFinishesStrict,
  type MtgCurrentPrice,
} from '@/lib/mtg/prices'
import { getCardMarketSummaryStrict } from '@/lib/mtg/card-market'
import { getTcgBundleForMtgPrintingStrict } from '@/lib/tcggraph/read-model'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=21600, stale-while-revalidate=604800, must-revalidate'
const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Hard upper bound on how many finish IDs a single request may ask
// for. The real catalogue tops out at a handful per printing — this
// is defence in depth against cache-fan-out via long junk query
// strings.
const MAX_FINISH_IDS = 16

type Params = { oracleId: string }

export async function GET(
  request: Request,
  context: { params: Promise<Params> },
): Promise<NextResponse> {
  const { oracleId } = await context.params
  const url = new URL(request.url)
  const printingId = url.searchParams.get('printingId')
  const finishIdsRaw = url.searchParams.get('finishIds')

  if (!oracleId || !UUID_RE.test(oracleId)) {
    return NextResponse.json(
      { error: 'invalid oracleId' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!printingId || !UUID_RE.test(printingId)) {
    return NextResponse.json(
      { error: 'invalid printingId' },
      { status: 400, headers: NO_STORE },
    )
  }

  // finishIds is optional — a client that calls this endpoint without
  // the finishes array (eg a scraper or an alternate consumer) is
  // served after one extra round-trip to look them up. We still
  // bound-check to prevent cache-fan-out abuse.
  let finishIds: string[] | null = null
  if (finishIdsRaw !== null) {
    const parts = finishIdsRaw.split(',').filter(Boolean)
    if (parts.length > MAX_FINISH_IDS || parts.some((id) => !UUID_RE.test(id))) {
      return NextResponse.json(
        { error: 'invalid finishIds' },
        { status: 400, headers: NO_STORE },
      )
    }
    finishIds = parts
  }

  try {
    if (finishIds === null) {
      const sb = getSupabaseServiceClient()
      const { data, error } = await sb
        .from('mtg_printing_finishes')
        .select('id')
        .eq('printing_id', printingId)
      if (error) throw new Error(`finish-lookup: ${error.message}`)
      finishIds = ((data ?? []) as { id: string }[]).map((r) => r.id)
    }

    const [currentByFinish, marketSummary, tcgBundle] = await Promise.all([
      finishIds.length > 0
        ? getCurrentPricesForFinishesStrict(finishIds)
        : Promise.resolve(new Map<string, MtgCurrentPrice[]>()),
      getCardMarketSummaryStrict(oracleId, printingId),
      getTcgBundleForMtgPrintingStrict(printingId),
    ])

    const currentPricesByFinish: Record<string, MtgCurrentPrice[]> = {}
    for (const [k, v] of Array.from(currentByFinish.entries())) currentPricesByFinish[k] = v

    return NextResponse.json(
      {
        oracleId,
        printingId,
        currentPricesByFinish,
        marketSummary,
        tcgBundle,
      },
      { status: 200, headers: { 'Cache-Control': SUCCESS_CACHE_CONTROL } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(
      `[/api/mtg/card/${oracleId}/live] printingId=${printingId} failed: ${msg}`,
    )
    return NextResponse.json(
      { error: 'internal' },
      { status: 500, headers: NO_STORE },
    )
  }
}
