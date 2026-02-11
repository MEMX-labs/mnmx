/**
 * MNMX Minimax Engine
 *
 * Core adversarial search engine that finds the optimal sequence of
 * on-chain actions by modelling MEV bots as rational adversaries in a
 * two-player zero-sum game.  Implements:
 *
 *  - Negamax formulation with alpha-beta pruning
 *  - Iterative deepening (searches depth 1, 2, … up to maxDepth)
 *  - Transposition table for DAG-style position caching
 *  - Move ordering via killer moves, history heuristic, and MVV-LVA
 *  - Time management that respects a hard deadline
 *
 * References:
 *  - Von Neumann, J. (1928). Zur Theorie der Gesellschaftsspiele.
 *  - Knuth, D. & Moore, R. (1975). An Analysis of Alpha-Beta Pruning.
 */

import type {
  ExecutionAction,
  ExecutionPlan,
  GameNode,
  MevThreat,
  OnChainState,
  SearchConfig,
  SearchStats,
} from '../types/index.js';
import { DEFAULT_SEARCH_CONFIG } from '../types/index.js';
import { PositionEvaluator } from './evaluator.js';
import { GameTreeBuilder } from './game-tree.js';
import { MoveOrderer } from './move-ordering.js';
import { TranspositionTable } from './transposition.js';
import type { BoundFlag } from './transposition.js';

// ── Engine ──────────────────────────────────────────────────────────

export class MinimaxEngine {
  private readonly config: SearchConfig;
  private readonly evaluator: PositionEvaluator;
  private readonly treeBuilder: GameTreeBuilder;
  private readonly moveOrderer: MoveOrderer;
  private readonly transpositionTable: TranspositionTable;

  // Search state (reset each invocation)
  private deadline = 0;
  private nodesExplored = 0;
  private nodesPruned = 0;
  private maxDepthReached = 0;
  private searchAborted = false;
  private bestRootAction: ExecutionAction | null = null;

  constructor(config: Partial<SearchConfig> = {}) {
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
    this.evaluator = new PositionEvaluator(this.config);
    this.treeBuilder = new GameTreeBuilder(this.config);
    this.moveOrderer = new MoveOrderer();
    this.transpositionTable = new TranspositionTable(
      this.config.maxTranspositionEntries,
    );
  }

  /**
   * Run an iterative-deepening minimax search from the given state and
   * return the optimal execution plan.
   */
  search(
    rootState: OnChainState,
    possibleActions: ExecutionAction[],
  ): ExecutionPlan {
    const startTime = performance.now();
    this.resetSearchState(startTime);

    if (possibleActions.length === 0) {
      return this.emptyPlan(rootState, startTime);
    }

    const rootHash = this.treeBuilder.hashState(rootState);
    let bestScore = -Infinity;
    let bestActions: ExecutionAction[] = [];
    let bestEval = this.evaluator.evaluate(rootState, possibleActions[0]!);

    // Iterative deepening: search at depth 1, 2, … up to maxDepth
    for (let depth = 1; depth <= this.config.maxDepth; depth++) {
      if (this.isTimeUp()) break;

      this.transpositionTable.incrementAge();
      const iterationBest = this.searchAtDepth(
        rootState,
        possibleActions,
        depth,
      );

      if (this.searchAborted && depth > 1) {
        // Use results from the last completed iteration
        break;
      }

      if (iterationBest.score > bestScore || depth === 1) {
        bestScore = iterationBest.score;
        bestActions = iterationBest.actions;
        bestEval = iterationBest.eval;
      }

      this.maxDepthReached = depth;
    }

    const elapsed = performance.now() - startTime;
    const ttStats = this.transpositionTable.getStats();

    const stats: SearchStats = {
      nodesExplored: this.nodesExplored,
      nodesPruned: this.nodesPruned,
      maxDepthReached: this.maxDepthReached,
      timeMs: elapsed,
      transpositionHits: ttStats.hits,
    };

    return {
      actions: bestActions,
      expectedOutcome: bestEval,
      totalScore: bestScore,
      stats,
      rootStateHash: rootHash,
    };
  }

  /** Expose the transposition table for external inspection / clearing. */
  getTranspositionTable(): TranspositionTable {
    return this.transpositionTable;
  }

  /** Clear all cached state between independent search sessions. */
  reset(): void {
    this.transpositionTable.clear();
    this.moveOrderer.reset();
  }

  // ── Depth-Limited Search ────────────────────────────────────────
