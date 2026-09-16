// src/lib/mtg/csv-import.ts
//
// Generic CSV → mtg_collection_items pipeline with format detection.
// Never silently imports an ambiguous row — anything we can't uniquely
// resolve is returned in `unresolved` for the user to look at.
//
// Format detection (based on column headers alone — we do NOT hardcode
// column ORDER, which varies):
//
//   Moxfield export:  Count, Name, Edition, Condition, Language, Foil,
//                     Collector Number, Alter, Proxy, Purchase Price
//   Deckbox export:   Count, Tradelist Count, Name, Edition, Card Number,
//                     Condition, Language, Foil, Signed, Artist Proof,
//                     Altered Art, Misprint, Promo, Textless, My Price
//   Archidekt export: Quantity, Name, Finish, Condition, Language, Set Code,
//                     Card Number
//
// This detector uses NORMALISED header names (lowercased, spaces removed)
// and picks the format based on the strongest header match. Documented
// caveat: real-world exports can vary as vendors update tools; if a user
// hits ambiguity we surface it rather than guessing.

import 'server-only'

export type CsvRow = Record<string, string>

export type NormalisedRow = {
  index: number
  name: string
  setCode: string | null
  collectorNumber: string | null
  quantity: number
  finish: 'nonfoil' | 'foil' | 'etched'
  condition: 'near_mint' | 'lightly_played' | 'moderately_played' | 'heavily_played' | 'damaged'
  language: string | null
  acquired_price_cents: number | null
  acquired_currency: 'USD' | 'EUR' | null
  raw: CsvRow
}

export type ImportSource = 'moxfield' | 'deckbox' | 'archidekt' | 'generic'

export type ResolvedRow = NormalisedRow & {
  printing_id: string
  printing_finish_id: string
  matched_on: 'set_code_and_collector' | 'set_code_and_name' | 'name_only'
}

export type ImportPreview = {
  source: ImportSource
  totalRows: number
  resolved: ResolvedRow[]
  ambiguous: (NormalisedRow & { reason: string; candidates: string[] })[]
  unresolved: (NormalisedRow & { reason: string })[]
}

// ── CSV parsing ──────────────────────────────────────────────────

/** Minimal RFC-4180-ish CSV parser. Handles quotes and embedded commas. */
export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }

  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).filter((r) => r.some((v) => v.length > 0)).map((r) => {
    const obj: CsvRow = {}
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = (r[i] ?? '').trim()
    return obj
  })
}

// ── Format detection ─────────────────────────────────────────────

function norm(k: string): string { return k.toLowerCase().replace(/[^a-z0-9]+/g, '') }

export function detectSource(headers: string[]): ImportSource {
  const H = new Set(headers.map(norm))
  const hasEdition = H.has('edition')
  const hasSetCode = H.has('setcode')
  const hasFinish  = H.has('finish')
  const hasCollectorNumber = H.has('collectornumber') || H.has('cardnumber')
  const hasPurchasePrice = H.has('purchaseprice')
  const hasTradelist = H.has('tradelistcount')

  // Deckbox has a very distinctive "Tradelist Count" column.
  if (hasTradelist) return 'deckbox'
  // Archidekt uses "Set Code" + "Finish".
  if (hasSetCode && hasFinish) return 'archidekt'
  // Moxfield uses "Edition" (name of the set) + "Collector Number" + "Purchase Price".
  if (hasEdition && hasCollectorNumber && hasPurchasePrice) return 'moxfield'
  // Fallback: generic. We handle Edition-based rows too.
  return 'generic'
}

// ── Row normalisation ────────────────────────────────────────────

function readField(row: CsvRow, names: string[]): string {
  for (const n of names) {
    for (const k of Object.keys(row)) {
      if (norm(k) === norm(n)) return row[k] ?? ''
    }
  }
  return ''
}

