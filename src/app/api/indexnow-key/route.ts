// src/app/api/indexnow-key/route.ts
// Serves the IndexNow ownership verification file. Middleware rewrites
// requests for /<INDEXNOW_KEY>.txt to this handler so the key can be
// held in an env var instead of baked into the filesystem.
//
// Contract: HTTP 200, Content-Type text/plain, body is exactly the
// current INDEXNOW_KEY value (no whitespace, no newline).

import { NextResponse } from 'next/server'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function GET() {
  const key = (process.env.INDEXNOW_KEY ?? '').trim()
  if (!key) return new NextResponse('not configured', { status: 404, headers: { 'Content-Type': 'text/plain' } })
  return new NextResponse(key, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
