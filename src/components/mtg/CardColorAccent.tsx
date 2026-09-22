// src/components/mtg/CardColorAccent.tsx
//
// Signature MTGPrices element: five-segment colour rail derived from
// oracle_colors. Present colours use the WUBRG hues, absent colours
// fall back to neutral stone so the rail retains visual anchoring
// without misrepresenting a colourless card.
//
// Non-interactive, pure server component. Consumers pass the raw
// oracle_colors payload; we normalise here.

import { buildCardTheme } from '@/lib/mtg/color-theme'

export default function CardColorAccent({ colours, label = true, style }: { colours: unknown; label?: boolean; style?: React.CSSProperties }) {
  const theme = buildCardTheme(colours)
  return (
    <div style={{ display: 'grid', gap: 6, ...style }} aria-label={`Card colour identity, ${theme.label}`}>
      <div className="mtg-color-rail" role="presentation">
        {theme.rail.map((s) => (
          <span key={s.colour} data-present={String(s.present)} style={{ background: s.hex }} />
        ))}
      </div>
      {label && !theme.colourless && (
        <div className="label-mono" style={{ letterSpacing: '0.10em', color: 'var(--text-muted)' }}>{theme.label}</div>
      )}
    </div>
  )
}

export { buildCardTheme }
