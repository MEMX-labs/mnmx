# Minimax Algorithm

## Chess-Routing Structural Isomorphism

Cross-chain routing and chess share a common structure:

| Chess                     | Cross-chain routing                        |
|---------------------------|--------------------------------------------|
| Board position            | Current token holdings on a chain          |
| Legal moves               | Available bridges from the current chain   |
| Opponent's response       | Adversarial conditions (slippage, MEV)     |
| Game tree                 | All possible route combinations            |
| Evaluation function       | 5-dimensional route scoring                |
| Minimax value             | Best guaranteed minimum outcome            |
| Alpha-beta pruning        | Skip routes that can't beat the current best|

The key insight: in chess, you assume the opponent plays optimally against you.
In routing, you assume the market acts adversarially (slippage spikes, MEV
extracts value, gas surges, bridges slow down). Minimax finds the route where
even the worst-case outcome is best.

## Why Minimax (Not Greedy or Expected Value)

### Greedy selection

A greedy algorithm picks the cheapest/fastest bridge at each hop independently.
This fails because:
- Hop 1's cheapest bridge may route through a chain where hop 2 has no good
  options.
- Local optimality does not guarantee global optimality in multi-hop routes.

### Expected value optimization

Expected value averages over outcomes weighted by probability. This fails
because:
- Tail risks in DeFi are fat-tailed, not normally distributed.
- Bridge failures, MEV, and gas spikes are correlated (they all worsen during
  high volatility).
- A route with 98% chance of +2% and 2% chance of -50% has positive expected
  value but catastrophic tail risk.

### Minimax

Minimax asks: "What is the best outcome I can guarantee, assuming the worst
case at every step?" This is the right question for users who care about
the minimum amount they will receive.

## Algorithm Walkthrough

### Basic minimax

```
function minimax(candidates, inputAmount, options):
  bestScore = -infinity
  bestRoute = null

  for each candidate in candidates:
    // Maximizer: evaluate at face value
    baseScore = evaluate(candidate, inputAmount, weights)

    // Minimizer: apply adversarial model
    adversarialScore = evaluateAdversarial(
      candidate, inputAmount, weights, adversarialModel
    )

    // Minimax score = guaranteed minimum
    minimaxScore = adversarialScore

    if minimaxScore > bestScore:
      bestScore = minimaxScore
      bestRoute = buildRoute(candidate, minimaxScore)

  return bestRoute
```

### With alpha-beta pruning

```
function minimaxWithPruning(candidates, inputAmount, options):
  alpha = -infinity   // best guaranteed score found so far
  routes = []

  // Sort candidates by rough score descending (better pruning)
  sortedCandidates = sortByRoughScore(candidates)

  for each candidate in sortedCandidates:
    // Quick upper-bound estimate (face-value evaluation)
    upperBound = evaluate(candidate, inputAmount, weights)

    // Prune: if best possible score can't beat alpha
    if upperBound <= alpha:
      nodesPruned++
      continue

    // Full adversarial evaluation
    adversarialScore = evaluateAdversarial(
      candidate, inputAmount, weights, adversarialModel
    )

    alpha = max(alpha, adversarialScore)
    routes.append(buildRoute(candidate, adversarialScore))

  return sortByScore(routes)
```

## Alpha-Beta Pruning Explanation

Alpha-beta pruning eliminates branches of the search tree that cannot
influence the final result.

**Alpha** tracks the best score the maximizer (user) can guarantee so far.
When evaluating a new candidate:

1. Compute an **upper bound** (face-value score without adversarial model).
2. If the upper bound is less than or equal to alpha, the candidate cannot
   possibly beat the current best even in the best case. Skip it.
3. Otherwise, compute the full adversarial score and update alpha if better.

### Pruning effectiveness

Sorting candidates by rough score before search maximizes pruning. If the
first candidate evaluated has a high score, alpha starts high and subsequent
weaker candidates are pruned immediately.

In practice, with N candidates sorted by rough score:
- Without pruning: 3N nodes explored (base + adversarial per candidate).
- With pruning: ~N + 2K nodes, where K is the number of candidates that
  survive pruning. Typically K << N.

## Scoring Function

Routes are scored on five normalized dimensions, each mapped to [0, 1]:

### 1. Fees (weight: 0.30 for minimax)

```
feeRatio = totalFees / inputAmount
feeScore = clamp(1 - feeRatio / MAX_FEE_RATIO, 0, 1)
```

