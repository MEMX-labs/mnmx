/**
 * MNMX Mathematical Primitives
 *
 * Pure-function arithmetic for AMM swap computation, slippage estimation,
 * concentrated-liquidity math, and basis-point conversions.  All token
 * amounts use native BigInt to avoid precision loss.
 */

const BPS_DENOMINATOR = 10_000n;
const Q64 = 1n << 64n;

// ── Basis-Point Helpers ─────────────────────────────────────────────

/** Convert basis points (integer) to a decimal fraction. */
export function bpsToDecimal(bps: number): number {
  return bps / 10_000;
}

/** Convert a decimal fraction to basis points (rounded). */
export function decimalToBps(dec: number): number {
  return Math.round(dec * 10_000);
}

// ── Constant-Product AMM ────────────────────────────────────────────

/**
 * Compute the output amount for a constant-product (x * y = k) swap
 * after deducting the pool fee.
 *
 * Formula:  out = (reserveOut * amountInAfterFee) /
 *                 (reserveIn + amountInAfterFee)
 */
export function constantProductSwap(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

  const feeMultiplier = BPS_DENOMINATOR - BigInt(feeBps);
  const amountInAfterFee = (amountIn * feeMultiplier) / BPS_DENOMINATOR;
  const numerator = reserveOut * amountInAfterFee;
  const denominator = reserveIn + amountInAfterFee;
  return numerator / denominator;
}

/**
 * Calculate realised slippage in basis points for a given swap on a
 * constant-product pool.  Compares actual output to the idealised
 * "zero-impact" rate derived from reserves.
 */
export function calculateSlippage(
  amount: bigint,
  reserveA: bigint,
  reserveB: bigint,
  feeRate: number,
): bigint {
  if (amount <= 0n || reserveA <= 0n || reserveB <= 0n) return 0n;

  // Ideal output at the marginal price (no market impact)
  const idealOutput = (amount * reserveB) / reserveA;
  if (idealOutput === 0n) return 0n;

  const actualOutput = constantProductSwap(amount, reserveA, reserveB, feeRate);

  // Slippage in bps:  ((ideal - actual) * 10_000) / ideal
  if (actualOutput >= idealOutput) return 0n;
  return ((idealOutput - actualOutput) * BPS_DENOMINATOR) / idealOutput;
}

// ── Concentrated-Liquidity (CLMM) ──────────────────────────────────

/**
 * Approximate a swap through a single concentrated-liquidity tick range.
 *
 * Uses the relationship:
 *   delta_sqrtPrice = amountIn / liquidity          (token-0-in)
 *   amountOut       = liquidity * delta_sqrtPrice    (token-1-out)
 *
 * The sqrt-price values are encoded as Q64.64 fixed-point (sqrtPriceX64).
 */
export function concentratedLiquiditySwap(
  amountIn: bigint,
  liquidity: bigint,
  sqrtPriceCurrentX64: bigint,
  sqrtPriceTargetX64: bigint,
  feeBps: number,
  zeroForOne: boolean,
): { amountOut: bigint; sqrtPriceNextX64: bigint } {
  if (amountIn <= 0n || liquidity <= 0n) {
    return { amountOut: 0n, sqrtPriceNextX64: sqrtPriceCurrentX64 };
  }

  const feeMultiplier = BPS_DENOMINATOR - BigInt(feeBps);
  const amountInAfterFee = (amountIn * feeMultiplier) / BPS_DENOMINATOR;

  let sqrtPriceNextX64: bigint;
  let amountOut: bigint;

  if (zeroForOne) {
    // Selling token-0 for token-1 => sqrtPrice decreases
    const deltaSqrt = (amountInAfterFee * Q64) / liquidity;
    sqrtPriceNextX64 = sqrtPriceCurrentX64 - deltaSqrt;
    if (sqrtPriceNextX64 < sqrtPriceTargetX64) {
      sqrtPriceNextX64 = sqrtPriceTargetX64;
    }
    const priceDelta = sqrtPriceCurrentX64 - sqrtPriceNextX64;
    amountOut = (liquidity * priceDelta) / Q64;
  } else {
    // Selling token-1 for token-0 => sqrtPrice increases
    const deltaSqrt = (amountInAfterFee * Q64) / liquidity;
    sqrtPriceNextX64 = sqrtPriceCurrentX64 + deltaSqrt;
    if (sqrtPriceNextX64 > sqrtPriceTargetX64) {
      sqrtPriceNextX64 = sqrtPriceTargetX64;
    }
    const priceDelta = sqrtPriceNextX64 - sqrtPriceCurrentX64;
    amountOut = (liquidity * priceDelta) / Q64;
  }

  return { amountOut: amountOut > 0n ? amountOut : 0n, sqrtPriceNextX64 };
}

// ── Sqrt-Price Utilities ────────────────────────────────────────────

/**
 * Convert a human-readable price to its Q64.64 sqrt encoding.
 * price = (sqrtPriceX64 / 2^64)^2   =>   sqrtPriceX64 = sqrt(price) * 2^64
 */
export function priceToSqrtPriceX64(price: number): bigint {
  if (price <= 0) return 0n;
  const sqrtVal = Math.sqrt(price);
  // Multiply by 2^64 using floating point then truncate
  return BigInt(Math.floor(sqrtVal * Number(Q64)));
}

/**
 * Decode a Q64.64 sqrt-price back to a human-readable price.
 */
export function sqrtPriceX64ToPrice(sqrtPriceX64: bigint): number {
  const sqrtVal = Number(sqrtPriceX64) / Number(Q64);
  return sqrtVal * sqrtVal;
}

/**
 * Integer square root (Babylonian / Newton's method) for BigInt.
 * Returns floor(sqrt(n)).
 */
export function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('Square root of negative number');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// ── Price Impact ────────────────────────────────────────────────────

/**
 * Estimate the price impact of a trade as a fraction (0..1).
 * Uses the constant-product invariant: impact = amountIn / (reserveIn + amountIn).
 */
export function estimatePriceImpact(
  amountIn: bigint,
  reserveIn: bigint,
): number {
  if (amountIn <= 0n || reserveIn <= 0n) return 0;
  return Number(amountIn) / (Number(reserveIn) + Number(amountIn));
}

/**
 * Given a desired output amount, compute the required input on a
 * constant-product pool (inverse swap).
 *
 *   amountIn = (reserveIn * amountOut * BPS) /
 *              ((reserveOut - amountOut) * (BPS - fee))
 */
export function constantProductSwapInverse(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountOut <= 0n || amountOut >= reserveOut) return 0n;
  const feeMultiplier = BPS_DENOMINATOR - BigInt(feeBps);
  const numerator = reserveIn * amountOut * BPS_DENOMINATOR;
  const denominator = (reserveOut - amountOut) * feeMultiplier;
  return numerator / denominator + 1n; // +1 to round up
}
