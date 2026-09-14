#!/usr/bin/env node
// Read-only validation after applying
// migrations/2026-09-14-mtg-target-schema-and-backfill.sql
// (clean-start revision — renames legacy tables to *_legacy_20260327
//  and creates 8 empty production tables).
//
// Post-apply expected state:
//   * Four legacy archive tables exist with row counts preserved:
//       mtg_sets_legacy_20260327          1,029
//       mtg_cards_legacy_20260327         104,505
//       mtg_daily_prices_legacy_20260327  98,250
//       mtg_card_trends_legacy_20260327   0
//   * The old unsuffixed names (mtg_sets, mtg_cards, mtg_daily_prices,
//     mtg_card_trends) — well, mtg_sets, mtg_cards, mtg_daily_prices,
//     mtg_card_trends — must NOT still exist as the original tables.
//     `mtg_sets` DOES exist post-migration but as the NEW empty
//     production table.
//   * Eight new production tables exist, all empty:
//       mtg_sets, mtg_oracle_cards, mtg_printings,
//       mtg_printing_finishes, mtg_oracle_legalities, mtg_rulings,
//       mtg_external_identifiers, mtg_price_observations
//   * Pokemon-side tables are unchanged.

import { readFileSync } from 'node:fs'
const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── Detect apply state ────────────────────────────────────────────
const spec = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
}).then(r => r.json())
const paths = spec.paths || {}
const defs  = spec.definitions || {}
const tables = new Set(Object.keys(paths).filter(p => p.startsWith('/') && p.length > 1 && !p.startsWith('/rpc/')).map(p => p.slice(1)))

const legacy8 = [
  'mtg_sets_legacy_20260327',
  'mtg_cards_legacy_20260327',
  'mtg_daily_prices_legacy_20260327',
  'mtg_card_trends_legacy_20260327',
]
const prod8 = [
  'mtg_sets',
  'mtg_oracle_cards',
  'mtg_printings',
  'mtg_printing_finishes',
  'mtg_oracle_legalities',
  'mtg_rulings',
  'mtg_external_identifiers',
  'mtg_price_observations',
]

const legacyMissing = legacy8.filter(t => !tables.has(t))
const prodMissing   = prod8.filter(t => !tables.has(t))

if (legacyMissing.length > 0 || prodMissing.length > 0) {
  console.log('=== MIGRATION NOT YET APPLIED (or applied incompletely) ===')
  if (legacyMissing.length > 0) {
    console.log('  Missing legacy archive tables:')
    for (const t of legacyMissing) console.log(`    - ${t}`)
  }
  if (prodMissing.length > 0) {
    console.log('  Missing new production tables:')
    for (const t of prodMissing) console.log(`    - ${t}`)
  }
  console.log('\nApply migrations/2026-09-14-mtg-target-schema-and-backfill.sql')
  console.log('in the Supabase SQL Editor, then re-run this probe.')
  process.exit(0)
}
console.log('=== MIGRATION APPLIED — running clean-start validation ===\n')

async function count(t, filter = '') {
  const suffix = filter ? `&${filter}` : ''
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0${suffix}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = r.headers.get('content-range') || ''
  return parseInt(cr.split('/')[1] || '0', 10)
}

let hardFail = false

// ── 1. Legacy archive tables — data preserved verbatim ───────────
console.log('--- 1. Legacy archive tables (row counts must be preserved) ---')
const legacyExpected = {
  mtg_sets_legacy_20260327:         1029,
  mtg_cards_legacy_20260327:        104505,
  mtg_daily_prices_legacy_20260327: 98250,
  mtg_card_trends_legacy_20260327:  0,
}
for (const [t, expected] of Object.entries(legacyExpected)) {
  const c = await count(t)
  const ok = c === expected ? '✓' : '✗'
  console.log(`  ${ok} ${t}: ${c} (expected ${expected})`)
  if (c !== expected) hardFail = true
}

// ── 2. New production tables — ALL empty ─────────────────────────
console.log('\n--- 2. New production tables (all must be EMPTY) ---')
for (const t of prod8) {
  const c = await count(t)
  const ok = c === 0 ? '✓' : '✗'
  console.log(`  ${ok} ${t}: ${c} rows`)
  if (c !== 0) hardFail = true
}

