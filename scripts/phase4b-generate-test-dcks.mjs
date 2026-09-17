// scripts/phase4b-generate-test-dcks.mjs
//
// Hermetic .dck fixture generator for the Phase 4B Forge POC. Zero DB.
// Uses the shipped toForgeDck() exporter over baked-in card fixtures.
// Writes files to `./forge-poc/decks/` for the CI workflow.

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Baked-in fixture metadata (name + set + collector number). Values
// chosen so each card is in Forge's cardsfolder at the pinned release
// tag (spot-checked from a fresh clone of forge-2.0.14).
const CARDS = {
  // Modern-legal burn shell
  bolt: { oracle_card_id: 'o-bolt', name: 'Lightning Bolt', set_code: 'M11', collector_number: '149' },
  shock: { oracle_card_id: 'o-shock', name: 'Shock', set_code: 'M15', collector_number: '156' },
  incinerate: { oracle_card_id: 'o-incinerate', name: 'Incinerate', set_code: '10E', collector_number: '218' },
  fireblast: { oracle_card_id: 'o-fireblast', name: 'Fireblast', set_code: 'VIS', collector_number: '82' },
  mountain: { oracle_card_id: 'o-mountain', name: 'Mountain', set_code: 'M11', collector_number: '242' },
  goblin_guide: { oracle_card_id: 'o-gg', name: 'Goblin Guide', set_code: 'ZEN', collector_number: '138' },
  monastery_swiftspear: { oracle_card_id: 'o-ms', name: 'Monastery Swiftspear', set_code: 'KTK', collector_number: '118' },
  eidolon: { oracle_card_id: 'o-eot', name: 'Eidolon of the Great Revel', set_code: 'JOU', collector_number: '93' },
  searing_blaze: { oracle_card_id: 'o-sb', name: 'Searing Blaze', set_code: 'ZEN', collector_number: '146' },
  // Simple mono-green ramp/beats
  llanowar_elves: { oracle_card_id: 'o-le', name: 'Llanowar Elves', set_code: 'M12', collector_number: '182' },
  elvish_mystic: { oracle_card_id: 'o-em', name: 'Elvish Mystic', set_code: 'M15', collector_number: '173' },
  cultivate: { oracle_card_id: 'o-cult', name: 'Cultivate', set_code: 'M11', collector_number: '169' },
  rampant_growth: { oracle_card_id: 'o-rg', name: 'Rampant Growth', set_code: 'M11', collector_number: '190' },
  primeval_titan: { oracle_card_id: 'o-pt', name: 'Primeval Titan', set_code: 'M11', collector_number: '192' },
  craterhoof_behemoth: { oracle_card_id: 'o-cb', name: 'Craterhoof Behemoth', set_code: 'AVR', collector_number: '172' },
  forest: { oracle_card_id: 'o-forest', name: 'Forest', set_code: 'M11', collector_number: '245' },
  overrun: { oracle_card_id: 'o-ov', name: 'Overrun', set_code: 'M11', collector_number: '186' },
  giant_growth: { oracle_card_id: 'o-gg2', name: 'Giant Growth', set_code: 'M11', collector_number: '172' },
  // Commander pieces
  krenko: { oracle_card_id: 'o-krenko', name: 'Krenko, Mob Boss', set_code: 'C13', collector_number: '210' },
  sol_ring: { oracle_card_id: 'o-solring', name: 'Sol Ring', set_code: 'C13', collector_number: '260' },
  goblin_king: { oracle_card_id: 'o-gk', name: 'Goblin King', set_code: '9ED', collector_number: '188' },
  goblin_chieftain: { oracle_card_id: 'o-gc', name: 'Goblin Chieftain', set_code: 'M12', collector_number: '146' },
  goblin_warchief: { oracle_card_id: 'o-gw', name: 'Goblin Warchief', set_code: 'CN2', collector_number: '58' },
  goblin_matron: { oracle_card_id: 'o-gm', name: 'Goblin Matron', set_code: 'ULG', collector_number: '80' },
  reckless_bushwhacker: { oracle_card_id: 'o-rb', name: 'Reckless Bushwhacker', set_code: 'OGW', collector_number: '116' },
  fiery_impulse: { oracle_card_id: 'o-fi', name: 'Fiery Impulse', set_code: 'ORI', collector_number: '145' },
  fireball: { oracle_card_id: 'o-fb', name: 'Fireball', set_code: '10E', collector_number: '213' },
}

