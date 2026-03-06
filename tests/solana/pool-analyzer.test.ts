/**
 * Tests for PoolAnalyzer
 *
 * Validates liquidity depth calculation, price impact estimation,
 * and arbitrage route discovery using constant-product AMM math.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { PoolAnalyzer } from '../../src/solana/pool-analyzer.js';
import type { PoolAnalysis } from '../../src/solana/pool-analyzer.js';

// ── Test Helpers ─────────────────────────────────────────────────────

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function randomPubkey(): PublicKey {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return new PublicKey(bytes);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PoolAnalyzer', () => {
  let analyzer: PoolAnalyzer;

  beforeEach(() => {
    analyzer = new PoolAnalyzer();
  });

  describe('analyzePool', () => {
    it('should compute correct spot price from reserves', () => {
      const address = randomPubkey();
      const analysis = analyzer.analyzePool(
        address,
        SOL_MINT,
        USDC_MINT,
        1_000_000_000n, // 1000 SOL (in lamports with 6 digits for simplicity)
        150_000_000_000n, // 150,000 USDC
        30,
      );

      // spot price = reserveB / reserveA = 150,000 / 1,000 = 150
      expect(analysis.spotPrice).toBeCloseTo(150, 1);
      expect(analysis.inversePrice).toBeCloseTo(1 / 150, 6);
    });

    it('should compute total value locked', () => {
      const address = randomPubkey();
      const reserveA = 500_000n;
      const reserveB = 1_000_000n;

      const analysis = analyzer.analyzePool(
        address, SOL_MINT, USDC_MINT, reserveA, reserveB, 25,
      );

      expect(analysis.totalValueLocked).toBe(reserveA + reserveB);
    });

    it('should throw on zero reserves', () => {
      const address = randomPubkey();
      expect(() =>
        analyzer.analyzePool(address, SOL_MINT, USDC_MINT, 0n, 1000n, 30),
      ).toThrow('Reserves must be positive');
    });

    it('should throw on negative reserves', () => {
      const address = randomPubkey();
      expect(() =>
        analyzer.analyzePool(address, SOL_MINT, USDC_MINT, -1n, 1000n, 30),
      ).toThrow('Reserves must be positive');
    });
  });

  describe('calculateDepth', () => {
    it('should return higher depth for larger reserves', () => {
      const smallPool = analyzer.calculateDepth([1_000_000n, 1_000_000n], 30);
      const largePool = analyzer.calculateDepth([1_000_000_000n, 1_000_000_000n], 30);

      expect(largePool.depthA1Pct).toBeGreaterThan(smallPool.depthA1Pct);
      expect(largePool.depthB1Pct).toBeGreaterThan(smallPool.depthB1Pct);
    });

    it('should return higher depth at 5% impact than 1% impact', () => {
      const depth = analyzer.calculateDepth([1_000_000_000n, 1_000_000_000n], 30);

      expect(depth.depthA5Pct).toBeGreaterThan(depth.depthA1Pct);
      expect(depth.depthB5Pct).toBeGreaterThan(depth.depthB1Pct);
    });

    it('should compute correct invariant', () => {
      const reserveA = 500_000n;
      const reserveB = 2_000_000n;
      const depth = analyzer.calculateDepth([reserveA, reserveB], 30);

      expect(depth.invariant).toBe(reserveA * reserveB);
    });

    it('should account for fees in depth calculation', () => {
      // Higher fees mean you need more input to achieve the same impact
      const lowFeeDepth = analyzer.calculateDepth([1_000_000n, 1_000_000n], 10);
      const highFeeDepth = analyzer.calculateDepth([1_000_000n, 1_000_000n], 100);

      // With higher fees, the "depth" (amount needed to move price by 1%)
      // should be larger because the fee eats into effective input
      expect(highFeeDepth.depthA1Pct).toBeGreaterThan(lowFeeDepth.depthA1Pct);
    });

    it('should produce positive depth values', () => {
      const depth = analyzer.calculateDepth([1_000_000n, 1_000_000n], 30);

      expect(depth.depthA1Pct).toBeGreaterThan(0n);
      expect(depth.depthB1Pct).toBeGreaterThan(0n);
      expect(depth.depthA5Pct).toBeGreaterThan(0n);
      expect(depth.depthB5Pct).toBeGreaterThan(0n);
    });
  });

  describe('estimateImpact', () => {
    let pool: PoolAnalysis;

    beforeEach(() => {
      pool = analyzer.analyzePool(
        randomPubkey(),
        SOL_MINT,
        USDC_MINT,
        1_000_000_000n,
        1_000_000_000n,
        30, // 0.3% fee
      );
    });

    it('should return zero impact for zero input', () => {
      const impact = analyzer.estimateImpact(0n, pool);
