// ─────────────────────────────────────────────────────────────
// Allbridge Core Bridge Adapter
// ─────────────────────────────────────────────────────────────

import type {
  Chain,
  BridgeQuote,
  BridgeHealth,
  BridgeStatus,
  QuoteParams,
  Signer,
} from '../types/index.js';
import { AbstractBridgeAdapter } from './adapter.js';

type AllbridgeMessenger = 'allbridge' | 'wormhole' | 'cctp';

interface PoolConfig {
  precision: number;
  lpFeeShareBps: number;
  estimatedPoolSizeUsd: number;
  utilization: number;
}

const ALLBRIDGE_POOLS: Partial<Record<Chain, PoolConfig>> = {
  ethereum: {
    precision: 6,
    lpFeeShareBps: 5,
    estimatedPoolSizeUsd: 5000000,
    utilization: 0.35,
  },
  solana: {
    precision: 6,
    lpFeeShareBps: 5,
    estimatedPoolSizeUsd: 3000000,
    utilization: 0.25,
  },
  polygon: {
    precision: 6,
    lpFeeShareBps: 4,
    estimatedPoolSizeUsd: 2000000,
    utilization: 0.30,
  },
  bnb: {
    precision: 18,
    lpFeeShareBps: 5,
    estimatedPoolSizeUsd: 2500000,
    utilization: 0.28,
  },
  avalanche: {
    precision: 6,
    lpFeeShareBps: 4,
    estimatedPoolSizeUsd: 1500000,
    utilization: 0.22,
  },
};

/**
 * Allbridge Core adapter.
 * Uses a liquidity pool model with constant-product-like pricing.
 * Supports multiple messengers for cross-chain verification.
 */
export class AllbridgeAdapter extends AbstractBridgeAdapter {
  readonly name = 'allbridge';
  readonly supportedChains: Chain[] = [
    'ethereum', 'solana', 'polygon', 'bnb', 'avalanche',
  ];

  private systemPrecision = 3;
  private protocolFeeBps = 10;

  private getPool(chain: Chain): PoolConfig {
    const pool = ALLBRIDGE_POOLS[chain];
    if (!pool) throw new Error('Allbridge has no pool on ' + chain);
    return pool;
  }

  /**
   * Calculate the swap output using Allbridge virtual price model.
   * Uses a modified constant-product formula for pool swaps.
   *
   * sourceBalance * destBalance = k
   * (sourceBalance + input) * (destBalance - output) = k
   */
  private calculateSwapOutput(
