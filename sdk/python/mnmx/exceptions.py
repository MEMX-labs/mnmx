"""Custom exceptions for the MNMX SDK."""

from __future__ import annotations


class MnmxError(Exception):
    """Base exception for all MNMX SDK errors."""

    def __init__(self, message: str, details: dict | None = None) -> None:
        self.details = details or {}
        super().__init__(message)


class NoRouteFoundError(MnmxError):
    """Raised when no viable route exists between the requested chain/token pair."""

    def __init__(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str = "",
        to_token: str = "",
    ) -> None:
        parts = [f"No route found from {from_chain} to {to_chain}"]
        if from_token and to_token:
            parts[0] += f" ({from_token} -> {to_token})"
        super().__init__(
            parts[0],
            details={
                "from_chain": from_chain,
                "to_chain": to_chain,
                "from_token": from_token,
                "to_token": to_token,
            },
        )


class InsufficientLiquidityError(MnmxError):
    """Raised when bridge liquidity cannot support the requested amount."""

    def __init__(self, bridge: str, amount: float, available: float) -> None:
        super().__init__(
            f"Insufficient liquidity on {bridge}: requested {amount}, available {available}",
            details={"bridge": bridge, "amount": amount, "available": available},
        )


class SimulationError(MnmxError):
    """Raised when a route simulation fails."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"Simulation failed: {reason}", details={"reason": reason})


class RouteTimeoutError(MnmxError):
    """Raised when route discovery exceeds the configured timeout."""

    def __init__(self, timeout_ms: int) -> None:
        super().__init__(
            f"Route discovery timed out after {timeout_ms}ms",
            details={"timeout_ms": timeout_ms},
        )


class InvalidConfigError(MnmxError):
    """Raised when router configuration is invalid."""

    def __init__(self, field: str, reason: str) -> None:
        super().__init__(
            f"Invalid config for '{field}': {reason}",
            details={"field": field, "reason": reason},
        )


class BridgeError(MnmxError):
    """Raised when a bridge operation fails."""

    def __init__(self, bridge: str, operation: str, reason: str) -> None:
        super().__init__(
            f"Bridge '{bridge}' failed during {operation}: {reason}",
            details={"bridge": bridge, "operation": operation, "reason": reason},
        )
