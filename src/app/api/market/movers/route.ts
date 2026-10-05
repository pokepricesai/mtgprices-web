// src/app/api/market/movers/route.ts
//
// Cached JSON endpoint for the /market page's client-side window
// switcher. The /market server page is static ISR and only renders
// the 30-day default on-server; when a user clicks the 7d or 90d
// pill (or lands directly on `/market?window=7|90`), the client
// island fetches the alternate window from here instead of forcing
// a full dynamic server render.
//
// Response caching: successful responses carry
//   Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate
// which lets Vercel's edge CDN cache the response for 24h and serve
// stale-while-revalidate up to a week while a fresh render warms. The
// edge treats each distinct ?window value as its own cache entry.
//
// Malformed / unsupported `window` values are rejected with 400 +
// no-store so they cannot create arbitrary cache variants.
// Infrastructure errors from the strict helper surface as 500 +
// no-store so the CDN never pins a failure as a valid mover payload.

import { NextResponse } from 'next/server'
import { getMarketMoversStrict, type MoverWindow } from '@/lib/mtg/movers'

const VALID_WINDOWS: readonly MoverWindow[] = [7, 30, 90] as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'

function parseWindow(raw: string | null): MoverWindow | null {
  if (raw === '7' || raw === '7d') return 7
  if (raw === '30' || raw === '30d') return 30
  if (raw === '90' || raw === '90d') return 90
  return null
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const windowDays = parseWindow(url.searchParams.get('window'))

  // Reject anything outside the whitelisted set so random query
  // strings can't fan out into unique CDN cache entries.
  if (windowDays === null) {
    return NextResponse.json(
      { error: 'invalid window', allowed: VALID_WINDOWS },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const movers = await getMarketMoversStrict({ windowDays, topN: 10 })
    return NextResponse.json(
      { movers, windowDays },
      { status: 200, headers: { 'Cache-Control': SUCCESS_CACHE_CONTROL } },
    )
  } catch (e) {
    // Strict helper threw after retries. Surface 500 with no-store so
    // the CDN cannot memorialise a transient failure as a valid
    // mover-null payload. The specific error message intentionally
    // stays server-side only — the client receives a stable shape.
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[/api/market/movers] window=${windowDays} failed: ${msg}`)
    return NextResponse.json(
      { error: 'internal' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
