// app/set/[setCode]/card/[cardSlug]/page.tsx — MTG card page.
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCardBySlug, buildCardSlug, type MtgFinish } from '@/lib/mtg/cards'
import {
  getCurrentPricesForFinishes,
  getPriceHistory,
  pickHeadlinePrice,
  type MtgCurrentPrice,
} from '@/lib/mtg/prices'
import CardPageClient from './CardPageClient'

export const revalidate = 300

type Params = { setCode: string; cardSlug: string }

const SITE_URL = 'https://mtgprices.io'

const PROVIDER_LABEL: Record<string, string> = {
  tcgplayer: 'TCGplayer',
  cardkingdom: 'Card Kingdom',
  cardmarket: 'Cardmarket',
  manapool: 'ManaPool',
  cardhoarder: 'Cardhoarder',
}

const PROVIDER_COLOUR: Record<string, string> = {
  tcgplayer: '#C9A55C',   // gold
  cardkingdom: '#7C5CE7', // violet
  cardmarket: '#63A8FF',  // blue
  manapool: '#4FAF78',    // green
  cardhoarder: '#e07d3a', // orange (MTGO)
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { setCode, cardSlug } = await params
  const detail = await getCardBySlug(setCode, cardSlug)
  if (!detail) return { title: 'Card not found' }
  const canonical = `${SITE_URL}/set/${detail.printing.set_code}/card/${cardSlug}`
  return {
    title: `${detail.printing.name} (${detail.printing.set_code.toUpperCase()}) — MTG price & printings`,
    description: `${detail.printing.name} from ${detail.printing.set_code.toUpperCase()}. Live paper price, 90-day chart, legality, rulings and other printings.`,
    alternates: { canonical },
    openGraph: { url: canonical },
  }
}

// ────────────────────────────────────────────────────────────────

