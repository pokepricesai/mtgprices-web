// src/lib/mtg/simulation/deck-export.ts
//
// Convert an MTGPrices AdapterDeck to the text formats that Forge
// and XMage understand. Nothing here talks to an engine, this is
// pure text transformation with the printing metadata we already
// have in mtg_printings. Adapters call one of these to produce the
// engine-native deck text, then hand it to their process.

import type { AdapterDeck } from './rules-engine-adapter'

/** Card metadata each exporter needs. `name` is REQUIRED. `set_code`
 *  and `collector_number` are optional; XMage requires collector_number,
 *  Forge requires only name (set is optional). Callers should batch-
 *  hydrate this from mtg_oracle_cards + mtg_printings and pass it in.
 *
 *  For split / DFC cards `name` MUST be the aggregate ("Fire // Ice",
 *  "Delver of Secrets // Insectile Aberration"), this is what both
 *  engines' card databases key on. */
export type ExportCardMeta = {
  oracle_card_id: string
  name: string
  set_code?: string
  collector_number?: string
}

// ── Forge .dck format ──────────────────────────────────────────────
// [metadata]
// Name=<deck name>
// [main]
// <count> <card name>|<SET_CODE>
// ...
// [sideboard]
// [commander]
// See DeckSerializer.java in the Forge repo.

export function toForgeDck(deck: AdapterDeck, meta: Map<string, ExportCardMeta>): string {
  const out: string[] = []
  out.push('[metadata]')
  out.push(`Name=${deck.name.replace(/\n/g, ' ')}`)
  out.push(`DeckType=${forgeDeckType(deck.format)}`)

  if (deck.commanders && deck.commanders.length > 0) {
    out.push('[commander]')
    for (const c of deck.commanders) out.push(forgeLine(c.quantity, meta.get(c.oracle_card_id)))
  }
  out.push('[main]')
  for (const c of deck.main) out.push(forgeLine(c.quantity, meta.get(c.oracle_card_id)))

  if (deck.sideboard && deck.sideboard.length > 0) {
    out.push('[sideboard]')
    for (const c of deck.sideboard) out.push(forgeLine(c.quantity, meta.get(c.oracle_card_id)))
  }
  if (deck.companion && deck.companion.length > 0) {
    out.push('[companion]')
    for (const c of deck.companion) out.push(forgeLine(c.quantity, meta.get(c.oracle_card_id)))
  }
  return out.join('\n') + '\n'
}

function forgeLine(qty: number, m: ExportCardMeta | undefined): string {
  if (!m) return `${qty} !MISSING_ORACLE`
  const set = m.set_code ? `|${m.set_code.toUpperCase()}` : ''
  return `${qty} ${m.name}${set}`
}

function forgeDeckType(format: string): string {
  switch (format) {
    case 'commander': case 'oathbreaker': case 'duel': case 'predh': case 'brawl': case 'standardbrawl':
      return 'Commander'
    default: return 'Constructed'
  }
}

// ── XMage .dck format ──────────────────────────────────────────────
// <count> [<SET>:<CN>] <card name>
// Lines beginning with "SB:" are sideboard.
// See Mage.Tests/*.dck examples.

export function toXMageDck(deck: AdapterDeck, meta: Map<string, ExportCardMeta>): string {
  const out: string[] = []
  // XMage puts commanders inline with a special comment header. Different
  // XMage builds use different conventions; we follow the one used in
  // Mage.Tests/CMDNorinTheWary.dck (Commander is listed as normal deck
  // entry and the framework's Commander tests interpret it via the deck
  // name / harness rather than an in-file marker). For the exporter
  // we simply add commanders to the main list.
  for (const c of deck.commanders) out.push(xmageLine(c.quantity, meta.get(c.oracle_card_id), false))
  for (const c of deck.main) out.push(xmageLine(c.quantity, meta.get(c.oracle_card_id), false))
  if (deck.sideboard) for (const c of deck.sideboard) out.push(xmageLine(c.quantity, meta.get(c.oracle_card_id), true))
  return out.join('\n') + '\n'
}

function xmageLine(qty: number, m: ExportCardMeta | undefined, sideboard: boolean): string {
  if (!m) return `${sideboard ? 'SB: ' : ''}${qty} !MISSING_ORACLE`
  const set = (m.set_code ?? '?').toUpperCase()
  const cn = m.collector_number ?? '?'
  return `${sideboard ? 'SB: ' : ''}${qty} [${set}:${cn}] ${m.name}`
}
