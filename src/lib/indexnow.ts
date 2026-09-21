// src/lib/indexnow.ts
// Small reusable helper for notifying IndexNow-participating search
// engines (Bing, Yandex, Naver, Seznam, etc.) when MTGPrices URLs are
// added, materially updated, or removed.
//
// Design goals:
//   * Fail-safe. If the master switch is off or the key is missing,
//     the helper is a no-op. It MUST NOT throw or break the caller's
//     user-facing request path.
//   * Canonical only. Off-domain URLs are dropped; empty strings and
//     duplicates are dropped. Anything crossing the wire is
//     https://mtgprices.io/... .
//   * Batches at exactly 10,000 URLs per POST (the IndexNow limit).
//   * Retries only transient failures. 400/403/422 are permanent
//     configuration errors; they do not loop.
//
// This helper is DELIBERATELY not wired into daily price ingest.
// Daily price movements can touch a huge portion of the catalogue
// and would swamp IndexNow. Use this for editorial updates and
// catalogue add/remove events instead.

const HOST = 'mtgprices.io'
const ORIGIN = `https://${HOST}`
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const MAX_URLS_PER_BATCH = 10_000
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export type IndexNowConfig = {
  enabled: boolean
  key: string | null
  keyLocation: string | null
}

export type IndexNowBatchResult = {
  index: number
  size: number
  attempts: number
  status: number
  ok: boolean
  error?: string
}

export type IndexNowResult = {
  totalInput: number
  totalSubmitted: number
  totalRejected: number
  batches: IndexNowBatchResult[]
  disabled?: boolean
}

/** Read the current runtime configuration. Callers should not read
 *  the env vars directly. */
export function readIndexNowConfig(): IndexNowConfig {
  const enabled = process.env.INDEXNOW_ENABLED === 'true'
  const key = (process.env.INDEXNOW_KEY ?? '').trim() || null
  const keyLocation = key ? `${ORIGIN}/${key}.txt` : null
  return { enabled, key, keyLocation }
}

/** Normalise the caller's URL list:
 *   - drop empty strings
 *   - trim whitespace, strip trailing slashes at the origin (but not
 *     at path root: e.g. https://mtgprices.io/ stays)
 *   - drop anything not on https://mtgprices.io/
 *   - drop duplicates (keep first occurrence)
 *
 *  Returned list is safe to hand to IndexNow.
 */
export function canonicaliseUrls(urls: readonly string[]): { urls: string[]; rejected: number } {
  const seen = new Set<string>()
  const out: string[] = []
  let rejected = 0
  for (const raw of urls) {
    const s = (raw ?? '').trim()
    if (!s) { rejected += 1; continue }
    if (!s.startsWith(`${ORIGIN}/`) && s !== ORIGIN) { rejected += 1; continue }
    // Strip an optional single trailing slash but leave the origin
    // root untouched. Also strip any hash and query string: IndexNow
    // treats those as separate URLs, and we don't want to submit
    // filter/search variants.
    let clean = s
    try {
      const u = new URL(s)
      if (u.host !== HOST) { rejected += 1; continue }
      // Drop query and hash outright. Every URL we legitimately
      // want to notify IndexNow about is a clean canonical.
      u.search = ''
      u.hash = ''
      clean = u.toString()
      if (clean.length > ORIGIN.length + 1 && clean.endsWith('/')) clean = clean.slice(0, -1)
    } catch { rejected += 1; continue }
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return { urls: out, rejected }
}

/** Split a URL list into IndexNow-sized batches (10,000 each). */
export function batchUrls(urls: readonly string[], size: number = MAX_URLS_PER_BATCH): string[][] {
  const out: string[][] = []
  for (let i = 0; i < urls.length; i += size) out.push(urls.slice(i, i + size))
  return out
}

type FetchLike = typeof fetch
type SubmitOpts = {
  fetchImpl?: FetchLike
  maxAttempts?: number
  betweenBatchMs?: number
  onBatchDone?: (r: IndexNowBatchResult) => void
}

/** Submit URLs to IndexNow. Batches automatically, retries only
 *  transient failures, and never throws to the caller. */
export async function submitIndexNowUrls(
  input: readonly string[],
  opts: SubmitOpts = {},
): Promise<IndexNowResult> {
  const { fetchImpl = fetch, maxAttempts = 4, betweenBatchMs = 500, onBatchDone } = opts
  const cfg = readIndexNowConfig()
  const { urls, rejected } = canonicaliseUrls(input)

  if (!cfg.enabled || !cfg.key || !cfg.keyLocation || urls.length === 0) {
    return {
      totalInput: input.length,
      totalSubmitted: 0,
      totalRejected: rejected + (cfg.enabled ? 0 : urls.length),
      batches: [],
      disabled: !cfg.enabled || !cfg.key,
    }
  }

  const batches = batchUrls(urls)
  const results: IndexNowBatchResult[] = []
  let submitted = 0
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const r = await postBatch(fetchImpl, cfg.key, cfg.keyLocation, batch, maxAttempts)
    const batchResult: IndexNowBatchResult = { index: i + 1, size: batch.length, ...r }
    results.push(batchResult)
    if (r.ok) submitted += batch.length
    if (onBatchDone) onBatchDone(batchResult)
    if (i < batches.length - 1 && betweenBatchMs > 0) await sleep(betweenBatchMs)
  }
  return {
    totalInput: input.length,
    totalSubmitted: submitted,
    totalRejected: rejected,
    batches: results,
  }
}

async function postBatch(
  fetchImpl: FetchLike,
  key: string,
  keyLocation: string,
  urls: readonly string[],
  maxAttempts: number,
): Promise<{ attempts: number; status: number; ok: boolean; error?: string }> {
  const body = JSON.stringify({ host: HOST, key, keyLocation, urlList: urls })
  let lastStatus = 0
  let lastError: string | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status = 0
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      })
      status = res.status
      lastStatus = status
      // 200 and 202 are the IndexNow success signals ("URL accepted"
      // and "processed but delayed"). Anything else needs a decision.
      if (status === 200 || status === 202) {
        return { attempts: attempt, status, ok: true }
      }
      // Permanent failures - do not retry, do not loop.
      if (status === 400 || status === 403 || status === 422) {
        return { attempts: attempt, status, ok: false, error: `permanent-${status}` }
      }
      // Transient failure classes: retry with capped exponential
      // backoff (0.5s, 1s, 2s, 4s ...).
      if (!RETRY_STATUS.has(status)) {
        return { attempts: attempt, status, ok: false, error: `unknown-status-${status}` }
      }
      lastError = `transient-${status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < maxAttempts) {
      const backoff = Math.min(500 * 2 ** (attempt - 1), 4000)
      await sleep(backoff)
    }
  }
  return { attempts: maxAttempts, status: lastStatus, ok: false, error: lastError ?? 'exhausted' }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
