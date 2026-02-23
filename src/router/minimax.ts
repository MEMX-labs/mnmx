// ─────────────────────────────────────────────────────────────
// Minimax Search Engine
// Game-tree search for optimal cross-chain routing
// ─────────────────────────────────────────────────────────────

import type {
  CandidatePath,
  Route,
  RouteHop,
  Strategy,
  ScoringWeights,
  AdversarialModel,
  SearchStats,
  BridgeQuote,
  Chain,
  Token,
} from '../types/index.js';
import {
  DEFAULT_ROUTER_CONFIG,
} from '../types/index.js';
import {
  normalizeFee,
  normalizeSpeed,
  normalizeSlippage,
  normalizeMevExposure,
  computeScore,
} from './scoring.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MinimaxOptions {
  maxDepth: number;
  weights: ScoringWeights;
  adversarialModel: AdversarialModel;
  strategy: Strategy;
  /** Timeout in ms; search stops early if exceeded */
  timeoutMs?: number;
}

export interface MinimaxResult {
  bestRoute: Route | null;
  allRoutes: Route[];
  stats: SearchStats;
}

/**
 * A node in the minimax search tree.
 * Each node represents a state after applying some set of adversarial
 * conditions to a candidate path.
 */
export interface SearchNode {
  /** The candidate being evaluated */
  candidate: CandidatePath;
  /** Current adversarial scenario index */
  scenarioIndex: number;
  /** Depth in the search tree */
  depth: number;
  /** Score at this node */
  score: number;
  /** Whether this is a maximizing node (router) or minimizing (adversary) */
  isMaximizing: boolean;
  /** Child nodes */
  children: SearchNode[];
}

/**
 * An adversarial scenario: a specific configuration of worst-case parameters.
 */
interface AdversarialScenario {
  label: string;
  slippageMultiplier: number;
  gasMultiplier: number;
  bridgeDelayMultiplier: number;
  mevExtraction: number;
  priceMovement: number;
  failureProbability: number;
}

// ─────────────────────────────────────────────────────────────
// Adversarial Scenarios
// ─────────────────────────────────────────────────────────────

/**
 * Generate a set of adversarial scenarios from the base model.
 * Each scenario represents a different "move" the adversary can make.
 */
