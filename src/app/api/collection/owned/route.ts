// src/app/api/collection/owned/route.ts
//
// Per-viewer ownership lookup for a single oracle card. Backs the
// client-side owned-count badges on the card detail page
// (CardActionsStrip / PrintingComparison) now that the card page is
// moving to Full Route Cache / ISR and can no longer read cookies()
// in the server tree.
//
// Semantics match the pre-existing getOwnedPrintings helper exactly:
//   * unauthenticated → 200 with `{ items: [] }` (visually identical
//     to the pre-fix server render for signed-out users)
//   * authenticated   → 200 with `{ items: Owned[] }` where Owned is
//     the same shape the server page used
//   * missing / malformed oracleId → 400 (so random query strings do
//     not create per-URL work)
//   * never cached: `Cache-Control: private, no-store`. The response
//     depends on the viewer's session cookie and must never land in
//     any shared cache.
//
// Service-role safety: this route delegates to getOwnedPrintings in
// src/lib/mtg/collection.ts, which uses the service-role client ONLY
// for the public catalogue reads (mtg_printings, mtg_printing_finishes)
// and the user-session Supabase client for the RLS-gated
// mtg_collection_items read. No service-role access to the user's
// collection ever happens here.

import { NextResponse } from 'next/server'
import { getOwnedPrintings } from '@/lib/mtg/collection'

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const

// Oracle IDs are UUID v4 strings. Enforce a strict regex so random
// query strings cannot drive arbitrary catalogue queries.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const oracleId = url.searchParams.get('oracleId')
  if (!oracleId || !UUID_RE.test(oracleId)) {
    return NextResponse.json(
      { error: 'invalid oracleId' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const items = await getOwnedPrintings(oracleId)
    return NextResponse.json(
      { items },
      { status: 200, headers: NO_STORE_HEADERS },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[/api/collection/owned] oracleId=${oracleId} failed: ${msg}`)
    return NextResponse.json(
      { error: 'internal' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
