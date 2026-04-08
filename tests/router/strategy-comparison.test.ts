import { describe, it, expect } from 'vitest';
import { STRATEGY_WEIGHTS } from '../../src/types/index.js';

describe('Strategy Comparison', () => {
  it('minimax weights fees+slippage highest', () => {
    const w = STRATEGY_WEIGHTS.minimax;
    expect(w.fees + w.slippage).toBeGreaterThan(0.4);
  });

  it('cheapest prioritizes fees', () => {
    const w = STRATEGY_WEIGHTS.cheapest;
    expect(w.fees).toBeGreaterThanOrEqual(0.4);
  });

  it('fastest prioritizes speed', () => {
    const w = STRATEGY_WEIGHTS.fastest;
    expect(w.speed).toBeGreaterThanOrEqual(0.4);
  });

  it('all strategies sum to 1.0', () => {
    for (const [, w] of Object.entries(STRATEGY_WEIGHTS)) {
      const sum = w.fees + w.slippage + w.speed + w.reliability + w.mevExposure;
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });
});
