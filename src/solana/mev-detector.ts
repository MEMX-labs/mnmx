/**
 * MNMX MEV Detector
 *
 * Analyses pending transactions and pool state to identify probable
 * MEV threats against a proposed on-chain action.  Covers sandwich
 * attacks, frontrunning, backrunning, and JIT liquidity provision.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type {
  ExecutionAction,
  MevThreat,
  PendingTx,
  PoolState,
} from '../types/index.js';

// ── Known MEV Bot Patterns ──────────────────────────────────────────

/**
 * Heuristic signatures of known MEV bot programs and wallets.
 * In production these would be maintained via an on-chain registry or
 * external threat-intelligence feed.
 */
const KNOWN_MEV_PROGRAM_IDS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter (potential arb relay)
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
]);

/** Wallets historically associated with sandwich bots (illustrative). */
const SUSPECTED_SANDWICH_WALLETS = new Set([
  'SandwichBot1111111111111111111111111111111',
  'MEVBot111111111111111111111111111111111111',
]);

/** Minimum trade-to-reserve ratio that triggers threat analysis. */
const MIN_THREAT_RATIO = 0.0005;

/** Trade ratio above which sandwich probability is near-certain. */
const HIGH_RISK_RATIO = 0.05;

// ── MEV Detector ────────────────────────────────────────────────────

export class MevDetector {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Run all threat detectors against a proposed action and return
   * the union of identified threats, sorted by estimated cost descending.
   */
  detectThreats(
    action: ExecutionAction,
    recentTxs: PendingTx[],
    poolState?: PoolState,
  ): MevThreat[] {
    const threats: MevThreat[] = [];

    const sandwich = this.analyzeSandwichRisk(action, recentTxs, poolState);
    if (sandwich) threats.push(sandwich);

    const frontrun = this.analyzeFrontrunRisk(action, recentTxs, poolState);
    if (frontrun) threats.push(frontrun);

    const backrun = this.analyzeBackrunRisk(action, recentTxs, poolState);
    if (backrun) threats.push(backrun);

    if (poolState) {
      const jit = this.analyzeJitRisk(action, poolState);
      if (jit) threats.push(jit);
    }

    // Sort by expected cost (probability * estimated cost) descending
    threats.sort((a, b) => {
      const costA = Number(a.estimatedCost) * a.probability;
      const costB = Number(b.estimatedCost) * b.probability;
      return costB - costA;
    });

    return threats;
  }

  /**
   * Analyse the risk of a sandwich attack.
   *
   * A sandwich wraps the victim's swap between a frontleg (buy) and
   * backleg (sell), profiting from the price impact the victim causes.
   * Risk factors:
   *  - Large trade relative to pool reserves
   *  - High slippage tolerance (gives the attacker room)
   *  - Presence of known sandwich bot TXs in recent history
   */
  analyzeSandwichRisk(
    action: ExecutionAction,
    pendingTxs: PendingTx[],
    poolState?: PoolState,
  ): MevThreat | null {
    if (action.kind !== 'swap') return null;

    const tradeRatio = poolState
      ? this.computeTradeRatio(action.amount, poolState)
      : 0;

    if (tradeRatio < MIN_THREAT_RATIO && !this.hasSuspectedBotActivity(pendingTxs)) {
      return null;
    }

    // Probability model: logistic function of trade ratio and slippage
    const ratioProbability = this.logisticProbability(tradeRatio, 0.01, 200);
    const slippageProbability = this.logisticProbability(
      action.slippageBps / 10_000,
      0.005,
      400,
    );
    const botPresenceBoost = this.hasSuspectedBotActivity(pendingTxs) ? 0.15 : 0;

    const probability = Math.min(
      ratioProbability * 0.5 + slippageProbability * 0.35 + botPresenceBoost,
      0.95,
    );

    // Cost estimate: proportional to trade ratio squared (quadratic impact)
    const estimatedCost = this.estimateSandwichCost(action.amount, tradeRatio);

    return {
      kind: 'sandwich',
      probability,
      estimatedCost,
      sourceAddress: this.identifyLikelyBot(pendingTxs, 'sandwich'),
      relatedPool: action.pool,
      description: `Sandwich attack risk: ${(probability * 100).toFixed(1)}% probability, trade/reserve ratio ${(tradeRatio * 100).toFixed(3)}%`,
    };
  }

  /**
   * Analyse the risk of a pure frontrun.
   *
   * A frontrunner submits a similar trade ahead of the victim to
   * benefit from the price movement. Less common than sandwiches on
   * Solana due to deterministic ordering, but possible via Jito bundles.
   */
  analyzeFrontrunRisk(
    action: ExecutionAction,
    pendingTxs: PendingTx[],
    poolState?: PoolState,
  ): MevThreat | null {
    if (!['swap', 'liquidate'].includes(action.kind)) return null;
