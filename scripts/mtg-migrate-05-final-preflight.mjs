#!/usr/bin/env node
// Stage 1A FINAL pre-apply preflight — read-only.
//
// Verifies (before the migration is applied):
//   * every mtg_cards.id is a valid UUID     (exhaustive, not sampled)
//   * every mtg_cards.oracle_id is a valid UUID (exhaustive)
//   * no NULL oracle_id                       (exhaustive)
//   * no duplicate mtg_cards.id               (exhaustive; PK already prevents)
//   * no duplicate mtg_cards.scryfall printing identity
//   * every mtg_cards.set_code has a matching mtg_sets.code
//   * mtg_daily_prices.date is Postgres DATE (via OpenAPI format hint)
//
// Also dynamically selects one representative row for each of:
//   ordinary creature, legendary creature, instant, sorcery,
//   planeswalker, transform (DFC), modal_dfc, split, adventure,
//   basic land, reserved card, printing with nonfoil available,
//   printing with foil available, printing with etched pricing.
//
// Reports actual card name, Scryfall ID, layout, type_line and flags.
//
// If any invalid UUID or missing set_code is found, this script
// exits non-zero and the operator MUST NOT apply the migration.

import { readFileSync } from 'node:fs'
const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function fetchAll(select, table = 'mtg_cards', orderCol = 'id') {
  // IMPORTANT: PostgREST + PostgreSQL do NOT guarantee stable page
  // ordering across LIMIT/OFFSET requests unless an ORDER BY is
  // specified. Without it, the same row can appear on multiple pages
  // (and others can be skipped), which produces bogus "duplicate"
  // counts. Always include an explicit &order= for exhaustive scans.
  const rows = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}&order=${orderCol}.asc&limit=${pageSize}&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    const arr = await r.json()
    if (!Array.isArray(arr) || arr.length === 0) break
    for (const row of arr) rows.push(row)
    offset += arr.length
    if (arr.length < pageSize) break
  }
  return rows
}

