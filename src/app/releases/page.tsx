// app/releases/page.tsx
//
// CN-06.06 · Magic: the Gathering release calendar.
//
// Uses the shared Collector Network Hub public feed
// (/api/public/releases/mtg) which only returns
// review_status=approved rows. Operator approval is the only
// path to publication; pending/rejected rows are invisible.

import type { Metadata } from 'next'
import { canonicalFor } from '@/lib/seo'

export const revalidate = 900 // 15-min ISR — matches the Hub feed's s-maxage
export const dynamic = 'force-static'

interface PublicReleaseRow {
  id: string
  tcg: 'mtg'
  site_slug: 'mtg'
  set_name: string
  set_name_translated: string | null
  translation_official: boolean
  set_code: string | null
  product_type: 'expansion' | 'booster' | 'starter_deck' | 'structure_deck'
    | 'special_collection' | 'premium' | 'promo' | 'other'
  language: 'en' | 'ja' | 'other'
  region: string | null
  release_date: string | null
  release_date_precision: 'day' | 'month' | 'quarter' | 'tbc'
  prerelease_date: string | null
  confirmation_status: 'confirmed' | 'announced_tbc' | 'postponed' | 'released'
  source_url: string | null
  site_set_url: string | null
  previous_release_date: string | null
  date_changed_at: string | null
  updated_at: string
}

interface FeedResponse {
  ok: boolean
  tcg: string
  generated_at: string
  counts: { upcoming: number; recently_released: number }
  upcoming: PublicReleaseRow[]
  recently_released: PublicReleaseRow[]
}

function getHubUrl(): string {
  const raw = process.env['NEXT_PUBLIC_HUB_URL'] ?? 'https://collector-network.vercel.app'
  return raw.replace(/\/$/, '')
}

async function fetchReleases(): Promise<FeedResponse | null> {
  try {
    const res = await fetch(`${getHubUrl()}/api/public/releases/mtg`, {
      next: { revalidate: 900, tags: ['releases:mtg'] },
    })
    if (!res.ok) return null
    return (await res.json()) as FeedResponse
  } catch { return null }
}

