// src/components/mtg/OracleText.tsx
// Renders MTG Oracle text preserving line breaks and inline mana symbols.
// Never uses dangerouslySetInnerHTML, every token is a real React node.

import { parseManaCost, manaColors } from '@/lib/mtg/mana'

type Props = {
  text: string | null | undefined
  size?: number
  color?: string
  italicReminder?: boolean
}

/** Split a line into text chunks and mana-symbol tokens. */
function tokenizeLine(line: string): (string | { token: string })[] {
  const parts: (string | { token: string })[] = []
  const rx = /\{[^{}]+\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = rx.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    parts.push({ token: m[0] })
    last = m.index + m[0].length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

/** Split italic reminder text ("(…)") within a line. */
function splitReminder(chunk: string): { normal: string; reminder?: string }[] {
  const parts: { normal: string; reminder?: string }[] = []
  const rx = /\(([^()]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = rx.exec(chunk)) !== null) {
    if (m.index > last) parts.push({ normal: chunk.slice(last, m.index) })
    parts.push({ normal: '', reminder: m[0] })
    last = m.index + m[0].length
  }
  if (last < chunk.length) parts.push({ normal: chunk.slice(last) })
  return parts
}

export default function OracleText({ text, size = 14, color = 'var(--text)', italicReminder = true }: Props) {
  if (!text) return null
  const lines = text.split(/\n/)
  return (
    <div style={{ color, fontSize: size, lineHeight: 1.55, whiteSpace: 'normal' }}>
      {lines.map((line, li) => (
        <div key={li} style={{ marginTop: li === 0 ? 0 : 8 }}>
          {tokenizeLine(line).map((part, pi) => {
            if (typeof part === 'string') {
              return italicReminder ? (
                <span key={pi}>
                  {splitReminder(part).map((seg, si) =>
                    seg.reminder ? (
                      <span key={si} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{seg.reminder}</span>
                    ) : (
                      <span key={si}>{seg.normal}</span>
                    )
                  )}
                </span>
              ) : (
                <span key={pi}>{part}</span>
              )
            }
            // mana pip
            const tokens = parseManaCost(part.token)
            if (tokens.length === 0) return <span key={pi}>{part.token}</span>
            const t = tokens[0]
            const { bg, fg, ring } = manaColors(t)
            const px = Math.max(14, size + 2)
            return (
              <span
                key={pi}
                aria-hidden
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: px, height: px, borderRadius: '50%',
                  background: bg, color: fg,
                  fontSize: Math.max(9, Math.round(px * 0.55)), fontWeight: 800,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  boxShadow: ring ? `inset 0 0 0 3px ${ring}` : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                  margin: '0 1px',
                  verticalAlign: '-3px',
                }}
              >
                {t.label.replace(/\//g, '')}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
