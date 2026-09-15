// scripts/smoke-test.mjs — hit the MTG data modules directly and time them.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env.local
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

// Register bare "server-only" module (importable in Node scripts).
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
try { require.resolve('server-only') } catch {}

const { createClient } = require('@supabase/supabase-js')

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function ms(t0) { return `${Math.round(performance.now() - t0)}ms` }

async function timed(label, fn) {
  const t0 = performance.now()
  const out = await fn()
  console.log(`  [${ms(t0).padStart(6)}]  ${label}`)
  return out
}

console.log('=== MTGPrices data-module smoke test ===\n')

// 1. Catalogue counts
console.log('## Catalogue counts')
{
  const c1 = await timed('mtg_sets count', () => s.from('mtg_sets').select('id', { count: 'exact', head: true }))
  const c2 = await timed('mtg_printings count', () => s.from('mtg_printings').select('id', { count: 'exact', head: true }))
  const c3 = await timed('mtg_current_prices count', () => s.from('mtg_current_prices').select('printing_finish_id', { count: 'exact', head: true }))
  console.log(`  sets=${c1.count?.toLocaleString()}  printings=${c2.count?.toLocaleString()}  priced=${c3.count?.toLocaleString()}`)
}

// 2. Recent sets
console.log('\n## Recent sets (top 5)')
{
  const t0 = performance.now()
  const { data } = await s.from('mtg_sets').select('code, name, released_at, card_count')
    .eq('digital', false).order('released_at', { ascending: false, nullsFirst: false }).limit(5)
  console.log(`  fetched in ${ms(t0)}`)
  for (const r of data ?? []) console.log(`    ${r.code.padEnd(5)}  ${r.released_at}  ${r.name}  (${r.card_count} cards)`)
}

// 3. Set page test — pick a recent set
console.log('\n## Set page probe — first recent expansion')
let sampleSetCode = null
{
  const { data: sets } = await s.from('mtg_sets').select('code, name').eq('digital', false).eq('set_type', 'expansion').order('released_at', { ascending: false }).limit(3)
  console.log(`  candidates: ${sets?.map(x => x.code).join(', ')}`)
  sampleSetCode = sets?.[0]?.code
  console.log(`  using set: ${sampleSetCode}`)

  const t0 = performance.now()
  const { data: printings } = await s.from('mtg_printings')
    .select('id, name, collector_number, image_uri_small, rarity, released_at')
    .eq('set_code', sampleSetCode).eq('lang', 'en').eq('digital', false)
    .order('collector_number').limit(3000)
  console.log(`  listPrintingsForSet(${sampleSetCode}) → ${printings?.length} rows in ${ms(t0)}`)

  if (printings && printings.length) {
    const printingIds = printings.map(p => p.id)
    const t1 = performance.now()
    const { data: finishes } = await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', printingIds)
    console.log(`  finishes.in(${printingIds.length}) → ${finishes?.length} rows in ${ms(t1)}`)

    if (finishes && finishes.length) {
      const finishIds = finishes.map(f => f.id)
      const t2 = performance.now()
      const { data: prices } = await s.from('mtg_current_prices')
        .select('printing_finish_id, provider, market, currency, price_type, price')
        .in('printing_finish_id', finishIds)
      console.log(`  current_prices.in(${finishIds.length}) → ${prices?.length} rows in ${ms(t2)}`)
    }
  }
}

// 4. Card page probe — pick a well-known card in a recent set
console.log('\n## Card page probe')
{
  const { data: card } = await s.from('mtg_printings')
    .select('id, set_code, collector_number, name, oracle_card_id')
    .eq('set_code', sampleSetCode).eq('lang', 'en')
    .order('collector_number').limit(1).maybeSingle()
  if (card) {
    console.log(`  probing: ${card.set_code}/${card.collector_number} ${card.name}`)

    const t0 = performance.now()
    const { data: oracle } = await s.from('mtg_oracle_cards')
      .select('id, name, mana_cost, type_line, oracle_text').eq('id', card.oracle_card_id).maybeSingle()
    console.log(`  oracle fetch → ${ms(t0)}   type_line="${oracle?.type_line}"`)

    const t1 = performance.now()
    const { data: finishes } = await s.from('mtg_printing_finishes').select('id, finish').eq('printing_id', card.id)
    console.log(`  finishes → ${finishes?.length} in ${ms(t1)}`)

    const t2 = performance.now()
    const { data: leg } = await s.from('mtg_oracle_legalities').select('format, legality').eq('oracle_card_id', card.oracle_card_id)
    console.log(`  legalities → ${leg?.length} in ${ms(t2)}`)

    const t3 = performance.now()
    const { data: rul } = await s.from('mtg_rulings').select('published_at, comment').eq('oracle_card_id', card.oracle_card_id).limit(20)
    console.log(`  rulings → ${rul?.length} in ${ms(t3)}`)

    const t4 = performance.now()
    const { data: others } = await s.from('mtg_printings').select('id, set_code, name, released_at')
      .eq('oracle_card_id', card.oracle_card_id).eq('lang', 'en').neq('id', card.id).order('released_at', { ascending: false }).limit(40)
    console.log(`  other printings → ${others?.length} in ${ms(t4)}`)

    // 90-day history for first finish
    if (finishes && finishes[0]) {
      const since = new Date(); since.setUTCDate(since.getUTCDate() - 90)
      const sinceIso = since.toISOString().slice(0, 10)
      const t5 = performance.now()
      const { data: hist } = await s.from('mtg_price_observations')
        .select('provider, market, currency, price_type, observed_on, price')
        .eq('printing_finish_id', finishes[0].id)
        .gte('observed_on', sinceIso)
        .eq('market', 'paper').eq('currency', 'USD').eq('price_type', 'retail')
        .eq('is_anomalous', false)
        .order('observed_on').limit(5000)
      console.log(`  90d history for finish ${finishes[0].id.slice(0,8)}… → ${hist?.length} rows in ${ms(t5)}`)
      if (hist && hist.length) {
        console.log(`    providers: ${[...new Set(hist.map(x => x.provider))].join(', ')}`)
        console.log(`    date range: ${hist[0].observed_on} → ${hist[hist.length-1].observed_on}`)
        console.log(`    sample: ${hist[hist.length-1].provider} $${hist[hist.length-1].price}`)
      }
    }
  }
}

// 5. Search probe
console.log('\n## Search probe')
{
  const t0 = performance.now()
  const { data: matches } = await s.from('mtg_oracle_cards').select('id, name, type_line').ilike('name', '%lightning bolt%').limit(20)
  console.log(`  ilike "%lightning bolt%" → ${matches?.length} oracles in ${ms(t0)}`)
  for (const m of matches?.slice(0, 5) ?? []) console.log(`    ${m.name}  —  ${m.type_line}`)
}

console.log('\ndone.')
