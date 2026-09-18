'use client'
// Opening-hand lab. Interactive shuffle, draw 7, mulligan (London),
// keep, new hand. Manual "select cards to bottom" flow.

import { useMemo, useState } from 'react'
import type { ClientDeckMeta, ClientSimCard, ClientSimLibrary } from './page'
import { makePrng, defaultSeed } from '@/lib/mtg/simulation/prng'
import { shuffle } from '@/lib/mtg/simulation/shuffle'
import ManaCost from '@/components/mtg/ManaCost'

type HandState = {
  mulligans: number
  hand: ClientSimCard[]
  library: ClientSimCard[]   // top-of-library first
  seed: number
  phase: 'draw7' | 'choose_bottom' | 'kept'
  toBottom: string[]         // card ids selected to be bottomed
}

export default function HandLab({ deck, library, cardIndex }: {
  deck: ClientDeckMeta
  library: ClientSimLibrary
  cardIndex: Map<string, ClientSimCard>
}) {
  const flatCards = useMemo(() => {
    const arr: ClientSimCard[] = []
    for (const e of library.entries) for (let i = 0; i < e.quantity; i++) arr.push(e.card)
    return arr
  }, [library])

  const [state, setState] = useState<HandState>(() => {
    const seed = defaultSeed()
    const rng = makePrng(seed)
    const shuffled = shuffle(flatCards, rng)
    const hand = shuffled.slice(0, 7)
    return { mulligans: 0, hand, library: shuffled.slice(7), seed, phase: 'draw7', toBottom: [] }
  })

  function freshShuffle(seed?: number) {
    const s = seed ?? defaultSeed()
    const rng = makePrng(s)
    const shuffled = shuffle(flatCards, rng)
    setState({ mulligans: 0, hand: shuffled.slice(0, 7), library: shuffled.slice(7), seed: s, phase: 'draw7', toBottom: [] })
  }

  function mulliganDraw() {
    // London: reshuffle whole library, draw a new 7, then bottom `newMulligans` cards.
    const nextM = state.mulligans + 1
    const s = state.seed + nextM * 977
    const rng = makePrng(s)
    const shuffled = shuffle(flatCards, rng)
    setState({
      mulligans: nextM, hand: shuffled.slice(0, 7),
      library: shuffled.slice(7),
      seed: state.seed, phase: nextM > 0 ? 'choose_bottom' : 'draw7',
      toBottom: [],
    })
  }

  function toggleBottom(cardIndexInHand: number) {
    // Track "which HAND slot indices are bottomed" — but IDs alone may
    // collide when multiple copies of the same card are in hand. Use
    // index-based keys as `hand[i].oracle_card_id + '#' + i`.
    const key = state.hand[cardIndexInHand].oracle_card_id + '#' + cardIndexInHand
    const set = new Set(state.toBottom)
    if (set.has(key)) set.delete(key); else set.add(key)
    if (set.size > state.mulligans) return  // cap at m
    setState({ ...state, toBottom: Array.from(set) })
  }

  function confirmBottom() {
    // Move bottomed cards from hand to end of library.
    const bottomedIdx = new Set<number>()
    for (const key of state.toBottom) {
      const parts = key.split('#')
      bottomedIdx.add(Number(parts[parts.length - 1]))
    }
    const kept = state.hand.filter((_, i) => !bottomedIdx.has(i))
    const bottomed = state.hand.filter((_, i) => bottomedIdx.has(i))
    setState({
      ...state,
      hand: kept,
      library: state.library.concat(bottomed),
      phase: 'kept',
      toBottom: [],
    })
  }

  function keepAsIs() {
    if (state.mulligans === 0) { setState({ ...state, phase: 'kept' }); return }
    // If we mulliganed but user hasn't chosen enough to bottom, auto-bottom the highest-MV non-lands.
    setState({ ...state, phase: 'choose_bottom' })
  }

  function drawOne() {
    if (state.library.length === 0) return
    const [top, ...rest] = state.library
    setState({ ...state, hand: state.hand.concat([top]), library: rest })
  }

  const isDraw7 = state.phase === 'draw7'
  const isChooseBottom = state.phase === 'choose_bottom'
  const isKept = state.phase === 'kept'

  const openingLands = state.hand.filter((c) => c.classification.is_land).length
  const openingColours = new Set<string>()
  for (const c of state.hand) {
    if (c.classification.category === 'basic_land' || c.classification.category === 'nonbasic_untapped') {
      for (const col of c.classification.colours) openingColours.add(col)
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={() => freshShuffle()} style={btnPrimary} type="button">Shuffle + draw 7</button>
        <button onClick={mulliganDraw} disabled={state.mulligans >= 7 - 0} style={btnSecondary} type="button">
          Mulligan{state.mulligans > 0 ? ` (${state.mulligans})` : ''}
        </button>
        {isDraw7 && <button onClick={keepAsIs} style={btnSecondary} type="button">Keep</button>}
        {isChooseBottom && (
          <button onClick={confirmBottom} disabled={state.toBottom.length !== state.mulligans} style={btnPrimary} type="button">
            Bottom {state.toBottom.length}/{state.mulligans} & keep
          </button>
        )}
        {isKept && <button onClick={drawOne} disabled={state.library.length === 0} style={btnSecondary} type="button">Draw 1 more (from top)</button>}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
          {deck.hasCommander ? 'Commander stays in the command zone (excluded from library).' : ''} Seed {state.seed}.
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 14 }}>
        <Tile label="Cards in hand" v={String(state.hand.length)} />
        <Tile label="Lands in hand" v={String(openingLands)} />
        <Tile label="Untapped colours" v={openingColours.size > 0 ? Array.from(openingColours).sort().join('') : '—'} />
        <Tile label="Mulligans" v={String(state.mulligans)} />
        <Tile label="Library remaining" v={String(state.library.length)} />
      </div>

      {isChooseBottom && (
        <div style={{ padding: 10, background: 'var(--amber-soft, rgba(232,169,75,0.10))', color: 'var(--amber, #a0813f)', border: '1px solid rgba(232,169,75,0.28)', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
          London mulligan — pick {state.mulligans} card{state.mulligans === 1 ? '' : 's'} to put on the bottom of your library.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {state.hand.map((c, i) => {
          const key = c.oracle_card_id + '#' + i
          const selectedForBottom = state.toBottom.includes(key)
          return (
            <button
              key={key}
              type="button"
              onClick={isChooseBottom ? () => toggleBottom(i) : undefined}
              disabled={!isChooseBottom}
              style={{
                position: 'relative', display: 'block',
                padding: 0, background: 'transparent',
                border: `2px solid ${selectedForBottom ? 'var(--amber, #a0813f)' : 'transparent'}`,
                borderRadius: 8,
                cursor: isChooseBottom ? 'pointer' : 'default',
                opacity: selectedForBottom ? 0.55 : 1,
              }}
              aria-label={c.name + (selectedForBottom ? ' — will be bottomed' : '')}
            >
              {c.imageUri ? (
                <img src={c.imageUri} alt={c.name} style={{ width: '100%', display: 'block', borderRadius: 6 }} />
              ) : (
                <div style={{ padding: 12, background: 'var(--bg-light)', borderRadius: 6, minHeight: 120, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.type_line}</div>
                  {c.mana_cost && <ManaCost cost={c.mana_cost} size={12} />}
                </div>
              )}
              {selectedForBottom && (
                <div style={{
                  position: 'absolute', bottom: 4, left: 4, right: 4,
                  fontSize: 11, background: 'var(--amber, #a0813f)', color: '#fff',
                  padding: '2px 6px', borderRadius: 4, textAlign: 'center', fontWeight: 700,
                }}>Bottom</div>
              )}
            </button>
          )
        })}
      </div>

      {/* Drawn extras appear in a separate row (indices 7+). */}
      {state.phase === 'kept' && state.hand.length > 7 && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          {state.hand.length - 7} card{state.hand.length - 7 === 1 ? '' : 's'} drawn since keep.
        </div>
      )}

      {/* Non-blocking note — never AI. */}
      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Cards drawn without replacement. London mulligan model — after N mulligans you keep 7 cards then bottom N.
        Colour count shows untapped basic + non-basic untapped sources only (see Mana tab for classifier details).
      </div>
    </section>
  )
}

function Tile({ label, v }: { label: string; v: string }) {
  return (
    <div style={{ padding: '6px 8px', background: 'var(--bg-light)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</div>
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8,
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)', borderRadius: 8,
}
