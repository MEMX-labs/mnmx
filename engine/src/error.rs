use thiserror::Error;

/// Errors that can occur during route discovery and execution.
#[derive(Error, Debug)]
pub enum MnmxError {
    #[error("no viable route found between {from} and {to}")]
    NoRouteFound { from: String, to: String },

    #[error("insufficient liquidity on bridge {bridge}: need {required}, available {available}")]
    InsufficientLiquidity {
        bridge: String,
        required: f64,
        available: f64,
    },

    #[error("route search timed out after {elapsed_ms}ms (limit: {timeout_ms}ms)")]
    SearchTimeout { elapsed_ms: u64, timeout_ms: u64 },

    #[error("bridge {bridge} is currently offline or degraded")]
    BridgeUnavailable { bridge: String },

    #[error("invalid configuration: {reason}")]
    InvalidConfig { reason: String },

    #[error("scoring weights must sum to 1.0, got {sum}")]
    InvalidWeights { sum: f64 },

    #[error("chain {chain} is not supported")]
    UnsupportedChain { chain: String },

    #[error("execution failed at hop {hop}: {reason}")]
    ExecutionFailed { hop: usize, reason: String },
}

pub type Result<T> = std::result::Result<T, MnmxError>;
