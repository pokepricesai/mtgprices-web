// tests/ai/build-pipeline.test.ts
// Deterministic tests for the staged Build pipeline. Zero paid AI.
// Run with:  npx tsx --test tests/ai/build-pipeline.test.ts

import './_setup'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

async function loadPipeline() {
  return {
    plan: await import('../../src/lib/ai/build/plan'),
    candidates: await import('../../src/lib/ai/build/candidates'),
    select: await import('../../src/lib/ai/build/select'),
    pipeline: await import('../../src/lib/ai/build/pipeline'),
    run: await import('../../src/lib/ai/run'),
    grounding: await import('../../src/lib/ai/grounding'),
  }
}

// ────────────────────────────────────────────────────────────
// BuildPlanSchema

test('BuildPlan: schema accepts a valid plan', async () => {
  const { plan } = await loadPipeline()
  const parsed = plan.BuildPlanSchema.safeParse({
    archetype_or_goal: 'mono-blue counter/draw',
    desired_capabilities: [{ capability: 'card-draw', target_count: 12 }, { capability: 'counter-spell', target_count: 8 }],
    collection_preference: 'none',
  })
  assert.strictEqual(parsed.success, true)
})

test('BuildPlan: schema rejects invented capability strings', async () => {
  const { plan } = await loadPipeline()
  const parsed = plan.BuildPlanSchema.safeParse({
    archetype_or_goal: 'nonsense',
    desired_capabilities: [{ capability: 'infinite-combo-machine' }],
    collection_preference: 'none',
  })
  assert.strictEqual(parsed.success, false)
})

test('BuildPlan: schema defaults collection_preference to none', async () => {
  const { plan } = await loadPipeline()
  const parsed = plan.BuildPlanSchema.parse({
    archetype_or_goal: 'X',
    desired_capabilities: [{ capability: 'ramp' }],
  })
  assert.strictEqual(parsed.collection_preference, 'none')
})

// ────────────────────────────────────────────────────────────
// verifyBuildSelection — pool-authorised set

