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

        // Reorder actions according to scored order.
        let ordered: Vec<ExecutionAction> = scored
            .iter()
            .map(|(idx, _)| actions[*idx].clone())
            .collect();

        for (i, action) in ordered.into_iter().enumerate() {
            actions[i] = action;
        }
    }

    /// Record a move as a killer at the given depth.
    ///
    /// Uses a two-slot replacement scheme: if the move is not already in
    /// slot 0, shift slot 0 to slot 1 and insert the new move in slot 0.
    pub fn update_killer(&mut self, depth: u32, action: &ExecutionAction) {
        let d = depth as usize;
        if d >= MAX_DEPTH {
            return;
        }

        let key = action.action_key();
        let slots = &mut self.killer_moves[d];

        // Don't add if already in slot 0
        if slots[0].as_ref() == Some(&key) {
            return;
        }

        // Shift slot 0 -> slot 1, insert new in slot 0
        slots[1] = slots[0].take();
        slots[0] = Some(key);
    }

    /// Record a successful move in the history table.
    ///
    /// Bonus = depth^2, so deeper cutoffs are weighted more heavily.
    pub fn update_history(&mut self, action: &ExecutionAction, depth: u32) {
        let key = action.action_key();
        let bonus = (depth as f64) * (depth as f64);
        let entry = self.history_table.entry(key).or_insert(0.0);
        *entry += bonus;

        // Age / cap the history to prevent overflow domination
        if *entry > 100_000.0 {
            // Scale all entries down
            for val in self.history_table.values_mut() {
                *val *= 0.5;
            }
        }
    }

    /// MVV-LVA heuristic: score an action based on the "value" of the
    /// target and the "cost" of the attacker.
    ///
    /// For on-chain actions:
    /// - High-value: Liquidations (capturing collateral), large swaps
    /// - Low-cost: Actions with low priority fees
    ///
    /// Returns a score in roughly [0, 100].
    pub fn mvv_lva_score(&self, action: &ExecutionAction, state: &OnChainState) -> f64 {
        let victim_value = self.estimate_victim_value(action, state);
        let attacker_cost = self.estimate_attacker_cost(action);
