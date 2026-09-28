// scripts/audit-unmapped-printings.mjs
// Diagnostic-only. Identifies MTG tcg_printings rows with a USD current
// market price row but tcg_printings.mtg_printings_id IS NULL, and
// (as of 2026-09-28 the current count is 137 — see
//  docs/audit/unmapped-printings-report.md for the three definitions
//  A=145 / B=140 / C=137)
// attempts three joins in order:
//
//   A) tcgplayer_id-peer-borrow. For each unmapped row with a tcgplayer_id,
//      look for a mapped peer row (same game_id='mtg', same tcgplayer_id,
//      mtg_printings_id IS NOT NULL). If found, borrow that mtg_printings_id.
//      This is the pragmatic replacement for the "mtg_external_ids" join the
//      caller asked for — the schema in this Supabase project uses
//      `tcg_external_ids -> tcg_cards`, NOT a direct external-ids-to-
//      mtg_printings table, so peer-borrow is the closest safe join available.
//   B) cardmarket_id-peer-borrow (same logic on cardmarket_id).
//   C) (tcg_sets.code, tcg_printings.collector_number, tcg_printings.language)
//      -> (mtg_printings.set_code, mtg_printings.collector_number,
//          mtg_printings.lang). mtg_printings carries set_code inline, so no
//      mtg_sets bridge is required.
//
// NEVER writes to tcg_printings. NEVER deletes. Diagnostic only.
// Emits docs/audit/unmapped-printings-report.csv and prints a summary.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const envPath = join(REPO_ROOT, '.env.local')
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const s = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---- Small helpers ---------------------------------------------------------
function csvEscape(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

async function fetchAllRanged(baseFactory) {
  // baseFactory returns a fresh PostgREST builder each call. We paginate range.
  const pageSize = 1000
  let from = 0
  const out = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await baseFactory().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

// ---- Column discovery via SELECT * LIMIT 1 --------------------------------
async function columns(table) {
  const { data, error } = await s.from(table).select('*').limit(1)
  if (error) {
    console.error(`  ! could not introspect ${table}: ${error.message}`)
    return null
  }
  return data && data[0] ? Object.keys(data[0]) : []
}

async function main() {
  console.log('== Column discovery ==')
  const tables = ['tcg_printings', 'tcg_sets', 'mtg_printings', 'mtg_sets', 'tcg_market_prices_current', 'tcg_external_ids']
  const cols = {}
  for (const t of tables) {
    cols[t] = await columns(t)
    console.log(`  ${t.padEnd(28)}:`, cols[t] === null ? '(missing)' : (cols[t].join(', ') || '(empty sample)'))
  }

  // Sanity-log the expected columns for this schema.
  const need = {
    tcg_printings: ['id', 'game_id', 'set_id', 'tcgplayer_id', 'cardmarket_id', 'collector_number', 'language', 'finish', 'mtg_printings_id'],
    tcg_sets: ['id', 'code', 'game_id'],
    mtg_printings: ['id', 'set_code', 'collector_number', 'lang', 'name'],
    tcg_market_prices_current: ['tcg_printing_id', 'game_id', 'currency', 'source', 'price'],
  }
  for (const [t, ns] of Object.entries(need)) {
    for (const c of ns) {
      if (!cols[t] || !cols[t].includes(c)) {
        console.error(`FATAL: expected column ${t}.${c} not present`)
        process.exit(2)
      }
    }
  }

  // ---- Step 1: MTG USD market rows -> unmapped tcg_printings ------------
  console.log('\n== Loading MTG USD market rows ==')
  const mktRows = await fetchAllRanged(() =>
    s.from('tcg_market_prices_current')
     .select('tcg_printing_id, price, source, currency, game_id')
     .eq('game_id', 'mtg')
     .eq('currency', 'USD')
  )
  console.log(`  total MTG USD market rows: ${mktRows.length}`)

  const printingIdSet = new Set(mktRows.map(r => r.tcg_printing_id).filter(Boolean))
  console.log(`  distinct tcg_printing_ids : ${printingIdSet.size}`)

  const maxPriceById = new Map()
  const firstSourceById = new Map()
  const firstPriceById = new Map()
  for (const r of mktRows) {
    const id = r.tcg_printing_id
    if (!id) continue
    const p = Number(r.price)
    if (Number.isFinite(p)) {
      const prev = maxPriceById.get(id)
      if (prev === undefined || p > prev) maxPriceById.set(id, p)
    }
    if (!firstSourceById.has(id) && r.source) firstSourceById.set(id, r.source)
    if (!firstPriceById.has(id) && r.price != null) firstPriceById.set(id, r.price)
  }

  console.log('\n== Loading candidate tcg_printings (unmapped only) ==')
  const ids = [...printingIdSet]
  const chunkSize = 300
  const printings = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data, error } = await s.from('tcg_printings')
      .select('id, game_id, set_id, tcg_card_id, tcgplayer_id, cardmarket_id, collector_number, language, finish, mtg_printings_id, mapping_confidence')
      .in('id', slice)
      .eq('game_id', 'mtg')
      .is('mtg_printings_id', null)
    if (error) throw new Error(`tcg_printings fetch: ${error.message}`)
    printings.push(...(data || []))
  }
  console.log(`  unmapped tcg_printings with MTG USD market row: ${printings.length}`)

  if (printings.length === 0) {
    console.log('Nothing unmapped. Exiting.')
    return
  }

  // ---- Load tcg_sets for these printings --------------------------------
  const setFkVals = [...new Set(printings.map(p => p.set_id).filter(Boolean))]
  const tcgSetById = new Map()
  for (let i = 0; i < setFkVals.length; i += chunkSize) {
    const slice = setFkVals.slice(i, i + chunkSize)
    const { data, error } = await s.from('tcg_sets').select('id, code, game_id').in('id', slice)
    if (error) throw new Error(`tcg_sets fetch: ${error.message}`)
    for (const row of data || []) tcgSetById.set(row.id, row)
  }

  // ---- Join A: tcgplayer_id peer-borrow ---------------------------------
  const tcgIds = [...new Set(printings.map(p => p.tcgplayer_id).filter(v => v != null))]
  console.log(`\n== Join A: peer-borrow via tcgplayer_id (${tcgIds.length} distinct ids) ==`)
  const mappedByTcg = new Map() // tcgplayer_id -> mtg_printings_id
  if (tcgIds.length) {
    for (let i = 0; i < tcgIds.length; i += chunkSize) {
      const slice = tcgIds.slice(i, i + chunkSize)
      const { data, error } = await s.from('tcg_printings')
        .select('tcgplayer_id, mtg_printings_id')
        .eq('game_id', 'mtg')
        .not('mtg_printings_id', 'is', null)
        .in('tcgplayer_id', slice)
      if (error) throw new Error(`peer-borrow A: ${error.message}`)
      for (const row of data || []) {
        const k = String(row.tcgplayer_id)
        if (!mappedByTcg.has(k)) mappedByTcg.set(k, row.mtg_printings_id)
      }
    }
  }
  console.log(`  peer matches: ${mappedByTcg.size}`)

  // ---- Join B: cardmarket_id peer-borrow --------------------------------
  const cmIds = [...new Set(printings.map(p => p.cardmarket_id).filter(v => v != null))]
  console.log(`== Join B: peer-borrow via cardmarket_id (${cmIds.length} distinct ids) ==`)
  const mappedByCm = new Map()
  if (cmIds.length) {
    for (let i = 0; i < cmIds.length; i += chunkSize) {
      const slice = cmIds.slice(i, i + chunkSize)
      const { data, error } = await s.from('tcg_printings')
        .select('cardmarket_id, mtg_printings_id')
        .eq('game_id', 'mtg')
        .not('mtg_printings_id', 'is', null)
        .in('cardmarket_id', slice)
      if (error) throw new Error(`peer-borrow B: ${error.message}`)
      for (const row of data || []) {
        const k = String(row.cardmarket_id)
        if (!mappedByCm.has(k)) mappedByCm.set(k, row.mtg_printings_id)
      }
    }
  }
  console.log(`  peer matches: ${mappedByCm.size}`)

  // ---- Join C: (set_code, collector_number, lang) -> mtg_printings ------
  console.log('\n== Join C: (set_code, collector_number, language) ==')
  const setCodeSet = new Set(
    [...tcgSetById.values()].map(v => (v.code == null ? null : String(v.code).toLowerCase())).filter(Boolean),
  )
  console.log(`  distinct tcg set codes: ${setCodeSet.size}`)

  // Load mtg_printings for these set codes (paginated). set_code appears
  // inline on mtg_printings, so we don't need mtg_sets.
  const setCodeUpper = [...setCodeSet].map(c => c.toUpperCase())
  const setCodeLower = [...setCodeSet]
  // Fetch case-insensitively via ilike-in-or; but the codes are typically already
  // stable in one case. Just try both.
  const mtgKey = (setCode, collector, lang) => `${String(setCode).toLowerCase()}|${String(collector)}|${String(lang || '').toLowerCase()}`
  const mtgKeyNoLang = (setCode, collector) => `${String(setCode).toLowerCase()}|${String(collector)}`
  const byKey = new Map()
  const byKeyNoLang = new Map()

  // Combine both case variants, dedupe.
  const codesForQuery = [...new Set([...setCodeUpper, ...setCodeLower])]
  console.log(`  fetching mtg_printings for ${codesForQuery.length} candidate codes (case-variant union)`)
  const mtgPrintingsFetched = await fetchAllRanged(() =>
    s.from('mtg_printings')
     .select('id, set_code, collector_number, lang, name')
     .in('set_code', codesForQuery)
  )
  console.log(`  loaded ${mtgPrintingsFetched.length} mtg_printings rows`)
  for (const row of mtgPrintingsFetched) {
    const k1 = mtgKey(row.set_code, row.collector_number, row.lang)
    const k2 = mtgKeyNoLang(row.set_code, row.collector_number)
    if (!byKey.has(k1)) byKey.set(k1, row)
    if (!byKeyNoLang.has(k2)) byKeyNoLang.set(k2, row)
  }

  // ---- Resolve each unmapped printing -----------------------------------
  const resCount = { A: 0, B: 0, C: 0, UNRESOLVED: 0 }
  const bySetUnresolved = new Map()
  const bySetAll = new Map()
  const enriched = []

  for (const p of printings) {
    const tcgSet = tcgSetById.get(p.set_id) || {}
    const setCode = tcgSet.code || ''
    const collector = p.collector_number != null ? String(p.collector_number) : ''
    const langRaw = p.language != null ? String(p.language) : ''
    const lang = langRaw.toLowerCase()

    let resolution = 'UNRESOLVED'
    let resolvedLocalId = null

    if (p.tcgplayer_id != null && mappedByTcg.has(String(p.tcgplayer_id))) {
      resolution = 'A'
      resolvedLocalId = mappedByTcg.get(String(p.tcgplayer_id))
    } else if (p.cardmarket_id != null && mappedByCm.has(String(p.cardmarket_id))) {
      resolution = 'B'
      resolvedLocalId = mappedByCm.get(String(p.cardmarket_id))
    } else if (setCode && collector) {
      const k1 = mtgKey(setCode, collector, lang)
      const k2 = mtgKeyNoLang(setCode, collector)
      const row = byKey.get(k1) || byKeyNoLang.get(k2)
      if (row) {
        resolution = 'C'
        resolvedLocalId = row.id
      }
    }

    resCount[resolution]++
    bySetAll.set(setCode, (bySetAll.get(setCode) || 0) + 1)
    if (resolution === 'UNRESOLVED') {
      bySetUnresolved.set(setCode, (bySetUnresolved.get(setCode) || 0) + 1)
    }

    enriched.push({ p, setCode, collector, langRaw, resolution, resolvedLocalId })
  }

  // Resolve names for resolved rows.
  const localIds = [...new Set(enriched.map(e => e.resolvedLocalId).filter(Boolean))]
  const nameById = new Map()
  for (let i = 0; i < localIds.length; i += chunkSize) {
    const slice = localIds.slice(i, i + chunkSize)
    const { data, error } = await s.from('mtg_printings').select('id, name').in('id', slice)
    if (error) throw new Error(`mtg_printings name lookup: ${error.message}`)
    for (const row of data || []) nameById.set(row.id, row.name)
  }

  // ---- Build CSV ---------------------------------------------------------
  const header = [
    'tcg_printing_id', 'set_code', 'collector_number', 'language', 'finish',
    'tcgplayer_id', 'cardmarket_id',
    'market_source', 'market_price', 'current_max_price_usd',
    'resolution', 'resolved_mtg_printings_id', 'resolved_name',
  ]
  const outRows = [header.join(',')]
  for (const e of enriched) {
    const id = e.p.id
    outRows.push([
      id,
      e.setCode,
      e.collector,
      e.langRaw,
      e.p.finish ?? '',
      e.p.tcgplayer_id ?? '',
      e.p.cardmarket_id ?? '',
      firstSourceById.get(id) ?? '',
      firstPriceById.get(id) ?? '',
      maxPriceById.get(id) ?? '',
      e.resolution,
      e.resolvedLocalId ?? '',
      nameById.get(e.resolvedLocalId) ?? '',
    ].map(csvEscape).join(','))
  }
  const csvPath = join(REPO_ROOT, 'docs', 'audit', 'unmapped-printings-report.csv')
  mkdirSync(dirname(csvPath), { recursive: true })
  writeFileSync(csvPath, outRows.join('\n') + '\n', 'utf8')

  // ---- Summary -----------------------------------------------------------
  console.log('\n=========================================')
  console.log('== RESOLUTION SUMMARY ==')
  console.log('=========================================')
  console.log(`  Total unmapped printings audited : ${printings.length}`)
  console.log(`  Resolved via A (tcgplayer_id peer): ${resCount.A}`)
  console.log(`  Resolved via B (cardmarket_id peer): ${resCount.B}`)
  console.log(`  Resolved via C (set+coll+lang)    : ${resCount.C}`)
  console.log(`  UNRESOLVED                        : ${resCount.UNRESOLVED}`)

  console.log('\n== All unmapped counts by set_code ==')
  for (const [code, count] of [...bySetAll.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(code || '(unknown)').padEnd(8)}: ${count} total, ${bySetUnresolved.get(code) || 0} still unresolved`)
  }

  console.log('\n== Top-3 highest-priced UNRESOLVED rows (do NOT silently delete) ==')
  const unresolvedSorted = enriched
    .filter(e => e.resolution === 'UNRESOLVED')
    .map(e => ({ e, price: maxPriceById.get(e.p.id) ?? -1 }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
  for (const { e, price } of unresolvedSorted) {
    console.log(`  $${price}  ${e.setCode}#${e.collector} lang=${e.langRaw}  tcg_printing_id=${e.p.id}  tcgplayer_id=${e.p.tcgplayer_id ?? ''}  cardmarket_id=${e.p.cardmarket_id ?? ''}  finish=${e.p.finish ?? ''}`)
  }

  console.log(`\nCSV written to: ${csvPath}`)
  console.log(`CSV rows (incl. header): ${outRows.length}`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
