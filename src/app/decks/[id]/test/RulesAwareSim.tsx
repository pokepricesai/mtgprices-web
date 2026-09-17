'use client'
// Rules-aware simulation surface. Gated on
// NEXT_PUBLIC_RULES_ENGINE_ENABLED — parent decides whether to render.
//
// This is a Phase 4B.2 v1: no AI interpretation, factual reporting
// only. Every displayed number carries the engine name + version.

import { useEffect, useState } from 'react'
import type { ClientDeckMeta } from './page'

type Job = {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  engine: string
  engine_version: string | null
  seed: number | null
  requested_iterations: number
  format: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  result: null | {
    engine?: { name: string; version: string }
    aggregate?: {
      total: number; p1_wins: number; p2_wins: number; draws: number; unknown: number
      win_rate_p1: number; avg_turns?: number | null; avg_duration_ms?: number | null
    }
    games?: Array<any>
  }
}

type DeckOption = { id: string; name: string; format: string }

export default function RulesAwareSim({ deck }: { deck: ClientDeckMeta }) {
  const [decks, setDecks] = useState<DeckOption[]>([])
  const [opponentId, setOpponentId] = useState('')
  const [iterations, setIterations] = useState(10)
  const [seed, setSeed] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState<Array<{ oracle_card_id: string; name: string }> | null>(null)
  const [forgeRelease, setForgeRelease] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Fetch this user's decks so they can pick an opponent from among them.
    fetch('/api/decks').then(async (r) => r.ok ? r.json() : null).then((j) => {
      if (!j) return
      const list: DeckOption[] = (j.decks ?? []).filter((d: DeckOption) => d.id !== deck.id && d.format === deck.format)
      setDecks(list)
      if (list.length > 0) setOpponentId(list[0].id)
    }).catch(() => {})
  }, [deck.id, deck.format])

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return
    const t = setInterval(async () => {
      const r = await fetch(`/api/simulate/jobs/${job.id}`)
      if (!r.ok) return
      const j = await r.json()
      setJob(j.job)
    }, 3000)
    return () => clearInterval(t)
  }, [job])

  async function submit() {
    setError(null); setUnsupported(null); setForgeRelease(null); setBusy(true); setJob(null)
    try {
      const body = {
        opponent_deck_id: opponentId,
        iterations,
        seed: seed ? Number(seed) : undefined,
      }
      const res = await fetch(`/api/decks/${deck.id}/simulate/rules-aware`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.error === 'unsupported_cards' && Array.isArray(j.unsupported_cards)) {
          setUnsupported(j.unsupported_cards)
          setForgeRelease(j.forge_release ?? null)
          return
        }
        setError(j.error === 'rate_limited' ? 'Daily rules-aware quota reached.'
                : j.error === 'rules_engine_disabled' ? 'Rules-aware simulation is not yet available in this environment.'
                : (j.reason ?? j.error ?? 'submit failed'))
        return
      }
      const j = await res.json()
      setJob(j.job)
    } finally {
      setBusy(false)
    }
  }

  const agg = job?.result?.aggregate
  const engineLabel = job?.result?.engine ? `${job.result.engine.name} ${job.result.engine.version}`
    : job?.engine ? `${job.engine} ${job.engine_version ?? ''}`.trim()
    : 'forge'

  return (
    <section>
      <div style={{ padding: 10, background: 'var(--amber-soft, rgba(160,129,63,0.10))', color: 'var(--amber, #a0813f)', border: '1px solid rgba(160,129,63,0.28)', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
        Phase 4B preview. Rules-aware simulation runs against a real MTG rules engine (Forge).
        Numbers below describe THIS matchup and THIS engine version only — not a universal win rate.
      </div>

      {decks.length === 0 && (
        <div style={{ padding: 12, background: 'var(--bg-light)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          You need at least one other deck in the same format ({deck.formatLabel}) to simulate against.
        </div>
      )}

      {decks.length > 0 && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={fieldLabel}>Opposing deck</span>
            <select value={opponentId} onChange={(e) => setOpponentId(e.target.value)} style={select}>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={fieldLabel}>Games</span>
            <select value={iterations} onChange={(e) => setIterations(Number(e.target.value))} style={select}>
              <option value={1}>1</option>
              <option value={10}>10</option>
              <option value={100}>100</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={fieldLabel}>Seed (optional)</span>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="424242" style={select} />
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !opponentId || (!!job && job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled')}
        style={{
          padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10,
        }}
      >{busy ? 'Submitting…' : 'Run rules-aware simulation'}</button>

      {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      {unsupported && unsupported.length > 0 && (
        <div style={{ marginTop: 10, padding: 12, background: 'var(--red-soft, rgba(184,60,60,0.10))', border: '1px solid rgba(184,60,60,0.28)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
          <b>{forgeRelease ?? 'Forge'} does not currently support {unsupported.length} card{unsupported.length === 1 ? '' : 's'} in these decks:</b>
          <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
            {unsupported.map((c) => <li key={c.oracle_card_id}>{c.name}</li>)}
          </ul>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            Very recently released cards and Un-set jokes are the usual cause. We do not silently drop cards — remove them from both decks or wait for a Forge release that adds them.
          </div>
        </div>
      )}

      {job && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            Job {job.id.slice(0, 8)}  ·  status: <b style={{ color: job.status === 'done' ? 'var(--green)' : job.status === 'failed' ? 'var(--red)' : 'var(--text)' }}>{job.status}</b>
            {job.seed != null && `  ·  seed ${job.seed}`}
            {`  ·  ${job.requested_iterations} game${job.requested_iterations === 1 ? '' : 's'}`}
            {`  ·  engine ${engineLabel}`}
          </div>
          {job.status === 'failed' && (
            <div style={{ fontSize: 13, color: 'var(--red)' }}>Simulation failed: {job.error ?? '(unknown)'}</div>
          )}
          {job.status === 'done' && agg && (
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Outfit, ui-sans-serif, system-ui' }}>
                Your deck won {agg.p1_wins} of {agg.total} simulated games ({(agg.win_rate_p1 * 100).toFixed(1)}%).
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {agg.p2_wins} to opposing deck. {agg.draws} draw{agg.draws === 1 ? '' : 's'}. {agg.unknown} inconclusive.
                {agg.avg_turns ? ` · avg game length ${agg.avg_turns.toFixed(1)} turns` : ''}
                {agg.avg_duration_ms ? ` · avg engine wall ${(agg.avg_duration_ms).toFixed(0)}ms` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Result reflects THIS opposing deck vs THIS deck, running under {engineLabel}. Not a general "deck win rate".
              </div>
            </div>
          )}
          {(job.status === 'queued' || job.status === 'running') && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Waiting for worker to pick up the job. This can take up to a few minutes for large runs.
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const fieldLabel: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }
const select: React.CSSProperties = { fontSize: 13, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-light)', color: 'var(--text)' }
