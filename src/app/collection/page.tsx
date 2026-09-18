// app/collection/page.tsx, user collection surface.
// RLS enforces "own rows only" server-side; if we lose auth we redirect.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { getCollectionItems, getCollectionSummary } from '@/lib/mtg/collection'
import { CONDITION_SHORT, type CardCondition } from '@/lib/mtg/collection.data'
import { currencySymbol } from '@/lib/mtg/valuation.data'
import { buildCardSlug } from '@/lib/mtg/slug'
import CollectionFilters from './CollectionFilters'
import CollectionRowActions from './CollectionRowActions'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Collection',
  description: 'Your MTG collection.',
  alternates: { canonical: `${SITE_URL}/collection` },
  openGraph: { url: `${SITE_URL}/collection` },
  robots: { index: false, follow: false },
}

type SearchParams = {
  name?: string; set?: string; colors?: string; rarity?: string; finish?: string; condition?: string
  sort?: string; page?: string
}

function pickRarity(v?: string): 'common' | 'uncommon' | 'rare' | 'mythic' | undefined {
  if (v === 'common' || v === 'uncommon' || v === 'rare' || v === 'mythic') return v
  return undefined
}
function pickFinish(v?: string): 'nonfoil' | 'foil' | 'etched' | undefined {
  if (v === 'nonfoil' || v === 'foil' || v === 'etched') return v
  return undefined
}
function pickCondition(v?: string): CardCondition | undefined {
  if (v === 'near_mint' || v === 'lightly_played' || v === 'moderately_played' || v === 'heavily_played' || v === 'damaged') return v
  return undefined
}

