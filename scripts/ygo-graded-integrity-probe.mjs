#!/usr/bin/env node
// scripts/ygo-graded-integrity-probe.mjs
//
// Investigation-only probe for the YGO 1st Edition vs Unlimited
// graded-mapping question raised by Collector Network Slice 3/5.
// Read-only against prod DB. Small handful of TCGGraph credits.
//
// Writes evidence to .tmp/ygo-integrity/*.json for audit.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadEnv, requireEnv, getSupabase, tcgFetch } from '../src/lib/tcggraph/ingest-core.mjs'

loadEnv()
requireEnv('TCGGRAPH_API_KEY')
requireEnv('NEXT_PUBLIC_SUPABASE_URL')
requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_DIR = join(REPO_ROOT, '.tmp', 'ygo-integrity')
mkdirSync(OUT_DIR, { recursive: true })

const TARGET_CARDS = [
  { name: 'Blue-Eyes White Dragon', setCode: 'lob', collectorNumber: 'LOB-001' },
  { name: 'Dark Magician',          setCode: 'lob', collectorNumber: 'LOB-005' },
  { name: 'Red-Eyes B. Dragon',     setCode: 'lob', collectorNumber: 'LOB-070' },
  { name: 'Exodia the Forbidden One', setCode: 'lob', collectorNumber: 'LOB-124' },
]

const sb = getSupabase()
const evidence = { startedAt: new Date().toISOString(), targets: [], creditsUsed: 0 }

function saveJson(name, obj) {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(obj, null, 2))
}

async function findLocalCard(target) {
  const setId = `ygo:set:${target.setCode.toLowerCase()}`
  //  Prefer exact collector-number match inside the target set.
  if (target.collectorNumber) {
    const { data } = await sb
      .from('tcg_cards')
      .select('id, tcggraph_card_id, name, set_id, collector_number, language')
      .eq('game_id', 'ygo').eq('set_id', setId).eq('collector_number', target.collectorNumber).limit(5)
    if (data && data.length) return data[0]
  }
  const { data } = await sb
    .from('tcg_cards')
    .select('id, tcggraph_card_id, name, set_id, collector_number, language')
    .eq('game_id', 'ygo').eq('set_id', setId).ilike('name', target.name).limit(5)
  return (data && data[0]) || null
}

async function inspectPrintings(cardRow) {
  const { data: prints } = await sb
    .from('tcg_printings')
    .select('id, tcggraph_card_id, tcggraph_printing_key, finish, edition, mapping_confidence')
    .eq('game_id', 'ygo')
    .eq('tcggraph_card_id', cardRow.tcggraph_card_id)
  const { data: graded } = await sb
    .from('tcg_graded_prices_current')
    .select('tcg_printing_id, grader, grade, currency, price, card_sales_volume, updated_at')
    .in('tcg_printing_id', (prints ?? []).map((p) => p.id))
  const { data: market } = await sb
    .from('tcg_market_prices_current')
    .select('tcg_printing_id, source, list_type, currency, finish, price, updated_at')
    .in('tcg_printing_id', (prints ?? []).map((p) => p.id))
  return { prints: prints ?? [], graded: graded ?? [], market: market ?? [] }
}

async function fetchUpstream(cardRow) {
  //  Try /cards/{tcggraph_card_id}. Also try /cards with a name filter,
  //  in case the singular endpoint is not available.
  const single = await tcgFetch(`/cards/${cardRow.tcggraph_card_id}`)
  evidence.creditsUsed += single.cost || 0
  return { path: `/cards/${cardRow.tcggraph_card_id}`, status: single.status, cost: single.cost, dailyRemaining: single.dailyRemaining, body: single.body }
}

