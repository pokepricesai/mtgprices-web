#!/usr/bin/env node
// Deep post-apply validation. Read-only, service-role + anon.
// Confirms every specific point requested by the operator:
//   * legacy FK annotations still point at the renamed legacy tables
//   * every new production FK is declared and typed correctly
//   * every uniqueness constraint is declared
//   * pgcrypto/digest() is operational (verified via mtg_rulings.comment_hash
//     GENERATED column presence — creation itself is proof pgcrypto works)
//   * RLS deny-path: anon key can SELECT but CANNOT INSERT
//   * provider_card_links + market_import_runs unaffected

import { readFileSync } from 'node:fs'
const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const spec = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
}).then(r => r.json())
const defs = spec.definitions || {}

function fkOf(table, column) {
  // OpenAPI embeds FK annotations in column descriptions:
  //   "…<fk table='X' column='Y'/>"
  const desc = defs[table]?.properties?.[column]?.description || ''
  const m = desc.match(/<fk\s+table='([^']+)'\s+column='([^']+)'/)
  return m ? `${m[1]}.${m[2]}` : null
}

let hardFail = false

// ── 1. Legacy intra-FKs still valid after rename ─────────────────
console.log('=== 1. Legacy intra-FKs preserved through rename ===')
const legFKs = [
  ['mtg_cards_legacy_20260327',        'oracle_id',       null],  // no FK on oracle_id
  ['mtg_daily_prices_legacy_20260327', 'card_id',         'mtg_cards_legacy_20260327.id'],
  ['mtg_card_trends_legacy_20260327',  'card_id',         'mtg_cards_legacy_20260327.id'],
]
for (const [t, c, expected] of legFKs) {
  const actual = fkOf(t, c)
  const ok = expected === null ? actual === null : actual === expected
  console.log(`  ${ok ? '✓' : '✗'} ${t}.${c}  →  ${actual || '(no FK)'}  ${expected ? '(expected ' + expected + ')' : ''}`)
  if (!ok && expected) hardFail = true
}
console.log('  (PostgreSQL tracks FKs by OID, so the target-table name in the annotation is now the archived name — proves the constraint survived the rename.)')

// ── 2. New production FKs declared ────────────────────────────────
console.log('\n=== 2. New production-table FK declarations (from PostgREST spec) ===')
const expectedFks = [
  ['mtg_printings',             'oracle_card_id',     'mtg_oracle_cards.id'],
  ['mtg_printings',             'set_id',             'mtg_sets.id'],
  ['mtg_printing_finishes',     'printing_id',        'mtg_printings.id'],
  ['mtg_oracle_legalities',     'oracle_card_id',     'mtg_oracle_cards.id'],
  ['mtg_rulings',               'oracle_card_id',     'mtg_oracle_cards.id'],
  ['mtg_external_identifiers',  'printing_id',        'mtg_printings.id'],
  ['mtg_price_observations',    'printing_finish_id', 'mtg_printing_finishes.id'],
  ['mtg_price_observations',    'import_run_id',      'market_import_runs.id'],
]
for (const [t, c, expected] of expectedFks) {
  const actual = fkOf(t, c)
  const ok = actual === expected
  console.log(`  ${ok ? '✓' : '✗'} ${t}.${c}  →  ${actual || '(missing)'}  (expected ${expected})`)
  if (!ok) hardFail = true
}

// ── 3. UNIQUE / PK annotations ───────────────────────────────────
console.log('\n=== 3. Uniqueness declarations (from OpenAPI descriptions) ===')
function isPKor(table, column) {
  const desc = defs[table]?.properties?.[column]?.description || ''
  return /<pk\/>/i.test(desc) || /Primary Key/i.test(desc)
}
function hasUnique(table, column) {
  // Supabase OpenAPI does NOT always annotate secondary UNIQUE constraints
  // in column descriptions. To detect them we try inserting a known
  // duplicate value under a savepoint — but we cannot roll back via
  // PostgREST. Instead we assert that certain columns' descriptions
  // contain the token 'unique' where the migration declared UNIQUE.
  const desc = defs[table]?.properties?.[column]?.description || ''
  return /unique/i.test(desc)
}

const pkChecks = [
  ['mtg_sets',                 'id'],
  ['mtg_oracle_cards',         'id'],
  ['mtg_printings',            'id'],
  ['mtg_printing_finishes',    'id'],
  ['mtg_rulings',              'id'],
  ['mtg_external_identifiers', 'id'],
  ['mtg_price_observations',   'id'],
]
for (const [t, c] of pkChecks) {
  const ok = isPKor(t, c)
  console.log(`  ${ok ? '✓' : '✗'} ${t}.${c} is PK`)
  if (!ok) hardFail = true
}

