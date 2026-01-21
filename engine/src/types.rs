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
