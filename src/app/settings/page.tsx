// app/settings/page.tsx, editable user settings.
//
// Sections:
//   Profile           display name + avatar picker
//   Pricing           reuses the existing ValuationBasisPicker
//   Account           email + sign-out
//   Danger zone       delete MTGPrices profile
//
// Reuses the existing mtg_user_prefs table for pricing. Profile data
// lives in mtg_user_profiles. Deleting the profile is a separate API
// route that never touches auth.users because that identity is shared
// with Poképrices.

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import { getOrCreateMyProfile, oauthImageUrl } from '@/lib/mtg/profile'
import ProfileEditor from './ProfileEditor'
import ValuationBasisPicker from '../account/ValuationBasisPicker'
import SignOutButton from '../account/SignOutButton'
import DeleteProfileForm from './DeleteProfileForm'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'MTGPrices settings.',
  alternates: { canonical: `${SITE_URL}/settings` },
  openGraph: { url: `${SITE_URL}/settings` },
  robots: { index: false, follow: false },
}

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/settings')

  const supabase = await getSupabaseServerClient()
  const [profile, { data: prefsRow }] = await Promise.all([
    getOrCreateMyProfile(),
    supabase.from('mtg_user_prefs').select('*').eq('user_id', user.id).maybeSingle(),
  ])
  const prefs = prefsRow ?? {
    valuation_provider: 'tcgplayer',
    valuation_currency: 'USD',
    valuation_price_type: 'retail',
    valuation_market: 'paper',
  }

  const googleImage = oauthImageUrl(user)

  return (
    <div style={{ maxWidth: 780, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono">Settings</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28, color: 'var(--text-strong)' }}>Settings</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 6, lineHeight: 1.55 }}>
        Manage your MTGPrices profile, default pricing basis and account controls.
      </p>

      {/* Profile */}
      <section id="profile" style={{
        marginTop: 22, padding: 22, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Profile</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Your display name and avatar</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Shown in the top navigation and next to any public content you produce. The Google
          option uses the photo attached to your Google sign in when available.
        </p>
        <div style={{ marginTop: 16 }}>
          <ProfileEditor
            initialDisplayName={profile?.display_name ?? ''}
            initialAvatarKey={profile?.avatar_key ?? 'gem-arcane'}
            googleImageUrl={googleImage}
          />
        </div>
      </section>

      {/* Pricing preferences */}
      <section id="pricing" style={{
        marginTop: 18, padding: 22, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Pricing preferences</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Default valuation basis</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Which provider, currency and price type should power your collection and deck values?
          MTGPrices never silently converts between USD and EUR: you always see the exact basis
          your value was calculated against.
        </p>
        <div style={{ marginTop: 14 }}>
          <ValuationBasisPicker current={{
            provider: prefs.valuation_provider,
            currency: prefs.valuation_currency,
            price_type: prefs.valuation_price_type,
            market: prefs.valuation_market,
          }} />
        </div>
      </section>

      {/* Account */}
      <section id="account" style={{
        marginTop: 18, padding: 22, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Account</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Sign in and identity</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Your sign in identity is shared with our sibling site Poképrices. Changing your Google
          account, name or photo on Google will reflect here on next sign in.
        </p>
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}>
          <div><strong>Email</strong> {user.email ?? 'no email on file'}</div>
        </div>
        <div style={{ marginTop: 14 }}>
          <SignOutButton />
        </div>
      </section>

      {/* Danger zone */}
      <section id="danger" style={{
        marginTop: 18, padding: 22, background: 'var(--surface)',
        border: '1px solid var(--red-soft)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--red)' }}>Danger zone</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Delete MTGPrices profile</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Deletes your MTGPrices decks, collection, preferences, AI history and profile data.
          It does not delete your shared sign in account or your Poképrices data.
        </p>
        <div style={{ marginTop: 14 }}>
          <DeleteProfileForm />
        </div>
      </section>
    </div>
  )
}
