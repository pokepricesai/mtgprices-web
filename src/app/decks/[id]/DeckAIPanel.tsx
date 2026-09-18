'use client'
// Task-focused AI surfaces on the deck page: Analyse Deck + Improve
// Deck. Never auto-applies changes, the user chooses per suggestion.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { buildCardSlug } from '@/lib/mtg/slug'
import { currencySymbol } from '@/lib/mtg/valuation.data'

type Card = {
  id: string
  name: string
  mana_cost: string | null
  type_line: string | null
  capabilities?: string[] | null
  printing?: { image_uri_small: string | null; set_code: string; collector_number: string | null } | null
}

type ImproveSuggestion = {
  remove_oracle_card_id: string | null
  add_oracle_card_id: string
  quantity: number
  reason: string
  add_card: Card | null
  remove_card: Card | null
}

type AnalyseResult = {
  analysis: {
    game_plan: string
    curve_notes: string
    capability_notes: string
    ownership_notes: string
    cost_notes: string
  }
  key_cards_hydrated: Array<{ oracle_card_id: string; evidence: string; card: Card | null }>
  usage: { model: string; tokens_in: number; tokens_out: number; estimated_cost_cents: number; latency_ms: number }
}

type Props = { deckId: string }

export default function DeckAIPanel({ deckId }: Props) {
  return (
    <div style={{
      padding: 14, background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 12, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="label-mono" style={{ marginBottom: 4 }}>AI · pre-launch, quota-limited</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Analyse or Improve this deck</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            AI reasons over MTGPrices data. It never invents cards, prices, or legality.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <AnalyseButton deckId={deckId} />
          <ImproveButton deckId={deckId} />
        </div>
      </div>
    </div>
  )
}

function AnalyseButton({ deckId }: { deckId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AnalyseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/decks/${deckId}/ai/analyse`, { method: 'POST' })
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error === 'rate_limited' ? 'AI quota reached, try again tomorrow.' : (j.error ?? 'AI failed'))
      return
    }
    const j = await res.json()
    setData(j)
    setOpen(true)
  }

  return (
    <>
      <button type="button" onClick={run} disabled={loading} style={btnSecondary}>
        {loading ? 'Thinking…' : 'Analyse Deck'}
      </button>
      {open && data && (
        <Modal onClose={() => setOpen(false)} title="Deck analysis">
          <AiTag>AI interpretation, verify against game rules</AiTag>
          <Section title="Game plan">{data.analysis.game_plan}</Section>
          <Section title="Mana curve">{data.analysis.curve_notes}</Section>
          <Section title="Capabilities">{data.analysis.capability_notes}</Section>
          <Section title="Ownership">{data.analysis.ownership_notes}</Section>
          <Section title="Cost">{data.analysis.cost_notes}</Section>
          {data.key_cards_hydrated.length > 0 && (
            <Section title="Key cards">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
                {data.key_cards_hydrated.map((k) => (
                  <div key={k.oracle_card_id} style={{ padding: 8, background: 'var(--bg-light)', borderRadius: 8, display: 'grid', gridTemplateColumns: '40px 1fr', gap: 8 }}>
                    <div style={{ width: 40, aspectRatio: '5/7', background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}>
                      {k.card?.printing?.image_uri_small ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={k.card.printing.image_uri_small} alt={k.card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : null}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{k.card?.name ?? 'unknown'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{k.evidence}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <UsageFooter usage={data.usage} />
        </Modal>
      )}
      {error && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: 10, background: 'rgba(180,65,70,0.12)', border: '1px solid rgba(180,65,70,0.28)', borderRadius: 8, color: 'var(--red)', fontSize: 12 }}>{error}</div>
      )}
    </>
  )
}

function ImproveButton({ deckId }: { deckId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [goal, setGoal] = useState('general')
  const [custom, setCustom] = useState('')
  const [data, setData] = useState<{ summary: string; suggestions: ImproveSuggestion[]; rejected: any[]; usage: any } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/decks/${deckId}/ai/improve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, custom: custom || undefined }),
    })
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error === 'rate_limited' ? 'AI quota reached, try again tomorrow.' : (j.error ?? 'AI failed'))
      return
    }
    const j = await res.json()
    setData(j)
    setOpen(true)
  }

  async function applySuggestion(sug: ImproveSuggestion) {
    setApplyingId(sug.add_oracle_card_id)
    const s = getSupabaseBrowserClient()

    if (sug.remove_oracle_card_id) {
      // Decrement or remove the target.
      const { data: existing } = await s.from('mtg_deck_cards')
        .select('id, quantity').eq('deck_id', deckId).eq('oracle_card_id', sug.remove_oracle_card_id).eq('zone', 'main').maybeSingle()
      if (existing) {
        if (existing.quantity <= sug.quantity) {
          await s.from('mtg_deck_cards').delete().eq('id', existing.id)
        } else {
          await s.from('mtg_deck_cards').update({ quantity: existing.quantity - sug.quantity }).eq('id', existing.id)
        }
      }
    }
    // Upsert add.
    const { data: existingAdd } = await s.from('mtg_deck_cards')
      .select('id, quantity').eq('deck_id', deckId).eq('oracle_card_id', sug.add_oracle_card_id).eq('zone', 'main').maybeSingle()
    if (existingAdd) {
      await s.from('mtg_deck_cards').update({ quantity: existingAdd.quantity + sug.quantity }).eq('id', existingAdd.id)
    } else {
      const { data: userRow } = await s.auth.getUser()
      await s.from('mtg_deck_cards').insert({
        deck_id: deckId, oracle_card_id: sug.add_oracle_card_id, quantity: sug.quantity, zone: 'main',
      })
    }
    setApplyingId(null)
    // Remove the applied suggestion from local state to signal completion.
    if (data) {
      setData({ ...data, suggestions: data.suggestions.filter((s) => s.add_oracle_card_id !== sug.add_oracle_card_id) })
    }
    router.refresh()
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btnPrimary}>Improve with AI</button>
      {open && (
        <Modal onClose={() => setOpen(false)} title="Improve deck with AI">
          {!data && (
            <>
              <AiTag>AI suggestions require your confirmation before any change is applied.</AiTag>
              <label style={{ display: 'grid', gap: 4, marginTop: 12 }}>
                <span className="label-mono">Goal</span>
                <select value={goal} onChange={(e) => setGoal(e.target.value)} style={inputStyle}>
                  <option value="general">General improvement</option>
                  <option value="budget">Lower budget</option>
                  <option value="collection">Use more cards I own</option>
                  <option value="more_draw">More card draw</option>
                  <option value="more_ramp">More ramp</option>
                  <option value="more_removal">More removal</option>
                  <option value="lower_curve">Lower mana curve</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, marginTop: 10 }}>
                <span className="label-mono">Custom brief (optional)</span>
                <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={3} placeholder="e.g. more instant-speed interaction" style={{ ...inputStyle, resize: 'vertical' }} />
              </label>
              <button type="button" onClick={run} disabled={loading} style={{ ...btnPrimary, marginTop: 14, width: '100%' }}>
                {loading ? 'Thinking…' : 'Get suggestions'}
              </button>
            </>
          )}
          {data && (
            <>
              <AiTag>AI interpretation, verify against game rules</AiTag>
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>{data.summary}</div>
              <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                {data.suggestions.length === 0 && (
                  <div style={{ padding: 12, background: 'var(--bg-light)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                    No changes to apply, deck already looks OK to the AI, or none of the suggestions survived grounding + validation.
                  </div>
                )}
                {data.suggestions.map((sug) => (
                  <div key={sug.add_oracle_card_id} style={{
                    padding: 10, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10,
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 10, alignItems: 'center' }}>
                      <SuggestionCard card={sug.remove_card} label="Remove" faded />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
                      <SuggestionCard card={sug.add_card} label={`Add ×${sug.quantity}`} />
                      <button
                        type="button"
                        onClick={() => applySuggestion(sug)}
                        disabled={applyingId === sug.add_oracle_card_id}
                        style={btnPrimary}
                      >{applyingId === sug.add_oracle_card_id ? 'Applying…' : 'Apply'}</button>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{sug.reason}</div>
                  </div>
                ))}
                {data.rejected && data.rejected.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--amber)' }}>{data.rejected.length} AI suggestion(s) rejected by grounding, click to view</summary>
                    <ul style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      {data.rejected.map((r: any, i: number) => <li key={i}>{r.reason}</li>)}
                    </ul>
                  </details>
                )}
              </div>
              <UsageFooter usage={data.usage} />
            </>
          )}
        </Modal>
      )}
      {error && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, padding: 10, background: 'rgba(180,65,70,0.12)', border: '1px solid rgba(180,65,70,0.28)', borderRadius: 8, color: 'var(--red)', fontSize: 12 }}>{error}</div>
      )}
    </>
  )
}

function SuggestionCard({ card, label, faded }: { card: Card | null; label: string; faded?: boolean }) {
  if (!card) {
    return (
      <div style={{ opacity: faded ? 0.4 : 1, fontSize: 11, color: 'var(--text-muted)' }}>{label}: ,</div>
    )
  }
  const slug = card.printing?.collector_number ? buildCardSlug(card.printing.collector_number, card.name) : ''
  const href = slug ? `/set/${card.printing!.set_code}/card/${slug}` : '#'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '38px 1fr', gap: 8, alignItems: 'center', opacity: faded ? 0.6 : 1 }}>
      <div style={{ width: 38, aspectRatio: '5/7', background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}>
        {card.printing?.image_uri_small ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.printing.image_uri_small} alt={card.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textDecoration: 'none' }}>{card.name}</a>
      </div>
    </div>
  )
}

function Modal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, background: 'rgba(23,32,58,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface)', borderRadius: 14, padding: 18,
        maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 60px rgba(23,32,58,0.18)', border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)' }} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AiTag({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '6px 10px', background: 'var(--accent-soft)', color: 'var(--amber)', border: '1px solid rgba(232,169,75,0.28)', borderRadius: 8, fontSize: 11, marginBottom: 4 }}>{children}</div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="label-mono" style={{ marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>{children}</div>
    </div>
  )
}

function UsageFooter({ usage }: { usage: { model: string; tokens_in: number; tokens_out: number; estimated_cost_cents: number; latency_ms: number } }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      {usage.model} · {usage.tokens_in}in / {usage.tokens_out}out · est {(usage.estimated_cost_cents / 100).toFixed(3)} USD · {usage.latency_ms}ms
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--primary)', color: '#fff', border: 'none',
  padding: '9px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
}
const btnSecondary: React.CSSProperties = {
  background: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)',
  padding: '8px 14px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
}
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)', borderRadius: 10,
  fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
}
