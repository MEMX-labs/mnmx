export interface BridgePriority {
  bridge: string;
  weight: number;
  enabled: boolean;
}

export const DEFAULT_BRIDGE_PRIORITIES: BridgePriority[] = [
  { bridge: 'wormhole', weight: 1.0, enabled: true },
  { bridge: 'debridge', weight: 1.0, enabled: true },
  { bridge: 'layerzero', weight: 0.9, enabled: true },
  { bridge: 'allbridge', weight: 0.8, enabled: true },
];

export function filterEnabledBridges(priorities: BridgePriority[]): string[] {
  return priorities.filter(p => p.enabled).map(p => p.bridge);
}

export function getBridgeWeight(bridge: string, priorities: BridgePriority[] = DEFAULT_BRIDGE_PRIORITIES): number {
  return priorities.find(p => p.bridge === bridge)?.weight ?? 0.5;
}