async function fetchOne(table, filter, select = '*') {
  const r = await fetch(`${url}/rest/v1/${table}?select=${select}&${filter}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const arr = await r.json()
  return Array.isArray(arr) && arr[0] ? arr[0] : null
}

let hardFail = false

// ── 1. Exhaustive UUID / dupe / oracle-null validation ─────────────
console.log('=== 1. Exhaustive UUID + duplicate validation on mtg_cards ===')
console.log('  Fetching all 104,505 rows (streamed, ~1 minute)...')
const idRows = await fetchAll('id,oracle_id,set_code')
console.log(`  Fetched ${idRows.length} rows.`)

const invalidIds = idRows.filter(r => !r.id || !UUID_RE.test(r.id))
const invalidOracle = idRows.filter(r => !r.oracle_id || !UUID_RE.test(r.oracle_id))
const nullOracle = idRows.filter(r => r.oracle_id == null)
const idSet = new Set()
const dupIds = []
for (const r of idRows) {
  if (idSet.has(r.id)) dupIds.push(r.id)
  else idSet.add(r.id)
}

console.log(`  invalid mtg_cards.id (UUID):          ${invalidIds.length}`)
console.log(`  invalid mtg_cards.oracle_id (UUID):   ${invalidOracle.length}`)
console.log(`  NULL mtg_cards.oracle_id:             ${nullOracle.length}`)
console.log(`  duplicate mtg_cards.id (beyond PK):   ${dupIds.length}`)
const oracleIdSet = new Set(idRows.map(r => r.oracle_id))
console.log(`  distinct mtg_cards.oracle_id:         ${oracleIdSet.size} (= expected mtg_oracle_cards row count)`)

if (invalidIds.length > 0) {
  hardFail = true
  console.log('  ✗ HARD FAIL — sample invalid ids:')
  for (const r of invalidIds.slice(0, 5)) console.log(`      "${r.id}"`)
}
if (invalidOracle.length > 0) {
  hardFail = true
  console.log('  ✗ HARD FAIL — sample invalid oracle_ids:')
  for (const r of invalidOracle.slice(0, 5)) console.log(`      "${r.oracle_id}"`)
}
if (nullOracle.length > 0) {
  hardFail = true
  console.log('  ✗ HARD FAIL — mtg_cards rows with NULL oracle_id exist.')
}
if (dupIds.length > 0) {
  hardFail = true
  console.log('  ✗ HARD FAIL — duplicate mtg_cards.id values (should be impossible via PK).')
}
if (!hardFail) console.log('  ✓ All UUID / duplicate / null checks passed.')

// ── 2. Set FK coverage ─────────────────────────────────────────────
console.log('\n=== 2. Set FK coverage — every mtg_cards.set_code has an mtg_sets.code ===')
const setCodes = new Set((await fetchAll('code', 'mtg_sets', 'code')).map(r => r.code))
const usedSetCodes = new Set(idRows.map(r => r.set_code).filter(Boolean))
const missingSetCodes = [...usedSetCodes].filter(c => !setCodes.has(c))
console.log(`  distinct set_codes in mtg_cards: ${usedSetCodes.size}`)
console.log(`  distinct codes in mtg_sets:      ${setCodes.size}`)
console.log(`  set_codes used but missing:      ${missingSetCodes.length}`)
if (missingSetCodes.length > 0) {
  hardFail = true
  console.log('  ✗ HARD FAIL — sample missing:')
  for (const c of missingSetCodes.slice(0, 10)) console.log(`      "${c}"`)
} else {
  console.log('  ✓ Every used set_code exists in mtg_sets.')
}

// ── 3. Duplicate Scryfall printing identity beyond PK ──────────────
console.log('\n=== 3. Duplicate Scryfall printing identity beyond PK ===')
console.log('  (mtg_cards.id IS the Scryfall printing UUID; PK already prevents dupes.')
console.log('   This check is defensive and expected to report 0.)')
console.log(`  duplicate mtg_cards.id observed: ${dupIds.length}`)

// ── 4. mtg_daily_prices.date type check via OpenAPI spec ───────────
console.log('\n=== 4. mtg_daily_prices.date PostgreSQL type ===')
const spec = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
}).then(r => r.json())
const dateColProp = spec.definitions?.['mtg_daily_prices']?.properties?.date
console.log(`  OpenAPI reports: type=${dateColProp?.type} format=${dateColProp?.format}`)
// PostgREST convention: format:'date' ⇔ PostgreSQL DATE type.
// format:'date-time' would indicate timestamptz/timestamp. If we saw
// no format, it would indicate TEXT.
if (dateColProp?.format === 'date') {
  console.log('  ✓ Column is DATE. No cast needed in the migration.')
} else if (dateColProp?.format === 'date-time') {
  console.log('  ⚠ Column is TIMESTAMP-shaped. Migration should cast dp.date::date.')
} else {
  console.log(`  ⚠ Column is TEXT-like (format=${dateColProp?.format ?? 'none'}). Migration must cast dp.date::date.`)
}
// Extra: fetch one sample value and confirm ISO-date shape.
const sample = await fetchOne('mtg_daily_prices', 'select=date&limit=1', 'date')
console.log(`  sample date value: "${sample?.date}" (length ${sample?.date?.length})`)
if (sample && /^\d{4}-\d{2}-\d{2}$/.test(sample.date)) {
  console.log('  ✓ Sample value is a plain YYYY-MM-DD string — consistent with DATE.')
} else {
  console.log('  ⚠ Sample value is not a plain YYYY-MM-DD string. Investigate.')
}

// ── 5. Dynamic representative-card selection ───────────────────────
console.log('\n=== 5. Representative MTG objects (dynamically selected from the DB) ===')

async function pickBy(label, filters) {
  // filters is an array of PostgREST filter strings to AND together.
  const q = filters.join('&')
  const r = await fetch(`${url}/rest/v1/mtg_cards?select=id,name,set_code,collector_number,layout,type_line,rarity,reserved,foil,nonfoil&${q}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const arr = await r.json()
  const hit = arr[0]
  if (!hit) {
    console.log(`  ${label.padEnd(28)} — no matching row found (filters: ${q})`)
    return null
  }
  console.log(`  ${label.padEnd(28)} ${hit.name}`)
  console.log(`  ${' '.repeat(30)} scryfall_id=${hit.id}`)
  console.log(`  ${' '.repeat(30)} set=${hit.set_code} #${hit.collector_number} layout=${hit.layout}`)
  console.log(`  ${' '.repeat(30)} type_line="${(hit.type_line || '').slice(0, 60)}"`)
  console.log(`  ${' '.repeat(30)} reserved=${hit.reserved} nonfoil=${hit.nonfoil} foil=${hit.foil}`)
  return hit
}

// Ordinary creature: type_line begins "Creature" (not "Legendary" and
// not "Artifact Creature") and layout=normal.
await pickBy('ordinary creature',
  ['type_line=like.Creature*', 'layout=eq.normal'])

// Legendary creature.
await pickBy('legendary creature',
  ['type_line=like.Legendary Creature*'])

// Instant / Sorcery.
await pickBy('instant',
  ['type_line=like.Instant*'])
await pickBy('sorcery',
  ['type_line=like.Sorcery*'])

// Planeswalker.
await pickBy('planeswalker',
  ['type_line=like.*Planeswalker*'])

// Transform (DFC).
await pickBy('transform (DFC)',
  ['layout=eq.transform'])

// Modal DFC.
await pickBy('modal_dfc',
  ['layout=eq.modal_dfc'])

// Split.
await pickBy('split',
  ['layout=eq.split'])

// Adventure.
await pickBy('adventure',
  ['layout=eq.adventure'])

// Basic land.
await pickBy('basic land',
  ['type_line=like.Basic Land*'])

// Reserved list card.
await pickBy('reserved card',
  ['reserved=eq.true'])

// Printing with nonfoil.
await pickBy('printing with nonfoil',
  ['nonfoil=eq.true'])

// Printing with foil.
await pickBy('printing with foil',
  ['foil=eq.true'])

// Printing with etched pricing evidence — pick a mtg_daily_prices
// row with usd_etched, then look up the card.
{
  const dp = await fetchOne('mtg_daily_prices', 'usd_etched=not.is.null', 'card_id,usd_etched')
  if (dp) {
    const hit = await fetchOne('mtg_cards', `id=eq.${dp.card_id}`,
      'id,name,set_code,collector_number,layout,type_line,foil,nonfoil')
    console.log(`  ${'etched pricing evidence'.padEnd(28)} ${hit.name}`)
    console.log(`  ${' '.repeat(30)} scryfall_id=${hit.id}`)
    console.log(`  ${' '.repeat(30)} set=${hit.set_code} #${hit.collector_number} layout=${hit.layout}`)
    console.log(`  ${' '.repeat(30)} legacy usd_etched=$${dp.usd_etched}`)
  }
}

// ── Verdict ────────────────────────────────────────────────────────
console.log('\n=== FINAL VERDICT ===')
if (hardFail) {
  console.log('✗ HARD FAIL — DO NOT apply the migration until the errors above are resolved.')
  process.exit(1)
} else {
  console.log('✓ All preflight checks passed. Migration is safe to apply.')
}
