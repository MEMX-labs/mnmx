"""
Async HTTP client for the MNMX engine API.

Provides search, evaluation, threat detection, and streaming endpoints
with connection pooling, retry logic, and structured error handling.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from mnmx.exceptions import (
    AuthenticationError,
    ConnectionError,
    InvalidActionError,
    MnmxError,
    RateLimitError,
    TimeoutError,
)
from mnmx.types import (
    EvaluationResult,
    ExecutionAction,
    ExecutionPlan,
    MevThreat,
    OnChainState,
    PoolState,
    SearchConfig,
)


_DEFAULT_TIMEOUT = 30.0
_MAX_RETRIES = 3
_INITIAL_BACKOFF = 0.5
_BACKOFF_MULTIPLIER = 2.0
_MAX_BACKOFF = 10.0


class SearchProgressEvent:
    """Event emitted during streaming search."""

    def __init__(
        self,
        event_type: str,
        depth: int = 0,
        nodes_explored: int = 0,
        best_score: float = 0.0,
        elapsed_ms: float = 0.0,
        message: str = "",
        partial_plan: ExecutionPlan | None = None,
    ) -> None:
        self.event_type = event_type
        self.depth = depth
        self.nodes_explored = nodes_explored
        self.best_score = best_score
        self.elapsed_ms = elapsed_ms
        self.message = message
        self.partial_plan = partial_plan

    def __repr__(self) -> str:
        return (
            f"SearchProgressEvent(type={self.event_type!r}, depth={self.depth}, "
            f"nodes={self.nodes_explored}, score={self.best_score:.4f})"
        )

