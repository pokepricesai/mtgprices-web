// app/api/account/delete-profile/route.ts
//
// Deletes MTGPrices data owned by the caller. Never touches auth.users
// because that identity is shared with our sibling site Poképrices.
//
// What gets deleted:
//   mtg_user_profiles
//   mtg_user_prefs
//   mtg_collection_items
//   mtg_collection_imports (if the table exists in this schema)
//   mtg_deck_cards (owned via mtg_decks)
//   mtg_decks (including public decks belonging to this user)
//   mtg_ai_usage
//   mtg_simulation_jobs
//
// What does NOT get deleted:
//   auth.users            (shared identity)
//   Any Poképrices tables
//
// The route requires an authenticated session. Body must include
// `confirm: "DELETE"` to reduce accidental hits. Uses the service-role
// client for the wipe so RLS doesn't stand in the way of cascading
// deletes for legacy rows where policies might have gotten out of sync
// (we already verified auth.uid() == caller before running).

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'

const TABLES = [
  'mtg_ai_usage',
  'mtg_simulation_jobs',
  'mtg_deck_cards',        // FK-cascaded by mtg_decks but delete explicitly for safety
  'mtg_decks',
  'mtg_collection_imports',
  'mtg_collection_items',
  'mtg_user_prefs',
  'mtg_user_profiles',
] as const

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: any = null
  try { body = await req.json() } catch { body = null }
  if (!body || String(body.confirm ?? '').toUpperCase() !== 'DELETE') {
    return NextResponse.json({ error: 'confirmation missing' }, { status: 400 })
  }

  const uid = user.id
  const supabase = getSupabaseServiceClient()

  // mtg_deck_cards is scoped by deck_id, not user_id. Wipe by joining
  // through owned decks first.
  try {
    const { data: ownedDecks } = await supabase
      .from('mtg_decks')
      .select('id')
      .eq('user_id', uid)
    const deckIds = (ownedDecks ?? []).map((d: any) => d.id).filter(Boolean)
    if (deckIds.length > 0) {
      const chunkSize = 100
      for (let i = 0; i < deckIds.length; i += chunkSize) {
        const chunk = deckIds.slice(i, i + chunkSize)
        const { error } = await supabase.from('mtg_deck_cards').delete().in('deck_id', chunk)
        if (error) console.error('delete-profile mtg_deck_cards error:', error)
      }
    }
  } catch (err) {
    console.error('delete-profile deck-card fanout error:', err)
  }

  const results: Record<string, { deleted: boolean; error?: string }> = {}
  for (const table of TABLES) {
    if (table === 'mtg_deck_cards') continue  // handled above
    try {
      const { error } = await supabase.from(table).delete().eq('user_id', uid)
      if (error) {
        // Ignore "table does not exist" (42P01) errors so a partial
        // schema doesn't block the delete. Log everything else.
        const code = (error as any).code
        if (code && code !== '42P01') {
          console.error(`delete-profile ${table} error:`, error)
        }
        results[table] = { deleted: false, error: error.message }
      } else {
        results[table] = { deleted: true }
      }
    } catch (err: any) {
      results[table] = { deleted: false, error: String(err?.message ?? err) }
    }
  }

  return NextResponse.json({ ok: true, wiped: results })
}
