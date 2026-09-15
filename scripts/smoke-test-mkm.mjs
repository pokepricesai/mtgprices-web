// Probe a well-priced established set (Murders at Karlov Manor).
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function ms(t0) { return `${Math.round(performance.now() - t0)}ms` }

async function probeSet(code, opts = {}) {
  console.log(`\n## Set: ${code}`)
  const t0 = performance.now()
  const { data: set } = await s.from('mtg_sets').select('code, name, released_at, card_count').eq('code', code).maybeSingle()
  console.log(`  set meta → ${ms(t0)}   ${set?.name} released ${set?.released_at} (${set?.card_count} cards)`)

  const t1 = performance.now()
  const { data: printings } = await s.from('mtg_printings')
    .select('id, name, collector_number, image_uri_small, rarity, oracle_card_id')
    .eq('set_code', code).eq('lang', 'en').eq('digital', false).order('collector_number').limit(3000)
  console.log(`  printings → ${printings?.length} in ${ms(t1)}`)

  const printingIds = printings.map(p => p.id)
  const t2 = performance.now()
  const finishes = []
  for (let i = 0; i < printingIds.length; i += 100) {
    const chunk = printingIds.slice(i, i + 100)
    const { data, error } = await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
    if (error) { console.error('  finishes chunk error:', error.message); continue }
    for (const r of data ?? []) finishes.push(r)
  }
  console.log(`  finishes → ${finishes.length} in ${ms(t2)}`)

  const finishIds = finishes.map(f => f.id)
  const t3 = performance.now()
  const prices = []
  for (let i = 0; i < finishIds.length; i += 100) {
    const chunk = finishIds.slice(i, i + 100)
    const { data, error } = await s.from('mtg_current_prices')
      .select('printing_finish_id, provider, market, currency, price_type, price')
      .in('printing_finish_id', chunk)
    if (error) { console.error('  prices chunk error:', error.message); continue }
    for (const r of data ?? []) prices.push(r)
  }
  console.log(`  current_prices → ${prices.length} in ${ms(t3)}`)

  // Pick a well-known card to probe deeper
  if (opts.probeName) {
    const target = printings.find(p => p.name.toLowerCase().includes(opts.probeName.toLowerCase()))
    if (target) {
      console.log(`\n  ─ card probe: ${target.name} #${target.collector_number}`)
      const finish = finishes.find(f => f.printing_id === target.id && f.finish === 'nonfoil')
      if (finish) {
        const since = new Date(); since.setUTCDate(since.getUTCDate() - 90)
        const sinceIso = since.toISOString().slice(0, 10)
        const t4 = performance.now()
        const { data: hist } = await s.from('mtg_price_observations')
          .select('provider, observed_on, price')
          .eq('printing_finish_id', finish.id)
          .gte('observed_on', sinceIso)
          .eq('market', 'paper').eq('currency', 'USD').eq('price_type', 'retail').eq('is_anomalous', false)
          .order('observed_on').limit(5000)
        console.log(`    90d history → ${hist?.length} rows in ${ms(t4)}`)
        if (hist && hist.length) {
          const providers = [...new Set(hist.map(x => x.provider))]
          console.log(`    providers: ${providers.join(', ')}`)
          const latestByProvider = new Map()
          for (const h of hist) latestByProvider.set(h.provider, h)
          for (const [p, h] of latestByProvider) console.log(`    ${p.padEnd(12)} $${h.price} on ${h.observed_on}`)
        }
      }
    }
  }
}

await probeSet('mkm', { probeName: 'Massacre Girl' })
await probeSet('blb', { probeName: 'Season of the' })
await probeSet('lea', { probeName: 'Black Lotus' })
