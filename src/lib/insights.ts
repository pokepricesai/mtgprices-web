// src/lib/insights.ts
// Reads MTGPrices editorial articles from src/content/insights/*.md at
// build/runtime. Kept intentionally small: front matter parsing via
// gray-matter, markdown body rendered client-side by react-markdown.
// Adding a new article means adding one file, no CMS.

import 'server-only'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import matter from 'gray-matter'

const CONTENT_DIR = join(process.cwd(), 'src', 'content', 'insights')

export type InsightCategory =
  | 'Market'
  | 'Collecting'
  | 'Deckbuilding'
  | 'Sets'
  | 'Formats'
  | 'Guides'

export const CATEGORIES: InsightCategory[] = [
  'Market', 'Collecting', 'Deckbuilding', 'Sets', 'Formats', 'Guides',
]

export type InsightMeta = {
  slug: string
  title: string
  description: string
  author: string
  category: InsightCategory
  publishedAt: string        // ISO date
  updatedAt: string | null
  heroImage: string | null
  readingTimeMin: number
}

export type InsightArticle = InsightMeta & {
  body: string
}

function readAllRaw(): InsightArticle[] {
  let files: string[]
  try {
    files = readdirSync(CONTENT_DIR).filter((f) => extname(f) === '.md')
  } catch { return [] }
  const out: InsightArticle[] = []
  for (const f of files) {
    const full = join(CONTENT_DIR, f)
    const st = statSync(full)
    if (!st.isFile()) continue
    const raw = readFileSync(full, 'utf8')
    const parsed = matter(raw)
    const slug = (parsed.data.slug ?? basename(f, '.md')).toString()
    const title = (parsed.data.title ?? '').toString().trim()
    if (!title) continue        // require title
    const category = normaliseCategory(parsed.data.category)
    const publishedAt = normaliseDate(parsed.data.publishedAt ?? parsed.data.date)
    if (!publishedAt) continue  // require date
    const description = (parsed.data.description ?? '').toString().trim()
    const author = (parsed.data.author ?? 'MTGPrices').toString().trim()
    const heroImage = parsed.data.heroImage ? String(parsed.data.heroImage) : null
    const updatedAt = normaliseDate(parsed.data.updatedAt)
    const body = parsed.content.trim()
    out.push({
      slug, title, description, author,
      category, publishedAt, updatedAt, heroImage,
      readingTimeMin: estimateReadingTime(body),
      body,
    })
  }
  // Newest first.
  out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return out
}

/** Returns every article's metadata (no body). */
export function listInsights(): InsightMeta[] {
  return readAllRaw().map(({ body, ...meta }) => { void body; return meta })
}

/** Full article by slug, including body. */
export function getInsight(slug: string): InsightArticle | null {
  return readAllRaw().find((a) => a.slug === slug) ?? null
}

/** N most recent, metadata only. Used by the homepage strip. */
export function latestInsights(n = 3): InsightMeta[] {
  return listInsights().slice(0, n)
}

/** Categories that actually have at least one article. */
export function activeCategories(): InsightCategory[] {
  const seen = new Set<InsightCategory>()
  for (const m of listInsights()) seen.add(m.category)
  return CATEGORIES.filter((c) => seen.has(c))
}

/** Related picks: same category then next-newest across the catalogue.
 *  Excludes the current slug. */
export function relatedInsights(slug: string, n = 3): InsightMeta[] {
  const all = listInsights()
  const current = all.find((a) => a.slug === slug)
  const rest = all.filter((a) => a.slug !== slug)
  if (!current) return rest.slice(0, n)
  const sameCat = rest.filter((a) => a.category === current.category)
  const others = rest.filter((a) => a.category !== current.category)
  return [...sameCat, ...others].slice(0, n)
}

function normaliseCategory(raw: unknown): InsightCategory {
  const s = String(raw ?? '').trim()
  if (CATEGORIES.includes(s as InsightCategory)) return s as InsightCategory
  return 'Guides'
}

function normaliseDate(raw: unknown): string | null {
  if (!raw) return null
  const d = new Date(String(raw))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function estimateReadingTime(body: string): number {
  const words = body.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 220))
}