// ── Modern burn deck ─────────────────────────────────────────────
const burn60 = {
  name: 'Phase4B Burn 60',
  format: 'modern',
  commanders: [],
  main: [
    { oracle_card_id: 'o-bolt', quantity: 4 },
    { oracle_card_id: 'o-shock', quantity: 4 },
    { oracle_card_id: 'o-incinerate', quantity: 4 },
    { oracle_card_id: 'o-fireblast', quantity: 4 },
    { oracle_card_id: 'o-searing_blaze', quantity: 4 },
    { oracle_card_id: 'o-eidolon', quantity: 4 },
    { oracle_card_id: 'o-monastery_swiftspear', quantity: 4 },
    { oracle_card_id: 'o-goblin_guide', quantity: 4 },
    { oracle_card_id: 'o-fiery_impulse', quantity: 4 },
    { oracle_card_id: 'o-mountain', quantity: 24 },
  ],
}

// ── Modern green ramp deck ───────────────────────────────────────
const stompy60 = {
  name: 'Phase4B Green Stompy 60',
  format: 'modern',
  commanders: [],
  main: [
    { oracle_card_id: 'o-llanowar_elves', quantity: 4 },
    { oracle_card_id: 'o-elvish_mystic', quantity: 4 },
    { oracle_card_id: 'o-cultivate', quantity: 4 },
    { oracle_card_id: 'o-rampant_growth', quantity: 4 },
    { oracle_card_id: 'o-primeval_titan', quantity: 4 },
    { oracle_card_id: 'o-craterhoof_behemoth', quantity: 2 },
    { oracle_card_id: 'o-overrun', quantity: 4 },
    { oracle_card_id: 'o-giant_growth', quantity: 4 },
    { oracle_card_id: 'o-forest', quantity: 30 },
  ],
}

// ── Commander decks (Krenko goblins vs Krenko goblins) ─────────
const goblins99 = {
  name: 'Phase4B Krenko Goblins 99',
  format: 'commander',
  commanders: [{ oracle_card_id: 'o-krenko', quantity: 1 }],
  main: [
    { oracle_card_id: 'o-sol_ring', quantity: 1 },
    { oracle_card_id: 'o-bolt', quantity: 1 },
    { oracle_card_id: 'o-shock', quantity: 1 },
    { oracle_card_id: 'o-fiery_impulse', quantity: 1 },
    { oracle_card_id: 'o-fireball', quantity: 1 },
    { oracle_card_id: 'o-incinerate', quantity: 1 },
    { oracle_card_id: 'o-fireblast', quantity: 1 },
    { oracle_card_id: 'o-searing_blaze', quantity: 1 },
    { oracle_card_id: 'o-goblin_guide', quantity: 1 },
    { oracle_card_id: 'o-monastery_swiftspear', quantity: 1 },
    { oracle_card_id: 'o-goblin_king', quantity: 1 },
    { oracle_card_id: 'o-goblin_chieftain', quantity: 1 },
    { oracle_card_id: 'o-goblin_warchief', quantity: 1 },
    { oracle_card_id: 'o-goblin_matron', quantity: 1 },
    { oracle_card_id: 'o-reckless_bushwhacker', quantity: 1 },
    { oracle_card_id: 'o-eidolon', quantity: 1 },
    { oracle_card_id: 'o-mountain', quantity: 63 },
    { oracle_card_id: 'o-krenko', quantity: 0 }, // placeholder — commander is in commanders[]
  ].filter((c) => c.quantity > 0),
}

// Ensure exactly 99 non-commander cards.
{
  const total = goblins99.main.reduce((n, c) => n + c.quantity, 0)
  if (total !== 99) {
    // Rebalance by padding basic mountains.
    const mountains = goblins99.main.find((c) => c.oracle_card_id === 'o-mountain')
    mountains.quantity += (99 - total)
  }
}

