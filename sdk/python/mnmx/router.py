"""Core MNMX router: minimax-based cross-chain path discovery."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from itertools import permutations
from typing import Any

from mnmx.bridges import BridgeAdapter, BridgeRegistry, create_default_registry
from mnmx.exceptions import (
    InvalidConfigError,
    NoRouteFoundError,
    RouteTimeoutError,
)
from mnmx.scoring import RouteScorer, get_strategy_weights
from mnmx.types import (
    AdversarialModel,
    BridgeQuote,
    Chain,
    Route,
    RouteHop,
    RouteRequest,
    RouterConfig,
    ScoringWeights,
    SearchStats,
    Strategy,
    VALID_STRATEGIES,
)


@dataclass
class _SearchNode:
    """Internal node in the minimax game tree."""

    chain: Chain
    token: str
    amount: float
    depth: int
    hops: list[RouteHop] = field(default_factory=list)
    total_fee: float = 0.0
    total_time: int = 0


class MnmxRouter:
    """Cross-chain router using minimax search with alpha-beta pruning.

    The router models cross-chain routing as a two-player game:
    - MAX player: the user, choosing the best bridge at each hop
    - MIN player: the adversarial market (slippage, MEV, delays)

    The minimax search finds the route whose *worst-case* outcome
    is maximised (the guaranteed minimum).
    """

    def __init__(
        self,
        strategy: Strategy = "minimax",
        config: RouterConfig | None = None,
        registry: BridgeRegistry | None = None,
        **kwargs: Any,
    ) -> None:
        if config is not None:
            self._config = config
        else:
            weights = kwargs.get("weights")
            adversarial = kwargs.get("adversarial_model")
            self._config = RouterConfig(
                strategy=strategy,
                slippage_tolerance=kwargs.get("slippage_tolerance", 0.005),
                timeout_ms=kwargs.get("timeout_ms", 5000),
                max_hops=kwargs.get("max_hops", 3),
                weights=weights if isinstance(weights, ScoringWeights) else ScoringWeights(),
                adversarial_model=adversarial if isinstance(adversarial, AdversarialModel) else AdversarialModel(),
            )
        self._registry = registry or create_default_registry()
        self._scorer = RouteScorer(self._config.weights)
        self._stats = SearchStats(0, 0, 0, 0.0)

    # ---- public API --------------------------------------------------------

    @property
    def config(self) -> RouterConfig:
        return self._config

    @property
    def last_search_stats(self) -> SearchStats:
        return self._stats

    def find_route(
        self,
        from_chain: str | Chain,
        from_token: str,
        amount: float,
        to_chain: str | Chain,
        to_token: str,
        **kwargs: Any,
    ) -> Route:
        """Find the single best route using the configured strategy."""
        routes = self.find_all_routes(from_chain, from_token, amount, to_chain, to_token, **kwargs)
        if not routes:
            src = from_chain if isinstance(from_chain, str) else from_chain.value
            dst = to_chain if isinstance(to_chain, str) else to_chain.value
            raise NoRouteFoundError(src, dst, from_token, to_token)
        return routes[0]

    def find_all_routes(
        self,
