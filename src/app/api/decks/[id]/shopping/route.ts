// app/api/decks/[id]/shopping/route.ts
//
// Owner-only shopping-list endpoint. Deterministic, no AI involved.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { buildShoppingList, type ShoppingMode } from '@/lib/mtg/shopping'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck || deck.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = new URL(req.url)
  const modeParam = url.searchParams.get('mode')
  const mode: ShoppingMode = modeParam === 'preferred' ? 'preferred' : 'cheapest_playable'
  const format = url.searchParams.get('format')  // 'json' | 'csv'

  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)
  const shopping = await buildShoppingList(context, mode)

  if (format === 'csv') {
    const csv = shoppingToCsv(shopping)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitiseFilename(deck.name)}-shopping-${mode}.csv"`,
      },
    })
  }

  return NextResponse.json({ shopping })
}

function shoppingToCsv(shopping: Awaited<ReturnType<typeof buildShoppingList>>): string {
  const header = ['quantity', 'card', 'set', 'collector_number', 'finish', 'provider', 'price', 'currency', 'price_type', 'purchase_url']
  const rows: string[] = [header.join(',')]
  for (const line of shopping.lines) {
    const link = line.purchaseLinks.find((l) => l.provider === line.price?.provider) ?? line.purchaseLinks[0]
    rows.push([
      String(line.missing),
      csvField(line.name),
      csvField(line.chosen.set_code ?? ''),
      csvField(line.chosen.collector_number ?? ''),
      csvField(line.chosen.finish ?? ''),
      csvField(line.price?.provider ?? ''),
      line.price ? line.price.price.toFixed(2) : '',
      csvField(line.price?.currency ?? ''),
      csvField(line.price?.price_type ?? ''),
      csvField(link?.url ?? ''),
    ].join(','))
  }
  return rows.join('\r\n')
}

function csvField(s: string): string {
  if (s == null) return ''
  const needsQuote = /[",\r\n]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needsQuote ? `"${escaped}"` : escaped
}

function sanitiseFilename(s: string): string {
  return s.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'deck'
}
