// app/set/[setCode]/card/[cardSlug]/page.tsx, deep MTG card page.
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
import { getCardMarketSummary } from '@/lib/mtg/card-market'
import { getOwnedPrintings } from '@/lib/mtg/collection'
import { getSetByCode } from '@/lib/mtg/sets'
import ManaCost from '@/components/mtg/ManaCost'
import OracleText from '@/components/mtg/OracleText'
import CardFaces from '@/components/mtg/CardFaces'
import CapabilityChips from '@/components/mtg/CapabilityChips'
import LegalityMatrix from '@/components/mtg/LegalityMatrix'
import OtherPrintings from '@/components/mtg/OtherPrintings'
import PrintingComparison from '@/components/mtg/PrintingComparison'
import CardMarketOverview from '@/components/mtg/CardMarketOverview'
import CardActionsStrip from '@/components/mtg/CardActionsStrip'
import CardSeoContent from '@/components/mtg/CardSeoContent'
import RulingsList from '@/components/mtg/RulingsList'
import SimilarCards from '@/components/mtg/SimilarCards'
import CardPageClient from './CardPageClient'
import GradedPricesPanel from '@/components/mtg/GradedPricesPanel'
import CardColorAccent from '@/components/mtg/CardColorAccent'
import { getTcgBundleForMtgPrinting, getSlabbedMtgPrintingSet } from '@/lib/tcggraph/read-model'
import { buildGradedView } from '@/lib/mtg/graded-view'
import { buildCardTheme } from '@/lib/mtg/color-theme'

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
  tcgplayer: '#A8681C',    // gold, new brand
  cardkingdom: '#235FAE',  // arcane blue, new brand
  cardmarket: '#3E7BC9',
  manapool: '#2A8459',
  cardhoarder: '#C4441B',
}