export default async function MtgCardPage({ params }: { params: Promise<Params> }) {
  const { setCode, cardSlug } = await params
  const detail = await getCardBySlug(setCode, cardSlug)
  if (!detail) notFound()

  const { printing, oracle, finishes, legalities, rulings, otherPrintings } = detail

  // Fetch current prices for every finish.
  const finishIds = finishes.map((f) => f.id)
  const currentByFinish = await getCurrentPricesForFinishes(finishIds)

  // Pick the default finish: prefer nonfoil, else first available.
  const defaultFinish: MtgFinish | undefined = finishes.find((f) => f.finish === 'nonfoil') ?? finishes[0]

  // 90-day history for the default finish, aggregated per provider.
  const historySeries = defaultFinish
    ? await getPriceHistory({ printingFinishId: defaultFinish.id, daysBack: 90 })
    : []

  // Shape series for the client chart.
  const chartSeries = historySeries
    .map((s) => ({
      key: `${s.provider}_${s.market}_${s.currency}_${s.price_type}`,
      label: PROVIDER_LABEL[s.provider] ?? s.provider,
      provider: s.provider,
      color: PROVIDER_COLOUR[s.provider] ?? '#F3F0E8',
      points: s.points.map((p) => ({ date: p.observed_on, value: Number(p.price) })),
    }))
    // Drop empty series (defensive).
    .filter((s) => s.points.length > 0)

  // Structured data for the card.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${printing.name} (${printing.set_code.toUpperCase()})`,
    description: `${printing.name} — MTG card printing.`,
    url: `${SITE_URL}/set/${printing.set_code}/card/${cardSlug}`,
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 64px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/browse" style={{ color: 'inherit' }}>Sets</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <Link href={`/set/${printing.set_code}`} style={{ color: 'inherit' }}>
          {printing.set_code.toUpperCase()}
        </Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <span style={{ color: 'var(--text)' }}>{printing.name}</span>
      </div>

      {/* Two-column layout: image + summary // details */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 320px) 1fr',
          gap: 32,
          alignItems: 'start',
        }}
        className="mtg-card-grid"
      >
        {/* Left: image, current price, finish switcher */}
        <div>
          <div
            style={{
              aspectRatio: '5 / 7',
              background: 'var(--bg-light)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            {printing.image_uri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={printing.image_uri}
                alt={printing.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                No image
              </div>
            )}
          </div>

          <CardPageClient
            finishes={finishes}
            defaultFinishId={defaultFinish?.id ?? null}
            currentPricesByFinish={serializePriceMap(currentByFinish)}
            chartSeries={chartSeries}
          />
        </div>

        {/* Right: gameplay metadata + oracle text + printings + legality + rulings */}
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>{printing.name}</h1>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              marginTop: 8,
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            <span className="label-mono" style={{ color: 'var(--accent)' }}>
              {printing.set_code.toUpperCase()}
            </span>
            {printing.collector_number && <span>#{printing.collector_number}</span>}
            {printing.rarity && (
              <span
                className="badge-prestige"
                style={{
                  padding: '2px 10px',
                  fontSize: 11,
                  textTransform: 'uppercase',
                }}
              >
                {printing.rarity}
              </span>
            )}
            {printing.artist && <span>Illus. {printing.artist}</span>}
          </div>

          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <MetaRow label="Type" value={oracle.type_line ?? '—'} />
            <MetaRow label="Mana cost" value={oracle.mana_cost ?? '—'} />
            {oracle.power || oracle.toughness ? (
              <MetaRow label="P / T" value={`${oracle.power ?? '—'} / ${oracle.toughness ?? '—'}`} />
            ) : null}
            {oracle.loyalty ? <MetaRow label="Loyalty" value={oracle.loyalty} /> : null}
            {oracle.defense ? <MetaRow label="Defense" value={oracle.defense} /> : null}
            {oracle.mana_value != null ? <MetaRow label="Mana value" value={String(oracle.mana_value)} /> : null}
            {oracle.color_identity && oracle.color_identity.length > 0 ? (
              <MetaRow label="Color identity" value={oracle.color_identity.join('')} />
            ) : null}
          </div>

          {oracle.oracle_text && (
            <div style={{ marginTop: 20 }}>
              <div className="label-mono">Rules text</div>
              <div
                style={{
                  marginTop: 6,
                  padding: 14,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  whiteSpace: 'pre-wrap',
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                {oracle.oracle_text}
              </div>
            </div>
          )}

          {oracle.keywords && oracle.keywords.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="label-mono">Keywords</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {oracle.keywords.map((k) => (
                  <span
                    key={k}
                    style={{
                      background: 'var(--bg-light)',
                      border: '1px solid var(--border)',
                      padding: '3px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                    }}
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {legalities.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="label-mono">Legality</div>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: 6,
                }}
              >
                {legalities
                  .slice()
                  .sort((a, b) => a.format.localeCompare(b.format))
                  .map((l) => (
                    <LegalityRow key={l.format} format={l.format} legality={l.legality} />
                  ))}
              </div>
            </div>
          )}

          {otherPrintings.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="label-mono">Other printings ({otherPrintings.length})</div>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 8,
                }}
              >
                {otherPrintings.slice(0, 12).map((op) => {
                  const opSlug = op.collector_number ? buildCardSlug(op.collector_number, op.name) : ''
                  return (
                    <Link
                      key={op.id}
                      href={opSlug ? `/set/${op.set_code}/card/${opSlug}` : '#'}
                      style={{
                        display: 'block',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: 6,
                        textDecoration: 'none',
                        color: 'var(--text)',
                      }}
                    >
                      <div
                        style={{
                          aspectRatio: '5 / 7',
                          background: 'var(--bg-light)',
                          borderRadius: 5,
                          overflow: 'hidden',
                          marginBottom: 6,
                        }}
                      >
                        {op.image_uri_small ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={op.image_uri_small}
                            alt={op.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            loading="lazy"
                          />
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{op.set_code.toUpperCase()}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {op.released_at ?? ''}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {rulings.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="label-mono">Rulings ({rulings.length})</div>
              <div
                style={{
                  marginTop: 8,
                  padding: 14,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                }}
              >
                {rulings.slice(0, 20).map((r, i) => (
                  <div
                    key={i}
                    style={{
                      borderBottom: i < Math.min(19, rulings.length - 1) ? '1px solid var(--border)' : 'none',
                      padding: '10px 0',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}>
                      {r.published_at ?? '—'}
                      {r.source && ` · ${r.source}`}
                    </div>
                    <div>{r.comment}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <style
        // Two-column at large widths, stacked below.
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 780px) {
              .mtg-card-grid { grid-template-columns: 1fr !important; }
            }
          `,
        }}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-mono">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}

const LEGALITY_STYLE: Record<string, { bg: string; fg: string }> = {
  legal:       { bg: 'rgba(79,175,120,0.18)', fg: 'var(--green)' },
  banned:      { bg: 'rgba(212,93,100,0.18)', fg: 'var(--red)'   },
  restricted:  { bg: 'rgba(201,165,92,0.18)', fg: 'var(--accent)' },
  not_legal:   { bg: 'transparent',           fg: 'var(--text-muted)' },
}

function LegalityRow({ format, legality }: { format: string; legality: string }) {
  const style = LEGALITY_STYLE[legality] ?? LEGALITY_STYLE.not_legal
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 10px',
        border: '1px solid var(--border)',
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{format}</span>
      <span
        style={{
          background: style.bg,
          color: style.fg,
          padding: '2px 8px',
          borderRadius: 4,
          fontWeight: 700,
          textTransform: 'capitalize',
          fontSize: 11,
        }}
      >
        {legality.replace(/_/g, ' ')}
      </span>
    </div>
  )
}

/** Convert a Map<finishId, MtgCurrentPrice[]> into a plain object so it
 *  can cross the RSC → client-component boundary. */
function serializePriceMap(
  m: Map<string, MtgCurrentPrice[]>,
): Record<string, MtgCurrentPrice[]> {
  const out: Record<string, MtgCurrentPrice[]> = {}
  for (const [k, v] of Array.from(m.entries())) out[k] = v
  return out
}
