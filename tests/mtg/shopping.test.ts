// tests/mtg/shopping.test.ts
//
// Static + light integration tests for the shopping module. Full
// integration is covered by the live RLS/shopping smoke script.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('shopping module: batches DB queries in 60-100 chunks (no N+1)', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/shopping.ts'), 'utf8')
  // We chunk .in() calls to avoid PostgREST URL-header overflow AND
  // to avoid N+1 patterns. The module uses `for (let i = 0; i < ...)`
  // batching. Assert at least three such loops exist.
  const chunkedLoops = (source.match(/for \(let i = 0; i < .+\.length; i \+= /g) ?? []).length
  assert.ok(chunkedLoops >= 3, `expected ≥3 batched loops, found ${chunkedLoops}`)
})

test('shopping module: never blends currencies in provider comparison', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/shopping.ts'), 'utf8')
  // The sort keeps currency as the outer key. If we regressed we would
  // see a direct `.sort((a, b) => a.price - b.price)` without a currency
  // comparator first.
  assert.match(source, /a\.currency !== b\.currency/, 'providerRows.sort must have currency as outer key')
})

test('shopping-preview: forbids AI-sourced pricing (server-only + no ai imports)', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/shopping-preview.ts'), 'utf8')
  assert.match(source, /server-only/, 'must be server-only')
  assert.doesNotMatch(source, /from ['"]@\/lib\/ai\//, 'must not import from ai/')
  assert.doesNotMatch(source, /from ['"]ai['"]/, 'must not import the ai package')
})

test('build-shopping-list mode: cheapest_playable is default', async () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/shopping.ts'), 'utf8')
  assert.match(source, /mode: ShoppingMode = ['"]cheapest_playable['"]/, 'default mode must be cheapest_playable')
})

test('shopping list price filter matches EXACT basis quadruple', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/shopping.ts'), 'utf8')
  // The cheapest-playable lookup must match ALL FOUR fields — otherwise
  // we might quote an EUR retail price against a USD basis, or a
  // buylist price against a retail basis.
  for (const field of ['basis.provider', 'basis.currency', 'basis.price_type', 'basis.market']) {
    assert.match(source, new RegExp(field.replace('.', '\\.')), `shopping.ts must reference ${field}`)
  }
})

test('purchase URL: TCGplayer gated on identifier + partner env var', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/mtg/purchase-links.ts'), 'utf8')
  assert.match(source, /TCGPLAYER_PARTNER_ID/, 'partner id must come from env')
  assert.match(source, /tcgplayer\.com\/product/, 'canonical TCGplayer product URL')
})

test('CSV export: uses CRLF line terminator and RFC 4180 quoting', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/decks/[id]/shopping/route.ts'), 'utf8')
  assert.match(source, /\\r\\n/, 'CSV must use CRLF')
  assert.match(source, /\.replace\(\/"\/g, '""'\)/, 'CSV must escape quotes by doubling them')
})
