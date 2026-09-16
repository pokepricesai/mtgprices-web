// app/formats/page.tsx — MTG formats index.
// Only shows formats present in mtg_oracle_legalities. Per-format legal /
// banned / restricted counts are queried lazily via getFormatCounts.

import Link from 'next/link'
import type { Metadata } from 'next'
import { FORMATS, FORMAT_GROUPS, getFormatCounts, type FormatDef } from '@/lib/mtg/formats'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'MTG formats',
  description: 'Every Magic: The Gathering format we index — Standard, Modern, Legacy, Vintage, Commander, Pauper and more. Legality, bans and card discovery for each.',
  alternates: { canonical: 'https://mtgprices.io/formats' },
  openGraph: { url: 'https://mtgprices.io/formats' },
}

type FormatCard = FormatDef & { legal: number; banned: number; restricted: number }

export default async function FormatsIndex() {
  const enriched: FormatCard[] = await Promise.all(
    FORMATS.map(async (f) => {
      const c = await getFormatCounts(f.key)
      return { ...f, ...c }
    })
  )

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 80px' }}>
      <div style={{ marginBottom: 24 }}>
        <div className="label-mono" style={{ marginBottom: 6 }}>Play</div>
        <h1 style={{ margin: 0, fontSize: 30 }}>MTG formats</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 15, maxWidth: 720 }}>
          Every format we have legality data for. Counts are derived directly from Scryfall's legality feed —
          bans and restrictions update as Wizards publishes them.
        </p>
      </div>

      {FORMAT_GROUPS.map((group) => {
        const items = enriched.filter((f) => f.group === group)
        if (items.length === 0) return null
        return (
          <section key={group} style={{ marginTop: 28 }}>
            <div className="label-mono" style={{ marginBottom: 10 }}>{group} formats</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {items.map((f) => (
                <Link
                  key={f.key}
                  href={`/formats/${f.key}`}
                  className="card-hover"
                  style={{
                    display: 'block', background: 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: 12,
                    padding: 16, textDecoration: 'none', color: 'var(--text)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{f.label}</h2>
                    <span style={{
                      fontSize: 11, color: 'var(--text-muted)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}>{f.key}</span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.5, minHeight: 40 }}>
                    {f.blurb}
                  </p>
                  <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span><strong style={{ color: 'var(--green)' }}>{f.legal.toLocaleString()}</strong> legal</span>
                    {f.banned > 0 && <span><strong style={{ color: '#f2a9ae' }}>{f.banned}</strong> banned</span>}
                    {f.restricted > 0 && <span><strong style={{ color: '#f2d68a' }}>{f.restricted}</strong> restricted</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
