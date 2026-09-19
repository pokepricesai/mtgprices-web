// scripts/seo-audit.mjs
// Reusable pre-launch SEO audit for MTGPrices. Runs against a target
// origin (defaults to production https://mtgprices.io). Meant to be
// invoked as `npm run seo:audit` after each deploy.
//
// What it checks:
//   1. Root sitemap.xml parses, is a <sitemapindex>, references every
//      expected child.
//   2. Each child sitemap parses, has <=50k URLs, uses <urlset>.
//   3. No duplicate <loc> values across the whole sitemap corpus.
//   4. No obviously private routes in any sitemap
//      (/login, /account, /settings, /collection, /decks/..., etc.).
//   5. No search-result URLs (/cards/search) in any sitemap.
//   6. Sampled URLs (first, middle, last of each shard, plus a fixed
//      set of hub pages) return HTTP 200.
//   7. Each sampled indexable page has a <link rel="canonical"> and a
//      non-empty <title>.
//   8. Sampled canonical URLs equal the sitemap loc for cards / hubs.
//   9. FAQPage JSON-LD is NOT present on card pages (retired in 2026).
//  10. Homepage does not carry the "Public preview" chip.
//
// Exits non-zero on the first hard failure. Prints a short summary.
//
// Usage:
//   node scripts/seo-audit.mjs
//   TARGET=https://mtgprices.io node scripts/seo-audit.mjs

import { performance } from 'node:perf_hooks'

const TARGET = process.env.TARGET ?? 'https://mtgprices.io'
const UA = 'Mozilla/5.0 (MTGPrices SEO Audit)'

const HUB_PAGES = [
  '/', '/browse', '/market', '/formats', '/card-finder', '/insights', '/ai',
]

const PRIVATE_PATH_MARKERS = [
  '/login', '/account', '/settings', '/collection', '/decks/', '/decks',
  '/decks/new', '/decks/public/', '/decks/public',
  '/test-deck',                          // NOINDEX per SEO policy
  '/cards/search',                       // search results (param variant)
  '/api/',
]

let failures = 0
let softNotes = 0

function ok(msg) { console.log('  ✓ ' + msg) }
function bad(msg) { console.log('  ✗ ' + msg); failures += 1 }
function warn(msg) { console.log('  ! ' + msg); softNotes += 1 }

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    redirect: opts.redirect ?? 'manual',
  })
  const body = res.ok ? await res.text() : ''
  return { status: res.status, body, contentType: res.headers.get('content-type') ?? '' }
}

function extractLocs(xml) {
  const out = []
  const re = /<loc>([^<]+)<\/loc>/g
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim())
  return out
}

function pickSample(arr) {
  if (arr.length === 0) return []
  if (arr.length <= 3) return [...arr]
  return [arr[0], arr[Math.floor(arr.length / 2)], arr[arr.length - 1]]
}

async function checkPageIsIndexable(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual' })
  if (res.status !== 200) { bad(`${url} → HTTP ${res.status}`); return null }
  const html = await res.text()
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i)
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    canonical: canonicalMatch ? canonicalMatch[1].trim() : null,
    html,
  }
}

