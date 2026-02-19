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


class MnmxClient:
    """
    Async client for the MNMX minimax execution engine.

    Usage::

        async with MnmxClient("https://api.mnmx.io", api_key="sk-...") as client:
            plan = await client.search(state, actions, config)
    """

    def __init__(
        self,
        endpoint: str,
        api_key: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
        max_retries: int = _MAX_RETRIES,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self._client: httpx.AsyncClient | None = None

    # -- context manager ----------------------------------------------------

    async def __aenter__(self) -> "MnmxClient":
        self._client = httpx.AsyncClient(
            base_url=self.endpoint,
            timeout=httpx.Timeout(self.timeout),
            headers=self._build_headers(),
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=30.0,
            ),
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # -- public API ---------------------------------------------------------

    async def search(
        self,
        state: OnChainState,
        actions: list[ExecutionAction],
        config: SearchConfig | None = None,
    ) -> ExecutionPlan:
        """Run a synchronous minimax search and return the optimal plan."""
        payload: dict[str, Any] = {
            "state": state.model_dump(),
            "actions": [a.model_dump() for a in actions],
        }
        if config is not None:
            payload["config"] = config.model_dump()

        data = await self._request("POST", "/v1/search", payload)
        return ExecutionPlan.model_validate(data)

    async def evaluate(
        self,
        state: OnChainState,
        action: ExecutionAction,
    ) -> EvaluationResult:
        """Evaluate a single action against the current state."""
        payload = {
            "state": state.model_dump(),
            "action": action.model_dump(),
        }
        data = await self._request("POST", "/v1/evaluate", payload)
        return EvaluationResult.model_validate(data)

    async def detect_threats(
        self,
        action: ExecutionAction,
        state: OnChainState,
    ) -> list[MevThreat]:
        """Detect MEV threats for a given action in the current mempool."""
        payload = {
            "action": action.model_dump(),
            "state": state.model_dump(),
        }
        data = await self._request("POST", "/v1/threats", payload)
        threats_raw = data if isinstance(data, list) else data.get("threats", [])
        return [MevThreat.model_validate(t) for t in threats_raw]
