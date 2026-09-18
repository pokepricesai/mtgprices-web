'use client'

// src/components/mtg/CardActionsStrip.tsx
// Prominent action strip that sits with the card price panel. Wraps
// Add to Collection and Add to Deck (both existing components) in a
// tidier presentation, and surfaces an "Owned X" badge when the
// viewer is signed in and holds copies.

import AddToCollection from './AddToCollection'
import AddToDeck from './AddToDeck'

type Props = {
  cardName: string
  oracleId: string
  finishes: { id: string; finish: 'nonfoil' | 'foil' | 'etched' }[]
  preferredFinishId: string | null
  ownedTotal?: number
  ownedThisPrinting?: number
}

export default function CardActionsStrip({
  cardName, oracleId, finishes, preferredFinishId,
  ownedTotal = 0, ownedThisPrinting = 0,
}: Props) {
  const anyOwned = ownedTotal > 0 || ownedThisPrinting > 0
  return (
    <div
      style={{
        padding: 14,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        display: 'grid', gap: 12,
        boxShadow: '0 3px 12px rgba(20,33,61,0.04)',
      }}
    >
      {anyOwned && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '4px 10px', borderRadius: 999,
            fontSize: 12, fontWeight: 800,
            background: 'var(--green-soft)', color: 'var(--green)',
            border: '1px solid rgba(42,132,89,0.30)',
          }}>You own {ownedTotal}</span>
          {ownedThisPrinting > 0 && ownedThisPrinting !== ownedTotal && (
            <span style={{
              padding: '4px 10px', borderRadius: 999,
              fontSize: 11.5, fontWeight: 600,
              background: 'var(--bg-light)', color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}>{ownedThisPrinting} of this printing</span>
          )}
        </div>
      )}
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        <div>
          <div className="label-mono" style={{ marginBottom: 6, color: 'var(--gold-600)' }}>Collect</div>
          <AddToCollection finishes={finishes} cardName={cardName} />
        </div>
        <div>
          <div className="label-mono" style={{ marginBottom: 6, color: 'var(--primary-strong)' }}>Play</div>
          <AddToDeck
            oracleId={oracleId}
            cardName={cardName}
            preferredFinishId={preferredFinishId}
          />
        </div>
      </div>
    </div>
  )
}
