// app/set/[setCode]/card/[cardSlug]/page.tsx — deep MTG card page.
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCardBySlug, type MtgFinish } from '@/lib/mtg/cards'
import {
  getCurrentPricesForFinishes,
  getPriceHistory,
  getHeadlinePricesByPrinting,
  type MtgCurrentPrice,
} from '@/lib/mtg/prices'
import { classify as classifyCard, type CardCapability } from '@/lib/mtg/capabilities'
import { extractFaces, normaliseLayout } from '@/lib/mtg/faces'
import ManaCost from '@/components/mtg/ManaCost'
import OracleText from '@/components/mtg/OracleText'
import CardFaces from '@/components/mtg/CardFaces'
import CapabilityChips from '@/components/mtg/CapabilityChips'
import LegalityMatrix from '@/components/mtg/LegalityMatrix'
import OtherPrintings from '@/components/mtg/OtherPrintings'
import RulingsList from '@/components/mtg/RulingsList'
import SimilarCards from '@/components/mtg/SimilarCards'
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
  tcgplayer: '#C9A55C',
  cardkingdom: '#7C5CE7',
  cardmarket: '#63A8FF',
  manapool: '#4FAF78',
  cardhoarder: '#e07d3a',
}

const RARITY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  common:    { bg: 'rgba(154,163,178,0.18)', fg: '#c4cad4', label: 'Common' },
  uncommon:  { bg: 'rgba(192,200,208,0.20)', fg: '#dae0e7', label: 'Uncommon' },
  rare:      { bg: 'rgba(201,165,92,0.18)',  fg: '#f2d68a', label: 'Rare' },
  mythic:    { bg: 'rgba(224,125,58,0.20)',  fg: '#f2b28a', label: 'Mythic' },
  special:   { bg: 'rgba(124,92,231,0.20)',  fg: '#c8b8ff', label: 'Special' },
  bonus:     { bg: 'rgba(124,92,231,0.20)',  fg: '#c8b8ff', label: 'Bonus' },
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

