// app/formats/[key]/page.tsx — single-format page.
// Shows what MTGPrices knows factually about the format from
// mtg_oracle_legalities: legal / banned / restricted counts, a preview
// of banned and restricted cards, and entry points into search filtered
// for that format.

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FORMAT_BY_KEY, getFormatCounts, getFormatSpotlight, type FormatKey } from '@/lib/mtg/formats'
import { buildCardSlug } from '@/lib/mtg/cards'
import ManaCost from '@/components/mtg/ManaCost'

export const revalidate = 3600

type Params = { key: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { key } = await params
  const f = FORMAT_BY_KEY[key.toLowerCase()]
  if (!f) return { title: 'Format not found' }
  const canonical = `https://mtgprices.io/formats/${f.key}`
  return {
    title: `${f.label} — MTG format`,
    description: `${f.blurb} Card legality, bans and restrictions for ${f.label} on MTGPrices.io.`,
    alternates: { canonical },
    openGraph: { url: canonical },
  }
}

export default async function FormatPage({ params }: { params: Promise<Params> }) {
  const { key } = await params
  const f = FORMAT_BY_KEY[key.toLowerCase()]
  if (!f) notFound()

  const [counts, banned, restricted] = await Promise.all([
    getFormatCounts(f.key as FormatKey),
    getFormatSpotlight(f.key as FormatKey, 'banned', 60),
    getFormatSpotlight(f.key as FormatKey, 'restricted', 60),
  ])

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 80px' }}>
      <nav aria-label="Breadcrumb" style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/formats" style={{ color: 'inherit' }}>Formats</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <span style={{ color: 'var(--text)' }}>{f.label}</span>
      </nav>

      <div style={{ marginBottom: 20 }}>
        <div className="label-mono" style={{ marginBottom: 6 }}>{f.group} format</div>
        <h1 style={{ margin: 0, fontSize: 32 }}>{f.label}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, marginTop: 8, maxWidth: 720, lineHeight: 1.55 }}>
          {f.blurb}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 28 }}>
        <StatTile label="Legal cards"    value={counts.legal.toLocaleString()} color="var(--green)" />
        <StatTile label="Banned"         value={counts.banned.toLocaleString()} color="var(--red)" />
        <StatTile label="Restricted"     value={counts.restricted.toLocaleString()} color="var(--amber)" />
      </div>

      <SpotlightBlock title={`Banned in ${f.label}`} cards={banned} emptyText={`No cards are currently banned in ${f.label}.`} />
      {restricted.length > 0 && (
        <SpotlightBlock title={`Restricted in ${f.label}`} cards={restricted} emptyText="" />
      )}

      <section style={{ marginTop: 40, padding: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <div className="label-mono" style={{ marginBottom: 6 }}>Explore {f.label} cards</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <Link href={`/card-finder?mode=play&legal=${f.key}`} style={{
            background: 'var(--primary)', color: '#fff',
            padding: '9px 18px', borderRadius: 10, fontWeight: 700, fontSize: 13, textDecoration: 'none',
          }}>Open Card Finder</Link>
          <Link href={`/cards/search?legal=${f.key}`} style={{
            background: 'transparent', color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '8px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13, textDecoration: 'none',
          }}>Catalogue search</Link>
          <Link href="/formats" style={{
            background: 'transparent', color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '8px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13, textDecoration: 'none',
          }}>All formats</Link>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="label-mono" style={{ marginBottom: 6 }}>Popular capabilities in {f.label}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['creature-removal', 'card-draw', 'ramp', 'counter-spell', 'board-wipe', 'tutor', 'token-creation', 'graveyard-interaction'].map((c) => (
              <Link key={c} href={`/card-finder?mode=play&legal=${f.key}&caps=${c}`} style={{
                fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999,
                background: 'var(--primary-soft)', color: 'var(--primary)',
                border: '1px solid rgba(35,95,174,0.25)', textDecoration: 'none',
              }}>
                {c.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ')}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div className="label-mono" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color }}>{value}</div>
    </div>
  )
}

function SpotlightBlock({
  title, cards, emptyText,
}: {
  title: string
  cards: { oracle_card_id: string; name: string; type_line: string | null; mana_cost: string | null; freshest_printing: { set_code: string; collector_number: string | null; image_uri_small: string | null } | null }[]
  emptyText: string
}) {
  return (
    <section style={{ marginTop: 32 }}>
      <div className="label-mono" style={{ marginBottom: 12 }}>{title}</div>
      {cards.length === 0 && emptyText ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{emptyText}</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}>
          {cards.map((c) => {
            const p = c.freshest_printing
            const href = p && p.collector_number
              ? `/set/${p.set_code}/card/${buildCardSlug(p.collector_number, c.name)}`
              : '#'
            return (
              <Link
                key={c.oracle_card_id}
                href={href}
                className="card-hover"
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  padding: 8, background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 10,
                  textDecoration: 'none', color: 'var(--text)',
                }}
              >
                <div style={{ width: 42, aspectRatio: '5/7', flex: 'none', background: 'var(--bg-light)', borderRadius: 4, overflow: 'hidden' }}>
                  {p?.image_uri_small ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_uri_small} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ marginTop: 4 }}>
                    {c.mana_cost && <ManaCost cost={c.mana_cost} size={12} />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.type_line ?? ''}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
