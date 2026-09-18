// src/lib/supabase/browser.ts
// Browser-side Supabase client for auth flows + user-scoped writes.
// Uses the ANON key which is safe to ship, access is gated by RLS.
// Every write against user-scoped tables (mtg_collection_items, etc.)
// runs with the caller's `auth.uid()`.

'use client'

import { createBrowserClient } from '@supabase/ssr'

let cached: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowserClient() {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase browser client: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.')
  }
  cached = createBrowserClient(url, key)
  return cached
}
