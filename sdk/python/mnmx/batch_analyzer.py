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
