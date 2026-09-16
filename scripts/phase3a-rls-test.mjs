// scripts/phase3a-rls-test.mjs
// Verifies deck-level RLS end-to-end:
//   - anon cannot read/write decks or deck_cards
//   - User A creates a deck + adds cards; User B cannot see them
//   - Two users at once, cleaned up afterwards
//
// Also times a 100-card Commander deck build for the perf checkpoint.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const svc = createClient(url, service, { auth: { persistSession: false } })

async function makeUser(email, password) {
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  return data.user
}
async function clientAs(email, password) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  return c
}

console.log('=== Phase 3A deck RLS test ===\n')
const ts = Date.now()
const emailA = `mtg-deck-a-${ts}@example.com`
const emailB = `mtg-deck-b-${ts}@example.com`
const passA = `TestP@55A-${ts}`
const passB = `TestP@55B-${ts}`

let userA, userB, deckA
try {
  userA = await makeUser(emailA, passA)
  userB = await makeUser(emailB, passB)
  console.log(`  Created User A: ${userA.id}`)
  console.log(`  Created User B: ${userB.id}`)

  const aClient = await clientAs(emailA, passA)
  const bClient = await clientAs(emailB, passB)

  const { data: deck, error: dErr } = await aClient.from('mtg_decks').insert({
    user_id: userA.id, name: 'A-only test deck', format: 'commander',
  }).select().single()
  if (dErr) throw dErr
  deckA = deck
  console.log(`  A created deck: ${deck.id}`)

  // Pull a real oracle_card_id for adding.
  const { data: oracles } = await svc.from('mtg_oracle_cards').select('id').limit(3)
  await aClient.from('mtg_deck_cards').insert({
    deck_id: deck.id,
    oracle_card_id: oracles[0].id,
    quantity: 4, zone: 'main',
  })
  console.log('  A added a card')

  // Anon should not see deck.
  const anonClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: anonReads } = await anonClient.from('mtg_decks').select('*').eq('id', deck.id)
  console.log(`  ${(anonReads ?? []).length === 0 ? 'PASS' : 'FAIL'}  anon read of A's deck → ${(anonReads ?? []).length} rows`)

  // B should not see A's deck.
  const { data: bReadDecks } = await bClient.from('mtg_decks').select('*').eq('id', deck.id)
  console.log(`  ${(bReadDecks ?? []).length === 0 ? 'PASS' : 'FAIL'}  User B read of A's deck → ${(bReadDecks ?? []).length} rows`)

  const { data: bReadCards } = await bClient.from('mtg_deck_cards').select('*').eq('deck_id', deck.id)
  console.log(`  ${(bReadCards ?? []).length === 0 ? 'PASS' : 'FAIL'}  User B read of A's deck_cards → ${(bReadCards ?? []).length} rows`)

  // B tries to insert a card into A's deck — should fail via WITH CHECK.
  const { error: bInsErr } = await bClient.from('mtg_deck_cards').insert({
    deck_id: deck.id, oracle_card_id: oracles[1].id, quantity: 1, zone: 'main',
  })
  console.log(`  ${bInsErr ? 'PASS' : 'FAIL'}  User B INSERT into A's deck → ${bInsErr ? bInsErr.code : 'succeeded (unexpected)'}`)

  // B tries to delete A's deck.
  const { data: bDel } = await bClient.from('mtg_decks').delete().eq('id', deck.id).select()
  console.log(`  ${(bDel ?? []).length === 0 ? 'PASS' : 'FAIL'}  User B DELETE of A's deck → ${(bDel ?? []).length} affected`)

  // A can still read own.
  const { data: aRead } = await aClient.from('mtg_decks').select('*').eq('id', deck.id)
  console.log(`  ${(aRead ?? []).length === 1 ? 'PASS' : 'FAIL'}  User A read own deck → ${(aRead ?? []).length} rows`)

  // Perf: build a 100-card Commander deck as A.
  const { data: oracle100 } = await svc.from('mtg_oracle_cards')
    .select('id, type_line')
    .ilike('type_line', '%creature%')
    .limit(100)
  const inserts = oracle100.map((o) => ({
    deck_id: deck.id,
    oracle_card_id: o.id,
    quantity: 1,
    zone: 'main',
  }))
  const t0 = performance.now()
  const { error: bulkErr } = await aClient.from('mtg_deck_cards').upsert(inserts, { onConflict: 'deck_id,oracle_card_id,zone' })
  console.log(`  100-card bulk upsert: ${Math.round(performance.now() - t0)}ms${bulkErr ? ` (ERR ${bulkErr.message})` : ''}`)

  // Read deck cards + count.
  const t1 = performance.now()
  const { count } = await aClient.from('mtg_deck_cards').select('*', { count: 'exact', head: true }).eq('deck_id', deck.id)
  console.log(`  100-card deck-card count read: ${Math.round(performance.now() - t1)}ms → ${count} rows`)

} finally {
  if (deckA) await svc.from('mtg_decks').delete().eq('id', deckA.id).then(() => {})
  if (userA) await svc.auth.admin.deleteUser(userA.id)
  if (userB) await svc.auth.admin.deleteUser(userB.id)
  console.log('\n  Cleaned up test users + deck.')
}

console.log('\n=== done ===')
process.exit(0)
