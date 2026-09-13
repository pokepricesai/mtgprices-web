// src/lib/seo/cardSeoOverrides.ts
// Block 5A-W-58H — controlled SEO test on ten hand-picked card
// pages, informed by real Google Search Console query data for each
// exact URL. Every other card page continues using the existing
// generated SEO template, byte-for-byte.
//
// Rules for this file:
//   * Do NOT add rarity, release year, print-run, population or
//     investment language.
//   * Do NOT hard-code current prices or sale counts. Prices move;
//     override strings must not.
//   * Do NOT add a "(2026)" year token to titles just because some
//     query samples contain the current year — the metadata must
//     stay evergreen across ISR revalidations.
//   * A slug listed here must match a real card row. Identity +
//     full printed number were verified against the live
//     get_card_detail_by_url_slug RPC in
//     scripts/58h-verify-card-identity.mjs before enrolment.
//   * Ten entries only. This is not a general CMS. If the list
//     grows, the follow-up block should introduce a proper table +
//     admin.
//
// Schema:
//   * setName — collision guard so a same-slug card under a
//     different set never inherits someone else's override.
//   * title, description, intro — ALL optional. When absent, the
//     card page falls back to the existing generated field. Today
//     every entry supplies all three, but the shape stays optional
//     so a future partial-override use case (e.g. intro-only)
//     doesn't need another schema change.

export type CardSeoOverride = {
  /** Set name as it appears in the DB (also the URL path segment,
   *  pre-encoding). Only used as a cross-check. */
  setName:      string
  /** SEO <title>. Falls back to the generated title when absent. */
  title?:       string
  /** Meta description. Falls back to the generated description when absent. */
  description?: string
  /** One compact server-rendered paragraph (~25–60 words) shown in a
   *  natural SEO/value-context slot on the card page. Falls back to
   *  nothing when absent. No hardcoded prices, no investment claims. */
  intro?:       string
}

