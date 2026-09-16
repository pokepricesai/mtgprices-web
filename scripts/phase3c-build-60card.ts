// scripts/phase3c-build-60card.ts
// Focused live retest of just the 60-card constructed scenario after
// the pool-size + plan.colors tweak.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

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

const require = createRequire(import.meta.url)
const soPath = require.resolve('server-only')
require.cache[soPath] = { id: soPath, filename: soPath, loaded: true, exports: {}, children: [], paths: [], parent: null, path: soPath, isPreloading: false, require } as any
const { createClient } = require('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  console.log('=== Phase 3C: 60-card constructed retest ===\n')
  const { runBuildPipeline } = await import('../src/lib/ai/build/pipeline')
  const t0 = Date.now()
  const r = await runBuildPipeline({
    format: 'modern' as any,
    brief: 'A 60-card blue-red control deck. Emphasise cheap counterspells, card draw and a few finishers.',
    commanderOracleIds: [],
    useCollection: false,
  })
  const wall = Date.now() - t0

  const p = r.usage.plan, c = r.usage.select, rp = r.usage.repair
  if (p) console.log(`Stage A ok=${p.ok} in=${p.tokensIn} out=${p.tokensOut} ${p.latencyMs}ms $${(p.estimatedCostCents/100).toFixed(3)}`)
  if (c) console.log(`Stage C ok=${c.ok} in=${c.tokensIn} out=${c.tokensOut} ${c.latencyMs}ms $${(c.estimatedCostCents/100).toFixed(3)}`)
  if (rp) console.log(`Stage D ok=${rp.ok} in=${rp.tokensIn} out=${rp.tokensOut} ${rp.latencyMs}ms $${(rp.estimatedCostCents/100).toFixed(3)}`)
  console.log(`pool candidates: ${r.pool?.candidatePoolSize ?? 0}`)
  console.log(`total: in=${r.usage.total.tokensIn} out=${r.usage.total.tokensOut} $${(r.usage.total.estimatedCostCents/100).toFixed(3)}  wall=${wall}ms`)

  if (!r.ok) {
    console.log(`❌ pipeline failed: stage=${r.failureStage} error=${r.error}`)
    process.exit(0)
  }
  const proposed = r.proposed!
  const v = r.validation!
  const mainCount = proposed.main.reduce((n, m) => n + m.quantity, 0)
  const deckSize = mainCount + proposed.basic_lands_to_add
  console.log(`\n✅ ok  deck=${deckSize} (main-qty=${mainCount} unique=${proposed.main.length} + basics=${proposed.basic_lands_to_add})  validator.ok=${v.ok}  issues=${v.issues.length}`)
  if (v.issues.length > 0) for (const i of v.issues) console.log(`   ! ${i.kind}: ${i.message}`)
  console.log(`\nsummary: ${proposed.summary.slice(0, 300)}`)
  const ids = proposed.main.slice(0, 10).map((m) => m.oracle_card_id)
  const { data: names } = await s.from('mtg_oracle_cards').select('id, name, mana_cost, type_line').in('id', ids)
  const byId = new Map((names ?? []).map((n: any) => [n.id, n]))
  console.log('\nfirst 10:')
  for (const m of proposed.main.slice(0, 10)) {
    const nm = byId.get(m.oracle_card_id) as any
    console.log(`  x${m.quantity}  ${(nm?.name ?? '?').padEnd(30)}  ${(nm?.mana_cost ?? '').padEnd(10)}  ${(m.reason ?? '').slice(0, 70)}`)
  }
  process.exit(0)
}
main().catch((err) => { console.error(err); process.exit(1) })
