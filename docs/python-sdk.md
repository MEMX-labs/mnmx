# Python SDK

The `mnmx-sdk` Python package provides route discovery, simulation,
batch analysis, and a command-line interface for the MNMX protocol.

## Installation

```bash
pip install mnmx-sdk
```

For development:

```bash
cd sdk/python
pip install -e ".[dev]"
```

Requirements: Python 3.10+.

## Basic Usage

```python
from mnmx import MnmxRouter, Chain, Token, RouteRequest

router = MnmxRouter()

request = RouteRequest(
    from_chain=Chain.ETHEREUM,
    from_token=Token(symbol="USDC", chain=Chain.ETHEREUM, decimals=6, address="0x..."),
    to_chain=Chain.SOLANA,
    to_token=Token(symbol="USDC", chain=Chain.SOLANA, decimals=6, address="EPjFW..."),
    amount=1000.0,
    strategy="minimax",
    max_hops=3,
)

route = router.find_route(request)

print(f"Expected output: {route.expected_output:.2f} USDC")
print(f"Guaranteed minimum: {route.guaranteed_minimum:.2f} USDC")
print(f"Total fees: {route.total_fees:.2f} USDC")
print(f"Estimated time: {route.estimated_time}s")
print(f"Minimax score: {route.minimax_score:.4f}")
print(f"Hops: {len(route.hops)}")

for hop in route.hops:
    print(f"  {hop.from_chain} -> {hop.to_chain} via {hop.bridge}")
```

## Route Simulation

The `RouteSimulator` applies adversarial conditions to a route and reports
the expected range of outcomes.

```python
from mnmx import RouteSimulator, AdversarialModel

simulator = RouteSimulator()

# Default adversarial model
result = simulator.simulate(route)
print(f"Simulated output: {result.output:.2f} USDC")
print(f"Slippage applied: {result.slippage_bps} bps")
print(f"MEV extracted: {result.mev_extracted:.2f} USDC")

# Custom adversarial model (more pessimistic)
model = AdversarialModel(
    slippage_multiplier=2.0,
    gas_multiplier=1.5,
    bridge_delay_multiplier=2.0,
    mev_extraction=0.01,
    price_movement=0.02,
)
result = simulator.simulate(route, adversarial_model=model)
print(f"Pessimistic output: {result.output:.2f} USDC")
```

## Monte Carlo Analysis

Run thousands of simulations with randomized adversarial conditions to
build a distribution of outcomes.

```python
from mnmx import RouteSimulator

simulator = RouteSimulator()

mc_result = simulator.monte_carlo(
    route,
    num_simulations=10_000,
    seed=42,
)

print(f"Mean output: {mc_result.mean:.2f} USDC")
print(f"Median output: {mc_result.median:.2f} USDC")
print(f"Std deviation: {mc_result.std_dev:.2f} USDC")
print(f"5th percentile: {mc_result.percentile_5:.2f} USDC")
print(f"95th percentile: {mc_result.percentile_95:.2f} USDC")
print(f"Worst case: {mc_result.min:.2f} USDC")
print(f"Best case: {mc_result.max:.2f} USDC")
```

## Batch Analysis

Analyze multiple token pairs and amounts simultaneously.

```python
from mnmx import BatchAnalyzer, Chain

analyzer = BatchAnalyzer()

pairs = [
    (Chain.ETHEREUM, "USDC", Chain.SOLANA, "USDC"),
    (Chain.ETHEREUM, "USDC", Chain.ARBITRUM, "USDC"),
    (Chain.POLYGON, "USDC", Chain.ETHEREUM, "USDC"),
]

amounts = [100, 1_000, 10_000, 100_000]

results = analyzer.analyze(
    pairs=pairs,
    amounts=amounts,
    strategies=["minimax", "cheapest", "fastest"],
)

for entry in results:
    print(
        f"{entry.from_chain}->{entry.to_chain} "
        f"${entry.amount:,.0f} "
        f"[{entry.strategy}] "
        f"score={entry.score:.4f} "
        f"fee={entry.fee_pct:.2f}% "
        f"time={entry.time}s"
    )
```

## CLI Usage

The `mnmx` CLI provides quick access to route discovery from the terminal.

### Find a route

```bash
mnmx route \
  --from ethereum:USDC \
  --to solana:USDC \
  --amount 1000 \
  --strategy minimax
```

### Compare strategies

```bash
mnmx compare \
  --from ethereum:USDC \
  --to arbitrum:USDC \
  --amount 5000
```

### Run Monte Carlo

```bash
mnmx simulate \
  --from ethereum:USDC \
  --to solana:USDC \
  --amount 1000 \
  --simulations 10000 \
  --seed 42
```

### Batch analysis

```bash
mnmx batch \
  --pairs ethereum:USDC->solana:USDC,ethereum:USDC->arbitrum:USDC \
  --amounts 100,1000,10000 \
  --output results.csv
```

## Error Handling

The SDK defines a typed exception hierarchy:

```python
from mnmx.exceptions import (
    MnmxError,               # Base exception
    NoRouteFoundError,        # No viable route exists
    InsufficientLiquidityError,  # Bridge lacks liquidity
    SimulationError,          # Simulation failed
    RouteTimeoutError,        # Route discovery timed out
    InvalidConfigError,       # Invalid configuration
    BridgeError,              # Bridge operation failed
)

try:
    route = router.find_route(request)
except NoRouteFoundError as e:
    print(f"No route: {e}")
    print(f"Details: {e.details}")
except RouteTimeoutError as e:
    print(f"Timeout: {e}")
except MnmxError as e:
    print(f"Error: {e}")
```

All exceptions inherit from `MnmxError` and include a `details` dict with
structured error context (chain names, amounts, bridge names, etc.).
