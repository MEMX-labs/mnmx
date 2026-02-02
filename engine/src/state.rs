use crate::types::{Chain, CongestionLevel, Token};
use std::collections::HashMap;

/// State of a single blockchain.
#[derive(Debug, Clone)]
pub struct ChainState {
    pub chain: Chain,
    pub block_number: u64,
    pub gas_price: f64,
    pub congestion_level: CongestionLevel,
}

/// State of a single bridge.
#[derive(Debug, Clone)]
pub struct BridgeState {
    pub bridge: String,
    pub online: bool,
    pub liquidity_available: f64,
    pub pending_transactions: u32,
    pub average_confirmation_time: u64,
}

/// Aggregate market state across all chains.
#[derive(Debug, Clone)]
pub struct MarketState {
    pub token_prices: HashMap<String, f64>,
    pub gas_prices: HashMap<Chain, f64>,
    pub bridge_states: HashMap<String, BridgeState>,
    pub chain_states: HashMap<Chain, ChainState>,
}

impl MarketState {
    pub fn new() -> Self {
        Self {
            token_prices: HashMap::new(),
            gas_prices: HashMap::new(),
            bridge_states: HashMap::new(),
            chain_states: HashMap::new(),
        }
    }
}

impl Default for MarketState {
    fn default() -> Self {
        Self::new()
    }
}

/// Collects and maintains market state for routing decisions.
pub struct StateCollector {
    state: MarketState,
}

impl StateCollector {
    pub fn new() -> Self {
        Self {
            state: MarketState::new(),
        }
    }

    /// Build a complete market state snapshot. In production this would query
    /// RPC nodes and oracles; here we use deterministic simulated data.
    pub fn collect_state(&mut self) -> &MarketState {
        self.populate_token_prices();
        self.populate_gas_prices();
        self.populate_chain_states();
        self.populate_bridge_states();
        &self.state
