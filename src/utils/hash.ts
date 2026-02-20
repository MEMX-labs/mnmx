// ─────────────────────────────────────────────────────────────
// MNMX Hashing Utilities
// ─────────────────────────────────────────────────────────────

import type { Route, RouteHop } from '../types/index.js';

/**
 * Simple deterministic hash function (djb2 variant).
 * Not cryptographic — used only for route identification.
 */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) + hash + char) & 0xffffffff;
  }
  // Convert to unsigned 32-bit hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generate a deterministic hash for a route hop.
 */
export function hashHop(hop: RouteHop): string {
  const parts = [
    hop.fromChain,
    hop.toChain,
    hop.fromToken.address,
    hop.toToken.address,
    hop.bridge,
    hop.inputAmount,
    hop.outputAmount,
  ];
  return djb2(parts.join(':'));
}

/**
 * Generate a deterministic hash for an entire route.
 */
export function hashRoute(route: Route): string {
  const hopHashes = route.path.map(hashHop);
  const composite = [
    ...hopHashes,
    route.expectedOutput,
    route.strategy,
    route.computedAt.toString(),
  ].join('|');
  return djb2(composite);
}

/**
 * Generate a unique request ID using timestamp + random component.
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `mnmx-${timestamp}-${randomPart}`;
}

/**
 * Generate a unique route ID from path characteristics.
 */
export function generateRouteId(chains: string[], bridges: string[]): string {
  const pathKey = chains.join('>');
  const bridgeKey = bridges.join('+');
  const hash = djb2(`${pathKey}|${bridgeKey}|${Date.now()}`);
  return `route-${hash}`;
}
