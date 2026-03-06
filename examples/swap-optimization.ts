/**
 * MNMX Swap Optimization Example
 *
 * Demonstrates how to use the minimax engine to find the optimal
 * execution path for a token swap on Solana, comparing naive vs
 * engine-optimised execution.
 *
 * Usage:
 *   npx tsx examples/swap-optimization.ts
 */

import { MinimaxEngine } from '../src/engine/minimax.js';
import { PositionEvaluator } from '../src/engine/evaluator.js';
import { constantProductSwap, calculateSlippage } from '../src/utils/math.js';
import type {
  ExecutionAction,
  OnChainState,
  PoolState,
  SearchConfig,
} from '../src/types/index.js';

// ── Configuration ───────────────────────────────────────────────────

const CONFIG: SearchConfig = {
  maxDepth: 5,
  alphaBetaPruning: true,
  timeLimitMs: 3_000,
  evaluationWeights: {
    gasCost: 0.10,
    slippageImpact: 0.30,
    mevExposure: 0.35,
    profitPotential: 0.25,
  },
  maxTranspositionEntries: 50_000,
};

// ── Mock On-Chain State ─────────────────────────────────────────────

function buildScenario(): { state: OnChainState; actions: ExecutionAction[] } {
  // Two pools with different depth and fee structures
  const poolDeep: PoolState = {
    address: 'DeepPool111111111111111111111111111111111111',
    tokenMintA: 'SOL1111111111111111111111111111111111111111',
    tokenMintB: 'USDC111111111111111111111111111111111111111',
    reserveA: 5_000_000_000_000n,  // 5,000 SOL
    reserveB: 750_000_000_000n,    // 750,000 USDC
    feeBps: 25,
  };

  const poolShallow: PoolState = {
    address: 'ShallowPool1111111111111111111111111111111111',
    tokenMintA: 'SOL1111111111111111111111111111111111111111',
    tokenMintB: 'USDC111111111111111111111111111111111111111',
    reserveA: 200_000_000_000n,    // 200 SOL
    reserveB: 30_000_000_000n,     // 30,000 USDC
    feeBps: 100,
  };

  const poolStates = new Map<string, PoolState>();
  poolStates.set(poolDeep.address, poolDeep);
  poolStates.set(poolShallow.address, poolShallow);

  const tokenBalances = new Map<string, bigint>();
  tokenBalances.set('SOL1111111111111111111111111111111111111111', 100_000_000_000n); // 100 SOL
  tokenBalances.set('USDC111111111111111111111111111111111111111', 10_000_000_000n);  // 10,000 USDC

  const state: OnChainState = {
    tokenBalances,
    poolStates,
    pendingTransactions: [],
    slot: 280_000_000,
    timestamp: Date.now(),
  };

  // Define candidate swap actions at different sizes
  const actions: ExecutionAction[] = [
    {
      kind: 'swap',
      tokenMintIn: 'SOL1111111111111111111111111111111111111111',
      tokenMintOut: 'USDC111111111111111111111111111111111111111',
      amount: 1_000_000_000n,  // 1 SOL
      slippageBps: 50,
      pool: poolDeep.address,
      priority: 2,
      label: '1 SOL -> USDC (deep pool)',
    },
    {
      kind: 'swap',
      tokenMintIn: 'SOL1111111111111111111111111111111111111111',
      tokenMintOut: 'USDC111111111111111111111111111111111111111',
      amount: 10_000_000_000n, // 10 SOL
      slippageBps: 100,
      pool: poolDeep.address,
      priority: 1,
      label: '10 SOL -> USDC (deep pool)',
    },
    {
      kind: 'swap',
      tokenMintIn: 'SOL1111111111111111111111111111111111111111',
      tokenMintOut: 'USDC111111111111111111111111111111111111111',
      amount: 1_000_000_000n,  // 1 SOL
      slippageBps: 50,
      pool: poolShallow.address,
      priority: 1,
      label: '1 SOL -> USDC (shallow pool)',
    },
    {
      kind: 'swap',
      tokenMintIn: 'SOL1111111111111111111111111111111111111111',
      tokenMintOut: 'USDC111111111111111111111111111111111111111',
      amount: 50_000_000_000n, // 50 SOL
      slippageBps: 200,
      pool: poolDeep.address,
      priority: 0,
      label: '50 SOL -> USDC (deep pool, high slip)',
    },
  ];

  return { state, actions };
}

