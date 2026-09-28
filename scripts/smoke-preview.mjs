#!/usr/bin/env node
// Pass 2A Preview smoke test. Reads the bypass cookie jar produced by
// the initial curl (samesitenone bypass hand-off) and hits every URL
// in the checklist. Reports per-URL status + summary.
//
// Run:  node scripts/smoke-preview.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PREVIEW = process.env.PREVIEW_URL || 'https://mtgprices-ou92pig5l-lukepierce.vercel.app'
const COOKIE_FILE = 'C:/Users/lukep/AppData/Local/Temp/preview_cookies.txt'
const CRON_SECRET = process.env.PREVIEW_CRON_SECRET_FILE
  ? readFileSync(process.env.PREVIEW_CRON_SECRET_FILE, 'utf8').trim()
  : null

// Extract just the _vercel_jwt cookie value from Netscape-format jar.
const jarLines = readFileSync(COOKIE_FILE, 'utf8').split(/\r?\n/)
let vercelJwt = null
for (const rawLine of jarLines) {
  // Netscape jars prefix HttpOnly cookies with `#HttpOnly_` which is
  // NOT a real comment — strip that marker before parsing.
  const line = rawLine.replace(/^#HttpOnly_/, '')
  if (line.startsWith('#') || !line.trim()) continue
  const parts = line.split('\t')
  if (parts.length >= 7 && parts[5] === '_vercel_jwt') vercelJwt = parts[6]
}
if (!vercelJwt) { console.error('no _vercel_jwt cookie in jar'); process.exit(2) }
const COOKIE = `_vercel_jwt=${vercelJwt}`

async function hit(path, opts = {}) {
  const url = `${PREVIEW}${path}`
  const res = await fetch(url, {
    redirect: opts.redirect ?? 'manual',
    headers: {
      cookie: COOKIE,
      'user-agent': 'mtgprices-smoke/1.0',
      ...(opts.headers ?? {}),
    },
  })
  const location = res.headers.get('location')
  const contentType = res.headers.get('content-type')
  const xRobots = res.headers.get('x-robots-tag')
  return { url, status: res.status, location, contentType, xRobots, res }
}

async function hitAndParseHtml(path) {
  const r = await hit(path, { redirect: 'follow' })
  const html = await r.res.text()
  return { ...r, html }
}

const results = []
function row(bucket, label, r, extra = {}) {
  results.push({ bucket, label, url: r.url, status: r.status, location: r.location, xRobots: r.xRobots, ...extra })
}

// 1. Core routes
for (const p of ['/', '/browse', '/market', '/graded', '/card-finder', '/formats', '/insights']) {
  const r = await hit(p, { redirect: 'follow' })
  row('core', p, r)
}

// 2. /sets → /browse redirect
const setsRedirect = await hit('/sets')
row('redirect', '/sets', setsRedirect, { expected: '/browse (308)' })
const setsSubRedirect = await hit('/sets/anything')
row('redirect', '/sets/anything', setsSubRedirect, { expected: '/browse (308)' })

// 3. /set/lea (Alpha)
row('set-lea', '/set/lea', await hit('/set/lea', { redirect: 'follow' }))

// 4. Sealed CTA + campid check on /set/lea
const leaHtml = await hitAndParseHtml('/set/lea')
const hasSealedCta = /Search sealed on eBay|Looking for sealed/i.test(leaHtml.html)
const hasEbayCampid = /campid=5339212159/.test(leaHtml.html)
const canonicalOk = /rel="canonical"\s+href="https:\/\/mtgprices\.io\/set\/lea"/.test(leaHtml.html)
const noVercelInCanonical = !/rel="canonical"[^>]*vercel\.app/.test(leaHtml.html)
row('sealed', 'lea sealed CTA rendered', { url: leaHtml.url, status: leaHtml.status }, {
  hasSealedCta, hasEbayCampid, canonicalOk, noVercelInCanonical,
})

// 5. 5 recent + 5 older sets — pull directly from Supabase to get realistic codes.
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: recentSets } = await sb.from('mtg_sets').select('code, released_at').eq('digital', false).order('released_at', { ascending: false }).limit(5)
const { data: olderSets } = await sb.from('mtg_sets').select('code, released_at').eq('digital', false).not('released_at','is',null).order('released_at', { ascending: true }).limit(5)
for (const s of recentSets ?? []) row('set-recent', `/set/${s.code} (${s.released_at})`, await hit(`/set/${s.code}`, { redirect: 'follow' }))
for (const s of olderSets ?? [])  row('set-old',    `/set/${s.code} (${s.released_at})`, await hit(`/set/${s.code}`, { redirect: 'follow' }))

