"""Tests for the MNMX route simulator."""

from __future__ import annotations

import pytest

from mnmx.simulator import RouteSimulator, SimulationConditions
from mnmx.types import Route, SimulationResult, MonteCarloResult


class TestSimulateDefaultConditions:
    def test_output_positive(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        result = sim.simulate(sample_route)
        assert result.output > 0

    def test_output_less_than_input(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        result = sim.simulate(sample_route)
        assert result.output < sample_route.path[0].input_amount

    def test_fees_positive(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        result = sim.simulate(sample_route)
        assert result.total_fees > 0

    def test_time_positive(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        result = sim.simulate(sample_route)
        assert result.total_time > 0

    def test_slippage_in_range(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        result = sim.simulate(sample_route)
        assert 0.0 <= result.slippage_actual <= 1.0


class TestSimulateAdversarial:
    def test_high_slippage_reduces_output(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        normal = sim.simulate(sample_route, SimulationConditions())
        adverse = sim.simulate(
            sample_route,
            SimulationConditions(slippage_multiplier=3.0),
        )
        assert adverse.output < normal.output

    def test_high_gas_increases_fees(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        normal = sim.simulate(sample_route, SimulationConditions())
        high_gas = sim.simulate(
            sample_route,
            SimulationConditions(gas_multiplier=3.0),
        )
        assert high_gas.total_fees > normal.total_fees

    def test_mev_extraction_reduces_output(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        normal = sim.simulate(sample_route, SimulationConditions())
        mev = sim.simulate(
            sample_route,
            SimulationConditions(mev_extraction=0.05),
        )
        assert mev.output < normal.output
        assert mev.mev_loss > 0

    def test_price_movement_reduces_output(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        normal = sim.simulate(sample_route, SimulationConditions())
        price_shock = sim.simulate(
            sample_route,
            SimulationConditions(price_movement=0.05),
        )
        assert price_shock.output < normal.output

    def test_low_liquidity_increases_slippage(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        normal = sim.simulate(sample_route, SimulationConditions())
        low_liq = sim.simulate(
            sample_route,
            SimulationConditions(liquidity_factor=0.1),
        )
        assert low_liq.output < normal.output

    def test_bridge_delay_increases_time(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        normal = sim.simulate(sample_route, SimulationConditions())
        delayed = sim.simulate(
            sample_route,
            SimulationConditions(bridge_delay_multiplier=5.0),
        )
        assert delayed.total_time > normal.total_time


class TestMonteCarlo:
    def test_basic_returns_result(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        mc = sim.monte_carlo(sample_route, iterations=100)
        assert isinstance(mc, MonteCarloResult)
        assert mc.iterations == 100
        assert mc.mean_output > 0
        assert mc.median_output > 0

    def test_percentiles_ordered(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        mc = sim.monte_carlo(sample_route, iterations=500)
        assert mc.min_output <= mc.percentile_5
        assert mc.percentile_5 <= mc.median_output
        assert mc.median_output <= mc.percentile_95
        assert mc.percentile_95 <= mc.max_output

    def test_std_dev_positive(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        mc = sim.monte_carlo(sample_route, iterations=500)
        assert mc.std_dev >= 0

    def test_deterministic_with_seed(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        mc1 = sim.monte_carlo(sample_route, iterations=200, seed=42)
        mc2 = sim.monte_carlo(sample_route, iterations=200, seed=42)
        assert mc1.mean_output == mc2.mean_output
        assert mc1.median_output == mc2.median_output
        assert mc1.min_output == mc2.min_output
        assert mc1.max_output == mc2.max_output

    def test_different_seeds_different_results(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        mc1 = sim.monte_carlo(sample_route, iterations=500, seed=1)
        mc2 = sim.monte_carlo(sample_route, iterations=500, seed=99)
        # Very unlikely to be exactly equal with different seeds
        assert mc1.mean_output != mc2.mean_output


class TestStressTest:
    def test_returns_multiple_results(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        results = sim.stress_test(sample_route)
        assert len(results) >= 5
        for r in results:
            assert isinstance(r, SimulationResult)

    def test_extreme_scenario_worse_than_normal(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        results = sim.stress_test(sample_route)
        # First scenario is normal, last is extreme adversarial
        assert results[-1].output <= results[0].output

    def test_custom_scenarios(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        custom = [
            SimulationConditions(gas_multiplier=2.0),
            SimulationConditions(mev_extraction=0.01),
        ]
        results = sim.stress_test(sample_route, scenarios=custom)
        assert len(results) == 2

    def test_all_results_have_positive_or_zero_output(self, sample_route: Route) -> None:
        sim = RouteSimulator()
        results = sim.stress_test(sample_route)
        for r in results:
            assert r.output >= 0
