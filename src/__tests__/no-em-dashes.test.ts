// no-em-dashes.test.ts
// Guard rail. The MTGPrices writing rule is: no em dashes (U+2014) in
// USER-FACING copy — JSX text, string literals, template literals, alt
// text, aria labels, metadata descriptions, CSS content properties.
//
// Code comments (line comments starting with //, block comments /* … */,
// JSDoc /** … */) are NOT user-facing and are exempt. They can use em
// dashes freely for internal readability.
//
// The scan strips comments before checking for U+2014. Anything the
// browser could render is still inspected.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const SRC = join(process.cwd(), 'src')
const EM_DASH = String.fromCharCode(0x2014)
const EXTS = new Set(['.ts', '.tsx', '.css', '.md'])
const SKIP_DIRS = new Set(['__tests__', 'node_modules', '.next'])
// Allowlist: file paths (relative to src/) we tolerate the character in,
// for a documented reason. Empty by default. If a legitimate exception
// arises, add the file here with a comment.
const ALLOWLIST = new Set<string>([])

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (EXTS.has(extname(name))) acc.push(full)
  }
  return acc
}

/** Remove line comments (//…), block comments (/* … *\/), and CSS
 *  block comments so their U+2014s don't count as user-facing.
 *  Scans character-by-character and respects string boundaries so
 *  an em dash inside a "// this is fine" JSX string literal is
 *  correctly retained. */
function stripComments(src: string): string {
  const out: string[] = []
  const n = src.length
  let i = 0
  let inString: '"' | "'" | '`' | null = null
  let escape = false
  while (i < n) {
    const c = src[i]
    if (escape) { out.push(c); escape = false; i++; continue }
    if (inString) {
      out.push(c)
      if (c === '\\') escape = true
      else if (c === inString) inString = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inString = c; out.push(c); i++; continue }
    if (c === '/' && src[i + 1] === '/') {
      // Preserve newlines so line numbers stay aligned.
      while (i < n && src[i] !== '\n') { out.push(' '); i++ }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      // /* … */ — preserve newlines, blank out everything else.
      i += 2; out.push('  ')
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ')
        i++
      }
      if (i < n) { i += 2; out.push('  ') }
      continue
    }
    out.push(c)
    i++
  }
  return out.join('')
}

describe('em dash guard', () => {
  it('no user-facing source under src/ contains U+2014 (em dash)', () => {
    const offenders: { file: string; line: number; snippet: string }[] = []
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      if (ALLOWLIST.has(rel)) continue
      const raw = readFileSync(file, 'utf8')
      if (!raw.includes(EM_DASH)) continue
      const stripped = stripComments(raw)
      if (!stripped.includes(EM_DASH)) continue
      const lines = stripped.split(/\r?\n/)
      lines.forEach((ln, i) => {
        if (ln.includes(EM_DASH)) {
          offenders.push({ file: rel, line: i + 1, snippet: ln.trim().slice(0, 140) })
        }
      })
    }
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.snippet}`)
        .join('\n')
      throw new Error(
        `Found ${offenders.length} em dash occurrence(s) in user-facing source. Replace with commas, full stops, colons or parentheses.\n${msg}`,
      )
    }
    expect(offenders.length).toBe(0)
  })
})
