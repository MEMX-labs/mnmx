"""
Local simulator for MNMX actions.

Runs constant-product AMM simulations, MEV attack modelling, and
Monte Carlo analysis entirely offline — no engine connection required.
"""

from __future__ import annotations

import copy
import math
import random
from dataclasses import dataclass, field
from typing import Any

from mnmx.exceptions import InsufficientLiquidityError, SimulationError
from mnmx.math_utils import (
    bps_to_decimal,
    calculate_price_impact,
    calculate_slippage,
    constant_product_output,
)
from mnmx.types import (
    ActionKind,
    ExecutionAction,
    MevKind,
    MevThreat,
    OnChainState,
    PendingTx,
    PoolState,
    SimulationConfig,
    SimulationResult,
)


@dataclass
class MonteCarloResult:
    """Aggregated results from a Monte Carlo simulation run."""

    mean_output: float = 0.0
    std_output: float = 0.0
    percentile_5: float = 0.0
    percentile_25: float = 0.0
    percentile_50: float = 0.0
    percentile_75: float = 0.0
    percentile_95: float = 0.0
    worst_case: float = 0.0
    best_case: float = 0.0
    mev_attack_probability: float = 0.0
    avg_mev_loss: float = 0.0
    iterations: int = 0
    raw_outputs: list[float] = field(default_factory=list)


