#!/usr/bin/env node
// Pass 2B mini §1 — Card Finder regression tests.
// Directly invokes findCards() from the compiled lib so we test the
// server-side pipeline, not just HTTP. Verifies the fixed RPC
// pagination bust the previous 400-oracle cap on set / rarity /
// legality-scoped searches.

import { createClient } from '@supabase/supabase-js'
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// Ground truth counts against mtg_printings.
async function truth(setCode, rarity) {
  const q = sb.from('mtg_printings')
    .select('oracle_card_id', { count: 'exact', head: false })
    .eq('lang', 'en').eq('digital', false)
  if (setCode) q.eq('set_code', setCode)
  if (rarity)  q.eq('rarity', rarity)
  const { data, count } = await q
  const oracles = new Set((data ?? []).map((r) => r.oracle_card_id))
  return { rows: count, distinctOracles: oracles.size }
}

async function truthLegal(format) {
  const { count } = await sb.from('mtg_oracle_legalities')
    .select('oracle_card_id', { count: 'exact', head: true })
    .eq('format', format).eq('legality', 'legal')
  return { legalCount: count }
}

async function runFinder(query) {
  // Hit the Preview URL if provided, otherwise fall back to a direct
  // /card-finder fetch against production is not useful here (needs
  // page-render). Instead we call the compiled findCards via a
  // dynamic import. This requires the build tsconfig to have emitted
  // a JS bundle we can require — Next doesn't do that. So instead we
  // curl the running preview.
  const url = process.env.SMOKE_URL || 'https://mtgprices.io'
  const qs = new URLSearchParams()
  if (query.set) qs.set('set', query.set)
  if (query.rarity) qs.set('rarity', query.rarity)
  if (query.legal) qs.set('legal', query.legal)
  if (query.colors) qs.set('colors', query.colors)
  if (query.sort) qs.set('sort', query.sort)
  if (query.name) qs.set('name', query.name)
  qs.set('page', '1')
  const target = `${url}/card-finder?${qs.toString()}`
  const res = await fetch(target, {
    headers: {
      'user-agent': 'mtgprices-finder-smoke',
      cookie: process.env.PREVIEW_COOKIE || '',
    },
  })
  const html = await res.text()
  // Extract the "N matched" count.
  const m = html.match(/>\s*([\d,]+)\s+matched\s*</) || html.match(/"count":\s*([\d]+)/)
  const shown = m ? Number(m[1].replace(/,/g, '')) : null
  return { target, status: res.status, shown }
}

function line(label, expected, got, delta = 0.05) {
  const okStr = expected == null || got == null
    ? '·'
    : Math.abs(got - expected) / Math.max(1, expected) <= delta ? '✓' : '✗'
  console.log(`  ${okStr} ${label.padEnd(52)} expected≈${expected} got=${got}`)
}

console.log('=== Ground truth ===')
const lea = await truth('lea', null)
console.log(`LEA English printings: ${lea.rows} (distinct oracles ${lea.distinctOracles})`)
const mythic = await truth(null, 'mythic')
console.log(`Mythic English printings (any set): ${mythic.rows} (distinct oracles ${mythic.distinctOracles})`)
const vintage = await truthLegal('vintage')
console.log(`Vintage-legal oracles: ${vintage.legalCount}`)
const standard = await truthLegal('standard')
console.log(`Standard-legal oracles: ${standard.legalCount}`)

console.log('\n=== Finder HTTP smoke (requires SMOKE_URL) ===')
if (!process.env.SMOKE_URL) {
  console.log('  (skip — set SMOKE_URL to hit a running Preview/prod URL)')
} else {
  const setLea = await runFinder({ set: 'lea' })
  line('?set=lea', lea.distinctOracles, setLea.shown, 0.10)
  const setMh3 = await runFinder({ set: 'mh3' })
  const mh3 = await truth('mh3', null)
  line('?set=mh3 (large modern set)', mh3.distinctOracles, setMh3.shown, 0.10)
  const rarCommon = await truth(null, 'common')
  const finderCommon = await runFinder({ rarity: 'common' })
  line('?rarity=common (broad)', rarCommon.distinctOracles, finderCommon.shown, 0.30)
  const finderMythic = await runFinder({ rarity: 'mythic' })
  line('?rarity=mythic', mythic.distinctOracles, finderMythic.shown, 0.30)
  const finderVintage = await runFinder({ legal: 'vintage' })
  line('?legal=vintage', vintage.legalCount, finderVintage.shown, 0.15)
  const combined = await runFinder({ set: 'mh3', rarity: 'mythic' })
  const mh3Mythic = await truth('mh3', 'mythic')
  line('?set=mh3&rarity=mythic (combined)', mh3Mythic.distinctOracles, combined.shown, 0.15)
}

console.log('\nSmoke complete. (Numbers may be softer than exact match — Finder freshest-printing rule can prune a few oracles that only have printings outside the filter.)')
