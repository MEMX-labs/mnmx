/**
 * MNMX Core Type Definitions
 *
 * Canonical types for the minimax execution engine, covering game tree
 * representation, on-chain state modeling, MEV threat classification,
 * and search/evaluation configuration.
 */

// ── Player Designation ──────────────────────────────────────────────

/** The two adversarial roles in the game tree. */
export type Player = 'agent' | 'adversary';

// ── Action Taxonomy ─────────────────────────────────────────────────

/** Exhaustive set of on-chain action categories the engine can plan. */
export type ActionKind =
  | 'swap'
  | 'transfer'
  | 'stake'
  | 'unstake'
  | 'liquidate'
  | 'provide_liquidity'
  | 'remove_liquidity'
  | 'borrow'
  | 'repay';

/** An atomic on-chain action the agent may execute. */
export interface ExecutionAction {
  readonly kind: ActionKind;
  readonly tokenMintIn: string;
  readonly tokenMintOut: string;
  readonly amount: bigint;
  readonly slippageBps: number;
  readonly pool: string;
  readonly priority: number;
  readonly label: string;
}

// ── Game Tree ───────────────────────────────────────────────────────

/** A single vertex in the minimax game tree. */
export interface GameNode {
  readonly action: ExecutionAction | null;
  readonly stateHash: string;
  children: GameNode[];
  score: number;
  readonly depth: number;
  isTerminal: boolean;
  readonly player: Player;
}

// ── Evaluation ──────────────────────────────────────────────────────

/** Granular breakdown of a position evaluation. */
export interface EvaluationBreakdown {
  gasCost: number;
  slippageImpact: number;
  mevExposure: number;
  profitPotential: number;
}

/** Composite result of evaluating a (state, action) pair. */
export interface EvaluationResult {
  score: number;
  breakdown: EvaluationBreakdown;
  confidence: number;
}

/** Weights applied to each evaluation component in the linear combination. */
export interface EvaluationWeights {
  gasCost: number;
  slippageImpact: number;
  mevExposure: number;
  profitPotential: number;
}

// ── Search Configuration ────────────────────────────────────────────

/** Parameters governing the minimax search behaviour. */
export interface SearchConfig {
  readonly maxDepth: number;
  readonly alphaBetaPruning: boolean;
  readonly timeLimitMs: number;
  readonly evaluationWeights: EvaluationWeights;
  readonly maxTranspositionEntries: number;
}

/** Sensible defaults for search configuration. */
export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  maxDepth: 6,
  alphaBetaPruning: true,
  timeLimitMs: 5_000,
  evaluationWeights: {
    gasCost: 0.15,
    slippageImpact: 0.25,
    mevExposure: 0.35,
    profitPotential: 0.25,
  },
  maxTranspositionEntries: 100_000,
};

// ── On-Chain State ──────────────────────────────────────────────────

/** Snapshot of a liquidity pool's reserves and configuration. */
export interface PoolState {
  readonly address: string;
  readonly tokenMintA: string;
  readonly tokenMintB: string;
  reserveA: bigint;
  reserveB: bigint;
  readonly feeBps: number;
  readonly tickSpacing?: number;
  readonly sqrtPriceX64?: bigint;
}

/** A pending (unconfirmed) transaction visible in the mempool. */
export interface PendingTx {
  readonly signature: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly programId: string;
  readonly data: Uint8Array;
  readonly lamports: bigint;
  readonly slot: number;
}

/** Aggregated view of relevant on-chain state at a point in time. */
export interface OnChainState {
  tokenBalances: Map<string, bigint>;
  poolStates: Map<string, PoolState>;
  pendingTransactions: PendingTx[];
  slot: number;
  readonly timestamp: number;
}

// ── MEV Threat Model ────────────────────────────────────────────────

/** Classification of MEV extraction strategies. */
export type MevThreatKind = 'sandwich' | 'frontrun' | 'backrun' | 'jit';

/** A detected or hypothesised MEV threat. */
export interface MevThreat {
  readonly kind: MevThreatKind;
  probability: number;
  estimatedCost: bigint;
  readonly sourceAddress: string;
  readonly relatedPool: string;
  readonly description: string;
}

// ── Execution Planning ──────────────────────────────────────────────

/** Statistics gathered during a minimax search invocation. */
export interface SearchStats {
  nodesExplored: number;
  nodesPruned: number;
  maxDepthReached: number;
  timeMs: number;
  transpositionHits: number;
}

/** The engine's recommended execution plan. */
export interface ExecutionPlan {
  readonly actions: ExecutionAction[];
  readonly expectedOutcome: EvaluationResult;
  readonly totalScore: number;
  readonly stats: SearchStats;
  readonly rootStateHash: string;
}

// ── Execution Results ───────────────────────────────────────────────

/** Outcome of submitting a transaction to the network. */
export interface ExecutionResult {
  readonly success: boolean;
  readonly signatures: string[];
  readonly errors: string[];
  readonly actualSlippageBps: number;
  readonly computeUnitsUsed: number;
  readonly totalFeeLamports: bigint;
}

/** Result of simulating a transaction before submission. */
export interface SimulationResult {
  readonly success: boolean;
  readonly computeUnitsConsumed: number;
  readonly logs: string[];
  readonly error: string | null;
  readonly returnData: Uint8Array | null;
}

// ── State Change (for incremental hashing) ──────────────────────────

/** Describes a single mutation to on-chain state. */
export interface StateChange {
  readonly field: 'tokenBalance' | 'poolReserve' | 'slot';
  readonly key: string;
  readonly previousValue: bigint;
  readonly newValue: bigint;
}
