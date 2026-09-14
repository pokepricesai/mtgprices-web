#!/usr/bin/env node
// Read-only Supabase audit for MTG-related database objects.
// Uses the Postgres RPC exec_sql only if it exists; otherwise falls
// back to information_schema queries via the REST API. NEVER writes.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing Supabase env vars')
const supa = createClient(url, key)

// PostgREST introspection: query information_schema.tables via the
// exposed "columns" endpoint isn't possible directly; but Supabase
// exposes `pg_meta` under /pg/. We instead try the /rest/v1/rpc/
// path for a read-only helper if it exists, and otherwise probe by
// selecting from candidate table names.

async function listAllTables() {
  // Use the Postgres system view via a direct SELECT against
  // information_schema.tables. PostgREST exposes it if the schema
  // is added. Try that first.
  const r = await fetch(`${url}/rest/v1/information_schema_tables?select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (r.ok) return await r.json()
  return null
}

// Fallback: enumerate the OpenAPI spec, which lists every table the
// PostgREST service knows about.
async function listTablesFromOpenApi() {
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!r.ok) throw new Error(`OpenAPI ${r.status}`)
  const spec = await r.json()
  const paths = spec.paths || {}
  const names = Object.keys(paths)
    .filter(p => p.startsWith('/') && p.length > 1 && !p.startsWith('/rpc/'))
    .map(p => p.slice(1))
    .sort()
  return { tables: names, definitions: spec.definitions || {}, paths }
}

const oa = await listTablesFromOpenApi()
const tables = oa.tables

console.log(`Total tables/views exposed via PostgREST: ${tables.length}`)
console.log('---')

const mtgLike = tables.filter(t => /^mtg[_-]|magic|scryfall|mtgjson|_mtg$/i.test(t))
console.log(`MTG-like tables/views (${mtgLike.length}):`)
for (const t of mtgLike) console.log(`  ${t}`)
console.log('---')

// Also show anything that ISN'T obviously Pokemon-scoped — helpful
// for spotting generic infra that MTG might reuse.
console.log('All top-level tables/views (for reference):')
for (const t of tables) console.log(`  ${t}`)
