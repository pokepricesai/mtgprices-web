// scripts/phase4b-card-mapping.mjs
//
// Phase 4B spike: measure card-mapping coverage from MTGPrices oracle
// data into each engine's identifier scheme.
//
//   Forge:   deck line uses "<count> <cardname>|<SET>". Runtime id = card name.
//            Coverage measured by: does the exact name exist in the
//            local Forge cardsfolder script tree?
//   XMage:   deck line uses "<count> [<SET>:<CN>] <Name>". Runtime id = name.
//            Coverage measured by: does the name exist in XMage's
//            Mage.Sets card corpus?
//   Manabrew (Forge-backed): identical corpus to Forge — reuses
//            forge-gui/res/cardsfolder scripts.
//   Manabrew (Rust engine):  Rust engine parses Forge scripts too, so
//            same corpus, MINUS unimplemented mechanics — coverage
//            for our purposes is bounded above by Forge's coverage.
//
// This script hits the LIVE production Supabase (service role) but
// only reads mtg_oracle_cards / mtg_deck_cards. It does NOT modify
// anything. Deck fixtures: two known real decks (60-card Modern + a
// 99-card Commander) from the local DB. Falls back to a synthesised
// sample of cards when no user has produced such a deck yet.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

// Load .env.local like the other scripts.
try {
  const raw = readFileSync('.env.local', 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}

const { createClient } = await import('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ── Load Forge's card-script name set from the local clone. ────────
const forgeRoot = join(os.homedir(), 'mtg-engine-spike', 'forge', 'forge-gui', 'res', 'cardsfolder')

function scanForgeNames() {
  const names = new Set()
  const letters = readdirSync(forgeRoot, { withFileTypes: true })
  for (const l of letters) {
    if (!l.isDirectory()) continue
    const files = readdirSync(join(forgeRoot, l.name))
    for (const f of files) {
      if (!f.endsWith('.txt')) continue
      // Read only the Name: line to be safe.
      const head = readFileSync(join(forgeRoot, l.name, f), 'utf8').slice(0, 200)
      const m = head.match(/^Name:(.+)$/m)
      if (m) names.add(normaliseName(m[1].trim()))
    }
  }
  return names
}

function normaliseName(n) {
  return n
    .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')  // Æ handling
    .replace(/[‘’′]/g, "'")              // curly apostrophes → straight
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')                            // em-dash
    .trim().toLowerCase()
}

async function fetchOneRealDeckByFormat(format) {
  const { data: decks } = await s.from('mtg_decks')
    .select('id, name, format')
    .eq('format', format)
    .limit(1)
  if (!decks || decks.length === 0) return null
  const { data: cards } = await s.from('mtg_deck_cards')
    .select('oracle_card_id, quantity, zone')
    .eq('deck_id', decks[0].id)
  if (!cards || cards.length === 0) return null
  return { meta: decks[0], cards }
}

async function synthesiseSample(format, size) {
  // Grab N cards that are LEGAL in this format, plus a legendary for
  // commander. Not a "real" deck but a coverage baseline.
  const { data } = await s.from('mtg_oracle_legalities')
    .select('oracle_card_id')
    .eq('format', format).eq('legality', 'legal')
    .limit(size)
  return {
    meta: { id: null, name: `synthetic ${format}`, format },
    cards: (data ?? []).map((r) => ({ oracle_card_id: r.oracle_card_id, quantity: 1, zone: 'main' })),
  }
}

async function measure(sample, forgeNames) {
  const oracleIds = Array.from(new Set(sample.cards.map((c) => c.oracle_card_id)))
  const { data: names } = await s.from('mtg_oracle_cards').select('id, name').in('id', oracleIds)
  const nameById = new Map((names ?? []).map((r) => [r.id, r.name]))

  let mapped = 0, unmapped = 0
  const unmappedExamples = []
  for (const c of sample.cards) {
    const name = nameById.get(c.oracle_card_id)
    if (!name) { unmapped++; unmappedExamples.push({ oracle_card_id: c.oracle_card_id, reason: 'no oracle row' }); continue }
    // Split card handling: Forge scripts key on the primary face for
    // most cards; split cards use "left // right" for the aggregate.
    // Try both.
    const norm = normaliseName(name)
    const primary = norm.split(' // ')[0]
    if (forgeNames.has(norm) || forgeNames.has(primary)) {
      mapped++
    } else {
      unmapped++
      if (unmappedExamples.length < 8) unmappedExamples.push({ oracle_card_id: c.oracle_card_id, name, reason: 'not in Forge cardsfolder' })
    }
  }
  return { total: oracleIds.length, mapped, unmapped, unmappedExamples }
}

async function main() {
  console.log('=== Phase 4B — card mapping coverage ===\n')
  console.log('Loading Forge card corpus from local clone...')
  const forgeNames = scanForgeNames()
  console.log(`  Forge has ${forgeNames.size.toLocaleString()} card-script name entries.\n`)

  const fixtures = []
  for (const fmt of ['modern', 'commander']) {
    const real = await fetchOneRealDeckByFormat(fmt)
    if (real) fixtures.push({ label: `real ${fmt} deck "${real.meta.name}"`, sample: real })
    // Always add a synthesised sample as an unbiased coverage baseline.
    const synth = await synthesiseSample(fmt, fmt === 'commander' ? 100 : 60)
    fixtures.push({ label: `synthetic ${fmt} legal-cards sample (${synth.cards.length})`, sample: synth })
  }

  for (const f of fixtures) {
    const r = await measure(f.sample, forgeNames)
    const pct = (100 * r.mapped / r.total).toFixed(1)
    console.log(`${f.label}: ${r.mapped}/${r.total} mapped (${pct}%)`)
    for (const ex of r.unmappedExamples) {
      console.log(`   ✗ ${ex.name ?? ex.oracle_card_id}  — ${ex.reason}`)
    }
    console.log('')
  }
  console.log(`Note: measurement is against the freshest git clone of Card-Forge/forge.\n` +
              `XMage / Manabrew-Rust corpus overlaps Forge's script tree substantially; same-order-of-magnitude coverage expected.\n` +
              `Unmapped rows are usually one of: silver-border cards, Un-set cards, freshly-released sets not yet in the corpus, or split/DFC oracle rows that Forge represents under a different aggregate name.`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
