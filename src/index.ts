/**
 * @mnmx/core
 *
 * Minimax execution engine for autonomous on-chain agents.
 * Treats MEV bots as adversaries in a game tree and uses alpha-beta
 * search to find optimal execution paths on Solana.
 */

// ── Types ───────────────────────────────────────────────────────────
export type {
  Player,
  ActionKind,
  ExecutionAction,
  GameNode,
  EvaluationBreakdown,
  EvaluationResult,
  EvaluationWeights,
  SearchConfig,
  PoolState,
  PendingTx,
  OnChainState,
  MevThreatKind,
  MevThreat,
  SearchStats,
  ExecutionPlan,
  ExecutionResult,
  SimulationResult,
  StateChange,
} from './types/index.js';

export { DEFAULT_SEARCH_CONFIG } from './types/index.js';

// ── Engine ──────────────────────────────────────────────────────────
export { MinimaxEngine } from './engine/minimax.js';
export { GameTreeBuilder } from './engine/game-tree.js';
export { PositionEvaluator } from './engine/evaluator.js';
export { MoveOrderer } from './engine/move-ordering.js';
export { TranspositionTable } from './engine/transposition.js';
export type { BoundFlag, TranspositionEntry, TableStats, LookupResult } from './engine/transposition.js';

// ── Solana ──────────────────────────────────────────────────────────
export { StateReader } from './solana/state-reader.js';
export { PlanExecutor } from './solana/executor.js';
export { MevDetector } from './solana/mev-detector.js';

// ── Utilities ───────────────────────────────────────────────────────
export {
  initZobristTable,
  hashOnChainState,
  incrementalHash,
} from './utils/hash.js';
export type { ZobristTable } from './utils/hash.js';

export {
  constantProductSwap,
  calculateSlippage,
  concentratedLiquiditySwap,
  priceToSqrtPriceX64,
  sqrtPriceX64ToPrice,
  bigIntSqrt,
  estimatePriceImpact,
  constantProductSwapInverse,
  bpsToDecimal,
  decimalToBps,
} from './utils/math.js';
