'use client'
// Deck-aware Card Finder inside the builder. NL box + structured
// toggles + owned/missing/exclude + capability chips. Every hit shows
// why-matched, owned count, deck-count, price, add-to-zone.

import { useMemo, useState } from 'react'
import { getFormatRule } from '@/lib/mtg/format-rules'
import type { DeckZone } from '@/lib/mtg/deck-rules'
import { CAPABILITY_LABELS, type CardCapability } from '@/lib/mtg/capabilities'
import { currencySymbol } from '@/lib/mtg/valuation.data'

type FinderCurrency = 'USD' | 'EUR'

type Hit = {
  oracle_card_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[] | null
  color_identity: string[] | null
  capabilities: CardCapability[]
  printing: {
    id: string
    set_code: string
    collector_number: string | null
    image_uri_small: string | null
    rarity: string | null
  }
  cheapest: { price: number; currency: string; provider: string } | null
  reasons: string[]
  ownedTotal: number
  copiesInDeck: number
}

type Props = {
  deckId: string
  deckFormat: string
  commanderColorIdentity: string[] | null
  onAdd: (oracleId: string, zone?: DeckZone) => void
  initialCaps?: CardCapability[]
}

const QUICK_CAPS: Array<{ key: CardCapability; label: string }> = [
  { key: 'card-draw', label: 'Draw' },
  { key: 'ramp', label: 'Ramp' },
  { key: 'creature-removal', label: 'Removal' },
  { key: 'board-wipe', label: 'Wipe' },
  { key: 'counter-spell', label: 'Counter' },
  { key: 'tutor', label: 'Tutor' },
  { key: 'token-creation', label: 'Tokens' },
  { key: 'protection', label: 'Protection' },
  { key: 'graveyard-interaction', label: 'Graveyard' },
]

