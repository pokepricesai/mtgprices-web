// app/api/collection/import/preview/route.ts
// Server-side preview endpoint for CSV import. Runs the resolver
// against the catalogue via the service-role client — the user auth
// check happens against the caller's session cookie.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { buildPreview } from '@/lib/mtg/csv-import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => null) as { csv?: string } | null
  if (!body?.csv) return NextResponse.json({ error: 'csv missing' }, { status: 400 })

  const preview = await buildPreview(body.csv)
  return NextResponse.json({ preview })
}
