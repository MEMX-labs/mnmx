"""
Custom exception hierarchy for the MNMX SDK.

All exceptions inherit from MnmxError so callers can catch broadly or narrowly.
"""

from __future__ import annotations

from typing import Any


class MnmxError(Exception):
    """Base exception for all MNMX SDK errors."""

    def __init__(
        self,
        message: str = "An MNMX error occurred",
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message
        self.status_code = status_code
        self.details: dict[str, Any] = details or {}
        super().__init__(self.message)

    def __str__(self) -> str:
        parts = [self.message]
        if self.status_code is not None:
            parts.append(f"[status={self.status_code}]")
        if self.details:
            parts.append(f"details={self.details}")
        return " ".join(parts)

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}(message={self.message!r}, "
            f"status_code={self.status_code!r}, details={self.details!r})"
        )


class ConnectionError(MnmxError):
    """Raised when the SDK cannot connect to the MNMX engine."""

    def __init__(
        self,
        message: str = "Failed to connect to the MNMX engine",
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
        endpoint: str = "",
    ) -> None:
        self.endpoint = endpoint
        if endpoint:
            message = f"{message} at {endpoint}"
        super().__init__(message=message, status_code=status_code, details=details)


class AuthenticationError(MnmxError):
    """Raised when authentication fails (invalid or missing API key)."""

    def __init__(
        self,
        message: str = "Authentication failed: invalid or missing API key",
        status_code: int | None = 401,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message=message, status_code=status_code, details=details)


class RateLimitError(MnmxError):
    """Raised when the API rate limit has been exceeded."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        status_code: int | None = 429,
        details: dict[str, Any] | None = None,
        retry_after_seconds: float = 0.0,
    ) -> None:
        self.retry_after_seconds = retry_after_seconds
        if retry_after_seconds > 0:
            message = f"{message} (retry after {retry_after_seconds:.1f}s)"
        super().__init__(message=message, status_code=status_code, details=details)


class InvalidActionError(MnmxError):
    """Raised when an ExecutionAction fails validation."""

    def __init__(
        self,
        message: str = "Invalid action parameters",
        status_code: int | None = 400,
        details: dict[str, Any] | None = None,
        field: str = "",
    ) -> None:
        self.field = field
        if field:
            message = f"{message}: problem with field '{field}'"
        super().__init__(message=message, status_code=status_code, details=details)


class SimulationError(MnmxError):
    """Raised when a simulation fails to produce a valid result."""

    def __init__(
        self,
        message: str = "Simulation failed",
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
        action_kind: str = "",
    ) -> None:
        self.action_kind = action_kind
        if action_kind:
            message = f"{message} for action type '{action_kind}'"
        super().__init__(message=message, status_code=status_code, details=details)


class TimeoutError(MnmxError):
    """Raised when a request or search exceeds its time allocation."""

    def __init__(
        self,
        message: str = "Operation timed out",
        status_code: int | None = 408,
        details: dict[str, Any] | None = None,
        elapsed_ms: float = 0.0,
        limit_ms: float = 0.0,
    ) -> None:
        self.elapsed_ms = elapsed_ms
        self.limit_ms = limit_ms
        if elapsed_ms > 0 and limit_ms > 0:
            message = f"{message} after {elapsed_ms:.0f}ms (limit: {limit_ms:.0f}ms)"
        super().__init__(message=message, status_code=status_code, details=details)


class InsufficientLiquidityError(MnmxError):
    """Raised when a pool does not have enough liquidity for the requested trade."""

    def __init__(
        self,
        message: str = "Insufficient liquidity in pool",
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
        pool_address: str = "",
        available: int = 0,
        requested: int = 0,
    ) -> None:
        self.pool_address = pool_address
        self.available = available
        self.requested = requested
        if pool_address:
            message = (
                f"{message}: pool {pool_address} has {available} available "
                f"but {requested} was requested"
            )
        super().__init__(message=message, status_code=status_code, details=details)