async function main() {
  //  Preflight: confirm credit status without spending.
  const pre = await tcgFetch('/games')
  evidence.creditsUsed += pre.cost || 0
  evidence.preflight = { status: pre.status, dailyRemaining: pre.dailyRemaining, monthlyRemaining: pre.creditsRemaining, cost: pre.cost }
  console.log(`[probe] preflight daily=${pre.dailyRemaining} monthly=${pre.creditsRemaining} cost=${pre.cost}`)

  for (const t of TARGET_CARDS) {
    console.log(`\n[probe] target: ${t.name} (${t.setCode.toUpperCase()}-${t.collectorNumber ?? '?'})`)
    const localCard = await findLocalCard(t)
    if (!localCard) {
      console.log(`  no matching tcg_cards row - skipping`)
      evidence.targets.push({ target: t, localCard: null })
      continue
    }
    console.log(`  local: tcg_cards.id=${localCard.id}  name="${localCard.name}"  cn=${localCard.collector_number}  tcggraph_id=${localCard.tcggraph_card_id}`)
    const local = await inspectPrintings(localCard)
    console.log(`  local: ${local.prints.length} printings, ${local.graded.length} graded rows, ${local.market.length} market rows`)
    for (const p of local.prints) {
      const gCount = local.graded.filter((g) => g.tcg_printing_id === p.id).length
      const mCount = local.market.filter((m) => m.tcg_printing_id === p.id).length
      console.log(`    printing: key='${p.tcggraph_printing_key}' finish=${p.finish} edition=${p.edition}  graded=${gCount}  market=${mCount}`)
    }
    const upstream = await fetchUpstream(localCard)
    console.log(`  upstream: ${upstream.path} -> ${upstream.status} (cost=${upstream.cost} daily=${upstream.dailyRemaining})`)
    if (upstream.body) {
      const body = upstream.body
      const rec = body?.data ?? body
      const printings = rec?.printings ?? []
      const graded = rec?.gradedPrices ?? []
      const prices = rec?.prices ?? []
      console.log(`    upstream card: id=${rec?.id} name="${rec?.name}"`)
      console.log(`    upstream printings: ${printings.length}`)
      for (const p of printings) {
        console.log(`      - key='${p.key}' label='${p.label}' kind='${p.kind}' externalIds=${JSON.stringify(p.externalIds ?? {})}`)
      }
      console.log(`    upstream prices: ${prices.length}`)
      const finishSet = new Set(prices.map((p) => p.finish))
      console.log(`      finishes: [${Array.from(finishSet).join(', ')}]`)
      console.log(`    upstream gradedPrices: ${graded.length}`)
      const gradedKeys = graded[0] ? Object.keys(graded[0]) : []
      console.log(`      graded row keys: [${gradedKeys.join(', ')}]`)
      const gEditions = graded.map((g) => g.printingKey ?? g.printing ?? g.edition ?? g.variant ?? null)
      const uniqE = Array.from(new Set(gEditions))
      console.log(`      graded distinct edition/printing hints: [${uniqE.join(', ')}]`)
    }
    saveJson(`${t.setCode}-${t.collectorNumber ?? 'x'}-${localCard.tcggraph_card_id}.json`, {
      target: t,
      localCard,
      local,
      upstream,
    })
    evidence.targets.push({
      target: t,
      localCard,
      localPrintings: local.prints,
      localGradedCount: local.graded.length,
      localMarketCount: local.market.length,
      upstreamStatus: upstream.status,
      upstreamCost: upstream.cost,
      upstreamCardId: upstream.body?.data?.id ?? upstream.body?.id ?? null,
      upstreamPrintings: (upstream.body?.data?.printings ?? upstream.body?.printings ?? []).map((p) => ({ key: p.key, label: p.label, kind: p.kind, externalIds: p.externalIds ?? null })),
      upstreamPricesFinishes: Array.from(new Set(((upstream.body?.data?.prices ?? upstream.body?.prices ?? [])).map((p) => p.finish))),
      upstreamGradedCount: (upstream.body?.data?.gradedPrices ?? upstream.body?.gradedPrices ?? []).length,
      upstreamGradedSample: (upstream.body?.data?.gradedPrices ?? upstream.body?.gradedPrices ?? []).slice(0, 4),
    })
  }
  evidence.finishedAt = new Date().toISOString()
  saveJson('summary.json', evidence)
  console.log(`\n[probe] total credits used: ${evidence.creditsUsed}`)
  console.log(`[probe] summary written to ${join(OUT_DIR, 'summary.json')}`)
}

main().catch((err) => { console.error('[probe] fatal:', err); process.exit(1) })
