// app/api/decks/route.ts
// GET — list the caller's decks (minimal shape for pickers).

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { listUserDecks } from '@/lib/mtg/decks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const decks = await listUserDecks()
  return NextResponse.json({
    decks: decks.map((d) => ({ id: d.id, name: d.name, format: d.format, updated_at: d.updated_at })),
  })
}
