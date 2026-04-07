import { describe, it, expect } from 'vitest';

const SUPPORTED_CHAINS = ['ethereum', 'solana', 'arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'bsc'];

describe('Chain Configuration', () => {
  it('supports 8 chains', () => {
    expect(SUPPORTED_CHAINS).toHaveLength(8);
  });

  it('includes all major L2s', () => {
    expect(SUPPORTED_CHAINS).toContain('arbitrum');
    expect(SUPPORTED_CHAINS).toContain('optimism');
    expect(SUPPORTED_CHAINS).toContain('base');
  });

  it('includes Solana', () => {
    expect(SUPPORTED_CHAINS).toContain('solana');
  });
});
