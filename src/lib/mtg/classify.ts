// src/lib/mtg/classify.ts
//
// Thin re-export shim for the UI. The taxonomy + classifier live in
// ./capabilities.ts, that is the single source of truth used by both
// the Next.js app and the backfill scripts.

export {
  classify as classifyCard,
  labelForCapability,
  CAPABILITY_TAGS,
  CAPABILITY_LABELS,
  SEARCHABLE_CAPABILITIES,
  TYPE_CAPABILITIES,
  type CardCapability,
  type ClassifyInput,
} from './capabilities'
