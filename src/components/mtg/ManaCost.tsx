// src/components/mtg/ManaCost.tsx
// Renders a Scryfall-format mana cost ("{2}{W}{U}") as accessible pips.

import { parseManaCost, manaColors, type ManaToken } from '@/lib/mtg/mana'

type Props = {
  cost: string | null | undefined
  size?: number
  ariaLabelPrefix?: string
}

function Pip({ token, size }: { token: ManaToken; size: number }) {
  const { bg, fg, ring } = manaColors(token)
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        fontSize: Math.max(9, Math.round(size * 0.55)),
        fontWeight: 800,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        boxShadow: ring ? `inset 0 0 0 ${Math.max(2, Math.round(size * 0.18))}px ${ring}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
        letterSpacing: '-0.02em',
      }}
    >
      {token.label.replace(/\//g, '')}
    </span>
  )
}

export default function ManaCost({ cost, size = 18, ariaLabelPrefix = 'Mana cost' }: Props) {
  const tokens = parseManaCost(cost)
  if (tokens.length === 0) return null
  const readable = tokens.map((t) => t.label).join(' ')
  return (
    <span
      aria-label={`${ariaLabelPrefix}: ${readable}`}
      style={{ display: 'inline-flex', gap: 3, alignItems: 'center', verticalAlign: 'middle' }}
    >
      {tokens.map((t, i) => <Pip key={i} token={t} size={size} />)}
    </span>
  )
}
