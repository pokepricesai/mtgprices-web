// app/api/decks/[id]/alternatives/route.ts
// Deterministic alternatives for a single Oracle card, constrained by
// the deck's format + commander CI. Optional ?cheaper=1 applies the
// price ceiling at the deck's valuation basis.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { findAlternativesInDeck, findCheaperAlternatives } from '@/lib/mtg/deck-search'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const { id } = await params
  const url = new URL(req.url)
  const oracle = url.searchParams.get('oracle')
  const cheaper = url.searchParams.get('cheaper') === '1'
  if (!oracle) return NextResponse.json({ error: 'oracle missing' }, { status: 400 })

  const deck = await getDeckById(id)
  if (!deck) return NextResponse.json({ error: 'deck not found' }, { status: 404 })
  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)

  if (cheaper) {
    const result = await findCheaperAlternatives(context, oracle, 12)
    return NextResponse.json(result)
  }
  const alternatives = await findAlternativesInDeck(context, oracle, 12)
  return NextResponse.json({ alternatives })
}