function generateScenarios(model: AdversarialModel): AdversarialScenario[] {
  return [
    // Base adversarial scenario
    {
      label: 'base',
      slippageMultiplier: model.slippageMultiplier,
      gasMultiplier: model.gasMultiplier,
      bridgeDelayMultiplier: model.bridgeDelayMultiplier,
      mevExtraction: model.mevExtraction,
      priceMovement: model.priceMovement,
      failureProbability: model.failureProbability,
    },
    // High slippage scenario
    {
      label: 'high-slippage',
      slippageMultiplier: model.slippageMultiplier * 2.0,
      gasMultiplier: model.gasMultiplier,
      bridgeDelayMultiplier: model.bridgeDelayMultiplier,
      mevExtraction: model.mevExtraction,
      priceMovement: model.priceMovement * 1.5,
      failureProbability: model.failureProbability,
    },
    // High gas scenario
    {
      label: 'high-gas',
      slippageMultiplier: model.slippageMultiplier,
      gasMultiplier: model.gasMultiplier * 2.5,
      bridgeDelayMultiplier: model.bridgeDelayMultiplier,
      mevExtraction: model.mevExtraction,
      priceMovement: model.priceMovement,
      failureProbability: model.failureProbability,
    },
    // High delay scenario (bridge congestion)
    {
      label: 'congestion',
      slippageMultiplier: model.slippageMultiplier * 1.2,
      gasMultiplier: model.gasMultiplier * 1.5,
      bridgeDelayMultiplier: model.bridgeDelayMultiplier * 3.0,
      mevExtraction: model.mevExtraction * 1.5,
      priceMovement: model.priceMovement * 2.0,
      failureProbability: model.failureProbability * 2,
    },
    // MEV attack scenario
    {
      label: 'mev-attack',
      slippageMultiplier: model.slippageMultiplier * 1.5,
      gasMultiplier: model.gasMultiplier * 1.2,
      bridgeDelayMultiplier: model.bridgeDelayMultiplier,
      mevExtraction: model.mevExtraction * 5.0,
      priceMovement: model.priceMovement * 3.0,
      failureProbability: model.failureProbability,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// Core Minimax Functions
// ─────────────────────────────────────────────────────────────

/**
 * Evaluate a candidate path under normal conditions.
 */
function evaluateCandidate(
  candidate: CandidatePath,
  inputAmount: number,
  weights: ScoringWeights,
): number {
  const feeScore = normalizeFee(candidate.estimatedFee, inputAmount);
  const speedScore = normalizeSpeed(candidate.estimatedTime);
  const avgSlippage =
    candidate.quotes.length > 0
      ? candidate.quotes.reduce((s, q) => s + q.slippageBps, 0) / candidate.quotes.length
      : 0;
  const slippageScore = normalizeSlippage(avgSlippage);

  // Reliability degrades with more hops
  const reliabilityScore = Math.max(0, 1 - candidate.chains.length * 0.02);

  // MEV estimate
  const timeFraction = candidate.estimatedTime / 3600;
  const mevAmount = inputAmount * timeFraction * 0.001;
  const mevScore = normalizeMevExposure(mevAmount, inputAmount);

  return computeScore(feeScore, slippageScore, speedScore, reliabilityScore, mevScore, weights);
}

/**
 * Evaluate a candidate path under an adversarial scenario.
 * The adversary degrades fees, slippage, delay, and applies MEV extraction.
 */
function evaluateAdversarial(
  candidate: CandidatePath,
  inputAmount: number,
  weights: ScoringWeights,
  scenario: AdversarialScenario,
): number {
  const adjustedFee = candidate.estimatedFee * scenario.gasMultiplier;
  const feeScore = normalizeFee(adjustedFee, inputAmount);

  const adjustedTime = candidate.estimatedTime * scenario.bridgeDelayMultiplier;
  const speedScore = normalizeSpeed(adjustedTime);

  const avgSlippage =
    candidate.quotes.length > 0
      ? candidate.quotes.reduce((s, q) => s + q.slippageBps, 0) / candidate.quotes.length
      : 0;
  const adjustedSlippage = avgSlippage * scenario.slippageMultiplier;
  const slippageScore = normalizeSlippage(adjustedSlippage);

  // Reliability decreases with more hops and higher failure probability
  const hopCount = candidate.chains.length - 1;
  const perHopSuccess = 1 - scenario.failureProbability;
  const compoundReliability = Math.pow(perHopSuccess, hopCount);
  const reliabilityScore = Math.max(0, compoundReliability * (1 - hopCount * 0.01));

  // MEV under attack
  const mevAmount = inputAmount * scenario.mevExtraction;
  const mevScore = normalizeMevExposure(mevAmount, inputAmount);

  return computeScore(feeScore, slippageScore, speedScore, reliabilityScore, mevScore, weights);
}

/**
 * Apply adversarial degradation to expected output.
 */
function applyAdversarialToOutput(
  expectedOutput: number,
  scenario: AdversarialScenario,
): number {
  const slippageLoss = expectedOutput * (scenario.slippageMultiplier - 1) * 0.01;
  const mevLoss = expectedOutput * scenario.mevExtraction;
  const priceLoss = expectedOutput * scenario.priceMovement;
  return Math.max(0, expectedOutput - slippageLoss - mevLoss - priceLoss);
}

/**
 * Build a Route object from a candidate and its minimax score.
 */
function buildRoute(
  candidate: CandidatePath,
  minimaxScore: number,
  guaranteedMinimum: number,
  strategy: Strategy,
): Route {
  const hops: RouteHop[] = candidate.quotes.map((q, i) => ({
    fromChain: candidate.chains[i],
    toChain: candidate.chains[i + 1],
    fromToken: candidate.tokens[i],
    toToken: candidate.tokens[i + 1],
    bridge: candidate.bridges[i],
    inputAmount: q.inputAmount,
    outputAmount: q.outputAmount,
    fee: q.fee,
    estimatedTime: q.estimatedTime,
    slippageBps: q.slippageBps,
    liquidityDepth: q.liquidityDepth,
  }));

  const lastQuote = candidate.quotes[candidate.quotes.length - 1];
  const expectedOutput = lastQuote ? lastQuote.outputAmount : '0';

  const now = Date.now();
  return {
    path: hops,
    expectedOutput,
    guaranteedMinimum: guaranteedMinimum.toFixed(6),
    totalFees: candidate.estimatedFee.toFixed(6),
    estimatedTime: candidate.estimatedTime,
    minimaxScore,
    strategy,
    routeId: generateRouteId(candidate),
    computedAt: now,
    expiresAt: now + 60_000,
  };
}

/**
 * Generate a deterministic route ID.
 */
function generateRouteId(candidate: CandidatePath): string {
  const chainStr = candidate.chains.join('-');
  const bridgeStr = candidate.bridges.join('-');
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${chainStr}_${bridgeStr}_${ts}_${rand}`;
}

// ─────────────────────────────────────────────────────────────
// Search Algorithms
// ─────────────────────────────────────────────────────────────

/**
 * Run basic minimax search over candidate paths.
 * The "maximizer" (router) picks the best route.
 * The "minimizer" (adversary) applies worst-case conditions.
 */
export function minimaxSearch(
  candidates: CandidatePath[],
  inputAmount: number,
  options: MinimaxOptions,
): MinimaxResult {
  const startTime = performance.now();
  let nodesExplored = 0;
  let nodesPruned = 0;
  let maxDepthReached = 0;

  const scenarios = generateScenarios(options.adversarialModel);
  const routes: Route[] = [];

  for (const candidate of candidates) {
    nodesExplored++;

    // Maximizer: evaluate at face value
    const baseScore = evaluateCandidate(candidate, inputAmount, options.weights);
    nodesExplored++;

    // Minimizer: find the worst adversarial scenario
    let worstScore = Infinity;
    let worstScenario = scenarios[0];

    for (const scenario of scenarios) {
      const advScore = evaluateAdversarial(
        candidate, inputAmount, options.weights, scenario,
      );
      nodesExplored++;
      if (advScore < worstScore) {
        worstScore = advScore;
        worstScenario = scenario;
      }
    }
    maxDepthReached = Math.max(maxDepthReached, 2);

    // Minimax score: the best we can guarantee against worst-case
    const minimaxScore = worstScore;

    const lastQuote = candidate.quotes[candidate.quotes.length - 1];
    const expectedOutput = parseFloat(lastQuote?.outputAmount ?? '0');
    const guaranteedMinimum = applyAdversarialToOutput(expectedOutput, worstScenario);

    routes.push(buildRoute(candidate, minimaxScore, guaranteedMinimum, options.strategy));
  }

  routes.sort((a, b) => b.minimaxScore - a.minimaxScore);

  return {
    bestRoute: routes[0] ?? null,
    allRoutes: routes,
    stats: {
      nodesExplored,
      nodesPruned,
      maxDepthReached,
      searchTimeMs: Math.round(performance.now() - startTime),
      candidateCount: candidates.length,
      quotesFetched: candidates.reduce((s, c) => s + c.quotes.length, 0),
    },
  };
}

/**
 * Minimax search with alpha-beta pruning.
 * Prunes branches that cannot improve on the current best guaranteed outcome.
 */
export function minimaxSearchWithPruning(
  candidates: CandidatePath[],
  inputAmount: number,
  options: MinimaxOptions,
): MinimaxResult {
  const startTime = performance.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  let nodesExplored = 0;
  let nodesPruned = 0;
  let maxDepthReached = 0;

  const scenarios = generateScenarios(options.adversarialModel);
  const routes: Route[] = [];
  let alpha = -Infinity; // best guaranteed score found so far (maximizer)

  // Sort candidates by rough score descending for better pruning
  const sorted = [...candidates].sort((a, b) => b.roughScore - a.roughScore);

  for (const candidate of sorted) {
    // Check timeout
    if (performance.now() - startTime > timeoutMs) break;

    nodesExplored++;

    // Quick upper-bound estimate (no adversarial degradation)
    const upperBound = evaluateCandidate(candidate, inputAmount, options.weights);
    nodesExplored++;

    // Alpha pruning: if best possible score cannot beat current alpha, skip
    if (upperBound <= alpha) {
      nodesPruned++;
      continue;
    }

    // Full adversarial evaluation across all scenarios
    let worstScore = Infinity;
    let worstScenario = scenarios[0];
    let pruned = false;

    for (const scenario of scenarios) {
      const advScore = evaluateAdversarial(
        candidate, inputAmount, options.weights, scenario,
      );
      nodesExplored++;

      if (advScore < worstScore) {
        worstScore = advScore;
        worstScenario = scenario;
      }

      // Beta pruning within adversarial search:
      // If this scenario already makes the route worse than alpha,
      // no need to check more scenarios (the adversary will pick this or worse)
      if (worstScore <= alpha) {
        nodesPruned += scenarios.length - scenarios.indexOf(scenario) - 1;
        pruned = true;
        break;
      }
    }

    maxDepthReached = Math.max(maxDepthReached, 2);

    // Even if pruned during scenario evaluation, record the route
    // with its worst known score
    const minimaxScore = worstScore;
    alpha = Math.max(alpha, minimaxScore);

    const lastQuote = candidate.quotes[candidate.quotes.length - 1];
    const expectedOutput = parseFloat(lastQuote?.outputAmount ?? '0');
    const guaranteedMinimum = applyAdversarialToOutput(expectedOutput, worstScenario);

    routes.push(buildRoute(candidate, minimaxScore, guaranteedMinimum, options.strategy));
  }

  routes.sort((a, b) => b.minimaxScore - a.minimaxScore);

  return {
    bestRoute: routes[0] ?? null,
    allRoutes: routes,
    stats: {
      nodesExplored,
      nodesPruned,
      maxDepthReached,
      searchTimeMs: Math.round(performance.now() - startTime),
      candidateCount: candidates.length,
      quotesFetched: candidates.reduce((s, c) => s + c.quotes.length, 0),
    },
  };
}

/**
 * Iterative deepening: run minimax at increasing adversarial severity.
 * Each iteration uses a more pessimistic adversarial model,
 * refining the guaranteed minimum progressively.
 */
export function iterativeDeepening(
  candidates: CandidatePath[],
  inputAmount: number,
  options: MinimaxOptions,
  maxIterations: number = 3,
): MinimaxResult[] {
  const results: MinimaxResult[] = [];

  for (let depth = 1; depth <= maxIterations; depth++) {
    // Each iteration scales adversarial model severity
    const scaleFactor = 1 + (depth - 1) * 0.3;
    const scaledModel: AdversarialModel = {
      slippageMultiplier: options.adversarialModel.slippageMultiplier * scaleFactor,
      gasMultiplier: options.adversarialModel.gasMultiplier * scaleFactor,
      bridgeDelayMultiplier: options.adversarialModel.bridgeDelayMultiplier * scaleFactor,
      mevExtraction: Math.min(options.adversarialModel.mevExtraction * scaleFactor, 0.1),
      priceMovement: Math.min(options.adversarialModel.priceMovement * scaleFactor, 0.1),
      failureProbability: Math.min(options.adversarialModel.failureProbability * scaleFactor, 0.2),
    };

    const depthOptions: MinimaxOptions = {
      ...options,
      maxDepth: depth,
      adversarialModel: scaledModel,
    };

    const result = minimaxSearchWithPruning(candidates, inputAmount, depthOptions);
    results.push(result);
  }

  return results;
}

/**
 * MinimaxEngine class - wraps the functional API.
 */
export class MinimaxEngine {
  private options: MinimaxOptions;

  constructor(options?: Partial<MinimaxOptions>) {
    this.options = {
      maxDepth: options?.maxDepth ?? 3,
      weights: options?.weights ?? DEFAULT_ROUTER_CONFIG.weights,
      adversarialModel: options?.adversarialModel ?? DEFAULT_ROUTER_CONFIG.adversarialModel,
      strategy: options?.strategy ?? 'minimax',
      timeoutMs: options?.timeoutMs ?? 30000,
    };
  }

  /**
   * Run minimax search with alpha-beta pruning.
   */
  search(candidates: CandidatePath[], inputAmount: number): MinimaxResult {
    return minimaxSearchWithPruning(candidates, inputAmount, this.options);
  }

  /**
   * Run iterative deepening search.
   */
  searchIterative(
    candidates: CandidatePath[],
    inputAmount: number,
    iterations?: number,
  ): MinimaxResult {
    const results = iterativeDeepening(
      candidates, inputAmount, this.options, iterations,
    );
    // Return the result from the deepest iteration
    return results[results.length - 1] ?? {
      bestRoute: null,
      allRoutes: [],
      stats: {
        nodesExplored: 0,
        nodesPruned: 0,
        maxDepthReached: 0,
        searchTimeMs: 0,
        candidateCount: 0,
        quotesFetched: 0,
      },
    };
  }

  /**
   * Update search options.
   */
  setOptions(options: Partial<MinimaxOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options.
   */
  getOptions(): MinimaxOptions {
    return { ...this.options };
  }
}
