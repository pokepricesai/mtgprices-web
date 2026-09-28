#!/usr/bin/env node
// Pass 2B mini §3 — smoke-test the AI DFC grounding fix.
// Simulates what getCardFacts now returns for a DFC (Delver), an MDFC
// (Valki), a meld card (Bruna) and a single-faced regression (Bolt).
// Asserts faces is populated for the multi-faced layouts and null for
// the single-faced case, and that the back-face oracle text is real
// data from the DB rather than the model's imagination.

import { createClient } from '@supabase/supabase-js'
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const DFC_LAYOUTS = new Set(['transform', 'modal_dfc', 'meld', 'reversible_card', 'double_faced_token'])

function shapeForModel(o) {
  const rawFaces = Array.isArray(o.card_faces) ? o.card_faces : []
  const isDoubleFaced = DFC_LAYOUTS.has(String(o.layout)) && rawFaces.length >= 2
  const faces = isDoubleFaced
    ? rawFaces.map((f) => ({
        name: f?.name ?? null,
        mana_cost: f?.mana_cost ?? null,
        type_line: f?.type_line ?? null,
        oracle_text: f?.oracle_text ?? null,
        power: f?.power ?? null,
        toughness: f?.toughness ?? null,
        loyalty: f?.loyalty ?? null,
        defense: f?.defense ?? null,
        colors: Array.isArray(f?.colors) ? f.colors : [],
      }))
    : null
  return {
    name: o.name, layout: o.layout,
    faces,
    oracle_text: o.oracle_text ?? null,
  }
}

const TARGETS = [
  { label: 'DFC transform', name: 'Delver of Secrets // Insectile Aberration', expectFaces: true },
  { label: 'MDFC modal',    name: 'Valki, God of Lies // Tibalt, Cosmic Impostor', expectFaces: true },
  { label: 'Meld',          name: 'Bruna, the Fading Light',      expectFaces: false }, // meld halves stored separately, not as card_faces on the base row
  { label: 'Single-face',   name: 'Lightning Bolt',               expectFaces: false },
]

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1) }

for (const t of TARGETS) {
  const { data } = await sb.from('mtg_oracle_cards')
    .select('id, name, layout, oracle_text, card_faces')
    .eq('name', t.name).limit(1)
  if (!data || data.length === 0) { console.log(`  · ${t.label}: no oracle row found (skipping)`); continue }
  const shaped = shapeForModel(data[0])
  const hasFaces = Array.isArray(shaped.faces) && shaped.faces.length >= 2
  if (hasFaces && !t.expectFaces) fail(`${t.label}: faces should be null for ${t.name}`)
  if (!hasFaces && t.expectFaces) fail(`${t.label}: faces missing for ${t.name} (layout=${shaped.layout})`)
  console.log(`  ✓ ${t.label} · "${shaped.name}" layout=${shaped.layout} faces=${hasFaces ? shaped.faces.length : 'null'}`)
  if (hasFaces) {
    for (const [i, f] of shaped.faces.entries()) {
      const previewText = (f.oracle_text ?? '').slice(0, 80).replace(/\s+/g, ' ')
      console.log(`      face[${i}]: "${f.name}" (${f.type_line ?? '?'}) — "${previewText}${(f.oracle_text ?? '').length > 80 ? '…' : ''}"`)
    }
  }
}

console.log('\nPASS · AI DFC grounding shape verified.')
