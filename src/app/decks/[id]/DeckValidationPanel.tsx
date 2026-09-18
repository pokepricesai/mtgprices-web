'use client'

import type { DeckContext } from '@/lib/mtg/deck-context'
import { currencySymbol } from '@/lib/mtg/valuation.data'
import type { FormatRule } from '@/lib/mtg/format-rules'

type Props = {
  validation: DeckContext['validation']
  totals: DeckContext['totals']
  pricing: DeckContext['pricing']
  rule: FormatRule | null
}

export default function DeckValidationPanel({ validation, totals, pricing, rule }: Props) {
  const ok = validation.ok
  const totalIssues = validation.issues.length
  const totalWarnings = validation.warnings.length

  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div className="label-mono" style={{ marginBottom: 10 }}>Legality &amp; value</div>

      {/* State pill */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          padding: '4px 12px', borderRadius: 999, fontWeight: 800, fontSize: 12,
          background: ok ? 'rgba(43,134,89,0.14)' : 'rgba(180,65,70,0.14)',
          color: ok ? 'var(--green)' : 'var(--red)',
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>{ok ? 'Valid' : `${totalIssues} issue${totalIssues === 1 ? '' : 's'}`}</span>
        {totalWarnings > 0 && (
          <span style={{
            padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 12,
            background: 'var(--accent-soft)', color: 'var(--amber)',
          }}>{totalWarnings} warning{totalWarnings === 1 ? '' : 's'}</span>
        )}
      </div>

      {/* Value */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Deck value</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {currencySymbol(pricing.basis.currency)}{pricing.deckValue.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {pricing.basis.provider} · {pricing.basis.currency}
            {pricing.deckValueMissingEntries > 0 && ` · ${pricing.deckValueMissingEntries} without price`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Missing to buy</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {currencySymbol(pricing.basis.currency)}{pricing.missingCardsValue.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Issues + warnings */}
      {(validation.issues.length > 0 || validation.warnings.length > 0) && (
        <div style={{ display: 'grid', gap: 6, marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
          {validation.issues.map((i, idx) => (
            <div key={idx} style={{
              padding: '6px 10px', fontSize: 12, lineHeight: 1.5,
              background: 'rgba(180,65,70,0.10)', border: '1px solid rgba(180,65,70,0.25)',
              borderRadius: 6, color: 'var(--red)',
            }}><strong>{i.kind.replace(/_/g, ' ')}:</strong> {i.message}</div>
          ))}
          {validation.warnings.map((w, idx) => (
            <div key={idx} style={{
              padding: '6px 10px', fontSize: 12, lineHeight: 1.5,
              background: 'var(--accent-soft)', border: '1px solid rgba(232,169,75,0.28)',
              borderRadius: 6, color: 'var(--amber)',
            }}><strong>{w.kind.replace(/_/g, ' ')}:</strong> {w.message}</div>
          ))}
        </div>
      )}

      {/* Format rules blurb */}
      {rule && (
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <div className="label-mono" style={{ marginBottom: 4 }}>Rules</div>
          {rule.notes.map((n, i) => <div key={i}>· {n}</div>)}
        </div>
      )}
    </div>
  )
}