// Metadata map keyed by oracle_card_id (matches what the exporter
// expects — the "o-<slug>" convention is a spike-local convention).
const META = new Map()
for (const c of Object.values(CARDS)) {
  META.set('o-' + c.oracle_card_id.replace(/^o-/, ''), c)
}
// Rename to align with the deck oracle_card_ids used above.
const ALIASES = [
  ['o-bolt', 'bolt'], ['o-shock', 'shock'], ['o-incinerate', 'incinerate'],
  ['o-fireblast', 'fireblast'], ['o-mountain', 'mountain'],
  ['o-goblin_guide', 'goblin_guide'], ['o-monastery_swiftspear', 'monastery_swiftspear'],
  ['o-eidolon', 'eidolon'], ['o-searing_blaze', 'searing_blaze'],
  ['o-llanowar_elves', 'llanowar_elves'], ['o-elvish_mystic', 'elvish_mystic'],
  ['o-cultivate', 'cultivate'], ['o-rampant_growth', 'rampant_growth'],
  ['o-primeval_titan', 'primeval_titan'], ['o-craterhoof_behemoth', 'craterhoof_behemoth'],
  ['o-forest', 'forest'], ['o-overrun', 'overrun'], ['o-giant_growth', 'giant_growth'],
  ['o-krenko', 'krenko'], ['o-sol_ring', 'sol_ring'],
  ['o-goblin_king', 'goblin_king'], ['o-goblin_chieftain', 'goblin_chieftain'],
  ['o-goblin_warchief', 'goblin_warchief'], ['o-goblin_matron', 'goblin_matron'],
  ['o-reckless_bushwhacker', 'reckless_bushwhacker'],
  ['o-fiery_impulse', 'fiery_impulse'], ['o-fireball', 'fireball'],
]
const metaByOracle = new Map()
for (const [oracleId, key] of ALIASES) metaByOracle.set(oracleId, CARDS[key])

// Inline exporter (copy of toForgeDck logic, no TS imports needed at
// runtime — this script is invoked in CI where TS files aren't loaded).
function forgeDeckType(format) {
  const commanderish = new Set(['commander', 'oathbreaker', 'duel', 'predh', 'brawl', 'standardbrawl'])
  return commanderish.has(format) ? 'Commander' : 'Constructed'
}

function forgeLine(qty, m) {
  if (!m) return `${qty} !MISSING_ORACLE`
  const set = m.set_code ? `|${m.set_code.toUpperCase()}` : ''
  return `${qty} ${m.name}${set}`
}

function toForgeDck(deck, meta) {
  const out = []
  out.push('[metadata]')
  out.push(`Name=${deck.name.replace(/\n/g, ' ')}`)
  out.push(`DeckType=${forgeDeckType(deck.format)}`)
  if (deck.commanders?.length) {
    out.push('[commander]')
    for (const c of deck.commanders) out.push(forgeLine(c.quantity, meta.get(c.oracle_card_id)))
  }
  out.push('[main]')
  for (const c of deck.main) out.push(forgeLine(c.quantity, meta.get(c.oracle_card_id)))
  return out.join('\n') + '\n'
}

// ── Write outputs ────────────────────────────────────────────────
const outDir = './forge-poc/decks'
mkdirSync(outDir, { recursive: true })

const written = []
for (const deck of [burn60, stompy60, goblins99]) {
  const text = toForgeDck(deck, metaByOracle)
  const filename = deck.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.dck'
  const path = join(outDir, filename)
  writeFileSync(path, text, 'utf8')
  const totalMain = deck.main.reduce((n, c) => n + c.quantity, 0)
  console.log(`wrote ${path}  (${totalMain} main + ${deck.commanders?.length ?? 0} commander)`)
  written.push({ deck: deck.name, path, format: deck.format })
}

// A companion metadata file for the workflow to consume.
writeFileSync(join(outDir, 'index.json'), JSON.stringify(written, null, 2), 'utf8')
console.log('index.json written')
