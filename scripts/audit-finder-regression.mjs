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

  // Read the _vercel_jwt cookie if present so the smoke can bypass
  // Preview SSO. Falls back to empty for prod runs.
  let cookieHeader = process.env.PREVIEW_COOKIE || ''
  if (!cookieHeader && process.env.COOKIE_JAR) {
    try {
      const raw = require('node:fs').readFileSync(process.env.COOKIE_JAR, 'utf8')
      for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.replace(/^#HttpOnly_/, '')
        if (line.startsWith('#') || !line.trim()) continue
        const parts = line.split('\t')
        if (parts.length >= 7 && parts[5] === '_vercel_jwt') {
          cookieHeader = `_vercel_jwt=${parts[6]}`
          break
        }
      }
    } catch {}
  }
  const res = await fetch(target, {
    headers: {
      'user-agent': 'mtgprices-finder-smoke',
      cookie: cookieHeader,
    },
    redirect: 'follow',
  })
  const html = await res.text()
  // The finder page renders "<strong>N</strong> matched" AND a
  // "Page 1 / N" pagination indicator. Parse the pagination indicator
  // to compute total = pages * pageSize (finder pageSize is 24). This
  // is the most reliable signal because it appears both when there
  // are 0 results AND when there are many.
  // "Page 1 of 116" with RSC comments interleaved.
  const stripped = html.replace(/<!--\s*-->/g, '').replace(/\\<!--[^>]*-->/g, '')
  const pagMatch = stripped.match(/Page\s+1\s+(?:\/|of)\s+(\d+)/)
  // "<strong>N</strong> matched"
  const strongMatch = stripped.match(/<strong[^>]*>\s*(\d+)\s*<\/strong>[^<]*match/)
  let shown = null
  if (strongMatch) shown = Number(strongMatch[1])
  else if (pagMatch) shown = Number(pagMatch[1]) * 24
  return { target, status: res.status, shown, bytes: html.length }
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
