'use client'
// Full printing picker for a deck card. Splits Owned vs Other printings.
// Owned printings are always preferred visually. Every option is a
// real mtg_printing_finishes row — never invented.

import { useEffect, useState } from 'react'

type Option = {
  printing_finish_id: string
  set_code: string
  collector_number: string | null
  released_at: string | null
  rarity: string | null
  finish: string
  image_uri_small: string | null
  owned_quantity: number
  price: { provider: string; price: number; currency: string } | null
}

type Props = {
  deckId: string
  deckCardId: string
  onPicked: (printingFinishId: string | null) => void
  onClose: () => void
}

export default function PrintingPicker({ deckId, deckCardId, onPicked, onClose }: Props) {
  const [owned, setOwned] = useState<Option[]>([])
  const [other, setOther] = useState<Option[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/decks/${deckId}/cards/${deckCardId}/printings`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (cancelled || !j) return
        setOwned(j.owned ?? [])
        setOther(j.other ?? [])
        setCurrent(j.current_printing_finish_id ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [deckId, deckCardId])

  function currencyPrefix(c: string) { return c === 'EUR' ? '€' : c === 'USD' ? '$' : '' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40,
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto',
          background: 'var(--surface)', borderRadius: 14, padding: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.24)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontFamily: 'Outfit, ui-sans-serif, system-ui', fontSize: 20 }}>Choose printing</h3>
          <button type="button" onClick={onClose} style={miniBtn}>Close</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
          The chosen printing controls what's shown on the deck and used for exact-printing purchasing. The gameplay identity of the card is unchanged.
        </div>
        {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading printings…</div>}

        {!loading && (
          <>
            <div style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => onPicked(null)}
                style={{ ...pickBtn, borderColor: !current ? 'var(--primary)' : 'var(--border)' }}
              >Any printing (unset)</button>
            </div>

            {owned.length > 0 && (
              <>
                <div style={sectionLabel}>Owned printings</div>
                <div style={grid}>
                  {owned.map((o) => (
                    <PickCard key={o.printing_finish_id} o={o} current={current} onPick={() => onPicked(o.printing_finish_id)} currencyPrefix={currencyPrefix} />
                  ))}
                </div>
              </>
            )}

            {other.length > 0 && (
              <>
                <div style={sectionLabel}>Other printings</div>
                <div style={grid}>
                  {other.map((o) => (
                    <PickCard key={o.printing_finish_id} o={o} current={current} onPick={() => onPicked(o.printing_finish_id)} currencyPrefix={currencyPrefix} />
                  ))}
                </div>
              </>
            )}

            {owned.length === 0 && other.length === 0 && (
              <div style={{ padding: 12, background: 'var(--bg-light)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                No printings are indexed for this card.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PickCard({ o, current, onPick, currencyPrefix }: {
  o: Option; current: string | null; onPick: () => void; currencyPrefix: (c: string) => string
}) {
  const selected = current === o.printing_finish_id
  return (
    <button
      type="button"
      onClick={onPick}
      style={{
        display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 10, alignItems: 'center',
        padding: '8px 10px', textAlign: 'left', cursor: 'pointer',
        background: selected ? 'var(--primary-soft, rgba(104,65,230,0.10))' : 'var(--bg-light)',
        border: `1px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 8,
      }}
    >
      {o.image_uri_small ? (
        <img src={o.image_uri_small} alt="" style={{ width: 48, height: 68, objectFit: 'cover', borderRadius: 4 }} />
      ) : (
        <div style={{ width: 48, height: 68, background: 'var(--border)', borderRadius: 4 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {o.set_code.toUpperCase()} #{o.collector_number ?? '?'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span>{o.finish}</span>
          {o.rarity && <span>·  {o.rarity}</span>}
          {o.released_at && <span>· {o.released_at.slice(0, 4)}</span>}
          {o.owned_quantity > 0 && <span style={{ color: 'var(--green)', fontWeight: 700 }}>· own {o.owned_quantity}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {o.price
          ? `${currencyPrefix(o.price.currency)}${o.price.price.toFixed(2)}`
          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </div>
    </button>
  )
}

const miniBtn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  background: 'transparent', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6,
}
const pickBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  background: 'var(--bg-light)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6, marginRight: 8,
}
const sectionLabel: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4,
  marginTop: 14, marginBottom: 6,
}
const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8,
}
