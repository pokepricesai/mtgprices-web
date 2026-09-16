import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { duplicateDeck } from '@/lib/mtg/decks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id } = await params
  const dup = await duplicateDeck(id)
  if (!dup) return NextResponse.json({ error: 'failed' }, { status: 500 })
  return NextResponse.json({ deck: dup })
}
