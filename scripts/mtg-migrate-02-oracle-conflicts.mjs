#!/usr/bin/env node
// Read-only Oracle-conflict analysis. Paginates through mtg_cards,
// groups by oracle_id, and counts how many oracle_ids show
// disagreement between printings on Oracle-level fields. Informs the
// deterministic tiebreaker for the DISTINCT ON backfill.
//
// Also reports how many rows would be excluded if we required
// `oracle_id IS NOT NULL`.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

async function fetchAll() {
  // Stable pagination: ORDER BY id ensures every row is returned
  // exactly once. Without this, PostgREST + PostgreSQL can return
  // duplicate rows across pages and undercount distinct values.
  const rows = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const r = await fetch(
      `${url}/rest/v1/mtg_cards?select=id,oracle_id,name,mana_cost,cmc,type_line,oracle_text,power,toughness,loyalty,colors,color_identity,keywords,legalities,released_at&order=id.asc&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    )
    const arr = await r.json()
    if (!Array.isArray(arr) || arr.length === 0) break
    for (const row of arr) rows.push(row)
    offset += arr.length
    if (arr.length < pageSize) break
    if (offset % 10000 === 0) process.stderr.write(`.`)
  }
  process.stderr.write('\n')
  return rows
}

console.log('Fetching all mtg_cards rows (this takes ~1–2 minutes)...')
const rows = await fetchAll()
console.log(`Fetched ${rows.length} printing rows.`)

const withOracle = rows.filter(r => r.oracle_id)
const withoutOracle = rows.length - withOracle.length
console.log(`  rows without oracle_id: ${withoutOracle}`)

const groups = new Map()
for (const r of withOracle) {
  if (!groups.has(r.oracle_id)) groups.set(r.oracle_id, [])
  groups.get(r.oracle_id).push(r)
}
console.log(`  distinct oracle_ids: ${groups.size}`)

// Field-level conflict counts.
const fields = [
  'name', 'mana_cost', 'cmc', 'type_line', 'oracle_text',
  'power', 'toughness', 'loyalty',
  'colors', 'color_identity', 'keywords',
  'legalities',
]

const conflicts = Object.fromEntries(fields.map(f => [f, 0]))
const oracleIdsWithAnyConflict = new Set()

function jsonKey(v) {
  if (v == null) return '<null>'
  if (Array.isArray(v)) return JSON.stringify([...v].sort())
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

for (const [oid, printings] of groups) {
  if (printings.length < 2) continue
  for (const f of fields) {
    const seen = new Set()
    for (const p of printings) seen.add(jsonKey(p[f]))
    if (seen.size > 1) {
      conflicts[f]++
      oracleIdsWithAnyConflict.add(oid)
    }
  }
}

console.log('\n=== Oracle-level conflicts across printings ===')
console.log(`  oracle_ids with 2+ printings: ${[...groups.values()].filter(a => a.length >= 2).length}`)
console.log(`  oracle_ids with ANY field conflict: ${oracleIdsWithAnyConflict.size}`)
console.log('\n  Field-level conflict counts (oracle_ids where printings disagree):')
for (const [f, n] of Object.entries(conflicts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${f.padEnd(16)} ${n}`)
}

// Legalities are the biggest concern — Scryfall updates format
// legality over time, so older printings snapshot different values.
// Show a sample of legality conflicts.
console.log('\n=== Sample legalities-conflict oracle_ids (first 3) ===')
let shown = 0
for (const [oid, printings] of groups) {
  if (shown >= 3) break
  if (printings.length < 2) continue
  const seen = new Map()
  for (const p of printings) {
    const k = jsonKey(p.legalities)
    if (!seen.has(k)) seen.set(k, [])
    seen.get(k).push(p.released_at)
  }
  if (seen.size < 2) continue
  const name = printings[0].name
  console.log(`  oracle_id=${oid} name=${name}`)
  let i = 0
  for (const [_k, dates] of seen) {
    console.log(`    variant ${++i}: ${dates.length} printings, earliest ${dates.sort()[0]}, latest ${dates.sort().slice(-1)[0]}`)
  }
  shown++
}

// Recommended tiebreaker: freshest printing per oracle_id, i.e.
// ORDER BY released_at DESC NULLS LAST, id DESC. Report how many
// oracle_ids would have their "freshest" pick land on a printing
// released in the last 3 years vs. earlier.
console.log('\n=== Freshest-printing distribution per oracle_id ===')
const cutoff = new Date('2023-01-01').getTime()
let recent = 0, old = 0, none = 0
for (const [_oid, printings] of groups) {
  const withDate = printings.filter(p => p.released_at)
  if (withDate.length === 0) { none++; continue }
  withDate.sort((a, b) => (b.released_at || '').localeCompare(a.released_at || ''))
  const d = withDate[0].released_at
  if (new Date(d).getTime() >= cutoff) recent++
  else old++
}
console.log(`  freshest printing released 2023-01-01 or later: ${recent}`)
console.log(`  freshest printing released before 2023-01-01: ${old}`)
console.log(`  no released_at on any printing: ${none}`)