// 6. 20 logical card URLs — build from a representative set of oracle names.
const logicalNames = ['Black Lotus','Ragavan, Nimble Pilferer','Lightning Bolt','Counterspell','Sheoldred, the Apocalypse','The One Ring','Orcish Bowmasters','Chalice of the Void','Force of Will','Ledger Shredder','Emrakul, the Aeons Torn','Mox Ruby','Mox Sapphire','Mox Emerald','Mox Jet','Mox Pearl','Ancestral Recall','Time Walk','Timetwister','Underground Sea']
function slug(name) { return String(name).toLowerCase().replace(/[‘’']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') }
for (const name of logicalNames) {
  // Take an arbitrary English printing.
  const { data: rows } = await sb.from('mtg_oracle_cards').select('id, name').ilike('name', name).limit(1)
  if (!rows || rows.length === 0) { row('logical-card', `no oracle for ${name}`, { url: name, status: 0 }); continue }
  const oracle = rows[0]
  const { data: prints } = await sb.from('mtg_printings').select('set_code, collector_number, name').eq('oracle_card_id', oracle.id).eq('digital', false).eq('lang', 'en').not('collector_number', 'is', null).order('released_at', { ascending: false }).limit(1)
  if (!prints || prints.length === 0) { row('logical-card', `no printing for ${name}`, { url: name, status: 0 }); continue }
  const p = prints[0]
  const path = `/set/${p.set_code}/card/${encodeURIComponent(p.collector_number)}-${slug(p.name)}`
  row('logical-card', name, await hit(path, { redirect: 'follow' }))
}

// 7. 20 random exact printings.
const { data: randomPrints } = await sb.from('mtg_printings').select('set_code, collector_number, name').eq('digital', false).eq('lang', 'en').not('collector_number', 'is', null).order('id').limit(2000)
if (randomPrints && randomPrints.length > 0) {
  const step = Math.max(1, Math.floor(randomPrints.length / 20))
  for (let i = 0; i < 20 && i * step < randomPrints.length; i++) {
    const p = randomPrints[i * step]
    const path = `/set/${p.set_code}/card/${encodeURIComponent(p.collector_number)}-${slug(p.name)}`
    row('printing', `${p.set_code}·${p.collector_number}`, await hit(path, { redirect: 'follow' }))
  }
}

// 8. /api/admin/health — unauthenticated + wrong bearer.
const noAuth = await hit('/api/admin/health')
row('health', 'no auth', noAuth, { expected: 401 })
const wrongAuth = await hit('/api/admin/health', { headers: { authorization: 'Bearer nope' } })
row('health', 'wrong bearer', wrongAuth, { expected: 401 })
if (CRON_SECRET) {
  const goodAuth = await hit('/api/admin/health', { headers: { authorization: `Bearer ${CRON_SECRET}` } })
  const bodySnippet = (await goodAuth.res.text()).slice(0, 200)
  row('health', 'valid bearer', goodAuth, { bodyLeadingChars: bodySnippet.length, ok200OrExpected: goodAuth.status })
}

// 9. Homepage canonical + noindex sanity.
const home = await hitAndParseHtml('/')
row('seo', 'home canonical + noindex', { url: home.url, status: home.status }, {
  canonicalIsProd: /rel="canonical"\s+href="https:\/\/mtgprices\.io\/?"/.test(home.html),
  noVercelInCanonical: !/rel="canonical"[^>]*vercel\.app/.test(home.html),
  xRobotsHeader: home.xRobots,
})

// Print summary.
const buckets = {}
for (const r of results) { buckets[r.bucket] = buckets[r.bucket] || { pass: 0, fail: 0, rows: [] }; buckets[r.bucket].rows.push(r) }
console.log('\n===== Pass 2A Preview smoke results =====')
for (const [name, b] of Object.entries(buckets)) {
  console.log(`\n[${name}]`)
  for (const r of b.rows) {
    const marker = (r.status >= 200 && r.status < 400) ? '✓' : (r.status === 401 && r.expected === 401) ? '✓' : (r.status === 308 && r.expected?.includes('308')) ? '✓' : '✗'
    const extras = Object.entries(r).filter(([k]) => !['bucket','label','url','status','xRobots'].includes(k)).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(' ')
    console.log(`  ${marker} ${String(r.status).padEnd(4)} ${r.label}  ${extras}`)
  }
}
writeFileSync('docs/audit/preview-smoke-results.json', JSON.stringify(results, null, 2))
console.log(`\nFull results written to docs/audit/preview-smoke-results.json`)
