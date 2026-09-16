// scripts/phase2a-smoke.mjs — hit each representative layout via
// getCardBySlug() + measure the classifier + faces normaliser.
//
// We only import from /src via ts-node style would be complex, so we
// replicate the queries here with the service-role Supabase client.

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

const t0 = () => performance.now()
const ms = (t) => `${Math.round(performance.now() - t)}ms`

async function findLayoutExample(layout) {
  const { data } = await s.from('mtg_oracle_cards')
    .select('id, name, layout, card_faces')
    .eq('layout', layout)
    .limit(1)
  if (!data?.[0]) return null
  const oracleId = data[0].id
  // Find a live printing.
  const { data: printings } = await s.from('mtg_printings')
    .select('set_code, collector_number, name')
    .eq('oracle_card_id', oracleId)
    .eq('lang', 'en')
    .eq('digital', false)
    .limit(1)
  if (!printings?.[0]) return null
  const p = printings[0]
  const slug = `${p.collector_number}-${(p.name).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
  return { layout, name: p.name, set_code: p.set_code, url: `/set/${p.set_code}/card/${slug}` }
}

console.log('=== Phase 2A smoke — representative card URLs ===\n')

const targets = [
  ['normal',       'basic creature/instant/sorcery'],
  ['split',        'split card'],
  ['flip',         'flip card'],
  ['transform',    'transform DFC'],
  ['modal_dfc',    'modal DFC'],
  ['adventure',    'adventure'],
  ['meld',         'meld'],
  ['saga',         'saga'],
  ['leveler',      'leveler'],
  ['class',        'class'],
]
for (const [layout, desc] of targets) {
  const ex = await findLayoutExample(layout)
  if (!ex) { console.log(`  ${desc.padEnd(28)} — none found`); continue }
  console.log(`  ${desc.padEnd(28)} ${ex.name}  →  https://mtgprices.io${ex.url}`)
}
console.log()

// Explicit named cases: planeswalker, battle, commander, foil/etched, vintage.
console.log('## Specific probes')
{
  const probes = [
    { label: 'planeswalker', q: 'Jace, the Mind Sculptor' },
    { label: 'battle',       q: 'Invasion of Alara' },
    { label: 'commander (legendary creature)', q: 'Atraxa, Praetors’ Voice' },
    { label: 'reserved list (vintage)', q: 'Black Lotus' },
    { label: 'game changer',  q: 'Ancient Tomb' },
  ]
  for (const p of probes) {
    const { data } = await s.from('mtg_oracle_cards')
      .select('id, name, layout, reserved, game_changer')
      .ilike('name', p.q)
      .limit(1)
    const o = data?.[0]
    if (!o) { console.log(`  ${p.label.padEnd(28)} no match "${p.q}"`); continue }
    const { data: prints } = await s.from('mtg_printings')
      .select('set_code, collector_number, name')
      .eq('oracle_card_id', o.id)
      .eq('lang', 'en')
      .limit(1)
    const pr = prints?.[0]
    if (!pr) continue
    const slug = `${pr.collector_number}-${(pr.name).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
    console.log(`  ${p.label.padEnd(28)} ${o.name} [${o.layout}] reserved=${o.reserved} gc=${o.game_changer} → /set/${pr.set_code}/card/${slug}`)
  }
}
console.log()

// Etched printing.
console.log('## Etched finish probe')
{
  const { data } = await s.from('mtg_printing_finishes').select('printing_id').eq('finish', 'etched').limit(1)
  if (data?.[0]) {
    const { data: p } = await s.from('mtg_printings').select('set_code, collector_number, name').eq('id', data[0].printing_id).limit(1)
    const pr = p?.[0]
    if (pr) {
      const slug = `${pr.collector_number}-${(pr.name).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
      console.log(`  etched printing example: ${pr.name} → /set/${pr.set_code}/card/${slug}`)
    }
  } else console.log('  no etched finishes indexed')
}

// Format counts sanity (subset).
console.log('\n## Format legality sanity')
for (const f of ['standard', 'commander', 'vintage']) {
  const t = t0()
  const [{ count: legal }, { count: banned }] = await Promise.all([
    s.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', f).eq('legality', 'legal'),
    s.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', f).eq('legality', 'banned'),
  ])
  console.log(`  [${ms(t)}] ${f.padEnd(12)} legal=${legal} banned=${banned}`)
}

// Test the searchCards logic path via raw queries.
console.log('\n## searchCards timing probes')
for (const c of ['bolt', 'draw a card / oracle-text search', 'commander legal + red']) {
  const t = t0()
  if (c === 'bolt') {
    await s.from('mtg_oracle_cards').select('id, name').ilike('name', '%bolt%').limit(300)
  } else if (c.startsWith('draw')) {
    await s.from('mtg_oracle_cards').select('id, name').ilike('oracle_text', '%draw a card%').limit(300)
  } else {
    const { data: o } = await s.from('mtg_oracle_cards').select('id').overlaps('colors', ['R']).limit(300)
    const ids = (o ?? []).map((r) => r.id)
    await s.from('mtg_oracle_legalities').select('oracle_card_id').in('oracle_card_id', ids).eq('format', 'commander').eq('legality', 'legal').limit(300)
  }
  console.log(`  [${ms(t).padStart(6)}]  ${c}`)
}

process.exit(0)
