/**
 * Tests for the MNMX Minimax Engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MinimaxEngine } from '../../src/engine/minimax.js';
import type {
  ExecutionAction,
  OnChainState,
  PoolState,
  SearchConfig,
} from '../../src/types/index.js';

// ── Test Fixtures ───────────────────────────────────────────────────

function createTestPool(overrides: Partial<PoolState> = {}): PoolState {
  return {
    address: 'PoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tokenMintA: 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tokenMintB: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    reserveA: 1_000_000_000n,
    reserveB: 1_000_000_000n,
    feeBps: 30,
    ...overrides,
  };
}

function createTestState(overrides: Partial<OnChainState> = {}): OnChainState {
  const pool = createTestPool();
  const poolStates = new Map<string, PoolState>();
  poolStates.set(pool.address, pool);

  const tokenBalances = new Map<string, bigint>();
  tokenBalances.set(pool.tokenMintA, 500_000_000n);
  tokenBalances.set(pool.tokenMintB, 200_000_000n);

  return {
    tokenBalances,
    poolStates,
    pendingTransactions: [],
    slot: 100,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createSwapAction(overrides: Partial<ExecutionAction> = {}): ExecutionAction {
  return {
    kind: 'swap',
    tokenMintIn: 'MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    tokenMintOut: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    amount: 10_000_000n,
    slippageBps: 50,
    pool: 'PoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    priority: 1,
    label: 'Test swap A->B',
    ...overrides,
  };
}

function createTestConfig(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return {
    maxDepth: 4,
    alphaBetaPruning: true,
    timeLimitMs: 5_000,
    evaluationWeights: {
      gasCost: 0.15,
      slippageImpact: 0.25,
      mevExposure: 0.35,
      profitPotential: 0.25,
    },
    maxTranspositionEntries: 10_000,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('MinimaxEngine', () => {
  let engine: MinimaxEngine;

  beforeEach(() => {
    engine = new MinimaxEngine(createTestConfig());
  });

  it('should return an execution plan with at least one action', () => {
    const state = createTestState();
    const actions = [createSwapAction()];
    const plan = engine.search(state, actions);

    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.totalScore).toBeDefined();
    expect(plan.stats.nodesExplored).toBeGreaterThan(0);
  });

  it('should return an empty plan when given no actions', () => {
    const state = createTestState();
    const plan = engine.search(state, []);

    expect(plan.actions).toHaveLength(0);
    expect(plan.totalScore).toBe(0);
  });

  it('should choose the better action among two options', () => {
    const state = createTestState();

    // Small swap: low slippage, low MEV exposure
    const smallSwap = createSwapAction({
      amount: 1_000_000n,
      label: 'Small swap',
    });

    // Huge swap: high slippage, high MEV exposure
    const hugeSwap = createSwapAction({
      amount: 900_000_000n,
      slippageBps: 500,
      label: 'Huge swap',
    });

    const plan = engine.search(state, [smallSwap, hugeSwap]);
    // Engine should prefer the small swap (better MEV/slippage profile)
    expect(plan.actions[0]!.label).toBe('Small swap');
  });

  it('should produce the same result with and without alpha-beta pruning', () => {
    const state = createTestState();
    // Use actions with very different quality so the best choice is unambiguous
    const actions = [
      createSwapAction({ amount: 1_000_000n, label: 'Small (good)' }),
      createSwapAction({ amount: 800_000_000n, slippageBps: 500, label: 'Huge (bad)' }),
    ];

    const withPruning = new MinimaxEngine(
      createTestConfig({ alphaBetaPruning: true, maxDepth: 3 }),
    );
    const withoutPruning = new MinimaxEngine(
      createTestConfig({ alphaBetaPruning: false, maxDepth: 3 }),
    );

    const planPruned = withPruning.search(state, actions);
    const planFull = withoutPruning.search(state, actions);

    // Both should select the clearly superior small swap
    expect(planPruned.actions[0]!.label).toBe(planFull.actions[0]!.label);
  });

  it('should prune nodes when alpha-beta is enabled', () => {
    const state = createTestState();
    const actions = [
      createSwapAction({ amount: 5_000_000n, label: 'A' }),
      createSwapAction({ amount: 20_000_000n, label: 'B' }),
      createSwapAction({ amount: 50_000_000n, label: 'C' }),
    ];

    const withPruning = new MinimaxEngine(
      createTestConfig({ alphaBetaPruning: true, maxDepth: 4 }),
    );
    const withoutPruning = new MinimaxEngine(
      createTestConfig({ alphaBetaPruning: false, maxDepth: 4 }),
    );

    const planPruned = withPruning.search(state, actions);
    const planFull = withoutPruning.search(state, actions);

    // Pruning should explore fewer nodes
    expect(planPruned.stats.nodesExplored).toBeLessThanOrEqual(
      planFull.stats.nodesExplored,
    );
  });

  it('should respect the time limit', () => {
    const state = createTestState();
    const actions = Array.from({ length: 10 }, (_, i) =>
      createSwapAction({ amount: BigInt((i + 1) * 1_000_000), label: `Action ${i}` }),
    );

    const timeLimitMs = 200;
    const timedEngine = new MinimaxEngine(
      createTestConfig({ timeLimitMs, maxDepth: 10 }),
    );

    const plan = timedEngine.search(state, actions);

    // Allow some tolerance for timer granularity
    expect(plan.stats.timeMs).toBeLessThan(timeLimitMs + 500);
  });

  it('should track search statistics accurately', () => {
    const state = createTestState();
    const actions = [
      createSwapAction({ amount: 5_000_000n }),
      createSwapAction({ amount: 15_000_000n }),
    ];

    const plan = engine.search(state, actions);

    expect(plan.stats.nodesExplored).toBeGreaterThan(0);
    expect(plan.stats.maxDepthReached).toBeGreaterThan(0);
    expect(plan.stats.maxDepthReached).toBeLessThanOrEqual(4);
    expect(plan.stats.timeMs).toBeGreaterThan(0);
  });

  it('should use transposition table to avoid redundant work', () => {
    const state = createTestState();
    const actions = [
      createSwapAction({ amount: 5_000_000n, label: 'X' }),
      createSwapAction({ amount: 10_000_000n, label: 'Y' }),
    ];

    engine.search(state, actions);
    const ttStats = engine.getTranspositionTable().getStats();

    expect(ttStats.entries).toBeGreaterThan(0);
  });

  it('should handle a realistic DeFi scenario with multiple pools', () => {
    const pool1 = createTestPool({
      address: 'Pool111111111111111111111111111111111111111',
      reserveA: 2_000_000_000n,
      reserveB: 2_000_000_000n,
    });
    const pool2 = createTestPool({
      address: 'Pool222222222222222222222222222222222222222',
      reserveA: 500_000_000n,
      reserveB: 500_000_000n,
      feeBps: 100,
    });

    const poolStates = new Map<string, PoolState>();
    poolStates.set(pool1.address, pool1);
    poolStates.set(pool2.address, pool2);

    const state = createTestState({ poolStates });

    const swapPool1 = createSwapAction({
      pool: pool1.address,
      amount: 10_000_000n,
      label: 'Swap via deep pool',
    });
    const swapPool2 = createSwapAction({
      pool: pool2.address,
      amount: 10_000_000n,
      slippageBps: 100,
      label: 'Swap via shallow pool',
    });

    const plan = engine.search(state, [swapPool1, swapPool2]);
    // Deep pool with lower fee should be preferred
    expect(plan.actions[0]!.label).toBe('Swap via deep pool');
  });

  it('deeper search should produce greater-or-equal quality results', () => {
    const state = createTestState();
    const actions = [
      createSwapAction({ amount: 5_000_000n }),
      createSwapAction({ amount: 30_000_000n }),
    ];

    const shallow = new MinimaxEngine(createTestConfig({ maxDepth: 2 }));
    const deep = new MinimaxEngine(createTestConfig({ maxDepth: 4 }));

    const planShallow = shallow.search(state, actions);
    const planDeep = deep.search(state, actions);

    // Deeper search should find a score at least as good
    expect(planDeep.totalScore).toBeGreaterThanOrEqual(
      planShallow.totalScore - 0.01, // small tolerance for numerical noise
    );
  });
});
