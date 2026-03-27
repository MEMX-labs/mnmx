import { describe, it, expect } from 'vitest';
import { CHAIN_GAS_MULTIPLIERS } from '../../src/constants.js';

describe('Gas Multipliers', () => {
  it('has multipliers for all supported chains', () => {
    const chains = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bsc', 'avalanche', 'solana'];
    for (const chain of chains) {
      expect(CHAIN_GAS_MULTIPLIERS[chain]).toBeDefined();
      expect(CHAIN_GAS_MULTIPLIERS[chain]).toBeGreaterThan(0);
    }
  });

  it('L2s have lower multipliers than L1', () => {
    expect(CHAIN_GAS_MULTIPLIERS['arbitrum']).toBeLessThan(CHAIN_GAS_MULTIPLIERS['ethereum']);
    expect(CHAIN_GAS_MULTIPLIERS['base']).toBeLessThan(CHAIN_GAS_MULTIPLIERS['ethereum']);
  });
});
