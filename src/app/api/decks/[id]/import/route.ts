// app/api/decks/[id]/import/route.ts
// Text-list import into a deck. Resolves names via
// resolveTextList (server-only, service-role) and writes matching
// rows via the user's session client (RLS-enforced).

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, resolveTextList } from '@/lib/mtg/decks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck) return NextResponse.json({ error: 'deck not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as { text?: string } | null
  if (!body?.text) return NextResponse.json({ error: 'text missing' }, { status: 400 })

  const resolved = await resolveTextList(body.text, { format: deck.format as any })
  const supabase = await getSupabaseServerClient()

  let imported = 0
  const unresolved: string[] = []
  for (const line of resolved) {
    if (!line.resolvedOracle) {
      unresolved.push(`${line.raw} → ${line.reason ?? 'unresolved'}`)
      continue
    }
    // Upsert into main zone. If the (deck, oracle, main) row exists,
    // add to its quantity.
    const { data: existing } = await supabase.from('mtg_deck_cards')
      .select('id, quantity')
      .eq('deck_id', deck.id)
      .eq('oracle_card_id', line.resolvedOracle)
      .eq('zone', 'main')
      .maybeSingle()
    if (existing) {
      const { error } = await supabase.from('mtg_deck_cards').update({ quantity: existing.quantity + line.quantity }).eq('id', existing.id)
      if (!error) imported += 1
      else unresolved.push(`${line.raw} → ${error.message}`)
    } else {
      const { error } = await supabase.from('mtg_deck_cards').insert({
        deck_id: deck.id,
        oracle_card_id: line.resolvedOracle,
        quantity: line.quantity,
        zone: 'main',
      })
      if (!error) imported += 1
      else unresolved.push(`${line.raw} → ${error.message}`)
    }
  }
  return NextResponse.json({ imported, skipped: unresolved.length, unresolved })
}
