// Block 5A-W-58H — unit tests for the small card-SEO override map.
//
// Pinned:
//   * All ten supplied slugs return the exact title / description /
//     intro from the search-console-informed block brief.
//   * Fields are individually optional; the helper returns the
//     override entry whole so callers can pick fields.
//   * A slug that is present but under the wrong set_name returns
//     null (cross-set collision guard).
//   * A non-overridden slug returns null.
//   * Every override's title / description / intro fit inside
//     conservative length limits — flags anything obviously truncated
//     or malformed before it ships.
//   * Never contains banned marketing / investment language.
//   * Never hardcodes a specific USD/GBP amount, a year, or a
//     population / print-run figure.
//   * Titles do not double-append "| PokePrices".

import { describe, it, expect } from 'vitest'
import {
  getCardSeoOverride,
  _internalOverrideKeys,
  _internalOverrideMap,
  type CardSeoOverride,
} from '../cardSeoOverrides'

type Expected = { slug: string } & Required<Pick<CardSeoOverride, 'setName' | 'title' | 'description' | 'intro'>>

const EXPECTED: Expected[] = [
  {
    slug:        'greninja-gold-star-swsh144',
    setName:     'Celebrations',
    title:       'Greninja Gold Star SWSH144 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Greninja Gold Star SWSH144 price, raw value and PSA 10 value, with PSA 9 prices, price history and current eBay listings.',
    intro:       'Looking up the current Greninja Gold Star SWSH144 price or PSA 10 value? Compare raw, PSA 9 and PSA 10 values, review price history and check current marketplace listings below.',
  },
  {
    slug:        'charizard-1st-edition-4',
    setName:     'Base Set',
    title:       '1st Edition Charizard #4 Price & PSA 10 Value | PokePrices',
    description: 'See the current 1st Edition Charizard value, including raw price, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Use this page to check what a 1st Edition Charizard #4 is worth today. Compare raw, PSA 9 and PSA 10 values, follow its price history and review current marketplace listings.',
  },
  {
    slug:        'pikachu-birthday-24',
    setName:     'Celebrations',
    title:       'Birthday Pikachu #24 Price & PSA 10 Value | PokePrices',
    description: 'See how much Birthday Pikachu #24 is worth, with current raw price, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       "Looking up how much Birthday Pikachu #24 is worth? Compare current raw, PSA 9 and PSA 10 values and see how the card's price has moved over time.",
  },
  {
    slug:        'ash-greninja-ex-xy133',
    setName:     'Promo',
    title:       'Ash-Greninja EX XY133 Price & PSA 10 Value | PokePrices',
    description: 'See how much Ash-Greninja EX XY133 is worth, including raw price, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current value of Ash-Greninja EX XY133, including raw, PSA 9 and PSA 10 prices. Use the price history and marketplace links below to compare recent pricing and current listings.',
  },
  {
    slug:        'raticate-99',
    setName:     'Perfect Order',
    title:       'Raticate 99/88 Perfect Order Price & PSA 10 Value | PokePrices',
    description: 'Check the current Raticate 99/88 Perfect Order price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Track the current value of Raticate 99/88 from Perfect Order, including raw, PSA 9 and PSA 10 prices, price history and current marketplace listings.',
  },
  {
    slug:        'umbreon-vmax-215',
    setName:     'Evolving Skies',
    title:       'Umbreon VMAX 215/203 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Umbreon VMAX 215/203 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current Umbreon VMAX 215/203 value, including raw, PSA 9 and PSA 10 prices, with updated price history and current marketplace listings.',
  },
  {
    slug:        'rayquaza-vmax-218',
    setName:     'Evolving Skies',
    title:       'Rayquaza VMAX 218/203 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Rayquaza VMAX 218/203 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current Rayquaza VMAX 218/203 value, including raw, PSA 9 and PSA 10 prices, with updated price history and current marketplace listings.',
  },
  {
    slug:        'ns-reshiram-stamped-167',
    setName:     'Journey Together',
    title:       "N's Reshiram [Stamped] 167/159 Price & PSA 10 Value | PokePrices",
    description: "Check the current N's Reshiram [Stamped] 167/159 price, including raw, PSA 9 and PSA 10 values, price history and current eBay listings.",
    intro:       "Check the current value of N's Reshiram [Stamped] 167/159 from Journey Together, including raw, PSA 9 and PSA 10 prices, price history and current marketplace listings.",
  },
  {
    slug:        'mewtwo-gx-78',
    setName:     'Shining Legends',
    title:       'Mewtwo GX 78/73 Price & PSA 10 Value | PokePrices',
    description: 'See the current Mewtwo GX 78/73 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'See what Mewtwo GX 78/73 is worth today by comparing raw, PSA 9 and PSA 10 values, historical price movement and current marketplace listings.',
  },
  {
    slug:        'lugia-v-186',
    setName:     'Silver Tempest',
    title:       'Lugia V 186/195 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Lugia V 186/195 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current Lugia V 186/195 value, including raw, PSA 9 and PSA 10 prices, price history and current marketplace listings.',
  },
]

