#!/usr/bin/env node
// scripts/tcggraph-lorcana-probe.mjs
//
// Slice 4 Phase A live verification. Hits the following read-only
// endpoints against api.tcggraph.com/v1 to confirm the shape of
// Disney Lorcana support BEFORE we run any bulk bootstrap. Each call
// costs 1-2 credits (~10 credits total).
//
//   1. GET /games                     - confirm Lorcana slug + card/set counts
//   2. GET /sets?game=<lorcana-slug>  - list a page of Lorcana sets
//   3. GET /cards?game=<slug>&limit=5 - dump 5 Lorcana card payloads verbatim
//   4. GET /cards?game=<slug>&limit=1 with the highest-value-looking card so we
//      can see graded/market-price shape.
//
// Nothing is written to Supabase. Every raw sample is persisted under
// .tmp/lorcana-probe/ for inspection.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadEnv, requireEnv, tcgFetch } from './lib/tcggraph-ingest.mjs'

loadEnv()
requireEnv('TCGGRAPH_API_KEY')

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_DIR = join(REPO_ROOT, '.tmp', 'lorcana-probe')
mkdirSync(OUT_DIR, { recursive: true })

function dump(name, obj) {
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(obj, null, 2))
}

function summariseGame(g) {
  return {
    id: g.id, name: g.name, slug: g.slug,
    activeCardCount: g.activeCardCount ?? g.cardCount ?? null,
    activeSetCount:  g.activeSetCount  ?? g.setCount  ?? null,
    // catch-all so we don't miss a field
    _keys: Object.keys(g),
  }
}

