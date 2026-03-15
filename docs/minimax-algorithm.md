# Search Algorithm

## The Multi-Hop Routing Problem

Cross-chain routing is a **constrained combinatorial search** problem. Given a source chain, destination chain, and token amount, the engine must find the best path through a graph of chains and bridges.

The graph is dense: 8 chains × 4 bridges × up to 3 hops = thousands of candidate paths. Each path has multiple dimensions to optimize (cost, speed, reliability, slippage, MEV risk), and these dimensions interact non-linearly across hops — the output of hop 1 is the input to hop 2, so fees and slippage compound.

The core challenge: **conditions at each hop are uncertain**. Bridge liquidity shifts, gas prices spike, and slippage varies. A route that looks optimal under current conditions may perform poorly when conditions change between quoting and execution.

## Worst-Case Optimization

Instead of ranking routes by expected outcome, MNMX applies an **adversarial model** at each hop independently and selects the route with the best guaranteed minimum.

This is structurally similar to minimax search in game theory: maximize the minimum outcome under adversarial conditions. The "adversary" isn't a literal opponent — it's a model of how market conditions can degrade between quote time and execution time.

### Why not expected value?

Expected value optimization averages over outcomes weighted by probability. This fails for cross-chain routing because:

- **Tail risks are correlated.** Bridge failures, MEV extraction, and gas spikes all worsen during high volatility — precisely when you need routing to be reliable.
- **Fat-tailed distributions.** A route with 98% chance of +2% and 2% chance of -50% has positive expected value but catastrophic tail risk.
- **Multi-hop compounding.** Uncertainty compounds across hops. A 2-hop route with 5% uncertainty per hop has ~10% total uncertainty, not 5%.

### Why not greedy selection?

A greedy algorithm picks the best bridge at each hop independently. This fails because:

- Hop 1's cheapest bridge may route through a chain where hop 2 has poor liquidity or no bridge to the destination.
- Local optimality does not guarantee global optimality when hops interact.

## Algorithm

### Search tree construction

The engine builds a tree where:
- **Root**: Source chain with input amount
- **Level 1**: All bridges from the source chain (direct paths)
- **Level 2**: All bridges from intermediate chains reached via Level 1 (2-hop paths)
- **Level 3**: All bridges from Level 2 chains to the destination (3-hop paths)
- **Leaves**: Destination chain with output amount after all hops

Each path from root to leaf is a candidate route.

### Adversarial evaluation

At each hop, the adversarial model applies worst-case multipliers:

```
hop_output = quoted_output * (1 - slippage * slippageMultiplier)
                           - gas_cost * gasMultiplier
                           - amount * mevExtraction
```

These multipliers model how conditions degrade between quote and execution:

| Parameter | Default | Models |
|-----------|---------|--------|
| `slippageMultiplier` | 2.0x | Liquidity drops, slippage doubles |
| `gasMultiplier` | 1.5x | Gas price surges 50% |
| `bridgeDelayMultiplier` | 3.0x | Bridge congestion, 3x slower |
| `mevExtraction` | 0.3% | Sandwich attack on destination |
| `priceMovement` | 0.5% | Price moves against you during transfer |

The adversarial score represents the guaranteed minimum output under these conditions.

### Alpha-beta pruning

With thousands of candidate paths, evaluating every leaf is wasteful. Alpha-beta pruning eliminates branches that cannot influence the result:

```
function search(candidates, inputAmount, weights, adversarialModel):
  alpha = -infinity   // best guaranteed score found so far
  routes = []

  // Sort by rough score descending for better pruning
  sortedCandidates = sortByQuickEstimate(candidates)

  for each candidate in sortedCandidates:
    // Quick upper-bound: face-value score without adversarial model
    upperBound = evaluate(candidate, inputAmount, weights)

    // Prune: if best possible score can't beat current alpha
    if upperBound <= alpha:
      nodesPruned++
      continue

    // Full adversarial evaluation (expensive)
    adversarialScore = evaluateAdversarial(
      candidate, inputAmount, weights, adversarialModel
    )

    alpha = max(alpha, adversarialScore)
    routes.append(buildRoute(candidate, adversarialScore))

  return sortByScore(routes)
```

**Key insight**: Sorting candidates by rough score before search means the first evaluated candidate likely has a high score, setting alpha high immediately. Subsequent weaker candidates are pruned without full evaluation.

In practice:
- Without pruning: evaluate all N candidates → O(N) full evaluations
- With pruning: ~30-50% of candidates pruned → significant speedup for large candidate sets

