// src/lib/tcggraph/client.ts
// Server-only client for the TCGGraph API. Nothing here should ever
// be reached from a Client Component - the API key would leak into
// the browser bundle. The `server-only` import at the top enforces
// that at build time.
//
// Contract summary (see docs/network/02-tcggraph-client.md for the
// long form):
//   * typed responses via generics + types.ts
//   * conservative fixed backoff for 429 and 5xx (2^n * base, capped)
//   * respects Retry-After header if present
//   * captures TCGGraph-Credits-* + X-RateLimit-* + TCGGraph-Cost
//   * ETag / If-None-Match with 304 unchanged short-circuit
//   * hard per-run credit + request safety limits: the client refuses
//     to keep going once EITHER is exceeded, so a runaway loop cannot
//     drain the monthly Growth allowance
//   * structured logs via a pluggable logger (defaults to a console-
//     shaped emitter that stays quiet in tests)
//
// The API surface intentionally mirrors what the Slice 0 audit needs
// (games, sets, cards, printings, prices, graded prices) and no more.
// A `raw()` escape hatch is provided so we can hit endpoints we don't
// yet have a typed wrapper for, without inflating this file.

import 'server-only'
import type {
  TcgGraphResponse,
  TcgGraphGame,
  TcgGraphSet,
  TcgGraphCard,
  TcgGraphPrinting,
  TcgGraphMarketPrice,
  TcgGraphGradedPrice,
  TcgGraphPage,
  CreditSnapshot,
} from './types'

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

export type TcgGraphConfig = {
  apiKey: string
  /** Base URL. Default 'https://api.tcggraph.com'. Overridable so we
   *  can point at a sandbox or a recording proxy in tests. */
  baseUrl?: string
  /** Hard cap on total credits this client instance will spend. Once
   *  we've observed this many credits consumed via response headers,
   *  every subsequent request short-circuits with a
   *  TcgGraphCreditBudgetError. */
  creditBudget?: number
  /** Hard cap on total HTTP requests. Same short-circuit behaviour. */
  requestBudget?: number
  /** Base backoff in ms. 429/5xx uses backoffBase * 2^(attempt-1). */
  backoffBaseMs?: number
  /** Cap on backoff. */
  backoffMaxMs?: number
  /** Max retry attempts per request (including the first). */
  maxAttempts?: number
  /** Optional ETag store. In-memory Map by default; callers may pass
   *  a Supabase-backed store in production. */
  etagStore?: EtagStore
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
  /** Injectable logger. */
  logger?: TcgGraphLogger
}

export type TcgGraphLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => void
  warn: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, meta?: Record<string, unknown>) => void
}