const OVERRIDES: Readonly<Record<string, CardSeoOverride>> = {
  // 1 — HIGH confidence. SC: "greninja gold star psa 10" +
  // "swsh144 psa 10" dominate. Promo card — no printed
  // denominator, so title keeps the SWSH144 identifier.
  'greninja-gold-star-swsh144': {
    setName:     'Celebrations',
    title:       'Greninja Gold Star SWSH144 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Greninja Gold Star SWSH144 price, raw value and PSA 10 value, with PSA 9 prices, price history and current eBay listings.',
    intro:       'Looking up the current Greninja Gold Star SWSH144 price or PSA 10 value? Compare raw, PSA 9 and PSA 10 values, review price history and check current marketplace listings below.',
  },

  // 2 — HIGH confidence. SC: "first edition charizard price" +
  // "charizard 1st edition psa 10" dominate. DB card_name is
  // "Charizard [1st Edition] #4", card_number_display "4/102".
  // Title uses #4 (matches supplied brief) rather than 4/102, per
  // block-brief spec.
  'charizard-1st-edition-4': {
    setName:     'Base Set',
    title:       '1st Edition Charizard #4 Price & PSA 10 Value | PokePrices',
    description: 'See the current 1st Edition Charizard value, including raw price, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Use this page to check what a 1st Edition Charizard #4 is worth today. Compare raw, PSA 9 and PSA 10 values, follow its price history and review current marketplace listings.',
  },

  // 3 — MEDIUM. SC: "how much is birthday pikachu worth" +
  // "birthday pikachu psa 10". DB card_name is
  // "Pikachu Birthday #24".
  'pikachu-birthday-24': {
    setName:     'Celebrations',
    title:       'Birthday Pikachu #24 Price & PSA 10 Value | PokePrices',
    description: 'See how much Birthday Pikachu #24 is worth, with current raw price, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       "Looking up how much Birthday Pikachu #24 is worth? Compare current raw, PSA 9 and PSA 10 values and see how the card's price has moved over time.",
  },

  // 4 — HIGH confidence. SC: "ash greninja ex psa 10" +
  // "how much is ash greninja ex worth". Promo — no printed
  // denominator.
  'ash-greninja-ex-xy133': {
    setName:     'Promo',
    title:       'Ash-Greninja EX XY133 Price & PSA 10 Value | PokePrices',
    description: 'See how much Ash-Greninja EX XY133 is worth, including raw price, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current value of Ash-Greninja EX XY133, including raw, PSA 9 and PSA 10 prices. Use the price history and marketplace links below to compare recent pricing and current listings.',
  },

  // 5 — HIGH confidence. SC: "raticate 99/88" (254 impressions)
  // dominates by nearly 3×; users typing the full printed number
  // are the clear intent. Verified: DB card_number_display "99/88".
  'raticate-99': {
    setName:     'Perfect Order',
    title:       'Raticate 99/88 Perfect Order Price & PSA 10 Value | PokePrices',
    description: 'Check the current Raticate 99/88 Perfect Order price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Track the current value of Raticate 99/88 from Perfect Order, including raw, PSA 9 and PSA 10 prices, price history and current marketplace listings.',
  },

  // 6 — LOW SAMPLE (54 impressions). SC queries hardcode "2026"
  // year token; we deliberately do NOT put a year into evergreen
  // metadata. Verified: DB card_number_display "215/203".
  'umbreon-vmax-215': {
    setName:     'Evolving Skies',
    title:       'Umbreon VMAX 215/203 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Umbreon VMAX 215/203 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current Umbreon VMAX 215/203 value, including raw, PSA 9 and PSA 10 prices, with updated price history and current marketplace listings.',
  },

  // 7 — LOW SAMPLE (44 impressions). Same year-suppression rule
  // as #6. Verified: DB card_number_display "218/203".
  'rayquaza-vmax-218': {
    setName:     'Evolving Skies',
    title:       'Rayquaza VMAX 218/203 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Rayquaza VMAX 218/203 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current Rayquaza VMAX 218/203 value, including raw, PSA 9 and PSA 10 prices, with updated price history and current marketplace listings.',
  },

  // 8 — MEDIUM. SC: "n's reshiram 167/159 psa 10" + several
  // "stamped" queries. Verified: DB card_name preserves the
  // [Stamped] bracket and card_number_display is "167/159". Do NOT
  // collapse into the non-stamped print.
  'ns-reshiram-stamped-167': {
    setName:     'Journey Together',
    title:       "N's Reshiram [Stamped] 167/159 Price & PSA 10 Value | PokePrices",
    description: "Check the current N's Reshiram [Stamped] 167/159 price, including raw, PSA 9 and PSA 10 values, price history and current eBay listings.",
    intro:       "Check the current value of N's Reshiram [Stamped] 167/159 from Journey Together, including raw, PSA 9 and PSA 10 prices, price history and current marketplace listings.",
  },

  // 9 — LOW SAMPLE (42 impressions). The single click came from
  // an anomalous "is it going down?" query; per block brief, do
  // NOT optimise around it. Verified: DB card_number_display
  // "78/73".
  'mewtwo-gx-78': {
    setName:     'Shining Legends',
    title:       'Mewtwo GX 78/73 Price & PSA 10 Value | PokePrices',
    description: 'See the current Mewtwo GX 78/73 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'See what Mewtwo GX 78/73 is worth today by comparing raw, PSA 9 and PSA 10 values, historical price movement and current marketplace listings.',
  },

  // 10 — LOW SAMPLE (15 impressions). Every query includes
  // "2026" but we still keep metadata evergreen. Verified: DB
  // card_number_display "186/195".
  'lugia-v-186': {
    setName:     'Silver Tempest',
    title:       'Lugia V 186/195 Price & PSA 10 Value | PokePrices',
    description: 'Check the current Lugia V 186/195 price, including raw value, PSA 9 and PSA 10 values, price history and current eBay listings.',
    intro:       'Check the current Lugia V 186/195 value, including raw, PSA 9 and PSA 10 prices, price history and current marketplace listings.',
  },
}

/**
 * Look up a card-page SEO override.
 *
 * Returns the override iff:
 *   * the URL slug matches a hand-picked entry, AND
 *   * the resolved card's set_name matches the entry's `setName` (so
 *     a same-slug card under a different set never gets swapped).
 *
 * Every field on the returned override is optional — the caller
 * applies each one only when present.
 */
export function getCardSeoOverride(
  cardUrlSlug: string | null | undefined,
  setName:     string | null | undefined,
): CardSeoOverride | null {
  if (!cardUrlSlug || !setName) return null
  const entry = OVERRIDES[cardUrlSlug]
  if (!entry) return null
  if (entry.setName !== setName) return null
  return entry
}

/** Test-only introspection. Never used by the app. */
export function _internalOverrideKeys(): ReadonlyArray<string> {
  return Object.keys(OVERRIDES)
}

/** Test-only introspection. Never used by the app. */
export function _internalOverrideMap(): Readonly<Record<string, CardSeoOverride>> {
  return OVERRIDES
}
