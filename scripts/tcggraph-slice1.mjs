#!/usr/bin/env node
// scripts/tcggraph-slice1.mjs
//
// Slice 1 live audit against the real TCGGraph API. Reads
// TCGGRAPH_API_KEY from .env.local, never prints it. Writes every
// response (headers + body) into `.tmp/tcggraph-slice1/*.json` for
// offline analysis. All observed TCGGraph-Cost values are summed so
// we can produce a credit model from real data.
//
// Design contract:
//   * Does NOT call from Client Components. This is a Node script.
//   * Never logs the API key.
//   * Refuses to spend more than the configured hard budgets. Default
//     is 500 credits and 200 requests for a single audit run.
//   * Every write is under .tmp so nothing hits git.
//   * Every response file gets a *_meta.json sibling with headers +
//     credit snapshot so the audit report can be regenerated later.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_DIR = join(REPO_ROOT, '.tmp', 'tcggraph-slice1')
mkdirSync(OUT_DIR, { recursive: true })

// ---------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------
function loadEnv() {
  try {
    const raw = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  } catch {}
}
loadEnv()

const KEY = (process.env.TCGGRAPH_API_KEY ?? '').trim()
const BASE = (process.env.TCGGRAPH_API_BASE ?? 'https://api.tcggraph.com/v1').replace(/\/$/, '')
if (!KEY) {
  console.error('TCGGRAPH_API_KEY missing from .env.local. Aborting.')
  process.exit(1)
}

// Safety budgets. Small on purpose - this is a proof, not a bootstrap.
const HARD_CREDIT_BUDGET  = Number(process.env.TCGGRAPH_AUDIT_CREDIT_BUDGET  ?? 500)
const HARD_REQUEST_BUDGET = Number(process.env.TCGGRAPH_AUDIT_REQUEST_BUDGET ?? 200)

let creditsUsed = 0
let requestsMade = 0
const runId = new Date().toISOString().replace(/[:.]/g, '-')

const summary = {
  runId,
  startedAt: new Date().toISOString(),
  baseUrl: BASE,
  apiVersionHeader: null,
  gamesTested: [],
  totals: { credits: 0, requests: 0 },
  byRequest: [],   // { path, status, cost, remaining, etag, ms }
  errors: [],
}

// ---------------------------------------------------------------------
// Fetch with credit-aware accounting + retry.
// ---------------------------------------------------------------------
async function call(path, {
  query = null,
  ifNoneMatch = null,
  method = 'GET',
  saveAs = null,          // filename basename (no extension) or null to skip save
  attemptsLimit = 3,
} = {}) {
  if (creditsUsed >= HARD_CREDIT_BUDGET) throw new Error(`credit budget ${HARD_CREDIT_BUDGET} exhausted before ${path}`)
  if (requestsMade >= HARD_REQUEST_BUDGET) throw new Error(`request budget ${HARD_REQUEST_BUDGET} exhausted before ${path}`)
  const url = new URL(BASE + (path.startsWith('/') ? path : '/' + path))
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const headers = {
    'accept': 'application/json',
    'authorization': `Bearer ${KEY}`,
    'user-agent': 'MTGPrices-slice1-audit/0.1',
    ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}),
  }
  let attempt = 0
  let lastStatus = 0
  while (attempt < attemptsLimit) {
    attempt += 1
    requestsMade += 1
    const t0 = Date.now()
    let res
    try {
      res = await fetch(url.toString(), { method, headers })
    } catch (e) {
      summary.errors.push({ path: url.pathname + url.search, attempt, error: String(e) })
      if (attempt >= attemptsLimit) throw e
      await sleep(400 * attempt)
      continue
    }
    const ms = Date.now() - t0
    lastStatus = res.status
    const cost = numHeader(res, 'TCGGraph-Cost')
    if (cost != null) creditsUsed += cost
    else if (res.status !== 304) creditsUsed += 1

    const headersDump = objectifyHeaders(res.headers)
    const record = {
      path: url.pathname + url.search,
      method, attempt,
      status: res.status,
      ms,
      cost,
      creditsRemaining: numHeader(res, 'TCGGraph-Credits-Remaining'),
      creditsLimit:     numHeader(res, 'TCGGraph-Credits-Limit'),
      creditsReset:     res.headers.get('TCGGraph-Credits-Reset'),
      rateLimitRemaining: numHeader(res, 'X-RateLimit-Remaining'),
      apiVersion:      res.headers.get('X-Api-Version') || res.headers.get('X-TCGGraph-Version') || null,
      etag:            res.headers.get('etag'),
    }
    summary.byRequest.push(record)
    if (record.apiVersion && !summary.apiVersionHeader) summary.apiVersionHeader = record.apiVersion

    if (res.status === 304) {
      if (saveAs) writeMeta(saveAs, { record, headers: headersDump, body: null })
      return { status: 304, body: null, headers: headersDump, record }
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '0') * 1000
      const backoff = Math.max(retryAfter, 500 * 2 ** (attempt - 1))
      if (attempt >= attemptsLimit) throw new Error(`429 exhausted on ${path}`)
      await sleep(backoff)
      continue
    }
    if (res.status >= 500 && res.status < 600) {
      if (attempt >= attemptsLimit) throw new Error(`${res.status} exhausted on ${path}`)
      await sleep(500 * 2 ** (attempt - 1))
      continue
    }
    const body = await safeJson(res)
    if (saveAs) {
      writeBody(saveAs, body)
      writeMeta(saveAs, { record, headers: headersDump })
    }
    return { status: res.status, body, headers: headersDump, record }
  }
  throw new Error(`exhausted attempts on ${path}, last status ${lastStatus}`)
}

