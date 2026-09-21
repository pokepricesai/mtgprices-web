#!/usr/bin/env node
// scripts/indexnow-bootstrap.mjs
//
// One-time IndexNow submission of the entire current MTGPrices public
// URL inventory. Reads the LIVE production sitemap so the URL list
// matches exactly what Bing sees, dedupes, canonicalises, then POSTs
// in 10,000-URL batches to https://api.indexnow.org/indexnow.
//
// Idempotent by URL (a resubmission is harmless), but this script is
// intended to be run ONCE for launch. Ongoing add/remove/update
// notifications should call submitIndexNowUrls() from application
// code, not resubmit the whole catalogue.
//
// Usage:
//   node scripts/indexnow-bootstrap.mjs --dry-run
//   node scripts/indexnow-bootstrap.mjs
//   node scripts/indexnow-bootstrap.mjs --resume
//   node scripts/indexnow-bootstrap.mjs --target https://mtgprices.io
//
// Env (read from .env.local):
//   INDEXNOW_ENABLED    must be 'true' before real submission runs
//   INDEXNOW_KEY        the shared IndexNow key (32 hex chars)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CHECKPOINT = join(REPO_ROOT, '.indexnow-bootstrap.json')

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

const TARGET = argFlag('target') || 'https://mtgprices.io'
const DRY_RUN = argBool('dry-run')
const RESUME = argBool('resume')
const HOST = new URL(TARGET).host

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH_SIZE = 10_000
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const BETWEEN_BATCH_MS = 500
const MAX_ATTEMPTS = 4

const PRIVATE_MARKERS = [
  '/api/', '/login', '/account', '/settings', '/collection', '/collection/import',
  '/decks/new', '/decks/', '/test-deck', '/cards/search',
]

function argFlag(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`)
  if (i < 0) return null
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) return null
  return v
}
function argBool(name) { return process.argv.includes(`--${name}`) }

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'MTGPrices-IndexNow-Bootstrap/1.0' } })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
  return res.text()
}

function extractLocs(xml) {
  const out = []
  const re = /<loc>([^<]+)<\/loc>/g
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim())
  return out
}

async function collectAllUrlsFromSitemap(root) {
  console.log(`[bootstrap] fetching root sitemap at ${root}/sitemap.xml`)
  const rootXml = await fetchText(`${root}/sitemap.xml`)
  const childUrls = extractLocs(rootXml)
  console.log(`[bootstrap] found ${childUrls.length} child sitemap references`)
  const all = []
  for (const child of childUrls) {
    const xml = await fetchText(child)
    const locs = extractLocs(xml)
    console.log(`[bootstrap]   ${child.split('/').pop()}: ${locs.length} URLs`)
    all.push(...locs)
  }
  return all
}

function validateAndDedupe(urls, origin) {
  const seen = new Set()
  const out = []
  let offDomain = 0, empty = 0, private_ = 0, dup = 0, malformed = 0, queryOrHash = 0
  for (const raw of urls) {
    const s = (raw ?? '').trim()
    if (!s) { empty += 1; continue }
    let u
    try { u = new URL(s) } catch { malformed += 1; continue }
    if (`${u.protocol}//${u.host}` !== origin) { offDomain += 1; continue }
    if (u.search || u.hash) { queryOrHash += 1; u.search = ''; u.hash = '' }
    const path = u.pathname
    let priv = false
    for (const marker of PRIVATE_MARKERS) {
      if (path === marker || path.startsWith(marker + '/')) { priv = true; break }
    }
    if (priv) { private_ += 1; continue }
    let clean = u.toString()
    if (clean.length > origin.length + 1 && clean.endsWith('/')) clean = clean.slice(0, -1)
    if (seen.has(clean)) { dup += 1; continue }
    seen.add(clean)
    out.push(clean)
  }
  return { urls: out, stats: { input: urls.length, offDomain, empty, malformed, private: private_, dup, queryOrHash } }
}

function batchUrls(urls) {
  const out = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) out.push(urls.slice(i, i + BATCH_SIZE))
  return out
}

