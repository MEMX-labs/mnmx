// ─────────────────────────────────────────────────────────────
// Cross-bridge Fee Normalization
// Standardizes fee representation across different bridge APIs
// ─────────────────────────────────────────────────────────────

export interface RawBridgeFee {
  /** Gas cost in native token */
  gasCostNative?: number;
  /** Gas cost in USD */
  gasCostUSD?: number;
  /** Bridge protocol fee in USD */
  protocolFeeUSD?: number;
  /** Relayer fee in USD */
  relayerFeeUSD?: number;
  /** LP fee as percentage */
  lpFeePercent?: number;
  /** Input amount for percentage-based fees */
  inputAmountUSD?: number;
}

export interface NormalizedFee {
  /** Total fee in USD */
  totalUSD: number;
  /** Fee breakdown */
  gas: number;
  protocol: number;
  relayer: number;
  lp: number;
  /** Fee as percentage of input */
  feePercent: number;
}

/**
 * Normalize fees from different bridge API formats into a standard structure.
 */
export function normalizeBridgeFee(raw: RawBridgeFee): NormalizedFee {
  const gas = raw.gasCostUSD || 0;
  const protocol = raw.protocolFeeUSD || 0;
  const relayer = raw.relayerFeeUSD || 0;
  const lp = raw.lpFeePercent && raw.inputAmountUSD
    ? (raw.lpFeePercent / 100) * raw.inputAmountUSD
    : 0;

  const totalUSD = gas + protocol + relayer + lp;
  const feePercent = raw.inputAmountUSD && raw.inputAmountUSD > 0
    ? (totalUSD / raw.inputAmountUSD) * 100
    : 0;

  return { totalUSD, gas, protocol, relayer, lp, feePercent };
}

/**
 * Compare two fee structures. Returns the cheaper one.
 */
export function cheaperFee(a: NormalizedFee, b: NormalizedFee): NormalizedFee {
  return a.totalUSD <= b.totalUSD ? a : b;
}
