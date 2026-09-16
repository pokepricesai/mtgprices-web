'use client'

import Link from 'next/link'
import { useState } from 'react'
import ManaCost from '@/components/mtg/ManaCost'
import type { DeckCardContext } from '@/lib/mtg/deck-context'
import type { DeckZone } from '@/lib/mtg/deck-rules'
import { buildCardSlug } from '@/lib/mtg/slug'
import { currencySymbol, type ValuationBasis } from '@/lib/mtg/valuation.data'
import { getFormatRule } from '@/lib/mtg/format-rules'

type Props = {
  card: DeckCardContext
  currentZone: DeckZone
  format: string
  pricingBasis: ValuationBasis
  onIncrement: () => void
  onDecrement: () => void
  onRemove: () => void
  onMoveZone: (zone: DeckZone) => void
  onSetPreferredFinish: (printingFinishId: string | null) => void
}

export default function DeckCardRow(props: Props) {
  const { card, currentZone, pricingBasis } = props
  const [expanded, setExpanded] = useState(false)
  const rule = getFormatRule(props.format)
  const linkedSetCode = card.preferredPrinting?.set_code || card.owned.printings[0]?.set_code || null
  const linkedCollector = card.preferredPrinting?.collector_number || card.owned.printings[0]?.collector_number || null
  const cardHref = linkedSetCode && linkedCollector
    ? `/set/${linkedSetCode}/card/${buildCardSlug(linkedCollector, card.name)}`
    : null

  const ownedRelevant = card.preferredPrinting ? card.owned.ownedThisPrinting : card.owned.ownedQuantityAcrossPrintings
  const ownStatus = ownedRelevant >= card.quantity ? 'owned'
    : ownedRelevant > 0 ? 'partial'
    : 'missing'
  const ownColor = ownStatus === 'owned' ? 'var(--green)' : ownStatus === 'partial' ? 'var(--amber)' : 'var(--text-muted)'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 10, alignItems: 'center',
      padding: '6px 8px', borderRadius: 8, borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button type="button" onClick={props.onDecrement} style={miniBtn} aria-label="Decrement">–</button>
        <span style={{ minWidth: 22, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, fontSize: 14 }}>{card.quantity}</span>
        <button type="button" onClick={props.onIncrement} style={miniBtn} aria-label="Increment">+</button>
      </div>
      <div style={{ minWidth: 0 }}>
        {cardHref ? (
          <Link href={cardHref} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>{card.name}</Link>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{card.name}</span>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {card.mana_cost && <ManaCost cost={card.mana_cost} size={12} />}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{card.type_line}</span>
          {card.preferredPrinting && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {card.preferredPrinting.set_code.toUpperCase()} · #{card.preferredPrinting.collector_number} · {card.preferredPrinting.finish}
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        {card.currentPrice ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {currencySymbol(card.currentPrice.currency)}{(card.currentPrice.price * card.quantity).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {card.currentPrice.source === 'preferred' ? 'preferred' : 'cheapest'} · {card.currentPrice.provider}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no price</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: ownColor, fontWeight: 700, textTransform: 'uppercase' }}>
          {ownStatus === 'owned' ? '✓ owned' : ownStatus === 'partial' ? `${ownedRelevant}/${card.quantity}` : 'missing'}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse actions' : 'Expand actions'}
          style={{ ...miniBtn, minWidth: 26 }}
        >⋮</button>
      </div>
      {expanded && (
        <div style={{ gridColumn: '1 / -1', padding: '10px 4px 6px', borderTop: '1px solid var(--border)', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Zone:
            <select
              value={currentZone}
              onChange={(e) => props.onMoveZone(e.target.value as DeckZone)}
              style={{ ...pickerStyle, marginLeft: 6 }}
            >
              <option value="main">Main</option>
              {rule?.hasCommander && <option value="commander">Commander</option>}
              <option value="sideboard">Sideboard</option>
              <option value="companion">Companion</option>
              <option value="maybeboard">Maybeboard</option>
            </select>
          </label>
          {card.owned.printings.length > 0 && (
            <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Preferred printing:
              <select
                value={card.preferredPrinting?.printing_finish_id ?? ''}
                onChange={(e) => props.onSetPreferredFinish(e.target.value || null)}
                style={{ ...pickerStyle, marginLeft: 6 }}
              >
                <option value="">Any</option>
                {card.owned.printings.map((p) => (
                  <option key={p.printing_finish_id} value={p.printing_finish_id}>
                    {p.set_code.toUpperCase()} #{p.collector_number} · {p.finish} (own {p.quantity})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={props.onRemove} style={{ ...miniBtn, color: 'var(--red)', padding: '4px 10px' }}>Remove</button>
        </div>
      )}
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  padding: '2px 8px', fontSize: 12, fontWeight: 700,
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--bg-light)', color: 'var(--text)', cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

const pickerStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 6px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontFamily: 'inherit',
}
