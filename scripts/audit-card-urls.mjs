#!/usr/bin/env node
// scripts/audit-card-urls.mjs
//
// URL-integrity crawl for MTGPrices.io.
//
// Pulls a representative sample from Supabase (SELECT-only) and fetches
// each derived /set/{setCode}/card/{collectorNumber}-{slug} URL against
// production. Prints a summary + writes a JSON report.
//
// Read-only. GET-only. Rate limited at 3 concurrent, 100ms jitter.
//
// Usage:
//   node scripts/audit-card-urls.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// -------- env bootstrap (.env.local) --------
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
try {
  const envFile = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (!(k in process.env)) process.env[k] = v.replace(/^"|"$/g, '')
  }
} catch (e) {
  console.error('Could not read .env.local:', e.message)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const SITE = 'https://mtgprices.io'
const UA   = 'Mozilla/5.0 (compatible; MTGPricesAudit/1.0; +https://mtgprices.io)'

// -------- slug helpers (copied verbatim from src/lib/mtg/slug.ts) --------
function slugifyCardName(name) {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
function buildCardSlug(collectorNumber, cardName) {
  return `${collectorNumber}-${slugifyCardName(cardName)}`
}

// -------- utilities --------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = () => 50 + Math.floor(Math.random() * 100) // 50–150ms

/** Simple bounded concurrency queue. */
async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length)
  let cursor = 0
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (true) {
      const i = cursor++
      if (i >= tasks.length) return
      await sleep(jitter())
      try {
        results[i] = await tasks[i]()
      } catch (e) {
        results[i] = { error: e?.message || String(e) }
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function fetchStatus(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent': UA,
        'accept': 'text/html,*/*;q=0.9',
      },
    })
    let bodyHead = null
    if (res.status < 200 || res.status >= 300) {
      try {
        const text = await res.text()
        bodyHead = text.slice(0, 200).replace(/\s+/g, ' ')
      } catch {}
    }
    return { status: res.status, bodyHead }
  } catch (e) {
    return { status: 0, bodyHead: e?.message || String(e) }
  }
}

// -------- popular / iconic logical card list --------
// 50 iconic cards spanning colours, eras, and formats. We resolve each
// name against mtg_oracle_cards, then pick ONE printing (most recent
// standard-ish printing preferred, else most recent English printing).
const LOGICAL_NAMES = [
  'Black Lotus',
  'Mox Ruby',
  'Mox Sapphire',
  'Time Walk',
  'Ancestral Recall',
  'Force of Will',
  'Lightning Bolt',
  'Counterspell',
  'Brainstorm',
  'Ponder',
  'Wasteland',
  'Rishadan Port',
  'Chalice of the Void',
  'Sensei’s Divining Top',
  'Sword of Fire and Ice',
  'Umezawa’s Jitte',
  'Snapcaster Mage',
  'Tarmogoyf',
  'Dark Confidant',
  'Liliana of the Veil',
  'Thoughtseize',
  'Fatal Push',
  'Path to Exile',
  'Swords to Plowshares',
  'Emrakul, the Aeons Torn',
  'Ulamog, the Ceaseless Hunger',
  'Griselbrand',
  'Sheoldred, the Apocalypse',
  'The One Ring',
  'Orcish Bowmasters',
  'Ragavan, Nimble Pilferer',
  'Fable of the Mirror-Breaker',
  'Ledger Shredder',
  'Skrelv’s Hive',
  'Wrenn and Six',
  'Uro, Titan of Nature’s Wrath',
  'Oko, Thief of Crowns',
  'Teferi, Time Raveler',
  'Solitude',
  'Grief',
  'Fury',
  'Ephemerate',
  'Thassa’s Oracle',
  'Consecrated Sphinx',
  'Rhystic Study',
  'Smothering Tithe',
  'Cyclonic Rift',
  'Sol Ring',
  'Mana Crypt',
  'Jeweled Lotus',
]

// Rank a printing row for "most representative standard-ish" selection.
// Prefer non-promo, non-digital, non-variation English printings with a
// recent released_at date; break ties by lower rarity weight.
function scorePrinting(p) {
  let s = 0
  if (p.lang && p.lang !== 'en') s -= 1000
  if (p.digital) s -= 500
  if (p.promo) s -= 30
  if (p.variation) s -= 30
  if (p.textless) s -= 15
  if (p.borderless) s -= 5
  if (p.full_art) s -= 5
  if (p.released_at) {
    const y = Number(p.released_at.slice(0, 4))
    if (Number.isFinite(y)) s += y // recent > old
  }
  const rarityRank = { mythic: 3, rare: 2, uncommon: 1, common: 0 }[p.rarity ?? ''] ?? 0
  s += rarityRank * 0.1
  return s
}

