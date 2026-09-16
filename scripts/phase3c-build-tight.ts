// scripts/phase3c-build-tight.ts
// Tight Build test with the updated prompt + reduced maxSteps.

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
  console.log('=== Build tight-budget retry ===\n')
  const { data: leg } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .limit(1)
  const commanderId = leg![0].id
  const commanderName = leg![0].name

  const { runAi, extractJson } = await import('../src/lib/ai/run')
  const { BUILD_SYSTEM, buildUserPrompt } = await import('../src/lib/ai/prompts')
  const { verifyBuildResponse } = await import('../src/lib/ai/grounding')
  const { bindBuilderTools } = await import('../src/lib/ai/tools')

  const builder = (bindBuilderTools as any)({
    format: 'commander',
    commanderOracleIds: [commanderId],
    includeCollection: false,
    currency: 'USD' as const,
  })
  const brief = 'Simple mono-blue Commander around this commander. Fill with basic Islands, mana rocks, counterspells, card draw, and creatures.'
  const t0 = Date.now()
  const r = await runAi({
    tier: 'reasoning',
    system: BUILD_SYSTEM,
    prompt: buildUserPrompt({ format: 'commander', brief, commanderName }),
    tools: builder.tools,
    maxSteps: 8,
    timeoutMs: 270_000,
  })
  const totalMs = Date.now() - t0
  console.log(`ok=${r.ok} errorKind=${r.errorKind}  in=${r.tokensIn}  out=${r.tokensOut}  latency=${r.latencyMs}ms  est=${(r.estimatedCostCents/100).toFixed(3)}USD`)
  if (!r.ok) {
    console.log(`raw error: ${String(r.text).slice(0, 200)}`)
    process.exit(0)
  }
  const json = extractJson(r.text)
  const verified = json ? await (verifyBuildResponse as any)(json, 'commander', builder.authorised) : null
  console.log(`grounding.ok=${verified?.ok}  grounding.error=${(verified as any)?.error ?? 'none'}`)
  if (!verified?.ok) {
    console.log(`extractJson returned: ${json ? 'object' : 'null'}`)
    console.log(`raw text head (500ch): ${String(r.text).slice(0, 500)}`)
    console.log(`raw text tail (500ch): ${String(r.text).slice(-500)}`)
  }
  if (verified?.ok) {
    console.log(`commanders=${verified.value.commanders.length}  main=${verified.value.main.length}  total_qty=${verified.value.main.reduce((n: number, m: any) => n + m.quantity, 0)}`)
    console.log(`summary: ${verified.value.summary.slice(0, 300)}`)
    console.log('first 5 main:')
    for (const m of verified.value.main.slice(0, 5)) {
      console.log(`  x${m.quantity}  ${m.oracle_card_id.slice(0, 8)}  ${(m.reason ?? '').slice(0, 90)}`)
    }
  }
  process.exit(0)
}
main().catch((err) => { console.error(err); process.exit(1) })
