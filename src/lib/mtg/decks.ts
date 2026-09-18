// src/lib/mtg/decks.ts
//
// Server-side deck helpers. All reads/writes go through the caller's
// session-scoped Supabase client, so RLS enforces `auth.uid()=user_id`
// on `mtg_decks` and, via the parent-EXISTS policy, on
// `mtg_deck_cards`. The service-role client is only used for
// hydrating catalogue data (oracle_cards, printings, prices, legalities)
// where the caller's owned data is not involved.

import 'server-only'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { FormatKey } from './formats.data'
import { getFormatRule } from './format-rules'
import type { DeckZone } from './deck-rules'

export type DeckRow = {
  id: string
  user_id: string
  name: string
  format: FormatKey
  description: string | null
  is_public: boolean
  slug: string | null
  budget_target_cents: number | null
  budget_currency: string | null
  created_at: string
  updated_at: string
}

export type DeckCardRow = {
  id: string
  deck_id: string
  oracle_card_id: string
  quantity: number
  zone: DeckZone
  printing_finish_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ── Deck CRUD ────────────────────────────────────────────────────────

export async function listUserDecks(): Promise<DeckRow[]> {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.from('mtg_decks').select('*').order('updated_at', { ascending: false })
  if (error) { console.error('listUserDecks err:', error); return [] }
  return (data ?? []) as DeckRow[]
}

export async function getDeckById(id: string): Promise<DeckRow | null> {
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.from('mtg_decks').select('*').eq('id', id).maybeSingle()
  if (error) return null
  return (data ?? null) as DeckRow | null
}

export async function getDeckCards(deckId: string): Promise<DeckCardRow[]> {
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.from('mtg_deck_cards').select('*').eq('deck_id', deckId)
  if (error) { console.error('getDeckCards err:', error); return [] }
  return (data ?? []) as DeckCardRow[]
}

export async function createDeck(input: {
  name: string
  format: FormatKey
  description?: string | null
}): Promise<DeckRow | null> {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const rule = getFormatRule(input.format)
  if (!rule) return null
  const { data, error } = await supabase.from('mtg_decks').insert({
    user_id: user.id,
    name: input.name.trim(),
    format: input.format,
    description: input.description ?? null,
  }).select().single()
  if (error) { console.error('createDeck err:', error); return null }
  return data as DeckRow
}

export async function updateDeck(
  id: string,
  patch: Partial<Pick<DeckRow, 'name' | 'description' | 'format' | 'is_public' | 'slug'>>,
): Promise<DeckRow | null> {
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.from('mtg_decks').update(patch).eq('id', id).select().single()
  if (error) { console.error('updateDeck err:', error); return null }
  return data as DeckRow
}

export async function deleteDeck(id: string): Promise<boolean> {
  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.from('mtg_decks').delete().eq('id', id)
  if (error) { console.error('deleteDeck err:', error); return false }
  return true
}

export async function duplicateDeck(sourceId: string): Promise<DeckRow | null> {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const src = await getDeckById(sourceId)
  if (!src) return null
  const { data: newDeck, error } = await supabase.from('mtg_decks').insert({
    user_id: user.id,
    name: `${src.name} (copy)`,
    format: src.format,
    description: src.description,
  }).select().single()
  if (error || !newDeck) return null
  const cards = await getDeckCards(sourceId)
  if (cards.length > 0) {
    const inserts = cards.map((c) => ({
      deck_id: newDeck.id,
      oracle_card_id: c.oracle_card_id,
      quantity: c.quantity,
      zone: c.zone,
      printing_finish_id: c.printing_finish_id,
      notes: c.notes,
    }))
    const { error: cErr } = await supabase.from('mtg_deck_cards').insert(inserts)
    if (cErr) console.error('duplicateDeck cards err:', cErr)
  }
  return newDeck as DeckRow
}

// ── Deck-card CRUD ───────────────────────────────────────────────────

export async function addDeckCard(input: {
  deck_id: string
  oracle_card_id: string
  quantity?: number
  zone?: DeckZone
  printing_finish_id?: string | null
}): Promise<DeckCardRow | null> {
  const supabase = await getSupabaseServerClient()
  const qty = Math.max(1, input.quantity ?? 1)
  const zone: DeckZone = input.zone ?? 'main'
  // Upsert on (deck, oracle, zone).
  const { data: existing } = await supabase
    .from('mtg_deck_cards')
    .select('id, quantity')
    .eq('deck_id', input.deck_id)
    .eq('oracle_card_id', input.oracle_card_id)
    .eq('zone', zone)
    .maybeSingle()
  if (existing) {
    const { data, error } = await supabase.from('mtg_deck_cards')
      .update({
        quantity: existing.quantity + qty,
        printing_finish_id: input.printing_finish_id ?? undefined,
      })
      .eq('id', existing.id)
      .select().single()
    if (error) { console.error('addDeckCard update err:', error); return null }
    return data as DeckCardRow
  }
  const { data, error } = await supabase.from('mtg_deck_cards').insert({
    deck_id: input.deck_id,
    oracle_card_id: input.oracle_card_id,
    quantity: qty,
    zone,
    printing_finish_id: input.printing_finish_id ?? null,
  }).select().single()
  if (error) { console.error('addDeckCard insert err:', error); return null }
  return data as DeckCardRow
}

export async function updateDeckCard(id: string, patch: Partial<Pick<DeckCardRow, 'quantity' | 'zone' | 'printing_finish_id' | 'notes'>>): Promise<DeckCardRow | null> {
  const supabase = await getSupabaseServerClient()
  const { data, error } = await supabase.from('mtg_deck_cards').update(patch).eq('id', id).select().single()
  if (error) { console.error('updateDeckCard err:', error); return null }
  return data as DeckCardRow
}

export async function removeDeckCard(id: string): Promise<boolean> {
  const supabase = await getSupabaseServerClient()
  const { error } = await supabase.from('mtg_deck_cards').delete().eq('id', id)
  if (error) { console.error('removeDeckCard err:', error); return false }
  return true
}

// ── Text-list import / export ────────────────────────────────────────

export type TextImportLine = {
  raw: string
  quantity: number
  name: string
  resolvedOracle: string | null    // oracle_card_id if unique match
  candidates: number               // # of catalogue matches (>1 = ambiguous)
  reason?: string
}

/** Parse "4x Lightning Bolt", "4 Lightning Bolt", "Lightning Bolt x4",
 *  ignore blank lines + section headers ("// Sideboard").
 *  Never silently imports ambiguous rows, the caller decides. */
export async function resolveTextList(text: string, opts: { format?: FormatKey } = {}): Promise<TextImportLine[]> {
  const s = getSupabaseServiceClient()
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: TextImportLine[] = []

  for (const line of rawLines) {
    if (line.startsWith('//') || line.startsWith('#')) continue
    // Match "4x Name" / "4 Name" / "Name x4" / "Name".
    const m = line.match(/^(\d+)[xX]?\s+(.+?)\s*(?:\(.*\))?\s*$/) ??
              line.match(/^(.+?)\s+[xX](\d+)\s*$/)
    let qty = 1
    let name = line
    if (m) {
      if (/^\d/.test(m[1])) { qty = parseInt(m[1], 10); name = m[2] }
      else                  { qty = parseInt(m[2], 10); name = m[1] }
    }
    // Trim any trailing set/collector suffix that Moxfield sometimes emits.
    name = name.replace(/\s*\([A-Za-z0-9]+\)\s*(\d+)?\s*$/, '').trim()

    // Look up by exact-ish name, Scryfall names are canonical, so
    // `ilike` with the raw string works even for split cards (which
    // include the '//').
    const { data } = await s.from('mtg_oracle_cards').select('id, name').ilike('name', name).limit(4)
    const hits = data ?? []
    if (hits.length === 0) {
      out.push({ raw: line, quantity: qty, name, resolvedOracle: null, candidates: 0, reason: 'No catalogue match' })
    } else if (hits.length > 1) {
      out.push({ raw: line, quantity: qty, name, resolvedOracle: null, candidates: hits.length, reason: `Multiple matches: ${hits.map((h: any) => h.name).join(', ')}` })
    } else {
      out.push({ raw: line, quantity: qty, name: (hits[0] as any).name, resolvedOracle: (hits[0] as any).id, candidates: 1 })
    }
  }
  return out
}

/** Plain-text export. Groups cards by zone. */
export function deckToText(deck: DeckRow, cardsWithNames: Array<{ zone: DeckZone; name: string; quantity: number }>): string {
  const byZone = new Map<DeckZone, typeof cardsWithNames>()
  for (const c of cardsWithNames) {
    const arr = byZone.get(c.zone) ?? []
    arr.push(c)
    byZone.set(c.zone, arr)
  }
  const parts: string[] = [`// ${deck.name}, ${deck.format}`, '']
  const order: DeckZone[] = ['commander', 'main', 'sideboard', 'companion', 'maybeboard']
  for (const zone of order) {
    const arr = byZone.get(zone) ?? []
    if (arr.length === 0) continue
    parts.push(`// ${zone[0].toUpperCase() + zone.slice(1)}`)
    for (const c of arr.sort((a, b) => a.name.localeCompare(b.name))) parts.push(`${c.quantity} ${c.name}`)
    parts.push('')
  }
  return parts.join('\n').trim() + '\n'
}
