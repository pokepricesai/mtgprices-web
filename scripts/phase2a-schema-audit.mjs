// scripts/phase2a-schema-audit.mjs — inventory what MTG data we actually have.
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

function t0() { return performance.now() }
function ms(t) { return `${Math.round(performance.now() - t)}ms` }

console.log('=== Phase 2A schema + data audit ===\n')

// 1. Sample columns for each table.
const tables = [
  'mtg_sets',
  'mtg_oracle_cards',
  'mtg_printings',
  'mtg_printing_finishes',
  'mtg_oracle_legalities',
  'mtg_rulings',
  'mtg_current_prices',
  'mtg_price_observations',
]
for (const table of tables) {
  const t = t0()
  const { data, error } = await s.from(table).select('*').limit(1)
  if (error) { console.log(`[${ms(t)}] ${table}: ERROR ${error.message}`); continue }
  const row = data?.[0]
  if (!row) { console.log(`[${ms(t)}] ${table}: (empty)`); continue }
  const cols = Object.keys(row).sort()
  console.log(`[${ms(t)}] ${table} (${cols.length} cols): ${cols.join(', ')}`)
}
console.log()

// 2. Row counts.
console.log('## Row counts')
for (const table of tables) {
  const t = t0()
  const { count } = await s.from(table).select('*', { count: 'exact', head: true })
  console.log(`  [${ms(t).padStart(6)}]  ${table.padEnd(28)} ${(count ?? 0).toLocaleString()}`)
}
console.log()

// 3. Layout distribution — critical for card-page rendering.
console.log('## mtg_oracle_cards.layout distribution')
{
  const { data } = await s.from('mtg_oracle_cards').select('layout').limit(120000)
  const counts = new Map()
  for (const r of data ?? []) counts.set(r.layout ?? '(null)', (counts.get(r.layout ?? '(null)') ?? 0) + 1)
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(20)} ${v.toLocaleString()}`)
  }
}
console.log()

// 4. Formats present in legality table.
console.log('## Distinct formats in mtg_oracle_legalities')
{
  const { data } = await s.from('mtg_oracle_legalities').select('format, legality').limit(200000)
  const formats = new Map()
  const legalities = new Map()
  for (const r of data ?? []) {
    formats.set(r.format, (formats.get(r.format) ?? 0) + 1)
    legalities.set(r.legality, (legalities.get(r.legality) ?? 0) + 1)
  }
  for (const [k, v] of [...formats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(20)} ${v.toLocaleString()}`)
  }
  console.log('  distinct legality values:', [...legalities.keys()].join(', '))
}
console.log()

// 5. Finishes present.
console.log('## mtg_printing_finishes.finish distribution')
{
  const { data } = await s.from('mtg_printing_finishes').select('finish').limit(400000)
  const counts = new Map()
  for (const r of data ?? []) counts.set(r.finish, (counts.get(r.finish) ?? 0) + 1)
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(20)} ${v.toLocaleString()}`)
  }
}
console.log()

// 6. Providers / markets / currencies in mtg_current_prices.
console.log('## mtg_current_prices providers / markets / currencies / price_types')
{
  const { data } = await s.from('mtg_current_prices').select('provider, market, currency, price_type').limit(300000)
  const dims = { provider: new Map(), market: new Map(), currency: new Map(), price_type: new Map() }
  for (const r of data ?? []) {
    for (const k of Object.keys(dims)) {
      const v = r[k]
      dims[k].set(v, (dims[k].get(v) ?? 0) + 1)
    }
  }
  for (const dim of Object.keys(dims)) {
    console.log(`  ${dim}:`)
    for (const [k, v] of [...dims[dim].entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(k).padEnd(20)} ${v.toLocaleString()}`)
  }
}
console.log()

// 7. Sample keywords — see what's actually populated.
console.log('## Sample keywords')
{
  const { data } = await s.from('mtg_oracle_cards').select('name, keywords').not('keywords', 'is', null).limit(10)
  for (const r of data ?? []) console.log(`  ${r.name}  →  ${JSON.stringify(r.keywords)}`)
}
console.log()

// 8. Sample card_faces for multi-face layouts.
console.log('## card_faces samples (one per layout)')
{
  const layouts = ['split', 'transform', 'modal_dfc', 'adventure', 'meld', 'aftermath', 'battle', 'flip']
  for (const layout of layouts) {
    const { data } = await s.from('mtg_oracle_cards')
      .select('name, layout, card_faces')
      .eq('layout', layout)
      .limit(1)
    const r = data?.[0]
    if (!r) { console.log(`  ${layout}: (none found)`); continue }
    const faces = r.card_faces
    const numFaces = Array.isArray(faces) ? faces.length : 0
    const faceKeys = numFaces > 0 ? Object.keys(faces[0]).sort().join(',') : '—'
    console.log(`  ${layout.padEnd(12)} ${r.name.padEnd(38)} faces=${numFaces} face_keys=[${faceKeys}]`)
  }
}
console.log()

// 9. Rulings volume distribution.
console.log('## Rulings volume')
{
  const { count } = await s.from('mtg_rulings').select('id', { count: 'exact', head: true })
  console.log(`  total rulings rows: ${count?.toLocaleString()}`)
}
console.log()

// 10. Set types + total non-digital sets.
console.log('## mtg_sets.set_type distribution')
{
  const { data } = await s.from('mtg_sets').select('set_type, digital').limit(3000)
  const counts = new Map()
  for (const r of data ?? []) counts.set(r.set_type ?? '(null)', (counts.get(r.set_type ?? '(null)') ?? 0) + 1)
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(20)} ${v.toLocaleString()}`)
  }
}

console.log('\n=== done ===')
process.exit(0)
