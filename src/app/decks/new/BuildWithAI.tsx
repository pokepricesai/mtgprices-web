'use client'
// "Build with AI" preview flow. Never saves without user confirmation
// — the /save endpoint re-runs the deterministic validator on the
// user-confirmed contents.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildCardSlug } from '@/lib/mtg/slug'

type Card = {
  id: string
  name: string
  mana_cost: string | null
  type_line: string | null
  printing?: { image_uri_small: string | null; set_code: string; collector_number: string | null } | null
}

type ProposedDeck = {
  format: string
  summary: string
  commanders: Array<{ oracle_card_id: string; card: Card | null }>
  main: Array<{ oracle_card_id: string; quantity: number; reason?: string | null; card: Card | null }>
  warnings: string[]
}

type Props = {
  formats: Array<{ key: string; label: string; group: string; hasCommander: boolean; blurb: string }>
}

export default function BuildWithAI({ formats }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState('commander')
  const [brief, setBrief] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD')
  const [loading, setLoading] = useState(false)
  const [proposal, setProposal] = useState<{ proposed: ProposedDeck; validation: any; usage: any } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deckName, setDeckName] = useState('')

  async function draft() {
    setLoading(true)
    setError(null)
    setProposal(null)
    const res = await fetch('/api/decks/new-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        brief,
        owned_only: ownedOnly,
        budget_max: budget ? parseFloat(budget) : undefined,
        budget_currency: budget ? currency : undefined,
      }),
    })
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error === 'rate_limited' ? 'AI quota reached — try again tomorrow.' : (j.error ?? 'AI failed'))
      return
    }
    const j = await res.json()
    setProposal(j)
    setDeckName(brief.slice(0, 60) || `AI ${format} deck`)
  }

  async function save() {
    if (!proposal) return
    setSaving(true)
    setError(null)
    const res = await fetch('/api/decks/new-ai/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deckName || `AI ${format} deck`,
        format: proposal.proposed.format,
        commander_oracle_ids: proposal.proposed.commanders.map((c) => c.oracle_card_id),
        main: proposal.proposed.main.map((m) => ({ oracle_card_id: m.oracle_card_id, quantity: m.quantity })),
        summary: proposal.proposed.summary,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.validation ? 'The proposed deck failed the deterministic validator. Edit the brief and try again.' : (j.error ?? 'Save failed'))
      return
    }
    const j = await res.json()
    router.push(`/decks/${j.deck.id}`)
  }

  if (!open) {
    return (
      <div>
        <div className="label-mono" style={{ marginBottom: 6, color: 'var(--accent)' }}>OR — pre-launch AI (quota-limited)</div>
        <button type="button" onClick={() => setOpen(true)} style={{
          background: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)',
          padding: '10px 16px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>Build with AI instead</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div className="label-mono">Build with AI</div>
        <button type="button" onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>Hide</button>
      </div>
      <div style={{ padding: '6px 10px', background: 'var(--accent-soft)', color: 'var(--amber)', border: '1px solid rgba(160,129,63,0.28)', borderRadius: 8, fontSize: 11, marginBottom: 10 }}>
        AI proposes a deck. Nothing saves until you confirm. Every card comes from a real MTGPrices search.
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="label-mono">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} style={inputStyle}>
            {formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="label-mono">Brief</span>
          <textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)}
            placeholder='e.g. "casual mono-blue draw-go commander around a legendary wizard, keep missing cards under $50"'
            style={{ ...inputStyle, resize: 'vertical' }} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> Prefer cards I own
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as any)} style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: 78 }}>
              <option value="USD">USD $</option>
              <option value="EUR">EUR €</option>
            </select>
            <input type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Missing budget"
              style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', width: 140 }} />
          </div>
        </div>
        <button type="button" onClick={draft} disabled={loading || !brief.trim()} style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '11px 16px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>{loading ? 'Drafting… (up to 60s)' : 'Draft a deck'}</button>
        {error && (
          <div style={{ padding: 10, background: 'rgba(180,65,70,0.10)', border: '1px solid rgba(180,65,70,0.28)', borderRadius: 8, color: 'var(--red)', fontSize: 12 }}>{error}</div>
        )}
      </div>

      {proposal && (
        <div style={{ marginTop: 18, padding: 12, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="label-mono">Proposed deck</div>
            <span style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: proposal.validation.ok ? 'rgba(43,134,89,0.14)' : 'rgba(180,65,70,0.14)',
              color: proposal.validation.ok ? 'var(--green)' : 'var(--red)',
            }}>{proposal.validation.ok ? 'Legal' : `${proposal.validation.issues.length} issue(s)`}</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text)', marginTop: 8, lineHeight: 1.55 }}>{proposal.proposed.summary}</p>
          {proposal.proposed.warnings && proposal.proposed.warnings.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12, color: 'var(--amber)' }}>
              {proposal.proposed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {proposal.validation.issues.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12, color: 'var(--red)' }}>
              {proposal.validation.issues.slice(0, 8).map((v: any, i: number) => <li key={i}>{v.message}</li>)}
            </ul>
          )}

          {proposal.proposed.commanders.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="label-mono" style={{ marginBottom: 6 }}>Commander</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {proposal.proposed.commanders.map((c) => <CardTile key={c.oracle_card_id} card={c.card} quantity={1} />)}
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div className="label-mono" style={{ marginBottom: 6 }}>Main ({proposal.proposed.main.reduce((n, m) => n + m.quantity, 0)})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {proposal.proposed.main.map((m) => <CardTile key={m.oracle_card_id} card={m.card} quantity={m.quantity} reason={m.reason ?? undefined} />)}
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="label-mono">Deck name</span>
              <input type="text" value={deckName} onChange={(e) => setDeckName(e.target.value)} style={inputStyle} />
            </label>
            <button type="button" onClick={save} disabled={saving || !proposal.validation.ok} style={{
              background: proposal.validation.ok ? 'var(--primary)' : 'var(--text-muted)',
              color: '#fff', border: 'none',
              padding: '11px 16px', borderRadius: 10, fontWeight: 700, fontSize: 14,
              cursor: saving || !proposal.validation.ok ? 'not-allowed' : 'pointer',
            }}>{saving ? 'Saving…' : proposal.validation.ok ? 'Save deck' : 'Fix issues before saving'}</button>
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {proposal.usage?.model} · {proposal.usage?.tokens_in}in / {proposal.usage?.tokens_out}out · est {(proposal.usage?.estimated_cost_cents / 100).toFixed(3)} USD · {proposal.usage?.latency_ms}ms
          </div>
        </div>
      )}
    </div>
  )
}

function CardTile({ card, quantity, reason }: { card: Card | null; quantity: number; reason?: string }) {
  if (!card) return <div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>×{quantity} (unknown)</div>
  const slug = card.printing?.collector_number ? buildCardSlug(card.printing.collector_number, card.name) : ''
  const href = slug ? `/set/${card.printing!.set_code}/card/${slug}` : '#'
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      display: 'grid', gridTemplateColumns: '38px 1fr', gap: 8, alignItems: 'center',
      padding: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
      textDecoration: 'none', color: 'var(--text)',
    }}>
      <div style={{ width: 38, aspectRatio: '5/7', background: 'var(--bg-light)', borderRadius: 4, overflow: 'hidden' }}>
        {card.printing?.image_uri_small ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.printing.image_uri_small} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>×{quantity} {card.name}</div>
        {reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>{reason}</div>}
      </div>
    </a>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)', borderRadius: 10,
  fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