function numHeader(res, name) {
  const raw = res.headers.get(name)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
function objectifyHeaders(h) {
  const out = {}
  h.forEach((v, k) => { out[k] = v })
  return out
}
function writeBody(basename, body) { writeFileSync(join(OUT_DIR, `${basename}.body.json`), JSON.stringify(body, null, 2)) }
function writeMeta(basename, meta) { writeFileSync(join(OUT_DIR, `${basename}.meta.json`), JSON.stringify(meta, null, 2)) }
async function safeJson(res) { try { return await res.json() } catch { return { _raw: await res.text().catch(() => '') } } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ---------------------------------------------------------------------
// The audit itself.
// ---------------------------------------------------------------------

const GAMES = ['magic-the-gathering', 'yugioh', 'one-piece', 'star-wars-unlimited']

async function audit() {
  console.log(`[slice1] base=${BASE}   budgets: ${HARD_REQUEST_BUDGET} req / ${HARD_CREDIT_BUDGET} credits`)

  // --- A. Discovery. What endpoints exist and what shape do they return?
  // Do the smallest possible probes to learn the API surface.
  console.log('[slice1] === A. contract discovery ===')

  // Try to enumerate games via a probable endpoint. If 404, fall back
  // to the hard-coded game slug list from the docs.
  try {
    const r = await call('/games', { saveAs: 'A_games_list' })
    console.log(`  /games -> ${r.status}, cost=${r.record.cost}`)
  } catch (e) {
    console.log(`  /games probe failed: ${e.message}`)
  }

  // Probe /cards with each of our 4 games to see what fields come back.
  for (const g of GAMES) {
    const r = await call('/cards', { query: { game: g, limit: 3 }, saveAs: `A_cards_${slug(g)}_sample3` })
    console.log(`  /cards?game=${g}&limit=3 -> ${r.status}, cost=${r.record.cost}, keys=${listKeys(r.body)}`)
    if (r.status === 200) summary.gamesTested.push(g)
  }

  // Repeat with /printings to see if it exists as a separate resource.
  for (const g of GAMES) {
    try {
      const r = await call('/printings', { query: { game: g, limit: 3 }, saveAs: `A_printings_${slug(g)}_sample3` })
      console.log(`  /printings?game=${g}&limit=3 -> ${r.status}, cost=${r.record.cost}, keys=${listKeys(r.body)}`)
    } catch (e) {
      console.log(`  /printings?game=${g} FAILED: ${e.message}`)
    }
  }

  // /sets probe.
  for (const g of GAMES) {
    try {
      const r = await call('/sets', { query: { game: g, limit: 3 }, saveAs: `A_sets_${slug(g)}_sample3` })
      console.log(`  /sets?game=${g}&limit=3 -> ${r.status}, cost=${r.record.cost}, keys=${listKeys(r.body)}`)
    } catch (e) {
      console.log(`  /sets?game=${g} FAILED: ${e.message}`)
    }
  }

  // --- Prices probes for MTG (small sample first).
  try {
    const r = await call('/prices', { query: { game: 'magic-the-gathering', limit: 3 }, saveAs: 'A_prices_mtg_sample3' })
    console.log(`  /prices?game=mtg&limit=3 -> ${r.status}, cost=${r.record.cost}, keys=${listKeys(r.body)}`)
  } catch (e) { console.log('  /prices probe failed:', e.message) }

  // --- ETag round-trip probe on the same /cards call.
  console.log('[slice1] === ETag / 304 probe ===')
  const first = await call('/cards', { query: { game: 'magic-the-gathering', limit: 1 }, saveAs: 'A_etag_probe_first' })
  if (first.record.etag) {
    const second = await call('/cards', { query: { game: 'magic-the-gathering', limit: 1 }, ifNoneMatch: first.record.etag, saveAs: 'A_etag_probe_second' })
    console.log(`  first status=${first.status} etag=${first.record.etag}, second status=${second.status}`)
  } else {
    console.log('  no ETag on first call, skipping If-None-Match test')
  }

  // --- B/C. Deeper per-game samples. Only for games the /cards probe worked.
  console.log('[slice1] === B/C. Per-game 20-card samples ===')
  for (const g of summary.gamesTested) {
    if (creditsUsed >= HARD_CREDIT_BUDGET * 0.75) {
      console.log(`  budget getting close, skipping remaining games`)
      break
    }
    const r = await call('/cards', { query: { game: g, limit: 20 }, saveAs: `B_cards_${slug(g)}_20` })
    console.log(`  /cards?game=${g}&limit=20 -> ${r.status}, cost=${r.record.cost}, count=${Array.isArray(r.body?.data) ? r.body.data.length : '?'}`)
  }

  // --- D. MTG mapping probe. Take a MTG cards page, examine external
  //     IDs on each printing, cross-check against mtg_printings in the DB.
  //     Save to disk; DB cross-check runs after.
  console.log('[slice1] === D. MTG identifier surface ===')
  const mtgCards = await call('/cards', { query: { game: 'magic-the-gathering', limit: 25 }, saveAs: 'D_mtg_cards_25' })
  if (mtgCards.body && mtgCards.body.data) {
    console.log(`  MTG cards returned: ${mtgCards.body.data.length}. Field examination in D_mtg_cards_25.body.json.`)
  }
  // Also try /printings if it exists for MTG
  try {
    const p = await call('/printings', { query: { game: 'magic-the-gathering', limit: 25 }, saveAs: 'D_mtg_printings_25' })
    console.log(`  MTG printings returned: ${Array.isArray(p.body?.data) ? p.body.data.length : '?'}`)
  } catch (e) { console.log('  /printings MTG failed:', e.message) }

  // --- E. Graded prices probe. Try a couple of candidate paths.
  console.log('[slice1] === E. Graded prices ===')
  for (const path of ['/graded-prices', '/prices/graded', '/prices?graded=1']) {
    try {
      const r = await call(path, { query: { game: 'magic-the-gathering', limit: 5 }, saveAs: `E_graded_probe_${slug(path)}` })
      console.log(`  ${path} -> ${r.status}, cost=${r.record.cost}`)
      if (r.status === 200 && r.body?.data?.length) break
    } catch (e) { console.log(`  ${path} error: ${e.message}`) }
  }

  // --- H. Bulk export probe.
  console.log('[slice1] === H. Bulk export ===')
  for (const path of ['/bulk', '/exports', '/bulk-data', '/bulk-exports']) {
    try {
      const r = await call(path, { saveAs: `H_bulk_probe_${slug(path)}` })
      console.log(`  ${path} -> ${r.status}, cost=${r.record.cost}`)
      if (r.status === 200) break
    } catch (e) { console.log(`  ${path} error: ${e.message}`) }
  }

  // --- Wrap-up.
  summary.completedAt = new Date().toISOString()
  summary.totals.credits = creditsUsed
  summary.totals.requests = requestsMade
  writeFileSync(join(OUT_DIR, `_summary_${runId}.json`), JSON.stringify(summary, null, 2))
  console.log(`\n[slice1] DONE. credits=${creditsUsed}/${HARD_CREDIT_BUDGET}   requests=${requestsMade}/${HARD_REQUEST_BUDGET}`)
  console.log(`[slice1] artefacts: ${OUT_DIR}`)
}

function listKeys(body) {
  if (body == null) return '(null)'
  if (Array.isArray(body)) return `[array of ${body.length}, first keys: ${listKeys(body[0])}]`
  const keys = Object.keys(body)
  return keys.slice(0, 10).join(',') + (keys.length > 10 ? `,... (${keys.length - 10} more)` : '')
}
function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') }

audit().catch((err) => { console.error('[slice1] FATAL:', err.message); process.exit(2) })
