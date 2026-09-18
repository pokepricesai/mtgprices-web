// src/lib/mtg/deck-slug.ts
//
// Deck slug generator. Public deck routes resolve /decks/public/[slug]
// so slugs must be:
//   - readable (derived from the deck name)
//   - URL-safe (kebab-case, lowercase, ASCII only)
//   - collision-safe against the other PUBLIC decks (private decks can
//     share slugs, they're never routed by slug)
//
// Uniqueness is enforced by a partial unique index (see the RLS
// migration) but generation itself has to avoid obvious collisions; we
// use a short random suffix on collision.

import { getSupabaseServiceClient } from '@/lib/supabaseService'

export function slugifyDeckName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')          // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')              // any non-alphanumeric → dash
    .replace(/^-+|-+$/g, '')                  // trim leading/trailing dashes
    .replace(/-{2,}/g, '-')                   // collapse runs
    .slice(0, 64) || 'deck'
}

/** Short alphanumeric suffix, ~10 bits of entropy per char (base36).
 *  6 chars → ~30 bits, plenty for slug collision escape. */
function randomSuffix(chars = 6): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < chars; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

/** Generate a slug for a deck that will be made public. Retries with a
 *  new random suffix on collision. Never touches private-deck rows. */
export async function generatePublicDeckSlug(
  deckName: string,
  excludeDeckId?: string,
  maxAttempts = 6,
): Promise<string> {
  const s = getSupabaseServiceClient()
  const base = slugifyDeckName(deckName)
  const candidates: string[] = [base, `${base}-${randomSuffix(4)}`]
  for (let i = 0; i < maxAttempts - candidates.length; i++) {
    candidates.push(`${base}-${randomSuffix(6)}`)
  }
  for (const c of candidates) {
    let q = s.from('mtg_decks').select('id').eq('slug', c).eq('is_public', true)
    if (excludeDeckId) q = q.neq('id', excludeDeckId)
    const { data } = await q.limit(1)
    if (!data || data.length === 0) return c
  }
  // Extreme fallback, very high entropy suffix so this genuinely
  // never collides in practice.
  return `${base}-${randomSuffix(10)}`
}

/** Client-side / API-side validation of a user-supplied slug string.
 *  Doesn't touch the DB, call generatePublicDeckSlug for uniqueness. */
export function validateSlugString(candidate: string): { ok: true; slug: string } | { ok: false; error: string } {
  const trimmed = candidate.trim().toLowerCase()
  if (trimmed.length === 0) return { ok: false, error: 'Slug required.' }
  if (trimmed.length > 80) return { ok: false, error: 'Slug too long (max 80).' }
  if (!/^[a-z0-9-]+$/.test(trimmed)) return { ok: false, error: 'Slug may only contain lowercase letters, numbers and hyphens.' }
  if (/^-|-$/.test(trimmed) || /--/.test(trimmed)) return { ok: false, error: 'Slug cannot start/end with a hyphen or contain double hyphens.' }
  return { ok: true, slug: trimmed }
}
