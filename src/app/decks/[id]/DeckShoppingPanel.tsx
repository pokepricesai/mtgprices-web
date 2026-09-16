'use client'
// Owner-only shopping list. Deterministic — fetches missing-card data
// from /api/decks/[id]/shopping. Never touches AI.

import { useEffect, useMemo, useState } from 'react'
import type { ShoppingList, MissingLine } from '@/lib/mtg/shopping'

type Props = { deckId: string }

export default function DeckShoppingPanel({ deckId }: Props) {
  const [mode, setMode] = useState<'cheapest_playable' | 'preferred'>('cheapest_playable')
  const [data, setData] = useState<ShoppingList | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedOracle, setExpandedOracle] = useState<string | null>(null)
  const [copied, setCopied] = useState<'list' | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/decks/${deckId}/shopping?mode=${mode}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled) { setData(j?.shopping ?? null); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [deckId, mode])

  async function copyList() {
    if (!data) return
    const lines = data.lines.map((l) => `${l.missing} ${l.name}`)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied('list'); setTimeout(() => setCopied(null), 1200)
    } catch { /* ignore */ }
  }

  function currencyPrefix(c: string) { return c === 'EUR' ? '€' : c === 'USD' ? '$' : '' }

  const totals = data?.totals
  const noneMissing = data && data.lines.length === 0

  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="label-mono">Missing cards / Shopping</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            style={{
              fontSize: 12, padding: '4px 8px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)',
            }}
          >
            <option value="cheapest_playable">Cheapest playable</option>
            <option value="preferred">Preferred printing</option>
          </select>
        </div>
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Calculating…</div>}

      {noneMissing && (
        <div style={{ padding: 12, background: 'var(--green-soft, rgba(60,158,105,0.10))', color: 'var(--green)', borderRadius: 8, fontSize: 13 }}>
          You already own every card in this deck ✓
        </div>
      )}

      {data && data.lines.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, marginBottom: 10 }}>
            <Mini label="Distinct" v={String(totals?.distinctMissing ?? 0)} />
            <Mini label="Copies" v={String(totals?.totalCopiesMissing ?? 0)} />
            <Mini
              label={`Total (${data.basis.provider} ${data.basis.currency})`}
              v={totals?.estimatedCost != null && totals.estimatedCost > 0
                ? `${currencyPrefix(data.basis.currency)}${totals.estimatedCost.toFixed(2)}`
                : '—'}
            />
            {(totals?.linesWithoutPrice ?? 0) > 0 && <Mini label="No price" v={String(totals!.linesWithoutPrice)} />}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={copyList} style={btnSecondary}>{copied === 'list' ? 'Copied ✓' : 'Copy list'}</button>
            <a
              href={`/api/decks/${deckId}/shopping?mode=${mode}&format=csv`}
              style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}
              target="_blank"
              rel="noreferrer"
            >Download CSV</a>
          </div>

          <div style={{ background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)' }}>
            {data.lines.map((l) => (
              <div key={l.oracle_card_id} style={{ borderBottom: '1px solid var(--border)' }}>
                <ShoppingRow
                  line={l}
                  currency={data.basis.currency}
                  expanded={expandedOracle === l.oracle_card_id}
                  onToggle={() => setExpandedOracle((cur) => cur === l.oracle_card_id ? null : l.oracle_card_id)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ShoppingRow({ line, currency, expanded, onToggle }: {
  line: MissingLine; currency: string; expanded: boolean; onToggle: () => void
}) {
  function currencyPrefix(c: string) { return c === 'EUR' ? '€' : c === 'USD' ? '$' : '' }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 10, padding: '8px 10px', alignItems: 'center' }}>
        <span style={{ minWidth: 22, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, fontSize: 14, color: 'var(--red)' }}>{line.missing}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{line.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>need {line.needed} · own {line.owned}</span>
            {line.chosen.set_code && <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{line.chosen.set_code.toUpperCase()} · #{line.chosen.collector_number} · {line.chosen.finish}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 90 }}>
          {line.price ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {currencyPrefix(line.price.currency)}{(line.price.price * line.missing).toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{line.price.provider}</div>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no price</span>
          )}
        </div>
        <button type="button" onClick={onToggle} aria-label={expanded ? 'Hide providers' : 'Show providers'} style={miniBtn}>{expanded ? '▲' : '▼'}</button>
      </div>
      {expanded && (
        <div style={{ padding: '8px 12px 12px', background: 'var(--surface)' }}>
          {line.providerRows.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No provider prices indexed.</div>
          )}
          {line.providerRows.length > 0 && (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px', fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: '4px 6px', fontWeight: 600 }}>Printing</th>
                  <th style={{ padding: '4px 6px', fontWeight: 600 }}>Finish</th>
                  <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Price</th>
                  <th style={{ padding: '4px 6px', fontWeight: 600 }}>Currency</th>
                </tr>
              </thead>
              <tbody>
                {line.providerRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.provider}</td>
                    <td style={{ padding: '4px 6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.set_code.toUpperCase()} #{r.collector_number}</td>
                    <td style={{ padding: '4px 6px' }}>{r.finish}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{r.price.toFixed(2)}</td>
                    <td style={{ padding: '4px 6px' }}>{r.currency} · {r.price_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {line.purchaseLinks.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {line.purchaseLinks.map((pl) => (
                <a
                  key={pl.url}
                  href={pl.url}
                  target="_blank"
                  rel="noreferrer nofollow"
                  style={{
                    padding: '4px 10px', fontSize: 12, fontWeight: 700,
                    background: 'var(--bg-light)', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: 6, textDecoration: 'none',
                  }}
                >Buy on {pl.label} →</a>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function Mini({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ padding: '6px 8px', background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</div>
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, cursor: 'pointer',
  background: 'var(--bg-light)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 6,
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: 'transparent', color: 'var(--primary)',
  border: '1px solid var(--primary)', borderRadius: 8,
}

// silence unused
void useMemo
