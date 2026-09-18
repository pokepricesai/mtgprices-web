// app/decks/[id]/page.tsx, main Deck Builder.

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import DeckBuilderClient from './DeckBuilderClient'

export const dynamic = 'force-dynamic'

type Params = { id: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params
  const deck = await getDeckById(id)
  return {
    title: deck ? `${deck.name}, Deck Builder` : 'Deck',
    description: deck ? `${deck.name}, a MTG deck on MTGPrices.` : 'MTG Deck Builder.',
    robots: { index: false, follow: false },
    alternates: { canonical: `https://mtgprices.io/decks/${id}` },
    openGraph: { url: `https://mtgprices.io/decks/${id}` },
  }
}

export default async function DeckBuilderPage({ params }: { params: Promise<Params> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=/decks/${id}`)

  const deck = await getDeckById(id)
  if (!deck) notFound()

  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)

  return <DeckBuilderClient initialContext={context} />
}
