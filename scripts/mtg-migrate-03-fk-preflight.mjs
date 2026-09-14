#!/usr/bin/env node
// Read-only preflight: verify every distinct mtg_cards.set_code has a
// matching mtg_sets.code (required by the FK in the migration).

import { readFileSync } from 'node:fs'
const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

async function fetchColumn(table, column) {
  const out = new Set()
  let offset = 0
  while (true) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${column}&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    const arr = await r.json()
    if (!Array.isArray(arr) || arr.length === 0) break
    for (const row of arr) if (row[column]) out.add(row[column])
    offset += arr.length
    if (arr.length < 1000) break
  }
  return out
}

const setCodes = await fetchColumn('mtg_sets', 'code')
const cardSetCodes = await fetchColumn('mtg_cards', 'set_code')
console.log(`mtg_sets.code distinct values: ${setCodes.size}`)
console.log(`mtg_cards.set_code distinct values: ${cardSetCodes.size}`)

const orphan = [...cardSetCodes].filter(c => !setCodes.has(c))
console.log(`mtg_cards.set_code values NOT in mtg_sets.code: ${orphan.length}`)
if (orphan.length > 0) {
  console.log('  sample orphans:', orphan.slice(0, 10))
}
