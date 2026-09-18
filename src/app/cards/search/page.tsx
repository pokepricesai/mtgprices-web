// app/cards/search/page.tsx, MTGPrices multi-filter card search.
// Every filter maps to indexed DB columns (name/type/color/legality/rarity).
// Oracle-text search hits an ilike scan on ~40k rows and is bounded to
// 300 candidates before printings lookup, which keeps latency reasonable.

import Link from 'next/link'
import type { Metadata } from 'next'
import { searchCards, buildCardSlug } from '@/lib/mtg/cards'
import { FORMATS } from '@/lib/mtg/formats'
import ManaCost from '@/components/mtg/ManaCost'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Search cards',
  description: 'Search MTG cards by name, type, Oracle text, colour, colour identity, format legality and rarity.',
  alternates: { canonical: 'https://mtgprices.io/cards/search' },
  openGraph: { url: 'https://mtgprices.io/cards/search' },
}

type SearchParams = {
  q?: string
  type?: string
  text?: string
  color?: string | string[]
  identity?: string | string[]
  colorless?: string
  legal?: string
  rarity?: string
}

const COLOR_LIST = ['W', 'U', 'B', 'R', 'G']
const RARITY_LIST = ['common', 'uncommon', 'rare', 'mythic']

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  return v.split(',').filter(Boolean)
}

export default async function CardsSearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = (params.q ?? '').trim()
  const type = (params.type ?? '').trim()
  const text = (params.text ?? '').trim()
  const colors = asArray(params.color)
  const identity = asArray(params.identity)
  const colorless = params.colorless === '1'
  const legal = (params.legal ?? '').trim()
  const rarity = (params.rarity ?? '').trim()

  const anyFilter = q.length >= 2 || type.length >= 2 || text.length >= 2 || colors.length > 0 || identity.length > 0 || colorless || legal.length > 0 || rarity.length > 0
  const hits = anyFilter
    ? await searchCards({
        name: q, type, text, colors, colorIdentity: identity, colorless,
        legalIn: legal, rarity,
      }, 60)
    : []

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 24px 80px' }}>
      <div style={{ marginBottom: 18 }}>
        <div className="label-mono">Search</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>
          {q ? <>Cards matching “{q}”</> : 'Search MTG cards'}
        </h1>
      </div>

      <form method="GET" action="/cards/search" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10,
        padding: 14,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        marginBottom: 20,
      }}>
        <Field label="Name">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="lightning bolt"
            style={inputStyle}
            autoFocus
          />
        </Field>
        <Field label="Type contains">
          <input type="text" name="type" defaultValue={type} placeholder="creature, saga…" style={inputStyle} />
        </Field>
        <Field label="Oracle text contains">
          <input type="text" name="text" defaultValue={text} placeholder="draw a card" style={inputStyle} />
        </Field>
        <Field label="Colour (any of)">
          <div style={{ display: 'flex', gap: 4 }}>
            {COLOR_LIST.map((c) => (
              <label key={c} style={{ position: 'relative' }}>
                <input type="checkbox" name="color" value={c} defaultChecked={colors.includes(c)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                <span
                  aria-hidden
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 26, borderRadius: '50%',
                    background: colors.includes(c) ? 'var(--primary)' : 'var(--bg-light)',
                    color: '#25313f',
                    fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    border: '1px solid var(--border)',
                  }}
                >{c}</span>
              </label>
            ))}
            <label style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              <input type="checkbox" name="colorless" value="1" defaultChecked={colorless} /> Colourless
            </label>
          </div>
        </Field>
        <Field label="Colour identity (subset of)">
          <div style={{ display: 'flex', gap: 4 }}>
            {COLOR_LIST.map((c) => (
              <label key={c} style={{ position: 'relative' }}>
                <input type="checkbox" name="identity" value={c} defaultChecked={identity.includes(c)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                <span
                  aria-hidden
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 26, borderRadius: '50%',
                    background: identity.includes(c) ? 'var(--primary)' : 'var(--bg-light)',
                    color: '#25313f',
                    fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    border: '1px solid var(--border)',
                  }}
                >{c}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Legal in">
          <select name="legal" defaultValue={legal} style={inputStyle}>
            <option value="">Any format</option>
            {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Rarity">
          <select name="rarity" defaultValue={rarity} style={inputStyle}>
            <option value="">Any</option>
            {RARITY_LIST.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button
            type="submit"
            style={{
              background: 'var(--primary)', color: '#fff',
              border: 'none', borderRadius: 10,
              padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', flex: 1,
            }}
          >Search</button>
          {anyFilter && (
            <Link href="/cards/search" style={{
              padding: '10px 14px', border: '1px solid var(--border)',
              borderRadius: 10, color: 'var(--text)', textDecoration: 'none',
              fontSize: 13, fontWeight: 600,
            }}>Clear</Link>
          )}
        </div>
      </form>

      {anyFilter && hits.length === 0 && (
        <div style={{ padding: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>
          No cards match these filters.
        </div>
      )}
      {!anyFilter && (
        <div style={{ padding: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14 }}>
          Type at least two characters, or pick a colour, format, type or rarity.
        </div>
      )}

      {hits.length > 0 && (
        <>
          <div style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }}>
            Showing {hits.length} card{hits.length === 1 ? '' : 's'}. Freshest English printing per unique card.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {hits.map((h) => {
              const slug = h.collector_number ? buildCardSlug(h.collector_number, h.name) : ''
              const href = slug ? `/set/${h.set_code}/card/${slug}` : '#'
              return (
                <Link
                  key={h.printing_id}
                  href={href}
                  className="card-hover"
                  style={{
                    display: 'block', background: 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: 12,
                    padding: 12, textDecoration: 'none', color: 'var(--text)',
                  }}
                >
                  <div style={{
                    aspectRatio: '5 / 7', borderRadius: 6, background: 'var(--bg-light)',
                    marginBottom: 10, overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {h.image_uri_small ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.image_uri_small} alt={h.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No image</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{h.name}</div>
                  <div style={{ marginTop: 6, minHeight: 20 }}>
                    {h.mana_cost && <ManaCost cost={h.mana_cost} size={14} />}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ textTransform: 'uppercase' }}>{h.set_code}</span>
                    {h.collector_number && <span>· #{h.collector_number}</span>}
                    {h.rarity && <span>· {h.rarity}</span>}
                  </div>
                  {h.type_line && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, lineHeight: 1.3 }}>{h.type_line}</div>
                  )}
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="label-mono">{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
