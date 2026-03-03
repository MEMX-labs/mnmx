"""
Tests for the MNMX Simulator.
"""

from __future__ import annotations

import pytest

from mnmx.exceptions import InsufficientLiquidityError
from mnmx.math_utils import constant_product_output
from mnmx.simulator import Simulator, MonteCarloResult
from mnmx.types import (
    ActionKind,
    ExecutionAction,
    MevKind,
    MevThreat,
    OnChainState,
    PoolState,
    SimulationConfig,
    SimulationResult,
)


POOL_ADDR = "A" * 44
TOKEN_A = "SoLMint111111111111111111111111111111111111"
TOKEN_B = "USDCMint11111111111111111111111111111111111"


def _make_pool(reserve_a: int = 1_000_000, reserve_b: int = 500_000, fee: int = 30) -> PoolState:
    return PoolState(
        address=POOL_ADDR,
        token_a_mint=TOKEN_A,
        token_b_mint=TOKEN_B,
        reserve_a=reserve_a,
        reserve_b=reserve_b,
        fee_bps=fee,
    )


def _make_state(pool: PoolState | None = None) -> OnChainState:
    pool = pool or _make_pool()
    return OnChainState(
        slot=100,
        pools=[pool],
        balances={TOKEN_A: 10_000_000, TOKEN_B: 5_000_000},
    )


def _make_swap(amount: int = 10_000, min_out: int = 0) -> ExecutionAction:
    return ExecutionAction(
        kind=ActionKind.SWAP,
        pool_address=POOL_ADDR,
        token_in=TOKEN_A,
        token_out=TOKEN_B,
        amount_in=amount,
        min_amount_out=min_out,
    )


class TestConstantProductSwap:
    def test_basic_swap_produces_output(self) -> None:
        sim = Simulator()
        state = _make_state()
        action = _make_swap(10_000)
        result = sim.simulate_swap(state, action)

        assert result.success is True
        assert result.amount_out > 0
        assert result.amount_out < 10_000  # must be less due to fees/impact

    def test_swap_output_matches_math(self) -> None:
        pool = _make_pool()
        expected = constant_product_output(10_000, pool.reserve_a, pool.reserve_b, pool.fee_bps)

        sim = Simulator()
        result = sim.simulate_swap(_make_state(pool), _make_swap(10_000))

        assert result.amount_out == expected

    def test_larger_swap_has_more_impact(self) -> None:
        sim = Simulator()
        state = _make_state()

        small = sim.simulate_swap(state, _make_swap(1_000))
        large = sim.simulate_swap(state, _make_swap(100_000))

        assert large.price_impact_bps > small.price_impact_bps

    def test_tiny_amount_may_produce_zero_output(self) -> None:
        sim = Simulator()
        result = sim.simulate_action(
            _make_state(),
            ExecutionAction(
                kind=ActionKind.SWAP,
                pool_address=POOL_ADDR,
                token_in=TOKEN_A,
                token_out=TOKEN_B,
                amount_in=1,  # too small for integer math to yield output
                min_amount_out=0,
            ),
        )
        # amount_in=1 with fee produces 0 output via integer division
        assert result.success is False
        assert "zero output" in (result.error or "").lower()

    def test_swap_below_min_out_fails(self) -> None:
        sim = Simulator()
        result = sim.simulate_swap(
            _make_state(), _make_swap(10_000, min_out=999_999_999)
        )
        assert result.success is False
        assert "below minimum" in (result.error or "").lower()


class TestSlippageCalculation:
    def test_slippage_increases_with_size(self) -> None:
        sim = Simulator()
        state = _make_state()

        r1 = sim.simulate_swap(state, _make_swap(1_000))
        r2 = sim.simulate_swap(state, _make_swap(100_000))

        assert r2.slippage_bps > r1.slippage_bps

    def test_slippage_is_non_negative(self) -> None:
        sim = Simulator()
        result = sim.simulate_swap(_make_state(), _make_swap(5_000))
        assert result.slippage_bps >= 0


class TestPriceImpact:
    def test_small_trade_low_impact(self) -> None:
        pool = _make_pool(reserve_a=1_000_000_000, reserve_b=500_000_000)
        sim = Simulator()
        result = sim.simulate_swap(_make_state(pool), _make_swap(100))
        assert result.price_impact_bps < 5

    def test_large_trade_high_impact(self) -> None:
        pool = _make_pool(reserve_a=100_000, reserve_b=50_000)
        sim = Simulator()
        result = sim.simulate_swap(_make_state(pool), _make_swap(50_000))
        assert result.price_impact_bps > 100


