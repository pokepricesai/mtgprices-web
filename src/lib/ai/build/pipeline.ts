// src/lib/ai/build/pipeline.ts
//
// Staged Build pipeline orchestrator.
//   Stage A: BuildPlan (Sonnet, no tools, no card IDs)
//   Stage B: deterministic candidate retrieval (no model)
//   Stage C: structured selection (Sonnet, no tools, pool in prompt)
//   Stage D: deterministic completion + one bounded AI repair pass
//
// Cost/latency for every stage is captured so the /api/decks/new-ai
// route can log a per-stage breakdown.

import 'server-only'
import { runAiObject } from '@/lib/ai/run'
import { runBuildPlan, type BuildPlan } from './plan'
import { retrieveCandidatePool, type CandidatePool } from './candidates'
import { runBuildSelect, verifyBuildSelection } from './select'
import { BuildSchema } from '@/lib/ai/grounding'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getFormatRule, isBasicLand } from '@/lib/mtg/format-rules'
import { validateDeck, type DeckCardForValidation, type ValidationIssue } from '@/lib/mtg/deck-rules'
import type { FormatKey } from '@/lib/mtg/formats.data'

export type BuildPipelineInput = {
  format: FormatKey
  brief: string
  commanderOracleIds: string[]
  useCollection: boolean
  budgetMax?: number
  budgetCurrency?: 'USD' | 'EUR'
  /** Test seams — allow the mocked test suite to inject deterministic
   *  responses. Never set from production code. */
  overrides?: {
    plan?: BuildPlan | null
    pool?: CandidatePool | null
    skipRepair?: boolean
  }
}

export type StageUsage = {
  ok: boolean
  errorKind?: string | null
  tokensIn: number
  tokensOut: number
  tokensReasoning: number
  latencyMs: number
  estimatedCostCents: number
}

export type BuildPipelineOutput = {
  ok: boolean
  /** Present on success. */
  proposed?: {
    format: FormatKey
    summary: string
    commanders: Array<{ oracle_card_id: string; card: any }>
    main: Array<{ oracle_card_id: string; quantity: number; reason?: string | null; card: any }>
    basic_lands_to_add: number
    warnings: string[]
  }
  validation?: ReturnType<typeof validateDeck>
  /** Present on failure. */
  error?: string
  /** Where in the pipeline it broke. */
  failureStage?: 'plan' | 'candidates' | 'select' | 'validate' | 'repair'
  usage: {
    plan?: StageUsage
    select?: StageUsage
    repair?: StageUsage
    total: {
      tokensIn: number
      tokensOut: number
      tokensReasoning: number
      estimatedCostCents: number
      latencyMs: number
    }
  }
  pool?: {
    candidatePoolSize: number
    commanderColorIdentity: string[] | null
    droppedIllegal: number
    droppedCiConflict: number
    droppedBudget: number
    droppedNotOwned: number
  }
  repairApplied?: boolean
}

/** Approximate target for how many non-basic cards Stage C should emit,
 *  and how many basic lands the app fills to reach deck size. Basic
 *  land counts are commander-heuristic; adjusted at repair time. */
function planDeckShape(format: FormatKey): { targetMain: number; targetBasics: number } {
  const rule = getFormatRule(format)
  if (!rule) return { targetMain: 45, targetBasics: 0 }
  // Singleton 99/100-card formats: ~45 unique non-basics + ~54 basics.
  // 60-card constructed: ~25 unique non-basics (typically 4x staples
  // fill to ~35-40 cards) + ~22-25 lands. Smaller `main[]` keeps
  // Stage C output token count sane.
  if (rule.minDeckSize >= 99) return { targetMain: 45, targetBasics: rule.minDeckSize - 45 }
  return { targetMain: 25, targetBasics: rule.minDeckSize - 40 }
}

