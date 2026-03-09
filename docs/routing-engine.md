# Routing Engine

Deep dive into the MNMX routing engine: how routes are discovered, evaluated,
executed, and recovered from failures.

## Path Discovery Algorithm

Path discovery transforms the problem of finding cross-chain routes into a
graph traversal. The graph is constructed as follows:

- **Nodes** are blockchain networks (Ethereum, Solana, Arbitrum, etc.).
- **Edges** exist between two chains if at least one registered bridge
  supports transfers between them.
- **Edge labels** are the set of bridge adapters that can service that pair.

### Graph Construction

```
buildGraph(registry, excludeBridges):
  for each adapter in registry:
    if adapter.name in excludeBridges: skip
    for each chain in adapter.supportedChains:
      for each other_chain in adapter.supportedChains:
        if chain != other_chain and adapter.supportsRoute(chain, other_chain):
          graph[chain][other_chain].append(adapter)
```

### DFS with Hop Limits

Path discovery uses depth-first search with:

- **Cycle detection** via a visited set. No chain appears twice in a path.
- **Hop limit** of `maxHops` (default 3). A path with N chains has N-1 hops.
- **Chain exclusion** via `excludeChains`. Excluded chains cannot be used
  as intermediates (but can be the destination).
- **Connectivity heuristic** for neighbor ordering. Chains connected to the
  destination are explored first, improving alpha-beta pruning effectiveness.

```
dfs(current, path, visited):
  if len(path) > maxHops + 1: return
  if current == destination:
    results.append(copy(path))
    return
  for next in sortByConnectivity(graph[current].keys(), destination):
    if next in visited: continue
    if next in excludeChains and next != destination: continue
    visited.add(next)
    path.append(next)
    dfs(next, path, visited)
    path.pop()
    visited.remove(next)
```

### Dominated Path Filtering

After discovery, paths that are strict supersets of shorter paths (same
start and end, same intermediate subsequence) are removed. This prevents
evaluating paths like `[ETH, ARB, ETH, SOL]` when `[ETH, SOL]` exists
and uses a subset of the same bridges.

## State Collection

For each chain-level path, the engine enumerates bridge combinations:

1. For each hop (pair of adjacent chains), find all available bridges.
2. Compute the cartesian product of bridges across hops. Limit to 4 bridges
   per hop to prevent combinatorial explosion.
3. For each combination, fetch quotes sequentially. The output amount of
   hop N becomes the input amount of hop N+1.
4. Discard combinations where any bridge fails to quote or liquidity is
   below the minimum threshold.

Token resolution for intermediate hops prefers:
- The same token as the source (e.g., USDC throughout).
- USDC as the universal fallback.
- Chain-specific token registries for accurate addresses and decimals.

## Worst-Case Modeling

The adversarial model applies multiplicative degradation to route properties:

| Parameter              | Default | Effect                                    |
|------------------------|---------|-------------------------------------------|
| `slippageMultiplier`   | 1.5     | Increases expected slippage by 50%        |
| `gasMultiplier`        | 1.3     | Increases gas/fee costs by 30%            |
| `bridgeDelayMultiplier`| 1.4     | Increases estimated time by 40%           |
| `mevExtraction`        | 0.005   | Assumes 0.5% of value extracted by MEV    |
| `priceMovement`        | 0.01    | Assumes 1% adverse price movement         |
| `failureProbability`   | 0.02    | 2% per-hop failure probability            |

The adversarial evaluation produces a "guaranteed minimum" output that is
always less than or equal to the expected output. The minimax score is
derived from this worst-case evaluation.

## Route Execution

Execution proceeds hop by hop:

```
for each hop in route.path:
  1. Validate the quote hasn't expired
  2. Call bridge.execute(quote, signer) to submit the transaction
  3. Poll bridge.getStatus(txHash) until completed or failed
  4. On completion, use the actual output as input for the next hop
  5. On failure, trigger recovery (see Failure Handling)
  6. Report progress via onProgress callback
```

Each hop has an independent timeout (`hopTimeout`, default 5 minutes).
Dry-run mode (`dryRun: true`) simulates execution without submitting
transactions.

## Failure Handling

Cross-chain routes can fail at any hop. The engine handles failures as follows:

### Pre-execution failures

- **No route found**: Return `bestRoute: null` with empty stats.
- **Quote expired**: Reject the execution with an error. The caller should
  re-query for fresh quotes.
- **Insufficient liquidity**: Filtered during state collection. Routes with
  liquidity below `minLiquidity` are not considered.

### Mid-execution failures

- **Bridge timeout**: If `getStatus` does not return `completed` within
  `hopTimeout`, the execution reports `failed` status. Funds may be stuck
  on the intermediate chain.
- **Bridge rejection**: If `execute` throws, the execution stops and reports
  the error. Previous hops may have already completed.

### Recovery

Recovery from mid-execution failures is the caller's responsibility. The
`ExecutionResult` includes:
- `hopTxHashes`: Transaction hashes for each completed hop, enabling manual
  recovery via bridge UIs.
- `error`: Human-readable description of the failure.
- `status`: `'failed'` to distinguish from successful completions.

## Performance Characteristics

### Time complexity

- Path discovery: O(C^H) where C is the number of chains and H is `maxHops`.
  With 8 chains and 3 hops, this is at most 512 paths (typically much fewer
  due to sparse connectivity).
- Candidate building: O(P * B^H) where P is the number of chain paths and
  B is the maximum bridges per hop (capped at 4). Each candidate requires
  H sequential quote fetches.
- Minimax search: O(N * log N) for N candidates with alpha-beta pruning
  (sorting + linear scan with cutoffs).

### Space complexity

- O(P * B^H) for candidate storage. Dominated paths are filtered before
  candidate building.

### Latency budget

Typical breakdown for a 3-hop route with 2 bridges:

| Phase                  | Time     |
|------------------------|----------|
| Path discovery         | <1 ms    |
| Dominated path filter  | <1 ms    |
| Quote fetching (6 quotes)| 100-500 ms |
| Minimax search         | <5 ms    |
| **Total**              | **~500 ms** |

Quote fetching dominates latency. The engine fetches quotes concurrently
across bridge combinations where possible.
