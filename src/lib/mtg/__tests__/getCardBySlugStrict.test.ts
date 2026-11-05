// src/lib/mtg/__tests__/getCardBySlugStrict.test.ts
//
// Locks the invariant that is most important for /set/[setCode]/card/[cardSlug]
// under on-demand ISR: an INFRASTRUCTURE error must never be
// interpreted as "card does not exist". A legitimate miss (zero
// matching rows, or no row whose name slugifies back to the URL)
// still produces `null` (the caller then calls notFound()).

import { describe, it, expect, vi, beforeEach } from 'vitest'

type ListResult<T = any> = { data: T[] | null; error: { message: string } | null }
type SingleResult<T = any> = { data: T | null; error: { message: string } | null }

const {
  serviceClientMock,
  printingsMock,
  oracleMock,
  finishesMock,
  legalitiesMock,
  rulingsMock,
  otherPrintingsMock,
  otherPrintingsHydrateMock,
} = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  printingsMock: vi.fn<[], Promise<ListResult>>(),
  oracleMock: vi.fn<[], Promise<SingleResult>>(),
  finishesMock: vi.fn<[], Promise<ListResult>>(),
  legalitiesMock: vi.fn<[], Promise<ListResult>>(),
  rulingsMock: vi.fn<[], Promise<ListResult>>(),
  otherPrintingsMock: vi.fn<[], Promise<ListResult>>(),       // Stage A: narrow id-only scan with .neq
  otherPrintingsHydrateMock: vi.fn<[], Promise<ListResult>>(), // Stage B: PK hydrate .in('id', [...])
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

// Builder dispatches on table + per-builder flags.
// mtg_printings has three query shapes in getCardBySlugStrict:
//   1. Primary printing lookup: .in('collector_number', candidates) — no .neq, no .in('id', ...)
//        → printingsMock
//   2. Other-printings Stage A (CN-06.02): .neq('id', ...) + narrow select  → otherPrintingsMock
//   3. Other-printings Stage B (CN-06.02): .in('id', idList) + no .neq      → otherPrintingsHydrateMock
// Flags:
//   isNeq         — set when .neq() is called → Stage A
//   isInById      — set when .in('id', ...) is called → distinguishes Stage B from the primary
//                   (.in('collector_number', ...)) query
function makeBuilder(table: string) {
  let isSingle = false
  let isNeq = false
  let isInById = false
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: (col: string) => {
      if (col === 'id') isInById = true
      return builder
    },
    neq: () => { isNeq = true; return builder },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      isSingle = true
      return oracleMock()
    },
    then: (onFulfilled: any, onRejected: any) => {
      let terminal: Promise<any>
      if (isSingle) terminal = oracleMock()
      else if (table === 'mtg_printings') {
        if (isNeq) terminal = otherPrintingsMock()                  // Stage A
        else if (isInById) terminal = otherPrintingsHydrateMock()    // Stage B (CN-06.02)
        else terminal = printingsMock()                              // Primary
      }
      else if (table === 'mtg_oracle_cards') terminal = oracleMock()
      else if (table === 'mtg_printing_finishes') terminal = finishesMock()
      else if (table === 'mtg_oracle_legalities') terminal = legalitiesMock()
      else if (table === 'mtg_rulings') terminal = rulingsMock()
      else terminal = Promise.reject(new Error(`unexpected table: ${table}`))
      return terminal.then(onFulfilled, onRejected)
    },
  }
  return builder
}

beforeEach(() => {
  printingsMock.mockReset()
  oracleMock.mockReset()
  finishesMock.mockReset()
  legalitiesMock.mockReset()
  rulingsMock.mockReset()
  otherPrintingsMock.mockReset()
  otherPrintingsHydrateMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({ from: (t: string) => makeBuilder(t) })
})

async function loadStrict() {
  const mod = await import('../cards')
  return mod.getCardBySlugStrict
}

function printingRow(name: string, collector: string, oracleId = 'o1'): any {
  // The slug produced by slugifyCardName in src/lib/mtg/slug.ts is a
  // lowercased, hyphenated form of the card name. "Black Lotus" → "black-lotus".
  return {
    id: 'p1',
    oracle_card_id: oracleId,
    set_id: 's1',
    scryfall_id: 'sc1',
    set_code: 'lea',
    collector_number: collector,
    lang: 'en',
    name,
    layout: 'normal', rarity: 'rare', artist: 'test',
    image_uri: null, image_uri_small: null, art_crop_uri: null, released_at: '1993-08-05',
    borderless: false, full_art: false, promo: false, digital: false,
    scryfall_uri: null, reprint: false, textless: false, variation: false,
  }
}

const OK_ORACLE = {
  data: {
    id: 'o1', oracle_id: 'oid1', name: 'Black Lotus', mana_cost: '{0}', mana_value: 0,
    type_line: 'Artifact', oracle_text: 'Add three mana',
    power: null, toughness: null, loyalty: null, defense: null,
    colors: [], color_identity: [], keywords: [],
    layout: 'normal', card_faces: null, produced_mana: [],
    reserved: true, game_changer: false, capabilities: [],
  },
  error: null,
}

