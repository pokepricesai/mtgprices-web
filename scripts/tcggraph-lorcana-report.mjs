#!/usr/bin/env node
// scripts/tcggraph-lorcana-report.mjs
//
// Slice 4 Phase H + J. Read-only analysis of Lorcana data now that
// bootstrap has completed. Reports:
//   - catalogue counts (sets, cards, printings)
//   - premium-treatment counts by rarity
//   - Lorcana-specific field coverage (gameData keys)
//   - actual slabbed graded coverage (grader != 'raw'), DISTINCT
//     printings, not row counts
//   - graders + grades observed
//   - representative high-value slabbed cards
//   - market-price source enumeration + region + currency + finish

import { loadEnv, getSupabase } from './lib/tcggraph-ingest.mjs'
loadEnv()

// PostgREST default limit is 1000. We paginate manually.
async function selectAll(qb) {
  const PAGE = 1000
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await qb.range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

async function main() {
  const sb = getSupabase()
  const gid = 'lorcana'

  // Catalogue.
  const [sets, cards, printings] = await Promise.all([
    sb.from('tcg_sets').select('*', { count: 'exact', head: true }).eq('game_id', gid),
    sb.from('tcg_cards').select('*', { count: 'exact', head: true }).eq('game_id', gid),
    sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', gid),
  ])
  console.log('LORCANA - Slice 4 report')
  console.log('=======================')
  console.log(`sets:                ${sets.count ?? 0}`)
  console.log(`logical cards:       ${cards.count ?? 0}`)
  console.log(`physical printings:  ${printings.count ?? 0}`)

  // Rarity distribution + treatment-tier counts.
  const rarity = await selectAll(sb.from('tcg_cards').select('rarity').eq('game_id', gid).not('rarity', 'is', null))
  const rc = new Map()
  for (const r of rarity ?? []) rc.set(r.rarity, (rc.get(r.rarity) ?? 0) + 1)
  console.log('\nrarity distribution (logical-card level):')
  for (const [k, v] of [...rc].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)

  // Finish distribution (printing-level).
  const fin = await selectAll(sb.from('tcg_printings').select('finish, tcggraph_printing_key').eq('game_id', gid))
  const fc = new Map()
  for (const r of fin ?? []) fc.set(r.tcggraph_printing_key, (fc.get(r.tcggraph_printing_key) ?? 0) + 1)
  console.log('\nprinting-key distribution:')
  for (const [k, v] of [...fc].sort((a, b) => b[1] - a[1])) console.log(`  ${(k ?? '(null)').padEnd(14)} ${v}`)

  // Lorcana-specific gameData key coverage.
  const gd = await selectAll(sb.from('tcg_cards').select('gamedata').eq('game_id', gid))
  const keyCount = new Map()
  const inkCount = new Map()
  const typeCount = new Map()
  for (const row of gd ?? []) {
    const g = row.gamedata ?? {}
    for (const k of Object.keys(g)) keyCount.set(k, (keyCount.get(k) ?? 0) + 1)
    if (g.ink) inkCount.set(g.ink, (inkCount.get(g.ink) ?? 0) + 1)
    if (g.cardType) typeCount.set(g.cardType, (typeCount.get(g.cardType) ?? 0) + 1)
  }
  console.log('\nLorcana-specific gameData field coverage:')
  for (const [k, v] of [...keyCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v} / ${cards.count}`)
  console.log('\nink colours:')
  for (const [k, v] of [...inkCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
  console.log('\ncard types:')
  for (const [k, v] of [...typeCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)

  // Market-price source enumeration.
  const mkt = await selectAll(sb.from('tcg_market_prices_current').select('source, currency, region, list_type, finish, price').eq('game_id', gid))
  const bySource = new Map()
  const byCurrency = new Map()
  const byRegion = new Map()
  const byListType = new Map()
  const byFinish = new Map()
  for (const r of mkt ?? []) {
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + 1)
    byRegion.set(r.region ?? '(null)', (byRegion.get(r.region ?? '(null)') ?? 0) + 1)
    byListType.set(r.list_type, (byListType.get(r.list_type) ?? 0) + 1)
    byFinish.set(r.finish ?? '(null)', (byFinish.get(r.finish ?? '(null)') ?? 0) + 1)
  }
  console.log('\nmarket rows: ' + (mkt?.length ?? 0))
  console.log('\nmarket sources:')
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`)
  console.log('\ncurrencies:')
  for (const [k, v] of [...byCurrency].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
  console.log('\nregions:')
  for (const [k, v] of [...byRegion].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
  console.log('\nlist types:')
  for (const [k, v] of [...byListType].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
  console.log('\nfinishes (market row finish column):')
  for (const [k, v] of [...byFinish].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)

  // Graded coverage.  Must exclude grader='raw' per spec: raw != slab.
  const graded = await selectAll(sb.from('tcg_graded_prices_current').select('tcg_printing_id, grader, grade, price').eq('game_id', gid))
  const slabRows = (graded ?? []).filter((g) => g.grader !== 'raw')
  const rawRows  = (graded ?? []).filter((g) => g.grader === 'raw')
  const distinctSlab = new Set(slabRows.map((g) => g.tcg_printing_id))
  const distinctRaw  = new Set(rawRows.map((g) => g.tcg_printing_id))
  const graderCount = new Map()
  const gradeCount = new Map()
  for (const g of slabRows) {
    graderCount.set(g.grader, (graderCount.get(g.grader) ?? 0) + 1)
    gradeCount.set(g.grade,   (gradeCount.get(g.grade) ?? 0) + 1)
  }
  console.log('\n=== Graded coverage (slabbed = grader != raw) ===')
  console.log(`slabbed rows:                    ${slabRows.length}`)
  console.log(`distinct slabbed printings:      ${distinctSlab.size} / ${printings.count ?? 0}  (${((distinctSlab.size / (printings.count || 1)) * 100).toFixed(2)}%)`)
  console.log(`raw rows:                        ${rawRows.length}`)
  console.log(`distinct raw-quoted printings:   ${distinctRaw.size}`)
  console.log('\nslabbed grader distribution (rows):')
  for (const [k, v] of [...graderCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(6)} ${v}`)
  console.log('\nslabbed grade distribution (rows):')
  for (const [k, v] of [...gradeCount].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(6)} ${v}`)

  // Representative high-value slabbed cards.
  console.log('\nrepresentative high-value slabbed Lorcana printings:')
  const topRows = slabRows.filter((g) => g.grade === '10' && g.grader !== 'any').slice(0)
  topRows.sort((a, b) => Number(b.price) - Number(a.price))
  const topIds = Array.from(new Set(topRows.slice(0, 20).map((r) => r.tcg_printing_id))).slice(0, 10)
  if (topIds.length > 0) {
    const { data: byId } = await sb.from('tcg_printings')
      .select('id, tcggraph_card_id, tcggraph_printing_key, collector_number, set_id')
      .in('id', topIds)
    const cardIds = Array.from(new Set(byId.map((p) => p.tcggraph_card_id)))
    const { data: cardMeta } = await sb.from('tcg_cards')
      .select('tcggraph_card_id, name, rarity')
      .eq('game_id', gid)
      .in('tcggraph_card_id', cardIds)
    const cardMap = new Map(cardMeta.map((c) => [c.tcggraph_card_id, c]))
    const priceByPrint = new Map()
    for (const r of topRows) if (topIds.includes(r.tcg_printing_id) && !priceByPrint.has(r.tcg_printing_id)) priceByPrint.set(r.tcg_printing_id, r)
    for (const p of byId) {
      const c = cardMap.get(p.tcggraph_card_id)
      const top = priceByPrint.get(p.id)
      const setCode = (p.set_id ?? '').split(':').slice(-1)[0]
      console.log(`  set=${setCode.padEnd(5)}  cn=${(p.collector_number ?? '').padEnd(5)}  ${c?.rarity ?? '?'.padEnd(10)}  ${c?.name?.slice(0, 40).padEnd(40)}  finish=${p.tcggraph_printing_key.padEnd(6)}  top-slab=${top?.grader}-${top?.grade}=$${top?.price}`)
    }
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
