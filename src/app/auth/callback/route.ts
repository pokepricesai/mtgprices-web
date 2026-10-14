// src/app/auth/callback/route.ts
// OAuth + magic-link callback endpoint. Exchanges the code/token in the
// URL for a Supabase session cookie, then redirects the user to
// `?next=/some/path` (or /account by default).

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') || '/account'
  const errorDesc = url.searchParams.get('error_description')

  if (errorDesc) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorDesc)}`, url.origin))
  }
  if (!code) {
    return NextResponse.redirect(new URL('/login', url.origin))
  }

  const cookieStore = await cookies()
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createServerClient(projectUrl, anon, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin))
  }

  // CN-03: record MTG site membership so the Collector Network hub
  // can send a site-specific welcome and 7-day onboarding to anyone
  // (including users who originated on PokePrices or YGOPrices) the
  // first time they authenticate on MTGPrices. SECURITY DEFINER RPC;
  // caller user_id is derived from auth.uid() server-side. Failures
  // are non-blocking — authentication must still succeed.
  try {
    await supabase.rpc('record_site_authentication', { p_site_code: 'mtg' })
  } catch {
    // non-fatal; auth already succeeded
  }

  // Only allow same-origin `next` targets.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account'
  return NextResponse.redirect(new URL(safeNext, url.origin))
}
