// app/api/decks/search/route.ts
// Card search restricted to a deck's context — reuses findCards but
// pre-applies format legality and (optionally) commander colour
// identity. Returns a lightweight shape for the deck-builder side
// panel (no owned/missing hydration, no per-oracle price fan-out).

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { findCards, type FinderQuery } from '@/lib/mtg/finder'
import type { CardCapability } from '@/lib/mtg/capabilities'
import type { FormatKey } from '@/lib/mtg/formats.data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const url = new URL(req.url)
  const name = url.searchParams.get('name') ?? ''
  const capsRaw = url.searchParams.get('caps') ?? ''
  const legal = (url.searchParams.get('legal') ?? '') as FormatKey
  const identity = (url.searchParams.get('identity') ?? '').split(',').filter(Boolean)
  const query: FinderQuery = {
    name: name.trim() || undefined,
    caps: capsRaw ? (capsRaw.split(',').filter(Boolean) as CardCapability[]) : undefined,
    legalIn: legal || undefined,
    colorIdentity: identity.length > 0 ? identity : undefined,
    sort: 'name',
  }
  const result = await findCards(query, { page: 1, pageSize: 30 })
  const hits = result.hits.map((h) => ({
    oracle_card_id: h.oracle_card_id,
    name: h.name,
    mana_cost: h.mana_cost,
    mana_value: h.mana_value,
    type_line: h.type_line,
    colors: h.colors,
    color_identity: h.color_identity,
    image_uri_small: h.printing.image_uri_small,
    set_code: h.printing.set_code,
    collector_number: h.printing.collector_number,
    reasons: h.reasons,
  }))
  return NextResponse.json({ hits, total: result.total })
}
