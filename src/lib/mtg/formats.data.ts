// src/lib/mtg/formats.data.ts
// Pure data + types for MTG formats. NO server-only import, client
// components import from here for form controls, chip labels, etc.
// DB helpers live in ./formats.ts.

export type FormatKey =
  | 'standard'
  | 'pioneer'
  | 'modern'
  | 'legacy'
  | 'vintage'
  | 'commander'
  | 'pauper'
  | 'historic'
  | 'timeless'
  | 'brawl'
  | 'standardbrawl'
  | 'alchemy'
  | 'oathbreaker'
  | 'premodern'
  | 'penny'
  | 'gladiator'
  | 'oldschool'
  | 'predh'
  | 'future'
  | 'duel'

export type FormatDef = {
  key: FormatKey
  label: string
  group: 'Primary' | 'Eternal' | 'Digital' | 'Casual' | 'Historical'
  blurb: string
}

/** Presentation-facing format list, ordered inside each group. Only
 *  formats that we know exist in `mtg_oracle_legalities`. */
export const FORMATS: FormatDef[] = [
  { key: 'standard',      label: 'Standard',        group: 'Primary',    blurb: 'Rotating format built around the newest sets. WOTC ban list applies.' },
  { key: 'pioneer',       label: 'Pioneer',         group: 'Primary',    blurb: 'Non-rotating format from Return to Ravnica forward. No fetchlands.' },
  { key: 'modern',        label: 'Modern',          group: 'Primary',    blurb: 'Non-rotating format from 8th Edition forward.' },

  { key: 'legacy',        label: 'Legacy',          group: 'Eternal',    blurb: 'Deep card pool. Ban list, no restrictions.' },
  { key: 'vintage',       label: 'Vintage',         group: 'Eternal',    blurb: 'Nearly every card is legal. Uses a restricted list.' },
  { key: 'pauper',        label: 'Pauper',          group: 'Eternal',    blurb: 'Commons only. Every card must have been printed at common somewhere.' },

  { key: 'commander',     label: 'Commander',       group: 'Casual',     blurb: '100-card singleton around a legendary commander.' },
  { key: 'oathbreaker',   label: 'Oathbreaker',     group: 'Casual',     blurb: '60-card singleton around a planeswalker + signature spell.' },
  { key: 'brawl',         label: 'Brawl',           group: 'Casual',     blurb: 'Standard-legal singleton with a legendary commander. Historic pool on Arena.' },
  { key: 'standardbrawl', label: 'Standard Brawl',  group: 'Casual',     blurb: 'Brawl restricted to Standard-legal cards.' },

  { key: 'historic',      label: 'Historic',        group: 'Digital',    blurb: 'MTG Arena non-rotating format. Includes Arena-only cards.' },
  { key: 'timeless',      label: 'Timeless',        group: 'Digital',    blurb: 'MTG Arena eternal format. Broadest legal pool on Arena.' },
  { key: 'alchemy',       label: 'Alchemy',         group: 'Digital',    blurb: 'MTG Arena format with digital-only rebalances.' },
  { key: 'gladiator',     label: 'Gladiator',       group: 'Digital',    blurb: 'MTG Arena Historic singleton. 100-card, no commander.' },
  { key: 'penny',         label: 'Penny Dreadful',  group: 'Digital',    blurb: 'Only cards under a small price ceiling are legal.' },

  { key: 'premodern',     label: 'Premodern',       group: 'Historical', blurb: '4th Edition through Scourge. Community-run.' },
  { key: 'oldschool',     label: 'Old School',      group: 'Historical', blurb: 'Very early cardpool from the Alpha through Fallen Empires era.' },
  { key: 'predh',         label: 'PreDH',           group: 'Historical', blurb: 'Commander using pre-2011 cards only.' },
  { key: 'future',        label: 'Future Standard', group: 'Historical', blurb: 'What Standard will look like once the current block rotates in.' },
  { key: 'duel',          label: 'Duel Commander', group: 'Historical', blurb: '1v1 Commander variant with its own ban list.' },
]

export const FORMAT_GROUPS: FormatDef['group'][] = ['Primary', 'Eternal', 'Casual', 'Digital', 'Historical']

/** Format key → definition. */
export const FORMAT_BY_KEY: Record<string, FormatDef> = Object.fromEntries(FORMATS.map((f) => [f.key, f]))
