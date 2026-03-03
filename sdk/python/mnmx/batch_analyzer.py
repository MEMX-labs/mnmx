"""Batch analysis for comparing routing strategies across multiple pairs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from mnmx.router import MnmxRouter
from mnmx.simulator import RouteSimulator
from mnmx.types import Chain, Route, Strategy, VALID_STRATEGIES


@dataclass
class PairAnalysis:
    """Analysis of a single token pair across one or more strategies."""

    from_chain: str
    from_token: str
    amount: float
    to_chain: str
    to_token: str
    routes_by_strategy: dict[str, Route | None] = field(default_factory=dict)

    @property
    def best_strategy(self) -> str | None:
        best_name: str | None = None
        best_score = -1.0
        for name, route in self.routes_by_strategy.items():
            if route is not None and route.minimax_score > best_score:
                best_score = route.minimax_score
                best_name = name
        return best_name

    @property
    def best_route(self) -> Route | None:
        name = self.best_strategy
        if name is None:
            return None
        return self.routes_by_strategy.get(name)

    @property
    def worst_strategy(self) -> str | None:
        worst_name: str | None = None
        worst_score = float("inf")
        for name, route in self.routes_by_strategy.items():
            if route is not None and route.minimax_score < worst_score:
                worst_score = route.minimax_score
                worst_name = name
        return worst_name

    @property
    def score_spread(self) -> float:
        scores = [r.minimax_score for r in self.routes_by_strategy.values() if r is not None]
        if len(scores) < 2:
            return 0.0
        return max(scores) - min(scores)


@dataclass
class BatchReport:
    """Report from comparing strategies across multiple pairs."""

    analyses: list[PairAnalysis] = field(default_factory=list)
    strategies_tested: list[str] = field(default_factory=list)

    @property
    def pair_count(self) -> int:
        return len(self.analyses)

    def summary(self) -> dict[str, object]:
        """Aggregate summary statistics across all pairs."""
        strategy_wins: dict[str, int] = {s: 0 for s in self.strategies_tested}
        strategy_scores: dict[str, list[float]] = {s: [] for s in self.strategies_tested}
        total_pairs = len(self.analyses)
        pairs_with_routes = 0

        for analysis in self.analyses:
            best = analysis.best_strategy
            has_any_route = any(r is not None for r in analysis.routes_by_strategy.values())
            if has_any_route:
                pairs_with_routes += 1
            if best is not None and best in strategy_wins:
                strategy_wins[best] += 1
            for strat, route in analysis.routes_by_strategy.items():
                if route is not None and strat in strategy_scores:
                    strategy_scores[strat].append(route.minimax_score)

        avg_scores: dict[str, float] = {}
        for strat, scores in strategy_scores.items():
            avg_scores[strat] = sum(scores) / len(scores) if scores else 0.0

        avg_spread = 0.0
        if self.analyses:
            avg_spread = sum(a.score_spread for a in self.analyses) / len(self.analyses)

        return {
            "total_pairs": total_pairs,
            "pairs_with_routes": pairs_with_routes,
            "strategy_wins": strategy_wins,
            "average_scores": avg_scores,
            "average_score_spread": round(avg_spread, 4),
        }

    def format_table(self) -> str:
        """Format the report as a text table for display."""
        lines: list[str] = []
        header = f"{'Pair':<35} " + " ".join(f"{s:<14}" for s in self.strategies_tested) + " Best"
        lines.append(header)
        lines.append("-" * len(header))

        for analysis in self.analyses:
            pair_label = f"{analysis.from_token}({analysis.from_chain[:3]})->{analysis.to_token}({analysis.to_chain[:3]})"
            parts = [f"{pair_label:<35}"]
            for strat in self.strategies_tested:
                route = analysis.routes_by_strategy.get(strat)
                if route is not None:
                    parts.append(f"{route.minimax_score:<14.4f}")
                else:
                    parts.append(f"{'N/A':<14}")
            best = analysis.best_strategy or "N/A"
            parts.append(best)
            lines.append(" ".join(parts))

        summary = self.summary()
        lines.append("-" * len(header))
        lines.append(f"Pairs: {summary['total_pairs']}  Routes found: {summary['pairs_with_routes']}")
        wins = summary.get("strategy_wins", {})
        if isinstance(wins, dict):
            wins_str = ", ".join(f"{k}: {v}" for k, v in wins.items())
            lines.append(f"Wins: {wins_str}")

        return "\n".join(lines)


@dataclass
class _PairSpec:
    from_chain: str
    from_token: str
    amount: float
    to_chain: str
    to_token: str


class BatchAnalyzer:
    """Compare routing strategies across multiple token pairs."""

    def __init__(self, router: MnmxRouter) -> None:
        self._router = router
        self._simulator = RouteSimulator()

    def analyze_pair(
        self,
        from_chain: str,
        from_token: str,
        amount: float,
        to_chain: str,
        to_token: str,
        strategies: Sequence[str] | None = None,
    ) -> PairAnalysis:
        """Analyze a single pair across the given strategies."""
        strats = list(strategies) if strategies else list(VALID_STRATEGIES)
        analysis = PairAnalysis(
            from_chain=from_chain,
            from_token=from_token,
            amount=amount,
            to_chain=to_chain,
            to_token=to_token,
        )
        for strat in strats:
            try:
                route = self._router.find_route(
                    from_chain, from_token, amount, to_chain, to_token, strategy=strat
                )
                analysis.routes_by_strategy[strat] = route
            except Exception:
                analysis.routes_by_strategy[strat] = None

        return analysis

    def compare_strategies(
        self,
        pairs: Sequence[tuple[str, str, float, str, str]],
        strategies: Sequence[str] | None = None,
    ) -> BatchReport:
        """Compare strategies across a list of (from_chain, from_token, amount, to_chain, to_token) tuples."""
        strats = list(strategies) if strategies else list(VALID_STRATEGIES)
        report = BatchReport(strategies_tested=strats)

        for from_chain, from_token, amount, to_chain, to_token in pairs:
            analysis = self.analyze_pair(
                from_chain, from_token, amount, to_chain, to_token, strats
            )
            report.analyses.append(analysis)

        return report

    def compare_with_simulation(
        self,
        pairs: Sequence[tuple[str, str, float, str, str]],
        strategies: Sequence[str] | None = None,
        mc_iterations: int = 1000,
    ) -> dict[str, object]:
        """Compare strategies and include Monte Carlo simulation data."""
        report = self.compare_strategies(pairs, strategies)
        simulation_data: dict[str, list[dict[str, object]]] = {}

        for analysis in report.analyses:
            pair_key = f"{analysis.from_token}@{analysis.from_chain}->{analysis.to_token}@{analysis.to_chain}"
            pair_results: list[dict[str, object]] = []
            for strat, route in analysis.routes_by_strategy.items():
                if route is not None:
                    mc = self._simulator.monte_carlo(route, iterations=mc_iterations)
                    pair_results.append({
                        "strategy": strat,
                        "minimax_score": route.minimax_score,
                        "mc_mean": mc.mean_output,
                        "mc_p5": mc.percentile_5,
                        "mc_p95": mc.percentile_95,
                        "mc_std": mc.std_dev,
                    })
            simulation_data[pair_key] = pair_results

        return {
            "report": report,
            "simulations": simulation_data,
        }
