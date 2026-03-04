"""
MNMX SDK - Cross-chain routing using minimax search.

Treats cross-chain token routing as a game tree problem,
finding paths with the best guaranteed minimum outcome
across bridges and DEXes.
"""

from mnmx.router import MnmxRouter
from mnmx.simulator import RouteSimulator
from mnmx.batch_analyzer import BatchAnalyzer
from mnmx.types import (
    Chain,
    Token,
    Route,
    RouteHop,
    RouteRequest,
    BridgeQuote,
    RouterConfig,
    ScoringWeights,
    AdversarialModel,
    SimulationResult,
    MonteCarloResult,
    SearchStats,
)

__version__ = "0.1.0"

__all__ = [
    "MnmxRouter",
    "RouteSimulator",
    "BatchAnalyzer",
    "Chain",
    "Token",
    "Route",
    "RouteHop",
    "RouteRequest",
    "BridgeQuote",
    "RouterConfig",
    "ScoringWeights",
    "AdversarialModel",
    "SimulationResult",
    "MonteCarloResult",
    "SearchStats",
]