// ── Exhaustive per-slug pin ───────────────────────────────────────

describe('getCardSeoOverride — exact copy per slug', () => {
  for (const e of EXPECTED) {
    it(`${e.slug} → block-brief title + description + intro`, () => {
      const got = getCardSeoOverride(e.slug, e.setName)
      expect(got).not.toBeNull()
      expect(got!.setName).toBe(e.setName)
      expect(got!.title).toBe(e.title)
      expect(got!.description).toBe(e.description)
      expect(got!.intro).toBe(e.intro)
    })
  }
})

describe('getCardSeoOverride — negative / cross-set guards', () => {
  it('returns null for a slug that is not in the override map', () => {
    expect(getCardSeoOverride('some-random-card-999', 'Base Set')).toBeNull()
    expect(getCardSeoOverride('pikachu-25', 'Base Set')).toBeNull()
  })

  it('returns null when the slug matches but the set_name disagrees', () => {
    // Regression guard: a same-slug card under a different set must
    // NOT inherit an override from a hand-picked entry.
    expect(getCardSeoOverride('raticate-99', 'Evolving Skies')).toBeNull()
    expect(getCardSeoOverride('lugia-v-186', 'Base Set')).toBeNull()
    expect(getCardSeoOverride('umbreon-vmax-215', 'Journey Together')).toBeNull()
  })

  it('returns null on missing / empty inputs', () => {
    expect(getCardSeoOverride(null,       'Celebrations')).toBeNull()
    expect(getCardSeoOverride(undefined,  'Celebrations')).toBeNull()
    expect(getCardSeoOverride('',         'Celebrations')).toBeNull()
    expect(getCardSeoOverride('umbreon-vmax-215', null)).toBeNull()
    expect(getCardSeoOverride('umbreon-vmax-215', '')).toBeNull()
  })
})

describe('getCardSeoOverride — map shape', () => {
  it('carries exactly ten hand-picked entries', () => {
    expect(_internalOverrideKeys().length).toBe(10)
  })

  it('every entry has a non-empty setName', () => {
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      expect(entry.setName.trim(), `${slug} setName`).not.toBe('')
    }
  })

  it('title / description / intro are individually optional in the type but populated here', () => {
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      // Current cohort supplies all three fields; the optional shape
      // is exercised by the tests below and by the negative-case
      // handling in getCardSeoOverride.
      expect(typeof entry.title,       `${slug} title`).toBe('string')
      expect(typeof entry.description, `${slug} description`).toBe('string')
      expect(typeof entry.intro,       `${slug} intro`).toBe('string')
    }
  })
})

// ── Length + snippet sanity ──────────────────────────────────────

describe('getCardSeoOverride — length sanity for SERP', () => {
  it('every title stays under 70 characters (SERP truncation risk)', () => {
    for (const e of EXPECTED) {
      expect(e.title.length, `${e.slug} title: "${e.title}" (${e.title.length}c)`).toBeLessThanOrEqual(70)
    }
  })

  it('every description stays under 170 characters (SERP truncation risk)', () => {
    for (const e of EXPECTED) {
      expect(e.description.length, `${e.slug} description (${e.description.length}c)`).toBeLessThanOrEqual(170)
    }
  })

  it('every title/description is at least 30 characters (obvious-truncation flag)', () => {
    for (const e of EXPECTED) {
      expect(e.title.length,       `${e.slug} title`).toBeGreaterThanOrEqual(30)
      expect(e.description.length, `${e.slug} description`).toBeGreaterThanOrEqual(30)
    }
  })

  it('every intro is roughly 25–60 words as required by the block brief', () => {
    for (const e of EXPECTED) {
      const words = e.intro.trim().split(/\s+/).length
      expect(words, `${e.slug} intro word count = ${words}`).toBeGreaterThanOrEqual(20)
      expect(words, `${e.slug} intro word count = ${words}`).toBeLessThanOrEqual(65)
    }
  })
})