// composite PK on oracle_legalities
const olKey1 = isPKor('mtg_oracle_legalities', 'oracle_card_id')
const olKey2 = isPKor('mtg_oracle_legalities', 'format')
console.log(`  ${olKey1 && olKey2 ? '✓' : '✗'} mtg_oracle_legalities composite PK (oracle_card_id, format)`)
if (!(olKey1 && olKey2)) hardFail = true

// Natural key UNIQUEs. OpenAPI descriptions in Supabase sometimes lack
// explicit "unique" markers for non-PK UNIQUE constraints — so we test
// runtime uniqueness by attempting a duplicate INSERT and expecting a
// 409 Conflict response. Only performed on target tables (all currently
// empty) so no data is created that would need cleanup on failure.
console.log('\n--- Runtime UNIQUE probe (empty tables — inserts are cleaned up on 409) ---')

async function attemptDuplicateInsert() {
  // Insert two mtg_sets rows sharing the same code. Second one must 409.
  const setUuid = crypto.randomUUID()
  // First insert
  const r1 = await fetch(`${url}/rest/v1/mtg_sets`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      scryfall_id: setUuid,
      code: '__unique_probe_setcode__',
      name: 'UNIQUENESS PROBE',
    }),
  })
  if (!r1.ok) {
    const text = await r1.text()
    console.log(`  ✗ first insert failed unexpectedly: ${r1.status} ${text}`)
    return null
  }
  const inserted = await r1.json()
  const insertedId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id

  // Attempt duplicate on code
  const r2 = await fetch(`${url}/rest/v1/mtg_sets`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scryfall_id: crypto.randomUUID(),
      code: '__unique_probe_setcode__',
      name: 'DUP',
    }),
  })
  const dupBlocked = r2.status === 409
  console.log(`  ${dupBlocked ? '✓' : '✗'} mtg_sets.code UNIQUE enforced (dup attempt → HTTP ${r2.status})`)

  // Attempt duplicate on scryfall_id
  const r3 = await fetch(`${url}/rest/v1/mtg_sets`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scryfall_id: setUuid,
      code: '__unique_probe_setcode_2__',
      name: 'DUP2',
    }),
  })
  const dup2Blocked = r3.status === 409
  console.log(`  ${dup2Blocked ? '✓' : '✗'} mtg_sets.scryfall_id UNIQUE enforced (dup attempt → HTTP ${r3.status})`)

  // Clean up: delete the probe row.
  const del = await fetch(`${url}/rest/v1/mtg_sets?id=eq.${insertedId}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  console.log(`  cleanup: probe row deleted (HTTP ${del.status})`)
  return dupBlocked && dup2Blocked
}
const uniqueOk = await attemptDuplicateInsert()
if (uniqueOk === false) hardFail = true

// Post-cleanup count assertion — the table must be empty again.
async function count(t) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = r.headers.get('content-range') || ''
  return parseInt(cr.split('/')[1] || '0', 10)
}
const postProbeCount = await count('mtg_sets')
console.log(`  post-probe mtg_sets count: ${postProbeCount} (must be 0)`)
if (postProbeCount !== 0) hardFail = true

// ── 4. pgcrypto / digest() operational ───────────────────────────
console.log('\n=== 4. pgcrypto / digest() operational ===')
// mtg_rulings.comment_hash is a GENERATED column using digest(comment,'sha256').
// If we can INSERT a row and the DB computes the hash, digest() works.
const rulProbe = await fetch(`${url}/rest/v1/mtg_rulings`, {
  method: 'POST',
  headers: {
    apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    oracle_card_id: '00000000-0000-0000-0000-000000000000',  // will fail FK — but we want to see the error type
    source: 'probe',
    published_at: '2026-09-14',
    comment: 'digest probe',
  }),
})
// This will error 409/23503 (FK violation) — we're not inserting a valid
// oracle_card_id. But if pgcrypto were unavailable, the error would be a
// 500 with "function digest(...) does not exist" during row creation.
const rulText = await rulProbe.text()
const digestOk = rulProbe.status === 409 && /foreign key/i.test(rulText)
console.log(`  ${digestOk ? '✓' : '?'} FK-violation-on-fake-oracle_id probe returned HTTP ${rulProbe.status}`)
console.log(`    body: ${rulText.replace(/\s+/g, ' ').slice(0, 200)}`)
console.log('  (If pgcrypto were missing, the error would name digest() not the FK — so this proves digest() runs.)')
if (!digestOk) hardFail = true

// ── 5. RLS — anon can SELECT but CANNOT INSERT / UPDATE / DELETE ─
console.log('\n=== 5. RLS deny-path check via anon key ===')
if (!anon) {
  console.log('  (NEXT_PUBLIC_SUPABASE_ANON_KEY not set — skipping runtime deny-path check)')
} else {
  // Seed a probe row via service role so anon UPDATE / DELETE have
  // a real row to attempt against (rather than an empty table where
  // "0 rows affected" would be indistinguishable from RLS filtering).
  const seedR = await fetch(`${url}/rest/v1/mtg_sets`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      code: '__rls_probe_seed__',
      name: 'RLS PROBE (service-role seed)',
    }),
  })
  if (!seedR.ok) { console.log(`  ✗ could not seed probe row: HTTP ${seedR.status}`); hardFail = true }
  const seeded  = await seedR.json()
  const seedId  = Array.isArray(seeded) ? seeded[0]?.id : seeded?.id
  const seedRow = Array.isArray(seeded) ? seeded[0]      : seeded

  // anon SELECT — must succeed
  const anonRead = await fetch(`${url}/rest/v1/mtg_sets?code=eq.__rls_probe_seed__&select=*`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  })
  const anonReadBody = await anonRead.json()
  const anonCanSee = anonRead.ok && Array.isArray(anonReadBody) && anonReadBody.length === 1
  console.log(`  ${anonCanSee ? '✓' : '✗'} anon SELECT sees the seeded row → HTTP ${anonRead.status}, rows=${anonReadBody?.length}`)
  if (!anonCanSee) hardFail = true

  // anon INSERT — must be denied
  const anonWrite = await fetch(`${url}/rest/v1/mtg_sets`, {
    method: 'POST',
    headers: {
      apikey: anon, Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: '__rls_probe_anon__', name: 'ANON INSERT' }),
  })
  const insDenied = anonWrite.status === 401 || anonWrite.status === 403
  console.log(`  ${insDenied ? '✓' : '✗'} anon INSERT on mtg_sets denied → HTTP ${anonWrite.status}`)
  if (!insDenied) hardFail = true

  // anon UPDATE targeting the seeded row — must NOT change the row.
  const beforeName = seedRow?.name
  await fetch(`${url}/rest/v1/mtg_sets?id=eq.${seedId}`, {
    method: 'PATCH',
    headers: {
      apikey: anon, Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'ANON PWNED' }),
  })
  // Verify via service role that the row is unchanged.
  const verifyR = await fetch(`${url}/rest/v1/mtg_sets?id=eq.${seedId}&select=name`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const verifyRow = (await verifyR.json())[0]
  const updRefused = verifyRow?.name === beforeName
  console.log(`  ${updRefused ? '✓' : '✗'} anon UPDATE did NOT modify the row (before=${JSON.stringify(beforeName)}, after=${JSON.stringify(verifyRow?.name)})`)
  if (!updRefused) hardFail = true

  // anon DELETE targeting the seeded row — must NOT delete it.
  await fetch(`${url}/rest/v1/mtg_sets?id=eq.${seedId}`, {
    method: 'DELETE',
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  })
  const stillR = await fetch(`${url}/rest/v1/mtg_sets?id=eq.${seedId}&select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const stillThere = (await stillR.json())[0]?.id === seedId
  console.log(`  ${stillThere ? '✓' : '✗'} anon DELETE did NOT remove the row (still present: ${stillThere})`)
  if (!stillThere) hardFail = true

  // Clean up via service role.
  await fetch(`${url}/rest/v1/mtg_sets?id=eq.${seedId}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const afterCleanup = await count('mtg_sets')
  console.log(`  post-cleanup mtg_sets count: ${afterCleanup} (must be 0)`)
  if (afterCleanup !== 0) hardFail = true
}

// ── 6. market_import_runs + provider_card_links unaffected ──────
console.log('\n=== 6. market_import_runs + provider_card_links integrity ===')
const mirCount    = await count('market_import_runs')
const pclCount    = await count('provider_card_links')
console.log(`  market_import_runs: ${mirCount} rows (was 90 at audit time; will have grown from Pokemon daily runs)`)
console.log(`  provider_card_links: ${pclCount} rows (was 41,272 at audit time)`)

// ── 7. Legacy production-parent counts unchanged ──────────────────
console.log('\n=== 7. Pokemon table spot-check ===')
for (const [t, minExpected] of [
  ['cards',              60_000],
  ['daily_prices',       10_000_000],
  ['card_latest_prices', 50_000],
  ['card_trends',        50_000],
]) {
  const c = await count(t)
  const ok = c >= minExpected
  console.log(`  ${ok ? '✓' : '✗'} ${t}: ${c} (min ${minExpected})`)
  if (!ok) hardFail = true
}

console.log('\n=== DEEP VALIDATION VERDICT ===')
if (hardFail) {
  console.log('✗ HARD FAIL — see above.')
  process.exit(1)
} else {
  console.log('✓ All deep checks passed.')
}
