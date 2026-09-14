#!/usr/bin/env node
// Deeper read-only probes: MTG price date range, Oracle/printing
// cardinality, currency/finish coverage, missing IDs, duplicates,
// and the current import-run history.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const envRaw = readFileSync('.env.local', 'utf8')
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const supa = createClient(url, key)

async function count(table, filter = '') {
  const q = filter ? `${url}/rest/v1/${table}?${filter}` : `${url}/rest/v1/${table}?select=*`
  const r = await fetch(q + (filter.includes('select=') ? '' : (filter ? '&' : '?') + 'select=*'), {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  })
  const cr = r.headers.get('content-range') || ''
  return cr.split('/')[1]
}

console.log('=== mtg_daily_prices — date coverage ===')
// Min / max date via order + limit 1
const dOldest = await fetch(`${url}/rest/v1/mtg_daily_prices?select=date&order=date.asc&limit=1`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
const dNewest = await fetch(`${url}/rest/v1/mtg_daily_prices?select=date&order=date.desc&limit=1`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
console.log(`  earliest date: ${dOldest[0]?.date}`)
console.log(`  latest date:   ${dNewest[0]?.date}`)

console.log('\n=== mtg_daily_prices — finish coverage ===')
for (const col of ['usd', 'usd_foil', 'usd_etched', 'eur', 'eur_foil', 'tix']) {
  const cnt = await count('mtg_daily_prices', `${col}=not.is.null`)
  console.log(`  non-null ${col}: ${cnt}`)
}

console.log('\n=== mtg_cards — Oracle vs printing cardinality ===')
console.log(`  distinct printings (id): 104505 (from earlier)`)
// Approximate distinct oracle_ids via range paging + Set — expensive
// on 100k rows so instead fetch a sample.
const oidSample = await fetch(`${url}/rest/v1/mtg_cards?select=oracle_id&limit=10000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
const distinctSample = new Set(oidSample.map(r => r.oracle_id).filter(Boolean)).size
console.log(`  distinct oracle_id in first 10,000 printings: ${distinctSample}`)

// Missing oracle_id count
const missingOracle = await count('mtg_cards', 'oracle_id=is.null')
console.log(`  printings missing oracle_id: ${missingOracle}`)

// Languages
console.log('\n=== mtg_cards — language coverage ===')
const langSample = await fetch(`${url}/rest/v1/mtg_cards?select=lang&limit=20000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
const langCounts = {}
for (const r of langSample) langCounts[r.lang || '(null)'] = (langCounts[r.lang || '(null)'] || 0) + 1
console.log(`  lang distribution in first 20k rows:`)
for (const [l, n] of Object.entries(langCounts).sort((a,b)=>b[1]-a[1])) console.log(`    ${l}: ${n}`)

console.log('\n=== mtg_cards — layouts ===')
const layoutSample = await fetch(`${url}/rest/v1/mtg_cards?select=layout&limit=20000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
const layoutCounts = {}
for (const r of layoutSample) layoutCounts[r.layout || '(null)'] = (layoutCounts[r.layout || '(null)'] || 0) + 1
console.log(`  layout distribution in first 20k rows:`)
for (const [l, n] of Object.entries(layoutCounts).sort((a,b)=>b[1]-a[1])) console.log(`    ${l}: ${n}`)

console.log('\n=== mtg_cards — card_faces presence (for MDFC/DFC/adventure/split) ===')
const facesNonNull = await count('mtg_cards', 'card_faces=not.is.null')
console.log(`  rows with card_faces populated: ${facesNonNull}`)

console.log('\n=== mtg_daily_prices — coverage vs mtg_cards ===')
// distinct card_ids in prices vs cards
const priceIdSample = await fetch(`${url}/rest/v1/mtg_daily_prices?select=card_id&limit=100000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
const distinctPriceIds = new Set(priceIdSample.map(r => r.card_id)).size
console.log(`  distinct card_id in first 100k price rows: ${distinctPriceIds}`)

console.log('\n=== market_import_runs — MTG provider history ===')
const runs = await fetch(`${url}/rest/v1/market_import_runs?select=provider,source,status,started_at,rows_ok&order=started_at.desc&limit=20`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
console.log(`  last 20 import runs (any provider):`)
for (const r of runs) console.log(`    ${r.started_at} ${r.provider}/${r.source} ${r.status} rows_ok=${r.rows_ok}`)

console.log('\n=== provider_card_links — MTG entries ===')
const mtgProviders = ['scryfall', 'mtgjson', 'tcgplayer', 'cardmarket']
for (const p of mtgProviders) {
  const c = await count('provider_card_links', `provider=eq.${p}`)
  console.log(`  provider=${p}: ${c}`)
}

console.log('\n=== provider_card_links — distinct providers ===')
const provSample = await fetch(`${url}/rest/v1/provider_card_links?select=provider&limit=20000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then(r => r.json())
const provCounts = {}
for (const r of provSample) provCounts[r.provider] = (provCounts[r.provider] || 0) + 1
for (const [p, n] of Object.entries(provCounts).sort((a,b)=>b[1]-a[1])) console.log(`    ${p}: ${n}`)
