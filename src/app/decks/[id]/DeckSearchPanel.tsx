'use client'

import { useState } from 'react'
import { getFormatRule } from '@/lib/mtg/format-rules'
import type { DeckZone } from '@/lib/mtg/deck-rules'

type Hit = {
  oracle_card_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[] | null
  color_identity: string[] | null
  image_uri_small: string | null
  set_code: string
  collector_number: string | null
  reasons: string[]
}

type Props = {
  deckFormat: string
  commanderColorIdentity: string[] | null
  onAdd: (oracleId: string, zone?: DeckZone) => void
}

const QUICK_CAPS: Array<{ key: string; label: string }> = [
  { key: 'card-draw', label: 'Draw' },
  { key: 'ramp', label: 'Ramp' },
  { key: 'creature-removal', label: 'Removal' },
  { key: 'board-wipe', label: 'Board wipe' },
  { key: 'counter-spell', label: 'Counterspell' },
  { key: 'tutor', label: 'Tutor' },
  { key: 'token-creation', label: 'Tokens' },
  { key: 'protection', label: 'Protection' },
  { key: 'graveyard-interaction', label: 'Graveyard' },
]

export default function DeckSearchPanel({ deckFormat, commanderColorIdentity, onAdd }: Props) {
  const rule = getFormatRule(deckFormat)
  const [q, setQ] = useState('')
  const [caps, setCaps] = useState<Set<string>>(new Set())
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  async function runSearch() {
    setLoading(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set('name', q.trim())
    if (caps.size > 0) params.set('caps', Array.from(caps).join(','))
    if (deckFormat) params.set('legal', deckFormat)
    if (commanderColorIdentity && commanderColorIdentity.length > 0) {
      params.set('identity', commanderColorIdentity.join(','))
    }
    const res = await fetch(`/api/decks/search?${params.toString()}`)
    setLoading(false)
    if (!res.ok) return
    const data = await res.json()
    setHits(data.hits ?? [])
    setTotal(data.total ?? 0)
  }

  function toggleCap(c: string) {
    setCaps((prev) => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n })
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 14, position: 'sticky', top: 76,
    }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>Add cards</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Legal in <strong style={{ color: 'var(--text)' }}>{rule?.label ?? deckFormat}</strong>
        {commanderColorIdentity && commanderColorIdentity.length > 0 && (
          <> · commander identity <strong style={{ color: 'var(--text)' }}>{commanderColorIdentity.join('')}</strong></>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); runSearch() }} style={{ display: 'grid', gap: 8 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Card name — e.g. Ramp, Sol Ring"
          style={{
            padding: '10px 12px', border: '1px solid var(--border)',
            background: 'var(--bg-light)', color: 'var(--text)',
            borderRadius: 10, fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {QUICK_CAPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleCap(c.key)}
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
        <button type="submit" disabled={loading} style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '9px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}>{loading ? 'Searching…' : 'Search'}</button>
      </form>

      <div style={{ marginTop: 14, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}>
        {hits.length === 0 && !loading && (
          <div style={{ padding: 14, background: 'var(--bg-light)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
            Search a card name or pick a capability to see legal cards for this deck.
          </div>
        )}
        {hits.map((h) => (
          <div key={h.oracle_card_id} style={{
            display: 'grid', gridTemplateColumns: '38px 1fr auto', gap: 10,
            alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ width: 38, aspectRatio: '5/7', background: 'var(--bg-light)', borderRadius: 4, overflow: 'hidden' }}>
              {h.image_uri_small ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.image_uri_small} alt={h.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
              ) : null}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.type_line}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" onClick={() => onAdd(h.oracle_card_id, 'main')} style={addBtn}>+ Deck</button>
              {rule?.hasCommander && (
                <button type="button" onClick={() => onAdd(h.oracle_card_id, 'commander')} style={{ ...addBtn, color: 'var(--primary)' }}>+ Cmdr</button>
              )}
            </div>
          </div>
        ))}
        {total > hits.length && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
            Showing {hits.length} of {total} matches. Narrow with a card name or fewer capabilities.
          </div>
        )}
      </div>
    </div>
  )
}

const addBtn: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
  background: 'var(--bg-light)', border: '1px solid var(--border)',
  color: 'var(--text)', cursor: 'pointer',
}