export async function runBuildPipeline(input: BuildPipelineInput): Promise<BuildPipelineOutput> {
  const t0 = Date.now()
  const s = getSupabaseServiceClient()
  const rule = getFormatRule(input.format)
  if (!rule) return {
    ok: false, error: 'unsupported_format', failureStage: 'plan',
    usage: { total: { tokensIn: 0, tokensOut: 0, tokensReasoning: 0, estimatedCostCents: 0, latencyMs: 0 } },
  }

  // Commander lookup for the plan + logs.
  let commanderName: string | null = null
  let commanderCI: string[] | null = null
  if (input.commanderOracleIds.length > 0) {
    const { data } = await s.from('mtg_oracle_cards').select('name, color_identity').in('id', input.commanderOracleIds)
    const rows = (data ?? []) as any[]
    commanderName = rows.map((r) => r.name).join(' & ')
    commanderCI = Array.from(new Set(rows.flatMap((r) => r.color_identity ?? []))).sort()
  }

  // ── Stage A: BuildPlan ─────────────────────────────────────────
  let plan: BuildPlan | null = input.overrides?.plan ?? null
  let planUsage: StageUsage | undefined
  if (!plan) {
    const planResult = await runBuildPlan({
      format: input.format,
      formatRule: rule,
      brief: input.brief,
      commanderName,
      commanderColorIdentity: commanderCI,
      budgetMax: input.budgetMax ?? null,
      budgetCurrency: input.budgetCurrency ?? null,
      collectionPreference: input.useCollection ? 'prefer_owned' : 'none',
    })
    planUsage = {
      ok: planResult.ok, errorKind: (planResult as any).errorKind ?? null,
      tokensIn: planResult.tokensIn, tokensOut: planResult.tokensOut, tokensReasoning: planResult.tokensReasoning,
      latencyMs: planResult.latencyMs, estimatedCostCents: planResult.estimatedCostCents,
    }
    if (!planResult.ok || !planResult.value) {
      return {
        ok: false, error: (planResult as any).errorKind ?? 'plan_failed', failureStage: 'plan',
        usage: { plan: planUsage, total: {
          tokensIn: planUsage.tokensIn, tokensOut: planUsage.tokensOut, tokensReasoning: planUsage.tokensReasoning,
          estimatedCostCents: planUsage.estimatedCostCents, latencyMs: Date.now() - t0,
        } },
      }
    }
    plan = planResult.value
  }

  // Enforce plan self-consistency with the request:
  //  - budget flows through even if the model omitted it
  //  - collection preference forced when useCollection=true and the
  //    request wanted owned_only
  if (input.budgetMax != null && input.budgetCurrency) {
    plan.budget_strategy = {
      ...(plan.budget_strategy ?? {}),
      total_budget: input.budgetMax,
      currency: input.budgetCurrency,
    }
  }
  if (input.useCollection && plan.collection_preference === 'none') {
    plan.collection_preference = 'prefer_owned'
  }

  // ── Stage B: candidate pool ────────────────────────────────────
  const pool = input.overrides?.pool ?? await retrieveCandidatePool({
    plan,
    format: input.format,
    commanderOracleIds: input.commanderOracleIds,
    useCollection: input.useCollection,
  })

  if (pool.candidates.length === 0) {
    return {
      ok: false, error: 'empty_candidate_pool', failureStage: 'candidates',
      usage: { plan: planUsage, total: {
        tokensIn: planUsage?.tokensIn ?? 0, tokensOut: planUsage?.tokensOut ?? 0, tokensReasoning: planUsage?.tokensReasoning ?? 0,
        estimatedCostCents: planUsage?.estimatedCostCents ?? 0, latencyMs: Date.now() - t0,
      } },
      pool: {
        candidatePoolSize: 0, commanderColorIdentity: pool.commanderColorIdentity,
        droppedIllegal: pool.meta.droppedIllegal, droppedCiConflict: pool.meta.droppedCiConflict,
        droppedBudget: pool.meta.droppedBudget, droppedNotOwned: pool.meta.droppedNotOwned,
      },
    }
  }

  // ── Stage C: selection ─────────────────────────────────────────
  const { targetMain, targetBasics } = planDeckShape(input.format)
  const selectResult = await runBuildSelect({
    plan,
    pool,
    format: input.format,
    formatRule: rule,
    commanderName,
    commanderOracleIds: input.commanderOracleIds,
    targetMainCount: targetMain,
    targetBasicCount: targetBasics,
  })
  const selectUsage: StageUsage = {
    ok: selectResult.ok, errorKind: (selectResult as any).errorKind ?? null,
    tokensIn: selectResult.tokensIn, tokensOut: selectResult.tokensOut, tokensReasoning: selectResult.tokensReasoning,
    latencyMs: selectResult.latencyMs, estimatedCostCents: selectResult.estimatedCostCents,
  }
  if (!selectResult.ok || !selectResult.value) {
    return {
      ok: false, error: (selectResult as any).errorKind ?? 'select_failed', failureStage: 'select',
      usage: aggregateUsage(planUsage, selectUsage, undefined, t0),
      pool: {
        candidatePoolSize: pool.candidates.length, commanderColorIdentity: pool.commanderColorIdentity,
        droppedIllegal: pool.meta.droppedIllegal, droppedCiConflict: pool.meta.droppedCiConflict,
        droppedBudget: pool.meta.droppedBudget, droppedNotOwned: pool.meta.droppedNotOwned,
      },
    }
  }

  const verified = await verifyBuildSelection(selectResult.value, pool)
  if (verified.ok !== true) {
    return {
      ok: false, error: (verified as any).error ?? 'unauthorised', failureStage: 'select',
      usage: aggregateUsage(planUsage, selectUsage, undefined, t0),
      pool: {
        candidatePoolSize: pool.candidates.length, commanderColorIdentity: pool.commanderColorIdentity,
        droppedIllegal: pool.meta.droppedIllegal, droppedCiConflict: pool.meta.droppedCiConflict,
        droppedBudget: pool.meta.droppedBudget, droppedNotOwned: pool.meta.droppedNotOwned,
      },
    }
  }

  // ── Stage D: validation + optional single repair pass ──────────
  const oracleById = await hydrateOracles([
    ...verified.value.commanders,
    ...verified.value.main.map((m) => m.oracle_card_id),
  ])

  // Enforce singleton: dedupe quantity>1 for singleton formats before
  // running the validator. Model may occasionally emit qty=2 on a
  // Commander card by mistake — repair mechanically.
  if (rule.singleton) {
    for (const m of verified.value.main) {
      const o = oracleById.get(m.oracle_card_id)
      // Basic lands (auto-filled by the save endpoint) shouldn't appear
      // in main[]. When they do, or when the card isn't hydrated,
      // enforce qty=1 — singleton is the format contract.
      if (!o || !isBasicLand(o.type_line)) m.quantity = 1
    }
  }

  let build = verified.value
  let validation = validateSelection(build, oracleById, input.format, targetBasics)

  let repairUsage: StageUsage | undefined
  let repairApplied = false

  if (!validation.ok && !input.overrides?.skipRepair) {
    const repaired = await attemptRepair({
      build, pool, plan, oracleById,
      format: input.format, targetBasics,
      validation,
    })
    if (repaired) {
      repairUsage = repaired.usage
      if (repaired.ok && repaired.value) {
        build = repaired.value
        // Refresh oracle hydration for new adds.
        const newIds = build.main.map((m) => m.oracle_card_id).filter((id) => !oracleById.has(id))
        if (newIds.length > 0) {
          const extra = await hydrateOracles(newIds)
          extra.forEach((v, k) => oracleById.set(k, v))
        }
        // Re-enforce singleton on repaired output too.
        if (rule.singleton) {
          for (const m of build.main) {
            const o = oracleById.get(m.oracle_card_id)
            if (o && !isBasicLand(o.type_line)) m.quantity = 1
          }
        }
        validation = validateSelection(build, oracleById, input.format, targetBasics)
        repairApplied = true
      }
    }
  }

  // Attach printings for the UI hydrate.
  const allIds = Array.from(new Set([...build.commanders, ...build.main.map((m) => m.oracle_card_id)]))
  const printingBy = await hydratePrintings(allIds)

  return {
    ok: validation.ok,
    error: validation.ok ? undefined : 'validation_failed',
    failureStage: validation.ok ? undefined : 'validate',
    proposed: {
      format: input.format,
      summary: build.summary,
      commanders: build.commanders.map((id) => ({ oracle_card_id: id, card: hydrate(id, oracleById, printingBy) })),
      main: build.main.map((m) => ({ ...m, card: hydrate(m.oracle_card_id, oracleById, printingBy) })),
      basic_lands_to_add: build.basic_lands_to_add,
      warnings: build.warnings,
    },
    validation,
    usage: aggregateUsage(planUsage, selectUsage, repairUsage, t0),
    pool: {
      candidatePoolSize: pool.candidates.length,
      commanderColorIdentity: pool.commanderColorIdentity,
      droppedIllegal: pool.meta.droppedIllegal,
      droppedCiConflict: pool.meta.droppedCiConflict,
      droppedBudget: pool.meta.droppedBudget,
      droppedNotOwned: pool.meta.droppedNotOwned,
    },
    repairApplied,
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function aggregateUsage(
  plan: StageUsage | undefined,
  select: StageUsage | undefined,
  repair: StageUsage | undefined,
  t0: number,
) {
  const add = (u?: StageUsage) => u ? {
    tokensIn: u.tokensIn, tokensOut: u.tokensOut, tokensReasoning: u.tokensReasoning, cost: u.estimatedCostCents,
  } : { tokensIn: 0, tokensOut: 0, tokensReasoning: 0, cost: 0 }
  const p = add(plan), c = add(select), r = add(repair)
  return {
    plan, select, repair,
    total: {
      tokensIn: p.tokensIn + c.tokensIn + r.tokensIn,
      tokensOut: p.tokensOut + c.tokensOut + r.tokensOut,
      tokensReasoning: p.tokensReasoning + c.tokensReasoning + r.tokensReasoning,
      estimatedCostCents: p.cost + c.cost + r.cost,
      latencyMs: Date.now() - t0,
    },
  }
}

async function hydrateOracles(oracleIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()
  const ids = Array.from(new Set(oracleIds))
  const IN_CHUNK = 100
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_oracle_cards')
      .select('id, name, mana_cost, mana_value, type_line, color_identity, keywords, oracle_text, capabilities')
      .in('id', chunk)
    for (const r of (data ?? []) as any[]) out.set(r.id, r)
  }
  return out
}

async function hydratePrintings(oracleIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()
  const IN_CHUNK = 60
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings')
      .select('oracle_card_id, image_uri_small, set_code, collector_number, released_at')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    for (const p of (data ?? []) as any[]) {
      if (!out.has(p.oracle_card_id)) out.set(p.oracle_card_id, p)
    }
  }
  return out
}

