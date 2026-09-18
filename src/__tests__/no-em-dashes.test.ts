// no-em-dashes.test.ts
// Guard rail. The MTGPrices writing rule is: no em dashes (—) anywhere
// in visible UI copy or metadata. This test scans every .ts / .tsx / .css
// / .md file under src/ and fails if one appears.
//
// The scan is deliberately dumb (no AST) so it catches every case: JSX
// text, string literals, template literals, alt text, aria labels,
// metadata descriptions and CSS comments. Third-party data flowing
// through us (Oracle text, ruling comments, retailer names) is loaded
// from the database at runtime, so those punctuations never land in
// source files even if they contain em dashes at display time.

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

describe('em dash guard', () => {
  it('no source file under src/ contains U+2014 (em dash)', () => {
    const offenders: { file: string; line: number; snippet: string }[] = []
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      if (ALLOWLIST.has(rel)) continue
      const text = readFileSync(file, 'utf8')
      if (!text.includes(EM_DASH)) continue
      const lines = text.split(/\r?\n/)
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
        `Found ${offenders.length} em dash occurrence(s). Replace with commas, full stops, colons or parentheses.\n${msg}`,
      )
    }
    expect(offenders.length).toBe(0)
  })
})