async function pickLogicalCards() {
  const out = []
  const missing = []
  for (const name of LOGICAL_NAMES) {
    // Look up by exact oracle name (case-sensitive fine — canonical spellings above).
    const { data: oracles, error: oErr } = await supabase
      .from('mtg_oracle_cards')
      .select('id, name')
      .eq('name', name)
      .limit(1)
    if (oErr) {
      missing.push({ name, reason: `oracle lookup error: ${oErr.message}` })
      continue
    }
    let oracleId = oracles?.[0]?.id ?? null
    if (!oracleId) {
      // Fall back: ilike, in case of apostrophe / hyphen variations.
      const { data: fuzzy } = await supabase
        .from('mtg_oracle_cards')
        .select('id, name')
        .ilike('name', name.replace(/’/g, "'"))
        .limit(1)
      oracleId = fuzzy?.[0]?.id ?? null
    }
    if (!oracleId) {
      missing.push({ name, reason: 'no oracle row' })
      continue
    }
    const { data: prints, error: pErr } = await supabase
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, released_at, lang, rarity, promo, digital, variation, textless, borderless, full_art')
      .eq('oracle_card_id', oracleId)
      .eq('lang', 'en')
      .eq('digital', false)
      .not('collector_number', 'is', null)
      .limit(200)
    if (pErr) {
      missing.push({ name, reason: `printings error: ${pErr.message}` })
      continue
    }
    if (!prints || prints.length === 0) {
      missing.push({ name, reason: 'no printings' })
      continue
    }
    prints.sort((a, b) => scorePrinting(b) - scorePrinting(a))
    const chosen = prints[0]
    out.push({
      bucket: 'logical',
      oracle_name: name,
      set_code: chosen.set_code,
      collector_number: chosen.collector_number,
      card_name: chosen.name,
      released_at: chosen.released_at,
    })
  }
  return { picked: out, missing }
}

async function pickExactPrintings(count) {
  // Random sample: page-count is huge, so use PostgREST random ordering via
  // a modest offset-scan across several segments. To keep it simple &
  // read-only, pull a chunk with different offsets/orderings and pick
  // random items in-process.
  const chunks = []
  // Modern chunk (recent).
  {
    const { data } = await supabase
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, released_at, rarity, lang, digital')
      .eq('lang', 'en').eq('digital', false)
      .not('collector_number', 'is', null)
      .gte('released_at', '2015-01-01')
      .order('released_at', { ascending: false })
      .limit(1500)
    if (data) chunks.push(...data)
  }
  // Middle era.
  {
    const { data } = await supabase
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, released_at, rarity, lang, digital')
      .eq('lang', 'en').eq('digital', false)
      .not('collector_number', 'is', null)
      .gte('released_at', '2000-01-01').lt('released_at', '2015-01-01')
      .order('released_at', { ascending: false })
      .limit(1500)
    if (data) chunks.push(...data)
  }
  // Vintage / legacy pre-2000.
  const vintageChunk = []
  {
    const { data } = await supabase
      .from('mtg_printings')
      .select('id, name, set_code, collector_number, released_at, rarity, lang, digital')
      .eq('lang', 'en').eq('digital', false)
      .not('collector_number', 'is', null)
      .lt('released_at', '2000-01-01')
      .order('released_at', { ascending: false })
      .limit(1500)
    if (data) { chunks.push(...data); vintageChunk.push(...data) }
  }

  // Ensure ≥10 vintage picks.
  const vintagePicks = []
  const seen = new Set()
  while (vintagePicks.length < Math.min(10, vintageChunk.length)) {
    const p = vintageChunk[Math.floor(Math.random() * vintageChunk.length)]
    if (seen.has(p.id)) continue
    seen.add(p.id)
    vintagePicks.push(p)
  }

  // Fill remaining with random picks from all chunks, deduped by id.
  const rest = []
  const need = count - vintagePicks.length
  const pool = chunks.filter((p) => !seen.has(p.id))
  while (rest.length < need && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length)
    const [p] = pool.splice(idx, 1)
    if (seen.has(p.id)) continue
    seen.add(p.id)
    rest.push(p)
  }

  return [...vintagePicks, ...rest].map((p) => ({
    bucket: 'exact-printing',
    set_code: p.set_code,
    collector_number: p.collector_number,
    card_name: p.name,
    released_at: p.released_at,
  }))
}

