# TCGGraph client (`src/lib/tcggraph`)

Server-only. Never import from a Client Component. `server-only` at
the top of `client.ts` enforces this at build time.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `TCGGRAPH_API_KEY` | **yes** | Bearer credential. Not `NEXT_PUBLIC_*`. |
| `TCGGRAPH_API_BASE` | no | Overrides the default `https://api.tcggraph.com` for sandboxes/tests. |
| `TCGGRAPH_DEBUG` | no | When set, `info` logs are printed. |

## Contract

- Typed responses through the generic `TcgGraphResponse<T>` envelope.
- **ETag / If-None-Match** on every request. Successful `200`s cache the ETag and body in an in-memory store by default (a Supabase-backed store can be passed in); the next request for the same URL sends `if-none-match` and treats `304` as an unchanged short-circuit that returns the cached body with `unchanged: true`.
- **Credit-header capture**: `TCGGraph-Credits-Limit`, `TCGGraph-Credits-Remaining`, `TCGGraph-Credits-Reset`, `TCGGraph-Cost`, plus `X-RateLimit-Limit`, `X-RateLimit-Remaining`. Surfaced on every response via `.credits`.
- **Hard safety budgets**: `creditBudget` (default 20 000) and `requestBudget` (default 5 000) per client instance. Exceeding either throws `TcgGraphCreditBudgetError` / `TcgGraphRequestBudgetError` *before* the request is even attempted — so a runaway loop cannot drain the monthly Growth allowance.
- **Retry policy** (capped exponential backoff, base 500 ms, cap 8 s, `maxAttempts=4`):
  - `200` / `304` → success.
  - `429` → honour `Retry-After` if numeric or HTTP-date; else exponential. Retry until `maxAttempts`, then throw `TcgGraphRateLimitError`.
  - `5xx` → retry until `maxAttempts`, then throw `TcgGraphError`.
  - `401` / `403` → immediate `TcgGraphAuthError`, no retry.
  - Any other `4xx` → immediate `TcgGraphError`, no retry.
- **Structured logging** via injectable `TcgGraphLogger`. Every request emits one of: `tcggraph.ok`, `tcggraph.304_unchanged`, `tcggraph.429`, `tcggraph.5xx`, `tcggraph.permanent_error`, `tcggraph.fetch_threw`. `info`-level events are silent unless `TCGGRAPH_DEBUG=1`.

## API surface

```ts
const client = getTcgGraphClient()               // reads TCGGRAPH_API_KEY
await client.getGames()
await client.listSets('mtg', { cursor })
await client.listCards('ygo', { setId: 'lob' })
await client.listPrintings('onepiece', { setId: 'op01', limit: 100 })
await client.getMarketPrices('swu', { printingId })
await client.getGradedPrices('mtg', { printingId })
await client.raw('/some/other/endpoint', { query: {…} })     // escape hatch

client.creditsSpent          // cumulative for this instance
client.requestCount          // total HTTP requests (incl. retries)
client.lastCreditSnapshot    // {creditsLimit, creditsRemaining, requestCost, ...}
```

Each call returns:
```ts
{
  status: 200 | 304 | ...
  body: T | null
  unchanged: boolean          // true on 304
  etag: string | null
  credits: CreditSnapshot
  elapsedMs: number
  attempts: number
}
```

## What's mocked in tests, what needs real credentials

`src/__tests__/tcggraph.test.ts` covers the client wrapper itself with a mocked `fetch`. The 13 tests pin: credit-header parsing (including null-safety), typed 200 body + ETag persist, 304 short-circuit with `If-None-Match`, `Retry-After` on 429, 429/5xx exhaust, immediate throw on 400/401, credit/request budget short-circuits, URL composition + `Authorization: Bearer` header.

They do **not** talk to TCGGraph. Phases D–G in the mission (real sample data, MTG identity mapping, graded shape, credit model) require the API key. See §Blocker in the report.
