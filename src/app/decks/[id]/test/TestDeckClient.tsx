'use client'
// Test-your-deck lab: four sections (Opening Hands / Simulate / Mana /
// Playtest) driven from a single hydrated ClientSimLibrary. All
// simulation runs in-browser — no round trips.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { ClientDeckMeta, ClientSimCard, ClientSimLibrary } from './page'
import HandLab from './HandLab'
import Simulate from './Simulate'
import ManaAnalysis from './ManaAnalysis'
import Playtest from './Playtest'
import RulesAwareSim from './RulesAwareSim'

type Section = 'hands' | 'sim' | 'mana' | 'playtest' | 'rules'

const RULES_ENABLED = process.env.NEXT_PUBLIC_RULES_ENGINE_ENABLED === 'true'

const NAV_BASE: Array<{ key: Section; label: string; description: string }> = [
  { key: 'hands', label: 'Opening Hands', description: 'Draw, mulligan, keep — feel your opener' },
  { key: 'sim', label: 'Simulate', description: '100 / 1,000 / 10,000-game statistics' },
  { key: 'mana', label: 'Mana', description: 'Colour sources vs mana-cost pressure' },
  { key: 'playtest', label: 'Playtest', description: 'Manual goldfish sandbox' },
]
const NAV: typeof NAV_BASE = RULES_ENABLED
  ? [...NAV_BASE, { key: 'rules', label: 'Rules-aware', description: 'Real MTG rules engine (Phase 4B preview)' }]
  : NAV_BASE

export default function TestDeckClient({ deck, library }: { deck: ClientDeckMeta; library: ClientSimLibrary }) {
  const [section, setSection] = useState<Section>('hands')
  const cardIndex = useMemo(() => buildCardIndex(library), [library])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Test your deck · {deck.formatLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif', fontSize: 28, lineHeight: 1.1 }}>{deck.name}</h1>
          <Link href={`/decks/${deck.id}`} style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none' }}>← back to builder</Link>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Library: {library.size} cards.
          {library.commanders.length > 0 && ` Commander(s): ${library.commanders.map((c) => c.name).join(' & ')} (kept out of the shuffle).`}
        </div>
      </header>

      {/* Section tabs */}
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            onClick={() => setSection(n.key)}
            style={{
              padding: '10px 14px', fontSize: 13, fontWeight: 700,
              background: 'transparent',
              color: section === n.key ? 'var(--primary)' : 'var(--text-muted)',
              border: 'none', borderBottom: `2px solid ${section === n.key ? 'var(--primary)' : 'transparent'}`,
              cursor: 'pointer',
            }}
            title={n.description}
          >{n.label}</button>
        ))}
      </nav>

      {section === 'hands' && <HandLab deck={deck} library={library} cardIndex={cardIndex} />}
      {section === 'sim' && <Simulate deck={deck} library={library} cardIndex={cardIndex} />}
      {section === 'mana' && <ManaAnalysis library={library} />}
      {section === 'playtest' && <Playtest deck={deck} library={library} cardIndex={cardIndex} />}
      {section === 'rules' && RULES_ENABLED && <RulesAwareSim deck={deck} />}
    </div>
  )
}

function buildCardIndex(library: ClientSimLibrary): Map<string, ClientSimCard> {
  const m = new Map<string, ClientSimCard>()
  for (const { card } of library.entries) m.set(card.oracle_card_id, card)
  for (const c of library.commanders) m.set(c.oracle_card_id, c)
  for (const c of library.companion) m.set(c.oracle_card_id, c)
  return m
}
