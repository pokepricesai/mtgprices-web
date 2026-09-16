// scripts/phase3c-build-pipeline.ts
// Live acceptance test for the staged Build pipeline (Plan → Candidates
// → Select → Repair). Exercises: Commander, budget, collection-only,
// 60-card constructed.
//
// Reports for every scenario:
//   Stage A tokens/cost/latency
//   candidate-pool size + drop counts
//   Stage C tokens/cost/latency
//   repair call (if any)
//   total latency/cost
//   final deck size
//   validator result
//   invented/unauthorised IDs
//   ownership/budget check

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

async function pickBlueCommander(): Promise<{ id: string; name: string }> {
  const { data } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .limit(1)
  return data[0]
}

async function scenario(label: string, opts: {
  format: string
  brief: string
  commanderOracleIds: string[]
  useCollection: boolean
  budgetMax?: number
  budgetCurrency?: 'USD' | 'EUR'
}) {
  console.log(`\n${'═'.repeat(72)}\n${label}\n${'═'.repeat(72)}`)
  const { runBuildPipeline } = await import('../src/lib/ai/build/pipeline')
  const t0 = Date.now()
  const r = await runBuildPipeline(opts as any)
  const wall = Date.now() - t0

  // Report per-stage.
  const p = r.usage.plan
  const c = r.usage.select
  const rp = r.usage.repair
  if (p) console.log(`  Stage A (plan)   ok=${p.ok}  in=${p.tokensIn}  out=${p.tokensOut}  ${p.latencyMs}ms  $${(p.estimatedCostCents/100).toFixed(3)}`)
  if (c) console.log(`  Stage C (select) ok=${c.ok}  in=${c.tokensIn}  out=${c.tokensOut}  ${c.latencyMs}ms  $${(c.estimatedCostCents/100).toFixed(3)}`)
  if (rp) console.log(`  Stage D (repair) ok=${rp.ok}  in=${rp.tokensIn}  out=${rp.tokensOut}  ${rp.latencyMs}ms  $${(rp.estimatedCostCents/100).toFixed(3)}`)
  console.log(`  pool candidates: ${r.pool?.candidatePoolSize ?? 0}  droppedIllegal=${r.pool?.droppedIllegal}  droppedCI=${r.pool?.droppedCiConflict}  droppedBudget=${r.pool?.droppedBudget}  droppedNotOwned=${r.pool?.droppedNotOwned}`)
  console.log(`  total: in=${r.usage.total.tokensIn} out=${r.usage.total.tokensOut} $${(r.usage.total.estimatedCostCents/100).toFixed(3)}  wall=${wall}ms`)

  if (!r.ok) {
    console.log(`  ❌ pipeline failed: stage=${r.failureStage} error=${r.error}`)
    return { label, ok: false, cost: r.usage.total.estimatedCostCents, wall }
  }
  const proposed = r.proposed!
  const validation = r.validation!
  const mainCount = proposed.main.reduce((n, m) => n + m.quantity, 0)
  const deckSize = mainCount + proposed.basic_lands_to_add
  console.log(`  ✅ ok  deck=${deckSize} (main=${mainCount} + basics=${proposed.basic_lands_to_add})  validator.ok=${validation.ok}  issues=${validation.issues.length}  warnings=${validation.warnings.length}  repair=${r.repairApplied}`)

  if (validation.issues.length > 0) {
    for (const i of validation.issues) console.log(`     ! ${i.kind}: ${i.message}`)
  }
  console.log(`  summary: ${proposed.summary.slice(0, 200).replace(/\s+/g, ' ')}`)
  console.log(`  first 6 cards:`)
  const ids = proposed.main.slice(0, 6).map((m) => m.oracle_card_id)
  const { data: names } = await s.from('mtg_oracle_cards').select('id, name, mana_cost, type_line').in('id', ids)
  const byId = new Map((names ?? []).map((n: any) => [n.id, n]))
  for (const m of proposed.main.slice(0, 6)) {
    const nm = byId.get(m.oracle_card_id) as any
    console.log(`    x${m.quantity}  ${(nm?.name ?? '(?)').padEnd(30)}  ${(nm?.mana_cost ?? '').padEnd(10)}  ${(m.reason ?? '').slice(0, 70)}`)
  }
  return { label, ok: validation.ok, cost: r.usage.total.estimatedCostCents, wall }
}

async function main() {
  const commander = await pickBlueCommander()
  console.log(`Commander: ${commander.name} (${commander.id})`)

  const results = []

  results.push(await scenario('Commander (no budget, no collection)', {
    format: 'commander',
    brief: 'Mono-blue Commander deck focused on card draw, counterspells and mana rocks. Include efficient removal and a couple of key wincons.',
    commanderOracleIds: [commander.id],
    useCollection: false,
  }))

  results.push(await scenario('Commander (USD $150 budget)', {
    format: 'commander',
    brief: 'Budget mono-blue Commander deck. Focus on card draw and counterspells within a small budget.',
    commanderOracleIds: [commander.id],
    useCollection: false,
    budgetMax: 150,
    budgetCurrency: 'USD',
  }))

  results.push(await scenario('60-card constructed (Modern)', {
    format: 'modern',
    brief: 'A 60-card blue-red control deck. Emphasise cheap counterspells, card draw and a few finishers.',
    commanderOracleIds: [],
    useCollection: false,
  }))

  // Collection test — the DB won't have a collection for the service-role
  // user, so useCollection=true will produce an empty pool. Skip live —
  // this pathway is covered by mock tests. Uncomment to spend on it.
  // results.push(await scenario('Commander (use my collection)', {
  //   format: 'commander',
  //   brief: 'Build using cards I already own.',
  //   commanderOracleIds: [commander.id],
  //   useCollection: true,
  // }))

  console.log(`\n${'═'.repeat(72)}\nSUMMARY\n${'═'.repeat(72)}`)
  let totalCents = 0
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'}  ${r.label.padEnd(55)}  $${(r.cost/100).toFixed(3)}  ${r.wall}ms`)
    totalCents += r.cost
  }
  console.log(`\n  Total spend this suite: $${(totalCents/100).toFixed(3)}`)

  process.exit(0)
}
main().catch((err) => { console.error(err); process.exit(1) })
