// app/account/page.tsx, authenticated user summary.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import SignOutButton from './SignOutButton'
import ValuationBasisPicker from './ValuationBasisPicker'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Account',
  description: 'MTGPrices account overview.',
  alternates: { canonical: `${SITE_URL}/account` },
  openGraph: { url: `${SITE_URL}/account` },
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/account')

  const supabase = await getSupabaseServerClient()
  const [{ count: itemsCount }, { data: prefsRow }] = await Promise.all([
    supabase.from('mtg_collection_items').select('*', { count: 'exact', head: true }),
    supabase.from('mtg_user_prefs').select('*').eq('user_id', user.id).maybeSingle(),
  ])
  const prefs = prefsRow ?? {
    valuation_provider: 'tcgplayer',
    valuation_currency: 'USD',
    valuation_price_type: 'retail',
    valuation_market: 'paper',
  }

  return (
    <div style={{ maxWidth: 780, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono">Account</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>Signed in</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
        {user.email ?? 'no email on file'}
      </p>

      <section style={{
        marginTop: 24, padding: 20, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>Collection</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 15 }}>
            You have <strong style={{ color: 'var(--text)' }}>{(itemsCount ?? 0).toLocaleString()}</strong>{' '}
            distinct printing/condition entries.
          </div>
          <Link href="/collection" style={{
            background: 'var(--primary)', color: '#fff', padding: '8px 14px',
            borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none',
          }}>Open collection →</Link>
        </div>
      </section>

      <section style={{
        marginTop: 16, padding: 20, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>Default valuation basis</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0, marginBottom: 12, lineHeight: 1.55 }}>
          Which provider, currency and price type should power your collection value?
          MTGPrices never silently converts between USD and EUR. You always see the
          exact basis your value was calculated against.
        </p>
        <ValuationBasisPicker current={{
          provider: prefs.valuation_provider,
          currency: prefs.valuation_currency,
          price_type: prefs.valuation_price_type,
          market: prefs.valuation_market,
        }} />
      </section>

      <section style={{ marginTop: 24 }}>
        <SignOutButton />
      </section>
    </div>
  )
}
