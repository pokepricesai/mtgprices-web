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
  // Only allow same-origin `next` targets.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account'
  return NextResponse.redirect(new URL(safeNext, url.origin))
}
