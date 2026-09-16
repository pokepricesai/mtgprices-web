// scripts/phase2b-audit.mjs — pre-migration sanity for the Card Finder plan.
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

console.log('## mtg_oracle_cards.id shape (uuid vs text)')
const { data: idProbe } = await s.from('mtg_oracle_cards').select('id, oracle_id, name').limit(1)
console.log(`  first row id=${idProbe?.[0]?.id}  oracle_id=${idProbe?.[0]?.oracle_id}`)

console.log('\n## Would a capability filter be useful? Confirm broad hits from Phase 2A probes')
const probes = [
  { label: 'destroy target creature',      pattern: '%destroy target creature%' },
  { label: 'destroy target artifact',      pattern: '%destroy target artifact%' },
  { label: 'destroy target enchantment',   pattern: '%destroy target enchantment%' },
  { label: 'destroy target planeswalker',  pattern: '%destroy target planeswalker%' },
  { label: 'destroy all creatures',        pattern: '%destroy all creatures%' },
  { label: 'draw a card',                   pattern: '%draw a card%' },
  { label: 'counter target spell',          pattern: '%counter target spell%' },
  { label: 'search your library for',       pattern: '%search your library for%' },
  { label: 'create ... token',              pattern: '%create a % token%' },
  { label: 'from your graveyard',           pattern: '%from your graveyard%' },
  { label: 'protection from',               pattern: '%protection from%' },
  { label: 'sacrifice a creature',          pattern: '%sacrifice a creature%' },
  { label: 'gain 2 life',                   pattern: '%gain 2 life%' },
  { label: 'target opponent loses',         pattern: '%target opponent loses%' },
  { label: 'costs {1} less',                pattern: '%costs {1} less%' },
  { label: 'create a copy of',              pattern: '%create a copy of%' },
]
for (const p of probes) {
  const t = t0()
  const { count } = await s.from('mtg_oracle_cards').select('*', { count: 'exact', head: true }).ilike('oracle_text', p.pattern)
  console.log(`  [${ms(t).padStart(6)}] ${p.label.padEnd(32)} ${(count ?? 0).toLocaleString()}`)
}

console.log('\n## Sample oracle_text over card_faces (multi-face)')
{
  const { data } = await s.from('mtg_oracle_cards').select('name, layout, oracle_text, card_faces')
    .eq('layout', 'modal_dfc').limit(2)
  for (const r of data ?? []) {
    const facesLen = Array.isArray(r.card_faces) ? r.card_faces.length : 0
    console.log(`  ${r.name}  layout=${r.layout}  oracle_text=${r.oracle_text ? 'present' : 'null'}  faces=${facesLen}`)
  }
}

console.log('\n## Baseline row size — will a text[] column bloat?')
{
  const { data } = await s.from('mtg_oracle_cards').select('*').limit(1)
  const bytes = Buffer.byteLength(JSON.stringify(data?.[0] ?? {}), 'utf8')
  console.log(`  average row (JSON size): ${bytes} bytes`)
}

process.exit(0)
