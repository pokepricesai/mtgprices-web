// src/middleware.ts
// Refresh the Supabase session cookie before a Server Component tries
// to read it. Server Components can only READ cookies after render;
// they cannot WRITE a refreshed-token cookie (Next.js constraint, see
// src/lib/supabase/server.ts:29-31). Middleware is the only pre-render
// place that can both read the request cookie and write the response
// cookie, so Supabase SSR relies on it to keep sessions fresh.
//
// Scope note (Phase M1): the matcher is intentionally LIMITED to
// routes that read the Supabase session in their server tree. Public
// catalogue + static pages do not need middleware — Supabase's
// browser client auto-refreshes on authenticated client-side activity
// and Route Handlers (/api/*) can write their own refreshed cookies
// via NextResponse without needing a middleware pass. See the audit
// in commits around 2025-10-05 for the full per-route classification.
//
// If a new Server Component page starts reading `cookies()` or
// `getSupabaseServerClient()`, add its path pattern to the allowlist
// below. Grep for `getCurrentUser|getSupabaseServerClient` across
// `src/app` finds every current session-reader.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Refresh the auth token, this quietly updates the cookie if the
  // access token is close to expiring.
  await supabase.auth.getUser()

  return response
}

export const config = {
  // Explicit auth-sensitive allowlist. Only routes whose server tree
  // reads the Supabase session cookie need middleware refresh:
  //
  //   /auth/callback         writes session on OAuth exchange
  //   /account/*             reads user, redirects anon to /login
  //   /settings/*            reads user, redirects anon to /login
  //   /collection/*          reads user (incl. /collection/import)
  //   /decks/*               reads user (incl. /decks/[id]/test)
  //   /ai                    reads user to switch signed-in UX
  //   /test-deck             reads user to list caller's decks
  //
  // Phase M2 note — `/login` is NO LONGER in this list. The page is
  // now a static shell; the already-signed-in redirect runs
  // client-side via supabase.auth.getSession() in LoginClient. The
  // browser Supabase client auto-refreshes its own session on that
  // check, so no server middleware is needed for /login.
  //
  // Everything else — public catalogue (/, /set/*, /formats/*,
  // /market, /browse, /graded, /insights/*, /card-finder,
  // /cards/search), static pages (/privacy, /terms, /contact),
  // sitemaps, metadata routes, API handlers, admin feature-flagged
  // routes — is deliberately NOT matched. API handlers that need
  // the session persist their own refreshed cookies via NextResponse
  // and do not depend on this middleware.
  //
  // The IndexNow key file rewrite that used to live in this file was
  // moved to next.config.js `rewrites()` so it runs at the CDN edge
  // with no function invocation.
  matcher: [
    '/auth/:path*',
    '/account/:path*',
    '/settings/:path*',
    '/collection/:path*',
    '/decks/:path*',
    '/ai',
    '/test-deck',
  ],
}
