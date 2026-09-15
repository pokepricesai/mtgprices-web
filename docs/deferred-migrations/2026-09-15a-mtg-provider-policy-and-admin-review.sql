-- ============================================================================
-- STATUS: DEFERRED — DO NOT APPLY
-- ============================================================================
--
-- This file is a design draft written during Stage 1D planning and was
-- explicitly REJECTED from the approved Stage 1D scope. It is retained
-- as a design record only. It must NOT be run against production.
--
-- Location: docs/deferred-migrations/ (deliberately outside migrations/).
--
-- If any of these ideas is revived in a later phase, promote it to a
-- new file under migrations/ with a fresh date + serial, do not simply
-- move this file back.
-- ============================================================================

-- migrations/2026-09-15a-mtg-provider-policy-and-admin-review.sql
-- ============================================================================
-- Stage 1D — provider policy + admin review queue + anomaly-flag infrastructure.
-- Additive, non-destructive. Idempotent via IF NOT EXISTS + DO-blocks.
-- ============================================================================
--
-- Why
--   Stage 1C loaded 63.3 M raw provider price observations across five
--   providers. Public exposure of those observations is NOT uniform:
--   TCGplayer + Cardmarket TOS prohibit commercial republication without
--   written permission; Cardhoarder + CardKingdom + ManaPool require
--   independent per-provider policy decisions.
--
--   This migration introduces mtg_provider_policies — a single source of
--   truth for whether each provider may be ingested, used internally,
--   used in derived calculations (canonical daily price), displayed
--   publicly and/or attributed publicly. Every downstream feature
--   (canonical derivation, public price displays, deck valuation, AI
--   context assembly) MUST consult this table.
--
-- Design
--   * Row per provider identifier as MTGJSON / Scryfall emits it
--     (verbatim string, not enumerated at the type level).
--   * Five orthogonal boolean flags — safe defaults are TRUE for
--     ingest_enabled and internal_use (so we do not silently stop
--     ingesting), FALSE for everything else (so we do not silently
--     publish a provider whose TOS we have not vetted).
--   * canonical_source is a derived flag used by the canonical daily
--     history methodology (public canonical values only draw from
--     providers where derived_use_public=true).
--   * public_attribution_url + public_attribution_label are stored
--     so on-site attribution never has to be hard-coded in the
--     frontend.
--   * legal_review_status + legal_review_notes track the human
--     decision trail. last_reviewed_at is bumped by the admin.
--
-- Downstream consumers
--   * daily pipeline reads ingest_enabled to decide whether to persist
--     an observation.
--   * canonical derivation reads derived_use_public (public series) and
--     derived_use_internal (internal series).
--   * card-page and public API layers read public_display + attribution.
--
-- Idempotency
--   * CREATE TABLE IF NOT EXISTS.
--   * Seed rows via INSERT … ON CONFLICT (provider) DO NOTHING.
--   * ALTER … ADD COLUMN IF NOT EXISTS guarded by information_schema.
--
-- ============================================================================

BEGIN;

