"""
Pure math utilities for AMM calculations, price impact, and routing.

All amounts are in raw token units (lamports / smallest denomination).
Fees are expressed in basis points (1 bps = 0.01%).
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mnmx.types import PoolState


def bps_to_decimal(bps: int) -> float:
    """Convert basis points to a decimal fraction. 100 bps -> 0.01."""
    return bps / 10_000


def constant_product_output(
    amount_in: int,
    reserve_in: int,
    reserve_out: int,
    fee_bps: int = 30,
) -> int:
    """
    Calculate output amount for a constant-product (x*y=k) swap.

    Applies the fee to the input amount before computing the swap.
    Returns the integer amount of tokens received.
    """
    if amount_in <= 0:
        return 0
    if reserve_in <= 0 or reserve_out <= 0:
        return 0

    fee_factor = 10_000 - fee_bps
    amount_in_with_fee = amount_in * fee_factor
    numerator = amount_in_with_fee * reserve_out
    denominator = reserve_in * 10_000 + amount_in_with_fee
    if denominator == 0:
        return 0
    return numerator // denominator


def constant_product_input(
    amount_out: int,
    reserve_in: int,
    reserve_out: int,
    fee_bps: int = 30,
) -> int:
    """
    Calculate the input amount required to receive exactly `amount_out`.

    This is the inverse of constant_product_output.
    Returns the integer amount of tokens that must be provided.
    """
    if amount_out <= 0:
        return 0
    if reserve_in <= 0 or reserve_out <= 0:
        return 0
    if amount_out >= reserve_out:
        return 0  # cannot extract more than reserves

    fee_factor = 10_000 - fee_bps
    if fee_factor == 0:
        return 0
    numerator = reserve_in * amount_out * 10_000
    denominator = (reserve_out - amount_out) * fee_factor
    if denominator == 0:
        return 0
    # ceiling division to ensure we provide enough
    return numerator // denominator + 1


def calculate_price_impact(amount: int, reserve_a: int, reserve_b: int) -> float:
    """
    Calculate the price impact of a trade as a fraction (0.0 to 1.0).

    Price impact measures how much the effective price deviates from
    the spot price due to trade size relative to liquidity.
    """
    if amount <= 0 or reserve_a <= 0 or reserve_b <= 0:
        return 0.0

    spot_price = reserve_b / reserve_a
    new_reserve_a = reserve_a + amount
    new_reserve_b = (reserve_a * reserve_b) / new_reserve_a
    tokens_received = reserve_b - new_reserve_b
    if tokens_received <= 0:
        return 1.0
    effective_price = tokens_received / amount
    impact = 1.0 - (effective_price / spot_price)
    return max(0.0, min(1.0, impact))


def calculate_slippage(
    amount: int,
    reserve_a: int,
    reserve_b: int,
    fee_bps: int = 30,
) -> float:
    """
    Calculate realised slippage including fees as a fraction.

    Slippage = 1 - (actual_output / ideal_output) where ideal is
    computed at spot price with zero fees.
    """
    if amount <= 0 or reserve_a <= 0 or reserve_b <= 0:
        return 0.0

    spot_price = reserve_b / reserve_a
    ideal_output = amount * spot_price
    if ideal_output <= 0:
        return 0.0
    actual_output = constant_product_output(amount, reserve_a, reserve_b, fee_bps)
    if actual_output <= 0:
        return 1.0
    slippage = 1.0 - (actual_output / ideal_output)
    return max(0.0, min(1.0, slippage))


def sqrt_price_to_price(sqrt_price: int, decimals_a: int = 9, decimals_b: int = 6) -> float:
    """
    Convert a Q64.64 sqrt-price (used in concentrated liquidity AMMs) to
    a human-readable price.

    sqrt_price is stored as a fixed-point number with 64 fractional bits.
    price = (sqrt_price / 2^64)^2 * 10^(decimals_a - decimals_b)
    """
    if sqrt_price <= 0:
        return 0.0
    q64 = 2**64
    price_raw = (sqrt_price / q64) ** 2
    decimal_adjustment = 10 ** (decimals_a - decimals_b)
    return price_raw * decimal_adjustment


def concentrated_liquidity_swap(
    amount_in: int,
    liquidity: int,
    sqrt_price: int,
    fee_bps: int = 30,
) -> tuple[int, int]:
    """
    Simulate a swap on a concentrated-liquidity AMM within a single tick range.

    Returns (amount_out, new_sqrt_price).
    Uses the formula: delta_sqrt_price = amount_in * fee_factor / liquidity
    """
    if amount_in <= 0 or liquidity <= 0 or sqrt_price <= 0:
        return (0, sqrt_price)

    q64 = 2**64
    fee_factor = (10_000 - fee_bps) / 10_000
    amount_after_fee = int(amount_in * fee_factor)

    delta_sqrt_price = (amount_after_fee * q64) // liquidity
    new_sqrt_price = sqrt_price + delta_sqrt_price

    if new_sqrt_price <= 0:
        return (0, sqrt_price)

    # amount_out = liquidity * |1/sqrt_price_old - 1/sqrt_price_new|  (in Q64)
    inv_old = (q64 * q64) // sqrt_price
    inv_new = (q64 * q64) // new_sqrt_price
    amount_out = abs((liquidity * (inv_old - inv_new)) // q64)

    return (int(amount_out), int(new_sqrt_price))


def optimal_split(total_amount: int, pools: list["PoolState"]) -> list[int]:
    """
    Split `total_amount` across multiple pools to minimise aggregate slippage.

    Uses iterative greedy allocation: repeatedly assigns a small chunk to the
    pool that currently offers the best marginal output.
    """
    if not pools:
        return []
    if len(pools) == 1:
        return [total_amount]

    n = len(pools)
    allocations = [0] * n
    # track "virtual" reserves (adjusted as we allocate)
    reserves = [(p.reserve_a, p.reserve_b, p.fee_bps) for p in pools]
    remaining = total_amount
    chunk = max(1, total_amount // 100)

    while remaining > 0:
        current_chunk = min(chunk, remaining)
        best_idx = 0
        best_output = -1
        for i in range(n):
            ra, rb, fee = reserves[i]
            out = constant_product_output(current_chunk, ra, rb, fee)
            if out > best_output:
                best_output = out
                best_idx = i

        allocations[best_idx] += current_chunk
        ra, rb, fee = reserves[best_idx]
        out = constant_product_output(current_chunk, ra, rb, fee)
        reserves[best_idx] = (ra + current_chunk, rb - out, fee)
        remaining -= current_chunk

    return allocations


def isqrt(n: int) -> int:
    """Integer square root using Newton's method. Returns floor(sqrt(n))."""
    if n < 0:
        raise ValueError("isqrt is not defined for negative numbers")
    if n == 0:
        return 0
    x = n
    y = (x + 1) // 2
    while y < x:
        x = y
        y = (x + n // x) // 2
    return x


def weighted_average(values: list[tuple[float, float]]) -> float:
    """
    Compute weighted average from (value, weight) pairs.
    Returns 0.0 if total weight is zero.
    """
    total_weight = sum(w for _, w in values)
    if total_weight == 0.0:
        return 0.0
    return sum(v * w for v, w in values) / total_weight


def logistic(x: float, k: float = 1.0, x0: float = 0.0) -> float:
    """Standard logistic function: 1 / (1 + exp(-k*(x - x0)))."""
    exponent = -k * (x - x0)
    # clamp to avoid overflow
    exponent = max(-500.0, min(500.0, exponent))
    return 1.0 / (1.0 + math.exp(exponent))


def ewma(values: list[float], alpha: float = 0.1) -> list[float]:
    """
    Exponentially weighted moving average.

    alpha in (0, 1]. Higher alpha gives more weight to recent values.
    Returns a list the same length as the input.
    """
    if not values:
        return []
    if not (0.0 < alpha <= 1.0):
        raise ValueError(f"alpha must be in (0, 1], got {alpha}")

    result: list[float] = [values[0]]
    for i in range(1, len(values)):
        smoothed = alpha * values[i] + (1.0 - alpha) * result[i - 1]
        result.append(smoothed)
    return result


def geometric_mean(values: list[float]) -> float:
    """Compute the geometric mean of positive values."""
    if not values:
        return 0.0
    log_sum = sum(math.log(v) for v in values if v > 0)
    count = sum(1 for v in values if v > 0)
    if count == 0:
        return 0.0
    return math.exp(log_sum / count)


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp value to [lo, hi]."""
    return max(lo, min(hi, value))
