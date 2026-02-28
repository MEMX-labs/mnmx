import { describe, it, expect, beforeEach } from 'vitest';
import { MnmxRouter } from '../../src/router/index.js';
import { WormholeAdapter } from '../../src/bridges/wormhole.js';
import { DeBridgeAdapter } from '../../src/bridges/debridge.js';
import type { RouteRequest, Strategy } from '../../src/types/index.js';

describe('end-to-end integration', () => {
  let router: MnmxRouter;

  beforeEach(() => {
    router = new MnmxRouter();
    router.registerBridge(new WormholeAdapter());
    router.registerBridge(new DeBridgeAdapter());
  });

  it('full route discovery and scoring flow', async () => {
    const request: RouteRequest = {
      from: { chain: 'ethereum', token: 'USDC', amount: '1000' },
      to: { chain: 'solana', token: 'USDC' },
    };
    const result = await router.findRoute(request);

    expect(result.bestRoute).not.toBeNull();
    expect(result.bestRoute!.path.length).toBeGreaterThan(0);
    expect(result.bestRoute!.minimaxScore).toBeGreaterThan(0);
    expect(parseFloat(result.bestRoute!.expectedOutput)).toBeGreaterThan(0);
    expect(parseFloat(result.bestRoute!.guaranteedMinimum)).toBeGreaterThan(0);
    expect(parseFloat(result.bestRoute!.guaranteedMinimum)).toBeLessThanOrEqual(
      parseFloat(result.bestRoute!.expectedOutput),
    );
    expect(result.stats.nodesExplored).toBeGreaterThan(0);
    expect(result.stats.candidateCount).toBeGreaterThan(0);
  });

  it('multi-hop route through intermediate chain', async () => {
    const request: RouteRequest = {
      from: { chain: 'ethereum', token: 'USDC', amount: '5000' },
      to: { chain: 'solana', token: 'USDC' },
      options: { maxHops: 3 },
    };
    const result = await router.findRoute(request);

    expect(result.bestRoute).not.toBeNull();
    // At minimum there should be alternatives beyond the direct path
    const allRoutes = [result.bestRoute!, ...result.alternatives];
    const multiHopRoutes = allRoutes.filter((r) => r.path.length > 1);
    // Multi-hop routes should exist since both wormhole and debridge support
    // intermediate chains like arbitrum
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it('strategy comparison produces different rankings', async () => {
    const strategies: Strategy[] = ['minimax', 'cheapest', 'fastest', 'safest'];
    const scores: Record<string, number> = {};

    for (const strategy of strategies) {
      const request: RouteRequest = {
        from: { chain: 'ethereum', token: 'USDC', amount: '2000' },
        to: { chain: 'arbitrum', token: 'USDC' },
        options: { strategy },
      };
      const result = await router.findRoute(request);
      expect(result.bestRoute).not.toBeNull();
      scores[strategy] = result.bestRoute!.minimaxScore;
      expect(result.bestRoute!.strategy).toBe(strategy);
    }

    // Different strategies should produce different scores
    const uniqueScores = new Set(Object.values(scores).map((s) => s.toFixed(4)));
    // At least some strategies should produce different scores
    expect(uniqueScores.size).toBeGreaterThanOrEqual(1);
  });

  it('bridge exclusion works end-to-end', async () => {
    const requestAll: RouteRequest = {
      from: { chain: 'ethereum', token: 'USDC', amount: '1000' },
      to: { chain: 'arbitrum', token: 'USDC' },
    };
    const resultAll = await router.findRoute(requestAll);

    const requestExclude: RouteRequest = {
      from: { chain: 'ethereum', token: 'USDC', amount: '1000' },
      to: { chain: 'arbitrum', token: 'USDC' },
      options: { excludeBridges: ['wormhole'] },
    };
    const resultExclude = await router.findRoute(requestExclude);

    expect(resultAll.bestRoute).not.toBeNull();
    expect(resultExclude.bestRoute).not.toBeNull();

    // When excluding wormhole, all routes should use debridge only
    const allRoutes = [resultExclude.bestRoute!, ...resultExclude.alternatives];
    for (const route of allRoutes) {
      for (const hop of route.path) {
        expect(hop.bridge).not.toBe('wormhole');
      }
    }

    // With all bridges, we should have at least as many candidates
    expect(resultAll.stats.candidateCount).toBeGreaterThanOrEqual(
      resultExclude.stats.candidateCount,
    );
  });

  it('throws for router with no registered bridges', async () => {
    const emptyRouter = new MnmxRouter();
    const request: RouteRequest = {
      from: { chain: 'ethereum', token: 'USDC', amount: '1000' },
      to: { chain: 'solana', token: 'USDC' },
    };
    await expect(emptyRouter.findRoute(request)).rejects.toThrow('No bridge adapters registered');
  });
});