-- ─── mtg_provider_policies ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_provider_policies (
  provider                    TEXT PRIMARY KEY,

  ingest_enabled              BOOLEAN NOT NULL DEFAULT true,
  internal_use                BOOLEAN NOT NULL DEFAULT true,
  derived_use_internal        BOOLEAN NOT NULL DEFAULT true,
  derived_use_public          BOOLEAN NOT NULL DEFAULT false,
  public_display              BOOLEAN NOT NULL DEFAULT false,
  public_attribution_required BOOLEAN NOT NULL DEFAULT true,

  public_attribution_label    TEXT,
  public_attribution_url      TEXT,

  legal_review_status         TEXT NOT NULL DEFAULT 'unverified'
                              CHECK (legal_review_status IN (
                                'unverified','under_review','permitted',
                                'restricted','prohibited'
                              )),
  legal_review_notes          TEXT,
  last_reviewed_at            TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.mtg_provider_policies IS 'Per-provider ingest / internal / derived / public / attribution policy. Single source of truth for legal + display gating.';
COMMENT ON COLUMN public.mtg_provider_policies.ingest_enabled        IS 'Whether the daily pipeline should persist observations from this provider.';
COMMENT ON COLUMN public.mtg_provider_policies.internal_use          IS 'Whether raw observations may be joined by internal (non-public) reasoning — AI context, analytics, private admin tools.';
COMMENT ON COLUMN public.mtg_provider_policies.derived_use_internal  IS 'Whether this provider contributes to INTERNAL canonical-price derivations.';
COMMENT ON COLUMN public.mtg_provider_policies.derived_use_public    IS 'Whether this provider contributes to PUBLIC canonical-price derivations shown on card pages / public APIs.';
COMMENT ON COLUMN public.mtg_provider_policies.public_display        IS 'Whether raw provider prices from this source may be shown directly on public pages (with attribution).';
COMMENT ON COLUMN public.mtg_provider_policies.legal_review_status   IS 'Explicit legal review state. Public rendering must NOT display or derive-from a provider whose status is not permitted.';

-- ─── Seed rows (safe defaults) ──────────────────────────────────────────────
-- ingest_enabled = TRUE (do not silently stop ingest)
-- internal_use   = TRUE (data is fine to hold + reason over internally)
-- everything else = FALSE until Luke explicitly reviews.
--
-- These seeds reflect the licensing findings from the Phase 1 audit:
--   * tcgplayer  → restricted (their TOS prohibits redistribution)
--   * cardmarket → restricted (their TOS requires written agreement)
--   * cardkingdom, manapool, cardhoarder → unverified, no public display until reviewed
--
-- Rows are only inserted if they do not exist; running this migration a
-- second time does not overwrite a curated decision.

INSERT INTO public.mtg_provider_policies (
  provider, ingest_enabled, internal_use,
  derived_use_internal, derived_use_public,
  public_display, public_attribution_required,
  public_attribution_label, public_attribution_url,
  legal_review_status, legal_review_notes
) VALUES
  ('tcgplayer',   true, true, true, false, false, true,
    'TCGplayer', 'https://www.tcgplayer.com',
    'restricted',
    'TCGplayer TOS prohibits redistribution of pricing content for commercial or competitive purposes. Do NOT display publicly until written permission via TCGplayer Affiliate Program is obtained.'),

  ('cardmarket',  true, true, true, false, false, true,
    'Cardmarket', 'https://www.cardmarket.com',
    'restricted',
    'Cardmarket TOS: "presentation of trading cards and their respective prices requires prior written agreement." Do NOT display publicly until written agreement is obtained.'),

  ('cardkingdom', true, true, true, false, false, true,
    'Card Kingdom', 'https://www.cardkingdom.com',
    'unverified',
    'No official Card Kingdom API. MTGJSON scrapes their public price sheets. Grey area — hold internal but do not publicly display until reviewed.'),

  ('manapool',    true, true, true, false, false, true,
    'ManaPool', 'https://manapool.com',
    'unverified',
    'Newer marketplace; TOS not yet reviewed. Hold internal but do not publicly display until reviewed.'),

  ('cardhoarder', true, true, true, false, false, true,
    'Cardhoarder', 'https://www.cardhoarder.com',
    'unverified',
    'MTGO-only. Historically permissive redistribution but current terms not confirmed. Do not publicly display until reviewed.')
ON CONFLICT (provider) DO NOTHING;

-- ─── updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mtg_provider_policies_bump_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mtg_provider_policies_touch ON public.mtg_provider_policies;
CREATE TRIGGER mtg_provider_policies_touch
  BEFORE UPDATE ON public.mtg_provider_policies
  FOR EACH ROW EXECUTE FUNCTION public.mtg_provider_policies_bump_updated_at();

-- ─── RLS: public read on the safe columns only ──────────────────────────────
ALTER TABLE public.mtg_provider_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mtg_provider_policies_read ON public.mtg_provider_policies;
CREATE POLICY mtg_provider_policies_read
  ON public.mtg_provider_policies
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ─── mtg_admin_review — queue of new/updated entities awaiting approval ────
CREATE TABLE IF NOT EXISTS public.mtg_admin_review (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type    TEXT NOT NULL CHECK (entity_type IN (
                    'set','oracle_card','printing','printing_finish','provider'
                  )),
  entity_id      UUID,
  entity_natural_key TEXT,
  reason         TEXT NOT NULL,
  payload        JSONB,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending','approved','rejected','deferred'
                  )),
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  review_notes   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mtg_admin_review IS 'Queue of new / updated MTG entities awaiting admin approval. Public indexability defers to this queue for auto-detected entities.';

CREATE INDEX IF NOT EXISTS mtg_admin_review_status_idx
  ON public.mtg_admin_review (status, created_at DESC);
CREATE INDEX IF NOT EXISTS mtg_admin_review_entity_idx
  ON public.mtg_admin_review (entity_type, entity_id);

ALTER TABLE public.mtg_admin_review ENABLE ROW LEVEL SECURITY;
-- No public read policy; admin_review is admin-only (service role writes/reads).

-- ─── mtg_price_anomaly_flags — anomaly details when is_anomalous flips ─────
-- The observation row already has is_anomalous BOOLEAN. This side table
-- carries the reasoning so we can audit and un-flag without losing why.
CREATE TABLE IF NOT EXISTS public.mtg_price_anomaly_flags (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id       BIGINT NOT NULL,
  observed_on          DATE NOT NULL,
  detector_version     TEXT NOT NULL,
  rule                 TEXT NOT NULL,
  severity             TEXT NOT NULL CHECK (severity IN ('info','warn','error')),
  prev_price           NUMERIC(14, 4),
  curr_price           NUMERIC(14, 4),
  ratio                NUMERIC(10, 4),
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at           TIMESTAMPTZ,
  cleared_reason       TEXT,
  UNIQUE (observation_id, rule)
);

COMMENT ON TABLE public.mtg_price_anomaly_flags IS 'One row per anomaly rule triggered on a given observation. Companion to mtg_price_observations.is_anomalous.';

CREATE INDEX IF NOT EXISTS mtg_price_anomaly_flags_observed_on_idx
  ON public.mtg_price_anomaly_flags (observed_on DESC);
CREATE INDEX IF NOT EXISTS mtg_price_anomaly_flags_open_idx
  ON public.mtg_price_anomaly_flags (severity) WHERE cleared_at IS NULL;

ALTER TABLE public.mtg_price_anomaly_flags ENABLE ROW LEVEL SECURITY;
-- No public read; admin/service role only.

-- ─── Post-condition sanity ──────────────────────────────────────────────────
DO $$
DECLARE
  n_policies int;
BEGIN
  SELECT COUNT(*) INTO n_policies FROM public.mtg_provider_policies;
  IF n_policies < 5 THEN
    RAISE EXCEPTION 'expected at least 5 provider policies, got %', n_policies;
  END IF;
  RAISE NOTICE 'provider policies present: %', n_policies;
END $$;

COMMIT;
