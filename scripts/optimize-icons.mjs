// scripts/optimize-icons.mjs
// One-off utility. Reads the high-resolution branding PNGs at
// public/favicon.png (~1.4 MB) and public/logo.png (~1.9 MB) and
// generates properly sized, optimised copies for browser icons:
//
//   src/app/icon.png         32×32
//   src/app/apple-icon.png   180×180
//   public/favicon-32.png    32×32   (mirror at /favicon-32.png)
//   public/favicon-48.png    48×48
//
// The originals are preserved untouched at public/favicon.png and
// public/logo.png so we can still serve them for OG, structured data
// and high-density displays where needed.

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const SRC_FAVICON = join(ROOT, 'public', 'favicon.png')
const OUT = [
  { size: 32,  path: join(ROOT, 'src',    'app',    'icon.png') },
  { size: 180, path: join(ROOT, 'src',    'app',    'apple-icon.png') },
  { size: 32,  path: join(ROOT, 'public', 'favicon-32.png') },
  { size: 48,  path: join(ROOT, 'public', 'favicon-48.png') },
]

const raw = readFileSync(SRC_FAVICON)
console.log(`Source ${SRC_FAVICON}: ${raw.byteLength.toLocaleString()} bytes`)

for (const { size, path } of OUT) {
  const buf = await sharp(raw)
    .resize({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: size <= 64, quality: size <= 64 ? 90 : 95 })
    .toBuffer()
  await writeFile(path, buf)
  console.log(`  wrote ${size}×${size} → ${path.replace(ROOT + '\\', '').replace(ROOT + '/', '')} ${buf.byteLength.toLocaleString()} bytes`)
}
