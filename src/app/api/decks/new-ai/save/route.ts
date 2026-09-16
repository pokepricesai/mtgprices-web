// app/api/decks/new-ai/save/route.ts
// Saves an AI-drafted deck AFTER user confirmation. Re-runs
// deterministic validation on the exact contents the user is about
// to commit — the AI's confirmation isn't trusted.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getFormatRule } from '@/lib/mtg/format-rules'
import { validateDeck, type DeckCardForValidation } from '@/lib/mtg/deck-rules'
import type { FormatKey } from '@/lib/mtg/formats.data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const name: string = (body.name ?? 'Untitled AI deck').toString().slice(0, 120)
  const format: FormatKey = body.format
  const rule = getFormatRule(format)
  if (!rule) return NextResponse.json({ error: 'unsupported_format' }, { status: 400 })
  const commanderIds: string[] = Array.isArray(body.commander_oracle_ids) ? body.commander_oracle_ids.slice(0, 2) : []
  const main: Array<{ oracle_card_id: string; quantity: number }> = Array.isArray(body.main) ? body.main : []
  const basicLandsToAdd: number = Math.max(0, Math.min(60, Number(body.basic_lands_to_add ?? 0) | 0))
  if (main.length === 0 && commanderIds.length === 0) return NextResponse.json({ error: 'empty_deck' }, { status: 400 })

  // Fetch oracle metadata to run the validator. If the caller
  // requested auto-filled basics, resolve commander colour identity
  // and add the appropriate basic-land oracle IDs to `main`.
  const s = getSupabaseServiceClient()
  if (basicLandsToAdd > 0 && commanderIds.length > 0) {
    const { data: ciRows } = await s.from('mtg_oracle_cards').select('color_identity').in('id', commanderIds)
    const colours = new Set<string>()
    for (const r of (ciRows ?? []) as any[]) for (const c of (r.color_identity ?? [])) colours.add(c)
    const basicByColour: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
    const wantedNames = Array.from(colours).map((c) => basicByColour[c]).filter(Boolean)
    if (wantedNames.length > 0) {
      const { data: basics } = await s
        .from('mtg_oracle_cards')
        .select('id, name, type_line')
        .ilike('type_line', 'Basic Land%')
        .in('name', wantedNames)
      // Dedup by name — a name like "Plains" can appear multiple times
      // in the oracle table across special basic printings (snow, full-art).
      const byName = new Map<string, { id: string; name: string }>()
      for (const b of (basics ?? []) as any[]) if (!byName.has(b.name)) byName.set(b.name, { id: b.id, name: b.name })
      const basicList = Array.from(byName.values())
      if (basicList.length > 0) {
        const perColour = Math.floor(basicLandsToAdd / basicList.length)
        const remainder = basicLandsToAdd - perColour * basicList.length
        basicList.forEach((b, i) => {
          const qty = perColour + (i < remainder ? 1 : 0)
          if (qty > 0) main.push({ oracle_card_id: b.id, quantity: qty })
        })
      }
    }
  }
  const allIds = Array.from(new Set([...commanderIds, ...main.map((m) => m.oracle_card_id)]))
  const [{ data: oracles }, { data: legalities }] = await Promise.all([
    s.from('mtg_oracle_cards').select('id, name, type_line, color_identity, keywords, oracle_text').in('id', allIds),
    s.from('mtg_oracle_legalities').select('oracle_card_id, legality').in('oracle_card_id', allIds).eq('format', format),
  ])
  const oracleById = new Map<string, any>()
  for (const o of (oracles ?? []) as any[]) oracleById.set(o.id, o)
  const legalityBy = new Map<string, string>()
  for (const l of (legalities ?? []) as any[]) legalityBy.set(l.oracle_card_id, l.legality)

  const validationInput: DeckCardForValidation[] = [
    ...commanderIds.map((id) => {
      const o = oracleById.get(id) ?? {}
      return {
        oracle_card_id: id, name: o.name ?? '(unknown)', quantity: 1,
        zone: 'commander' as const,
        type_line: o.type_line ?? null,
        color_identity: o.color_identity ?? null,
        keywords: o.keywords ?? null,
        oracle_text: o.oracle_text ?? null,
        legality: legalityBy.get(id) ?? null,
      }
    }),
    ...main.map((m) => {
      const o = oracleById.get(m.oracle_card_id) ?? {}
      return {
        oracle_card_id: m.oracle_card_id, name: o.name ?? '(unknown)', quantity: m.quantity,
        zone: 'main' as const,
        type_line: o.type_line ?? null,
        color_identity: o.color_identity ?? null,
        keywords: o.keywords ?? null,
        oracle_text: o.oracle_text ?? null,
        legality: legalityBy.get(m.oracle_card_id) ?? null,
      }
    }),
  ]
  const validation = validateDeck({ format, cards: validationInput })
  if (!validation.ok) {
    return NextResponse.json({ error: 'validation_blocked', validation }, { status: 422 })
  }

  // Create the deck + insert cards.
  const supabase = await getSupabaseServerClient()
  const { data: deck, error: dErr } = await supabase.from('mtg_decks').insert({
    user_id: user.id,
    name,
    format,
    description: body.summary ? String(body.summary).slice(0, 4000) : null,
  }).select().single()
  if (dErr || !deck) return NextResponse.json({ error: dErr?.message ?? 'create_failed' }, { status: 500 })

  const inserts = [
    ...commanderIds.map((id) => ({ deck_id: deck.id, oracle_card_id: id, quantity: 1, zone: 'commander' as const })),
    ...main.map((m) => ({ deck_id: deck.id, oracle_card_id: m.oracle_card_id, quantity: m.quantity, zone: 'main' as const })),
  ]
  const { error: cErr } = await supabase.from('mtg_deck_cards').insert(inserts)
  if (cErr) {
    // Best-effort cleanup if card insert fails.
    await supabase.from('mtg_decks').delete().eq('id', deck.id)
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  return NextResponse.json({ deck })
}