async function main() {
  console.log('[probe] step 1: /games ...')
  const games = await tcgFetch('/games')
  console.log(`  http=${games.status}  cost=${games.cost}  daily_remaining=${games.dailyRemaining}`)
  dump('01-games', games)

  const list = games.body?.data ?? []
  const summary = list.map(summariseGame)
  console.log('  games seen:')
  for (const g of summary) console.log('    ', JSON.stringify(g))

  const lorcana = list.find((g) => {
    const hay = `${g.slug} ${g.name} ${g.id}`.toLowerCase()
    return hay.includes('lorcana')
  })
  if (!lorcana) {
    console.log('  !! Lorcana NOT found in /games response.')
    process.exit(3)
  }
  const slug = lorcana.slug
  console.log(`  Lorcana slug = ${slug}`)

  console.log(`[probe] step 2: /sets?game=${slug} ...`)
  const sets = await tcgFetch('/sets', { game: slug, limit: 100 })
  console.log(`  http=${sets.status}  cost=${sets.cost}  daily_remaining=${sets.dailyRemaining}`)
  dump('02-sets', sets)
  const setList = sets.body?.data ?? []
  console.log(`  sets returned: ${setList.length}`)
  for (const s of setList.slice(0, 12)) {
    console.log(`    ${s.code}  ${s.name}  released=${s.releasedAt ?? '(unknown)'}`)
  }
  if (setList.length > 12) console.log(`    ... and ${setList.length - 12} more`)

  console.log(`[probe] step 3: /cards?game=${slug}&limit=5 ...`)
  const sample = await tcgFetch('/cards', { game: slug, limit: 5, page: 1 })
  console.log(`  http=${sample.status}  cost=${sample.cost}  daily_remaining=${sample.dailyRemaining}`)
  dump('03-cards-first-5', sample)

  const cards = sample.body?.data ?? []
  console.log(`  cards returned: ${cards.length}`)
  console.log(`  meta: ${JSON.stringify(sample.body?.meta ?? {})}`)
  for (const c of cards) {
    console.log(`    ${c.id}  ${c.name}  set=${c.set?.code}  cn=${c.collectorNumber}  rarity=${c.rarity}`)
    console.log(`      printings=${(c.printings ?? []).map((p) => p.key).join(',')}`)
    console.log(`      prices=${(c.prices ?? []).length}   gradedPrices=${(c.gradedPrices ?? []).length}`)
    console.log(`      gameData keys=${Object.keys(c.gameData ?? {}).join(',')}`)
  }

  // Field enumeration across the sample.
  const allCardKeys = new Set()
  const allGameDataKeys = new Set()
  const allPrintingKinds = new Set()
  const allPrintingKeys = new Set()
  const allMarketSources = new Set()
  const allMarketFields = new Set()
  const allGraders = new Set()
  for (const c of cards) {
    for (const k of Object.keys(c)) allCardKeys.add(k)
    for (const k of Object.keys(c.gameData ?? {})) allGameDataKeys.add(k)
    for (const p of c.printings ?? []) {
      allPrintingKinds.add(p.kind ?? '(no kind)')
      allPrintingKeys.add(p.key ?? '(no key)')
    }
    for (const p of c.prices ?? []) {
      allMarketSources.add(p.source ?? '(no source)')
      for (const k of Object.keys(p)) allMarketFields.add(k)
    }
    for (const g of c.gradedPrices ?? []) allGraders.add(g.grader ?? '(no grader)')
  }
  console.log('\n[probe] enumerated across sample of 5:')
  console.log(`  card top-level keys:     ${[...allCardKeys].join(', ')}`)
  console.log(`  card.gameData keys:      ${[...allGameDataKeys].join(', ')}`)
  console.log(`  printing.kind values:    ${[...allPrintingKinds].join(', ')}`)
  console.log(`  printing.key values:     ${[...allPrintingKeys].join(', ')}`)
  console.log(`  price.source values:     ${[...allMarketSources].join(', ')}`)
  console.log(`  price fields:            ${[...allMarketFields].join(', ')}`)
  console.log(`  grader values:           ${[...allGraders].join(', ')}`)

  // Grab a large page (100) to see rarity distribution + treatment names.
  console.log(`\n[probe] step 4: /cards?game=${slug}&limit=100 (rarity / treatment survey) ...`)
  const big = await tcgFetch('/cards', { game: slug, limit: 100, page: 1 })
  console.log(`  http=${big.status}  cost=${big.cost}  daily_remaining=${big.dailyRemaining}`)
  dump('04-cards-page1-100', big)
  const bigCards = big.body?.data ?? []
  const rarityCount = new Map()
  const printingKeyCount = new Map()
  const gradersSeen = new Map()
  const marketSourceCount = new Map()
  let gradedCardCount = 0
  for (const c of bigCards) {
    const r = c.rarity ?? '(none)'
    rarityCount.set(r, (rarityCount.get(r) ?? 0) + 1)
    for (const p of c.printings ?? []) {
      const k = p.key ?? '(none)'
      printingKeyCount.set(k, (printingKeyCount.get(k) ?? 0) + 1)
    }
    for (const p of c.prices ?? []) {
      const s = p.source ?? '(none)'
      marketSourceCount.set(s, (marketSourceCount.get(s) ?? 0) + 1)
    }
    if ((c.gradedPrices ?? []).length > 0) gradedCardCount += 1
    for (const g of c.gradedPrices ?? []) {
      const k = `${g.grader}|${g.grade}`
      gradersSeen.set(k, (gradersSeen.get(k) ?? 0) + 1)
    }
  }
  console.log('  rarity distribution (100 cards):')
  for (const [k, v] of [...rarityCount].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  console.log('  printing keys (100 cards):')
  for (const [k, v] of [...printingKeyCount].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  console.log('  market sources (100 cards):')
  for (const [k, v] of [...marketSourceCount].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  console.log(`  cards WITH gradedPrices in page 1/100: ${gradedCardCount}`)
  console.log('  grader,grade combos seen (100 cards):')
  for (const [k, v] of [...gradersSeen].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)

  console.log(`\n[probe] done.  raw samples: ${OUT_DIR}`)
  console.log(`  monthly / daily remaining after probe: ${big.creditsRemaining} / ${big.dailyRemaining}`)
}

main().catch((err) => { console.error('[probe] FATAL:', err.message); process.exit(1) })