function formatReleaseLabel(r: Pick<PublicReleaseRow, 'release_date' | 'release_date_precision'>): string {
  if (!r.release_date || r.release_date_precision === 'tbc') return 'TBC'
  if (r.release_date_precision === 'quarter') {
    const m = r.release_date.match(/^(\d{4})-(\d{2})/)
    if (!m) return 'TBC'
    return `Q${Math.floor((Number(m[2]) - 1) / 3) + 1} ${m[1]}`
  }
  const d = new Date(r.release_date + 'T00:00:00Z')
  if (r.release_date_precision === 'month') {
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function daysUntil(r: Pick<PublicReleaseRow, 'release_date' | 'release_date_precision'>): number | null {
  if (!r.release_date || r.release_date_precision !== 'day') return null
  const today = new Date()
  const todayMs = Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z')
  const rMs = Date.parse(r.release_date + 'T00:00:00Z')
  if (!Number.isFinite(rMs) || !Number.isFinite(todayMs)) return null
  return Math.round((rMs - todayMs) / 86_400_000)
}

const PRODUCT_LABEL: Record<PublicReleaseRow['product_type'], string> = {
  expansion: 'Expansion', booster: 'Booster', starter_deck: 'Starter deck',
  structure_deck: 'Structure deck', special_collection: 'Special collection',
  premium: 'Premium set', promo: 'Promo', other: 'Other',
}

export async function generateMetadata(): Promise<Metadata> {
  const feed = await fetchReleases()
  const hasContent = (feed?.counts.upcoming ?? 0) + (feed?.counts.recently_released ?? 0) > 0
  return {
    title: 'MTG release calendar — upcoming Magic sets and Universes Beyond crossovers',
    description:
      'Upcoming Magic: the Gathering releases. Confirmed Wizards dates for expansions, commander products, masterpieces and Universes Beyond crossovers.',
    alternates: { canonical: canonicalFor('/releases') },
    robots: hasContent ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { url: canonicalFor('/releases') },
  }
}

export default async function ReleasesPage() {
  const feed = await fetchReleases()
  const upcoming = feed?.upcoming ?? []
  const recent = feed?.recently_released ?? []
  const hasAny = upcoming.length > 0 || recent.length > 0
  const feedUnavailable = feed === null

  return (
    <main style={{ padding: '32px 24px', maxWidth: 1180, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <div className="label-mono" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Releases · Magic: the Gathering
        </div>
        <h1 style={{ margin: '4px 0 6px', fontSize: 'clamp(24px, 4.5vw, 30px)' }}>Release calendar</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
          Upcoming Magic sets and Universes Beyond crossovers. Dates come from <a href="https://magic.wizards.com/en/products" target="_blank" rel="noopener nofollow">Wizards&apos; official product calendar</a> via operator-approved entries.
        </p>
      </header>

      {feedUnavailable && <Panel tone="warning"><strong>Release feed temporarily unavailable.</strong> The upcoming calendar will return shortly.</Panel>}
      {!feedUnavailable && !hasAny && (
        <Panel>
          <strong>No upcoming releases tracked yet.</strong> We publish release dates once Wizards has confirmed them.
        </Panel>
      )}

      {upcoming.length > 0 && (
        <Section title={`Upcoming (${upcoming.length})`} description="Next 180 days. Postponed entries kept visible so delays stay honest.">
          <ReleaseList rows={upcoming} />
        </Section>
      )}
      {recent.length > 0 && (
        <Section title={`Recently released (${recent.length})`} description="Shipped in the last 30 days.">
          <ReleaseList rows={recent} />
        </Section>
      )}
    </main>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {description && <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Panel({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <div style={{
      background: 'var(--surface, #f9fafb)',
      border: `1px solid ${tone === 'warning' ? '#c9a227' : 'var(--border)'}`,
      borderRadius: 14, padding: 20, fontSize: 14, lineHeight: 1.55,
    }}>{children}</div>
  )
}

function ReleaseList({ rows }: { rows: PublicReleaseRow[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
      {rows.map((r) => <ReleaseCard key={r.id} r={r} />)}
    </ol>
  )
}

function ReleaseCard({ r }: { r: PublicReleaseRow }) {
  const d = daysUntil(r)
  const label = formatReleaseLabel(r)
  const postponed = r.confirmation_status === 'postponed'
  const announcedOnly = r.confirmation_status === 'announced_tbc' || r.release_date_precision === 'tbc'
  return (
    <li style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center',
      padding: '14px 16px', borderRadius: 12,
      background: 'var(--surface, #f9fafb)', border: '1px solid var(--border)',
    }}>
      <div style={{ textAlign: 'center', minWidth: 72 }}>
        <div className="label-mono" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {r.release_date_precision === 'tbc' ? 'Status' : r.release_date_precision === 'quarter' ? 'Quarter' : r.release_date_precision === 'month' ? 'Month' : 'Date'}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{label}</div>
        {d != null && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {d === 0 ? 'today' : d > 0 ? `in ${d}d` : `${Math.abs(d)}d ago`}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {r.set_name}
          {r.set_code && (
            <span className="label-mono" style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              {r.set_code.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <span>{PRODUCT_LABEL[r.product_type] ?? r.product_type}</span>
          {r.region && <><span>·</span><span>{r.region}</span></>}
          {postponed && <span style={{ color: '#c9a227', fontWeight: 600 }}>· Postponed</span>}
          {announcedOnly && !postponed && <span>· Date not yet final</span>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
        {r.source_url && (
          <a href={r.source_url} target="_blank" rel="noopener nofollow" style={{ color: 'var(--text-muted)' }}>
            Source ↗
          </a>
        )}
      </div>
    </li>
  )
}
