// app/api/decks/[id]/export/route.ts
// Plain-text decklist export via deckToText().

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getDeckById, getDeckCards, deckToText } from '@/lib/mtg/decks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck) return NextResponse.json({ error: 'deck not found' }, { status: 404 })

  const rows = await getDeckCards(id)
  if (rows.length === 0) return new NextResponse(`// ${deck.name} — ${deck.format}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })

  // Hydrate oracle names (RLS on deck_cards already ran).
  const s = getSupabaseServiceClient()
  const { data: oracles } = await s.from('mtg_oracle_cards').select('id, name').in('id', Array.from(new Set(rows.map((r) => r.oracle_card_id))))
  const nameById = new Map<string, string>((oracles ?? []).map((o: any) => [o.id, o.name]))
  const text = deckToText(deck, rows.map((r) => ({
    zone: r.zone as any,
    quantity: r.quantity,
    name: nameById.get(r.oracle_card_id) ?? '(unknown)',
  })))
  return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