// ── PokePrices suffix pin ────────────────────────────────────────

describe('getCardSeoOverride — no double site-name suffix', () => {
  it("titles include a single ' | PokePrices' suffix, not doubled", () => {
    for (const e of EXPECTED) {
      const matches = e.title.match(/\| PokePrices/g) || []
      expect(matches.length, `${e.slug} title: "${e.title}"`).toBe(1)
      // Regression guard: someone appending it a second time.
      expect(e.title, e.slug).not.toContain('| PokePrices | PokePrices')
      expect(e.title, e.slug).not.toContain('PokePrices PokePrices')
    }
  })
})

// ── Full printed number pin ──────────────────────────────────────

describe('getCardSeoOverride — full printed numbers use the DB-verified form', () => {
  // Verified against get_card_detail_by_url_slug in
  // scripts/58h-verify-card-identity.mjs. Regression guard so a
  // future refactor cannot silently swap 99/88 → 99/89 etc.
  const NUMBER_PIN: Record<string, string> = {
    'raticate-99':             '99/88',
    'umbreon-vmax-215':        '215/203',
    'rayquaza-vmax-218':       '218/203',
    'ns-reshiram-stamped-167': '167/159',
    'mewtwo-gx-78':            '78/73',
    'lugia-v-186':             '186/195',
  }
  for (const [slug, expectedNum] of Object.entries(NUMBER_PIN)) {
    it(`${slug} title/description/intro all use "${expectedNum}"`, () => {
      const entry = _internalOverrideMap()[slug]
      expect(entry, slug).toBeDefined()
      expect(entry.title,       `${slug} title`).toContain(expectedNum)
      expect(entry.description, `${slug} description`).toContain(expectedNum)
      expect(entry.intro,       `${slug} intro`).toContain(expectedNum)
    })
  }
})

// ── Content guardrails ───────────────────────────────────────────

describe('getCardSeoOverride — content guardrails', () => {
  it('never contains banned marketing / investment language', () => {
    const banned = [
      'invest', 'investment', 'profit', 'guaranteed', 'sure thing',
      'flip', 'flipping', 'arbitrage',
      'rarest', 'rare card', 'limited edition', 'print run',
      'population report', 'best investment', 'cheapest',
    ]
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      const all = `${entry.title} ${entry.description} ${entry.intro ?? ''}`.toLowerCase()
      for (const term of banned) {
        expect(all, `${slug} contains banned term "${term}"`).not.toContain(term)
      }
    }
  })

  it('never hardcodes a year (evergreen SEO)', () => {
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      const all = `${entry.title} ${entry.description} ${entry.intro ?? ''}`
      expect(all, `${slug} year mention`).not.toMatch(/\b(19|20)\d{2}\b/)
    }
  })

  it('never hardcodes a specific price value (USD / GBP / cents)', () => {
    // Prices change; overrides must not embed a snapshot.
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      const all = `${entry.title} ${entry.description} ${entry.intro ?? ''}`
      // Any $NNN, £NNN, $N.NNk pattern anywhere. Deliberately strict.
      expect(all, `${slug} $ price`).not.toMatch(/\$\s*\d/)
      expect(all, `${slug} £ price`).not.toMatch(/£\s*\d/)
      // No "NN dollars" / "NN pounds".
      expect(all.toLowerCase(), `${slug} dollars / pounds`).not.toMatch(/\b\d[\d,.]*\s*(dollars|pounds|usd|gbp)\b/)
      // No "worth $ / £".
      expect(all.toLowerCase(), `${slug} worth $$`).not.toMatch(/worth\s*[$£]\s*\d/)
    }
  })

  it('never hardcodes a population / print-run / sales-count figure', () => {
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      const all = `${entry.title} ${entry.description} ${entry.intro ?? ''}`.toLowerCase()
      expect(all, `${slug} population/print-run mention`).not.toMatch(/\b\d[\d,]* (?:copies|graded|printed|pulled|sold)\b/)
    }
  })
})
