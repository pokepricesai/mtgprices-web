#!/usr/bin/env node
// Read-only: inspect columns + row counts + samples for each MTG-
// prefixed table, plus a few generic-infra candidates (provider,
// import-run, latest-price) that MTG might want to reuse.

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

// From OpenAPI spec we can pull the column list per table.
const specRes = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
})
const spec = await specRes.json()
const defs = spec.definitions || {}

const targets = [
  'mtg_sets', 'mtg_cards', 'mtg_card_trends', 'mtg_daily_prices',
  'provider_card_links', 'market_import_runs',
  'cards', 'sets', 'daily_prices', 'card_latest_prices',
  'card_trends', 'popular_card_trends',
]

async function head(t) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = r.headers.get('content-range') || ''
  const total = cr.split('/')[1]
  let sample = null
  try {
    const arr = await r.json()
    sample = Array.isArray(arr) && arr[0] ? arr[0] : null
  } catch {}
  return { total, sample }
}

function sanitize(row) {
  if (!row) return null
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (v == null) { out[k] = null; continue }
    if (typeof v === 'string') {
      out[k] = v.length > 140 ? v.slice(0, 140) + '…' : v
    } else if (typeof v === 'object') {
      try { out[k] = JSON.stringify(v).slice(0, 200) + (JSON.stringify(v).length > 200 ? '…' : '') }
      catch { out[k] = '[unserializable]' }
    } else out[k] = v
  }
  return out
}

for (const t of targets) {
  console.log(`\n=== ${t} ===`)
  const def = defs[t]
  if (!def) { console.log('  (no definition in OpenAPI spec)'); continue }
  const props = def.properties || {}
  const required = new Set(def.required || [])
  const cols = Object.entries(props).map(([n, p]) => {
    const type = p.type || (p.format || '?')
    const fmt = p.format ? ` (${p.format})` : ''
    const desc = p.description ? ` — ${p.description.replace(/\n/g, ' ').slice(0, 120)}` : ''
    const req = required.has(n) ? ' NOT NULL' : ''
    return `    ${n}: ${type}${fmt}${req}${desc}`
  })
  console.log(`  columns (${cols.length}):`)
  for (const c of cols) console.log(c)
  const { total, sample } = await head(t)
  console.log(`  row count (exact): ${total}`)
  if (sample) {
    const s = sanitize(sample)
    console.log(`  sample row (sanitised):`)
    for (const [k, v] of Object.entries(s)) console.log(`    ${k} = ${JSON.stringify(v)}`)
  }
}
