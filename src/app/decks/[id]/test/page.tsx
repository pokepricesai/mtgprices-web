// app/decks/[id]/test/page.tsx
// Owner-only deck-testing lab.

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { buildSimLibraryFromDeckContext } from '@/lib/mtg/simulation/from-deck'
import { getFormatRule } from '@/lib/mtg/format-rules'
import TestDeckClient from './TestDeckClient'
import type { SimCard, SimLibrary } from '@/lib/mtg/simulation/library'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: 'Test deck — MTGPrices',
  description: 'Interactive playtest lab for your MTG deck.',
  robots: { index: false, follow: false },
}

type Params = { id: string }

/** Serialisable shape of a SimCard for the client. */
export type ClientSimCard = {
  oracle_card_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[]
  color_identity: string[]
  capabilities: string[]
  produced_mana: string[] | null
  oracle_text: string | null
  classification: SimCard['classification']
  imageUri: string | null
}

export type ClientSimLibrary = {
  entries: Array<{ card: ClientSimCard; quantity: number }>
  commanders: ClientSimCard[]
  companion: ClientSimCard[]
  size: number
}

export type ClientDeckMeta = {
  id: string
  name: string
  format: string
  formatLabel: string
  hasCommander: boolean
  firstPlayerDrawsOnTurn1Default: boolean
}

export default async function TestDeckPage({ params }: { params: Promise<Params> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=/decks/${id}/test`)

  const deck = await getDeckById(id)
  if (!deck || deck.user_id !== user.id) notFound()

  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)
  const lib = await buildSimLibraryFromDeckContext(context)

  // Attach preferred-printing images from context so the client can
  // show card art in the opening-hand lab without another round-trip.
  const imageByOracle = new Map<string, string | null>()
  for (const c of context.commanders.concat(context.main, context.sideboard, context.companion, context.maybeboard)) {
    imageByOracle.set(c.oracle_card_id, c.preferredPrinting?.image_uri_small ?? null)
  }

  const rule = getFormatRule(deck.format)
  const meta: ClientDeckMeta = {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    formatLabel: rule?.label ?? deck.format,
    hasCommander: Boolean(rule?.hasCommander),
    // Commander multiplayer official rule: the first player DOES draw
    // on turn 1. Constructed 1v1: the first player DOES NOT draw.
    firstPlayerDrawsOnTurn1Default: Boolean(rule?.hasCommander),
  }

  const projected: ClientSimLibrary = {
    entries: lib.entries.map(({ card, quantity }) => ({
      card: projectClientCard(card, imageByOracle.get(card.oracle_card_id) ?? null),
      quantity,
    })),
    commanders: lib.commanders.map((c) => projectClientCard(c, imageByOracle.get(c.oracle_card_id) ?? null)),
    companion: lib.companion.map((c) => projectClientCard(c, imageByOracle.get(c.oracle_card_id) ?? null)),
    size: lib.size,
  }

  return <TestDeckClient deck={meta} library={projected} />
}

function projectClientCard(c: SimCard, imageUri: string | null): ClientSimCard {
  return {
    oracle_card_id: c.oracle_card_id,
    name: c.name,
    mana_cost: c.mana_cost,
    mana_value: c.mana_value,
    type_line: c.type_line,
    colors: c.colors,
    color_identity: c.color_identity,
    capabilities: c.capabilities as string[],
    produced_mana: c.produced_mana,
    oracle_text: c.oracle_text,
    classification: c.classification,
    imageUri,
  }
}

// silence
void ({} as SimLibrary)
