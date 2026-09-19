// src/components/mtg/CardSeoContent.tsx
// Server component. Deterministic SEO copy + FAQ for a card. Every
// sentence is derived from database facts we already have on the page,
// so nothing here relies on the AI system. Also emits FAQPage +
// BreadcrumbList JSON-LD when there is enough data to justify it.

import type { CardMarketSummary } from '@/lib/mtg/card-market.types'
import type { MtgOracleCard, MtgPrinting } from '@/lib/mtg/cards'

type Legality = { format: string; legality: string }

type Props = {
  oracle: MtgOracleCard
  printing: MtgPrinting
  otherPrintings: MtgPrinting[]
  legalities: Legality[]
  market: CardMarketSummary | null
  canonical: string
  setName: string
}

// A curated shortlist of formats we surface in copy. The full legality
// matrix lives elsewhere on the page.
const FEATURED_FORMATS: { key: string; label: string }[] = [
  { key: 'commander', label: 'Commander' },
  { key: 'modern',    label: 'Modern' },
  { key: 'standard',  label: 'Standard' },
  { key: 'pioneer',   label: 'Pioneer' },
  { key: 'legacy',    label: 'Legacy' },
  { key: 'pauper',    label: 'Pauper' },
]

export default function CardSeoContent({
  oracle, printing, otherPrintings, legalities, market, canonical, setName,
}: Props) {
  const cardName = printing.name
  const allPrintings = [printing, ...otherPrintings]
  const englishPaper = allPrintings.filter((p) => !p.digital && (p.lang ?? 'en') === 'en')
  const firstPrinting = pickOldest(englishPaper)
  const newestPrinting = pickNewest(englishPaper)
  const legalityByFormat = new Map(legalities.map((l) => [l.format, l.legality]))
  const legalityLine = FEATURED_FORMATS
    .filter((f) => legalityByFormat.has(f.key))
    .map((f) => `${f.label}: ${legalityByFormat.get(f.key)}`)

  const faqs = buildFaqs({
    cardName, oracle, printing, englishPaper,
    firstPrinting, newestPrinting, legalityByFormat, market, setName,
  })

  // FAQPage rich results were retired by Google in 2026. We keep the
  // visible FAQ block for humans but no longer emit FAQPage JSON-LD.

  return (
    <section aria-label="About this card and FAQ" style={{ display: 'grid', gap: 24 }}>
      {/* About card */}
      <div style={{
        padding: 20, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, boxShadow: '0 3px 10px rgba(20,33,61,0.03)',
      }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>About this card</div>
        <h2 className="display" style={{ margin: 0, fontSize: 22, color: 'var(--text-strong)', lineHeight: 1.25 }}>
          {cardName}
        </h2>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
          <p style={{ margin: '0 0 8px' }}>
            {cardName} is {aOrAn(oracle.type_line)} {oracle.type_line ?? 'Magic: The Gathering card'}
            {oracle.mana_cost ? `, with mana cost ${prettyManaCost(oracle.mana_cost)}` : ''}
            {oracle.mana_value !== null && oracle.mana_value !== undefined ? ` (mana value ${oracle.mana_value})` : ''}.
            {englishPaper.length > 1 && ` Printed ${englishPaper.length} times across MTG sets.`}
          </p>
          {legalityLine.length > 0 && (
            <p style={{ margin: '0 0 8px' }}>Format legality: {legalityLine.join(', ')}.</p>
          )}
          {market && market.currentPrice !== null && (
            <p style={{ margin: 0 }}>
              Current headline price on {providerLabel(market.basis.provider)}: {market.currencySymbol}{market.currentPrice.toFixed(2)}
              {market.d30.pct_delta !== null && ` (${market.d30.pct_delta >= 0 ? 'up' : 'down'} ${Math.abs(market.d30.pct_delta * 100).toFixed(1)}% over 30 days)`}.
            </p>
          )}
        </div>
      </div>

      {/* FAQ */}
      {faqs.length > 0 && (
        <div style={{
          padding: 20, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, boxShadow: '0 3px 10px rgba(20,33,61,0.03)',
        }}>
          <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>Frequently asked</div>
          <h2 className="display" style={{ margin: 0, fontSize: 22, color: 'var(--text-strong)' }}>
            {cardName} FAQ
          </h2>
          <div style={{ marginTop: 12, display: 'grid', gap: 4 }}>
            {faqs.map((f) => (
              <details key={f.q} style={{
                padding: '10px 12px',
                borderTop: '1px solid var(--border)',
              }}>
                <summary style={{
                  cursor: 'pointer', fontWeight: 700, color: 'var(--text-strong)',
                  fontSize: 14.5, listStyle: 'none',
                }}>{f.q}</summary>
                <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {f.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Structured data (BreadcrumbList only). FAQPage was removed
          after Google retired FAQ rich results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd(cardName, printing, setName, canonical)) }}
      />
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────

type FaqEntry = { q: string; a: string }

function buildFaqs(ctx: {
  cardName: string
  oracle: MtgOracleCard
  printing: MtgPrinting
  englishPaper: MtgPrinting[]
  firstPrinting: MtgPrinting | null
  newestPrinting: MtgPrinting | null
  legalityByFormat: Map<string, string>
  market: CardMarketSummary | null
  setName: string
}): FaqEntry[] {
  const faqs: FaqEntry[] = []
  const { cardName, oracle, englishPaper, firstPrinting, newestPrinting, legalityByFormat, market } = ctx

  // Q: How much is X worth?
  if (market && market.currentPrice !== null) {
    const sym = market.currencySymbol
    const parts: string[] = []
    parts.push(`The current ${providerLabel(market.basis.provider)} ${market.basis.currency} ${market.basis.priceType} price for ${cardName} is ${sym}${market.currentPrice.toFixed(2)}.`)
    if (market.d30.pct_delta !== null) {
      const dir = market.d30.pct_delta >= 0 ? 'up' : 'down'
      parts.push(`It is ${dir} ${Math.abs(market.d30.pct_delta * 100).toFixed(1)}% over the last ${market.d30.spanDays} days.`)
    }
    if (market.d90.high !== null && market.d90.low !== null) {
      parts.push(`Over 90 days it has ranged from ${sym}${market.d90.low.toFixed(2)} to ${sym}${market.d90.high.toFixed(2)}.`)
    }
    faqs.push({ q: `How much is ${cardName} worth?`, a: parts.join(' ') })
  }

  // Q: Cheapest printing?
  if (market && market.cheapest) {
    faqs.push({
      q: `What is the cheapest printing of ${cardName}?`,
      a: `The cheapest currently priced paper printing is from ${market.cheapest.set_name} at ${market.currencySymbol}${market.cheapest.price.toFixed(2)} on ${providerLabel(market.basis.provider)}.`,
    })
  }

  // Q: Most expensive printing?
  if (market && market.mostExpensive && market.cheapest && market.mostExpensive.printing_id !== market.cheapest.printing_id) {
    faqs.push({
      q: `What is the most expensive printing of ${cardName}?`,
      a: `The most expensive currently priced paper printing is from ${market.mostExpensive.set_name} at ${market.currencySymbol}${market.mostExpensive.price.toFixed(2)} on ${providerLabel(market.basis.provider)}.`,
    })
  }

  // Q: How many printings?
  if (englishPaper.length >= 2) {
    faqs.push({
      q: `How many printings of ${cardName} are there?`,
      a: `${cardName} has been printed ${englishPaper.length} times in English paper sets that MTGPrices tracks.`,
    })
  }

  // Q: First printing / oldest
  if (firstPrinting && firstPrinting.released_at) {
    faqs.push({
      q: `What set was ${cardName} first printed in?`,
      a: `The earliest English paper printing that MTGPrices tracks is from ${prettySetOf(firstPrinting)}, released ${firstPrinting.released_at}.`,
    })
  }

  // Q: Newest printing
  if (newestPrinting && newestPrinting.released_at && firstPrinting?.id !== newestPrinting.id) {
    faqs.push({
      q: `What is the newest printing of ${cardName}?`,
      a: `The most recent English paper printing that MTGPrices tracks is from ${prettySetOf(newestPrinting)}, released ${newestPrinting.released_at}.`,
    })
  }

  // Q: Foil version.
  if (market?.foilPremium) {
    const p = market.foilPremium
    const sign = p.pct >= 0 ? 'more expensive' : 'less expensive'
    faqs.push({
      q: `Is there a foil version of ${cardName}?`,
      a: `Yes. On this printing, foil copies trade at ${market.currencySymbol}${p.foil.toFixed(2)} versus ${market.currencySymbol}${p.nonfoil.toFixed(2)} for nonfoil, which is ${Math.abs(p.pct * 100).toFixed(0)}% ${sign} on ${providerLabel(market.basis.provider)}.`,
    })
  }

  // Q: Format legality (Commander / Modern / Standard highlights).
  for (const fmt of ['commander', 'modern', 'standard'] as const) {
    const label = fmt === 'commander' ? 'Commander' : fmt === 'modern' ? 'Modern' : 'Standard'
    const leg = legalityByFormat.get(fmt)
    if (!leg) continue
    const answer =
      leg === 'legal'      ? `Yes, ${cardName} is currently legal in ${label} per Scryfall's legality feed.`
      : leg === 'banned'    ? `No, ${cardName} is currently banned in ${label} per Scryfall's legality feed.`
      : leg === 'restricted' ? `${cardName} is currently restricted in ${label} per Scryfall's legality feed. Restricted cards may be included in decks only in limited copies.`
      : leg === 'not_legal'  ? `${cardName} is not currently legal in ${label} per Scryfall's legality feed.`
      : null
    if (!answer) continue
    faqs.push({ q: `Is ${cardName} legal in ${label}?`, a: answer })
  }

  // Q: What does the card do?
  if (oracle.oracle_text) {
    faqs.push({
      q: `What does ${cardName} do?`,
      a: `${cardName} is ${aOrAn(oracle.type_line)} ${oracle.type_line ?? 'card'}${oracle.mana_cost ? ` with mana cost ${prettyManaCost(oracle.mana_cost)}` : ''}. Its Oracle text reads: "${oracle.oracle_text.replace(/\s+/g, ' ').trim()}".`,
    })
  }

  // Trim to a sensible number so the section stays useful.
  return faqs.slice(0, 8)
}

function breadcrumbLd(cardName: string, printing: MtgPrinting, setName: string, canonical: string) {
  const origin = new URL(canonical).origin
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Sets', item: `${origin}/browse` },
      { '@type': 'ListItem', position: 2, name: setName, item: `${origin}/set/${printing.set_code}` },
      { '@type': 'ListItem', position: 3, name: cardName, item: canonical },
    ],
  }
}

function pickOldest(rows: MtgPrinting[]): MtgPrinting | null {
  const dated = rows.filter((r) => r.released_at)
  if (dated.length === 0) return null
  return dated.reduce((min, r) => (r.released_at! < min.released_at! ? r : min))
}
function pickNewest(rows: MtgPrinting[]): MtgPrinting | null {
  const dated = rows.filter((r) => r.released_at)
  if (dated.length === 0) return null
  return dated.reduce((max, r) => (r.released_at! > max.released_at! ? r : max))
}
function prettySetOf(p: MtgPrinting) {
  return `${p.set_code.toUpperCase()}${p.collector_number ? ` #${p.collector_number}` : ''}`
}
function aOrAn(type: string | null | undefined): string {
  if (!type) return 'a'
  const first = type.trim()[0]?.toLowerCase()
  return 'aeiou'.includes(first ?? '') ? 'an' : 'a'
}
function providerLabel(p: 'tcgplayer' | 'cardkingdom' | 'cardmarket' | 'manapool' | 'cardhoarder'): string {
  switch (p) {
    case 'tcgplayer': return 'TCGplayer'
    case 'cardkingdom': return 'Card Kingdom'
    case 'cardmarket': return 'Cardmarket'
    case 'manapool': return 'ManaPool'
    case 'cardhoarder': return 'Cardhoarder'
  }
}
function prettyManaCost(cost: string): string {
  // Present as "{2}{U}{U}" style rather than parsing into pips. Callers
  // that want pips render <ManaCost /> instead.
  return cost.replace(/\s+/g, '')
}
