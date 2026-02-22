// ─────────────────────────────────────────────────────────────
// Path Discovery
// Finds candidate paths between source and destination chains
// ─────────────────────────────────────────────────────────────

import type { Chain, CandidatePath, Token, BridgeQuote } from '../types/index.js';
import { ALL_CHAINS } from '../types/index.js';
import type { BridgeAdapter } from '../bridges/adapter.js';
import { BridgeRegistry } from '../bridges/adapter.js';
import { findToken } from '../chains/index.js';

export interface PathDiscoveryOptions {
  maxHops: number;
  excludeBridges: string[];
  excludeChains: Chain[];
  minLiquidity: number;
}

/**
 * Chain connectivity map.
 * Defines which chains have strong bridge connectivity to each other.
 * This is used for heuristic path ordering, not hard filtering.
 */
export const CHAIN_CONNECTIVITY: Record<Chain, Chain[]> = {
  ethereum: ['arbitrum', 'optimism', 'base', 'polygon', 'bnb', 'avalanche', 'solana'],
  solana: ['ethereum', 'polygon', 'bnb', 'avalanche'],
  arbitrum: ['ethereum', 'optimism', 'base', 'polygon'],
  base: ['ethereum', 'arbitrum', 'optimism', 'polygon'],
  polygon: ['ethereum', 'arbitrum', 'bnb', 'avalanche', 'solana'],
  bnb: ['ethereum', 'polygon', 'avalanche', 'solana'],
  optimism: ['ethereum', 'arbitrum', 'base', 'polygon'],
  avalanche: ['ethereum', 'polygon', 'bnb'],
};

/**
 * Preferred intermediate tokens per chain.
 * These are the most liquid tokens available for bridging on each chain.
 */
export const INTERMEDIATE_TOKENS: Record<Chain, string[]> = {
  ethereum: ['USDC', 'USDT', 'WETH', 'DAI'],
  solana: ['USDC', 'USDT', 'SOL'],
  arbitrum: ['USDC', 'USDT', 'WETH'],
  base: ['USDC', 'WETH'],
  polygon: ['USDC', 'USDT', 'WETH'],
  bnb: ['USDC', 'USDT', 'BNB'],
  optimism: ['USDC', 'WETH', 'OP'],
  avalanche: ['USDC', 'USDT', 'AVAX'],
};

/**
 * Build an adjacency map of chain -> chain -> bridge adapters.
 */
function buildGraph(
  registry: BridgeRegistry,
  excludeBridges: string[],
): Map<Chain, Map<Chain, BridgeAdapter[]>> {
  const graph = new Map<Chain, Map<Chain, BridgeAdapter[]>>();
  for (const adapter of registry.getAll()) {
    if (excludeBridges.includes(adapter.name)) continue;
    const chains = adapter.supportedChains;
    for (const from of chains) {
      for (const to of chains) {
        if (from === to) continue;
        if (!adapter.supportsRoute(from, to)) continue;
        if (!graph.has(from)) graph.set(from, new Map());
        const inner = graph.get(from)!;
        if (!inner.has(to)) inner.set(to, []);
        inner.get(to)!.push(adapter);
      }
    }
  }
  return graph;
}

/**
 * Discover all viable chain-level paths from source to destination.
 * Returns arrays of chain sequences, e.g. [ethereum, arbitrum, solana].
 * Uses DFS with cycle detection and hop limits.
 */
export function discoverChainPaths(
  fromChain: Chain,
  toChain: Chain,
  registry: BridgeRegistry,
  options: PathDiscoveryOptions,
): Chain[][] {
  if (fromChain === toChain) return [];

  const graph = buildGraph(registry, options.excludeBridges);
  const results: Chain[][] = [];
  const visited = new Set<Chain>();

  function dfs(current: Chain, path: Chain[]): void {
