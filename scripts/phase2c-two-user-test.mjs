// scripts/phase2c-two-user-test.mjs
// Creates TWO synthetic auth users via the admin API, writes a
// collection item as User A, then tries to read it as User B. Cleans up
// after itself so no orphan test users linger.
//
// Requires SUPABASE_SERVICE_ROLE_KEY.

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

/** Sign in as a specific user and return a Supabase client that carries
 *  that user's JWT. */
async function clientAs(email, password) {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  return c
}

console.log('=== Phase 2C two-user isolation test ===\n')

const ts = Date.now()
const passA = `TestPa55!A-${ts}`
const passB = `TestPa55!B-${ts}`
const emailA = `mtg-test-a-${ts}@example.com`
const emailB = `mtg-test-b-${ts}@example.com`

let userA, userB, finishId, aItemId
try {
  userA = await makeUser(emailA, passA)
  userB = await makeUser(emailB, passB)
  console.log(`  Created user A: ${userA.id}`)
  console.log(`  Created user B: ${userB.id}`)

  const { data: f } = await svc.from('mtg_printing_finishes').select('id').limit(1)
  finishId = f?.[0]?.id
  if (!finishId) throw new Error('No mtg_printing_finishes rows available')

  // Insert an item as User A via service role (RLS bypass) but with A's user_id.
  const { data: inserted, error: insErr } = await svc.from('mtg_collection_items').insert({
    user_id: userA.id,
    printing_finish_id: finishId,
    condition: 'near_mint',
    quantity: 1,
  }).select().single()
  if (insErr) throw insErr
  aItemId = inserted.id
  console.log(`  Inserted 1 collection item as User A (id=${aItemId})`)

  // Anon read of A's row → should be blocked by RLS.
  const anonClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: anonReadA } = await anonClient.from('mtg_collection_items').select('*').eq('user_id', userA.id)
  console.log(`  ${(anonReadA ?? []).length === 0 ? 'PASS' : 'FAIL'}  Anon read of A's row → ${(anonReadA ?? []).length} rows`)

  // User A signed in — should see their own row.
  const aClient = await clientAs(emailA, passA)
  const { data: aReadA } = await aClient.from('mtg_collection_items').select('*').eq('user_id', userA.id)
  console.log(`  ${(aReadA ?? []).length === 1 ? 'PASS' : 'FAIL'}  User A read own row → ${(aReadA ?? []).length} rows`)

  // User B signed in — should NOT see A's row.
  const bClient = await clientAs(emailB, passB)
  const { data: bReadA } = await bClient.from('mtg_collection_items').select('*').eq('user_id', userA.id)
  console.log(`  ${(bReadA ?? []).length === 0 ? 'PASS' : 'FAIL'}  User B read of A's row → ${(bReadA ?? []).length} rows`)

  // User B tries to update A's row directly — should fail (0 affected / 42501).
  const { data: bUpd, error: bUpdErr } = await bClient.from('mtg_collection_items').update({ quantity: 999 }).eq('id', aItemId).select()
  const upBlocked = (bUpd ?? []).length === 0
  console.log(`  ${upBlocked ? 'PASS' : 'FAIL'}  User B UPDATE of A's row → ${bUpdErr ? bUpdErr.code : `${(bUpd ?? []).length} affected`}`)

  // User B tries to delete A's row — should be silently no-op under RLS.
  const { data: bDel } = await bClient.from('mtg_collection_items').delete().eq('id', aItemId).select()
  const delBlocked = (bDel ?? []).length === 0
  console.log(`  ${delBlocked ? 'PASS' : 'FAIL'}  User B DELETE of A's row → ${(bDel ?? []).length} affected`)

  // User B tries to insert into A's user_id — should fail on WITH CHECK.
  const { error: bInsErr } = await bClient.from('mtg_collection_items').insert({
    user_id: userA.id,
    printing_finish_id: finishId,
    condition: 'near_mint',
    quantity: 1,
  })
  console.log(`  ${bInsErr ? 'PASS' : 'FAIL'}  User B INSERT with A's user_id → ${bInsErr ? bInsErr.code : 'succeeded (unexpected)'}`)

} finally {
  if (userA) await svc.auth.admin.deleteUser(userA.id)
  if (userB) await svc.auth.admin.deleteUser(userB.id)
  console.log('\n  Cleaned up test users.')
}

console.log('\n=== done ===')
process.exit(0)