// ── 3. Pokemon tables unchanged (spot-check ranges) ──────────────
console.log('\n--- 3. Pokemon tables (must still be populated at expected scale) ---')
for (const [t, minExpected] of [
  ['cards',              60_000],
  ['daily_prices',       10_000_000],
  ['card_latest_prices', 50_000],
]) {
  const c = await count(t)
  const ok = c >= minExpected
  console.log(`  ${ok ? '✓' : '✗'} ${t}: ${c} rows (must be ≥ ${minExpected})`)
  if (!ok) hardFail = true
}

// ── 4. Column shape verification ─────────────────────────────────
console.log('\n--- 4. Column-shape verification (from PostgREST spec) ---')
for (const [t, expectedCols] of [
  ['mtg_sets', ['id', 'scryfall_id', 'code', 'name', 'set_type', 'released_at', 'card_count', 'digital', 'foil_only', 'nonfoil_only', 'icon_svg_uri', 'scryfall_uri', 'parent_set_code', 'block', 'block_code', 'created_at', 'updated_at']],
  ['mtg_oracle_cards', ['id', 'oracle_id', 'name', 'mana_cost', 'mana_value', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'colors', 'color_identity', 'keywords', 'produced_mana', 'reserved', 'layout', 'game_changer', 'card_faces', 'created_at', 'updated_at']],
  ['mtg_printings',    ['id', 'oracle_card_id', 'set_id', 'scryfall_id', 'set_code', 'collector_number', 'lang', 'name', 'layout', 'rarity', 'artist', 'illustration_id', 'image_uri', 'image_uri_small', 'art_crop_uri', 'promo', 'reprint', 'variation', 'full_art', 'borderless', 'textless', 'digital', 'released_at', 'scryfall_uri', 'created_at', 'updated_at']],
  ['mtg_printing_finishes', ['id', 'printing_id', 'finish', 'created_at']],
  ['mtg_oracle_legalities', ['oracle_card_id', 'format', 'legality', 'updated_at']],
  ['mtg_rulings', ['id', 'oracle_card_id', 'source', 'published_at', 'comment', 'comment_hash', 'created_at']],
  ['mtg_external_identifiers', ['id', 'printing_id', 'provider', 'identifier_type', 'identifier_value', 'created_at', 'updated_at']],
  ['mtg_price_observations', ['id', 'printing_finish_id', 'observed_on', 'provider', 'ingestion_source', 'market', 'currency', 'price_type', 'condition', 'price', 'import_run_id', 'source_reference', 'is_anomalous', 'created_at']],
]) {
  const props = defs[t]?.properties || {}
  const missing = expectedCols.filter(c => !(c in props))
  const extra   = Object.keys(props).filter(c => !expectedCols.includes(c))
  const ok = missing.length === 0
  console.log(`  ${ok ? '✓' : '✗'} ${t}: ${Object.keys(props).length} columns; missing=[${missing.join(', ') || '-'}]; extra=[${extra.join(', ') || '-'}]`)
  if (missing.length > 0) hardFail = true
}

// ── 5. FK signatures (verify via OpenAPI descriptions) ───────────
console.log('\n--- 5. FK signatures ---')
const printingsProps = defs['mtg_printings']?.properties || {}
const setIdDesc      = printingsProps.set_id?.description || ''
const oracleFkDesc   = printingsProps.oracle_card_id?.description || ''
const mirIdType      = defs['market_import_runs']?.properties?.id?.format
const priceImpType   = defs['mtg_price_observations']?.properties?.import_run_id?.format
console.log(`  mtg_printings.set_id → mtg_sets(id):            ${/mtg_sets['".]/.test(setIdDesc) ? '✓' : '?'} (OpenAPI: ${setIdDesc.slice(0, 80).replace(/\n/g, ' ')})`)
console.log(`  mtg_printings.oracle_card_id → mtg_oracle_cards(id): ${/mtg_oracle_cards['".]/.test(oracleFkDesc) ? '✓' : '?'}`)
console.log(`  mtg_price_observations.import_run_id → market_import_runs(id): uuid↔uuid = ${mirIdType === 'uuid' && priceImpType === 'uuid' ? '✓' : '✗'}`)

// ── Verdict ──────────────────────────────────────────────────────
console.log('\n=== CLEAN-START VALIDATION VERDICT ===')
if (hardFail) {
  console.log('✗ HARD FAIL — see failures above.')
  process.exit(1)
} else {
  console.log('✓ All clean-start checks passed. Ready for Stage 1B (fresh Scryfall ingestion).')
}
