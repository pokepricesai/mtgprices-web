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

const { serviceClientMock, printingsMock, oracleMock, finishesMock, legalitiesMock, rulingsMock, otherPrintingsMock } = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  printingsMock: vi.fn<[], Promise<ListResult>>(),
  oracleMock: vi.fn<[], Promise<SingleResult>>(),
  finishesMock: vi.fn<[], Promise<ListResult>>(),
  legalitiesMock: vi.fn<[], Promise<ListResult>>(),
  rulingsMock: vi.fn<[], Promise<ListResult>>(),
  otherPrintingsMock: vi.fn<[], Promise<ListResult>>(),
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

// Builder dispatches on table + per-builder flags.
// The primary printings query uses `.in('collector_number', …)`;
// the "other printings" query uses `.neq('id', …)`. Flag `isNeq`
// distinguishes them so retries route to the right mock regardless
// of call order.
function makeBuilder(table: string) {
  let isSingle = false
  let isNeq = false
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
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
      else if (table === 'mtg_printings') terminal = isNeq ? otherPrintingsMock() : printingsMock()
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
})