export type EtagStore = {
  get(key: string): Promise<{ etag: string; body: unknown } | null>
  set(key: string, etag: string, body: unknown): Promise<void>
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class TcgGraphError extends Error {
  constructor(message: string, public status?: number, public path?: string) {
    super(message)
    this.name = 'TcgGraphError'
  }
}
export class TcgGraphAuthError extends TcgGraphError { constructor(m: string, p?: string) { super(m, 401, p); this.name = 'TcgGraphAuthError' } }
export class TcgGraphRateLimitError extends TcgGraphError { constructor(m: string, p?: string) { super(m, 429, p); this.name = 'TcgGraphRateLimitError' } }
export class TcgGraphCreditBudgetError extends TcgGraphError { constructor(m: string) { super(m); this.name = 'TcgGraphCreditBudgetError' } }
export class TcgGraphRequestBudgetError extends TcgGraphError { constructor(m: string) { super(m); this.name = 'TcgGraphRequestBudgetError' } }

// ---------------------------------------------------------------------
// In-memory ETag store used by default. Callers can pass a Supabase-
// backed one for cross-instance sharing.
// ---------------------------------------------------------------------

class MemoryEtagStore implements EtagStore {
  private map = new Map<string, { etag: string; body: unknown }>()
  async get(key: string) { return this.map.get(key) ?? null }
  async set(key: string, etag: string, body: unknown) { this.map.set(key, { etag, body }) }
}

// ---------------------------------------------------------------------
// Header parser
// ---------------------------------------------------------------------

export function parseCredits(h: Headers): CreditSnapshot {
  const num = (name: string): number | null => {
    const raw = h.get(name)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return {
    creditsLimit:     num('TCGGraph-Credits-Limit'),
    creditsRemaining: num('TCGGraph-Credits-Remaining'),
    creditsReset:     h.get('TCGGraph-Credits-Reset'),
    requestCost:      num('TCGGraph-Cost'),
    rateLimitLimit:     num('X-RateLimit-Limit'),
    rateLimitRemaining: num('X-RateLimit-Remaining'),
    serverNote:       h.get('TCGGraph-Note') ?? h.get('X-Server-Note') ?? null,
  }
}

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

export class TcgGraphClient {
  private cfg: Required<Omit<TcgGraphConfig, 'etagStore' | 'fetchImpl' | 'logger' | 'apiKey'>> & {
    apiKey: string
    etagStore: EtagStore
    fetchImpl: typeof fetch
    logger: TcgGraphLogger
  }
  private creditsUsed = 0
  private requestsMade = 0
  private lastCredits: CreditSnapshot | null = null

  constructor(cfg: TcgGraphConfig) {
    if (!cfg.apiKey) throw new TcgGraphError('TCGGraph API key is required')
    this.cfg = {
      apiKey:         cfg.apiKey,
      baseUrl:        cfg.baseUrl        ?? 'https://api.tcggraph.com',
      creditBudget:   cfg.creditBudget   ?? 20_000,
      requestBudget:  cfg.requestBudget  ?? 5_000,
      backoffBaseMs:  cfg.backoffBaseMs  ?? 500,
      backoffMaxMs:   cfg.backoffMaxMs   ?? 8_000,
      maxAttempts:    cfg.maxAttempts    ?? 4,
      etagStore:      cfg.etagStore      ?? new MemoryEtagStore(),
      fetchImpl:      cfg.fetchImpl      ?? fetch,
      logger:         cfg.logger         ?? defaultLogger(),
    }
  }

  /** Cumulative credits observed via response headers. */
  get creditsSpent(): number { return this.creditsUsed }
  /** Total HTTP requests made (including retries). */
  get requestCount(): number { return this.requestsMade }
  /** Last credit snapshot from any response. */
  get lastCreditSnapshot(): CreditSnapshot | null { return this.lastCredits }

  /** Escape hatch. Prefer the typed helpers below when possible. */
  async raw<T = unknown>(
    path: string,
    opts: { query?: Record<string, string | number | undefined>; ifNoneMatch?: string } = {},
  ): Promise<TcgGraphResponse<T>> {
    return this.request<T>(path, opts)
  }

  async getGames(): Promise<TcgGraphResponse<TcgGraphPage<TcgGraphGame>>> {
    return this.request<TcgGraphPage<TcgGraphGame>>('/games')
  }

  async listSets(gameId: string, opts: { cursor?: string; limit?: number } = {}): Promise<TcgGraphResponse<TcgGraphPage<TcgGraphSet>>> {
    return this.request('/sets', { query: { game: gameId, cursor: opts.cursor, limit: opts.limit } })
  }

  async listCards(gameId: string, opts: { setId?: string; cursor?: string; limit?: number } = {}): Promise<TcgGraphResponse<TcgGraphPage<TcgGraphCard>>> {
    return this.request('/cards', { query: { game: gameId, set: opts.setId, cursor: opts.cursor, limit: opts.limit } })
  }

  async listPrintings(gameId: string, opts: { setId?: string; cursor?: string; limit?: number } = {}): Promise<TcgGraphResponse<TcgGraphPage<TcgGraphPrinting>>> {
    return this.request('/printings', { query: { game: gameId, set: opts.setId, cursor: opts.cursor, limit: opts.limit } })
  }

  async getMarketPrices(gameId: string, opts: { printingId?: string; setId?: string; cursor?: string; limit?: number } = {}): Promise<TcgGraphResponse<TcgGraphPage<TcgGraphMarketPrice>>> {
    return this.request('/prices/market', { query: { game: gameId, printing: opts.printingId, set: opts.setId, cursor: opts.cursor, limit: opts.limit } })
  }

  async getGradedPrices(gameId: string, opts: { printingId?: string; setId?: string; cursor?: string; limit?: number } = {}): Promise<TcgGraphResponse<TcgGraphPage<TcgGraphGradedPrice>>> {
    return this.request('/prices/graded', { query: { game: gameId, printing: opts.printingId, set: opts.setId, cursor: opts.cursor, limit: opts.limit } })
  }

  // -------------------------------------------------------------------
  // Core request logic. Retries transient failures with capped
  // exponential backoff. Respects Retry-After. Enforces credit +
  // request budgets. Handles ETag round-tripping.
  // -------------------------------------------------------------------
  private async request<T>(
    path: string,
    opts: { query?: Record<string, string | number | undefined>; ifNoneMatch?: string; method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<TcgGraphResponse<T>> {
    if (this.creditsUsed >= this.cfg.creditBudget) {
      throw new TcgGraphCreditBudgetError(`credit budget (${this.cfg.creditBudget}) exhausted; refusing request to ${path}`)
    }
    if (this.requestsMade >= this.cfg.requestBudget) {
      throw new TcgGraphRequestBudgetError(`request budget (${this.cfg.requestBudget}) exhausted; refusing request to ${path}`)
    }

    const url = this.buildUrl(path, opts.query)
    const cacheKey = url
    const cached = opts.ifNoneMatch === undefined
      ? await this.cfg.etagStore.get(cacheKey)
      : null
    const ifNoneMatch = opts.ifNoneMatch ?? cached?.etag

    const t0 = Date.now()
    let attempt = 0
    let lastStatus = 0
    let lastError: string | undefined

    while (attempt < this.cfg.maxAttempts) {
      attempt += 1
      this.requestsMade += 1
      let res: Response
      try {
        res = await this.cfg.fetchImpl(url, {
          method: opts.method ?? 'GET',
          headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${this.cfg.apiKey}`,
            'user-agent': 'MTGPrices/TCGGraph-Client/0.1 (+https://mtgprices.io)',
            ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}),
            ...(opts.body ? { 'content-type': 'application/json' } : {}),
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        })
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        this.cfg.logger.warn('tcggraph.fetch_threw', { path, attempt, error: lastError })
        if (attempt >= this.cfg.maxAttempts) break
        await this.sleep(this.backoff(attempt))
        continue
      }

      const credits = parseCredits(res.headers)
      this.lastCredits = credits
      if (credits.requestCost != null && credits.requestCost > 0) {
        this.creditsUsed += credits.requestCost
      } else if (res.status !== 304) {
        // Best-effort: if the API doesn't send TCGGraph-Cost on this
        // endpoint we assume 1 credit so budget accounting is still
        // pessimistic. 304 is free.
        this.creditsUsed += 1
      }
      lastStatus = res.status

      if (res.status === 304) {
        this.cfg.logger.info('tcggraph.304_unchanged', { path, attempt, credits })
        return {
          status: 304,
          body: (cached?.body as T | null) ?? null,
          unchanged: true,
          etag: ifNoneMatch ?? null,
          credits,
          elapsedMs: Date.now() - t0,
          attempts: attempt,
        }
      }
      if (res.status === 200) {
        const etag = res.headers.get('etag')
        const body = await this.safeJson<T>(res)
        if (etag && body != null) await this.cfg.etagStore.set(cacheKey, etag, body)
        this.cfg.logger.info('tcggraph.ok', { path, attempt, status: 200, credits })
        return { status: 200, body, unchanged: false, etag, credits, elapsedMs: Date.now() - t0, attempts: attempt }
      }
      if (res.status === 401 || res.status === 403) {
        throw new TcgGraphAuthError(`auth failed on ${path}: HTTP ${res.status}`, path)
      }
      if (res.status === 429) {
        // Honour Retry-After if present; otherwise capped exponential.
        const wait = this.retryAfterMs(res) ?? this.backoff(attempt)
        this.cfg.logger.warn('tcggraph.429', { path, attempt, wait_ms: wait, credits })
        if (attempt >= this.cfg.maxAttempts) throw new TcgGraphRateLimitError(`rate limited on ${path}`, path)
        await this.sleep(wait)
        continue
      }
      if (res.status >= 500 && res.status < 600) {
        this.cfg.logger.warn('tcggraph.5xx', { path, attempt, status: res.status, credits })
        if (attempt >= this.cfg.maxAttempts) break
        await this.sleep(this.backoff(attempt))
        continue
      }
      // 4xx non-auth non-rate. Permanent failure - do not retry.
      const text = await res.text().catch(() => '')
      this.cfg.logger.error('tcggraph.permanent_error', { path, status: res.status, snippet: text.slice(0, 200) })
      throw new TcgGraphError(`HTTP ${res.status} on ${path}: ${text.slice(0, 200)}`, res.status, path)
    }

    throw new TcgGraphError(
      `exhausted ${this.cfg.maxAttempts} attempts on ${path} (last status ${lastStatus}${lastError ? ', last error ' + lastError : ''})`,
      lastStatus || undefined,
      path,
    )
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const p = path.startsWith('/') ? path : '/' + path
    const u = new URL(this.cfg.baseUrl.replace(/\/$/, '') + p)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue
        u.searchParams.set(k, String(v))
      }
    }
    return u.toString()
  }

  private retryAfterMs(res: Response): number | null {
    const h = res.headers.get('retry-after')
    if (!h) return null
    const asNumber = Number(h)
    if (Number.isFinite(asNumber)) return asNumber * 1000
    const asDate = Date.parse(h)
    if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now())
    return null
  }

  private backoff(attempt: number): number {
    return Math.min(this.cfg.backoffBaseMs * 2 ** (attempt - 1), this.cfg.backoffMaxMs)
  }

  private async safeJson<T>(res: Response): Promise<T | null> {
    try { return (await res.json()) as T } catch { return null }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}

// ---------------------------------------------------------------------
// Public factory. Reads TCGGRAPH_API_KEY from env. Never call from a
// Client Component.
// ---------------------------------------------------------------------

export function getTcgGraphClient(overrides: Partial<TcgGraphConfig> = {}): TcgGraphClient {
  const apiKey = (process.env.TCGGRAPH_API_KEY ?? '').trim()
  if (!apiKey) throw new TcgGraphError('TCGGRAPH_API_KEY is not set')
  return new TcgGraphClient({
    apiKey,
    baseUrl: process.env.TCGGRAPH_API_BASE || undefined,
    ...overrides,
  })
}

function defaultLogger(): TcgGraphLogger {
  return {
    info:  (m, meta) => { if (process.env.TCGGRAPH_DEBUG) console.log('[tcggraph]', m, meta ?? {}) },
    warn:  (m, meta) => { console.warn('[tcggraph]', m, meta ?? {}) },
    error: (m, meta) => { console.error('[tcggraph]', m, meta ?? {}) },
  }
}
