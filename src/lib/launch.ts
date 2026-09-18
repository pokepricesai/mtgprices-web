// src/lib/launch.ts
// Single source of truth for "is the site publicly launched?".
//
// Defaults to `false` when the env var is absent or any value other than
// the literal string 'true', safer than defaulting to launched.

export const SITE_LAUNCHED = process.env.SITE_LAUNCHED === 'true'

/** Absolute canonical URL for the site. Kept in one place so that
 *  per-page metadata never accidentally rebuilds it with www/http. */
export const SITE_URL = 'https://mtgprices.io'

/** Absolute URL for a given path. Path must start with '/'. */
export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) return `${SITE_URL}/${path}`
  return `${SITE_URL}${path}`
}
