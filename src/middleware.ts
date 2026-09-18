// src/middleware.ts
// Refresh the Supabase session cookie on every request so both server
// components and API routes see a fresh auth token. Does NOT block
// unauthenticated traffic, route protection lives in the individual
// server components that need it.

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
  matcher: [
    // Everything except static assets, images and the metadata routes.
    '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
