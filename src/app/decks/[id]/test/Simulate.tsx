'use client'
// Monte Carlo dashboard. All simulation is browser-side, no round
// trips, no AI. Every probability is annotated with iteration count
// and assumptions.

import { useMemo, useState } from 'react'
import type { ClientDeckMeta, ClientSimCard, ClientSimLibrary } from './page'
import { runMonteCarlo, type MCSpec, type MCResult, type PlayOrDraw, type MulliganRule } from '@/lib/mtg/simulation/montecarlo'
import { buildSimLibrary } from '@/lib/mtg/simulation/library'
import { CAPABILITY_LABELS, CAPABILITY_TAGS, type CardCapability } from '@/lib/mtg/capabilities'

const CAPABILITY_CHOICES: CardCapability[] = ['card-draw', 'ramp', 'creature-removal', 'board-wipe', 'counter-spell', 'tutor', 'protection']

export default function Simulate({ deck, library, cardIndex }: {
  deck: ClientDeckMeta
  library: ClientSimLibrary
  cardIndex: Map<string, ClientSimCard>
}) {
  const [iterations, setIterations] = useState(1000)
  const [play, setPlay] = useState<PlayOrDraw>('play')
  const [firstDraws, setFirstDraws] = useState(deck.firstPlayerDrawsOnTurn1Default)
  const [caps, setCaps] = useState<CardCapability[]>(['card-draw', 'ramp', 'creature-removal'])
  const [trackId, setTrackId] = useState<string>('')
  const [mvThresholds, setMvThresholds] = useState<number[]>([2, 3, 4])
  const [mulliganOn, setMulliganOn] = useState(false)
  const [minLands, setMinLands] = useState(2)
  const [maxLands, setMaxLands] = useState(5)
  const [maxMulligans, setMaxMulligans] = useState(3)
  const [result, setResult] = useState<MCResult | null>(null)
  const [running, setRunning] = useState(false)

  // Build a runnable SimLibrary from the projected client library (we
  // reuse buildSimLibrary since ClientSimCard is a superset, the
  // classifier already ran server-side and lives on `classification`).
  const runnableLib = useMemo(() => {
    return buildSimLibrary({
      cards: library.entries.map((e) => ({
        zone: 'main',
        quantity: e.quantity,
        oracle: {
          oracle_card_id: e.card.oracle_card_id,
          name: e.card.name,
          mana_cost: e.card.mana_cost,
          mana_value: e.card.mana_value,
          type_line: e.card.type_line,
          colors: e.card.colors,
          color_identity: e.card.color_identity,
          capabilities: e.card.capabilities as any,
          produced_mana: e.card.produced_mana,
          oracle_text: e.card.oracle_text,
        },
      })),
    })
  }, [library])

  function runSim() {
    setRunning(true)
    // requestAnimationFrame keeps the UI responsive between clicks.
    setTimeout(() => {
      const spec: MCSpec = {
        library: runnableLib,
        iterations,
        play,
        firstPlayerDrawsOnTurn1: firstDraws,
        trackOracleId: trackId || undefined,
        trackCapabilities: caps,
        trackMVLeq: mvThresholds,
        mulligan: mulliganOn ? { minLands, maxLands, maxMulligans } as MulliganRule : undefined,
      }
      const r = runMonteCarlo(spec)
      setResult(r)
      setRunning(false)
    }, 0)
  }

  // Card options for the "track this card" dropdown, one entry per
  // distinct oracle in the library (commanders excluded, they aren't
  // in the shuffle).
  const cardOptions = useMemo(() => {
    return library.entries.map((e) => ({ id: e.card.oracle_card_id, name: e.card.name, quantity: e.quantity }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [library])

  return (
    <section>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 14 }}>
        <Field label="Iterations">
          <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))} style={select}>
            {[100, 1000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
          </select>
        </Field>
        <Field label="Turn order">
          <select value={play} onChange={(e) => setPlay(e.target.value as PlayOrDraw)} style={select}>
            <option value="play">On the play</option>
            <option value="draw">On the draw</option>
          </select>
        </Field>
        <Field label={`First player draws turn 1${deck.hasCommander ? ' (Commander default: yes)' : ' (constructed default: no)'}`}>
          <select value={firstDraws ? 'yes' : 'no'} onChange={(e) => setFirstDraws(e.target.value === 'yes')} style={select}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        <Field label="Track a specific card">
          <select value={trackId} onChange={(e) => setTrackId(e.target.value)} style={select}>
            <option value="">, none ,</option>
            {cardOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.quantity > 1 ? ` (${c.quantity})` : ''}</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>Capabilities to track</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CAPABILITY_CHOICES.map((cap) => {
            const on = caps.includes(cap)
            return (
              <button
                key={cap}
                type="button"
                onClick={() => setCaps((prev) => on ? prev.filter((k) => k !== cap) : prev.concat(cap))}
                style={{
                  padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: on ? 'var(--primary)' : 'var(--bg-light)',
                  color: on ? '#fff' : 'var(--text)',
                  border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 999,
                }}
              >{CAPABILITY_LABELS[cap] ?? cap}</button>
            )
          })}
        </div>
      </div>

      <div style={{ marginBottom: 14, padding: 12, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={mulliganOn} onChange={(e) => setMulliganOn(e.target.checked)} />
          Apply user-defined mulligan rule
        </label>
        {mulliganOn && (
          <div style={{ marginTop: 8, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <Field label="Min lands"><input type="number" min={0} max={7} value={minLands} onChange={(e) => setMinLands(Number(e.target.value))} style={select} /></Field>
            <Field label="Max lands"><input type="number" min={0} max={7} value={maxLands} onChange={(e) => setMaxLands(Number(e.target.value))} style={select} /></Field>
            <Field label="Max mulligans"><input type="number" min={0} max={6} value={maxMulligans} onChange={(e) => setMaxMulligans(Number(e.target.value))} style={select} /></Field>
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          This is your rule, not an optimal-mulligan model.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button onClick={runSim} disabled={running} type="button" style={{
          padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: running ? 'wait' : 'pointer',
          background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10,
        }}>{running ? 'Running…' : `Run ${iterations.toLocaleString()} simulations`}</button>
      </div>

      {result && <Results r={result} cardIndex={cardIndex} trackId={trackId} />}
    </section>
  )
}

function Results({ r, cardIndex, trackId }: { r: MCResult; cardIndex: Map<string, ClientSimCard>; trackId: string }) {
  const trackName = trackId ? cardIndex.get(trackId)?.name ?? '(unknown)' : null
  return (
    <div>
      <div style={{ padding: 10, background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <b style={{ color: 'var(--text)' }}>Based on {r.spec.iterations.toLocaleString()} simulated draws</b>, {r.spec.play === 'play' ? 'on the play' : 'on the draw'}. {r.spec.firstPlayerDrawsOnTurn1 ? 'First player draws turn 1.' : 'First player skips turn-1 draw.'} Library {r.spec.librarySize} cards. Wall {r.wallMs}ms.
        <br />
        {r.spec.assumptions.map((a, i) => <span key={i}>• {a}<br /></span>)}
      </div>

      <h3 style={h3}>Opening-hand land distribution</h3>
      <BarBlock probs={r.openingHandLands.probabilities} labels={r.openingHandLands.probabilities.map((_, i) => i === 7 ? '7' : String(i))} />
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
        Average lands in opener: {r.openingHandLands.averageLands.toFixed(2)}
      </div>

      <h3 style={h3}>Land-drop availability by turn</h3>
      <PctTable rows={r.landDropByTurn.map((x) => ({ label: `by turn ${x.turn}`, value: x.p }))} tail={`P(≥ T lands available by end of turn T). Cards seen, not cards cast, see the Mana tab for colour / untapped analysis.`} />

      {r.cardByTurn && (
        <>
          <h3 style={h3}>Specific card: {trackName}</h3>
          <PctTable rows={r.cardByTurn.map((x) => ({ label: `by turn ${x.turn}`, value: x.p }))} tail={`P(≥1 copy of ${trackName} seen by end of turn T).`} />
        </>
      )}

      {r.capabilityByTurn.length > 0 && (
        <>
          <h3 style={h3}>Capability draw probability</h3>
          {r.capabilityByTurn.map((c) => (
            <div key={c.capability} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginBottom: 4 }}>{CAPABILITY_LABELS[c.capability] ?? c.capability}</div>
              <PctInline rows={c.probs.map((x) => ({ label: `T${x.turn}`, value: x.p }))} />
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 18 }}>
            P(≥1 card carrying this capability seen by end of turn T). Availability only.
          </div>
        </>
      )}

      {r.mvByTurn.length > 0 && (
        <>
          <h3 style={h3}>Curve availability (non-land)</h3>
          {r.mvByTurn.map((m) => (
            <div key={m.threshold} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, marginBottom: 4 }}>MV ≤ {m.threshold}</div>
              <PctInline rows={m.probs.map((x) => ({ label: `T${x.turn}`, value: x.p }))} />
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 18 }}>
            P(≥1 non-land card with mana value ≤ threshold seen by end of turn T).
          </div>
        </>
      )}

      {r.mulliganCounts.some((c, i) => i > 0 && c > 0) && (
        <>
          <h3 style={h3}>Mulligan distribution</h3>
          <PctTable rows={r.mulliganCounts.map((c, i) => ({ label: `${i} mulligan${i === 1 ? '' : 's'}`, value: c / r.spec.iterations }))} tail={`Fraction of games that took N mulligans under the configured keep-rule.`} />
        </>
      )}
    </div>
  )
}

function BarBlock({ probs, labels }: { probs: number[]; labels: string[] }) {
  const max = Math.max(0.001, ...probs)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${probs.length}, 1fr)`, gap: 4, alignItems: 'end', marginBottom: 6 }}>
      {probs.map((p, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{(p * 100).toFixed(1)}%</div>
          <div style={{ width: '80%', height: 4 + Math.round((p / max) * 68), background: 'var(--primary)', borderRadius: 4, opacity: p > 0 ? 1 : 0.15 }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{labels[i]}</div>
        </div>
      ))}
    </div>
  )
}

function PctTable({ rows, tail }: { rows: Array<{ label: string; value: number }>; tail?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{r.label}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>{(r.value * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tail && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{tail}</div>}
    </div>
  )
}

function PctInline({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ padding: '4px 8px', background: 'var(--bg-light)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>{r.label} </span>
          <b style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{(r.value * 100).toFixed(1)}%</b>
        </div>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  )
}
const fieldLabel: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }
const select: React.CSSProperties = { fontSize: 13, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-light)', color: 'var(--text)' }
const h3: React.CSSProperties = { margin: '18px 0 6px', fontFamily: 'Outfit, ui-sans-serif, system-ui', fontSize: 15 }

// silence
void CAPABILITY_TAGS
