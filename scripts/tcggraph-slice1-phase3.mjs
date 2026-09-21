#!/usr/bin/env node
// Small final probes: filter by set, filter by hasGraded, max limit,
// cursor pagination test.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', '.tmp', 'tcggraph-slice1')
mkdirSync(OUT_DIR, { recursive: true })
const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
for (const line of raw.split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const KEY = process.env.TCGGRAPH_API_KEY
const BASE = 'https://api.tcggraph.com/v1'
let credits = 0, reqs = 0
async function call(path, q) {
  reqs += 1
  const url = new URL(BASE + path)
  if (q) for (const [k, v] of Object.entries(q)) if (v != null) url.searchParams.set(k, String(v))
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${KEY}`, accept: 'application/json' } })
  const cost = Number(res.headers.get('x-credits-cost')); if (Number.isFinite(cost)) credits += cost
  const body = res.status === 200 ? await res.json() : { _status: res.status }
  return { status: res.status, cost, body, rem: res.headers.get('x-credits-remaining') }
}
const results = []
async function probe(label, path, q) {
  const r = await call(path, q)
  const first = r.body?.data?.[0]
  const total = r.body?.meta?.totalCount
  results.push({ label, status: r.status, cost: r.cost, credits_remaining: r.rem, totalCount: total, firstName: first?.name })
  console.log(`  ${label.padEnd(45)} status=${r.status} cost=${r.cost ?? '-'} total=${total ?? '-'}`)
}
async function main() {
  console.log('=== filter probes ===')
  await probe('set=UNH filter',            '/cards', { game: 'magic-the-gathering', set: 'UNH', limit: 3 })
  await probe('set=unh (lower) filter',    '/cards', { game: 'magic-the-gathering', set: 'unh', limit: 3 })
  await probe('setCode=UNH filter',        '/cards', { game: 'magic-the-gathering', setCode: 'UNH', limit: 3 })
  await probe('hasGraded=true filter',     '/cards', { game: 'magic-the-gathering', hasGraded: 'true', limit: 3 })
  await probe('graded=true filter',        '/cards', { game: 'magic-the-gathering', graded: 'true', limit: 3 })
  await probe('language=en filter',        '/cards', { game: 'magic-the-gathering', language: 'en', limit: 3 })
  await probe('limit=100 max',             '/cards', { game: 'magic-the-gathering', limit: 100 })
  await probe('limit=250 (over)',          '/cards', { game: 'magic-the-gathering', limit: 250 })
  await probe('limit=500 (over)',          '/cards', { game: 'magic-the-gathering', limit: 500 })
  await probe('cursor pagination probe',   '/cards', { game: 'magic-the-gathering', cursor: 'abc', limit: 3 })
  await probe('updatedSince (recent)',     '/cards', { game: 'magic-the-gathering', updatedSince: '2026-09-20', limit: 3 })
  await probe('modifiedSince (recent)',    '/cards', { game: 'magic-the-gathering', modifiedSince: '2026-09-20', limit: 3 })
  await probe('/exports probe',            '/exports', {})
  await probe('/data probe',               '/data', {})
  await probe('/prices/updated probe',     '/prices/updated', { game: 'magic-the-gathering' })
  writeFileSync(join(OUT_DIR, 'phase3_probes.json'), JSON.stringify(results, null, 2))
  console.log(`\nDONE. credits=${credits} requests=${reqs}`)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
