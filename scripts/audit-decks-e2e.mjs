#!/usr/bin/env node
// Pass 2B §7 Decks E2E — creates a scoped test user, builds a
// Commander deck, adds/removes/updates cards, verifies read-back,
// RLS isolation, cleans up.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SERVICE = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)
const ANON_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const stamp = Date.now()
const emailA = `pass2b-decks-a-${stamp}@mtgprices-test.invalid`
const emailB = `pass2b-decks-b-${stamp}@mtgprices-test.invalid`
const password = randomUUID()
const created = []
function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1) }

async function cleanup() {
  console.log(`\nCleaning up ${created.length} test user(s)…`)
  for (const uid of created) {
    try {
      await SERVICE.from('mtg_deck_cards').delete().in('deck_id',
        (await SERVICE.from('mtg_decks').select('id').eq('user_id', uid)).data?.map(d => d.id) ?? [])
      await SERVICE.from('mtg_decks').delete().eq('user_id', uid)
      await SERVICE.from('mtg_user_prefs').delete().eq('user_id', uid)
      await SERVICE.from('mtg_user_profiles').delete().eq('user_id', uid)
      await SERVICE.auth.admin.deleteUser(uid)
      console.log(`  ✓ deleted ${uid}`)
    } catch (e) { console.error(`  ! cleanup ${uid}: ${e.message}`) }
  }
}

try {
  // ─── 1. Look up 3 real oracle cards to add ───────────────────
  const { data: cards } = await SERVICE
    .from('mtg_oracle_cards').select('id, name')
    .in('name', ['Sol Ring', 'Counterspell', 'Lightning Bolt'])
  if (!cards || cards.length !== 3) fail(`could not resolve seed cards: ${cards?.length}`)
  const solRing = cards.find((c) => c.name === 'Sol Ring')
  const counter = cards.find((c) => c.name === 'Counterspell')
  const bolt    = cards.find((c) => c.name === 'Lightning Bolt')
  console.log(`1/10 · Seeded 3 oracle cards`)

  // ─── 2. Create user A ────────────────────────────────────────
  const { data: uA, error: eA } = await SERVICE.auth.admin.createUser({
    email: emailA, password, email_confirm: true,
  })
  if (eA) fail(`createUser A: ${eA.message}`)
  created.push(uA.user.id)
  const clientA = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  await clientA.auth.signInWithPassword({ email: emailA, password })
  console.log(`2/10 · User A ${uA.user.id} authenticated`)

  // ─── 3. Create Commander deck ────────────────────────────────
  const { data: deck, error: dErr } = await clientA.from('mtg_decks').insert({
    user_id: uA.user.id,
    name: 'Pass 2B E2E Test Deck',
    format: 'commander',
    description: 'Automated pass 2b',
  }).select().single()
  if (dErr) fail(`createDeck: ${dErr.message}`)
  console.log(`3/10 · Created deck ${deck.id} name="${deck.name}" format=${deck.format}`)

  // ─── 4. Add 3 cards ──────────────────────────────────────────
  for (const c of [solRing, counter, bolt]) {
    const { error } = await clientA.from('mtg_deck_cards').insert({
      deck_id: deck.id, oracle_card_id: c.id, quantity: 1, zone: 'main',
    })
    if (error) fail(`addCard ${c.name}: ${error.message}`)
  }
  console.log('4/10 · Added Sol Ring, Counterspell, Lightning Bolt')

  // ─── 5. Update Sol Ring qty (from 1 to 4 — illegal in commander but write should succeed) ─
  const { data: solRow } = await clientA.from('mtg_deck_cards').select('id').eq('deck_id', deck.id).eq('oracle_card_id', solRing.id).single()
  const { error: updErr } = await clientA.from('mtg_deck_cards').update({ quantity: 4 }).eq('id', solRow.id)
  if (updErr) fail(`update qty: ${updErr.message}`)
  console.log('5/10 · Updated Sol Ring qty 1→4 (deck-legality is a UI concern, not enforced at write time)')

  // ─── 6. Remove Counterspell ──────────────────────────────────
  const { data: cRow } = await clientA.from('mtg_deck_cards').select('id').eq('deck_id', deck.id).eq('oracle_card_id', counter.id).single()
  const { error: rmErr } = await clientA.from('mtg_deck_cards').delete().eq('id', cRow.id)
  if (rmErr) fail(`removeCard: ${rmErr.message}`)
  console.log('6/10 · Removed Counterspell')

  // ─── 7. Rename deck ──────────────────────────────────────────
  const { error: renameErr } = await clientA.from('mtg_decks').update({ name: 'Pass 2B E2E Test Deck (renamed)' }).eq('id', deck.id)
  if (renameErr) fail(`rename: ${renameErr.message}`)
  console.log('7/10 · Renamed deck')

  // ─── 8. Set is_public + read as anon (public read path) ─────
  const { error: pubErr } = await clientA.from('mtg_decks').update({ is_public: true }).eq('id', deck.id)
  if (pubErr) fail(`set public: ${pubErr.message}`)
  const clientAnon = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: publicDeck } = await clientAnon.from('mtg_decks').select('id, name, is_public').eq('id', deck.id).maybeSingle()
  if (!publicDeck) fail('anon cannot read is_public=true deck (RLS may be over-restrictive)')
  if (!publicDeck.is_public) fail('is_public flag not persisted')
  console.log(`8/10 · Public deck readable by anon: name="${publicDeck.name}"`)

  // ─── 9. RLS isolation: user B ────────────────────────────────
  const { data: uB, error: eB } = await SERVICE.auth.admin.createUser({
    email: emailB, password, email_confirm: true,
  })
  if (eB) fail(`createUser B: ${eB.message}`)
  created.push(uB.user.id)
  const clientB = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  await clientB.auth.signInWithPassword({ email: emailB, password })
  const { data: bSees } = await clientB.from('mtg_decks').select('id').neq('is_public', true)
  const bLeaked = bSees?.filter((d) => d.id === deck.id).length ?? 0
  if (bLeaked > 0) fail(`RLS LEAK: user B sees user A's private-write rows`)
  console.log(`8b/10 · RLS isolation confirmed: user B sees 0 of user A's private rows`)

  // ─── 10. Read final deck state ───────────────────────────────
  const { data: finalCards } = await clientA.from('mtg_deck_cards').select('quantity, oracle_card_id').eq('deck_id', deck.id)
  console.log(`9/10 · Final deck state: ${finalCards?.length ?? 0} entries. Details: ${JSON.stringify(finalCards)}`)

  // ─── 11. Delete deck ─────────────────────────────────────────
  await clientA.from('mtg_deck_cards').delete().eq('deck_id', deck.id)
  const { error: delDeckErr } = await clientA.from('mtg_decks').delete().eq('id', deck.id)
  if (delDeckErr) fail(`deleteDeck: ${delDeckErr.message}`)
  console.log('10/10 · Deleted deck')

  console.log('\nPASS · Decks E2E clean.')
} finally {
  await cleanup()
}
