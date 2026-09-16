// src/components/mtg/CardFaces.tsx
// Renders the face-level rules text section — one card can have 1..N faces.

import ManaCost from './ManaCost'
import OracleText from './OracleText'
import type { FaceView } from '@/lib/mtg/faces'

type Props = {
  faces: FaceView[]
  layoutKind: string
}

const LAYOUT_HEADING: Record<string, string> = {
  split: 'Split — cast either half',
  flip: 'Flip card',
  transform: 'Two-faced — transforms during play',
  modal_dfc: 'Modal double-faced — choose one to play',
  adventure: 'Adventure — cast the adventure, then the creature',
  meld: 'Meld — combines with another card',
  saga: 'Saga',
  class: 'Class',
  case: 'Case',
  leveler: 'Leveler',
  single: '',
  other: '',
}

export default function CardFaces({ faces, layoutKind }: Props) {
  if (faces.length === 0) return null
  const heading = LAYOUT_HEADING[layoutKind]

  if (faces.length === 1) {
    const f = faces[0]
    return (
      <section aria-label="Card text">
        <FaceBody face={f} showName={false} />
      </section>
    )
  }

  return (
    <section aria-label="Card faces">
      {heading && <div className="label-mono" style={{ marginBottom: 12 }}>{heading}</div>}
      <div style={{ display: 'grid', gap: 16 }}>
        {faces.map((f) => (
          <div
            key={f.index}
            style={{
              padding: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <FaceBody face={f} showName />
          </div>
        ))}
      </div>
    </section>
  )
}

function FaceBody({ face, showName }: { face: FaceView; showName: boolean }) {
  const stats: string[] = []
  if (face.power !== null && face.toughness !== null) stats.push(`${face.power} / ${face.toughness}`)
  if (face.loyalty !== null) stats.push(`Loyalty ${face.loyalty}`)
  if (face.defense !== null) stats.push(`Defense ${face.defense}`)

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: face.oracle_text ? 10 : 0 }}>
        {showName && (
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{face.name}</span>
        )}
        {face.mana_cost && <ManaCost cost={face.mana_cost} size={18} />}
      </div>
      {face.type_line && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: face.oracle_text ? 10 : 0 }}>
          {face.type_line}
        </div>
      )}
      {face.oracle_text && <OracleText text={face.oracle_text} size={14} />}
      {stats.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {stats.join('  ·  ')}
        </div>
      )}
    </div>
  )
}
