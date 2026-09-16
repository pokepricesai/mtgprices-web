// scripts/phase2a-schema-audit-v2.mjs — targeted counts (avoids 1K page cap).
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

async function countWhere(table, col, val) {
  const { count } = await s.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
  return count ?? 0
}

console.log('## Format counts in mtg_oracle_legalities')
const FORMATS = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper',
  'historic', 'timeless', 'brawl', 'alchemy', 'explorer', 'oathbreaker',
  'premodern', 'penny', 'gladiator', 'oldschool', 'predh', 'future', 'duel',
  'standardbrawl', 'commander_1v1',
]
for (const f of FORMATS) {
  const legal   = await countWhere('mtg_oracle_legalities', 'format', f)
  const banned  = (await s.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', f).eq('legality', 'banned')).count ?? 0
  const restrictable = (await s.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', f).eq('legality', 'restricted')).count ?? 0
  const legalOnly = (await s.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('format', f).eq('legality', 'legal')).count ?? 0
  if (legal > 0) console.log(`  ${f.padEnd(18)} total=${legal.toString().padStart(6)}  legal=${legalOnly.toString().padStart(6)}  banned=${banned.toString().padStart(4)}  restricted=${restrictable.toString().padStart(3)}`)
}
console.log()

console.log('## Layout counts in mtg_oracle_cards')
const LAYOUTS = [
  'normal', 'split', 'flip', 'transform', 'modal_dfc', 'meld', 'leveler', 'class',
  'case', 'saga', 'adventure', 'mutate', 'prototype', 'battle', 'planar',
  'scheme', 'vanguard', 'token', 'double_faced_token', 'emblem', 'augment',
  'host', 'art_series', 'reversible_card', 'aftermath',
]
for (const l of LAYOUTS) {
  const c = await countWhere('mtg_oracle_cards', 'layout', l)
  if (c > 0) console.log(`  ${l.padEnd(22)} ${c.toLocaleString()}`)
}
console.log()

console.log('## Distinct legality values across all rows')
{
  const rows = new Set()
  for (const v of ['legal', 'not_legal', 'banned', 'restricted']) {
    const c = (await s.from('mtg_oracle_legalities').select('*', { count: 'exact', head: true }).eq('legality', v)).count ?? 0
    if (c > 0) console.log(`  ${v.padEnd(14)} ${c.toLocaleString()}`)
  }
}
console.log()

console.log('## Finish counts across all printings')
for (const f of ['nonfoil', 'foil', 'etched', 'glossy']) {
  const c = await countWhere('mtg_printing_finishes', 'finish', f)
  if (c > 0) console.log(`  ${f.padEnd(10)} ${c.toLocaleString()}`)
}
console.log()

console.log('## mtg_current_prices provider dimension counts')
for (const p of ['tcgplayer', 'cardkingdom', 'cardmarket', 'manapool', 'cardhoarder']) {
  const c = await countWhere('mtg_current_prices', 'provider', p)
  console.log(`  ${p.padEnd(14)} ${c.toLocaleString()}`)
}
console.log()

console.log('## mtg_price_observations state')
{
  const t = performance.now()
  const { count } = await s.from('mtg_price_observations').select('*', { count: 'exact', head: true })
  console.log(`  head-count: ${count} (${Math.round(performance.now()-t)}ms)`)
  const { data } = await s.from('mtg_price_observations').select('observed_on, price, provider').limit(5)
  console.log(`  sample rows: ${JSON.stringify(data)}`)
}
console.log()

console.log('## mtg_sets — sets that would show under "public" set types')
const PUBLIC_TYPES = ['core', 'expansion', 'commander', 'draft_innovation', 'masters', 'masterpiece', 'starter']
for (const t of PUBLIC_TYPES) {
  const c = (await s.from('mtg_sets').select('*', { count: 'exact', head: true }).eq('set_type', t).eq('digital', false)).count ?? 0
  console.log(`  ${t.padEnd(20)} ${c.toLocaleString()}`)
}
console.log()

console.log('## Rulings distribution (a few examples)')
{
  const { data } = await s.from('mtg_rulings')
    .select('published_at, comment, source')
    .order('published_at', { ascending: false })
    .limit(3)
  for (const r of data ?? []) console.log(`  ${r.published_at} [${r.source}] ${r.comment.substring(0, 90)}…`)
}
console.log()

console.log('## Sample game_changer / reserved counts')
{
  const gc = (await s.from('mtg_oracle_cards').select('*', { count: 'exact', head: true }).eq('game_changer', true)).count ?? 0
  const rl = (await s.from('mtg_oracle_cards').select('*', { count: 'exact', head: true }).eq('reserved', true)).count ?? 0
  console.log(`  game_changer=true: ${gc}   reserved=true (RL): ${rl}`)
}
console.log()

console.log('## produced_mana sample')
{
  const { data } = await s.from('mtg_oracle_cards')
    .select('name, produced_mana')
    .not('produced_mana', 'is', null)
    .limit(5)
  for (const r of data ?? []) console.log(`  ${r.name}: ${JSON.stringify(r.produced_mana)}`)
}
console.log()

console.log('## Card capability probes — text patterns present?')
const PROBES = [
  { name: 'card draw',      pattern: 'draw a card' },
  { name: 'destroy',        pattern: 'destroy target' },
  { name: 'exile',          pattern: 'exile target' },
  { name: 'counter spell',  pattern: 'counter target spell' },
  { name: 'life gain',      pattern: 'gain 2 life' },
  { name: 'token creation', pattern: 'create a' },
  { name: 'sacrifice',      pattern: 'sacrifice a' },
  { name: 'graveyard',      pattern: 'from your graveyard' },
  { name: 'tutor',          pattern: 'search your library' },
  { name: 'board wipe',     pattern: 'destroy all' },
]
for (const p of PROBES) {
  const c = (await s.from('mtg_oracle_cards').select('*', { count: 'exact', head: true }).ilike('oracle_text', `%${p.pattern}%`)).count ?? 0
  console.log(`  ${p.name.padEnd(18)} pattern "${p.pattern}"  matches=${c.toLocaleString()}`)
}

process.exit(0)
