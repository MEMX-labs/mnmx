/**
 * Tests for the MNMX Position Evaluator
 */

import { describe, it, expect } from 'vitest';
import { PositionEvaluator } from '../../src/engine/evaluator.js';
import type {
  ExecutionAction,
  OnChainState,
  PoolState,
  SearchConfig,
} from '../../src/types/index.js';
import { DEFAULT_SEARCH_CONFIG } from '../../src/types/index.js';

// ── Fixtures ────────────────────────────────────────────────────────

function makePool(overrides: Partial<PoolState> = {}): PoolState {
  return {
    address: 'Pool111111111111111111111111111111111111111',
    tokenMintA: 'MintA11111111111111111111111111111111111111',
    tokenMintB: 'MintB11111111111111111111111111111111111111',
    reserveA: 1_000_000_000n,
    reserveB: 1_000_000_000n,
    feeBps: 30,
    ...overrides,
  };
}

function makeState(pool: PoolState): OnChainState {
  const poolStates = new Map<string, PoolState>();
  poolStates.set(pool.address, pool);

  const tokenBalances = new Map<string, bigint>();
  tokenBalances.set(pool.tokenMintA, 500_000_000n);
  tokenBalances.set(pool.tokenMintB, 500_000_000n);

  return {
    tokenBalances,
    poolStates,
    pendingTransactions: [],
    slot: 200,
    timestamp: Date.now(),
  };
}

function makeSwap(pool: PoolState, amount: bigint, slippageBps = 50): ExecutionAction {
  return {
    kind: 'swap',
    tokenMintIn: pool.tokenMintA,
    tokenMintOut: pool.tokenMintB,
    amount,
    slippageBps,
    pool: pool.address,
    priority: 1,
    label: 'test swap',
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PositionEvaluator', () => {
  const evaluator = new PositionEvaluator(DEFAULT_SEARCH_CONFIG);

  it('should return a score between 0 and 1', () => {
    const pool = makePool();
    const state = makeState(pool);
    const action = makeSwap(pool, 10_000_000n);

    const result = evaluator.evaluate(state, action);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('should give lower slippage score for larger trades', () => {
    const pool = makePool();
    const state = makeState(pool);

    const small = evaluator.evaluate(state, makeSwap(pool, 1_000_000n));
    const large = evaluator.evaluate(state, makeSwap(pool, 500_000_000n));

    expect(small.breakdown.slippageImpact).toBeGreaterThan(
      large.breakdown.slippageImpact,
    );
  });

  it('should give higher MEV exposure for shallow pools', () => {
    const deepPool = makePool({ reserveA: 10_000_000_000n, reserveB: 10_000_000_000n });
    const shallowPool = makePool({
      address: 'Pool222222222222222222222222222222222222222',
      reserveA: 100_000_000n,
      reserveB: 100_000_000n,
    });

    const deepState = makeState(deepPool);
    const shallowState = makeState(shallowPool);

    const amount = 50_000_000n;
