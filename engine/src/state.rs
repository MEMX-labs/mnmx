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
    }

    /// Get the USD price for a token (by symbol).
    pub fn get_token_price(&self, token: &Token) -> f64 {
        let key = format!("{}_{}", token.symbol, token.chain);
        self.state
            .token_prices
            .get(&key)
            .or_else(|| self.state.token_prices.get(&token.symbol))
            .copied()
            .unwrap_or_else(|| Self::default_token_price(&token.symbol))
    }

    /// Get gas price for a chain in gwei.
    pub fn get_gas_price(&self, chain: Chain) -> f64 {
        self.state
            .gas_prices
            .get(&chain)
            .copied()
            .unwrap_or_else(|| chain.typical_gas_price_gwei())
    }

    /// Get available liquidity for a bridge.
    pub fn get_bridge_liquidity(&self, bridge_name: &str) -> f64 {
        self.state
            .bridge_states
            .get(bridge_name)
            .map(|bs| bs.liquidity_available)
            .unwrap_or(1_000_000.0)
    }

    /// Estimate slippage for a given trade amount against available liquidity.
    /// Uses a constant-product AMM model: slippage = amount / (liquidity + amount).
    pub fn estimate_slippage(&self, amount: f64, liquidity: f64) -> f64 {
        if liquidity <= 0.0 || amount <= 0.0 {
            return 0.0;
        }
        // Constant-product slippage model
        let k = liquidity * liquidity;
        let new_reserve = liquidity + amount;
        let output = liquidity - k / new_reserve;
        let ideal_output = amount; // For stablecoins, 1:1 is ideal
        if ideal_output <= 0.0 {
            return 0.0;
        }
        let slippage = 1.0 - output / ideal_output;
        if slippage < 0.0 { 0.0 } else { slippage }
    }

    /// Get congestion level for a chain.
    pub fn get_congestion(&self, chain: Chain) -> CongestionLevel {
        self.state
            .chain_states
            .get(&chain)
            .map(|cs| cs.congestion_level)
            .unwrap_or(CongestionLevel::Low)
    }

    // ------- Internal population methods -------

    fn populate_token_prices(&mut self) {
        let prices = vec![
            ("ETH", 3200.0),
            ("BTC", 62000.0),
            ("SOL", 145.0),
            ("MATIC", 0.72),
            ("POL", 0.72),
            ("BNB", 580.0),
            ("AVAX", 35.0),
            ("USDC", 1.0),
            ("USDT", 1.0),
            ("DAI", 1.0),
            ("WETH", 3200.0),
            ("WBTC", 62000.0),
            ("ARB", 1.15),
            ("OP", 2.40),
            ("LINK", 14.50),
            ("UNI", 7.80),
        ];
        for (symbol, price) in prices {
            self.state.token_prices.insert(symbol.to_string(), price);
        }
    }