async function postBatch(key, keyLocation, batch, index) {
  const body = JSON.stringify({ host: HOST, key, keyLocation, urlList: batch })
  let lastStatus = 0, lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let status = 0
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      })
      status = res.status
      lastStatus = status
      if (status === 200 || status === 202) return { ok: true, status, attempts: attempt }
      if (status === 400 || status === 403 || status === 422) {
        const txt = await res.text().catch(() => '')
        return { ok: false, status, attempts: attempt, error: `permanent-${status}: ${txt.slice(0, 200)}` }
      }
      if (!RETRY_STATUS.has(status)) {
        return { ok: false, status, attempts: attempt, error: `unknown-status-${status}` }
      }
      lastError = `transient-${status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < MAX_ATTEMPTS) {
      const backoff = Math.min(500 * 2 ** (attempt - 1), 4000)
      console.log(`[bootstrap] batch ${index}: attempt ${attempt} failed (${lastError}), retrying in ${backoff}ms`)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  return { ok: false, status: lastStatus, attempts: MAX_ATTEMPTS, error: lastError }
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT)) return null
  try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')) } catch { return null }
}
function writeCheckpoint(state) {
  // Never persist the key in the checkpoint. It stays in env only.
  const safe = { ...state, key: undefined, keyLocation: undefined }
  writeFileSync(CHECKPOINT, JSON.stringify(safe, null, 2), 'utf8')
}
function hashCount(urls) {
  // Count-and-first/last snapshot so a resume knows the inventory
  // still matches. Not a cryptographic hash - the size + edges is
  // enough to detect meaningful catalogue drift.
  return { count: urls.length, first: urls[0] ?? null, last: urls[urls.length - 1] ?? null }
}

async function main() {
  const key = (process.env.INDEXNOW_KEY ?? '').trim()
  const enabled = process.env.INDEXNOW_ENABLED === 'true'
  const keyLocation = key ? `${TARGET}/${key}.txt` : null

  console.log(`[bootstrap] target=${TARGET}  dry-run=${DRY_RUN}  resume=${RESUME}`)
  console.log(`[bootstrap] INDEXNOW_ENABLED=${enabled}  key present=${Boolean(key)}`)

  const raw = await collectAllUrlsFromSitemap(TARGET)
  const { urls, stats } = validateAndDedupe(raw, TARGET)
  console.log(`[bootstrap] validation stats: input=${stats.input} offDomain=${stats.offDomain} empty=${stats.empty} malformed=${stats.malformed} private=${stats.private} queryOrHash=${stats.queryOrHash} duplicates=${stats.dup}`)
  console.log(`[bootstrap] final URL count: ${urls.length}`)
  const batches = batchUrls(urls)
  console.log(`[bootstrap] batches: ${batches.length}`)
  batches.forEach((b, i) => {
    console.log(`[bootstrap]   batch ${i + 1}: ${b.length} URLs, first=${b[0]}, last=${b[b.length - 1]}`)
  })

  if (DRY_RUN) {
    console.log('[bootstrap] DRY-RUN complete. Zero requests sent to IndexNow.')
    return
  }

  if (!enabled || !key || !keyLocation) {
    console.error('[bootstrap] INDEXNOW_ENABLED must be "true" and INDEXNOW_KEY must be set. Aborting.')
    process.exit(1)
  }

  // Verify the key file is reachable before we start.
  const verifyUrl = `${TARGET}/${key}.txt`
  const verifyRes = await fetch(verifyUrl)
  const verifyBody = verifyRes.ok ? (await verifyRes.text()).trim() : ''
  if (!verifyRes.ok || verifyBody !== key) {
    console.error(`[bootstrap] key file check failed at ${verifyUrl}: status=${verifyRes.status} body=${JSON.stringify(verifyBody.slice(0, 80))}`)
    process.exit(1)
  }
  console.log(`[bootstrap] key file OK at ${verifyUrl}`)

  // Resume checkpoint.
  const prior = RESUME ? loadCheckpoint() : null
  const snapshot = hashCount(urls)
  let startBatch = 0
  const priorResults = []
  if (prior) {
    const same = prior.snapshot && prior.snapshot.count === snapshot.count &&
                 prior.snapshot.first === snapshot.first &&
                 prior.snapshot.last === snapshot.last
    if (!same) {
      console.error('[bootstrap] --resume requested but sitemap inventory has changed since the previous run. Refusing to resume. Delete .indexnow-bootstrap.json to force a clean run.')
      process.exit(1)
    }
    const done = (prior.batches ?? []).filter((b) => b.ok).length
    startBatch = done
    priorResults.push(...(prior.batches ?? []))
    console.log(`[bootstrap] resuming from batch ${startBatch + 1} of ${batches.length} (${done} already OK)`)
  }

  const results = [...priorResults]
  for (let i = startBatch; i < batches.length; i++) {
    const t0 = Date.now()
    const r = await postBatch(key, keyLocation, batches[i], i + 1)
    const ms = Date.now() - t0
    const record = {
      index: i + 1, size: batches[i].length, attempts: r.attempts, status: r.status,
      ok: r.ok, error: r.error, ms,
    }
    // Replace or push
    if (results[i]) results[i] = record; else results.push(record)
    writeCheckpoint({
      startedAt: prior?.startedAt ?? new Date().toISOString(),
      target: TARGET,
      snapshot,
      batches: results,
    })
    console.log(`[bootstrap] batch ${i + 1}/${batches.length}: status=${r.status} ok=${r.ok} attempts=${r.attempts} ms=${ms}${r.error ? '  err=' + r.error : ''}`)
    if (!r.ok) {
      console.error(`[bootstrap] batch ${i + 1} failed. Stopping. Rerun with --resume once the underlying issue is understood.`)
      process.exit(2)
    }
    if (i < batches.length - 1) await new Promise((r) => setTimeout(r, BETWEEN_BATCH_MS))
  }

  const submitted = results.reduce((a, r) => a + (r.ok ? r.size : 0), 0)
  console.log(`\n[bootstrap] === COMPLETE ===`)
  console.log(`  URLs submitted (accepted 200/202):  ${submitted}`)
  console.log(`  batches:  ${results.length}`)
  const bad = results.filter((r) => !r.ok)
  console.log(`  failures: ${bad.length}${bad.length ? '  ' + bad.map((r) => `#${r.index}(${r.status})`).join(', ') : ''}`)
}

main().catch((err) => { console.error(err); process.exit(3) })
