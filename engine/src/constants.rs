/// Maximum number of intermediate hops allowed in a route.
pub const MAX_HOPS: usize = 5;

/// Default slippage tolerance in basis points.
pub const DEFAULT_SLIPPAGE_BPS: u64 = 50;

/// Maximum route search timeout in milliseconds.
pub const MAX_TIMEOUT_MS: u64 = 30_000;

/// Minimum bridge liquidity required for route consideration (USD).
pub const MIN_BRIDGE_LIQUIDITY: f64 = 10_000.0;

/// Maximum number of concurrent bridge quote requests.
pub const MAX_CONCURRENT_QUOTES: usize = 10;

/// Default adversarial slippage multiplier.
pub const DEFAULT_SLIPPAGE_MULTIPLIER: f64 = 2.0;

/// Default adversarial gas multiplier.
pub const DEFAULT_GAS_MULTIPLIER: f64 = 1.5;

/// Default bridge delay multiplier for worst-case estimation.
pub const DEFAULT_BRIDGE_DELAY_MULTIPLIER: f64 = 3.0;

/// Maximum acceptable MEV extraction rate.
pub const MAX_MEV_RATE: f64 = 0.01;

/// Score threshold below which routes are discarded.
pub const MIN_ROUTE_SCORE: f64 = 0.1;
