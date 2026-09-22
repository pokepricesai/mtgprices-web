// card-seo-content-graded.test.tsx
// Slice 7. Locks the natural-language SEO paragraph rendered by
// CardSeoContent when TCGGraph slabbed data exists for the exact
// printing. Uses vitest + jsdom via next/react hooks-free server-
// component rendering.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CardSeoContent from '@/components/mtg/CardSeoContent'
import type { GradedView } from '@/lib/mtg/graded-view'
import type { MtgOracleCard, MtgPrinting } from '@/lib/mtg/cards'
import type { CardMarketSummary } from '@/lib/mtg/card-market.types'

const oracle: MtgOracleCard = {
  id: 'oracle-1', oracle_id: 'oracle-1', name: 'Black Lotus',
  mana_cost: '{0}', mana_value: 0, type_line: 'Artifact', oracle_text: null,
  power: null, toughness: null, loyalty: null, defense: null,
  colors: [], color_identity: [], keywords: [], layout: 'normal',
  card_faces: null, produced_mana: null, reserved: true, game_changer: null, capabilities: [],
}

const printing: MtgPrinting = {
  id: 'print-1', oracle_card_id: 'oracle-1', set_id: 'set-lea',
  scryfall_id: 'sc-1', set_code: 'lea', collector_number: '232', lang: 'en',
  name: 'Black Lotus', layout: 'normal', rarity: 'rare', artist: 'Christopher Rush',
  image_uri: null, image_uri_small: null, art_crop_uri: null,
  released_at: '1993-08-05', borderless: null, full_art: null,
  promo: null, digital: false, scryfall_uri: null, reprint: null,
  textless: null, variation: null,
}

const marketSummary: CardMarketSummary = {
  basis: { provider: 'tcgplayer', currency: 'USD', priceType: 'market' },
  currency: 'USD', currencySymbol: '$',
  currentPrice: 32000, currentFinish: 'nonfoil', currentObservedOn: '2026-09-20',
  currentRank: 1,
  d7:  { pct_delta: null, high: null, low: null, spanDays: 7 },
  d30: { pct_delta: null, high: null, low: null, spanDays: 30 },
  d90: { pct_delta: null, high: null, low: null, spanDays: 90 },
  pricedPrintings: [], cheapest: null, mostExpensive: null,
  insights: [], foilPremium: null,
}

function gradedView(overrides: Partial<GradedView> = {}): GradedView {
  return {
    hasSlabbedData: true,
    slabTen: [
      { grader: 'PSA', grade: '10', price: 250_000, currency: 'USD', volume: null, updatedAt: '2026-09-20T00:00:00Z', isSlabbed: true },
    ],
    anyGraded: [],
    other: [],
    lastSlabUpdate: '2026-09-20T00:00:00Z',
    currencies: ['USD'],
    premium: null,
    ...overrides,
  }
}

function render(props: Parameters<typeof CardSeoContent>[0]): string {
  return renderToStaticMarkup(CardSeoContent(props) as React.ReactElement)
}

describe('CardSeoContent graded paragraph', () => {
  it('renders a natural-language PSA 10 sentence when slab data exists', () => {
    const html = render({
      oracle, printing, otherPrintings: [], legalities: [],
      market: marketSummary,
      gradedView: gradedView(),
      canonical: 'https://mtgprices.io/set/lea/card/232-black-lotus',
      setName: 'Limited Edition Alpha',
    })
    expect(html).toContain('PSA')
    expect(html).toContain('10')
    expect(html).toContain('$250,000')
    expect(html.toLowerCase()).toContain('this exact printing')
  })

  it('omits the graded paragraph entirely when hasSlabbedData is false', () => {
    const html = render({
      oracle, printing, otherPrintings: [], legalities: [],
      market: marketSummary,
      gradedView: gradedView({ hasSlabbedData: false, slabTen: [], anyGraded: [], other: [] }),
      canonical: 'https://mtgprices.io/set/lea/card/232-black-lotus',
      setName: 'Limited Edition Alpha',
    })
    expect(html).not.toContain('PSA')
    expect(html).not.toContain('slabbed')
    expect(html.toLowerCase()).not.toContain('this exact printing has')
  })

  it('renders the premium sentence when a valid raw-vs-slab premium is present', () => {
    const view = gradedView({
      premium: {
        raw: { tcg_printing_id: 't', price: 40_000, currency: 'USD', card_sales_volume: null, updated_at: '2026-09-19T00:00:00Z' },
        slab: { grader: 'PSA', grade: '10', price: 250_000, currency: 'USD', volume: null, updatedAt: '2026-09-20T00:00:00Z', isSlabbed: true },
        multiple: 6.25,
        percentDisplay: '+525%',
        currency: 'USD',
      },
    })
    const html = render({
      oracle, printing, otherPrintings: [], legalities: [],
      market: marketSummary, gradedView: view,
      canonical: 'https://mtgprices.io/set/lea/card/232-black-lotus',
      setName: 'Limited Edition Alpha',
    })
    expect(html).toContain('+525%')
    expect(html).toContain('$40,000')
  })

  it('never emits a $0 in the paragraph even if a grader is missing', () => {
    const view = gradedView({
      slabTen: [{ grader: 'PSA', grade: '10', price: 250_000, currency: 'USD', volume: null, updatedAt: '2026-09-20T00:00:00Z', isSlabbed: true }],
    })
    const html = render({
      oracle, printing, otherPrintings: [], legalities: [],
      market: marketSummary, gradedView: view,
      canonical: 'https://mtgprices.io/set/lea/card/232-black-lotus',
      setName: 'Limited Edition Alpha',
    })
    expect(html).not.toContain('$0')
    expect(html).not.toContain('BGS 10')
    expect(html).not.toContain('CGC 10')
  })
})