function normaliseCondition(raw: string): NormalisedRow['condition'] {
  const s = raw.toLowerCase().replace(/[^a-z ]/g, '')
  if (s.includes('near') && s.includes('mint')) return 'near_mint'
  if (s === 'nm' || s === 'nm-mt') return 'near_mint'
  if (s === 'm' || s.includes('mint')) return 'near_mint'  // Cardmarket "Mint" folds into NM
  if (s.includes('light') || s === 'lp' || s === 'ex') return 'lightly_played'
  if (s.includes('moderate') || s === 'mp' || s === 'gd' || s.includes('good')) return 'moderately_played'
  if (s.includes('heavy') || s === 'hp') return 'heavily_played'
  if (s.includes('damage') || s === 'dmg' || s.includes('poor')) return 'damaged'
  return 'near_mint'
}

function normaliseFinish(raw: string): NormalisedRow['finish'] {
  const s = raw.toLowerCase().trim()
  if (s === 'foil' || s === 'true' || s === 'yes' || s === '1') return 'foil'
  if (s === 'etched' || s.includes('etched')) return 'etched'
  return 'nonfoil'
}

export function normaliseRow(source: ImportSource, row: CsvRow, index: number): NormalisedRow | null {
  const name = readField(row, ['name', 'card', 'card name'])
  if (!name) return null

  const qtyStr = readField(row, ['count', 'quantity', 'qty', 'amount'])
  const qty = parseInt(qtyStr || '1', 10)
  if (!Number.isFinite(qty) || qty <= 0) return null

  let setCode: string | null = null
  const setField = readField(row, ['set code', 'set', 'setcode'])
  if (setField && setField.length <= 6) setCode = setField.toLowerCase()

  // Moxfield uses "Edition" as either the set NAME (Kaladesh) or the
  // 3-letter code depending on export. Trim what we get and treat
  // short values as set codes; longer values fall through as name-only.
  if (!setCode) {
    const ed = readField(row, ['edition'])
    if (ed && ed.length <= 6) setCode = ed.toLowerCase()
  }

  const collectorNumber = readField(row, ['collector number', 'card number', 'number']) || null

  // Foil detection: an explicit "Finish" column wins; otherwise a Foil
  // Y/N column; otherwise nonfoil.
  const finishField = readField(row, ['finish'])
  const foilField = readField(row, ['foil'])
  let finish: NormalisedRow['finish'] = 'nonfoil'
  if (finishField) finish = normaliseFinish(finishField)
  else if (foilField) finish = normaliseFinish(foilField)

  const conditionRaw = readField(row, ['condition', 'grade'])
  const condition = normaliseCondition(conditionRaw)

  const priceStr = readField(row, ['purchase price', 'my price', 'price'])
  const priceCents = priceStr ? Math.round(parseFloat(priceStr.replace(/[^0-9.]/g, '')) * 100) : null
  const currencyRaw = readField(row, ['currency'])
  const acquired_currency: 'USD' | 'EUR' | null =
    currencyRaw.toUpperCase() === 'EUR' ? 'EUR'
    : currencyRaw.toUpperCase() === 'USD' ? 'USD'
    : (priceCents != null ? 'USD' : null)

  return {
    index,
    name: name.trim(),
    setCode,
    collectorNumber: collectorNumber ? collectorNumber.trim() : null,
    quantity: qty,
    finish,
    condition,
    language: readField(row, ['language']) || null,
    acquired_price_cents: Number.isFinite(priceCents) ? priceCents : null,
    acquired_currency,
    raw: row,
  }
}

// ── Resolution against the catalogue ─────────────────────────────

import { getSupabaseServiceClient } from '@/lib/supabaseService'

