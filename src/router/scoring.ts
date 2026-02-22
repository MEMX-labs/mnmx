// ─────────────────────────────────────────────────────────────
// Route Scoring Engine
// Multi-dimensional scoring for route comparison
// ─────────────────────────────────────────────────────────────

import type {
  Route,
  RouteHop,
  ScoringWeights,
  Strategy,
  CandidatePath,
  AdversarialModel,
} from '../types/index.js';
import { STRATEGY_WEIGHTS } from '../types/index.js';

/**
 * Maximum reference values for normalization.
 */
const MAX_FEE_RATIO = 0.10;
const MAX_SLIPPAGE_BPS = 200;
const MAX_TIME_SECONDS = 1800;
const MIN_RELIABILITY = 0.80;
const MAX_MEV_RATIO = 0.05;

/**
 * Normalize a fee as a fraction of input amount.
 * Lower fees produce higher scores (closer to 1.0).
 */
export function normalizeFee(fee: number, inputAmount: number): number {
  if (inputAmount <= 0) return 0;
  const feeRatio = fee / inputAmount;
  return Math.max(0, Math.min(1, 1 - feeRatio / MAX_FEE_RATIO));
}

/**
 * Normalize speed: map estimated time in seconds to a 0-1 score.
 * Uses MAX_TIME_SECONDS as the worst acceptable time.
 */
export function normalizeSpeed(estimatedTimeSeconds: number): number {
  if (estimatedTimeSeconds <= 0) return 1;
  if (estimatedTimeSeconds >= MAX_TIME_SECONDS) return 0;
  return 1 - estimatedTimeSeconds / MAX_TIME_SECONDS;
}

/**
 * Normalize reliability from a 0-1 success rate.
 * For multi-hop routes, multiply per-hop reliabilities.
 */
export function normalizeReliability(perHopRates: number[]): number {
  if (perHopRates.length === 0) return 0;
  let compound = 1;
  for (const rate of perHopRates) {
    compound *= Math.max(0, Math.min(1, rate));
  }
  return compound;
}

/**
 * Normalize slippage from basis points to a 0-1 score.
 * 0 bps = 1.0, MAX_SLIPPAGE_BPS+ bps = 0.0.
 */
export function normalizeSlippage(slippageBps: number): number {
  if (slippageBps <= 0) return 1;
  if (slippageBps >= MAX_SLIPPAGE_BPS) return 0;
  return 1 - slippageBps / MAX_SLIPPAGE_BPS;
}

/**
 * Normalize MEV exposure as a fraction of input.
 * Lower MEV exposure = higher score.
 */
export function normalizeMevExposure(mevAmount: number, inputAmount: number): number {
  if (inputAmount <= 0) return 1;
  const ratio = mevAmount / inputAmount;
  return Math.max(0, Math.min(1, 1 - ratio / MAX_MEV_RATIO));
}

/**
 * Compute a composite score for a route given individual scores and weights.
 */
export function computeScore(
  feeScore: number,
  slippageScore: number,
  speedScore: number,
  reliabilityScore: number,
  mevScore: number,
  weights: ScoringWeights,
): number {
  return (
    feeScore * weights.fees +
    slippageScore * weights.slippage +
    speedScore * weights.speed +
    reliabilityScore * weights.reliability +
    mevScore * weights.mevExposure
