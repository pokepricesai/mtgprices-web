// scripts/lib/tcggraph-ingest.mjs
//
// Backwards-compat shim. The real implementation lives at
// src/lib/tcggraph/ingest-core.mjs so both the CLI and the Vercel
// Cron route share exactly one copy. Existing scripts import from
// here; this file just re-exports.

export {
  loadEnv, requireEnv, getSupabase,
  SUPPORTED_GAMES, SCHEDULED_ALLOWLIST,
  BOOTSTRAP_DAILY_RESERVE, PRODUCTION_DAILY_RESERVE, PRODUCTION_MONTHLY_RESERVE,
  FRESHNESS_HEALTHY_HOURS, FRESHNESS_WARNING_HOURS,
  tcgFetch,
  FINISH_ALIAS, normaliseFinish,
  tcgSetId, tcgCardId, tcgPrintingId,
  batchMapMtgCards,
  buildSetRow, buildCardRow, buildPrintingRows,
  buildMarketRows, buildGradedRows, buildExternalIdRows,
  upsertChunked,
} from '../../src/lib/tcggraph/ingest-core.mjs'