class TestMevAttackSimulation:
    def test_sandwich_reduces_output(self) -> None:
        sim = Simulator()
        state = _make_state()
        action = _make_swap(10_000)

        clean = sim.simulate_swap(state, action)
        attacked = sim.simulate_mev_attack(
            state,
            action,
            MevThreat(kind=MevKind.SANDWICH, confidence=0.9, affected_pool=POOL_ADDR),
        )

        assert attacked.amount_out < clean.amount_out

    def test_frontrun_reduces_output(self) -> None:
        sim = Simulator()
        state = _make_state()
        action = _make_swap(10_000)

        clean = sim.simulate_swap(state, action)
        attacked = sim.simulate_mev_attack(
            state,
            action,
            MevThreat(kind=MevKind.FRONTRUN, confidence=0.7, affected_pool=POOL_ADDR),
        )

        assert attacked.amount_out < clean.amount_out

    def test_jit_may_improve_output(self) -> None:
        sim = Simulator()
        pool = _make_pool(reserve_a=10_000, reserve_b=5_000)
        state = _make_state(pool)
        action = _make_swap(1_000)

        clean = sim.simulate_swap(state, action)
        jit_result = sim.simulate_mev_attack(
            state,
            action,
            MevThreat(kind=MevKind.JIT_LIQUIDITY, confidence=0.5, affected_pool=POOL_ADDR),
        )
        # JIT adds liquidity, so output may be similar or slightly better
        assert jit_result.amount_out > 0


class TestMonteCarloConvergence:
    def test_monte_carlo_produces_results(self) -> None:
        sim = Simulator(SimulationConfig(monte_carlo_iterations=100))
        sim.seed(42)
        result = sim.run_monte_carlo(_make_state(), _make_swap(10_000), iterations=100)

        assert result.iterations == 100
        assert result.mean_output > 0
        assert result.worst_case <= result.mean_output
        assert result.best_case >= result.mean_output

    def test_monte_carlo_percentiles_ordered(self) -> None:
        sim = Simulator()
        sim.seed(123)
        result = sim.run_monte_carlo(_make_state(), _make_swap(10_000), iterations=500)

        assert result.percentile_5 <= result.percentile_25
        assert result.percentile_25 <= result.percentile_50
        assert result.percentile_50 <= result.percentile_75
        assert result.percentile_75 <= result.percentile_95

    def test_monte_carlo_std_positive(self) -> None:
        sim = Simulator()
        sim.seed(99)
        result = sim.run_monte_carlo(_make_state(), _make_swap(10_000), iterations=200)
        assert result.std_output >= 0

    def test_mev_probability_bounded(self) -> None:
        sim = Simulator()
        sim.seed(7)
        result = sim.run_monte_carlo(_make_state(), _make_swap(10_000), iterations=1000)
        assert 0.0 <= result.mev_attack_probability <= 1.0


class TestStateMutationSafety:
    def test_simulate_does_not_mutate_input(self) -> None:
        state = _make_state()
        original_reserve_a = state.pools[0].reserve_a
        original_reserve_b = state.pools[0].reserve_b
        original_balance = state.balances.get(TOKEN_A, 0)

        sim = Simulator()
        sim.simulate_swap(state, _make_swap(10_000))

        assert state.pools[0].reserve_a == original_reserve_a
        assert state.pools[0].reserve_b == original_reserve_b
        assert state.balances.get(TOKEN_A, 0) == original_balance

    def test_new_state_reflects_trade(self) -> None:
        state = _make_state()
        sim = Simulator()
        result = sim.simulate_swap(state, _make_swap(10_000))

        assert result.new_state is not None
        new_pool = result.new_state.get_pool(POOL_ADDR)
        assert new_pool is not None
        assert new_pool.reserve_a == state.pools[0].reserve_a + 10_000
        assert new_pool.reserve_b < state.pools[0].reserve_b

    def test_missing_pool_returns_error(self) -> None:
        state = OnChainState(slot=1, pools=[])
        sim = Simulator()
        result = sim.simulate_swap(state, _make_swap(10_000))
        assert result.success is False
        assert "not found" in (result.error or "").lower()

    def test_empty_pool_raises_insufficient_liquidity(self) -> None:
        pool = _make_pool(reserve_a=0, reserve_b=0)
        sim = Simulator()
        with pytest.raises(InsufficientLiquidityError):
            sim.simulate_swap(_make_state(pool), _make_swap(10_000))


class TestGasEstimation:
    def test_gas_includes_base_and_priority(self) -> None:
        sim = Simulator(SimulationConfig(base_gas_lamports=5000))
        action = _make_swap(10_000)
        action.priority_fee_lamports = 10_000

        gas = sim.estimate_gas_cost(action)
        assert gas >= 15_000  # base + priority

    def test_no_op_gas_is_zero(self) -> None:
        sim = Simulator()
        result = sim.simulate_action(
            _make_state(),
            ExecutionAction(kind=ActionKind.NO_OP, priority_fee_lamports=0, compute_unit_limit=0),
        )
        assert result.gas_cost_lamports == 0
