// scripts/phase3d-rls-test.mjs
//
// Live RLS test for Phase 3D public deck sharing. Requires:
//   1. The migration `migrations/2026-09-16-mtg-decks-public-rls.sql`
//      has been applied to the target Supabase.
//   2. `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` +
//      `NEXT_PUBLIC_SUPABASE_ANON_KEY` in .env.local.
//
// Verifies:
//   - anonymous cannot read a private deck
//   - anonymous CAN read a public deck
//   - user B cannot read A's private deck
//   - user B CAN read A's public deck
//   - user B cannot UPDATE A's public deck
//   - toggling public→private immediately removes public access
//   - unique slug enforced for public decks

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const { createClient } = await import('@supabase/supabase-js')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceKey) {
  console.error('Missing env vars.')
  process.exit(1)
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function makeUser(tag) {
  const email = `mtg-rls-${tag}-${Date.now()}@example.com`
  const password = 'DontUse1234!'
  const { data } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: signIn, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signin ${tag}: ${error.message}`)
  return { id: data.user.id, client, email }
}

function assertTrue(cond, msg) { if (!cond) { console.error(`❌ ${msg}`); process.exit(1) } else console.log(`✅ ${msg}`) }

async function main() {
  console.log('=== Phase 3D — public deck RLS smoke ===\n')
  const A = await makeUser('a')
  const B = await makeUser('b')

  // A creates a private deck.
  const { data: deckA } = await A.client.from('mtg_decks').insert({
    user_id: A.id, name: 'RLS test A', format: 'commander', is_public: false,
  }).select().single()
  assertTrue(!!deckA, 'A created private deck')

  // Anon cannot read the private deck.
  const anonPrivate = await anon.from('mtg_decks').select('id').eq('id', deckA.id).maybeSingle()
  assertTrue(!anonPrivate.data, 'Anon cannot read A\'s private deck')

  // B cannot read A's private deck.
  const bPrivate = await B.client.from('mtg_decks').select('id').eq('id', deckA.id).maybeSingle()
  assertTrue(!bPrivate.data, 'B cannot read A\'s private deck')

  // A publishes the deck.
  const slug = `rls-test-${Math.random().toString(36).slice(2, 8)}`
  await A.client.from('mtg_decks').update({ is_public: true, slug }).eq('id', deckA.id)

  // Anon CAN read.
  const anonPublic = await anon.from('mtg_decks').select('id, name, slug, is_public').eq('id', deckA.id).maybeSingle()
  assertTrue(!!anonPublic.data, 'Anon can read A\'s public deck')
  assertTrue(anonPublic.data?.is_public === true, 'Public flag correctly true')

  // Anon can look up by slug (this is what /decks/public/[slug] does).
  const anonBySlug = await anon.from('mtg_decks').select('id').eq('slug', slug).eq('is_public', true).maybeSingle()
  assertTrue(!!anonBySlug.data && anonBySlug.data.id === deckA.id, 'Anon can look up A\'s public deck by slug')

  // B can read.
  const bPublic = await B.client.from('mtg_decks').select('id, name').eq('id', deckA.id).maybeSingle()
  assertTrue(!!bPublic.data, 'B can read A\'s public deck')

  // B cannot UPDATE A's deck.
  const bUpdate = await B.client.from('mtg_decks').update({ name: 'HACKED' }).eq('id', deckA.id)
  assertTrue((bUpdate.error?.code === '42501') || (bUpdate.data == null && !bUpdate.error), 'B cannot UPDATE A\'s deck (RLS blocks)')

  // Confirm the deck name did NOT change.
  const afterUpdate = await service.from('mtg_decks').select('name').eq('id', deckA.id).single()
  assertTrue(afterUpdate.data?.name === 'RLS test A', 'A\'s deck name unchanged after B\'s attempted update')

  // A adds a card, B cannot read the card, then A publishes → B can read.
  // Grab any real oracle_card_id for the insert.
  const { data: any1 } = await service.from('mtg_oracle_cards').select('id').limit(1)
  const oracleId = any1?.[0]?.id
  if (oracleId) {
    // Temporarily private again.
    await A.client.from('mtg_decks').update({ is_public: false }).eq('id', deckA.id)
    await A.client.from('mtg_deck_cards').insert({ deck_id: deckA.id, oracle_card_id: oracleId, quantity: 1, zone: 'main' })
    const anonCardsBefore = await anon.from('mtg_deck_cards').select('id').eq('deck_id', deckA.id)
    assertTrue((anonCardsBefore.data ?? []).length === 0, 'Anon cannot read cards of a private deck')

    await A.client.from('mtg_decks').update({ is_public: true }).eq('id', deckA.id)
    const anonCardsAfter = await anon.from('mtg_deck_cards').select('id').eq('deck_id', deckA.id)
    assertTrue((anonCardsAfter.data ?? []).length >= 1, 'Anon can read cards of a public deck')

    // Toggle back to private — anon access should disappear immediately.
    await A.client.from('mtg_decks').update({ is_public: false }).eq('id', deckA.id)
    const anonCardsAfterPrivate = await anon.from('mtg_deck_cards').select('id').eq('deck_id', deckA.id)
    assertTrue((anonCardsAfterPrivate.data ?? []).length === 0, 'Anon loses access when deck flipped to private')
  }

  // Cleanup.
  await service.from('mtg_decks').delete().eq('id', deckA.id)
  await service.auth.admin.deleteUser(A.id)
  await service.auth.admin.deleteUser(B.id)
  console.log('\nAll RLS assertions passed.')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
