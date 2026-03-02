"""Bridge adapters and registry for the MNMX SDK."""

from __future__ import annotations

import hashlib
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from mnmx.exceptions import BridgeError, InsufficientLiquidityError
from mnmx.types import BridgeHealth, BridgeQuote, Chain


class BridgeAdapter(ABC):
    """Abstract base for bridge adapters."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def supported_chains(self) -> list[Chain]: ...

    @abstractmethod
    def get_quote(
        self,
        from_chain: Chain,
        to_chain: Chain,
        from_token: str,
        to_token: str,
        amount: float,
    ) -> BridgeQuote: ...

    @abstractmethod
    def get_health(self) -> BridgeHealth: ...

    def supports_pair(self, from_chain: Chain, to_chain: Chain) -> bool:
        return from_chain in self.supported_chains and to_chain in self.supported_chains

    def _deterministic_seed(self, *parts: str) -> float:
        """Generate a deterministic float in [0,1) from string parts for reproducibility."""
        h = hashlib.sha256("|".join(parts).encode()).hexdigest()
        return int(h[:8], 16) / 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Fee / liquidity parameters per bridge
# ---------------------------------------------------------------------------

@dataclass
class _BridgeFeeModel:
    base_fee_bps: float  # basis points
    min_fee_usd: float
    max_fee_usd: float
    gas_cost_native: float  # approximate native gas cost in USD
    speed_seconds: int  # median confirm time
    liquidity_pool: float  # approximate total pool in USD
    congestion: float  # 0-1


_FEE_MODELS: dict[str, _BridgeFeeModel] = {
    "wormhole": _BridgeFeeModel(
        base_fee_bps=8,
        min_fee_usd=0.50,
        max_fee_usd=500.0,
        gas_cost_native=2.50,
        speed_seconds=180,
        liquidity_pool=450_000_000.0,
        congestion=0.12,
    ),
    "debridge": _BridgeFeeModel(
        base_fee_bps=12,
        min_fee_usd=1.00,
        max_fee_usd=1000.0,
        gas_cost_native=3.20,
        speed_seconds=120,
        liquidity_pool=180_000_000.0,
        congestion=0.08,
    ),
    "layerzero": _BridgeFeeModel(
        base_fee_bps=6,
        min_fee_usd=0.80,
        max_fee_usd=400.0,
        gas_cost_native=1.80,
        speed_seconds=90,
        liquidity_pool=620_000_000.0,
        congestion=0.15,
    ),
    "allbridge": _BridgeFeeModel(
        base_fee_bps=15,
        min_fee_usd=0.60,
        max_fee_usd=800.0,
        gas_cost_native=2.00,
        speed_seconds=240,
        liquidity_pool=95_000_000.0,
        congestion=0.05,
    ),
}


def _compute_quote(
    model: _BridgeFeeModel,
    bridge_name: str,
    from_chain: Chain,
    to_chain: Chain,
    from_token: str,
    to_token: str,
    amount: float,
) -> BridgeQuote:
    """Shared quote computation logic."""
    if amount > model.liquidity_pool * 0.10:
        raise InsufficientLiquidityError(
            bridge=bridge_name,
            amount=amount,
            available=model.liquidity_pool * 0.10,
        )

    # base protocol fee
    protocol_fee = max(model.min_fee_usd, min(amount * model.base_fee_bps / 10_000, model.max_fee_usd))

    # gas cost varies by chain
    chain_gas_multiplier: dict[Chain, float] = {
        Chain.ETHEREUM: 2.0,
        Chain.POLYGON: 0.15,
        Chain.ARBITRUM: 0.30,
        Chain.OPTIMISM: 0.25,