// ── Main ────────────────────────────────────────────────────────────

function main(): void {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║            MNMX Swap Optimization Example           ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log();

  const { state, actions } = buildScenario();

  // ── Naive approach: just pick the first action ──
  console.log('─── Naive Execution (first available action) ───');
  const naiveAction = actions[0]!;
  const evaluator = new PositionEvaluator(CONFIG);
  const naiveEval = evaluator.evaluate(state, naiveAction);
  console.log(`  Action:     ${naiveAction.label}`);
  console.log(`  Score:      ${naiveEval.score.toFixed(4)}`);
  console.log(`  Confidence: ${(naiveEval.confidence * 100).toFixed(1)}%`);
  console.log(`  Breakdown:`);
  console.log(`    Gas cost:     ${naiveEval.breakdown.gasCost.toFixed(4)}`);
  console.log(`    Slippage:     ${naiveEval.breakdown.slippageImpact.toFixed(4)}`);
  console.log(`    MEV exposure: ${naiveEval.breakdown.mevExposure.toFixed(4)}`);
  console.log(`    Profit:       ${naiveEval.breakdown.profitPotential.toFixed(4)}`);
  console.log();

  // ── Engine-optimised approach ──
  console.log('─── MNMX Optimised Execution ───');
  const engine = new MinimaxEngine(CONFIG);
  const plan = engine.search(state, actions);

  const bestAction = plan.actions[0]!;
  console.log(`  Best action: ${bestAction.label}`);
  console.log(`  Total score: ${plan.totalScore.toFixed(4)}`);
  console.log(`  Confidence:  ${(plan.expectedOutcome.confidence * 100).toFixed(1)}%`);
  console.log(`  Breakdown:`);
  console.log(`    Gas cost:     ${plan.expectedOutcome.breakdown.gasCost.toFixed(4)}`);
  console.log(`    Slippage:     ${plan.expectedOutcome.breakdown.slippageImpact.toFixed(4)}`);
  console.log(`    MEV exposure: ${plan.expectedOutcome.breakdown.mevExposure.toFixed(4)}`);
  console.log(`    Profit:       ${plan.expectedOutcome.breakdown.profitPotential.toFixed(4)}`);
  console.log();

  // ── Search statistics ──
  console.log('─── Search Statistics ───');
  console.log(`  Nodes explored:    ${plan.stats.nodesExplored}`);
  console.log(`  Nodes pruned:      ${plan.stats.nodesPruned}`);
  console.log(`  Max depth reached: ${plan.stats.maxDepthReached}`);
  console.log(`  Time:              ${plan.stats.timeMs.toFixed(1)} ms`);
  console.log(`  TT hits:           ${plan.stats.transpositionHits}`);
  console.log();

  // ── Comparison ──
  const improvement = ((plan.expectedOutcome.score - naiveEval.score) / Math.max(naiveEval.score, 0.001)) * 100;
  console.log('─── Comparison ───');
  console.log(`  Naive score:     ${naiveEval.score.toFixed(4)}`);
  console.log(`  Optimised score: ${plan.expectedOutcome.score.toFixed(4)}`);
  console.log(`  Improvement:     ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%`);
  console.log();

  // ── AMM calculation details ──
  console.log('─── AMM Details for Best Action ───');
  const pool = state.poolStates.get(bestAction.pool)!;
  const [reserveIn, reserveOut] = bestAction.tokenMintIn === pool.tokenMintA
    ? [pool.reserveA, pool.reserveB]
    : [pool.reserveB, pool.reserveA];
  const output = constantProductSwap(bestAction.amount, reserveIn, reserveOut, pool.feeBps);
  const slippageBps = calculateSlippage(bestAction.amount, reserveIn, reserveOut, pool.feeBps);

  console.log(`  Input:    ${bestAction.amount} (raw units)`);
  console.log(`  Output:   ${output} (raw units)`);
  console.log(`  Slippage: ${Number(slippageBps)} bps`);
  console.log(`  Pool fee: ${pool.feeBps} bps`);
}

main();
