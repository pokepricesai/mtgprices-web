// app/api/decks/[id]/cards/[cardId]/printings/route.ts
//
// Returns every printing/finish for the oracle a given deck-card
// references. Owner-only (deck ownership → RLS). Response splits
// owned vs "other" so the client picker can group them.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getDeckById } from '@/lib/mtg/decks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { id: string; cardId: string }

export async function GET(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id, cardId } = await params
  const deck = await getDeckById(id)
  if (!deck || deck.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Look up the deck card's oracle_card_id via the caller's session
  // client so RLS enforces ownership.
  const supabase = await getSupabaseServerClient()
  const { data: dc } = await supabase.from('mtg_deck_cards')
    .select('id, oracle_card_id, printing_finish_id')
    .eq('id', cardId)
    .eq('deck_id', id)
    .maybeSingle()
  if (!dc) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const s = getSupabaseServiceClient()
  const oracleId = (dc as any).oracle_card_id as string

  // All printings for the oracle.
  const { data: printings } = await s.from('mtg_printings')
    .select('id, set_code, collector_number, image_uri_small, released_at, rarity')
    .eq('oracle_card_id', oracleId)
    .eq('lang', 'en')
    .eq('digital', false)
    .order('released_at', { ascending: false, nullsFirst: false })
  const printingRows = (printings ?? []) as any[]
  const printingById = new Map<string, any>()
  for (const p of printingRows) printingById.set(p.id, p)

  // All finishes for those printings.
  const printingIds = printingRows.map((p) => p.id)
  const { data: finishes } = printingIds.length === 0
    ? { data: [] as any[] }
    : await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', printingIds)
  const finishRows = (finishes ?? []) as any[]

  // Current cheapest price per finish under any provider we have.
  const finishIds = finishRows.map((f) => f.id)
  const priceByFinish = new Map<string, any>()
  if (finishIds.length > 0) {
    const IN_CHUNK = 60
    for (let i = 0; i < finishIds.length; i += IN_CHUNK) {
      const chunk = finishIds.slice(i, i + IN_CHUNK)
      const { data } = await s.from('mtg_current_prices')
        .select('printing_finish_id, provider, price, currency, price_type, market')
        .in('printing_finish_id', chunk)
      for (const p of (data ?? []) as any[]) {
        const cur = priceByFinish.get(p.printing_finish_id)
        const price = Number(p.price)
        // Keep the cheapest USD paper retail we see for label purposes.
        if (!cur || (p.currency === 'USD' && p.market === 'paper' && p.price_type === 'retail' && (!cur || price < cur.price))) {
          priceByFinish.set(p.printing_finish_id, { provider: p.provider, price, currency: p.currency })
        }
      }
    }
  }

  // Owned totals for this oracle's finishes (session-scoped, RLS).
  const { data: items } = finishIds.length === 0
    ? { data: [] as any[] }
    : await supabase.from('mtg_collection_items')
        .select('printing_finish_id, quantity')
        .in('printing_finish_id', finishIds)
  const ownedByFinish = new Map<string, number>()
  for (const it of (items ?? []) as any[]) {
    ownedByFinish.set(it.printing_finish_id, (ownedByFinish.get(it.printing_finish_id) ?? 0) + Number(it.quantity))
  }

  const options = finishRows.map((f) => {
    const p = printingById.get(f.printing_id) ?? {}
    return {
      printing_finish_id: f.id,
      set_code: p.set_code ?? '',
      collector_number: p.collector_number ?? null,
      released_at: p.released_at ?? null,
      rarity: p.rarity ?? null,
      finish: f.finish,
      image_uri_small: p.image_uri_small ?? null,
      owned_quantity: ownedByFinish.get(f.id) ?? 0,
      price: priceByFinish.get(f.id) ?? null,
    }
  })

  const owned = options.filter((o) => o.owned_quantity > 0)
  const other = options.filter((o) => o.owned_quantity === 0)

  return NextResponse.json({
    deck_card_id: cardId,
    current_printing_finish_id: (dc as any).printing_finish_id ?? null,
    owned,
    other,
  })
}
