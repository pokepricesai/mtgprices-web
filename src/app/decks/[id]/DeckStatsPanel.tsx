'use client'

import type { DeckContext } from '@/lib/mtg/deck-context'
import { CAPABILITY_LABELS, type CardCapability } from '@/lib/mtg/capabilities'

export default function DeckStatsPanel({ ctx }: { ctx: DeckContext }) {
  const typeEntries = Object.entries(ctx.typeBreakdown).filter(([, v]) => v > 0)
  const capEntries = Object.entries(ctx.capabilityBreakdown).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 8)
  const maxCurve = Math.max(1, ...ctx.curve)
  const ci = ctx.colorIdentity

  const totalMain = ctx.totals.main
  const nonLandMV = ctx.main
    .filter((c) => !c.types.includes('land'))
    .reduce((acc, c) => { acc.total += (c.mana_value ?? 0) * c.quantity; acc.count += c.quantity; return acc }, { total: 0, count: 0 })
  const avgMV = nonLandMV.count > 0 ? (nonLandMV.total / nonLandMV.count) : 0

  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div className="label-mono" style={{ marginBottom: 10 }}>Deck stats</div>

      {/* Numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6, marginBottom: 12 }}>
        <Mini label="Main" v={String(totalMain)} />
        {ctx.totals.sideboard > 0 && <Mini label="Side" v={String(ctx.totals.sideboard)} />}
        {ctx.totals.commander > 0 && <Mini label="Cmdr" v={String(ctx.totals.commander)} />}
        <Mini label="Avg MV" v={avgMV.toFixed(1)} />
        {ci.length > 0 && <Mini label="ID" v={ci.join('') || 'C'} />}
      </div>

      {/* Type breakdown */}
      {typeEntries.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Types</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {typeEntries.map(([t, v]) => (
              <span key={t} style={chip}>{t[0].toUpperCase() + t.slice(1)} <b style={{ marginLeft: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</b></span>
            ))}
          </div>
        </div>
      )}

      {/* Curve */}
      {maxCurve > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Mana curve (non-land main)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, alignItems: 'end' }}>
            {ctx.curve.map((n, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{
                  width: '100%', height: 4 + Math.round((n / maxCurve) * 44),
                  background: 'var(--primary)', borderRadius: 4, opacity: n > 0 ? 1 : 0.15,
                }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{i === 7 ? '7+' : i}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      {capEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>Capabilities in main</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {capEntries.map(([cap, n]) => (
              <span key={cap} style={{ ...chip, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid rgba(104,65,230,0.25)' }}>
                {CAPABILITY_LABELS[cap as CardCapability] ?? cap} <b style={{ marginLeft: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{n}</b>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Mini({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--bg-light)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</div>
    </div>
  )
}

const chip: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 999,
  background: 'var(--bg-light)', color: 'var(--text)',
  border: '1px solid var(--border)', fontWeight: 500,
}
