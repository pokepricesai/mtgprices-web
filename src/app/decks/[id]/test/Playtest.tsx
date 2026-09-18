'use client'
// Manual goldfish sandbox. The system does NOT enforce Magic rules ,
// the player controls legal play. Zones + basic actions only.

import { useMemo, useState } from 'react'
import type { ClientDeckMeta, ClientSimCard, ClientSimLibrary } from './page'
import { makePrng, defaultSeed } from '@/lib/mtg/simulation/prng'
import { shuffle } from '@/lib/mtg/simulation/shuffle'

type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'commander'
const ZONES: Zone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'commander']

type PermanentInstance = {
  id: string
  card: ClientSimCard
  tapped: boolean
}

type PlaytestState = {
  turn: number
  life: number
  commanderTax: number
  seed: number
  library: ClientSimCard[]
  hand: ClientSimCard[]
  battlefield: PermanentInstance[]
  graveyard: ClientSimCard[]
  exile: ClientSimCard[]
  commander: ClientSimCard[]
  mulligans: number
  history: string[]
}

let INSTANCE_ID = 0
function pid() { return `inst-${++INSTANCE_ID}` }

export default function Playtest({ deck, library, cardIndex }: {
  deck: ClientDeckMeta; library: ClientSimLibrary; cardIndex: Map<string, ClientSimCard>
}) {
  const flatCards = useMemo(() => {
    const arr: ClientSimCard[] = []
    for (const e of library.entries) for (let i = 0; i < e.quantity; i++) arr.push(e.card)
    return arr
  }, [library])

  const [state, setState] = useState<PlaytestState>(() => newGame(flatCards, library.commanders))

  function log(next: PlaytestState, msg: string) {
    next.history = [msg, ...state.history].slice(0, 40)
  }

  function shuffleAll() {
    const seed = defaultSeed()
    const rng = makePrng(seed)
    const shuffled = shuffle(state.library, rng)
    const next = { ...state, seed, library: shuffled }
    log(next, `Shuffled library. Seed ${seed}.`)
    setState(next)
  }

  function drawN(n: number) {
    if (state.library.length === 0) return
    const drawn = state.library.slice(0, n)
    const next: PlaytestState = {
      ...state,
      library: state.library.slice(n),
      hand: state.hand.concat(drawn),
    }
    log(next, `Drew ${n} card${n === 1 ? '' : 's'}.`)
    setState(next)
  }

  function nextTurn() {
    // Untap all permanents. Draw 1 (skip on turn 1 if on the play, but
    // for the goldfish sandbox we just draw every turn to make life
    // easier. Users who want strict rule compliance can Undo.)
    const untapped = state.battlefield.map((p) => ({ ...p, tapped: false }))
    let library = state.library
    let hand = state.hand
    let drewMsg = ''
    if (library.length > 0) {
      hand = state.hand.concat([library[0]])
      library = library.slice(1)
      drewMsg = ` + drew ${hand[hand.length - 1].name}`
    }
    const next: PlaytestState = { ...state, turn: state.turn + 1, battlefield: untapped, library, hand }
    log(next, `Turn ${next.turn}. Untapped everything${drewMsg}.`)
    setState(next)
  }

  function moveHandToZone(cardIndexInHand: number, zone: Zone) {
    const c = state.hand[cardIndexInHand]
    const nextHand = state.hand.filter((_, i) => i !== cardIndexInHand)
    const next = { ...state, hand: nextHand }
    switch (zone) {
      case 'battlefield': next.battlefield = state.battlefield.concat([{ id: pid(), card: c, tapped: false }]); break
      case 'graveyard': next.graveyard = state.graveyard.concat([c]); break
      case 'exile': next.exile = state.exile.concat([c]); break
      case 'library': next.library = state.library.concat([c]); break
      default: break
    }
    log(next, `Moved ${c.name} from hand → ${zone}.`)
    setState(next)
  }

  function moveBattlefieldToZone(instanceId: string, zone: Zone) {
    const inst = state.battlefield.find((p) => p.id === instanceId)
    if (!inst) return
    const nextBf = state.battlefield.filter((p) => p.id !== instanceId)
    const next = { ...state, battlefield: nextBf }
    switch (zone) {
      case 'hand': next.hand = state.hand.concat([inst.card]); break
      case 'graveyard': next.graveyard = state.graveyard.concat([inst.card]); break
      case 'exile': next.exile = state.exile.concat([inst.card]); break
      case 'commander':
        if (deck.hasCommander) {
          next.commander = state.commander.concat([inst.card])
          next.commanderTax = state.commanderTax + 2
        } else next.commander = state.commander.concat([inst.card])
        break
      case 'library': next.library = state.library.concat([inst.card]); break
      default: break
    }
    log(next, `Moved ${inst.card.name} from battlefield → ${zone}.`)
    setState(next)
  }

  function toggleTap(instanceId: string) {
    const bf = state.battlefield.map((p) => p.id === instanceId ? { ...p, tapped: !p.tapped } : p)
    setState({ ...state, battlefield: bf })
  }

  function castCommander(index: number) {
    if (state.commander.length === 0) return
    const c = state.commander[index]
    const nextCmd = state.commander.filter((_, i) => i !== index)
    const bf = state.battlefield.concat([{ id: pid(), card: c, tapped: false }])
    const next = { ...state, commander: nextCmd, battlefield: bf }
    log(next, `Cast ${c.name} from command zone (tax=${state.commanderTax}).`)
    setState(next)
  }

  function adjustLife(delta: number) {
    const next = { ...state, life: state.life + delta }
    log(next, `Life: ${state.life} → ${next.life}.`)
    setState(next)
  }

  function reset() {
    setState(newGame(flatCards, library.commanders))
  }

  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={reset} type="button" style={btnPrimary}>New game</button>
        <button onClick={shuffleAll} type="button" style={btnSecondary}>Shuffle library</button>
        <button onClick={() => drawN(1)} type="button" style={btnSecondary}>Draw 1</button>
        <button onClick={() => drawN(7)} type="button" style={btnSecondary}>Draw 7 (mulligan-free)</button>
        <button onClick={nextTurn} type="button" style={btnPrimary}>Next turn ▸</button>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>Turn {state.turn}</span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
        <LifeTile label="Life" value={state.life} onChange={adjustLife} />
        {deck.hasCommander && <TxTile label="Cmdr tax" value={state.commanderTax} onChange={(d) => setState({ ...state, commanderTax: Math.max(0, state.commanderTax + d) })} step={2} />}
        <Tile label="Library" v={String(state.library.length)} />
        <Tile label="Hand" v={String(state.hand.length)} />
        <Tile label="Battlefield" v={String(state.battlefield.length)} />
        <Tile label="Graveyard" v={String(state.graveyard.length)} />
        <Tile label="Exile" v={String(state.exile.length)} />
      </div>

      {/* Command zone */}
      {deck.hasCommander && state.commander.length > 0 && (
        <ZoneShell title="Command zone">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {state.commander.map((c, i) => (
              <button key={i} type="button" onClick={() => castCommander(i)} style={cardPill(true)}>
                Cast {c.name}
              </button>
            ))}
          </div>
        </ZoneShell>
      )}

      {/* Hand */}
      <ZoneShell title={`Hand (${state.hand.length})`}>
        {state.hand.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Empty.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {state.hand.map((c, i) => (
            <div key={i} style={{ position: 'relative', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {c.imageUri ? (
                <img src={c.imageUri} alt={c.name} style={{ width: '100%', display: 'block' }} />
              ) : (
                <div style={{ padding: 12, minHeight: 90 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.type_line}</div>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4 }}>
                <button type="button" onClick={() => moveHandToZone(i, 'battlefield')} style={miniBtn}>Play</button>
                <button type="button" onClick={() => moveHandToZone(i, 'graveyard')} style={miniBtn}>Discard</button>
                <button type="button" onClick={() => moveHandToZone(i, 'exile')} style={miniBtn}>Exile</button>
              </div>
            </div>
          ))}
        </div>
      </ZoneShell>

      {/* Battlefield */}
      <ZoneShell title={`Battlefield (${state.battlefield.length})`}>
        {state.battlefield.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Empty.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {state.battlefield.map((p) => (
            <div key={p.id} style={{ position: 'relative', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {p.card.imageUri ? (
                <img
                  src={p.card.imageUri}
                  alt={p.card.name}
                  onClick={() => toggleTap(p.id)}
                  style={{ width: '100%', display: 'block', cursor: 'pointer', transform: p.tapped ? 'rotate(90deg)' : 'none', transformOrigin: 'center', transition: 'transform 0.15s' }}
                />
              ) : (
                <div onClick={() => toggleTap(p.id)} style={{ padding: 12, minHeight: 90, cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{p.card.name}{p.tapped ? ' (tapped)' : ''}</div>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4 }}>
                <button type="button" onClick={() => moveBattlefieldToZone(p.id, 'graveyard')} style={miniBtn}>Destroy</button>
                <button type="button" onClick={() => moveBattlefieldToZone(p.id, 'hand')} style={miniBtn}>Return</button>
                <button type="button" onClick={() => moveBattlefieldToZone(p.id, 'exile')} style={miniBtn}>Exile</button>
                {deck.hasCommander && p.card.type_line?.toLowerCase().includes('legendary creature') && (
                  <button type="button" onClick={() => moveBattlefieldToZone(p.id, 'commander')} style={miniBtn}>To command zone</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ZoneShell>

      {/* Grave / Exile, compact */}
      {state.graveyard.length > 0 && (
        <ZoneShell title={`Graveyard (${state.graveyard.length})`}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {state.graveyard.map((c, i) => <span key={i} style={{ marginRight: 8 }}>{c.name}</span>)}
          </div>
        </ZoneShell>
      )}
      {state.exile.length > 0 && (
        <ZoneShell title={`Exile (${state.exile.length})`}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {state.exile.map((c, i) => <span key={i} style={{ marginRight: 8 }}>{c.name}</span>)}
          </div>
        </ZoneShell>
      )}

      {/* Session log */}
      <ZoneShell title={`Session log`}>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {state.history.map((line, i) => <li key={i} style={{ padding: '1px 0' }}>{line}</li>)}
        </ol>
      </ZoneShell>

      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)' }}>
        Playtest sandbox, the app doesn't enforce Magic rules. Move cards freely.
        Turn draws 1 card automatically; if you're playing "on the play, turn 1", just undo the draw.
        Session state is browser-only; nothing is saved.
      </div>
    </section>
  )
}

function newGame(cards: ClientSimCard[], commanders: ClientSimCard[]): PlaytestState {
  const seed = defaultSeed()
  const rng = makePrng(seed)
  return {
    turn: 0, life: 20, commanderTax: 0, seed,
    library: shuffle(cards, rng), hand: [], battlefield: [],
    graveyard: [], exile: [], commander: commanders.slice(),
    mulligans: 0, history: [],
  }
}

function ZoneShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{title}</div>
      <div style={{ padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>{children}</div>
    </div>
  )
}
function Tile({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ padding: '6px 10px', background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</div>
    </div>
  )
}
function LifeTile({ label, value, onChange }: { label: string; value: number; onChange: (d: number) => void }) {
  return (
    <div style={{ padding: '4px 8px', background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" onClick={() => onChange(-1)} style={miniBtn}>–</button>
        <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minWidth: 28, textAlign: 'center' }}>{value}</span>
        <button type="button" onClick={() => onChange(+1)} style={miniBtn}>+</button>
      </div>
    </div>
  )
}
function TxTile({ label, value, onChange, step }: { label: string; value: number; onChange: (d: number) => void; step: number }) {
  return (
    <div style={{ padding: '4px 8px', background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" onClick={() => onChange(-step)} style={miniBtn}>–{step}</button>
        <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minWidth: 28, textAlign: 'center' }}>{value}</span>
        <button type="button" onClick={() => onChange(+step)} style={miniBtn}>+{step}</button>
      </div>
    </div>
  )
}
function cardPill(highlight: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    background: highlight ? 'var(--primary)' : 'var(--bg-light)',
    color: highlight ? '#fff' : 'var(--text)', border: '1px solid var(--border)',
    borderRadius: 999,
  }
}
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8,
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)', borderRadius: 8,
}
const miniBtn: React.CSSProperties = {
  padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  background: 'var(--bg-light)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4,
}
