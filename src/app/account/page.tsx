// app/account/page.tsx, authenticated user summary.
//
// Overview page. Shows the profile identity and a compact activity
// summary. Editable preferences live on /settings.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import { getOrCreateMyProfile, oauthImageUrl } from '@/lib/mtg/profile'
import Avatar from '@/components/mtg/Avatar'

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
  const [profile, itemsRes, decksRes] = await Promise.all([
    getOrCreateMyProfile(),
    supabase.from('mtg_collection_items').select('*', { count: 'exact', head: true }),
    supabase.from('mtg_decks').select('*', { count: 'exact', head: true }),
  ])
  const items = itemsRes.count ?? 0
  const decks = decksRes.count ?? 0
  const googleImage = oauthImageUrl(user)
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : (user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : null)

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono">Account</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28, color: 'var(--text-strong)' }}>
        {profile?.display_name || 'Your account'}
      </h1>

      <section style={{
        marginTop: 22, padding: 22,
        background: 'linear-gradient(180deg, rgba(232,169,75,0.06) 0%, rgba(232,169,75,0) 60%), var(--surface)',
        border: '1px solid var(--border)', borderRadius: 16,
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
      }}>
        <Avatar avatarKey={profile?.avatar_key ?? 'gem-arcane'} googleImageUrl={googleImage} size={72} />
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>
            {profile?.display_name || 'Set a display name'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {user.email ?? 'no email on file'}
          </div>
          {joined && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Joined {joined}
            </div>
          )}
        </div>
        <Link href="/settings" className="btn btn-sm btn-ghost">Edit profile</Link>
      </section>

      <div style={{
        marginTop: 18, display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}>
        <SummaryCard
          label="Collection"
          value={items.toLocaleString()}
          sub={`${items === 1 ? 'distinct entry' : 'distinct entries'} tracked`}
          href="/collection"
          cta="Open collection"
        />
        <SummaryCard
          label="Decks"
          value={decks.toLocaleString()}
          sub={`${decks === 1 ? 'deck' : 'decks'} saved`}
          href="/decks"
          cta="Open decks"
        />
      </div>

      <section style={{
        marginTop: 18, padding: 20,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>Quick links</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/settings" className="btn btn-sm btn-ghost">Settings</Link>
          <Link href="/ai" className="btn btn-sm btn-ghost">Ask MTGPrices AI</Link>
          <Link href="/market" className="btn btn-sm btn-ghost">Market movers</Link>
          <Link href="/insights" className="btn btn-sm btn-ghost">Insights</Link>
        </div>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, sub, href, cta }: {
  label: string
  value: string
  sub: string
  href: string
  cta: string
}) {
  return (
    <div style={{
      padding: 18, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
    }}>
      <div className="label-mono">{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 800, color: 'var(--text-strong)',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
      <div style={{ marginTop: 4 }}>
        <Link href={href} className="btn btn-sm btn-primary">{cta}</Link>
      </div>
    </div>
  )
}
