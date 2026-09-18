// src/app/api/geo/route.ts
// Block 2D, country detection endpoint.
//
// Returns the ISO 3166-1 alpha-2 country derived from the Vercel
// x-vercel-ip-country request header. Returns null in local
// development (the header is not set) and in any environment where the
// header is missing.
//
// We use a small route handler (not middleware) so public catalogue
// pages stay statically rendered. Clients fetch this once when they
// have no existing geo cookie, then cache the result.
//
// No IP is logged. No third-party geo provider is contacted. The
// response is cache-control: no-store so each visitor receives their
// own country.

import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(req: Request) {
  const country = req.headers.get('x-vercel-ip-country') || null
  return NextResponse.json(
    { country },
    {
      // Per-visitor result; never cache at the CDN.
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