async function pickSetLinks(count) {
  // Pull ~200 candidate sets, shuffle, take `count`.
  const { data: sets, error } = await supabase
    .from('mtg_sets')
    .select('code, name, released_at, set_type')
    .not('code', 'is', null)
    .order('released_at', { ascending: false, nullsFirst: false })
    .limit(500)
  if (error || !sets || sets.length === 0) return []

  const shuffled = [...sets].sort(() => Math.random() - 0.5)
  const out = []
  for (const s of shuffled) {
    if (out.length >= count) break
    // Match the /set page's ordering exactly: lang=en, digital=false,
    // order by collector_number ASC, limit 1.
    const { data: first } = await supabase
      .from('mtg_printings')
      .select('name, set_code, collector_number')
      .eq('set_code', s.code)
      .eq('lang', 'en')
      .eq('digital', false)
      .not('collector_number', 'is', null)
      .order('collector_number', { ascending: true })
      .limit(1)
    const p = first?.[0]
    if (!p) continue
    out.push({
      bucket: 'set-link',
      set_code: p.set_code,
      collector_number: p.collector_number,
      card_name: p.name,
      released_at: null,
      via_set: s.code,
      via_set_name: s.name,
    })
  }
  return out
}

function toUrl(row) {
  const slug = buildCardSlug(row.collector_number, row.card_name)
  return `${SITE}/set/${row.set_code}/card/${slug}`
}

function classifyStatus(s) {
  if (s >= 200 && s < 300) return '2xx'
  if (s >= 300 && s < 400) return '3xx'
  if (s >= 400 && s < 500) return '4xx'
  if (s >= 500 && s < 600) return '5xx'
  return 'err'
}

// -------- main --------
(async () => {
  const t0 = Date.now()
  console.log('Pulling sample from Supabase...')
  const [{ picked: logical, missing }, exact, setLinks] = await Promise.all([
    pickLogicalCards(),
    pickExactPrintings(50),
    pickSetLinks(20),
  ])

  if (missing.length > 0) {
    console.log(`\nLogical picks: ${missing.length} unresolved:`)
    for (const m of missing) console.log(`  - ${m.name}: ${m.reason}`)
  }

  const sample = [...logical, ...exact, ...setLinks].map((row) => ({
    ...row,
    url: toUrl(row),
  }))
  console.log(`\nSample sizes: logical=${logical.length} exact=${exact.length} setLinks=${setLinks.length} total=${sample.length}`)

  // Fetch with concurrency=3.
  console.log('\nFetching URLs (concurrency=3, jitter=50–150ms)...')
  const tasks = sample.map((row) => async () => {
    const { status, bodyHead } = await fetchStatus(row.url)
    return { ...row, status, bodyHead }
  })
  const results = await runPool(tasks, 3)

  // Summary.
  const buckets = { logical: {}, 'exact-printing': {}, 'set-link': {} }
  const failures = []
  for (const r of results) {
    const cls = classifyStatus(r.status)
    buckets[r.bucket][cls] = (buckets[r.bucket][cls] ?? 0) + 1
    if (cls !== '2xx') failures.push(r)
  }

  const fmtRow = (label, b) => `  ${label.padEnd(16)} 2xx=${(b['2xx']??0).toString().padStart(3)}  3xx=${(b['3xx']??0).toString().padStart(3)}  4xx=${(b['4xx']??0).toString().padStart(3)}  5xx=${(b['5xx']??0).toString().padStart(3)}  err=${(b['err']??0).toString().padStart(3)}`
  console.log('\nStatus summary by bucket:')
  console.log(fmtRow('logical',        buckets.logical))
  console.log(fmtRow('exact-printing', buckets['exact-printing']))
  console.log(fmtRow('set-link',       buckets['set-link']))

  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`)
    for (const f of failures) {
      console.log(`  [${f.status}] (${f.bucket}) ${f.url}`)
      if (f.bodyHead) console.log(`         body: ${f.bodyHead}`)
    }
  } else {
    console.log('\nAll fetched URLs returned 2xx.')
  }

  // Write JSON report.
  const outPath = resolve(repoRoot, 'docs/audit/card-url-crawl.json')
  mkdirSync(dirname(outPath), { recursive: true })
  const report = {
    generatedAt: new Date().toISOString(),
    site: SITE,
    counts: {
      logical:         buckets.logical,
      'exact-printing': buckets['exact-printing'],
      'set-link':      buckets['set-link'],
      total: sample.length,
      failures: failures.length,
    },
    unresolved_logical_names: missing,
    sample: results.map((r) => ({
      url: r.url,
      status: r.status,
      bucket: r.bucket,
      set_code: r.set_code,
      collector_number: r.collector_number,
      card_name: r.card_name,
      oracle_name: r.oracle_name ?? null,
      via_set: r.via_set ?? null,
      body_head: r.bodyHead ?? null,
    })),
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\nReport: ${outPath}`)
  console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
})().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