### Transposition table

Multi-hop routes often share intermediate states. For example, both "ETH→Arbitrum→Solana" and "ETH→Arbitrum→Base→Solana" share the "ETH→Arbitrum" hop. The transposition table caches hop evaluations by a hash of (bridge, fromChain, toChain, amount), avoiding redundant computation.

## Scoring Function

Routes are scored on five normalized dimensions, each mapped to [0, 1]:

### 1. Fees (default weight: 0.25)

```
feeRatio = totalFees / inputAmount
feeScore = clamp(1 - feeRatio / MAX_FEE_RATIO, 0, 1)
```

`MAX_FEE_RATIO = 0.10` (10%). A route costing 5% in total fees scores 0.5.

### 2. Slippage (weight: 0.25)

```
slippageScore = clamp(1 - totalSlippageBps / MAX_SLIPPAGE_BPS, 0, 1)
```

`MAX_SLIPPAGE_BPS = 200` (2%). 100 bps of slippage scores 0.5.

### 3. Speed (weight: 0.15)

```
speedScore = clamp(1 - estimatedTimeSeconds / MAX_TIME_SECONDS, 0, 1)
```

`MAX_TIME_SECONDS = 1800` (30 min). A 15-minute route scores 0.5.

### 4. Reliability (weight: 0.20)

```
reliabilityScore = product(perHopSuccessRates)
```

Per-hop success rates are derived from bridge health data and liquidity depth relative to transfer amount. A 2-hop route with 0.98 per-hop reliability scores 0.96.

### 5. MEV Exposure (weight: 0.15)

```
mevAmount = sum(hopAmount * timeInHours * chainMevFactor * 0.001)
mevScore = clamp(1 - mevRatio / MAX_MEV_RATIO, 0, 1)
```

`MAX_MEV_RATIO = 0.05` (5%). Chain MEV factors: Ethereum = 1.0, Arbitrum = 0.5, Solana = 0.4, Base = 0.3.

### Composite score

```
score = fees * w_fees + slippage * w_slippage + speed * w_speed
      + reliability * w_reliability + mev * w_mev
```

Weights vary by strategy profile:

| Strategy | Fees | Slippage | Speed | Reliability | MEV |
|----------|------|----------|-------|-------------|-----|
| minimax  | 0.25 | 0.25     | 0.15  | 0.20        | 0.15|
| cheapest | 0.45 | 0.30     | 0.05  | 0.10        | 0.10|
| fastest  | 0.10 | 0.15     | 0.50  | 0.15        | 0.10|
| safest   | 0.10 | 0.15     | 0.10  | 0.40        | 0.25|

## Worked Example

Transfer 1,000 USDC from Ethereum to Solana. Two candidate routes:

### Route A: Ethereum → Solana via Wormhole (direct)

| Dimension   | Raw value        | Normalized | Weight | Weighted |
|-------------|------------------|------------|--------|----------|
| Fees        | $5.50 (0.55%)    | 0.945      | 0.25   | 0.236    |
| Slippage    | 2 bps            | 0.990      | 0.25   | 0.248    |
| Speed       | 960s             | 0.467      | 0.15   | 0.070    |
| Reliability | 0.98             | 0.980      | 0.20   | 0.196    |
| MEV         | $0.15            | 0.997      | 0.15   | 0.150    |
| **Total**   |                  |            |        | **0.899**|

Under adversarial model:
- Slippage: 2 bps × 2.0 = 4 bps
- Gas: +50% surge
- MEV: +0.3% extraction

Adversarial composite: **0.845**

### Route B: Ethereum → Arbitrum → Solana (deBridge + Wormhole)

| Dimension   | Raw value        | Normalized | Weight | Weighted |
|-------------|------------------|------------|--------|----------|
| Fees        | $9.20 (0.92%)    | 0.908      | 0.25   | 0.227    |
| Slippage    | 9 bps total      | 0.955      | 0.25   | 0.239    |
| Speed       | 1200s total      | 0.333      | 0.15   | 0.050    |
| Reliability | 0.951            | 0.951      | 0.20   | 0.190    |
| MEV         | $0.22            | 0.996      | 0.15   | 0.149    |
| **Total**   |                  |            |        | **0.855**|

Adversarial composite: **0.802**

### Result

Route A wins: adversarial score 0.845 vs 0.802. The direct Wormhole path is preferred because the 2-hop route compounds fees, slippage, and reliability risk without sufficient benefit. The guaranteed minimum for Route A is ~$975 USDC after all adversarial adjustments.