function hydrate(oracleId: string, oracleById: Map<string, any>, printingBy: Map<string, any>) {
  const o = oracleById.get(oracleId)
  if (!o) return null
  return { ...o, printing: printingBy.get(oracleId) ?? null }
}

/** Deterministic validator over the projected deck. Adds phantom
 *  basic-land rows to reach the target deck size, so the format's
 *  minDeckSize check does not fire on a partial (non-basic-only)
 *  list. */
function validateSelection(
  build: { commanders: string[]; main: Array<{ oracle_card_id: string; quantity: number }>; basic_lands_to_add: number },
  oracleById: Map<string, any>,
  format: FormatKey,
  targetBasics: number,
) {
  const cards: DeckCardForValidation[] = []
  for (const id of build.commanders) {
    const o = oracleById.get(id) ?? {}
    cards.push({
      oracle_card_id: id, name: o.name ?? '(unknown)', quantity: 1, zone: 'commander',
      type_line: o.type_line ?? null, color_identity: o.color_identity ?? null,
      keywords: o.keywords ?? null, oracle_text: o.oracle_text ?? null, legality: 'legal',
    })
  }
  for (const m of build.main) {
    const o = oracleById.get(m.oracle_card_id) ?? {}
    cards.push({
      oracle_card_id: m.oracle_card_id, name: o.name ?? '(unknown)', quantity: m.quantity, zone: 'main',
      type_line: o.type_line ?? null, color_identity: o.color_identity ?? null,
      keywords: o.keywords ?? null, oracle_text: o.oracle_text ?? null, legality: 'legal',
    })
  }
  // Phantom basics — quantity from build.basic_lands_to_add or the
  // target when the model omitted the field. Uses a fake oracle_id so
  // the singleton rule (which is per-oracle) does not fire.
  const basicCount = Math.max(build.basic_lands_to_add ?? 0, targetBasics > 0 ? targetBasics : 0)
  if (basicCount > 0) {
    cards.push({
      oracle_card_id: '00000000-0000-0000-0000-00000000ba51' as any,
      name: 'Basic Land (phantom)', quantity: basicCount, zone: 'main',
      type_line: 'Basic Land — Island', color_identity: null,
      keywords: null, oracle_text: null, legality: 'legal',
    })
  }
  return validateDeck({ format, cards })
}