export default async function MtgCardPage({ params }: { params: Promise<Params> }) {
  const { setCode, cardSlug } = await params
  const detail = await getCardBySlug(setCode, cardSlug)
  if (!detail) notFound()

  const { printing, oracle, finishes, legalities, rulings, otherPrintings } = detail

  const layoutKind = normaliseLayout(oracle.layout)
  const faces = extractFaces(oracle)
  // Prefer pre-computed capabilities from mtg_oracle_cards.capabilities
  // (Phase 2B backfill). Fall back to a live classify call if the row
  // is missing tags for any reason (defence in depth).
  const caps: CardCapability[] = (oracle.capabilities as CardCapability[] | undefined)?.length
    ? oracle.capabilities as CardCapability[]
    : classifyCard({
        type_line: oracle.type_line,
        oracle_text: oracle.oracle_text,
        keywords: oracle.keywords,
        produced_mana: oracle.produced_mana,
        card_faces: oracle.card_faces,
      })

  // Prices + chart data.
  const finishIds = finishes.map((f) => f.id)
  const [currentByFinish, otherPricesByPrinting] = await Promise.all([
    getCurrentPricesForFinishes(finishIds),
    otherPrintings.length > 0
      ? getHeadlinePricesByPrinting(otherPrintings.map((p) => p.id))
      : Promise.resolve(new Map<string, number>()),
  ])

  const defaultFinish: MtgFinish | undefined = finishes.find((f) => f.finish === 'nonfoil') ?? finishes[0]
  const historySeries = defaultFinish
    ? await getPriceHistory({ printingFinishId: defaultFinish.id, daysBack: 90 })
    : []

  const chartSeries = historySeries
    .map((s) => ({
      key: `${s.provider}_${s.market}_${s.currency}_${s.price_type}`,
      label: PROVIDER_LABEL[s.provider] ?? s.provider,
      provider: s.provider,
      color: PROVIDER_COLOUR[s.provider] ?? '#F3F0E8',
      points: s.points.map((p) => ({ date: p.observed_on, value: Number(p.price) })),
    }))
    .filter((s) => s.points.length > 0)

  // Second image for DFC/transform/MDFC — pulled from oracle.card_faces
  // if present. This is the back-face image of the *default* printing;
  // artwork may differ from this printing but rules are equivalent.
  const backImage =
    (['transform', 'modal_dfc'].includes(layoutKind))
      ? (faces[1] && faces[1].image_uri_normal ? faces[1].image_uri_normal : null)
      : null

  const rarityStyle = printing.rarity ? RARITY_STYLE[printing.rarity] : null

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${printing.name} (${printing.set_code.toUpperCase()})`,
    description: `${printing.name} — MTG card printing.`,
    url: `${SITE_URL}/set/${printing.set_code}/card/${cardSlug}`,
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 24px 80px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/browse" style={{ color: 'inherit' }}>Sets</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <Link href={`/set/${printing.set_code}`} style={{ color: 'inherit' }}>
          {printing.set_code.toUpperCase()}
        </Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <span style={{ color: 'var(--text)' }}>{printing.name}</span>
      </nav>

      {/* Hero: image(s) + summary */}
      <div className="mtg-card-hero" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 32, alignItems: 'start' }}>
        <div>
          {/* Card image(s) */}
          <div style={{ display: 'grid', gap: 12 }}>
            <CardImage src={printing.image_uri} alt={printing.name} />
            {backImage && (
              <CardImage src={backImage} alt={`${printing.name} — back face`} caption="Back face (default printing artwork)" />
            )}
          </div>

          {/* Client: finish switcher + prices + chart */}
          <CardPageClient
            finishes={finishes}
            defaultFinishId={defaultFinish?.id ?? null}
            currentPricesByFinish={serializePriceMap(currentByFinish)}
            chartSeries={chartSeries}
          />

          {/* Print meta */}
          <div style={{ marginTop: 20, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, display: 'grid', gap: 6 }}>
            <div className="label-mono" style={{ marginBottom: 4 }}>This printing</div>
            <Row k="Set" v={<Link href={`/set/${printing.set_code}`} style={{ color: 'var(--accent)' }}>{printing.set_code.toUpperCase()}</Link>} />
            <Row k="Collector #" v={printing.collector_number ?? '—'} />
            <Row k="Released" v={printing.released_at ?? '—'} />
            <Row k="Rarity" v={printing.rarity ? printing.rarity : '—'} />
            <Row k="Artist" v={printing.artist ?? '—'} />
            <Row k="Language" v={(printing.lang ?? 'en').toUpperCase()} />
            <Row k="Layout" v={oracle.layout ?? 'normal'} />
            {(printing.borderless || printing.full_art || printing.promo || printing.reprint) && (
              <Row k="Attributes" v={[
                printing.borderless && 'Borderless',
                printing.full_art && 'Full art',
                printing.promo && 'Promo',
                printing.reprint && 'Reprint',
              ].filter(Boolean).join(' · ')} />
            )}
            {printing.scryfall_uri && (
              <Row k="Scryfall" v={<a href={printing.scryfall_uri} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Open ↗</a>} />
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Title + tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: 32, margin: 0, lineHeight: 1.1 }}>{printing.name}</h1>
            {oracle.mana_cost && !faces.some((f) => f.mana_cost) && <ManaCost cost={oracle.mana_cost} size={22} />}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            {rarityStyle && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                background: rarityStyle.bg, color: rarityStyle.fg,
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>{rarityStyle.label}</span>
            )}
            {oracle.reserved && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                background: 'rgba(212,93,100,0.15)', color: '#f2a9ae', letterSpacing: 0.4, textTransform: 'uppercase',
              }} title="On the WOTC Reserved List — will never be reprinted in a tournament-legal set.">Reserved list</span>
            )}
            {oracle.game_changer && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                background: 'rgba(201,165,92,0.18)', color: '#f2d68a', letterSpacing: 0.4, textTransform: 'uppercase',
              }} title="Flagged by WOTC as a Game Changer in Commander bracket 4.">Game changer</span>
            )}
            {oracle.color_identity && oracle.color_identity.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span>Colour ID</span>
                <ManaCost cost={oracle.color_identity.map((c) => `{${c}}`).join('')} size={14} />
              </span>
            )}
            {oracle.mana_value != null && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>MV <strong style={{ color: 'var(--text)' }}>{oracle.mana_value}</strong></span>
            )}
          </div>

          {oracle.type_line && !faces.some((f) => f.type_line) && (
            <div style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 20 }}>{oracle.type_line}</div>
          )}

          {/* Faces / rules text */}
          <div style={{ marginBottom: 24 }}>
            <CardFaces faces={faces} layoutKind={layoutKind} />
          </div>

          {/* Keywords */}
          {oracle.keywords && oracle.keywords.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div className="label-mono" style={{ marginBottom: 8 }}>Keywords</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {oracle.keywords.map((k) => (
                  <span key={k} style={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  }}>{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Capabilities */}
          {caps.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="label-mono" style={{ marginBottom: 8 }}>Card capabilities</div>
              <CapabilityChips caps={caps} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                Derived deterministically from card types, Oracle text and keywords. Not a strategic evaluation.
              </div>
            </div>
          )}

          {/* Legality */}
          <div style={{ marginBottom: 24 }}>
            <div className="label-mono" style={{ marginBottom: 8 }}>Format legality</div>
            <LegalityMatrix legalities={legalities} />
          </div>

          {/* Other printings */}
          <div style={{ marginBottom: 24 }}>
            <div className="label-mono" style={{ marginBottom: 8 }}>Other printings</div>
            <OtherPrintings
              currentPrintingId={printing.id}
              otherPrintings={otherPrintings}
              headlinePriceByPrinting={otherPricesByPrinting}
            />
          </div>

          {/* Rulings */}
          <div style={{ marginBottom: 24 }}>
            <div className="label-mono" style={{ marginBottom: 8 }}>Rulings {rulings.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({rulings.length})</span>}</div>
            <RulingsList rulings={rulings} initialCount={6} />
          </div>

          {/* Similar cards (deterministic) */}
          <div style={{ marginBottom: 12 }}>
            <SimilarCards oracleId={oracle.id} currentPrintingId={printing.id} />
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 820px) {
              .mtg-card-hero { grid-template-columns: 1fr !important; }
            }
          `,
        }}
      />
    </div>
  )
}

function CardImage({ src, alt, caption }: { src: string | null; alt: string; caption?: string }) {
  return (
    <div>
      <div style={{ aspectRatio: '5 / 7', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No image</div>
        )}
      </div>
      {caption && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{caption}</div>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ textAlign: 'right', textTransform: k === 'Layout' ? 'capitalize' : undefined }}>{v}</span>
    </div>
  )
}

function serializePriceMap(m: Map<string, MtgCurrentPrice[]>): Record<string, MtgCurrentPrice[]> {
  const out: Record<string, MtgCurrentPrice[]> = {}
  for (const [k, v] of Array.from(m.entries())) out[k] = v
  return out
}
