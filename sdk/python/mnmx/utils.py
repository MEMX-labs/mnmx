import time
import hashlib
from typing import Any


def generate_request_id() -> str:
    """Generate a unique request identifier."""
    timestamp = str(time.time_ns())
    return hashlib.sha256(timestamp.encode()).hexdigest()[:16]


def format_amount(amount: float, decimals: int = 6) -> str:
    """Format a token amount with the specified decimal places."""
    return f"{amount:.{decimals}f}"


def parse_chain_token(spec: str) -> tuple[str, str, str]:
    """Parse a chain:token:amount specification string."""
    parts = spec.split(":")
    if len(parts) != 3:
        raise ValueError(f"Expected chain:token:amount format, got {spec!r}")
    return parts[0], parts[1], parts[2]


def elapsed_ms(start_ns: int) -> float:
    """Return elapsed milliseconds since start_ns."""
    return (time.time_ns() - start_ns) / 1_000_000
