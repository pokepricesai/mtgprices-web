#!/usr/bin/env node
// scripts/tcggraph-bootstrap.mjs
//
// Production bootstrap CLI. Resumable, credit-aware, per-game.
// Never activates a Vercel cron. Never exposes the API key.
//
// Slice 5 refactor: the actual refresh pipeline lives in
// src/lib/tcggraph/refresh.mjs and is shared byte-for-byte with
// the Vercel Cron route. This wrapper only owns argv, checkpoints
// and CLI-specific ergonomics.
//
// Usage:
//   node scripts/tcggraph-bootstrap.mjs --game one-piece
//   node scripts/tcggraph-bootstrap.mjs --game disney-lorcana
//   node scripts/tcggraph-bootstrap.mjs --game yugioh
//   node scripts/tcggraph-bootstrap.mjs --game magic-the-gathering [--from-page N] [--max-pages M] [--dry-run] [--resume]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadEnv, requireEnv, getSupabase, SUPPORTED_GAMES,
  PRODUCTION_DAILY_RESERVE, PRODUCTION_MONTHLY_RESERVE } from './lib/tcggraph-ingest.mjs'
import { refreshCatalogue } from '../src/lib/tcggraph/refresh.mjs'

loadEnv()
requireEnv('TCGGRAPH_API_KEY')
requireEnv('NEXT_PUBLIC_SUPABASE_URL')
requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CHECKPOINT_DIR = join(REPO_ROOT, '.tmp', 'tcggraph-bootstrap')
mkdirSync(CHECKPOINT_DIR, { recursive: true })

function arg(name)  { const i = process.argv.indexOf(`--${name}`); if (i < 0) return null; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : null }
function flag(name) { return process.argv.includes(`--${name}`) }

const gameSlug = arg('game')
if (!gameSlug || !SUPPORTED_GAMES[gameSlug]) {
  console.error(`--game must be one of: ${Object.keys(SUPPORTED_GAMES).join(', ')}`)
  process.exit(2)
}
const gameId = SUPPORTED_GAMES[gameSlug]
const FROM_PAGE = Number(arg('from-page') ?? 1)
const MAX_PAGES = Number(arg('max-pages') ?? Infinity)
const DRY_RUN = flag('dry-run')
const RESUME  = flag('resume')

//  Credit safety. The CLI bootstrap now matches the production cron
//  reserves by default (500 daily, 5,000 monthly) - the pre-fix
//  defaults of 100/0 were laxer than intended and could drain daily
//  credits below the production cron's own guardrail, blocking the
//  scheduled MTG/OP/Lorcana refresh. Operators can still opt into
//  aggressive spend explicitly:
//    --daily-reserve N     override daily reserve (>=0)
//    --monthly-reserve N   override monthly reserve (>=0)
const DAILY_RESERVE_OVERRIDE   = arg('daily-reserve')
const MONTHLY_RESERVE_OVERRIDE = arg('monthly-reserve')
const DAILY_RESERVE = DAILY_RESERVE_OVERRIDE == null
  ? PRODUCTION_DAILY_RESERVE
  : Math.max(0, Number(DAILY_RESERVE_OVERRIDE))
const MONTHLY_RESERVE = MONTHLY_RESERVE_OVERRIDE == null
  ? PRODUCTION_MONTHLY_RESERVE
  : Math.max(0, Number(MONTHLY_RESERVE_OVERRIDE))
if (!Number.isFinite(DAILY_RESERVE) || !Number.isFinite(MONTHLY_RESERVE)) {
  console.error(`invalid --daily-reserve or --monthly-reserve; both must be non-negative integers`)
  process.exit(2)
}

const CHECKPOINT_FILE = join(CHECKPOINT_DIR, `${gameId}.cards.full.json`)
function readCheckpoint() { if (!existsSync(CHECKPOINT_FILE)) return null; try { return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8')) } catch { return null } }
function writeCheckpoint(cp) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2)) }

async function main() {
  const sb = getSupabase()
  const cp = RESUME ? readCheckpoint() : null
  const startPage = cp?.next_page ?? FROM_PAGE

  console.log(`[bootstrap] game=${gameId} (${gameSlug})  dry-run=${DRY_RUN}  resume=${RESUME}`)
  console.log(`[bootstrap] start page=${startPage}  max pages=${MAX_PAGES === Infinity ? 'unlimited' : MAX_PAGES}  daily reserve=${DAILY_RESERVE}  monthly reserve=${MONTHLY_RESERVE}`)

  const result = await refreshCatalogue({
    gameSlug, sb,
    source: 'bootstrap',
    fromPage: startPage,
    maxPages: MAX_PAGES,
    dryRun: DRY_RUN,
    //  Production reserves by default. Overridable via CLI flags for
    //  operator scenarios that intentionally drain credits (e.g. a
    //  full bootstrap on a new game outside the cron cadence).
    dailyReserve:   DAILY_RESERVE,
    monthlyReserve: MONTHLY_RESERVE,
    logger: { info: (m, x) => console.log('[bootstrap]', m, x ?? {}), warn: (m, x) => console.warn('[bootstrap]', m, x ?? {}), error: (m, x) => console.error('[bootstrap]', m, x ?? {}) },
    //  Preflight ON so we refuse to start a run that would breach the
    //  daily reserve. Was off before, which is how the previous YGO
    //  bootstrap ran below the intended guardrail.
    preflightCredits: true,
  })

  writeCheckpoint({
    game_id: gameId,
    resource: 'cards.full',
    run_id: result.runId ?? null,
    next_page: result.stopReason === 'catalogue_exhausted' || result.stopReason === 'no_more_data' ? null : (result.lastPage ?? startPage) + 1,
    finished_at: result.finishedAt,
    status: result.status,
    result,
  })

  console.log('\n[bootstrap] === DONE ===')
  console.log(`  status:               ${result.status}`)
  console.log(`  stop reason:          ${result.stopReason}`)
  console.log(`  last page completed:  ${result.lastPage}`)
  console.log(`  next page on resume:  ${result.stopReason === 'catalogue_exhausted' ? '(none, done)' : (result.lastPage ?? startPage) + 1}`)
  console.log(`  rows fetched:         ${result.rowsFetched}`)
  console.log(`  credits used:         ${result.creditsUsed}`)
  console.log(`  daily remaining:      ${result.credits?.dailyRemaining}`)
  console.log(`  monthly remaining:    ${result.credits?.monthlyRemaining}`)
  console.log(`  market rows upserted: ${result.marketRowsUpserted}`)
  console.log(`  graded rows upserted: ${result.gradedRowsUpserted}`)
  console.log(`  mapping counts:       ${JSON.stringify(result.mappingCounts)}`)
  console.log(`  checkpoint:           ${CHECKPOINT_FILE}`)
}

main().catch((err) => { console.error('[bootstrap] FATAL:', err.message); process.exit(1) })
