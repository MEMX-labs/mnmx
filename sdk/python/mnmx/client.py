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

    async def get_pool_state(self, pool_address: str) -> PoolState:
        """Fetch the current state of an AMM pool."""
        data = await self._request("GET", f"/v1/pools/{pool_address}")
        return PoolState.model_validate(data)

    async def get_token_balances(self, wallet: str) -> dict[str, int]:
        """Fetch token balances for a wallet address."""
        data = await self._request("GET", f"/v1/wallets/{wallet}/balances")
        if isinstance(data, dict):
            return {k: int(v) for k, v in data.items()}
        return {}

    async def stream_search(
        self,
        state: OnChainState,
        actions: list[ExecutionAction],
        config: SearchConfig | None = None,
    ) -> AsyncIterator[SearchProgressEvent]:
        """
        Stream search progress events via server-sent events.

        Yields SearchProgressEvent objects as the engine explores the tree.
        The final event contains the completed ExecutionPlan.
        """
        payload: dict[str, Any] = {
            "state": state.model_dump(),
            "actions": [a.model_dump() for a in actions],
        }
        if config is not None:
            payload["config"] = config.model_dump()

        client = self._get_client()
        try:
            async with client.stream(
                "POST",
                "/v1/search/stream",
                json=payload,
                headers={"Accept": "text/event-stream"},
            ) as response:
                self._check_status(response.status_code, "")
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        event_str, buffer = buffer.split("\n\n", 1)
                        event = self._parse_sse_event(event_str)
                        if event is not None:
                            yield event
        except httpx.ConnectError as exc:
            raise ConnectionError(
                message="Failed to connect for streaming search",
                endpoint=self.endpoint,
            ) from exc

    # -- internals ----------------------------------------------------------

    def _build_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "mnmx-python-sdk/0.1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
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
        return self._client

    async def _request(
        self,
        method: str,
        path: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """
        Make an HTTP request with retry logic and error handling.

        Retries on 429 (rate-limit) and 5xx errors with exponential backoff.
        """
        client = self._get_client()
        last_exception: Exception | None = None
        backoff = _INITIAL_BACKOFF

        for attempt in range(self.max_retries + 1):
            start = time.monotonic()
            try:
                if method.upper() == "GET":
                    response = await client.get(path)
                elif method.upper() == "POST":
                    response = await client.post(path, json=data)
                elif method.upper() == "PUT":
                    response = await client.put(path, json=data)
                elif method.upper() == "DELETE":
                    response = await client.delete(path)
                else:
                    raise InvalidActionError(message=f"Unsupported HTTP method: {method}")

                elapsed = (time.monotonic() - start) * 1000

                if response.status_code == 429:
                    retry_after = float(response.headers.get("Retry-After", str(backoff)))
                    if attempt < self.max_retries:
                        await asyncio.sleep(retry_after)
                        backoff = min(backoff * _BACKOFF_MULTIPLIER, _MAX_BACKOFF)
                        continue
                    raise RateLimitError(retry_after_seconds=retry_after)
