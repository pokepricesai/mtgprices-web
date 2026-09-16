// tests/mtg/public-deck-privacy.test.ts
//
// Static privacy audit of the PublicDeckPayload projection. The
// PublicDeckCard type and top-level PublicDeckPayload must not include
// any field that could leak owner-private information.
//
// This test reads the compiled TypeScript file as text and asserts
// that certain field names DO NOT appear in the payload projection.
// If the projection grows a new field named `user_id`, `email`,
// `owned`, etc, this test fails loudly at CI time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('PublicDeckPayload projection excludes owner-private fields', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/public-deck.ts'), 'utf8')

  // Trim to the projection: type definitions + the emitPayload block.
  // We scan the whole file. If any of these appear in an assignment or
  // return position it's a leak.
  const banned = [
    'user_id',
    'user_email',
    'email',
    'auth_uid',
    'acquired_price',
    'private_notes',
    // per-card private note field on mtg_deck_cards
    'notes:',
    // Collection breakdown
    'ownedQuantityAcrossPrintings',
    'ownedThisPrinting',
    'collection_items',
    // AI usage
    'ai_usage',
    'mtg_ai_usage',
    // Preferences
    'user_preferences',
  ]

  for (const b of banned) {
    // We're allowed to see the string in a code COMMENT — filter those.
    const lines = source.split('\n')
    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (line.includes(b)) {
        assert.fail(`Public deck projection contains banned field "${b}" at line ${idx + 1}:\n    ${line}`)
      }
    })
  }
})

test('Public deck route path is present and gated on is_public=true', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/public-deck.ts'), 'utf8')
  assert.match(source, /\.eq\(['"]is_public['"],\s*true\)/, 'loadPublicDeckBySlug must filter is_public=true')
})

test('Public deck client does NOT import DeckContext type', () => {
  // DeckContext contains owner-private fields (owned, currentPrice). If
  // the public client accidentally imports it we might regress and leak.
  const source = readFileSync(join(process.cwd(), 'src/app/decks/public/[slug]/PublicDeckClient.tsx'), 'utf8')
  assert.doesNotMatch(source, /from ['"]@\/lib\/mtg\/deck-context['"]/, 'PublicDeckClient must not depend on DeckContext')
})

test('Shopping list is owner-only (route requires session user)', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/decks/[id]/shopping/route.ts'), 'utf8')
  assert.match(source, /getCurrentUser\(\)/, 'shopping route must call getCurrentUser()')
  assert.match(source, /deck\.user_id !== user\.id/, 'shopping route must reject non-owners')
})

test('Public deck OG metadata forces noindex', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/decks/public/[slug]/page.tsx'), 'utf8')
  assert.match(source, /index:\s*false/, 'public deck page must set robots.index=false')
})

test('Purchase-link generator never guesses URLs', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/purchase-links.ts'), 'utf8')
  // These providers must only be emitted when an identifier row exists.
  // A regression would remove the `if (tcg)` / `if (cm)` guard.
  assert.match(source, /if \(tcg\)/, 'TCGplayer URL must be gated on identifier presence')
  assert.match(source, /if \(cm\)/, 'Cardmarket URL must be gated on identifier presence')
})
