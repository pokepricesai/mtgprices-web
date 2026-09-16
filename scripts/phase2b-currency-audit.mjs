// scripts/phase2b-currency-audit.mjs
// Audit currency/provider/price-type distribution so the natural-language
// price parser and Card Finder price filters use only what's real. We
// never silently FX between currencies.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
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
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function countBy(dim) {
  // Use per-value head-count queries to get real totals (avoids
  // PostgREST 1000-row select-cap issue seen in earlier audits).
  const known = {
    currency:   ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
    market:     ['paper', 'mtgo', 'mtga'],
    price_type: ['retail', 'buylist', 'foil_retail', 'etched_retail'],
    provider:   ['tcgplayer', 'cardkingdom', 'cardmarket', 'manapool', 'cardhoarder'],
  }
  const out = new Map()
  for (const v of known[dim]) {
    const { count } = await s.from('mtg_current_prices').select('*', { count: 'exact', head: true }).eq(dim, v)
    if ((count ?? 0) > 0) out.set(v, count)
  }
  return out
}

console.log('=== mtg_current_prices — dimension distribution ===\n')

for (const dim of ['currency', 'market', 'price_type', 'provider']) {
  const map = await countBy(dim)
  console.log(`## ${dim}`)
  for (const [k, v] of Array.from(map.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(14)} ${v.toLocaleString()}`)
  }
  console.log()
}

// Currency × provider — needed to know which combinations we can price
// against without FX conversion.
console.log('## provider × currency')
const providers = ['tcgplayer', 'cardkingdom', 'cardmarket', 'manapool', 'cardhoarder']
const currencies = ['USD', 'EUR', 'GBP']
for (const p of providers) {
  const parts = []
  for (const c of currencies) {
    const { count } = await s.from('mtg_current_prices').select('*', { count: 'exact', head: true }).eq('provider', p).eq('currency', c)
    if ((count ?? 0) > 0) parts.push(`${c}=${count.toLocaleString()}`)
  }
  console.log(`  ${p.padEnd(14)} ${parts.join('   ') || '(none)'}`)
}

// Sanity: a few USD prices, a few EUR prices.
console.log('\n## Sample USD & EUR rows')
for (const cur of ['USD', 'EUR']) {
  const { data } = await s.from('mtg_current_prices').select('provider, market, currency, price_type, price, observed_on').eq('currency', cur).order('observed_on', { ascending: false }).limit(3)
  console.log(`  ${cur}:`)
  for (const r of data ?? []) console.log(`    ${r.provider}/${r.market}/${r.price_type}  ${r.price}  (${r.observed_on})`)
}

process.exit(0)
