// scripts/phase3c-build-only.ts
// Targeted retry of the Build path after fixing the .in() chunking
// bug in finder.ts. Improve/Analyse/Replace already proven working;
// this only re-tests Build (no ownedOnly) + Build (owned_only).

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
  console.log('=== Phase 3C Build path retry (post finder.ts .in() chunk fix) ===\n')

  // Pick a real legendary blue creature commander.
  const { data: leg } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .limit(1)
  const commanderId = leg![0].id
  const commanderName = leg![0].name

  // Give the fixture user a small collection so build_owned has something.
  const email = `mtg-3c-build-${Date.now()}@example.com`
  const { data: userData } = await s.auth.admin.createUser({ email, password: 'DontUse1234!', email_confirm: true })
  const userId = userData.user!.id

  const { data: someCards } = await s.from('mtg_oracle_cards')
    .select('id').overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .not('type_line', 'ilike', '%land%').limit(12)
  const { data: printings } = await s.from('mtg_printings')
    .select('id, oracle_card_id').in('oracle_card_id', (someCards ?? []).map((c: any) => c.id))
    .eq('lang', 'en').eq('digital', false)
  const { data: fins } = await s.from('mtg_printing_finishes')
    .select('id, printing_id, finish').in('printing_id', (printings ?? []).map((p: any) => p.id)).eq('finish', 'nonfoil')
  const collectionInserts = (fins ?? []).slice(0, 10).map((f: any) => ({
    user_id: userId, printing_finish_id: f.id, condition: 'near_mint', quantity: 1,
  }))
  if (collectionInserts.length > 0) await s.from('mtg_collection_items').insert(collectionInserts)
  console.log(`Seeded collection: ${collectionInserts.length} rows, commander="${commanderName}"\n`)

  const { runAi, extractJson } = await import('../src/lib/ai/run')
  const { BUILD_SYSTEM, buildUserPrompt } = await import('../src/lib/ai/prompts')
  const { verifyBuildResponse } = await import('../src/lib/ai/grounding')
  const { bindBuilderTools } = await import('../src/lib/ai/tools')

  function report(label: string, r: any, extras: Record<string, any> = {}) {
    const line = {
      label,
      ok: r.ok, model: r.model,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, tokens_reasoning: r.tokensReasoning,
      latency_ms: r.latencyMs, est_cost_cents: r.estimatedCostCents,
      error_kind: r.errorKind,
      ...extras,
    }
    console.log(JSON.stringify(line, null, 2))
  }

  // ── 1. Build Deck (small brief) ──────────────────────────
  console.log('--- Build Deck (small brief) [after finder fix] ---')
  {
    const builder = (bindBuilderTools as any)({
      format: 'commander',
      commanderOracleIds: [commanderId],
      includeCollection: false,
      currency: 'USD' as const,
    })
    const brief = 'Casual mono-blue Commander. Include Islands, mana rocks (Sol Ring, Arcane Signet), basic card draw (Rhystic Study), a few counterspells, and 30+ creatures. Keep budget reasonable.'
    const r = await runAi({
      tier: 'reasoning',
      system: BUILD_SYSTEM,
      prompt: buildUserPrompt({
        format: 'commander', brief, commanderName,
        budgetCurrency: 'USD', budgetMax: 100,
      }),
      tools: builder.tools,
      maxSteps: 25,
      timeoutMs: 170_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyBuildResponse as any)(json, 'commander', builder.authorised) : null
    report('build_small', r, {
      grounding_ok: verified?.ok ?? false,
      grounding_error: verified?.ok ? null : (verified as any)?.error,
      commanders: verified?.ok ? verified.value.commanders.length : null,
      main_returned: verified?.ok ? verified.value.main.length : null,
      distinct_cards: verified?.ok ? new Set(verified.value.main.map((m: any) => m.oracle_card_id)).size : null,
      total_qty: verified?.ok ? verified.value.main.reduce((n: number, m: any) => n + m.quantity, 0) : null,
      summary_preview: verified?.ok ? verified.value.summary.slice(0, 200) : null,
      sample_main: verified?.ok ? verified.value.main.slice(0, 5).map((m: any) => ({
        oid: m.oracle_card_id.slice(0, 8), qty: m.quantity, reason: (m.reason ?? '').slice(0, 100),
      })) : null,
      raw_preview: r.ok ? String(r.text).slice(0, 200) : null,
    })
  }

  // ── 2. Build from collection (owned_only) ────────────────
  console.log('\n--- Build Deck (owned_only) [after tool fix] ---')
  {
    const builder = (bindBuilderTools as any)({
      format: 'commander',
      commanderOracleIds: [commanderId],
      includeCollection: true,
      currency: 'USD' as const,
    })
    const brief = 'Build a mono-U Commander deck using the cards the owner already has. Do not propose any missing cards.'
    const r = await runAi({
      tier: 'reasoning',
      system: BUILD_SYSTEM,
      prompt: buildUserPrompt({
        format: 'commander', brief, commanderName, ownedOnly: true,
      }),
      tools: builder.tools,
      maxSteps: 20,
      timeoutMs: 160_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyBuildResponse as any)(json, 'commander', builder.authorised) : null
    report('build_owned', r, {
      grounding_ok: verified?.ok ?? false,
      grounding_error: verified?.ok ? null : (verified as any)?.error,
      commanders: verified?.ok ? verified.value.commanders.length : null,
      main_returned: verified?.ok ? verified.value.main.length : null,
      total_qty: verified?.ok ? verified.value.main.reduce((n: number, m: any) => n + m.quantity, 0) : null,
      summary_preview: verified?.ok ? verified.value.summary.slice(0, 220) : null,
    })
  }

  // Cleanup.
  await s.from('mtg_collection_items').delete().eq('user_id', userId)
  await s.auth.admin.deleteUser(userId)
  console.log('\n(cleaned up user + collection)')
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
