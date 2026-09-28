#!/usr/bin/env node
// Pass 2B mini §2 Graded collection E2E — proves raw + graded copies
// of the same printing coexist, grader/grade round-trips, edit works,
// RLS holds, cleanup.

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
const emailA = `pass2b-graded-a-${stamp}@mtgprices-test.invalid`
const emailB = `pass2b-graded-b-${stamp}@mtgprices-test.invalid`
const password = randomUUID()
const created = []
function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1) }

async function cleanup() {
  console.log(`\nCleaning up ${created.length} test user(s)…`)
  for (const uid of created) {
    try {
      await SERVICE.from('mtg_collection_items').delete().eq('user_id', uid)
      await SERVICE.from('mtg_user_prefs').delete().eq('user_id', uid)
      await SERVICE.from('mtg_user_profiles').delete().eq('user_id', uid)
      await SERVICE.auth.admin.deleteUser(uid)
      console.log(`  ✓ deleted ${uid}`)
    } catch (e) { console.error(`  ! cleanup ${uid}: ${e.message}`) }
  }
}

try {
  // 1. Pick a real printing_finish_id
  const { data: prints } = await SERVICE
    .from('mtg_printings').select('id, name, set_code, collector_number')
    .eq('set_code', 'lea').eq('collector_number', '232').limit(1)
  if (!prints || prints.length === 0) fail('need Black Lotus LEA·232 as test row')
  const { data: finishes } = await SERVICE
    .from('mtg_printing_finishes').select('id, finish').eq('printing_id', prints[0].id)
  const nf = finishes?.find((f) => f.finish === 'nonfoil')
  if (!nf) fail('no nonfoil finish')
  console.log(`1/9 · Test target: Black Lotus LEA·232 nonfoil=${nf.id}`)

  // 2. Create user A
  const { data: uA } = await SERVICE.auth.admin.createUser({ email: emailA, password, email_confirm: true })
  created.push(uA.user.id)
  const clientA = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  await clientA.auth.signInWithPassword({ email: emailA, password })
  console.log(`2/9 · User A ${uA.user.id} authenticated`)

  // 3. Insert raw NM copy
  const { data: rawRow, error: rawErr } = await clientA.from('mtg_collection_items').insert({
    user_id: uA.user.id, printing_finish_id: nf.id,
    condition: 'near_mint', quantity: 1,
    acquired_price_cents: 12000000, acquired_currency: 'USD',
    notes: 'Pass 2B mini raw copy',
  }).select().single()
  if (rawErr) fail(`raw insert: ${rawErr.message}`)
  console.log(`3/9 · Inserted raw NM row ${rawRow.id}, grader=${rawRow.grader}`)

  // 4. Insert graded PSA 10 copy for the SAME printing_finish
  const { data: slabRow, error: slabErr } = await clientA.from('mtg_collection_items').insert({
    user_id: uA.user.id, printing_finish_id: nf.id,
    condition: 'near_mint', quantity: 1,
    grader: 'PSA', grade: '10',
    acquired_price_cents: 34500000, acquired_currency: 'USD',
    notes: 'Pass 2B mini PSA 10',
  }).select().single()
  if (slabErr) fail(`slab insert: ${slabErr.message}`)
  console.log(`4/9 · Inserted PSA 10 row ${slabRow.id}, grader=${slabRow.grader} grade=${slabRow.grade}`)

  // 5. Both rows exist for the same printing
  const { data: all } = await clientA.from('mtg_collection_items')
    .select('id, grader, grade, condition, quantity').eq('printing_finish_id', nf.id)
  if (!all || all.length !== 2) fail(`expected 2 rows, got ${all?.length}`)
  const hasRaw = all.some((r) => r.grader === null)
  const hasSlab = all.some((r) => r.grader === 'PSA' && r.grade === '10')
  if (!hasRaw || !hasSlab) fail('raw + PSA10 do not coexist')
  console.log(`5/9 · Raw + PSA 10 coexist for the same printing_finish`)

  // 6. Attempting to insert a SECOND PSA 10 for the same printing_finish should fail
  //    (partial unique index ux_mtg_collection_items_slab)
  const { error: dupErr } = await clientA.from('mtg_collection_items').insert({
    user_id: uA.user.id, printing_finish_id: nf.id,
    condition: 'near_mint', quantity: 1, grader: 'PSA', grade: '10',
  })
  if (!dupErr) fail('expected duplicate PSA 10 insert to be rejected by unique index')
  console.log(`6/9 · Duplicate PSA 10 rejected as expected (${dupErr.code ?? 'unique-violation'})`)

  // 7. Edit: change grader from PSA to BGS on the graded row
  const { error: editErr } = await clientA.from('mtg_collection_items')
    .update({ grader: 'BGS', grade: '9.5' }).eq('id', slabRow.id)
  if (editErr) fail(`edit grader: ${editErr.message}`)
  const { data: reread } = await clientA.from('mtg_collection_items')
    .select('grader, grade').eq('id', slabRow.id).single()
  if (reread.grader !== 'BGS' || reread.grade !== '9.5') fail(`edit not persisted: ${JSON.stringify(reread)}`)
  console.log(`7/9 · Edited grader PSA 10 → BGS 9.5 and re-read`)

  // 8. Bad grade rejected by CHECK constraint
  const { error: badGrade } = await clientA.from('mtg_collection_items').insert({
    user_id: uA.user.id, printing_finish_id: nf.id,
    condition: 'near_mint', quantity: 1, grader: 'PSA', grade: '11',
  })
  if (!badGrade) fail('expected invalid grade to be rejected by CHECK')
  console.log(`8/9 · Invalid grade "11" rejected by CHECK constraint`)

  // 8b. Grader without grade rejected by paired-CHECK
  const { error: unpairedErr } = await clientA.from('mtg_collection_items').insert({
    user_id: uA.user.id, printing_finish_id: nf.id,
    condition: 'near_mint', quantity: 1, grader: 'CGC',
  })
  if (!unpairedErr) fail('expected grader-without-grade to be rejected by paired-CHECK')
  console.log(`8b/9 · grader without grade rejected by CHECK`)

  // 9. RLS: user B cannot see user A's rows
  const { data: uB } = await SERVICE.auth.admin.createUser({ email: emailB, password, email_confirm: true })
  created.push(uB.user.id)
  const clientB = createClient(ANON_URL, ANON_KEY, { auth: { persistSession: false } })
  await clientB.auth.signInWithPassword({ email: emailB, password })
  const { data: bSees } = await clientB.from('mtg_collection_items').select('id').eq('user_id', uA.user.id)
  if (bSees && bSees.length > 0) fail('RLS leak: user B saw user A rows')
  console.log(`9/9 · RLS isolation confirmed`)

  console.log('\nPASS · Graded collection E2E clean.')
} finally {
  await cleanup()
}
