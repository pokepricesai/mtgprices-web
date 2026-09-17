'use client'
// Mana analysis: colour-source composition vs mana-cost pressure.
// Deliberately conservative — categorises rocks, mana creatures, and
// conditional lands separately from basic + non-basic-untapped.

import { useMemo } from 'react'
import type { ClientSimLibrary } from './page'
import { aggregateSources, aggregateColourPressure, type Classification } from '@/lib/mtg/simulation/mana'

const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const

export default function ManaAnalysis({ library }: { library: ClientSimLibrary }) {
  const sources = useMemo(() => {
    const rows: Array<{ classification: Classification; quantity: number }> = library.entries.map((e) => ({ classification: e.card.classification, quantity: e.quantity }))
    return aggregateSources(rows)
  }, [library])

  const pressure = useMemo(() => {
    // Include commanders in colour pressure (they cost mana) but NOT
    // in the library's mana base (they aren't in the shuffle).
    const entries = [
      ...library.entries.map((e) => ({
        mana_cost: e.card.mana_cost, quantity: e.quantity, is_land: e.card.classification.is_land,
      })),
      ...library.commanders.map((c) => ({ mana_cost: c.mana_cost, quantity: 1, is_land: c.classification.is_land })),
    ]
    return aggregateColourPressure(entries)
  }, [library])

  const totalPressure = pressure.W + pressure.U + pressure.B + pressure.R + pressure.G

  return (
    <section>
      <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
        This panel is deterministic and conservative. Mana rocks, mana creatures, ramp spells and conditional lands
        are NOT rolled into untapped-turn-1 coloured sources. See each category below for its assumption.
      </div>

      <h3 style={h3}>Composition</h3>
      <table style={table}>
        <tbody>
          {[
            { key: 'basic_land', label: 'Basic lands', tail: 'Always untapped, always produces their named colour.' },
            { key: 'nonbasic_untapped', label: 'Non-basic lands (untapped default)', tail: 'Shock lands, duals, City of Brass — enter untapped in the default player line.' },
            { key: 'nonbasic_conditional', label: 'Non-basic lands (conditional / enters tapped)', tail: 'Tap-lands, check-lands, fetch lands — real lands, not counted as turn-1 coloured sources.' },
            { key: 'colourless_land', label: 'Colourless lands', tail: 'Lands producing only colourless (Wastes / utility lands).' },
            { key: 'mana_rock', label: 'Mana rocks', tail: 'Non-land artifact mana. Not equivalent to a turn-1 land.' },
            { key: 'mana_creature', label: 'Mana creatures', tail: 'Creatures that tap for mana. Summoning sickness first turn.' },
            { key: 'ramp_spell', label: 'Ramp spells', tail: 'Non-land ramp effects (Cultivate, Rampant Growth). Cast-and-then-mana next turn.' },
          ].map((r) => (
            <tr key={r.key} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{r.label}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>{(sources.by_category as any)[r.key] ?? 0}</td>
              <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>{r.tail}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border)' }}>
            <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 700 }}>Total lands (all categories)</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>{sources.total_lands}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <h3 style={h3}>Colour sources (untapped-turn-1)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 6 }}>
        {COLOURS.map((c) => (
          <div key={c} style={{ padding: '8px 10px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{sources.by_colour_untapped[c]}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
        Basic + non-basic untapped only. Conditional lands, mana rocks and mana creatures are shown separately above.
      </div>

      <h3 style={h3}>All lands by colour (includes conditional)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 14 }}>
        {[...COLOURS, 'C' as const].map((c) => (
          <div key={c} style={{ padding: '8px 10px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{sources.by_colour_all_lands[c]}</div>
          </div>
        ))}
      </div>

      <h3 style={h3}>Mana-cost pressure (deck × pip count)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 6 }}>
        {COLOURS.map((c) => (
          <div key={c} style={{ padding: '8px 10px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{pressure[c].toFixed(1)}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {totalPressure > 0 ? `${((pressure[c] / totalPressure) * 100).toFixed(0)}%` : '—'}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 18 }}>
        Coloured mana symbols across all non-land cards (commanders included). Hybrid symbols split evenly between the two colours.
        This is factual pressure — compare against the untapped sources above. We do NOT claim a "correct" count of coloured sources.
      </div>
    </section>
  )
}

const h3: React.CSSProperties = { margin: '16px 0 6px', fontFamily: 'Outfit, ui-sans-serif, system-ui', fontSize: 15 }
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 6 }