// ── Repair pass ────────────────────────────────────────────────────

type RepairInput = {
  build: {
    summary: string; commanders: string[]
    main: Array<{ oracle_card_id: string; quantity: number; reason?: string | null }>
    basic_lands_to_add: number; warnings: string[]
  }
  pool: CandidatePool
  plan: BuildPlan
  oracleById: Map<string, any>
  format: FormatKey
  targetBasics: number
  validation: ReturnType<typeof validateDeck>
}

/** One bounded AI repair pass. Repair prompt tells Sonnet:
 *   - here is the current invalid draft (compact)
 *   - here are the SPECIFIC validator issues
 *   - here is the remaining candidate pool (compact)
 *   - emit ONLY the diff needed to fix the issues
 *
 *  Repair uses the same BuildSchema so any oracle_card_ids introduced
 *  are re-checked against the pool. */
async function attemptRepair(input: RepairInput): Promise<
  | { ok: true; value: RepairInput['build']; usage: StageUsage }
  | { ok: false; usage: StageUsage }
  | null
> {
  // Only attempt repair for problem classes the model can actually
  // fix by swapping cards. E.g. "deck too small" it might be able to
  // help with; "singleton violation" we already resolved deterministically.
  const fixable = input.validation.issues.filter(isRepairable)
  if (fixable.length === 0) return null

  const rule = getFormatRule(input.format)!
  const parts: string[] = []
  parts.push('Repair the invalid draft. Emit the FULL BuildSchema — you may reuse commanders + most of "main" verbatim, only change the minimum needed to fix these issues:')
  for (const i of fixable) parts.push(`  - ${i.message}`)
  parts.push('')
  parts.push(`Format: ${rule.label}. Singleton: ${rule.singleton}. Deck size target: ${rule.minDeckSize} + commander.`)
  parts.push(`Current draft (${input.build.main.length} non-basics, ${input.build.basic_lands_to_add} basics-to-add):`)
  parts.push(`  commanders: ${JSON.stringify(input.build.commanders)}`)
  parts.push(`  main:`)
  for (const m of input.build.main) {
    const o = input.oracleById.get(m.oracle_card_id) ?? {}
    parts.push(`    ${m.oracle_card_id} | x${m.quantity} | ${o.name ?? '?'}`)
  }
  parts.push('')
  parts.push('Available additional candidates (append or swap in from here — every ID must appear below or already be in the draft):')
  const usedIds = new Set([...input.build.commanders, ...input.build.main.map((m) => m.oracle_card_id)])
  const available = input.pool.candidates.filter((c) => !usedIds.has(c.oracle_card_id)).slice(0, 120)
  for (const c of available) parts.push(`  ${c.oracle_card_id} | ${c.name} | ${c.type_line ?? ''} | ${(c.capabilities ?? []).join('/')}`)

  const result = await runAiObject({
    tier: 'reasoning',
    system: 'You repair invalid deck drafts by emitting minimal changes. Every oracle_card_id in your output must appear in the pool or already in the draft. No prose outside JSON.',
    prompt: parts.join('\n'),
    schema: BuildSchema,
    maxSteps: 1,
    timeoutMs: 60_000,
  })

  const usage: StageUsage = {
    ok: result.ok, errorKind: (result as any).errorKind ?? null,
    tokensIn: result.tokensIn, tokensOut: result.tokensOut, tokensReasoning: result.tokensReasoning,
    latencyMs: result.latencyMs, estimatedCostCents: result.estimatedCostCents,
  }
  if (!result.ok || !result.value) return { ok: false, usage }

  const verified = await verifyBuildSelection(result.value, input.pool)
  if (!verified.ok) return { ok: false, usage }
  return { ok: true, value: verified.value, usage }
}

function isRepairable(i: ValidationIssue): boolean {
  // Repair only helps when the model can *swap or add* to fix the
  // issue. Everything else (too many copies, off-CI, banned) is
  // impossible to hit here because the pool already filters those.
  return i.kind === 'deck_too_small'
    || i.kind === 'missing_commander'
    || i.kind === 'commander_not_legendary'
}
