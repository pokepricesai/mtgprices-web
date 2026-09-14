// Block 5A-W-58I — pin the LukePokePrices voice + archetype system.
//
// The generator lives in a Deno edge function
// (supabase/functions/content-studio-generate/index.ts), which vitest
// deliberately excludes. These tests do source-read regex assertions
// against that file to prove:
//
//   * The corporate PokePrices voice was replaced by the
//     LukePokePrices persona.
//   * The banned-phrase list is present and specific.
//   * Anti-AI / anti-marketing guardrails are in the prompt.
//   * All 9 templates were rewired to drop hardcoded CTA lines and
//     the "ends with the CTA question" schema instruction.
//   * The archetype system is defined and per-template pools exist.
//   * pickArchetype honours variant_index + avoid_archetype.
//   * Recent-post history is queried and passed to the model.
//   * Every generate*() persists archetype into data_payload.
//   * Factual-grounding rules remain strict.
//   * No auto-hashtag instruction ("3-5 hashtags at the end") remains.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDGE_FN = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'functions', 'content-studio-generate', 'index.ts'),
  'utf8',
)

// ── Voice persona + identity ──────────────────────────────────────

describe('Content Studio voice — LukePokePrices persona', () => {
  it('rebrands the account to @LukePokePrices, not the corporate PokePrices voice', () => {
    expect(EDGE_FN).toContain('@LukePokePrices')
    // The pre-58I opener framed the account as "PokePrices, a free
    // Pokemon TCG price intelligence site" — that must be gone.
    expect(EDGE_FN).not.toContain('You write social posts for PokePrices, a free Pokemon TCG price intelligence site.')
  })

  it('establishes the collector persona (not a marketing brand)', () => {
    expect(EDGE_FN).toContain('Luke, a UK-based Pokemon collector')
    expect(EDGE_FN).toContain('NOT a corporate brand voice')
  })

  it('carries the anti-corporate / anti-AI banned-phrase list', () => {
    // Spot-check specific phrases the block brief called out.
    for (const banned of [
      "Attention collectors",
      "Let's dive in",
      "Game-changer",
      "don't sleep on this",
      "next big card",
      "Only time will tell",
      "What are your thoughts",
      "Let us know in the comments",
      "In today's market",
      "making waves",
      "collectors need to know",
      "Making moves",
      "on the rise",
      "gaining traction",
    ]) {
      expect(EDGE_FN.includes(banned), `banned phrase missing from voice: ${banned}`).toBe(true)
    }
  })

  it('removes the "drive engagement with questions" rule so posts can end declaratively', () => {
    expect(EDGE_FN).not.toContain('Drive engagement with questions, not statements.')
  })

  it('keeps factual-grounding rules strict', () => {
    expect(EDGE_FN).toContain('Factual grounding')
    expect(EDGE_FN).toContain('Do not invent prices, percentages, populations, rarities, release dates')
  })

  it('bans auto-hashtag piles and default hashtag opinionation', () => {
    expect(EDGE_FN).toContain('do NOT auto-append #Pokemon #PokemonTCG')
  })
})

// ── Archetype system ──────────────────────────────────────────────

describe('Content Studio archetypes', () => {
  it('declares all ten archetypes from the block brief', () => {
    for (const a of [
      'straight_observation',
      'personal_reaction',
      'data_curiosity',
      'debate_opinion',
      'genuine_question',
      'nostalgia',
      'market_weirdness',
      'mini_story',
      'ultra_short',
      'builder_note',
    ]) {
      expect(EDGE_FN, `archetype ${a} missing`).toContain(a)
    }
  })

  it('declares per-template archetype pools for every implemented template', () => {
    // TEMPLATE_ARCHETYPES map lists which archetypes each template
    // may choose from. Every implemented template must appear as a
    // top-level key so pickArchetype has a defined pool.
    for (const t of [
      'card_battle',
      'market_mover',
      'grading_gap',
      'then_vs_now',
      'budget_builder',
      'collector_pulse',
      'most_traded',
      'pokemon_battle',
      'guess_the_pokemon',
    ]) {
      expect(EDGE_FN).toMatch(new RegExp(`${t}:\\s*\\[`))
    }
  })

  it('excludes builder_note from every card-driven template pool (reserved for a future build-update template)', () => {
    // Extract the TEMPLATE_ARCHETYPES map literal and assert no
    // per-template row contains 'builder_note'. Regression guard
    // against a future edit accidentally enrolling it.
    const map = EDGE_FN.match(/const TEMPLATE_ARCHETYPES[\s\S]*?\n\}/)
    expect(map, 'TEMPLATE_ARCHETYPES map not found').not.toBeNull()
    // The archetype IS defined but must not be in any template list.
    const rows = map![0].match(/^\s*\w+:\s*\[[^\]]+\]/gm) || []
    for (const row of rows) {
      expect(row, `builder_note leaked into: ${row}`).not.toContain('builder_note')
    }
  })

  it('pickArchetype honours avoid_archetype (regenerate) and variant_index (batch)', () => {
    expect(EDGE_FN).toContain('opts.avoid_archetype')
    expect(EDGE_FN).toContain('variant_index')
    expect(EDGE_FN).toMatch(/Math\.abs\(Math\.floor\(vi\)\)\s*%\s*src\.length/)
  })

  it('archetype MODE block is injected into every generate function\'s user prompt', () => {
    const modeInjections = (EDGE_FN.match(/\$\{archetypeSection\(archetype\)\}/g) || []).length
    // Nine templates today — every generate*() function should
    // interpolate the MODE section into its user prompt.
    expect(modeInjections, `expected 9 MODE injections, found ${modeInjections}`).toBeGreaterThanOrEqual(9)
  })

  it('every generate function persists archetype into data_payload', () => {
    // Regression guard: without this, regenerate cannot avoid the
    // previously-used archetype because the client has nothing to
    // pass back. Match ", archetype }" — the canonical trailing
    // property placement that every template uses. Tolerates
    // arbitrarily nested inner objects earlier in the payload
    // (grading_gap has biggest_gap: { top, bottom, ratio } before it).
    const payloadHits = (EDGE_FN.match(/,\s*archetype\s*(?:}|\})/g) || []).length
    expect(payloadHits, `expected >=9 ", archetype }" assignments, found ${payloadHits}`).toBeGreaterThanOrEqual(9)
  })
})

