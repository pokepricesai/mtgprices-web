// src/lib/mtg/simulation/forge-coverage.ts
//
// Fast, DB-free check: does Forge (pinned release) know about every
// oracle_card_id in a deck? Uses the shipped forge-corpus.json list
// of normalised card names.
//
// Card-name normalisation matches Forge's script-file "Name:" field:
//   - Æ → ae
//   - curly quotes → straight
//   - em-dash → --
//   - lowercase, trimmed
//
// Split / DFC cards (name "Fire // Ice") are matched either as the
// aggregate OR the primary face, Forge keys on both in practice.

import 'server-only'
import corpus from './forge-corpus.json'

const NAME_SET = new Set<string>((corpus as any).names ?? [])
export const FORGE_RELEASE: string = (corpus as any).release ?? 'forge-unknown'

export function forgeNormalise(name: string): string {
  return name
    .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/,/g, '--')
    .trim()
    .toLowerCase()
}

export function knownToForge(cardName: string): boolean {
  if (!cardName) return false
  const norm = forgeNormalise(cardName)
  if (NAME_SET.has(norm)) return true
  const primary = norm.split(' // ')[0]
  if (primary !== norm && NAME_SET.has(primary)) return true
  return false
}

/** For a list of {oracle_card_id, name}, return the unsupported ones. */
export function findUnsupportedCards(
  cards: Array<{ oracle_card_id: string; name: string | null | undefined; quantity?: number }>,
): Array<{ oracle_card_id: string; name: string }> {
  const unsupported: Array<{ oracle_card_id: string; name: string }> = []
  const seen = new Set<string>()
  for (const c of cards) {
    if (seen.has(c.oracle_card_id)) continue
    seen.add(c.oracle_card_id)
    const name = c.name ?? ''
    if (!name) { unsupported.push({ oracle_card_id: c.oracle_card_id, name: '(unknown)' }); continue }
    if (!knownToForge(name)) unsupported.push({ oracle_card_id: c.oracle_card_id, name })
  }
  return unsupported
}
