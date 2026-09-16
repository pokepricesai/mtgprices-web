// scripts/phase3c-plan-only.ts
// Run Stage A only + print the plan the model produced.

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

async function main() {
  const { runBuildPlan } = await import('../src/lib/ai/build/plan')
  const { getFormatRule } = await import('../src/lib/mtg/format-rules')

  const rule = getFormatRule('modern')!
  const r = await runBuildPlan({
    format: 'modern' as any,
    formatRule: rule,
    brief: 'A 60-card blue-red control deck. Emphasise cheap counterspells, card draw and a few finishers.',
    commanderName: null,
    commanderColorIdentity: null,
    budgetMax: null,
    budgetCurrency: null,
    collectionPreference: 'none',
  })
  console.log(`ok=${r.ok} in=${r.tokensIn} out=${r.tokensOut} ${r.latencyMs}ms $${(r.estimatedCostCents/100).toFixed(3)}`)
  console.log(JSON.stringify(r.value, null, 2))
  process.exit(0)
}
main().catch((err) => { console.error(err); process.exit(1) })
