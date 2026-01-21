use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported blockchain networks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Chain {
    Ethereum,
    Solana,
    Arbitrum,
    Base,
    Polygon,
    BnbChain,
    Optimism,
    Avalanche,
}

impl Chain {
    pub fn all() -> &'static [Chain] {
        &[
            Chain::Ethereum,
            Chain::Solana,
            Chain::Arbitrum,
            Chain::Base,
            Chain::Polygon,
            Chain::BnbChain,
            Chain::Optimism,
            Chain::Avalanche,
        ]
    }

    pub fn chain_id(&self) -> u64 {
        match self {
            Chain::Ethereum => 1,
            Chain::Solana => 0,
            Chain::Arbitrum => 42161,
            Chain::Base => 8453,
            Chain::Polygon => 137,
            Chain::BnbChain => 56,
            Chain::Optimism => 10,
            Chain::Avalanche => 43114,
        }
    }

    pub fn is_evm(&self) -> bool {
        !matches!(self, Chain::Solana)
    }

    pub fn average_block_time_ms(&self) -> u64 {
        match self {
            Chain::Ethereum => 12_000,
            Chain::Solana => 400,
            Chain::Arbitrum => 250,
            Chain::Base => 2_000,
            Chain::Polygon => 2_000,
            Chain::BnbChain => 3_000,
            Chain::Optimism => 2_000,
            Chain::Avalanche => 2_000,
        }
    }

    pub fn typical_gas_price_gwei(&self) -> f64 {
        match self {
            Chain::Ethereum => 30.0,
            Chain::Solana => 0.000005,
            Chain::Arbitrum => 0.1,
            Chain::Base => 0.01,
            Chain::Polygon => 40.0,
            Chain::BnbChain => 3.0,
            Chain::Optimism => 0.01,
            Chain::Avalanche => 25.0,
        }
    }
}

impl fmt::Display for Chain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Chain::Ethereum => "Ethereum",
            Chain::Solana => "Solana",
            Chain::Arbitrum => "Arbitrum",
            Chain::Base => "Base",
            Chain::Polygon => "Polygon",
            Chain::BnbChain => "BNB Chain",
            Chain::Optimism => "Optimism",
            Chain::Avalanche => "Avalanche",
        };
        write!(f, "{}", name)
    }
}

/// A token on a specific chain.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Token {
    pub symbol: String,
    pub chain: Chain,
    pub decimals: u8,
    pub address: String,
}