export async function resolveRows(rows: NormalisedRow[]): Promise<ImportPreview> {
  const s = getSupabaseServiceClient()
  const resolved: ResolvedRow[] = []
  const ambiguous: ImportPreview['ambiguous'] = []
  const unresolved: ImportPreview['unresolved'] = []

  // Try 1: (set_code, collector_number) exact.
  const byCode: Record<string, NormalisedRow[]> = {}
  for (const r of rows) {
    if (r.setCode && r.collectorNumber) {
      const k = `${r.setCode}|${r.collectorNumber}`
      byCode[k] = (byCode[k] ?? []).concat(r)
    }
  }
  const codeKeys = Object.keys(byCode)
  if (codeKeys.length > 0) {
    // batch queries by set_code
    const setToNumbers = new Map<string, Set<string>>()
    for (const key of codeKeys) {
      const [set, num] = key.split('|')
      const s = setToNumbers.get(set) ?? new Set()
      s.add(num)
      setToNumbers.set(set, s)
    }
    for (const [set, numsSet] of Array.from(setToNumbers.entries())) {
      const nums = Array.from(numsSet)
      const { data: printings } = await s.from('mtg_printings')
        .select('id, set_code, collector_number, name')
        .eq('set_code', set)
        .eq('lang', 'en')
        .in('collector_number', nums)
      const bySetAndNum = new Map<string, any[]>()
      for (const p of (printings ?? []) as any[]) {
        const k = `${p.set_code}|${p.collector_number}`
        const arr = bySetAndNum.get(k) ?? []
        arr.push(p)
        bySetAndNum.set(k, arr)
      }
      for (const num of nums) {
        const arr = bySetAndNum.get(`${set}|${num}`) ?? []
        const inputRows = byCode[`${set}|${num}`] ?? []
        for (const input of inputRows) {
          if (arr.length === 1) {
            const p = arr[0]
            const finishRes = await s.from('mtg_printing_finishes').select('id, finish').eq('printing_id', p.id).eq('finish', input.finish).maybeSingle()
            if (finishRes.data) {
              resolved.push({
                ...input,
                printing_id: p.id,
                printing_finish_id: finishRes.data.id,
                matched_on: 'set_code_and_collector',
              })
            } else {
              unresolved.push({ ...input, reason: `Printing found but no ${input.finish} finish exists` })
            }
          } else if (arr.length > 1) {
            ambiguous.push({ ...input, reason: 'Multiple printings match this collector number', candidates: arr.map((c) => c.id) })
          } else {
            unresolved.push({ ...input, reason: 'No printing found with this set + collector number' })
          }
        }
      }
    }
  }

  // Rows that didn't resolve above, fall through by name+set.
  const stillPending = rows.filter((r) => !resolved.some((x) => x.index === r.index) && !ambiguous.some((x) => x.index === r.index) && !unresolved.some((x) => x.index === r.index))
  for (const input of stillPending) {
    let q = s.from('mtg_printings')
      .select('id, set_code, collector_number, name')
      .eq('lang', 'en')
      .eq('digital', false)
      .ilike('name', input.name)
      .limit(6)
    if (input.setCode) q = q.eq('set_code', input.setCode)
    const { data: matches } = await q
    const hits = matches ?? []
    if (hits.length === 1) {
      const p = hits[0] as any
      const finishRes = await s.from('mtg_printing_finishes').select('id, finish').eq('printing_id', p.id).eq('finish', input.finish).maybeSingle()
      if (finishRes.data) {
        resolved.push({
          ...input,
          printing_id: p.id,
          printing_finish_id: finishRes.data.id,
          matched_on: input.setCode ? 'set_code_and_name' : 'name_only',
        })
      } else {
        unresolved.push({ ...input, reason: `Matched by name but no ${input.finish} finish available` })
      }
    } else if (hits.length > 1) {
      ambiguous.push({ ...input, reason: 'Card name matches multiple printings', candidates: hits.map((h: any) => h.id) })
    } else {
      unresolved.push({ ...input, reason: 'Card name not found in the catalogue' })
    }
  }

  return {
    source: 'generic',
    totalRows: rows.length,
    resolved,
    ambiguous,
    unresolved,
  }
}

export async function buildPreview(csvText: string): Promise<ImportPreview> {
  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    return { source: 'generic', totalRows: 0, resolved: [], ambiguous: [], unresolved: [] }
  }
  const source = detectSource(Object.keys(rows[0]))
  const normalised = rows
    .map((r, i) => normaliseRow(source, r, i))
    .filter((r): r is NormalisedRow => r !== null)
  const preview = await resolveRows(normalised)
  preview.source = source
  return preview
}