// ── Removed CTA prescriptions ─────────────────────────────────────

describe('Content Studio — hardcoded CTAs and Q-endings removed', () => {
  it('no per-template prompt tells the model to end with the CTA question', () => {
    // Pre-58I each template had a line like
    //   "twitter_copy": "..., ends with the CTA question"
    // which forced every post to close on a question. Regression
    // guard so a future edit cannot silently re-introduce that.
    expect(EDGE_FN).not.toContain('ends with the CTA question')
    expect(EDGE_FN).not.toContain('ending with the CTA question')
    expect(EDGE_FN).not.toContain('ending with the CTA')
    expect(EDGE_FN).not.toContain('ends with the CTA')
  })

  it('no template hardcodes the specific pre-58I CTA questions', () => {
    // These were the boilerplate CTAs the model appended verbatim.
    // Their return would signal the archetype system got bypassed.
    for (const cta of [
      'CTA: "Which are you taking?"',
      'CTA: "Still room to run?"',
      'CTA: "Buying the dip?"',
      'CTA: "Which grade would you buy?"',
      'CTA: "Would you have held?"',
      'CTA: "Pick your four."',
      'CTA: "What are collectors watching?"',
      'CTA: "Are collectors fighting over this one?"',
      'CTA: "Who wins?"',
      'CTA: "Who is it?"',
    ]) {
      expect(EDGE_FN, `hardcoded CTA still present: ${cta}`).not.toContain(cta)
    }
  })

  it('no template hardcodes "2 short paragraphs + 3-5 hashtags" for Instagram', () => {
    expect(EDGE_FN).not.toContain('2 short paragraphs + 3-5 hashtags')
  })
})

// ── Recent-post history ───────────────────────────────────────────

describe('Content Studio — recent-post repetition avoidance', () => {
  it('queries social_content_posts for the last N twitter_copy strings per template', () => {
    expect(EDGE_FN).toContain('getRecentTwitterHistory')
    expect(EDGE_FN).toContain("from('social_content_posts')")
    expect(EDGE_FN).toMatch(/\.select\(['"]twitter_copy['"]\)/)
    expect(EDGE_FN).toMatch(/\.order\(['"]created_at['"],\s*\{\s*ascending:\s*false\s*\}\)/)
  })

  it('injects the recent-post-avoidance block into every generate function\'s prompt', () => {
    const hits = (EDGE_FN.match(/\$\{recentPostsSection\(recent\)\}/g) || []).length
    expect(hits, `expected 9 recentPostsSection injections, found ${hits}`).toBeGreaterThanOrEqual(9)
  })

  it('instructs the model not to copy openings, structures or closings', () => {
    expect(EDGE_FN).toContain('do NOT copy their openings, structures or closings')
  })

  it('fails open on query errors (does not block generation)', () => {
    // getRecentTwitterHistory wraps the query in try/catch and
    // returns []. Regression guard.
    const helper = EDGE_FN.match(/async function getRecentTwitterHistory[\s\S]*?\n\}\n/)
    expect(helper).not.toBeNull()
    expect(helper![0]).toContain('try {')
    expect(helper![0]).toContain('catch { return [] }')
  })
})

// ── Client wiring ─────────────────────────────────────────────────

describe('ContentStudioClient — variety wiring', () => {
  const CLIENT = readFileSync(
    join(__dirname, '..', '..', 'app', 'admin', 'content-studio', 'ContentStudioClient.tsx'),
    'utf8',
  )

  it('weekly-pack generation passes variant_index (batch coordination)', () => {
    expect(CLIENT).toContain('perTemplateCounter')
    expect(CLIENT).toMatch(/variant_index:\s*idx/)
  })

  it('regenerate passes avoid_archetype pulled from the previous data_payload', () => {
    expect(CLIENT).toContain('avoid_archetype')
    expect(CLIENT).toMatch(/data_payload[\s\S]*?archetype/)
  })
})