const RARITY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  common:    { bg: 'rgba(107,114,128,0.15)', fg: 'var(--text-muted)', label: 'Common' },
  uncommon:  { bg: 'rgba(107,114,128,0.14)', fg: 'var(--text-muted)', label: 'Uncommon' },
  rare:      { bg: 'var(--accent-soft)',  fg: 'var(--amber)', label: 'Rare' },
  mythic:    { bg: 'rgba(224,125,58,0.16)',  fg: '#c1571f', label: 'Mythic' },
  special:   { bg: 'var(--primary-soft)',  fg: 'var(--primary)', label: 'Special' },
  bonus:     { bg: 'var(--primary-soft)',  fg: 'var(--primary)', label: 'Bonus' },
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { setCode, cardSlug } = await params
  const detail = await getCardBySlug(setCode, cardSlug)
  if (!detail) return { title: 'Card not found' }
  const canonical = `${SITE_URL}/set/${detail.printing.set_code}/card/${cardSlug}`
  const setUpper = detail.printing.set_code.toUpperCase()
  //  Enrich the description ONLY when graded pricing genuinely exists
  //  for this exact printing. No keyword stuffing; no hidden SEO text.
  const bundle = await getTcgBundleForMtgPrinting(detail.printing.id)
  const graded = buildGradedView(bundle)
  const gradedTailBits: string[] = []
  if (graded.hasSlabbedData) {
    const grades = new Set<string>()
    for (const c of graded.slabTen) grades.add(`${c.grader} ${c.grade}`)
    if (grades.size > 0) gradedTailBits.push(`${Array.from(grades).slice(0, 4).join(', ')} graded market prices`)
  }
  const description = gradedTailBits.length > 0
    ? `${detail.printing.name} from ${setUpper}. Live paper price, 7d, 30d and 90d charts, format legality, rulings, every English printing, and ${gradedTailBits.join(' + ')}.`
    : `${detail.printing.name} from ${setUpper}. Live paper price, 7d, 30d and 90d charts, format legality, rulings and every English printing.`
  return {
    title: `${detail.printing.name} Price, Printings and MTG Card Details`,
    description,
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

  // Prices + chart data + market summary + set name + owner holdings +
  // graded bundle for THIS printing + graded indicator set across
  // other printings (so PrintingComparison can badge rows that carry
  // slab data without an N+1 query per row).
  const finishIds = finishes.map((f) => f.id)
  const [currentByFinish, otherPricesByPrinting, marketSummary, setRow, ownedRows, tcgBundle, gradedPrintingIdSet] = await Promise.all([
    getCurrentPricesForFinishes(finishIds),
    otherPrintings.length > 0
      ? getHeadlinePricesByPrinting(otherPrintings.map((p) => p.id))
      : Promise.resolve(new Map<string, number>()),
    getCardMarketSummary(oracle.id, printing.id),
    getSetByCode(printing.set_code),
    getOwnedPrintings(oracle.id),        // returns [] when unauthenticated
    getTcgBundleForMtgPrinting(printing.id),
    getSlabbedMtgPrintingSet([printing.id, ...otherPrintings.map((p) => p.id)]).catch(() => new Set<string>()),
  ])
  const cardTheme = buildCardTheme(oracle.colors ?? [])
  const gradedIndicatorIds = Array.from(gradedPrintingIdSet)
  const thisPrintingHasSlab = gradedPrintingIdSet.has(printing.id)
  const setName = setRow?.name ?? printing.set_code.toUpperCase()

  // Roll up owned quantities per printing_id so the comparison table
  // and the top-of-page badge can render an "owned" count. Sums over
  // all conditions and finishes.
  const ownedByPrintingId: Record<string, number> = {}
  let ownedTotal = 0
  for (const row of ownedRows) {
    if (!row.printing_id) continue
    ownedByPrintingId[row.printing_id] = (ownedByPrintingId[row.printing_id] ?? 0) + (row.quantity ?? 0)
    ownedTotal += row.quantity ?? 0
  }
  const ownedThisPrinting = ownedByPrintingId[printing.id] ?? 0

  const defaultFinish: MtgFinish | undefined = finishes.find((f) => f.finish === 'nonfoil') ?? finishes[0]
  const historySeries = defaultFinish
    ? await getPriceHistory({ printingFinishId: defaultFinish.id, daysBack: 90 })
    : []

  const chartSeries = historySeries
    .map((s) => ({
      key: `${s.provider}_${s.market}_${s.currency}_${s.price_type}`,
      label: PROVIDER_LABEL[s.provider] ?? s.provider,
      provider: s.provider,
      color: PROVIDER_COLOUR[s.provider] ?? '#14213D',
      points: s.points.map((p) => ({ date: p.observed_on, value: Number(p.price) })),
    }))
    .filter((s) => s.points.length > 0)

  // Second image for DFC/transform/MDFC, pulled from oracle.card_faces
  // if present. This is the back-face image of the *default* printing;
  // artwork may differ from this printing but rules are equivalent.
  const backImage =
    (['transform', 'modal_dfc'].includes(layoutKind))
      ? (faces[1] && faces[1].image_uri_normal ? faces[1].image_uri_normal : null)
      : null

  const rarityStyle = printing.rarity ? RARITY_STYLE[printing.rarity] : null
  const releaseYear = printing.released_at ? printing.released_at.slice(0, 4) : null

  //  JSON-LD. Kept minimal (WebPage) so we do not risk Rich Results
  //  validity with fabricated Offers. Graded prices are NOT emitted as
  //  additional Offers - they are provider estimates for slabbed
  //  copies, not first-party sales offers.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${printing.name} (${printing.set_code.toUpperCase()}${printing.collector_number ? ` #${printing.collector_number}` : ''})`,
    description: `${printing.name} from ${setName}${releaseYear ? `, released ${releaseYear}` : ''}. Live paper price, price history and format legality for this exact MTG printing.`,
    url: `${SITE_URL}/set/${printing.set_code}/card/${cardSlug}`,
  }

  const attrLabels = [
    printing.borderless && 'Borderless',
    printing.full_art && 'Full art',
    printing.promo && 'Promo',
    printing.reprint && 'Reprint',
    printing.textless && 'Textless',
  ].filter(Boolean) as string[]

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 24px 80px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/browse" style={{ color: 'inherit' }}>Sets</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <Link href={`/set/${printing.set_code}`} style={{ color: 'inherit' }}>{printing.set_code.toUpperCase()}</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <span style={{ color: 'var(--text)' }}>{printing.name}</span>
      </nav>

      {/*
        Full-width card header - anchored above the two-column grid so
        the title, printing identity and card colour appear FIRST on
        mobile (before the image), and give desktop a strong page
        anchor. Everything the reader needs to answer "which exact
        card am I on?" lives in this header.
      */}
      <header aria-label="Card identity" style={{ marginBottom: 20 }}>
        <CardColorAccent colours={oracle.colors ?? []} label={false} />

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginTop: 10 }}>
          <h1 style={{ fontSize: 34, margin: 0, lineHeight: 1.05 }}>{printing.name}</h1>
          {oracle.mana_cost && !faces.some((f) => f.mana_cost) && <ManaCost cost={oracle.mana_cost} size={22} />}
        </div>

        {/* Exact-printing fingerprint - the "which one am I on?" answer at a glance. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span className="mtg-fingerprint" aria-label="This exact printing">
            <strong style={{ color: 'var(--text-strong)' }}>{printing.set_code.toUpperCase()}</strong>
            <span>{setName}</span>
            {printing.collector_number && <><span className="sep">/</span><span>#{printing.collector_number}</span></>}
            {releaseYear && <><span className="sep">/</span><span>{releaseYear}</span></>}
            {printing.lang && printing.lang !== 'en' && <><span className="sep">/</span><span>{printing.lang.toUpperCase()}</span></>}
          </span>
          {rarityStyle && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              background: rarityStyle.bg, color: rarityStyle.fg,
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>{rarityStyle.label}</span>
          )}
          {attrLabels.length > 0 && attrLabels.map((a) => (
            <span key={a} className="chip" style={{ fontSize: 11 }}>{a}</span>
          ))}
          {thisPrintingHasSlab && (
            <span className="chip chip-gold" style={{ fontSize: 11 }} title="This printing has graded market data further down the page.">◆ Graded data</span>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
          {oracle.reserved && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              background: 'rgba(180,65,70,0.14)', color: 'var(--red)', letterSpacing: 0.4, textTransform: 'uppercase',
            }} title="On the WOTC Reserved List, will never be reprinted in a tournament-legal set.">Reserved list</span>
          )}
          {oracle.game_changer && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              background: 'var(--accent-soft)', color: 'var(--amber)', letterSpacing: 0.4, textTransform: 'uppercase',
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
          <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 10 }}>{oracle.type_line}</div>
        )}
      </header>

      {/* Hero: image (with halo) + market / gameplay two-column */}
      <div className="mtg-card-hero" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 32, alignItems: 'start' }}>
        <div>
          <div className="mtg-card-halo" style={{ '--mtg-halo': cardTheme.ambient } as React.CSSProperties}>
            <div style={{ display: 'grid', gap: 12 }}>
              <CardImage src={printing.image_uri} alt={printing.name} />
              {backImage && (
                <CardImage src={backImage} alt={`${printing.name}, back face`} caption="Back face (default printing artwork)" />
              )}
            </div>
          </div>

          {/* Client: finish switcher + prices + chart */}
          <CardPageClient
            finishes={finishes}
            defaultFinishId={defaultFinish?.id ?? null}
            currentPricesByFinish={serializePriceMap(currentByFinish)}
            chartSeries={chartSeries}
          />

          {/* Print meta - "this printing" facts, kept as a compact sidebar block. */}
          <div style={{ marginTop: 20, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, display: 'grid', gap: 6 }}>
            <div className="label-mono" style={{ marginBottom: 4 }}>This printing</div>
            <Row k="Set" v={<Link href={`/set/${printing.set_code}`} style={{ color: 'var(--accent)' }}>{printing.set_code.toUpperCase()}</Link>} />
            <Row k="Collector #" v={printing.collector_number ?? '-'} />
            <Row k="Released" v={printing.released_at ?? '-'} />
            <Row k="Rarity" v={printing.rarity ? printing.rarity : '-'} />
            <Row k="Artist" v={printing.artist ?? '-'} />
            <Row k="Language" v={(printing.lang ?? 'en').toUpperCase()} />
            <Row k="Layout" v={oracle.layout ?? 'normal'} />
            {attrLabels.length > 0 && <Row k="Attributes" v={attrLabels.join(' · ')} />}
            {printing.scryfall_uri && (
              <Row k="Scryfall" v={<a href={printing.scryfall_uri} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Open ↗</a>} />
            )}
          </div>
        </div>

        {/*
          Right column.  Two clearly separated stacks:
            MARKET / COLLECTING
              - CardMarketOverview  (raw current + 7/30/90d)
              - GradedPricesPanel   (only when this printing has slabs)
              - CardActionsStrip    (Add to collection / Add to deck)
              - PrintingComparison  (compare other physical versions)
            GAMEPLAY
              - CardFaces
              - Keywords
              - Capabilities
              - Format legality
              - Rulings
              - Similar cards
        */}
        <div>
          {/* MARKET section eyebrow */}
          <SectionEyebrow accent="gold" label="Market and collecting" />

          {marketSummary && (
            <div style={{ marginBottom: 16 }}>
              <CardMarketOverview
                summary={marketSummary}
                cardName={printing.name}
                setName={setName}
                setCode={printing.set_code}
                collectorNumber={printing.collector_number}
              />
            </div>
          )}

          {/* Graded market. GradedPricesPanel returns null on no-slab. */}
          <div style={{ marginBottom: 20 }}>
            <GradedPricesPanel
              bundle={tcgBundle}
              setCode={printing.set_code}
              collectorNumber={printing.collector_number}
              finish={defaultFinish?.finish ?? null}
              cardName={printing.name}
            />
          </div>

          {/* Add to collection / deck. */}
          <div style={{ marginBottom: 22 }}>
            <CardActionsStrip
              cardName={printing.name}
              oracleId={oracle.id}
              finishes={finishes.map((f) => ({ id: f.id, finish: f.finish as 'nonfoil' | 'foil' | 'etched' }))}
              preferredFinishId={finishes.find((f) => f.finish === 'nonfoil')?.id ?? finishes[0]?.id ?? null}
              ownedTotal={ownedTotal}
              ownedThisPrinting={ownedThisPrinting}
            />
          </div>

          {/* Other printings + comparison. Kept in the Market section
              because "which alternative version should I buy" is a
              market-shopping question, not a gameplay question. */}
          {marketSummary && marketSummary.pricedPrintings.length > 0 ? (
            <div style={{ marginBottom: 32 }}>
              <PrintingComparison
                cardName={printing.name}
                oracleId={oracle.id}
                basis={marketSummary.basis}
                pricedPrintings={marketSummary.pricedPrintings}
                currentPrintingId={printing.id}
                ownedByPrintingId={ownedTotal > 0 ? ownedByPrintingId : undefined}
                gradedPrintingIds={gradedIndicatorIds}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 32 }}>
              <div className="label-mono" style={{ marginBottom: 8 }}>Other printings</div>
              <OtherPrintings
                currentPrintingId={printing.id}
                otherPrintings={otherPrintings}
                headlinePriceByPrinting={otherPricesByPrinting}
              />
            </div>
          )}

          {/* GAMEPLAY section eyebrow */}
          <SectionEyebrow accent="arcane" label="Gameplay and rules" />

          <div style={{ marginBottom: 22 }}>
            <CardFaces faces={faces} layoutKind={layoutKind} />
          </div>

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

          {caps.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div className="label-mono" style={{ marginBottom: 8 }}>Card capabilities</div>
              <CapabilityChips caps={caps} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                Derived deterministically from card types, Oracle text and keywords. Not a strategic evaluation.
              </div>
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <div className="label-mono" style={{ marginBottom: 8 }}>Format legality</div>
            <LegalityMatrix legalities={legalities} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <div className="label-mono" style={{ marginBottom: 8 }}>Rulings {rulings.length > 0 && <span style={{ color: 'var(--text-muted)' }}>({rulings.length})</span>}</div>
            <RulingsList rulings={rulings} initialCount={6} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <SimilarCards oracleId={oracle.id} currentPrintingId={printing.id} />
          </div>
        </div>
      </div>

      {/* SEO content + FAQ (full width, sits below the two column hero). */}
      <div style={{ marginTop: 40 }}>
        <CardSeoContent
          oracle={oracle}
          printing={printing}
          otherPrintings={otherPrintings}
          legalities={legalities}
          market={marketSummary}
          gradedView={buildGradedView(tcgBundle)}
          canonical={`${SITE_URL}/set/${printing.set_code}/card/${cardSlug}`}
          setName={setName}
        />
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

/**
 * Small section eyebrow separating MARKET / GAMEPLAY on the card page.
 * Uses the .mtg-engraved hairline behind the text so it inherits the
 * gilt treatment.
 */
function SectionEyebrow({ label, accent }: { label: string; accent: 'gold' | 'arcane' }) {
  const colour = accent === 'gold' ? 'var(--gold-600)' : 'var(--primary-strong)'
  return (
    <div style={{ display: 'grid', gap: 6, margin: '4px 0 14px' }}>
      <div className="mtg-engraved" aria-hidden />
      <div className="label-mono" style={{ color: colour }}>{label}</div>
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
