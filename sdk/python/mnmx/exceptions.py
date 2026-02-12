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
