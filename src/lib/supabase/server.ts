// src/lib/supabase/server.ts
// Server-side Supabase client that reads/writes the session cookie so
// server components can honour the caller's authenticated identity.
// Uses the ANON key — RLS policies enforce access. The service-role
// client (src/lib/supabaseService.ts) is separate and admin-only.

import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function getSupabaseServerClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase server client: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.')
  }
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // set() throws when called from a Server Component after render;
          // the middleware handles refresh so this is safe to ignore here.
        }
      },
    },
  })
}

/** Convenience — returns the currently-authenticated user or null. */
export async function getCurrentUser() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