export default async function CollectionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/collection')

  const sp = await searchParams

  const [summary, page] = await Promise.all([
    getCollectionSummary(),
    getCollectionItems({
      name: sp.name,
      setCode: sp.set,
      colors: sp.colors ? sp.colors.split(',').filter(Boolean) : undefined,
      rarity: pickRarity(sp.rarity),
      finish: pickFinish(sp.finish),
      condition: pickCondition(sp.condition),
      sort: (sp.sort as any) ?? 'name',
      page: parseInt(sp.page ?? '1', 10) || 1,
      pageSize: 24,
    }),
  ])

  const currency = summary?.basis.currency ?? 'USD'

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 24px 80px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="label-mono">Account · Collection</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>Your MTG collection</h1>
      </div>

      {/* Summary */}
      {summary && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <StatTile label="Total cards" value={summary.totalCards.toLocaleString()} />
            <StatTile label="Unique printings" value={summary.uniquePrintings.toLocaleString()} />
            <StatTile label="Sets" value={summary.uniqueSets.toLocaleString()} />
            <StatTile
              label={`Current value (${summary.basis.provider} ${summary.basis.currency})`}
              value={`${currencySymbol(summary.basis.currency)}${summary.currentValue.total.toFixed(2)}`}
              hint={summary.currentValue.missingCount > 0 ? `${summary.currentValue.missingCount} without price on basis` : undefined}
            />
          </div>
          {/* Breakdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
            <BreakdownTile title="Rarity" entries={summary.rarityBreakdown} />
            <BreakdownTile title="Colour" entries={summary.colorBreakdown} />
            <BreakdownTile title="Finish" entries={summary.finishBreakdown} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
            Valuation basis: <strong>{summary.basis.label}</strong>. {summary.basis.description}
            {' · '}<Link href="/account" style={{ color: 'var(--primary)' }}>change basis</Link>
          </div>
        </section>
      )}

      {/* Filters */}
      <CollectionFilters initialParams={sp as Record<string, string>} />

      {/* Empty state */}
      {page.total === 0 && (
        <div style={{
          padding: 24, background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center',
        }}>
          {sp.name || sp.set || sp.rarity || sp.finish || sp.condition
            ? 'No cards match these filters.'
            : (
              <>
                No cards yet. Head to <Link href="/card-finder" style={{ color: 'var(--primary)' }}>Card Finder</Link>{' '}
                or a card page and hit <strong>+ Collection</strong>. Or <Link href="/collection/import" style={{ color: 'var(--primary)' }}>import a CSV</Link>.
              </>
            )}
        </div>
      )}

      {/* Item grid */}
      {page.items.length > 0 && (
        <>
          <div style={{ margin: '12px 0', color: 'var(--text-muted)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
            <span>Showing {page.items.length} of {page.total} entries</span>
            <Link href="/collection/import" style={{ color: 'var(--primary)', fontSize: 13 }}>Import CSV →</Link>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {page.items.map((h) => {
              const slug = h.printing.collector_number
                ? buildCardSlug(h.printing.collector_number, h.printing.name)
                : ''
              const href = slug ? `/set/${h.printing.set_code}/card/${slug}` : '#'
              return (
                <div key={h.id} style={{
                  display: 'grid', gridTemplateColumns: '56px 1fr auto',
                  gap: 14, padding: 12, background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 12,
                }}>
                  <Link href={href} style={{
                    width: 56, aspectRatio: '5/7', background: 'var(--bg-light)',
                    borderRadius: 6, overflow: 'hidden', flex: 'none',
                  }}>
                    {h.printing.image_uri_small ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.printing.image_uri_small} alt={h.printing.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : null}
                  </Link>
                  <div style={{ minWidth: 0 }}>
                    <Link href={href} style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>{h.printing.name}</Link>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ textTransform: 'uppercase' }}>{h.printing.set_code}</span>
                      {h.printing.collector_number && <span>· #{h.printing.collector_number}</span>}
                      {h.printing.rarity && <span>· {h.printing.rarity}</span>}
                      <span>· {h.finish}</span>
                      <span>· {CONDITION_SHORT[h.condition]}</span>
                    </div>
                    {(h.acquiredTotalCents != null || h.acquired_currency) && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Acquired {h.acquired_price_cents != null ? `${currencySymbol(h.acquired_currency ?? currency)}${(h.acquired_price_cents / 100).toFixed(2)}/copy` : '-'}
                        {h.acquired_at ? ` · ${h.acquired_at}` : ''}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      ×{h.quantity}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: h.currentTotal ? 'var(--text)' : 'var(--text-muted)' }}>
                      {h.currentTotal ? `${currencySymbol(h.currentTotal.currency)}${h.currentTotal.price.toFixed(2)}` : 'no price'}
                    </div>
                    {h.currentPrice && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {h.currentPrice.provider} · {h.currentPrice.observed_on}
                      </div>
                    )}
                    <CollectionRowActions
                      itemId={h.id}
                      quantity={h.quantity}
                      condition={h.condition}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {page.total > page.pageSize && (
            <CollectionPagination page={page.page} pageSize={page.pageSize} total={page.total} sp={sp} />
          )}
        </>
      )}
    </div>
  )
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div className="label-mono" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function BreakdownTile({ title, entries }: { title: string; entries: Record<string, number> }) {
  const keys = Object.keys(entries).filter((k) => entries[k] > 0).sort((a, b) => entries[b] - entries[a])
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>{title}</div>
      {keys.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {keys.map((k) => (
            <span key={k} style={{
              padding: '3px 10px', fontSize: 12, fontWeight: 600,
              background: 'var(--bg-light)', color: 'var(--text)',
              borderRadius: 999, border: '1px solid var(--border)',
              textTransform: 'capitalize',
            }}>{k} <strong style={{ color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{entries[k]}</strong></span>
          ))}
        </div>
      )}
    </div>
  )
}

function CollectionPagination({ page, pageSize, total, sp }: { page: number; pageSize: number; total: number; sp: SearchParams }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v && k !== 'page') params.set(k, v)
  const href = (p: number) => { params.set('page', String(p)); return `/collection?${params.toString()}` }
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
      {page > 1 && <Link href={href(page - 1)} style={pagerBtn}>‹ Prev</Link>}
      <span style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-muted)' }}>Page {page} of {pageCount}</span>
      {page < pageCount && <Link href={href(page + 1)} style={pagerBtn}>Next ›</Link>}
    </div>
  )
}

const pagerBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none',
}
