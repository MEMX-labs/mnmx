use std::collections::HashMap;

use sha2::{Digest, Sha256};

use crate::types::{Chain, RouteHop};

/// State for alpha-beta pruning during minimax search.
#[derive(Debug, Clone)]
pub struct PruningState {
    pub alpha: f64,
    pub beta: f64,
    pub killer_moves: Vec<Vec<MoveKey>>,
    pub history_table: HashMap<MoveKey, u64>,
    pub nodes_pruned: u64,
}

/// A compact representation of a move for the history/killer tables.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MoveKey {
    pub from_chain: u64,
    pub to_chain: u64,
    pub bridge_hash: u64,
}

impl MoveKey {
    pub fn from_hop(hop: &RouteHop) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(hop.bridge.as_bytes());
        let hash_bytes = hasher.finalize();
        let bridge_hash = u64::from_le_bytes(hash_bytes[0..8].try_into().unwrap_or([0; 8]));

        Self {
            from_chain: hop.from_chain.chain_id(),
            to_chain: hop.to_chain.chain_id(),
            bridge_hash,
        }
    }

    pub fn from_chains_and_bridge(from: Chain, to: Chain, bridge: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(bridge.as_bytes());
        let hash_bytes = hasher.finalize();
        let bridge_hash = u64::from_le_bytes(hash_bytes[0..8].try_into().unwrap_or([0; 8]));

        Self {
            from_chain: from.chain_id(),
            to_chain: to.chain_id(),
            bridge_hash,
        }
    }
}

impl PruningState {
    pub fn new(max_depth: usize) -> Self {
        let mut killer_moves = Vec::with_capacity(max_depth);
        for _ in 0..max_depth {
            killer_moves.push(Vec::with_capacity(2));
        }
        Self {
            alpha: f64::NEG_INFINITY,
            beta: f64::INFINITY,
            killer_moves,
            history_table: HashMap::new(),
            nodes_pruned: 0,
        }
    }

