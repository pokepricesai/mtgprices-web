// scripts/phase3d-live-final.mjs
// Final live end-to-end test against production mtgprices.io.
//
//   1. Create a temp user + deck server-side (service role).
//   2. Flip to public with a slug.
//   3. Anonymous HTTP GET on /decks/public/{slug} → 200 with body containing card list + noindex header.
//   4. Verify OG metadata present.
//   5. Flip to private via the service role.
//   6. Anonymous HTTP GET → 404 immediately (no ISR).
//   7. Cleanup.

import { readFileSync } from 'node:fs'
try {
  const raw = readFileSync('.env.local', 'utf8')
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
if (!url || !anonKey || !serviceKey) { console.error('missing env'); process.exit(1) }

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

function assert(cond, msg) { if (!cond) { console.error(`❌ ${msg}`); process.exit(1) } else console.log(`✅ ${msg}`) }

async function main() {
  console.log('=== Phase 3D — final live end-to-end ===\n')

  // Pick a real oracle card (a blue instant, cheap-ish).
  const { data: any1 } = await service.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%instant%')
    .overlaps('colors', ['U'])
    .limit(1)
  const oracle = any1?.[0]
  if (!oracle) { console.error('no oracle available'); process.exit(1) }

  // Create test user + deck.
  const email = `mtg-live-final-${Date.now()}@example.com`
  const { data: userData } = await service.auth.admin.createUser({ email, password: 'DontUse1234!', email_confirm: true })
  const userId = userData.user.id
  const slug = `p3d-final-${Math.random().toString(36).slice(2, 8)}`

  const { data: deck } = await service.from('mtg_decks').insert({
    user_id: userId,
    name: `Phase 3D final test deck ${slug}`,
    format: 'modern',
    description: 'Temporary deck for the Phase 3D live end-to-end test.',
    is_public: false,
    slug,
  }).select().single()
  assert(!!deck, 'test deck created')

  // Add a couple of cards.
  await service.from('mtg_deck_cards').insert([
    { deck_id: deck.id, oracle_card_id: oracle.id, quantity: 4, zone: 'main' },
  ])

  const publicUrl = `https://mtgprices.io/decks/public/${slug}`
  console.log(`\nTarget URL: ${publicUrl}`)

  // Anonymous HTTP: still private → 404.
  const r1 = await fetch(publicUrl, { cache: 'no-store' })
  assert(r1.status === 404, `Private deck returns 404 (got ${r1.status})`)

  // Flip public.
  await service.from('mtg_decks').update({ is_public: true }).eq('id', deck.id)

  // Anonymous HTTP: now public → 200 + card in body.
  const r2 = await fetch(publicUrl, { cache: 'no-store' })
  const body2 = await r2.text()
  assert(r2.status === 200, `Public deck returns 200 (got ${r2.status})`)
  assert(body2.includes(oracle.name), `Card "${oracle.name}" appears in public page body`)
  assert(body2.includes(deck.name), 'Deck name appears in public page body')
  assert(body2.includes('MTGPrices'), 'MTGPrices branding present')
  assert(r2.headers.get('x-robots-tag')?.includes('noindex'), `X-Robots-Tag noindex present (got ${r2.headers.get('x-robots-tag')})`)

  // OG metadata check.
  assert(/og:title/.test(body2), 'og:title present')
  assert(/og:description/.test(body2), 'og:description present')
  assert(/twitter:card/.test(body2), 'twitter:card present')

  // Privacy: page body must NOT contain the owner's email, user_id, notes.
  assert(!body2.includes(email), 'owner email NOT leaked')
  assert(!body2.includes(userId), 'owner user_id NOT leaked')

  // Copy decklist button present.
  assert(/Copy decklist/i.test(body2), 'Copy decklist button present')

  // Flip back to private.
  await service.from('mtg_decks').update({ is_public: false }).eq('id', deck.id)

  // Anonymous HTTP: immediately 404 (no ISR).
  const r3 = await fetch(publicUrl, { cache: 'no-store' })
  assert(r3.status === 404, `Private-again deck returns 404 (got ${r3.status})`)

  // Cleanup.
  await service.from('mtg_decks').delete().eq('id', deck.id)
  await service.auth.admin.deleteUser(userId)
  console.log('\nAll live end-to-end assertions passed.')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