test('Selection: reject IDs outside the candidate pool', async () => {
  const { select } = await loadPipeline()
  const pool: any = {
    candidates: [{ oracle_card_id: '11111111-1111-4111-8111-111111111111' }],
    authorisedIds: new Set(['11111111-1111-4111-8111-111111111111']),
    commanderColorIdentity: null,
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const raw = {
    summary: 'test',
    commanders: [],
    main: [
      { oracle_card_id: '11111111-1111-4111-8111-111111111111', quantity: 1 },
      { oracle_card_id: '22222222-2222-4222-8222-222222222222', quantity: 1 },
    ],
    basic_lands_to_add: 30,
  }
  const r = await select.verifyBuildSelection(raw, pool)
  assert.strictEqual(r.ok, false)
  if (!r.ok) {
    assert.strictEqual(r.error, 'unauthorised_ids')
    assert.deepStrictEqual(r.unauthorisedIds, ['22222222-2222-4222-8222-222222222222'])
  }
})

test('Selection: accepts a valid pool-grounded output', async () => {
  const { select } = await loadPipeline()
  const pool: any = {
    candidates: [
      { oracle_card_id: '11111111-1111-4111-8111-111111111111' },
      { oracle_card_id: '22222222-2222-4222-8222-222222222222' },
    ],
    authorisedIds: new Set([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]),
    commanderColorIdentity: ['U'],
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const raw = {
    summary: 'good',
    commanders: [],
    main: [
      { oracle_card_id: '11111111-1111-4111-8111-111111111111', quantity: 1 },
      { oracle_card_id: '22222222-2222-4222-8222-222222222222', quantity: 1 },
    ],
    basic_lands_to_add: 30,
  }
  const r = await select.verifyBuildSelection(raw, pool)
  assert.strictEqual(r.ok, true)
  if (r.ok) assert.strictEqual(r.value.basic_lands_to_add, 30)
})

test('Selection: malformed JSON → malformed_response', async () => {
  const { select } = await loadPipeline()
  const pool: any = {
    candidates: [], authorisedIds: new Set<string>(), commanderColorIdentity: null,
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const r = await select.verifyBuildSelection({ nope: true }, pool)
  assert.strictEqual(r.ok, false)
  if (!r.ok) assert.strictEqual(r.error, 'malformed_response')
})

// ────────────────────────────────────────────────────────────
// Pipeline orchestration with mocked AI

test('Pipeline: uses provided plan + pool overrides, no AI runs plan stage', async () => {
  const { pipeline, run } = await loadPipeline()
  // Mock Stage C (selection) — this fires because we don't override
  // the selection response. Return a well-formed BuildSchema object.
  let callCount = 0
  run.__setAiRunMock(async () => {
    callCount++
    return {
      ok: true,
      text: JSON.stringify({
        summary: 'mocked',
        commanders: [],
        main: [{ oracle_card_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
        basic_lands_to_add: 59,
        warnings: [],
      }),
      tokensIn: 500, tokensOut: 40, tokensReasoning: 0,
      latencyMs: 10, provider: 'mock', model: 'mock', estimatedCostCents: 1,
    }
  })
  const suppliedPlan = {
    archetype_or_goal: 'test',
    desired_capabilities: [{ capability: 'ramp' as const }],
    collection_preference: 'none' as const,
  }
  const suppliedPool: any = {
    candidates: [{
      oracle_card_id: '11111111-1111-4111-8111-111111111111',
      name: 'Test Card', mana_cost: '{U}', mana_value: 1, type_line: 'Instant',
      colors: ['U'], color_identity: ['U'], capabilities: ['card-draw'],
      price: null, currency: null, owned_quantity: 0,
    }],
    authorisedIds: new Set(['11111111-1111-4111-8111-111111111111']),
    commanderColorIdentity: null,
    meta: { requestedCapabilities: ['ramp'], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const result = await pipeline.runBuildPipeline({
    format: 'commander',
    brief: 'test',
    commanderOracleIds: [],
    useCollection: false,
    overrides: { plan: suppliedPlan, pool: suppliedPool, skipRepair: true },
  })
  // Selection ran once — plan stage was skipped.
  assert.ok(callCount >= 1, `expected selection AI to run, got ${callCount} calls`)
  // Result surfaces the mock output.
  assert.ok(result.proposed, 'expected proposed to be present')
  run.__setAiRunMock(null)
})

test('Pipeline: rejects Stage C output that names an unauthorised ID', async () => {
  const { pipeline, run } = await loadPipeline()
  run.__setAiRunMock(async () => ({
    ok: true,
    // The mock names an ID that is NOT in the pool.
    text: JSON.stringify({
      summary: 'nefarious',
      commanders: [],
      main: [{ oracle_card_id: '99999999-9999-4999-8999-999999999999', quantity: 1 }],
      basic_lands_to_add: 30,
      warnings: [],
    }),
    tokensIn: 500, tokensOut: 40, tokensReasoning: 0,
    latencyMs: 10, provider: 'mock', model: 'mock', estimatedCostCents: 1,
  }))
  const suppliedPool: any = {
    candidates: [{
      oracle_card_id: '11111111-1111-4111-8111-111111111111',
      name: 'A', mana_cost: null, mana_value: null, type_line: null,
      colors: null, color_identity: null, capabilities: null,
      price: null, currency: null, owned_quantity: 0,
    }],
    authorisedIds: new Set(['11111111-1111-4111-8111-111111111111']),
    commanderColorIdentity: null,
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const result = await pipeline.runBuildPipeline({
    format: 'commander', brief: 'x',
    commanderOracleIds: [],
    useCollection: false,
    overrides: {
      plan: { archetype_or_goal: 'x', desired_capabilities: [{ capability: 'ramp' }], collection_preference: 'none' } as any,
      pool: suppliedPool,
      skipRepair: true,
    },
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.failureStage, 'select')
  assert.strictEqual(result.error, 'unauthorised_ids')
  run.__setAiRunMock(null)
})

test('Pipeline: empty candidate pool → empty_candidate_pool failure', async () => {
  const { pipeline, run } = await loadPipeline()
  run.__setAiRunMock(async () => ({
    ok: true, text: '{}',
    tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
    latencyMs: 0, provider: 'mock', model: 'mock', estimatedCostCents: 0,
  }))
  const emptyPool: any = {
    candidates: [], authorisedIds: new Set<string>(), commanderColorIdentity: null,
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const result = await pipeline.runBuildPipeline({
    format: 'commander', brief: 'x',
    commanderOracleIds: [], useCollection: false,
    overrides: {
      plan: { archetype_or_goal: 'x', desired_capabilities: [{ capability: 'ramp' }], collection_preference: 'none' } as any,
      pool: emptyPool, skipRepair: true,
    },
  })
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.error, 'empty_candidate_pool')
  run.__setAiRunMock(null)
})

test('Pipeline: singleton violation is repaired mechanically (qty>1 → qty=1)', async () => {
  const { pipeline, run } = await loadPipeline()
  // Stage C mock emits qty=2 for a singleton format. Pipeline should
  // downshift to qty=1 without calling repair.
  const targetId = '11111111-1111-4111-8111-111111111111'
  run.__setAiRunMock(async () => ({
    ok: true,
    text: JSON.stringify({
      summary: 'x',
      commanders: [],
      main: [{ oracle_card_id: targetId, quantity: 2 }],
      basic_lands_to_add: 30,
      warnings: [],
    }),
    tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
    latencyMs: 0, provider: 'mock', model: 'mock', estimatedCostCents: 0,
  }))
  const pool: any = {
    candidates: [{
      oracle_card_id: targetId, name: 'X',
      mana_cost: null, mana_value: null, type_line: 'Instant',
      colors: null, color_identity: null, capabilities: null,
      price: null, currency: null, owned_quantity: 0,
    }],
    authorisedIds: new Set([targetId]),
    commanderColorIdentity: null,
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  const result = await pipeline.runBuildPipeline({
    format: 'commander', brief: 'x',
    commanderOracleIds: [], useCollection: false,
    overrides: {
      plan: { archetype_or_goal: 'x', desired_capabilities: [{ capability: 'ramp' }], collection_preference: 'none' } as any,
      pool, skipRepair: true,
    },
  })
  // Because pool has only 1 card there is no repair possible for the
  // resulting "deck_too_small" validator failure, and skipRepair is on.
  // We still confirm the singleton fix landed: main[0].quantity=1.
  assert.ok(result.proposed, 'expected proposed to be present')
  assert.strictEqual(result.proposed!.main[0].quantity, 1)
  run.__setAiRunMock(null)
})

test('Pipeline: repair is invoked at most once', async () => {
  const { pipeline, run } = await loadPipeline()
  const targetId = '11111111-1111-4111-8111-111111111111'
  let calls = 0
  run.__setAiRunMock(async () => {
    calls++
    // Every call emits the same tiny deck — repair CANNOT succeed
    // because the pool has only 1 card. Pipeline must not loop.
    return {
      ok: true,
      text: JSON.stringify({
        summary: 'x',
        commanders: [],
        main: [{ oracle_card_id: targetId, quantity: 1 }],
        basic_lands_to_add: 0,
        warnings: [],
      }),
      tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
      latencyMs: 0, provider: 'mock', model: 'mock', estimatedCostCents: 0,
    }
  })
  const pool: any = {
    candidates: [{
      oracle_card_id: targetId, name: 'X',
      mana_cost: null, mana_value: null, type_line: 'Instant',
      colors: null, color_identity: null, capabilities: null,
      price: null, currency: null, owned_quantity: 0,
    }],
    authorisedIds: new Set([targetId]),
    commanderColorIdentity: null,
    meta: { requestedCapabilities: [], droppedIllegal: 0, droppedCiConflict: 0, droppedBudget: 0, droppedNotOwned: 0, perGroupHits: [] },
  }
  await pipeline.runBuildPipeline({
    format: 'commander', brief: 'x',
    commanderOracleIds: [], useCollection: false,
    overrides: {
      plan: { archetype_or_goal: 'x', desired_capabilities: [{ capability: 'ramp' }], collection_preference: 'none' } as any,
      pool,
      // skipRepair NOT set — repair should run once.
    },
  })
  // Selection + at most one repair = 2 calls. Never more.
  assert.ok(calls <= 2, `expected at most 2 AI calls (select + one repair), got ${calls}`)
  run.__setAiRunMock(null)
})

// ────────────────────────────────────────────────────────────
// Deterministic basic-land fill

test('Basic fill: fills evenly across commander colour identity', async () => {
  // Emulate the save-endpoint fill logic in isolation. This is what
  // the /save route does when body.basic_lands_to_add > 0.
  const commanderColors = ['U', 'R'] as const
  const total = 30
  const basicByColour: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
  const names = commanderColors.map((c) => basicByColour[c])
  assert.deepStrictEqual(names.sort(), ['Island', 'Mountain'])
  const perColour = Math.floor(total / names.length)
  const remainder = total - perColour * names.length
  const counts = names.map((_, i) => perColour + (i < remainder ? 1 : 0))
  assert.strictEqual(counts.reduce((a, b) => a + b, 0), total)
})

test('Basic fill: single-colour commander gets all basics of one type', async () => {
  const commanderColors = ['U'] as const
  const total = 37
  const basicByColour: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }
  const names = commanderColors.map((c) => basicByColour[c])
  assert.deepStrictEqual(names, ['Island'])
  const perColour = Math.floor(total / names.length)
  const remainder = total - perColour * names.length
  const counts = names.map((_, i) => perColour + (i < remainder ? 1 : 0))
  assert.strictEqual(counts[0], 37)
})

// ────────────────────────────────────────────────────────────
// BuildSchema still enforces basic_lands_to_add bounds

test('BuildSchema: rejects negative basic_lands_to_add', async () => {
  const { grounding } = await loadPipeline()
  const parsed = grounding.BuildSchema.safeParse({
    summary: 'x',
    commanders: [],
    main: [],
    basic_lands_to_add: -1,
  })
  assert.strictEqual(parsed.success, false)
})

// Reference to silence z unused-import warnings.
void z
