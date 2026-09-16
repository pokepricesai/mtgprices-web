// app/set/[setCode]/page.tsx — one MTG set, filter/sort-enabled grid.
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSetByCode } from '@/lib/mtg/sets'
import { listPrintingsForSet } from '@/lib/mtg/cards'
import { getHeadlinePricesByPrinting, getFinishesByPrinting } from '@/lib/mtg/prices'
import SetGridClient, { type SetGridPrinting } from '@/components/mtg/SetGridClient'

export const revalidate = 300

type Params = { setCode: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { setCode } = await params
  const set = await getSetByCode(setCode)
  if (!set) return { title: 'Set not found' }
  const canonical = `https://mtgprices.io/set/${set.code}`
  return {
    title: `${set.name} — MTG prices`,
    description: `Every card in ${set.name} with live paper prices, images and Scryfall metadata. Filter by rarity, colour, type and finish.`,
    alternates: { canonical },
    openGraph: { url: canonical },
  }
}

export default async function SetPage({ params }: { params: Promise<Params> }) {
  const { setCode } = await params
  const set = await getSetByCode(setCode)
  if (!set) notFound()

  const printings = await listPrintingsForSet(set.code)
  const printingIds = printings.map((p) => p.id)
  const [headlineMap, finishesMap] = await Promise.all([
    getHeadlinePricesByPrinting(printingIds),
    getFinishesByPrinting(printingIds),
  ])

  const items: SetGridPrinting[] = printings.map((p) => ({
    id: p.id,
    name: p.name,
    set_code: p.set_code,
    collector_number: p.collector_number,
    rarity: p.rarity,
    image_uri_small: p.image_uri_small,
    released_at: p.released_at,
    finishes: finishesMap.get(p.id) ?? [],
    colors: p.oracle_colors,
    type_line: p.oracle_type_line,
    price: headlineMap.get(p.id) ?? null,
  }))

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 64px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          {set.icon_svg_uri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={set.icon_svg_uri} alt="" aria-hidden style={{ width: 26, height: 26, filter: 'invert(85%)' }} />
          ) : null}
          <span className="label-mono">{set.code}</span>
          {set.set_type && <span className="label-mono" style={{ color: 'var(--accent)' }}>{set.set_type.replace(/_/g, ' ')}</span>}
        </div>
        <h1 style={{ margin: 0, fontSize: 30 }}>{set.name}</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {set.released_at && <span>Released {set.released_at}</span>}
          {set.card_count != null && <span>{set.card_count.toLocaleString()} cards</span>}
          {set.block && <span>{set.block}</span>}
          <span>{printings.length.toLocaleString()} printings indexed</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>
          No printings for this set are indexed yet.
        </div>
      ) : (
        <SetGridClient setCode={set.code} printings={items} />
      )}
    </div>
  )
}
