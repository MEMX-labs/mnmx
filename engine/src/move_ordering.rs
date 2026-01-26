use std::collections::HashMap;

use crate::types::*;

/// Maximum search depth for killer move storage.
const MAX_DEPTH: usize = 64;

/// Number of killer move slots per depth.
const KILLER_SLOTS: usize = 2;

/// Orders moves to improve alpha-beta pruning efficiency.
///
/// Uses three heuristics:
/// 1. **MVV-LVA** (Most Valuable Victim - Least Valuable Attacker):
///    Prioritizes actions that interact with high-value targets.
/// 2. **Killer moves**: Remembers moves that caused beta cutoffs at the
///    same depth in sibling nodes.
/// 3. **History heuristic**: Tracks cumulative success of each move
///    across the entire search.
#[derive(Debug, Clone)]
pub struct MoveOrderer {
    /// Killer move slots: [depth][slot] -> action key.
    killer_moves: Vec<[Option<String>; KILLER_SLOTS]>,
    /// History table: action_key -> cumulative depth^2 bonus.
    history_table: HashMap<String, f64>,
    /// Counter for total ordering calls (diagnostic).
    ordering_calls: u64,
}

impl MoveOrderer {
    pub fn new() -> Self {
        Self {
            killer_moves: vec![[None, None]; MAX_DEPTH],
            history_table: HashMap::new(),
            ordering_calls: 0,
        }
    }

    /// Sort `actions` in-place so the most promising moves come first.
    ///
    /// The scoring combines MVV-LVA, killer bonuses, and history scores,
    /// then sorts descending.
    pub fn order_moves(
        &self,
        actions: &mut [ExecutionAction],
        state: &OnChainState,
        depth: u32,
    ) {
        if actions.len() <= 1 {
            return;
        }

        // Compute a score for each action and sort by it descending.
        let mut scored: Vec<(usize, f64)> = actions
            .iter()
            .enumerate()
            .map(|(i, action)| {
                let mvv = self.mvv_lva_score(action, state);
                let killer = self.killer_bonus(action, depth);
                let history = self.history_score(action);
                (i, mvv + killer + history)
            })
            .collect();

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