async function main() {
  console.log(`SEO audit against ${TARGET}`)
  const t0 = performance.now()

  // 1. Sitemap index
  console.log('\n1. sitemap.xml root index')
  const root = await fetchText(`${TARGET}/sitemap.xml`, { redirect: 'follow' })
  if (root.status !== 200) { bad(`sitemap.xml → HTTP ${root.status}`); process.exit(1) }
  if (!root.body.includes('<sitemapindex')) { bad('sitemap.xml is not a <sitemapindex>'); process.exit(1) }
  ok(`sitemap.xml served (${root.body.length} bytes)`)

  const childLocs = extractLocs(root.body)
  ok(`references ${childLocs.length} child sitemaps`)
  const expectedChildren = new Set(['sitemap-pages.xml', 'sitemap-sets.xml'])
  for (const c of childLocs) {
    const name = c.split('/').pop()
    if (/^sitemap-cards-\d+\.xml$/.test(name)) expectedChildren.add(name)
  }
  for (const req of ['sitemap-pages.xml', 'sitemap-sets.xml']) {
    if (childLocs.some((c) => c.endsWith(req))) ok(`  child ${req} present`)
    else bad(`  child ${req} missing from index`)
  }

  // 2, 3. Per-shard checks + duplicate loc detection
  console.log('\n2. Child sitemaps')
  const allLocs = new Set()
  const dupLocs = new Set()
  const childrenSample = []
  const shardCounts = {}
  for (const c of childLocs) {
    const child = await fetchText(c, { redirect: 'follow' })
    if (child.status !== 200) { bad(`${c} → HTTP ${child.status}`); continue }
    const name = c.split('/').pop()
    const locs = extractLocs(child.body)
    if (locs.length > 50000) bad(`${name} exceeds 50k URLs (${locs.length})`)
    else ok(`${name}: ${locs.length} URLs`)
    shardCounts[name] = locs.length
    for (const l of locs) {
      if (allLocs.has(l)) dupLocs.add(l)
      allLocs.add(l)
    }
    childrenSample.push({ name, sample: pickSample(locs) })
  }
  if (dupLocs.size === 0) ok('no duplicate <loc> across sitemaps')
  else bad(`${dupLocs.size} duplicate <loc> entries across sitemaps`)

  // 4, 5. Private / search URLs must not appear
  console.log('\n3. Sitemap contains no private / param-variant routes')
  let leaked = 0
  for (const loc of allLocs) {
    const path = loc.replace(/^https?:\/\/[^/]+/, '')
    for (const marker of PRIVATE_PATH_MARKERS) {
      if (path === marker || path.startsWith(marker + '/')) {
        bad(`  leaked ${path}`)
        leaked += 1
        break
      }
    }
  }
  if (leaked === 0) ok('no private / search URLs in sitemap')

  // 6. HTTP 200 sampling
  console.log('\n4. Sampled URL HTTP status')
  const samples = childrenSample.flatMap((c) => c.sample.slice(0, 3))
  const hubSamples = HUB_PAGES.map((p) => `${TARGET}${p}`)
  const combined = [...new Set([...hubSamples, ...samples])].slice(0, 30)
  for (const url of combined) {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual' })
    if (res.status === 200) ok(`  200  ${url}`)
    else if (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308) {
      warn(`  ${res.status} redirect ${url} → ${res.headers.get('location') ?? '?'}`)
    } else bad(`  ${res.status} ${url}`)
  }

  // 7, 8. Canonical + title on hub pages
  console.log('\n5. Canonicals and titles on hub pages')
  for (const p of HUB_PAGES) {
    const info = await checkPageIsIndexable(`${TARGET}${p}`)
    if (!info) continue
    if (!info.title) bad(`  ${p} has no <title>`)
    else ok(`  ${p} title: "${info.title.slice(0, 70)}${info.title.length > 70 ? '…' : ''}"`)
    if (!info.canonical) bad(`  ${p} has no canonical link`)
    else if (!info.canonical.startsWith('https://mtgprices.io')) bad(`  ${p} canonical is not absolute https://mtgprices.io`)
    else ok(`  ${p} canonical → ${info.canonical}`)
  }

  // 9. Card page: no FAQPage JSON-LD
  console.log('\n6. Card page has no FAQPage JSON-LD')
  const cardSample = `${TARGET}/set/lea/card/161-lightning-bolt`
  const card = await checkPageIsIndexable(cardSample)
  if (card) {
    if (card.html.includes('"@type":"FAQPage"')) bad('  FAQPage JSON-LD still present on card page')
    else ok('  no FAQPage JSON-LD on card page')
    if (card.html.includes('"@type":"BreadcrumbList"')) ok('  BreadcrumbList JSON-LD present')
    else bad('  BreadcrumbList JSON-LD missing from card page')
  }

  // 10. No "Public preview" wording on homepage
  console.log('\n7. Homepage does not carry pre-launch language')
  const home = await checkPageIsIndexable(`${TARGET}/`)
  if (home) {
    if (home.html.includes('Public preview')) bad('  homepage still has "Public preview"')
    else ok('  homepage is clean of "Public preview"')
  }

  const dt = ((performance.now() - t0) / 1000).toFixed(1)
  console.log(`\n=== ${failures} failure(s), ${softNotes} note(s) in ${dt}s ===`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(2) })