class Simulator:
    """
    Offline action simulator using constant-product AMM math.

    Supports swap simulation, MEV attack modelling, and Monte Carlo
    analysis with configurable parameters.
    """

    def __init__(self, config: SimulationConfig | None = None) -> None:
        self.config = config or SimulationConfig()
        self._rng = random.Random(42)

    def seed(self, seed: int) -> None:
        """Reseed the random number generator for reproducible results."""
        self._rng = random.Random(seed)

    # -- primary API --------------------------------------------------------

    def simulate_action(
        self, state: OnChainState, action: ExecutionAction
    ) -> SimulationResult:
        """Simulate any supported action type against the given state."""
        if action.kind == ActionKind.SWAP:
            return self.simulate_swap(state, action)
        if action.kind == ActionKind.ADD_LIQUIDITY:
            return self._simulate_add_liquidity(state, action)
        if action.kind == ActionKind.REMOVE_LIQUIDITY:
            return self._simulate_remove_liquidity(state, action)
        if action.kind == ActionKind.NO_OP:
            return SimulationResult(
                success=True,
                amount_out=0,
                gas_cost_lamports=0,
            )
        return SimulationResult(
            success=False,
            error=f"Unsupported action kind: {action.kind.value}",
        )

    def simulate_swap(
        self, state: OnChainState, action: ExecutionAction
    ) -> SimulationResult:
        """Simulate a token swap on a constant-product pool."""
        pool = state.get_pool(action.pool_address)
        if pool is None:
            return SimulationResult(
                success=False,
                error=f"Pool {action.pool_address} not found in state",
            )

        reserve_in, reserve_out = self._resolve_reserves(pool, action.token_in)
        if reserve_in == 0 or reserve_out == 0:
            raise InsufficientLiquidityError(
                pool_address=action.pool_address,
                available=0,
                requested=action.amount_in,
            )

        amount_out = constant_product_output(
            action.amount_in, reserve_in, reserve_out, pool.fee_bps
        )

        if amount_out == 0:
            return SimulationResult(
                success=False,
                error="Swap would produce zero output",
            )

        if amount_out < action.min_amount_out:
            return SimulationResult(
                success=False,
                amount_out=amount_out,
                error=(
                    f"Output {amount_out} below minimum {action.min_amount_out}"
                ),
                warnings=["Slippage tolerance exceeded"],
            )

        impact_bps = int(
            calculate_price_impact(action.amount_in, reserve_in, reserve_out) * 10_000
        )
        slippage_bps = int(
            calculate_slippage(action.amount_in, reserve_in, reserve_out, pool.fee_bps) * 10_000
        )

        gas_cost = self.estimate_gas_cost(action)

        effective_price = action.amount_in / amount_out if amount_out > 0 else 0.0

        # Compute MEV risk from pending transactions
        mev_risk = self._estimate_mev_risk(state, action, pool)

        warnings: list[str] = []
        if impact_bps > 100:
            warnings.append(f"High price impact: {impact_bps} bps")
        if mev_risk > 0.5:
            warnings.append(f"Elevated MEV risk: {mev_risk:.2%}")

        new_state = self._apply_action_to_state(state, action)

        return SimulationResult(
            success=True,
            amount_out=amount_out,
            price_impact_bps=impact_bps,
            slippage_bps=slippage_bps,
            gas_cost_lamports=gas_cost,
            mev_risk=mev_risk,
            effective_price=effective_price,
            new_state=new_state,
            warnings=warnings,
        )

    def simulate_mev_attack(
        self,
        state: OnChainState,
        action: ExecutionAction,
        threat: MevThreat,
    ) -> SimulationResult:
        """Simulate the effect of a specific MEV attack on the victim's trade."""
        pool = state.get_pool(action.pool_address)
        if pool is None:
            return SimulationResult(
                success=False,
                error=f"Pool {action.pool_address} not found",
            )

        reserve_in, reserve_out = self._resolve_reserves(pool, action.token_in)

        if threat.kind == MevKind.FRONTRUN:
            frontrun_amount = int(action.amount_in * 0.3)
            fr_out = constant_product_output(frontrun_amount, reserve_in, reserve_out, pool.fee_bps)
            reserve_in += frontrun_amount
            reserve_out -= fr_out

        elif threat.kind == MevKind.SANDWICH:
            frontrun_amount = int(action.amount_in * 0.5)
            fr_out = constant_product_output(frontrun_amount, reserve_in, reserve_out, pool.fee_bps)
            reserve_in += frontrun_amount
            reserve_out -= fr_out

        elif threat.kind == MevKind.JIT_LIQUIDITY:
            jit_boost = int(reserve_in * 0.2)
            reserve_in += jit_boost
            reserve_out += int(reserve_out * 0.2)

        victim_output = constant_product_output(
            action.amount_in, reserve_in, reserve_out, pool.fee_bps
        )

        clean_output = constant_product_output(
            action.amount_in,
            *self._resolve_reserves(pool, action.token_in),
            pool.fee_bps,
        )

        mev_loss = max(0, clean_output - victim_output)
        gas_cost = self.estimate_gas_cost(action)

        return SimulationResult(
            success=victim_output >= action.min_amount_out,
            amount_out=victim_output,
            price_impact_bps=int(
                calculate_price_impact(action.amount_in, reserve_in, reserve_out) * 10_000
            ),
            slippage_bps=int(
                calculate_slippage(action.amount_in, reserve_in, reserve_out, pool.fee_bps) * 10_000
            ),
            gas_cost_lamports=gas_cost,
            mev_risk=threat.confidence,
            effective_price=(action.amount_in / victim_output if victim_output > 0 else 0.0),
            warnings=[
                f"MEV attack ({threat.kind.value}) caused loss of {mev_loss} tokens",
            ],
        )

    def estimate_gas_cost(self, action: ExecutionAction) -> int:
        """Estimate total gas cost in lamports for an action."""
        base = self.config.base_gas_lamports
        cu_price = 1  # micro-lamports per CU
        cu_cost = (action.compute_unit_limit * cu_price) // 1_000_000
        priority = action.priority_fee_lamports
        return base + cu_cost + priority

    def run_monte_carlo(
        self,
        state: OnChainState,
        action: ExecutionAction,
        iterations: int | None = None,
    ) -> MonteCarloResult:
        """
        Run Monte Carlo simulation to model outcome distribution.

        Each iteration randomizes MEV threats and mempool conditions,
        then simulates the swap to build an output distribution.
        """
        n = iterations or self.config.monte_carlo_iterations
        outputs: list[float] = []
        mev_attack_count = 0
        total_mev_loss = 0.0

        pool = state.get_pool(action.pool_address)
        if pool is None:
            raise SimulationError(
                message=f"Pool {action.pool_address} not found",
                action_kind=action.kind.value,
            )

        reserve_in, reserve_out = self._resolve_reserves(pool, action.token_in)
        clean_output = constant_product_output(
            action.amount_in, reserve_in, reserve_out, pool.fee_bps
        )

        for _ in range(n):
            threats = self._generate_random_mev_scenario(action)
            if threats:
                mev_attack_count += 1
                worst_threat = max(threats, key=lambda t: t.confidence)
                result = self.simulate_mev_attack(state, action, worst_threat)
                actual_output = float(result.amount_out)
                total_mev_loss += max(0.0, clean_output - actual_output)
            else:
                noise_factor = self._rng.gauss(1.0, 0.002)
                actual_output = clean_output * max(0.0, noise_factor)

            outputs.append(actual_output)

        outputs.sort()

        def percentile(data: list[float], p: float) -> float:
            idx = max(0, min(len(data) - 1, int(len(data) * p / 100)))
            return data[idx]

        mean = sum(outputs) / len(outputs) if outputs else 0.0
        variance = sum((x - mean) ** 2 for x in outputs) / len(outputs) if outputs else 0.0
        std = math.sqrt(variance)

        return MonteCarloResult(
            mean_output=mean,
            std_output=std,
            percentile_5=percentile(outputs, 5),
            percentile_25=percentile(outputs, 25),
            percentile_50=percentile(outputs, 50),
            percentile_75=percentile(outputs, 75),
            percentile_95=percentile(outputs, 95),
            worst_case=outputs[0] if outputs else 0.0,
            best_case=outputs[-1] if outputs else 0.0,
            mev_attack_probability=mev_attack_count / n if n > 0 else 0.0,
            avg_mev_loss=total_mev_loss / n if n > 0 else 0.0,
            iterations=n,
            raw_outputs=outputs,
        )

    # -- internal helpers ---------------------------------------------------

    def _resolve_reserves(
        self, pool: PoolState, token_in: str
    ) -> tuple[int, int]:
        """Return (reserve_in, reserve_out) based on which token is being sold."""
        if token_in == pool.token_a_mint:
            return pool.reserve_a, pool.reserve_b
        return pool.reserve_b, pool.reserve_a

    def _apply_action_to_state(
        self, state: OnChainState, action: ExecutionAction
    ) -> OnChainState:
        """
        Apply an action to a copy of the state and return the new state.

        The original state is never mutated.
        """
        new_state = state.model_copy(deep=True)

        if action.kind != ActionKind.SWAP:
            return new_state

        pool = new_state.get_pool(action.pool_address)
        if pool is None:
            return new_state

        reserve_in, reserve_out = self._resolve_reserves(pool, action.token_in)
        amount_out = constant_product_output(
            action.amount_in, reserve_in, reserve_out, pool.fee_bps
        )
