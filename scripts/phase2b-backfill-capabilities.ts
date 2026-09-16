// scripts/phase2b-backfill-capabilities.ts
//
// One-shot full backfill of mtg_oracle_cards.capabilities across the
// entire ~40k Oracle catalogue. Imports the SAME classifier the app
// uses — src/lib/mtg/capabilities.ts — so there is no manually
// synchronised second copy of the taxonomy.
//
// Requires migrations/2026-09-16-mtg-oracle-capabilities.sql to be
// applied first (adds the column, GIN index and RPC helper).
//
// Idempotent. Chunked (1000 rows per RPC call).
//
// Usage:
//   npx tsx scripts/phase2b-backfill-capabilities.ts

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { classify, CAPABILITY_TAGS, type CardCapability } from '../src/lib/mtg/capabilities'

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
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type Row = {
  id: string
  type_line: string | null
  oracle_text: string | null
  keywords: string[] | null
  card_faces: unknown
  produced_mana: string[] | null
}

async function main() {
console.log(`Backfilling mtg_oracle_cards.capabilities…`)
console.log(`Classifier: src/lib/mtg/capabilities.ts (${CAPABILITY_TAGS.length} tags in taxonomy)\n`)

const t0 = performance.now()
const PAGE = 1000
let offset = 0
let total = 0
let empty = 0
const capCounts = new Map<CardCapability, number>()

while (true) {
  const { data, error } = await s.from('mtg_oracle_cards')
    .select('id, type_line, oracle_text, keywords, card_faces, produced_mana')
    .order('id', { ascending: true })
    .range(offset, offset + PAGE - 1)
  if (error) { console.error('fetch error:', error); process.exit(1) }
  if (!data || data.length === 0) break

  const payload = (data as Row[]).map((row) => {
    const caps = classify({
      type_line: row.type_line,
      oracle_text: row.oracle_text,
      keywords: row.keywords,
      produced_mana: row.produced_mana,
      card_faces: row.card_faces,
    })
    if (caps.length === 0) empty++
    for (const c of caps) capCounts.set(c, (capCounts.get(c) ?? 0) + 1)
    return { id: row.id, capabilities: caps }
  })

  const { data: updated, error: rpcErr } = await s.rpc('mtg_bulk_update_capabilities', { payload })
  if (rpcErr) { console.error('rpc error:', rpcErr); process.exit(1) }

  total += data.length
  offset += PAGE
  console.log(`  batch ${offset / PAGE}: +${updated} rows  (${Math.round(performance.now() - t0)}ms elapsed)`)
  if (data.length < PAGE) break
}

console.log(`\nDone in ${Math.round((performance.now() - t0) / 1000)}s.`)
console.log(`Rows tagged: ${total.toLocaleString()}  (empty=${empty.toLocaleString()})`)
console.log('\nCapability histogram:')
for (const [k, v] of Array.from(capCounts.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${v.toLocaleString()}`)
}
process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
