// app/browse/page.tsx, list every non-digital MTG set with filtering,
// sorting and per-set market intelligence (estimated value, 30D
// change, priced coverage, top card). The client component owns filter,
// sort and grouping UI. The server component fetches the sets plus the
// batched aggregates.

import type { Metadata } from 'next'
import { listSets } from '@/lib/mtg/sets'
import { getSetAggregates } from '@/lib/mtg/set-market-batch'
import BrowseClient from './BrowseClient'
import HubFaq, { A } from '@/components/mtg/HubFaq'

export const revalidate = 900   // 15 min

export const metadata: Metadata = {
  title: 'Browse MTG sets, filter by type and year',
  description: 'Every Magic: The Gathering set indexed by MTGPrices. Filter by type (expansion, commander, masters, promo) and year, sort by release date, name, size, estimated value or 30D change.',
  alternates: { canonical: 'https://mtgprices.io/browse' },
  openGraph: { url: 'https://mtgprices.io/browse' },
}

export default async function BrowsePage() {
  // No limit: /browse is the "every set" discovery hub. There are
  // ~600 public-type non-digital sets today; sending them all is well
  // under 100 kB of JSON once trimmed. The prior 800 cap combined
  // with client-side type filtering was silently dropping older
  // public sets (RAV etc.) whenever the newest-800 slice was full of
  // tokens and other excluded types.
  const rawSets = await listSets({ limit: 2000 })
  const sets = rawSets.map(pickBrowseFields)
  const aggregates = await getSetAggregates(sets.map((s) => s.code))

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div className="mtg-page-hero">
        <div className="mtg-mana-crest right" aria-hidden />
        <div className="mtg-arcane-veil" aria-hidden />
        <div style={{ position: 'relative' }}>
          <div className="label-mono">Browse</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 26, letterSpacing: '-0.015em' }}>Magic sets</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 6, maxWidth: 720, lineHeight: 1.6, fontSize: 14 }}>
            {sets.length.toLocaleString()} sets indexed. Filter by set type (expansion, commander,
            masters, promo, and more) or by release year. Sort by release date, name, size,
            estimated value or 30 day change. Set values are cheapest nonfoil TCGplayer USD retail
            per printing.
          </p>
        </div>
      </div>
      <BrowseClient
        sets={sets}
        aggregates={Object.fromEntries(Array.from(aggregates.entries()).map(([k, v]) => [k, v]))}
      />

      <HubFaq
        heading="About MTG sets on MTGPrices"
        entries={[
          {
            q: 'What sets are indexed here?',
            a: (
              <>
                Every public-type English paper Magic set. Expansions, core sets,
                Commander products, Masters/Masterpiece reprint sets, Secret Lair drops,
                promos, and starter/duel/from-the-vault products all appear. Digital-only
                and Alchemy sets are excluded because their prices do not map to paper.
                We currently list {sets.length.toLocaleString()} sets.
              </>
            ),
          },
          {
            q: 'How is set value calculated?',
            a: (
              <>
                Value is the sum of the cheapest nonfoil TCGplayer USD retail price for every
                English paper printing in the set. Cards without a current price on that basis
                are counted as un-priced and reported separately, never imputed to zero. Foil
                and etched premiums are intentionally not blended into the basket. See the
                methodology footer on any set page for the exact rule.
              </>
            ),
          },
          {
            q: 'Why do some sets show a much larger card count than expected?',
            a: (
              <>
                Secret Lair (SLD), Special Guests (SPG), and other collector-oriented product
                lines share a single set code but ship hundreds of separately-numbered printings.
                We count every distinct collector number.
              </>
            ),
          },
          {
            q: 'How can I browse a specific format instead of a specific set?',
            a: (
              <>
                Use the <A href="/card-finder">Card Finder</A> with a legality filter to see every
                card that is legal in a given format. Or open <A href="/formats">Formats</A> for
                per-format overviews and banlists.
              </>
            ),
          },
          {
            q: 'Where does the imagery come from?',
            a: (
              <>
                Card and set-symbol imagery is served via Scryfall. Prices and printing metadata
                are ingested from TCGplayer, Card Kingdom, Cardmarket, ManaPool, Cardhoarder,
                and MTGJSON. Attribution is in the site footer.
              </>
            ),
          },
        ]}
      />
    </div>
  )
}

// Trim MtgSet to exactly the fields the tile renders + filter/sort
// uses. Cuts ~40% off the serialized payload versus shipping the
// whole catalogue row per set.
function pickBrowseFields(s: import('@/lib/mtg/sets').MtgSet) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    set_type: s.set_type,
    released_at: s.released_at,
    card_count: s.card_count,
    icon_svg_uri: s.icon_svg_uri,
  }
}
