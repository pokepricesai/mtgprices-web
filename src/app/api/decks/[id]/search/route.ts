// app/api/decks/[id]/search/route.ts
// Deck-context card search. Combines the natural-language parser +
// structured filters + owned/missing/exclude toggles. Always
// pre-applies deck format + commander CI via composeDeckQuery.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { searchLegalCards } from '@/lib/mtg/deck-search'
import { parseFinderText } from '@/lib/mtg/finder-nl'
import type { CardCapability } from '@/lib/mtg/capabilities'
import type { FinderQuery } from '@/lib/mtg/finder'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck) return NextResponse.json({ error: 'deck not found' }, { status: 404 })

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const {
    q,
    caps,
    colors,
    types,
    rarity,
    mvMin, mvMax,
    priceMax, currency,
    ownedOnly, missingOnly, excludeInDeck,
    page,
  } = body as {
    q?: string
    caps?: CardCapability[]
    colors?: string[]
    types?: string[]
    rarity?: 'common' | 'uncommon' | 'rare' | 'mythic'
    mvMin?: number; mvMax?: number
    priceMax?: number; currency?: 'USD' | 'EUR'
    ownedOnly?: boolean; missingOnly?: boolean; excludeInDeck?: boolean
    page?: number
  }

  // Parse NL first — user's explicit structured filters override.
  const nl = q && q.trim() ? parseFinderText(q) : { query: {} as FinderQuery, suggestions: [] as string[], warnings: [] as string[] }
  const request: Partial<FinderQuery> = {
    ...nl.query,
    ...(caps && caps.length > 0 ? { caps } : {}),
    ...(colors && colors.length > 0 ? { colors } : {}),
    ...(types && types.length > 0 ? { types } : {}),
    ...(rarity ? { rarity } : {}),
    ...(typeof mvMin === 'number' ? { manaValueMin: mvMin } : {}),
    ...(typeof mvMax === 'number' ? { manaValueMax: mvMax } : {}),
    ...(typeof priceMax === 'number' ? { priceMax } : {}),
    ...(currency ? { currency } : {}),
  }

  // Assemble deck context.
  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)

  const result = await searchLegalCards(context, {
    request,
    ownedOnly: Boolean(ownedOnly),
    missingOnly: Boolean(missingOnly),
    excludeInDeck: Boolean(excludeInDeck),
    page: page ?? 1,
    pageSize: 30,
  })

  return NextResponse.json({
    hits: result.hits,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    filters: result.filters,
    parsed: { suggestions: nl.suggestions, warnings: nl.warnings },
  })
}