where `MAX_FEE_RATIO = 0.10` (10%). A route costing 5% in fees scores 0.5.

### 2. Slippage (weight: 0.25)

```
slippageScore = clamp(1 - totalSlippageBps / MAX_SLIPPAGE_BPS, 0, 1)
```

where `MAX_SLIPPAGE_BPS = 200` (2%). 100 bps of slippage scores 0.5.

### 3. Speed (weight: 0.15)

```
speedScore = clamp(1 - estimatedTimeSeconds / MAX_TIME_SECONDS, 0, 1)
```

where `MAX_TIME_SECONDS = 1800` (30 min). A 15-minute route scores 0.5.

### 4. Reliability (weight: 0.20)

```
reliabilityScore = product(perHopSuccessRates)
```

Per-hop rates are estimated from liquidity depth relative to transfer
amount. A 2-hop route with 0.98 per-hop reliability scores 0.96.

### 5. MEV Exposure (weight: 0.10)

```
mevAmount = sum(hopAmount * timeInHours * chainMevFactor * 0.001)
mevScore = clamp(1 - mevRatio / MAX_MEV_RATIO, 0, 1)
```

where `MAX_MEV_RATIO = 0.05` (5%). Chain MEV factors range from 0.3
(Base, Avalanche) to 1.0 (Ethereum mainnet).

### Composite score

```
score = fees * w_fees + slippage * w_slippage + speed * w_speed
      + reliability * w_reliability + mev * w_mev
```

## Strategy Profiles

| Strategy | Fees | Slippage | Speed | Reliability | MEV  |
|----------|------|----------|-------|-------------|------|
| minimax  | 0.30 | 0.25     | 0.15  | 0.20        | 0.10 |
| cheapest | 0.60 | 0.15     | 0.05  | 0.15        | 0.05 |
| fastest  | 0.10 | 0.10     | 0.55  | 0.15        | 0.10 |
| safest   | 0.10 | 0.15     | 0.05  | 0.50        | 0.20 |

All rows sum to 1.0.

## Concrete Numeric Example

Transfer 1000 USDC from Ethereum to Solana. Two candidate routes:

### Route A: Ethereum -> Solana via Wormhole (direct)

| Dimension   | Raw value        | Normalized | Weight | Weighted |
|-------------|------------------|------------|--------|----------|
| Fees        | $5.50 (0.55%)    | 0.945      | 0.30   | 0.284    |
| Slippage    | 2 bps            | 0.990      | 0.25   | 0.248    |
| Speed       | 960s             | 0.467      | 0.15   | 0.070    |
| Reliability | 0.98             | 0.980      | 0.20   | 0.196    |
| MEV         | $0.15            | 0.997      | 0.10   | 0.100    |
| **Total**   |                  |            |        | **0.897**|

Adversarial adjustment:
- Fees: $5.50 * 1.3 = $7.15 -> score 0.929
- Slippage: 2 * 1.5 = 3 bps -> score 0.985
- Speed: 960 * 1.4 = 1344s -> score 0.253
- Reliability: 0.98 * (1 - 0.02) = 0.960
- MEV: $0.15 + 1000 * 0.005 = $5.15 -> score 0.897

Adversarial composite: 0.929*0.30 + 0.985*0.25 + 0.253*0.15 + 0.960*0.20 + 0.897*0.10
= 0.279 + 0.246 + 0.038 + 0.192 + 0.090 = **0.845**

### Route B: Ethereum -> Arbitrum -> Solana via deBridge + Wormhole

| Dimension   | Raw value        | Normalized | Weight | Weighted |
|-------------|------------------|------------|--------|----------|
| Fees        | $9.20 (0.92%)    | 0.908      | 0.30   | 0.272    |
| Slippage    | 9 bps total      | 0.955      | 0.25   | 0.239    |
| Speed       | 1200s total      | 0.333      | 0.15   | 0.050    |
| Reliability | 0.98 * 0.97 = 0.951 | 0.951   | 0.20   | 0.190    |
| MEV         | $0.22            | 0.996      | 0.10   | 0.100    |
| **Total**   |                  |            |        | **0.851**|

Adversarial composite: **0.802**

### Result

Route A wins with adversarial score 0.845 vs Route B's 0.802. The direct
Wormhole path is preferred because the 2-hop route accumulates more fees,
slippage, and failure risk without sufficient upside to compensate.

The minimax guarantee for Route A is ~$975 USDC (after applying all
adversarial adjustments to the $994.50 expected output).
