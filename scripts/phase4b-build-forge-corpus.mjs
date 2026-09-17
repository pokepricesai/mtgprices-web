// scripts/phase4b-build-forge-corpus.mjs
//
// Build a static JSON name-list from a local Forge clone. Emitted to
// src/lib/mtg/simulation/forge-corpus.json so the app can validate
// card mapping at enqueue time without a DB round-trip and without
// depending on the worker.
//
// Pin: forge-2.0.14. Re-run when we bump the pinned Forge release.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const forgeRoot = process.env.FORGE_ROOT
  || join(os.homedir(), 'mtg-engine-spike', 'forge', 'forge-gui', 'res', 'cardsfolder')

function normalise(n) {
  return n
    .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, '--')
    .trim()
    .toLowerCase()
}

const names = new Set()
const letters = readdirSync(forgeRoot, { withFileTypes: true })
for (const l of letters) {
  if (!l.isDirectory()) continue
  const files = readdirSync(join(forgeRoot, l.name))
  for (const f of files) {
    if (!f.endsWith('.txt')) continue
    const head = readFileSync(join(forgeRoot, l.name, f), 'utf8').slice(0, 200)
    const m = head.match(/^Name:(.+)$/m)
    if (m) names.add(normalise(m[1].trim()))
  }
}

const out = {
  release: 'forge-2.0.14',
  captured: new Date().toISOString(),
  card_count: names.size,
  names: Array.from(names).sort(),
}
const outPath = join('src', 'lib', 'mtg', 'simulation', 'forge-corpus.json')
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`wrote ${outPath}: ${names.size.toLocaleString()} card names`)
