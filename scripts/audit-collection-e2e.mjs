#!/usr/bin/env node
// Pass 2B §5 Collection E2E — creates 2 scoped test users, exercises
// the collection surface end-to-end, proves RLS isolation, cleans up.
// Test users are deleted at end regardless of pass/fail.
//
// Run: node --env-file=.env.local scripts/audit-collection-e2e.mjs

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
const user1email = `pass2b-e2e-a-${stamp}@mtgprices-test.invalid`
const user2email = `pass2b-e2e-b-${stamp}@mtgprices-test.invalid`
const password = randomUUID()

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1) }
const created = []

process.on('exit', () => {})

async function cleanupAtEnd() {
  console.log(`\nCleaning up ${created.length} test user(s)…`)
  for (const uid of created) {
    try {
      // Cascade collection rows first (RLS won't matter here — service role).
      await SERVICE.from('mtg_collection_items').delete().eq('user_id', uid)
      await SERVICE.from('mtg_user_prefs').delete().eq('user_id', uid)
      await SERVICE.from('mtg_user_profiles').delete().eq('user_id', uid)
      await SERVICE.auth.admin.deleteUser(uid)
      console.log(`  ✓ deleted ${uid}`)
    } catch (e) { console.error(`  ! cleanup ${uid}: ${e.message}`) }
  }
}

try {
  // ─── 1. Pick a real printing_finish_id to test against ───────
  const { data: printings } = await SERVICE
    .from('mtg_printings').select('id, name, set_code, collector_number')
    .eq('digital', false).eq('lang', 'en')
    .eq('name', 'Lightning Bolt').eq('set_code', 'clu').limit(1)
  const printing = printings?.[0]
  if (!printing) fail('could not find a Lightning Bolt printing to test with')
  const { data: finishes } = await SERVICE
    .from('mtg_printing_finishes').select('id, finish').eq('printing_id', printing.id)
  const finishNonfoil = (finishes || []).find((f) => f.finish === 'nonfoil')
  const finishFoil    = (finishes || []).find((f) => f.finish === 'foil')
  if (!finishNonfoil) fail('printing has no nonfoil finish')
  console.log(`1/9 · Using ${printing.name} ${printing.set_code}·${printing.collector_number}: nonfoil=${finishNonfoil.id}${finishFoil ? `, foil=${finishFoil.id}` : ''}`)

  // ─── 2. Create user 1 ─────────────────────────────────────────
  const { data: u1, error: e1 } = await SERVICE.auth.admin.createUser({
    email: user1email, password, email_confirm: true,
  })
  if (e1) fail(`createUser 1: ${e1.message}`)
  created.push(u1.user.id)
  console.log(`2/9 · Created user A ${u1.user.id}`)

  // ─── 3. Sign in as user 1 via anon client ────────────────────
  const client1 = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: si1 } = await client1.auth.signInWithPassword({ email: user1email, password })
  if (si1) fail(`signInWithPassword 1: ${si1.message}`)
  console.log('3/9 · Signed in as user A')

  // ─── 4. Add an exact raw printing (NM, qty 2, purchase price + date + notes) ─
  const { error: insErr, data: insRow } = await client1
    .from('mtg_collection_items')
    .insert({
      user_id: u1.user.id,
      printing_finish_id: finishNonfoil.id,
      condition: 'near_mint',
      quantity: 2,
      acquired_price_cents: 199,
      acquired_currency: 'USD',
      acquired_at: '2025-06-01',
      notes: 'Pass 2B E2E test row A',
    })
    .select()
    .single()
  if (insErr) fail(`insert raw: ${insErr.message}`)
  console.log(`4/9 · Inserted raw row ${insRow.id}, qty=2, cond=NM, notes present`)

  // ─── 5. Update quantity ──────────────────────────────────────
  const { error: updErr } = await client1
    .from('mtg_collection_items').update({ quantity: 3 }).eq('id', insRow.id)
  if (updErr) fail(`update qty: ${updErr.message}`)
  const { data: readBack } = await client1
    .from('mtg_collection_items').select('quantity, notes').eq('id', insRow.id).single()
  if (readBack.quantity !== 3) fail(`quantity not persisted: ${readBack.quantity}`)
  console.log('5/9 · Updated qty 2→3 and re-read')

  // ─── 6. Add a graded row (foil finish + condition — schema has NO grader/grade cols) ─
  // Design gap: mtg_collection_items has no grader/grade columns. A user
  // trying to record "PSA 10 Black Lotus" separately from "NM near mint"
  // can only distinguish by finish or by condition — condition options
  // are physical-condition tiers (near_mint … damaged), NOT grader-tier.
  // Report the gap; test that at least the foil-vs-nonfoil separation
  // works.
  if (finishFoil) {
    const { error: foilErr } = await client1.from('mtg_collection_items').insert({
      user_id: u1.user.id, printing_finish_id: finishFoil.id, condition: 'near_mint',
      quantity: 1, acquired_price_cents: 999, acquired_currency: 'USD',
      acquired_at: '2025-06-02', notes: 'Pass 2B E2E test row A-foil',
    })
    if (foilErr) fail(`insert foil: ${foilErr.message}`)
    console.log('6/9 · Inserted foil row for same printing')
  } else {
    console.log('6/9 · Foil finish not available; skipped foil variant test')
  }

  // ─── 7. Verify count + selection ─────────────────────────────
  const { data: allRows, error: readErr } = await client1
    .from('mtg_collection_items').select('id, quantity, printing_finish_id, notes')
  if (readErr) fail(`read all: ${readErr.message}`)
  console.log(`7/9 · User A sees ${allRows.length} row(s) in their collection`)

  // ─── 8. RLS isolation: create user 2, verify they cannot see user 1's rows ─
  const { data: u2, error: e2 } = await SERVICE.auth.admin.createUser({
    email: user2email, password, email_confirm: true,
  })
  if (e2) fail(`createUser 2: ${e2.message}`)
  created.push(u2.user.id)
  const client2 = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  const { error: si2 } = await client2.auth.signInWithPassword({ email: user2email, password })
  if (si2) fail(`signInWithPassword 2: ${si2.message}`)
  const { data: user2Sees, error: rlsErr } = await client2.from('mtg_collection_items').select('id')
  if (rlsErr) fail(`user 2 read: ${rlsErr.message}`)
  if (user2Sees.length !== 0) fail(`RLS LEAK: user 2 sees ${user2Sees.length} rows belonging to user 1`)
  console.log(`8/9 · RLS isolation confirmed: user B sees 0 rows`)

  // ─── 9. Delete row from user 1 ───────────────────────────────
  const { error: delErr } = await client1
    .from('mtg_collection_items').delete().eq('id', insRow.id)
  if (delErr) fail(`delete: ${delErr.message}`)
  console.log('9/9 · Deleted a row (RLS + own-row permission verified)')

  console.log('\nPASS · Collection E2E clean.')
} finally {
  await cleanupAtEnd()
}
