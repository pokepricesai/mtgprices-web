'use client'

// src/app/ai/AskClient.tsx
// The interactive part of /ai. Textarea, prompt chips, deck selector,
// submit. Renders the AI's prose answer plus card widgets grounded to
// the oracle_card_ids the tools returned.

import { useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'

type Deck = { id: string; name: string; format: string }

type GroundedCard = {
  oracle_card_id: string
  name: string
  set_code: string
  collector_number: string | null
  image_uri_small: string | null
  card_href: string
}

type AskResponse =
  | { ok: true; text: string; grounded_cards: GroundedCard[]; usage: { opsUsed: number; opsLimit: number } }
  | { ok?: false; error: string; kind?: string; reason?: string; usedOps?: number; dailyOps?: number }

type Props = {
  signedIn: boolean
  decks: Deck[]
  examples: string[]
}

export default function AskClient({ signedIn, decks, examples }: Props) {
  const [prompt, setPrompt] = useState('')
  const [deckId, setDeckId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AskResponse | null>(null)

  async function submit(overridePrompt?: string) {
    const p = (overridePrompt ?? prompt).trim()
    if (!p) return
    if (!signedIn) {
      // Server also enforces this, but bounce early.
      window.location.href = `/login?next=${encodeURIComponent('/ai')}`
      return
    }
    setBusy(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: p, deck_id: deckId || undefined }),
      })
      const json = await res.json().catch(() => ({ error: 'invalid_json' }))
      setAnswer(json)
    } catch (err: any) {
      setAnswer({ error: String(err?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      {/* Input */}
      <div style={{
        padding: 16, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
      }}>
        <label htmlFor="ai-prompt" style={{
          display: 'block', fontSize: 12, fontWeight: 700,
          color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase',
          marginBottom: 6,
        }}>Your question</label>
        <textarea
          id="ai-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Find cheap black creature removal legal in Modern"
          rows={3}
          maxLength={1200}
          disabled={busy}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12,
            border: '1px solid var(--border)', background: 'var(--bg-light)',
            color: 'var(--text)', fontSize: 15, fontFamily: 'inherit',
            outline: 'none', resize: 'vertical', minHeight: 90, boxSizing: 'border-box',
          }}
        />
        <div style={{
          marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {signedIn && decks.length > 0 && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              Ask about a deck
              <select
                value={deckId}
                onChange={(e) => setDeckId(e.target.value)}
                disabled={busy}
                style={{
                  background: 'var(--surface)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit',
                }}
              >
                <option value="">(none)</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} · {d.format}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => submit()}
            disabled={busy || !prompt.trim()}
            className="btn btn-gold"
            style={{ marginLeft: 'auto' }}
          >{busy ? 'Asking…' : signedIn ? 'Ask MTGPrices' : 'Sign in to ask'}</button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setPrompt(ex); if (signedIn) submit(ex) }}
              disabled={busy}
              style={{
                padding: '6px 12px', borderRadius: 999,
                background: 'var(--bg-light)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 12, fontWeight: 600,
                cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >{ex}</button>
          ))}
        </div>
      </div>

      {/* Answer */}
      {busy && (
        <div style={{
          marginTop: 22, padding: 20, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14,
          color: 'var(--text-muted)', fontSize: 14,
        }}>
          Consulting the MTGPrices catalogue…
        </div>
      )}

      {answer && !busy && (
        <Answer answer={answer} />
      )}
    </div>
  )
}

function Answer({ answer }: { answer: AskResponse }) {
  if ('ok' in answer && answer.ok) {
    return (
      <div style={{ marginTop: 22, display: 'grid', gap: 16 }}>
        <div style={{
          padding: 22, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 16,
          boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
        }}>
          <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>Answer</div>
          <div style={{ fontSize: 15.5, lineHeight: 1.7, color: 'var(--text)' }}>
            <ReactMarkdown
              components={{
                p:  ({ node, ...rest }: any) => { void node; return <p style={{ margin: '0 0 12px' }} {...rest} /> },
                ul: ({ node, ...rest }: any) => { void node; return <ul style={{ margin: '0 0 12px', paddingLeft: 24 }} {...rest} /> },
                ol: ({ node, ...rest }: any) => { void node; return <ol style={{ margin: '0 0 12px', paddingLeft: 24 }} {...rest} /> },
                li: ({ node, ...rest }: any) => { void node; return <li style={{ margin: '3px 0' }} {...rest} /> },
                strong: ({ node, ...rest }: any) => { void node; return <strong style={{ color: 'var(--text-strong)' }} {...rest} /> },
                code: ({ node, ...rest }: any) => { void node; return <code style={{
                  padding: '1px 5px', borderRadius: 4,
                  background: 'var(--bg-light)', border: '1px solid var(--border)',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.9em',
                }} {...rest} /> },
                a:  ({ node, href, ...rest }: any) => { void node; return <a
                  href={href} {...rest}
                  style={{ color: 'var(--primary)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                /> },
              }}
            >{answer.text || '(no answer)'}</ReactMarkdown>
          </div>
        </div>

        {answer.grounded_cards.length > 0 && (
          <div style={{
            padding: 18, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 16,
          }}>
            <div className="label-mono" style={{ marginBottom: 10, color: 'var(--gold-600)' }}>
              Cards the answer referenced
            </div>
            <div style={{
              display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}>
              {answer.grounded_cards.map((c) => (
                <Link
                  key={c.oracle_card_id}
                  href={c.card_href}
                  className="card-hover card-hover-gold"
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: 10, borderRadius: 12,
                    background: 'var(--bg-light)', border: '1px solid var(--border)',
                    textDecoration: 'none', color: 'var(--text)',
                  }}
                >
                  {c.image_uri_small ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={c.image_uri_small} alt="" style={{ width: 34, height: 46, borderRadius: 5, objectFit: 'cover' }} />
                  ) : <span style={{ width: 34, height: 46, borderRadius: 5, background: 'var(--bg-strong)' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {c.set_code.toUpperCase()}{c.collector_number ? ` · #${c.collector_number}` : ''}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          Ops used today: {answer.usage.opsUsed} of {answer.usage.opsLimit}. Model: Sonnet 5 via Vercel AI Gateway.
        </div>
      </div>
    )
  }

  const err = answer as { error: string; reason?: string; usedOps?: number; dailyOps?: number; kind?: string }
  const isRateLimit = err.error === 'rate_limited'
  return (
    <div style={{
      marginTop: 22, padding: 20,
      background: 'var(--surface)', border: '1px solid var(--red-soft)', borderRadius: 14,
      color: 'var(--text)', fontSize: 14,
    }}>
      <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>Could not answer</div>
      {isRateLimit ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5 }}>
          You have used {err.usedOps} of {err.dailyOps} AI operations in the last 24 hours.
          The quota resets on a rolling window.
        </p>
      ) : err.error === 'unauthenticated' ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5 }}>
          Please sign in to use MTGPrices AI.
        </p>
      ) : err.error === 'ai_not_configured' ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5 }}>
          MTGPrices AI is not configured in this environment.
        </p>
      ) : (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5 }}>
          {err.error}{err.kind ? ` (${err.kind})` : ''}. Try rephrasing or asking about a specific card.
        </p>
      )}
    </div>
  )
}