export default function DeckSearchPanel({ deckId, deckFormat, commanderColorIdentity, onAdd, initialCaps }: Props) {
  const rule = getFormatRule(deckFormat)
  const [q, setQ] = useState('')
  const [caps, setCaps] = useState<Set<CardCapability>>(new Set(initialCaps ?? []))
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [missingOnly, setMissingOnly] = useState(false)
  const [excludeInDeck, setExcludeInDeck] = useState(true)
  const [mvMax, setMvMax] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [currency, setCurrency] = useState<FinderCurrency>('USD')
  const [hits, setHits] = useState<Hit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detected, setDetected] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  async function search() {
    setLoading(true)
    const res = await fetch(`/api/decks/${deckId}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: q.trim() || undefined,
        caps: caps.size > 0 ? Array.from(caps) : undefined,
        mvMax: mvMax ? parseInt(mvMax, 10) : undefined,
        priceMax: priceMax ? parseFloat(priceMax) : undefined,
        currency,
        ownedOnly, missingOnly, excludeInDeck,
      }),
    })
    setLoading(false)
    if (!res.ok) return
    const data = await res.json()
    setHits(data.hits ?? [])
    setTotal(data.total ?? 0)
    setDetected(data.parsed?.suggestions ?? [])
    setWarnings(data.parsed?.warnings ?? [])
  }

  function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, val: T) {
    setter((prev) => { const n = new Set(prev); if (n.has(val)) n.delete(val); else n.add(val); return n })
  }

  const activeFilterCount = (caps.size > 0 ? 1 : 0) + (mvMax ? 1 : 0) + (priceMax ? 1 : 0) + (ownedOnly ? 1 : 0) + (missingOnly ? 1 : 0)

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 14, position: 'sticky', top: 76,
    }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>Add cards</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Legal in <strong style={{ color: 'var(--text)' }}>{rule?.label ?? deckFormat}</strong>
        {commanderColorIdentity && commanderColorIdentity.length > 0 && (
          <> · commander identity <strong style={{ color: 'var(--text)' }}>{commanderColorIdentity.join('') || 'C'}</strong></>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); search() }} style={{ display: 'grid', gap: 8 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. "cheap card draw" or "counterspell under $5"'
          style={inputStyle}
        />
        {(detected.length > 0 || warnings.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {detected.map((s, i) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--primary-soft)', color: 'var(--primary)' }}>{s}</span>
            ))}
            {warnings.map((w, i) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--amber)' }}>{w}</span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {QUICK_CAPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(setCaps, c.key)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                background: caps.has(c.key) ? 'var(--primary)' : 'var(--bg-light)',
                color: caps.has(c.key) ? '#fff' : 'var(--text)',
                border: `1px solid ${caps.has(c.key) ? 'var(--primary)' : 'var(--border)'}`,
                fontWeight: 600,
              }}
            >{c.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <input type="number" min="0" max="20" value={mvMax} onChange={(e) => setMvMax(e.target.value)} placeholder="MV ≤" style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value as FinderCurrency)} style={{ ...inputStyle, flex: '0 0 76px', fontSize: 12 }}>
            <option value="USD">USD $</option>
            <option value="EUR">EUR €</option>
          </select>
          <input type="number" min="0" step="0.5" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="Price ≤" style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={ownedOnly} onChange={(e) => { setOwnedOnly(e.target.checked); if (e.target.checked) setMissingOnly(false) }} />
            Owned only
          </label>
          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={missingOnly} onChange={(e) => { setMissingOnly(e.target.checked); if (e.target.checked) setOwnedOnly(false) }} />
            Missing only
          </label>
          <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={excludeInDeck} onChange={(e) => setExcludeInDeck(e.target.checked)} />
            Hide already in deck
          </label>
        </div>

        <button type="submit" disabled={loading} style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '9px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}>{loading ? 'Searching…' : `Search${activeFilterCount ? ` (${activeFilterCount})` : ''}`}</button>
      </form>

      <div style={{ marginTop: 14, maxHeight: 620, overflowY: 'auto', paddingRight: 4 }}>
        {hits.length === 0 && !loading && (
          <div style={{ padding: 14, background: 'var(--bg-light)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
            Type a card name, pick a capability, or try "cheap card draw" / "counterspell under $5".
          </div>
        )}
        {hits.map((h) => (
          <ResultRow key={h.oracle_card_id} hit={h} rule={rule} onAdd={onAdd} />
        ))}
        {total > hits.length && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
            {total} matches, showing {hits.length}.
          </div>
        )}
      </div>
    </div>
  )
}

function ResultRow({ hit, rule, onAdd }: {
  hit: Hit
  rule: ReturnType<typeof getFormatRule>
  onAdd: (oracleId: string, zone?: DeckZone) => void
}) {
  const owned = hit.ownedTotal > 0
  const inDeck = hit.copiesInDeck
  const limit = rule?.singleton ? 1 : rule?.copiesLimit ?? 4
  const wouldExceed = inDeck >= limit

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 8,
      alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ width: 40, aspectRatio: '5/7', background: 'var(--bg-light)', borderRadius: 4, overflow: 'hidden' }}>
        {hit.printing.image_uri_small ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={hit.printing.image_uri_small} alt={hit.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.name}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hit.type_line}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
          {hit.cheapest && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {currencySymbol(hit.cheapest.currency)}{hit.cheapest.price.toFixed(2)}
            </span>
          )}
          {owned && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>own {hit.ownedTotal}</span>}
          {inDeck > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: wouldExceed ? 'var(--red)' : 'var(--primary)' }}>in deck {inDeck}/{limit}</span>}
        </div>
        {hit.reasons.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
            {hit.reasons.slice(0, 3).map((r, i) => (
              <span key={i} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999, background: 'var(--primary-soft)', color: 'var(--primary)' }}>{r}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          type="button"
          onClick={() => onAdd(hit.oracle_card_id, 'main')}
          disabled={wouldExceed}
          title={wouldExceed ? `Already at ${limit}-copy limit` : 'Add to main deck'}
          style={{ ...addBtn, opacity: wouldExceed ? 0.5 : 1, cursor: wouldExceed ? 'not-allowed' : 'pointer' }}
        >+ Deck</button>
        {rule?.hasCommander && (
          <button type="button" onClick={() => onAdd(hit.oracle_card_id, 'commander')} style={{ ...addBtn, color: 'var(--primary)' }}>+ Cmdr</button>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const addBtn: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
  background: 'var(--bg-light)', border: '1px solid var(--border)',
  color: 'var(--text)', cursor: 'pointer',
}
