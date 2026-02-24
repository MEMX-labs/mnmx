// ─────────────────────────────────────────────────────────────
// MNMX Core - Cross-chain routing with minimax search
// ─────────────────────────────────────────────────────────────

// Types
export type {
  Chain,
  Strategy,
  BridgeStatus,
  Token,
  ChainConfig,
  RouteHop,
  Route,
  RouteEndpoint,
  RouteRequest,
  RouteOptions,
  ScoringWeights,
  AdversarialModel,
  RouterConfig,
  QuoteParams,
  BridgeQuote,
  BridgeHealth,
  Signer,
  TransactionRequest,
  ProgressEvent,
  ExecOpts,
  ExecutionResult,
  SearchStats,
  CandidatePath,
} from './types/index.js';

export {
  ALL_CHAINS,
  LogLevel,
  DEFAULT_ROUTER_CONFIG,
  STRATEGY_WEIGHTS,
} from './types/index.js';

// Router
export { MnmxRouter } from './router/index.js';
export type { RouteResult } from './router/index.js';
export {
  PathDiscovery,
  MinimaxEngine,
  minimaxSearch,
  minimaxSearchWithPruning,
  iterativeDeepening,
  discoverChainPaths,
  filterDominatedPaths,
  buildCandidatePaths,
  normalizeFee,
  normalizeSpeed,
  normalizeSlippage,
  normalizeReliability,
  normalizeMevExposure,
  computeScore,
  getWeightsForStrategy,
  weightsAreValid,
  normalizeWeights,
  compareRoutes,
  rankCandidates,
  scoreRoute,
  getScoreBreakdown,
} from './router/index.js';
export type { MinimaxOptions, MinimaxResult, ScoreBreakdown } from './router/index.js';

// Bridges
export {
  BridgeRegistry,
  AbstractBridgeAdapter,
} from './bridges/adapter.js';
export type { BridgeAdapter } from './bridges/adapter.js';
export { WormholeAdapter } from './bridges/wormhole.js';
export { DeBridgeAdapter } from './bridges/debridge.js';
export { LayerZeroAdapter } from './bridges/layerzero.js';
export { AllbridgeAdapter } from './bridges/allbridge.js';

// Chains
export {
  CHAIN_CONFIGS,
  getChainConfig,
  isChainSupported,
  getChainById,
  getAllChains,
  getNativeCurrency,
  findToken,
  getChainTokens,
} from './chains/index.js';

// Utilities
export { Logger, createLogger, defaultLogger } from './utils/logger.js';
export {
  clamp,
  normalizeToRange,
  weightedAverage,
  basisPointsToDecimal,
  decimalToBasisPoints,
  safeDivide,
  formatAmount,
  parseAmount,
  percentageDifference,
  lerp,
  geometricMean,
  sum,
  min,
} from './utils/math.js';
export {
  hashRoute,
  hashHop,
  generateRequestId,
  generateRouteId,
} from './utils/hash.js';
