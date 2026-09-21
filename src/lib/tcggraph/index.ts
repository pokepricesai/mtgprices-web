// src/lib/tcggraph/index.ts
// Public barrel. Import from '@/lib/tcggraph' rather than reaching
// into './client' directly so the internal shape can change.

export type {
  TcgGraphConfig,
  TcgGraphLogger,
  EtagStore,
} from './client'
export {
  TcgGraphClient,
  TcgGraphError,
  TcgGraphAuthError,
  TcgGraphRateLimitError,
  TcgGraphCreditBudgetError,
  TcgGraphRequestBudgetError,
  getTcgGraphClient,
  parseCredits,
} from './client'
export type {
  GameId,
  TcgGraphGame,
  TcgGraphSet,
  TcgGraphCard,
  TcgGraphPrinting,
  TcgGraphMarketPrice,
  TcgGraphGradedPrice,
  TcgGraphPage,
  TcgGraphResponse,
  CreditSnapshot,
} from './types'
