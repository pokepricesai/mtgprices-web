// src/lib/supabaseService.ts
// Server-only Supabase client backed by the service-role key.
//
// `import 'server-only'` makes Next.js fail the build if any client
// component or client bundle tries to import this module, that is the
// guard that keeps the service-role key out of the browser.
//
// Credentials are read lazily, only on first use, and never logged.
//
// Preview fallback: Vercel Preview deployments intentionally do NOT
// carry SUPABASE_SERVICE_ROLE_KEY (Pass 2A decision — Production
// credentials must not leak into more-discoverable Preview URLs).
// When VERCEL_ENV='preview' AND service-role is missing AND the
// public anon key IS present, this module returns a client built
// from the anon key instead of throwing. That gives Preview enough
// permission to render public pages (sets, oracle catalogue) while
// RLS-locked surfaces (mtg_current_prices, mtg_price_observations)
// naturally return empty results — safe defaults for a noindex
// Preview. Production runs with VERCEL_ENV='production' and always
// takes the full service-role path. NEVER fall back on Production.

import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getSupabaseServiceClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    // Do not include key presence/absence in error messages beyond the
    // env-var name itself, to avoid leaking shape information.
    throw new Error('supabaseService: NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!key) {
    // Preview-only fallback to the anon key. See file header.
    const isPreview = process.env.VERCEL_ENV === 'preview'
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (isPreview && anonKey) {
      cached = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { 'x-mtgprices-preview-fallback': '1' } },
      })
      return cached
    }
    throw new Error('supabaseService: SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
