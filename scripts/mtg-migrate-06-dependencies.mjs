#!/usr/bin/env node
// Dependency probe for the four legacy MTG tables. Read-only.
//
// Confirms which downstream Postgres objects reference:
//   mtg_sets, mtg_cards, mtg_daily_prices, mtg_card_trends
//
// A rename is only safe when we understand every dependency. Because
// PostgreSQL tracks FKs by OID (not name), the rename itself does not
// break declared FKs — but we still need to know about them so the
// report is accurate.

import { readFileSync } from 'node:fs'
const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const spec = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
}).then(r => r.json())
const defs   = spec.definitions || {}
const paths  = spec.paths || {}
const tables = Object.keys(paths).filter(p => p.startsWith('/') && p.length > 1 && !p.startsWith('/rpc/')).map(p => p.slice(1))
const rpcs   = Object.keys(paths).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5))

const legacy = ['mtg_sets', 'mtg_cards', 'mtg_daily_prices', 'mtg_card_trends']

// ── FKs POINTING AT the legacy tables ────────────────────────────
console.log('=== 1. FKs pointing INTO the legacy tables (from PostgREST OpenAPI) ===')
for (const t of tables) {
  const def = defs[t]
  if (!def) continue
  for (const [colName, colProp] of Object.entries(def.properties || {})) {
    const desc = (colProp.description || '')
    // OpenAPI comment format:
    //   "This is a Foreign Key to `mtg_cards.id`.<fk table='mtg_cards' column='id'/>"
    const m = desc.match(/<fk\s+table='([^']+)'\s+column='([^']+)'/)
    if (m && legacy.includes(m[1])) {
      console.log(`  ${t}.${colName}  →  ${m[1]}.${m[2]}`)
    }
  }
}
console.log('  (empty = no external FKs at all)')

// ── VIEWS derived from the legacy tables ─────────────────────────
console.log('\n=== 2. Views / materialised views that reference the legacy tables ===')
// PostgREST does not expose view source SQL, but we can spot any
// object whose name suggests it derives from an MTG legacy table.
const mtgLikeButNotLegacy = tables.filter(t =>
  /^mtg[_-]|_mtg$/i.test(t) && !legacy.includes(t)
)
if (mtgLikeButNotLegacy.length === 0) {
  console.log('  (no MTG-adjacent tables/views other than the four legacy tables)')
} else {
  for (const t of mtgLikeButNotLegacy) console.log(`  ${t}`)
}

// ── RPCs (Postgres functions) whose name suggests MTG ────────────
console.log('\n=== 3. RPCs / functions with mtg-prefixed names ===')
const mtgRpcs = rpcs.filter(r => /^mtg[_-]|_mtg$/i.test(r))
if (mtgRpcs.length === 0) {
  console.log('  (no MTG-named RPCs exposed via PostgREST)')
} else {
  for (const r of mtgRpcs) console.log(`  ${r}`)
}

// ── Legacy row counts (must be preserved through the rename) ─────
console.log('\n=== 4. Legacy row counts (must survive the rename unchanged) ===')
for (const t of legacy) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = r.headers.get('content-range') || ''
  console.log(`  ${t}: ${cr.split('/')[1]}`)
}

// ── pgcrypto / digest() detection ────────────────────────────────
console.log('\n=== 5. pgcrypto / digest() availability (indirect) ===')
// PostgREST does not expose pg_extension. Indirect evidence:
//   * provider_card_links.id is uuid → gen_random_uuid() is callable
//     server-side (which Postgres 13+ provides in core anyway).
//   * Supabase enables pgcrypto by default in every project.
//   * The migration's CREATE EXTENSION IF NOT EXISTS pgcrypto is
//     idempotent — it will silently succeed if already installed and
//     otherwise install it.
//   * A DO $$ ... PERFORM digest('probe', 'sha256'); END $$; block in
//     the migration will raise on apply if digest() is missing, so
//     apply-time failure is fast and loud.
const uuidCols = []
for (const [t, def] of Object.entries(defs)) {
  for (const [cn, cp] of Object.entries(def.properties || {})) {
    if (cp.format === 'uuid') uuidCols.push(`${t}.${cn}`)
  }
}
console.log(`  ${uuidCols.length} existing UUID columns across the DB (implies UUID generator present).`)
console.log('  Migration will `CREATE EXTENSION IF NOT EXISTS pgcrypto` and PERFORM digest() to assert.')

// ── Application-code references ──────────────────────────────────
console.log('\n=== 6. Application-code references (grep) ===')
console.log('  (grep is run separately — see delivery report.)')
