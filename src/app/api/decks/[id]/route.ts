// app/api/decks/[id]/route.ts
// GET (owner) + PATCH (owner) for a single deck. PATCH handles the
// public/private toggle + slug management. Slug uniqueness is enforced
// by the partial unique index on lower(slug) WHERE is_public=true.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, updateDeck } from '@/lib/mtg/decks'
import { generatePublicDeckSlug, validateSlugString } from '@/lib/mtg/deck-slug'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck || deck.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deck })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id } = await params
  const existing = await getDeckById(id)
  if (!existing || existing.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const patch: Record<string, unknown> = {}

  // Sharing fields
  if (typeof body.is_public === 'boolean') patch.is_public = body.is_public
  if (typeof body.slug === 'string') {
    const v = validateSlugString(body.slug)
    if (v.ok !== true) return NextResponse.json({ error: 'invalid_slug', reason: (v as any).error }, { status: 400 })
    patch.slug = v.slug
  } else if (body.slug === null) {
    patch.slug = null
  }

  // Ordinary metadata
  if (typeof body.name === 'string' && body.name.trim().length > 0) patch.name = body.name.trim().slice(0, 120)
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description
  if (typeof body.format === 'string') patch.format = body.format

  // Auto-generate a slug the first time a deck is made public without one.
  const willBePublic = 'is_public' in patch ? Boolean(patch.is_public) : existing.is_public
  const finalSlug = 'slug' in patch ? (patch.slug as string | null) : existing.slug
  if (willBePublic && !finalSlug) {
    patch.slug = await generatePublicDeckSlug(patch.name as string ?? existing.name, id)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ deck: existing })
  }

  const updated = await updateDeck(id, patch as any)
  if (!updated) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  return NextResponse.json({ deck: updated })
}