describe('getCardBySlugStrict', () => {
  it('returns a populated detail on the happy path', async () => {
    printingsMock.mockResolvedValueOnce({ data: [printingRow('Black Lotus', '232')], error: null })
    oracleMock.mockResolvedValueOnce(OK_ORACLE)
    finishesMock.mockResolvedValueOnce({ data: [{ id: 'f1', finish: 'nonfoil' }], error: null })
    legalitiesMock.mockResolvedValueOnce({ data: [{ format: 'vintage', legality: 'restricted' }], error: null })
    rulingsMock.mockResolvedValueOnce({ data: [], error: null })
    otherPrintingsMock.mockResolvedValueOnce({ data: [], error: null })

    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('lea', '232-black-lotus')
    expect(result).not.toBeNull()
    expect(result!.printing.name).toBe('Black Lotus')
    expect(result!.oracle.name).toBe('Black Lotus')
    expect(result!.legalities).toHaveLength(1)
  })

  it('returns null for a legitimate zero-rows printings query (NOT an error)', async () => {
    printingsMock.mockResolvedValueOnce({ data: [], error: null })
    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('lea', '999-nonexistent')
    expect(result).toBeNull()
    // Downstream stages must not fire for a legitimate miss.
    expect(oracleMock).not.toHaveBeenCalled()
  })

  it('returns null when printings succeed but no row slugifies back to the URL', async () => {
    // Row at collector 232 exists but its name does not match the URL slug.
    printingsMock.mockResolvedValueOnce({ data: [printingRow('Mystic Monastery', '232')], error: null })
    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('tdm', '232-narset-veil-witch')
    expect(result).toBeNull()
    expect(oracleMock).not.toHaveBeenCalled()
  })

  it('retries a transient printings failure and succeeds on retry — NOT a 404', async () => {
    printingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
      .mockResolvedValueOnce({ data: [printingRow('Black Lotus', '232')], error: null })
    oracleMock.mockResolvedValueOnce(OK_ORACLE)
    finishesMock.mockResolvedValueOnce({ data: [], error: null })
    legalitiesMock.mockResolvedValueOnce({ data: [], error: null })
    rulingsMock.mockResolvedValueOnce({ data: [], error: null })
    otherPrintingsMock.mockResolvedValueOnce({ data: [], error: null })

    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('lea', '232-black-lotus')
    expect(result).not.toBeNull()
    expect(result!.printing.name).toBe('Black Lotus')
    expect(printingsMock).toHaveBeenCalledTimes(2)
  })

  it('throws when the primary printings query persistently fails — infra error must NOT become 404', async () => {
    printingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })

    const getCardBySlugStrict = await loadStrict()
    await expect(getCardBySlugStrict('lea', '232-black-lotus')).rejects.toThrow(/stage=printings/)
    // Downstream stages must not fire if the primary query fails.
    expect(oracleMock).not.toHaveBeenCalled()
  })

  it('throws when a secondary stage (e.g. rulings) persistently fails — no silent partial detail', async () => {
    printingsMock.mockResolvedValueOnce({ data: [printingRow('Black Lotus', '232')], error: null })
    oracleMock.mockResolvedValueOnce(OK_ORACLE)
    finishesMock.mockResolvedValueOnce({ data: [{ id: 'f1', finish: 'nonfoil' }], error: null })
    legalitiesMock.mockResolvedValueOnce({ data: [], error: null })
    rulingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'ruling-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'ruling-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'ruling-fail-3' } })
    otherPrintingsMock.mockResolvedValueOnce({ data: [], error: null })

    const getCardBySlugStrict = await loadStrict()
    await expect(getCardBySlugStrict('lea', '232-black-lotus')).rejects.toThrow(/stage=rulings/)
  })

  it('returns null for malformed slug (decodeURIComponent throws) — not an infra error', async () => {
    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('lea', '%E0%A4%A')  // malformed percent-encoded
    expect(result).toBeNull()
    expect(printingsMock).not.toHaveBeenCalled()
  })

  it('CN-06.02 other-printings two-stage regression: Swamp with 40 siblings routes through Stage A → Stage B', async () => {
    // Pre-fix path: single wide ORDER-BY-LIMIT over 800+ matching
    // rows exceeded statement_timeout on basic-land oracles (e.g.
    // /set/j14/card/3★-swamp). Two-stage split: Stage A fetches the
    // 40 most-recent printing IDs with a narrow SELECT ('id' only);
    // Stage B hydrates full MTG_PRINTING_SELECT rows by PK.
    //
    // This test pins:
    //   * Both stages fire exactly once each (Stage A then Stage B).
    //   * All 40 printings arrive in the final result with full
    //     columns — no truncation, no row removal.
    //   * If Stage A returns empty IDs, Stage B is skipped (early
    //     return preserves the historical "empty is fine" path).

    // Primary printing: Swamp itself.
    printingsMock.mockResolvedValueOnce({ data: [printingRow('Swamp', '262')], error: null })
    oracleMock.mockResolvedValueOnce({
      data: { id: 'o1', oracle_id: 'o1', name: 'Swamp', mana_cost: null, type_line: 'Basic Land — Swamp', oracle_text: '', colors: [], color_identity: ['B'], keywords: [], layout: 'normal' },
      error: null,
    })
    finishesMock.mockResolvedValueOnce({ data: [{ id: 'f1', finish: 'nonfoil' }], error: null })
    legalitiesMock.mockResolvedValueOnce({ data: [], error: null })
    rulingsMock.mockResolvedValueOnce({ data: [], error: null })

    // Stage A: narrow scan returns 40 printing IDs.
    const stageAIds = Array.from({ length: 40 }, (_, i) => ({ id: `other-${i + 1}` }))
    otherPrintingsMock.mockResolvedValueOnce({ data: stageAIds, error: null })

    // Stage B: hydrate full rows for those 40 IDs.
    const stageBRows = Array.from({ length: 40 }, (_, i) => ({
      ...printingRow(`Swamp`, `${500 + i}`),
      id: `other-${i + 1}`,
      collector_number: `${500 + i}`,
    }))
    otherPrintingsHydrateMock.mockResolvedValueOnce({ data: stageBRows, error: null })

    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('lea', '262-swamp')

    expect(result).not.toBeNull()
    // Both stages fired exactly once each — the fix produces one scan
    // + one hydrate, not the original single wide query.
    expect(otherPrintingsMock).toHaveBeenCalledTimes(1)
    expect(otherPrintingsHydrateMock).toHaveBeenCalledTimes(1)
    // All 40 siblings surface in the result — no truncation, no
    // printings removed.
    expect(result!.otherPrintings).toHaveLength(40)
    expect(result!.otherPrintings.every((p: { id: string }) => p.id.startsWith('other-'))).toBe(true)
  })

  it('CN-06.02 other-printings two-stage: empty Stage A short-circuits Stage B', async () => {
    // A legitimate zero-siblings card (unique printing) produces an
    // empty IDs list from Stage A. Stage B MUST NOT fire with an
    // empty .in() — would be a wasted round-trip, and some dialects
    // treat .in([]) as a syntax error.
    printingsMock.mockResolvedValueOnce({ data: [printingRow('Black Lotus', '232')], error: null })
    oracleMock.mockResolvedValueOnce({
      data: { id: 'o1', oracle_id: 'o1', name: 'Black Lotus', mana_cost: '{0}', type_line: 'Artifact', oracle_text: '', colors: [], color_identity: [], keywords: [], layout: 'normal' },
      error: null,
    })
    finishesMock.mockResolvedValueOnce({ data: [{ id: 'f1', finish: 'nonfoil' }], error: null })
    legalitiesMock.mockResolvedValueOnce({ data: [], error: null })
    rulingsMock.mockResolvedValueOnce({ data: [], error: null })
    // Stage A: empty IDs.
    otherPrintingsMock.mockResolvedValueOnce({ data: [], error: null })
    // Stage B must NOT fire — not mocking it would throw if the
    // code path incorrectly called `.in('id', [])`.

    const getCardBySlugStrict = await loadStrict()
    const result = await getCardBySlugStrict('lea', '232-black-lotus')

    expect(result).not.toBeNull()
    expect(otherPrintingsMock).toHaveBeenCalledTimes(1)
    expect(otherPrintingsHydrateMock).not.toHaveBeenCalled()
    expect(result!.otherPrintings).toHaveLength(0)
  })

  it('CN-06.02 other-printings two-stage: Stage B failure escalates via strict retry', async () => {
    // Stage A succeeds but Stage B persistently fails. The strict
    // retry wrapper must throw with a stage-labelled error so the
    // page surfaces as an honest 5xx rather than caching a partial
    // 200 missing the sibling-printings panel.
    printingsMock.mockResolvedValueOnce({ data: [printingRow('Swamp', '262')], error: null })
    oracleMock.mockResolvedValueOnce({
      data: { id: 'o1', oracle_id: 'o1', name: 'Swamp', mana_cost: null, type_line: 'Basic Land — Swamp', oracle_text: '', colors: [], color_identity: ['B'], keywords: [], layout: 'normal' },
      error: null,
    })
    finishesMock.mockResolvedValueOnce({ data: [{ id: 'f1', finish: 'nonfoil' }], error: null })
    legalitiesMock.mockResolvedValueOnce({ data: [], error: null })
    rulingsMock.mockResolvedValueOnce({ data: [], error: null })
    otherPrintingsMock.mockResolvedValueOnce({ data: [{ id: 'other-1' }], error: null })
    otherPrintingsHydrateMock
      .mockResolvedValueOnce({ data: null, error: { message: 'hydrate-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'hydrate-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'hydrate-fail-3' } })

    const getCardBySlugStrict = await loadStrict()
    await expect(getCardBySlugStrict('lea', '262-swamp')).rejects.toThrow(/stage=other-printings/)
  })
})
