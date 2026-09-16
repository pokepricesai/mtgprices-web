// scripts/phase3c-build-object.ts
// Retest Build after the runAiObject + smaller schema refactor.

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
  console.log('=== Phase 3C: Build via runAiObject (schema-enforced, small output) ===\n')
  const { data: leg } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .limit(1)
  const commanderId = leg![0].id
  const commanderName = leg![0].name
  console.log(`Commander: ${commanderName}`)

  const { runAiObject } = await import('../src/lib/ai/run')
  const { BUILD_SYSTEM, buildUserPrompt } = await import('../src/lib/ai/prompts')
  const { verifyBuildResponse, BuildSchema } = await import('../src/lib/ai/grounding')
  const { bindBuilderTools } = await import('../src/lib/ai/tools')

  const builder = (bindBuilderTools as any)({
    format: 'commander',
    commanderOracleIds: [commanderId],
    includeCollection: false,
    currency: 'USD' as const,
  })
  const brief = 'Simple mono-blue Commander deck around this commander. Include counterspells, card draw, mana rocks, and a mono-blue mana base — the app fills the basic Islands automatically.'
  const t0 = Date.now()
  const r = await runAiObject({
    tier: 'reasoning',
    system: BUILD_SYSTEM,
    prompt: buildUserPrompt({ format: 'commander', brief, commanderName }),
    schema: BuildSchema,
    tools: builder.tools,
    maxSteps: 8,
    timeoutMs: 200_000,
  })
  const totalMs = Date.now() - t0
  console.log(`ok=${r.ok} errorKind=${(r as any).errorKind}  in=${r.tokensIn}  out=${r.tokensOut}  latency=${r.latencyMs}ms  est=$${(r.estimatedCostCents/100).toFixed(3)}  wall=${totalMs}ms`)
  if (!r.ok) {
    console.log(`raw error: ${String(r.text).slice(0, 500)}`)
    process.exit(0)
  }
  const verified = r.value ? await (verifyBuildResponse as any)(r.value, 'commander', builder.authorised) : null
  console.log(`grounding.ok=${verified?.ok}  grounding.error=${(verified as any)?.error ?? 'none'}`)
  if (verified?.ok) {
    console.log(`\ncommanders=${verified.value.commanders.length}  main=${verified.value.main.length}  basic_lands_to_add=${verified.value.basic_lands_to_add}  total_qty=${verified.value.main.reduce((n: number, m: any) => n + m.quantity, 0)}`)
    console.log(`\nsummary: ${verified.value.summary.slice(0, 400)}`)
    console.log('\nfirst 10 main entries:')
    // hydrate names
    const ids = verified.value.main.slice(0, 10).map((m: any) => m.oracle_card_id)
    const { data: names } = await s.from('mtg_oracle_cards').select('id, name, mana_cost, type_line').in('id', ids)
    const byId = new Map((names ?? []).map((n: any) => [n.id, n]))
    for (const m of verified.value.main.slice(0, 10)) {
      const n = byId.get(m.oracle_card_id) as any
      console.log(`  x${m.quantity}  ${(n?.name ?? '(unknown)').padEnd(28)}  ${(n?.mana_cost ?? '').padEnd(10)}  ${(m.reason ?? '').slice(0, 80)}`)
    }
  }
  process.exit(0)
}
main().catch((err) => { console.error(err); process.exit(1) })
