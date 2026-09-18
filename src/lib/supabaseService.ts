// src/lib/supabaseService.ts
// Server-only Supabase client backed by the service-role key.
//
// `import 'server-only'` makes Next.js fail the build if any client
// component or client bundle tries to import this module, that is the
// guard that keeps the service-role key out of the browser.
//
// Credentials are read lazily, only on first use, and never logged.

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
    throw new Error('supabaseService: SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
