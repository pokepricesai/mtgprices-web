// app/login/page.tsx — sign-in surface. Google OAuth + email magic link.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import LoginClient from './LoginClient'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to MTGPrices to track your collection.',
  alternates: { canonical: `${SITE_URL}/login` },
  openGraph: { url: `${SITE_URL}/login` },
}

type SearchParams = { next?: string; error?: string }

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const user = await getCurrentUser()
  if (user) {
    redirect(sp.next && sp.next.startsWith('/') ? sp.next : '/account')
  }

  return (
    <div style={{ maxWidth: 460, margin: '48px auto', padding: '0 24px' }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>Account</div>
      <h1 style={{ margin: 0, fontSize: 28 }}>Sign in to MTGPrices</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>
        Track your collection, price it against the source of your choice, and (soon) build decks around what you already own.
      </p>
      <LoginClient nextPath={sp.next ?? '/account'} initialError={sp.error} />
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 20, lineHeight: 1.5 }}>
        MTGPrices does not sell your data. We only store what you explicitly add — your collection, decks (later) and preferences. See <a href="/privacy" style={{ color: 'var(--primary)' }}>privacy</a> for details.
      </p>
    </div>
  )
}
