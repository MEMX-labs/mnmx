"""Tests for bridge adapters and the bridge registry."""

from __future__ import annotations

import pytest

from mnmx.bridges import (
    AllbridgeBridge,
    BridgeRegistry,
    DeBridgeBridge,
    LayerZeroBridge,
    WormholeBridge,
    create_default_registry,
)
from mnmx.exceptions import BridgeError, InsufficientLiquidityError
from mnmx.types import Chain


class TestWormholeSupportedChains:
    def test_supports_ethereum(self) -> None:
        bridge = WormholeBridge()
        assert Chain.ETHEREUM in bridge.supported_chains

    def test_supports_solana(self) -> None:
        bridge = WormholeBridge()
        assert Chain.SOLANA in bridge.supported_chains

    def test_supports_polygon(self) -> None:
        bridge = WormholeBridge()
        assert Chain.POLYGON in bridge.supported_chains

    def test_supports_pair_eth_arb(self) -> None:
        bridge = WormholeBridge()
        assert bridge.supports_pair(Chain.ETHEREUM, Chain.ARBITRUM)

    def test_name(self) -> None:
        assert WormholeBridge().name == "wormhole"


class TestDeBridgeQuote:
    def test_returns_valid_quote(self) -> None:
        bridge = DeBridgeBridge()
        quote = bridge.get_quote(Chain.ETHEREUM, Chain.POLYGON, "USDC", "USDC", 1000.0)
        assert quote.bridge == "debridge"
        assert quote.input_amount == 1000.0
        assert quote.output_amount > 0
        assert quote.output_amount < 1000.0
        assert quote.fee > 0
        assert quote.estimated_time > 0

    def test_fee_increases_with_amount(self) -> None:
        bridge = DeBridgeBridge()
        q1 = bridge.get_quote(Chain.ETHEREUM, Chain.POLYGON, "USDC", "USDC", 100.0)
        q2 = bridge.get_quote(Chain.ETHEREUM, Chain.POLYGON, "USDC", "USDC", 10000.0)
        assert q2.fee > q1.fee

    def test_unsupported_pair_raises(self) -> None:
        bridge = DeBridgeBridge()
        # deBridge does not support CELO
        with pytest.raises(BridgeError):
            bridge.get_quote(Chain.CELO, Chain.ETHEREUM, "USDC", "USDC", 100.0)

    def test_excessive_amount_raises(self) -> None:
        bridge = DeBridgeBridge()
        with pytest.raises(InsufficientLiquidityError):
            bridge.get_quote(Chain.ETHEREUM, Chain.POLYGON, "USDC", "USDC", 100_000_000.0)

    def test_health(self) -> None:
        health = DeBridgeBridge().get_health()
        assert health.online is True
        assert health.success_rate > 0.9


class TestLayerZero:
    def test_supported_chains(self) -> None:
        bridge = LayerZeroBridge()
        assert Chain.ETHEREUM in bridge.supported_chains
        assert Chain.FANTOM in bridge.supported_chains
        assert Chain.SOLANA not in bridge.supported_chains

    def test_quote(self) -> None:
        bridge = LayerZeroBridge()
        quote = bridge.get_quote(Chain.ETHEREUM, Chain.BASE, "USDC", "USDC", 5000.0)
        assert quote.output_amount > 0
        assert quote.fee > 0


class TestAllbridge:
    def test_supported_chains(self) -> None:
        bridge = AllbridgeBridge()
        assert Chain.CELO in bridge.supported_chains
        assert Chain.SOLANA in bridge.supported_chains

    def test_quote(self) -> None:
        bridge = AllbridgeBridge()
        quote = bridge.get_quote(Chain.ETHEREUM, Chain.SOLANA, "USDC", "USDC", 2000.0)
        assert quote.output_amount > 0


class TestBridgeRegistry:
    def test_register_and_get(self) -> None:
        registry = BridgeRegistry()
        bridge = WormholeBridge()
        registry.register(bridge)
        assert registry.get("wormhole") is bridge

    def test_get_unknown_raises(self) -> None:
        registry = BridgeRegistry()
        with pytest.raises(BridgeError):
            registry.get("nonexistent")

    def test_get_all(self) -> None:
        registry = create_default_registry()
        all_bridges = registry.get_all()
        assert len(all_bridges) == 4
        names = {b.name for b in all_bridges}
        assert names == {"wormhole", "debridge", "layerzero", "allbridge"}

    def test_names(self) -> None:
        registry = create_default_registry()
        names = registry.names()
        assert "wormhole" in names
        assert len(names) == 4


class TestGetBridgesForPair:
    def test_eth_to_polygon(self) -> None:
        registry = create_default_registry()
        bridges = registry.get_for_pair(Chain.ETHEREUM, Chain.POLYGON)
        names = {b.name for b in bridges}
        assert "wormhole" in names
        assert len(bridges) >= 3

    def test_solana_to_celo(self) -> None:
        registry = create_default_registry()
        bridges = registry.get_for_pair(Chain.SOLANA, Chain.CELO)
        # only wormhole and allbridge support both
        names = {b.name for b in bridges}
        assert len(bridges) >= 1

    def test_no_bridges_for_impossible_pair(self) -> None:
        registry = BridgeRegistry()
        bridges = registry.get_for_pair(Chain.ETHEREUM, Chain.POLYGON)
        assert bridges == []
