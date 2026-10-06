// app/login/page.tsx, sign-in surface. Google OAuth + email magic link.
//
// Phase M2: static shell. This Server Component performs NO session
// read and NO server-side redirect. The already-signed-in redirect
// used to live here as `await getCurrentUser()` → `redirect(next)`,
// which forced the page to be Dynamic and ran a Supabase auth
// round-trip on every anon crawler hit (~2.6K serverless/hr
// observed pre-fix).
//
// The redirect for signed-in users now runs client-side in
// LoginClient on hydration (checks the browser Supabase session, then
// router.replace to the validated `next` target). Validation stays
// strict — same rule the previous server-side redirect used, plus
// defence against `//evil.com`-style open-redirect vectors.
//
// Suspense is required so LoginClient's useSearchParams() does not
// opt the whole route back into Dynamic.

import type { Metadata } from 'next'
import { Suspense } from 'react'
import LoginClient from './LoginClient'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to MTGPrices to track your collection.',
  alternates: { canonical: `${SITE_URL}/login` },
  openGraph: { url: `${SITE_URL}/login` },
  robots: { index: false, follow: true },
}

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 460, margin: '48px auto', padding: '0 24px' }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>Account</div>
      <h1 style={{ margin: 0, fontSize: 28 }}>Sign in to MTGPrices</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>
        Track your collection, price it against the source of your choice, and (soon) build decks around what you already own.
      </p>
      <Suspense fallback={null}>
        <LoginClient />
      </Suspense>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 20, lineHeight: 1.5 }}>
        MTGPrices does not sell your data. We only store what you explicitly add: your collection, decks (later) and preferences. See <a href="/privacy" style={{ color: 'var(--primary)' }}>privacy</a> for details.
      </p>
    </div>
  )
}
