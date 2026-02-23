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
