use crate::math;
use crate::types::*;

/// Known MEV bot address prefixes on Solana.
/// These are patterns commonly seen in MEV bot program addresses.
const KNOWN_MEV_PREFIXES: &[&str] = &[
    "JUP",    // Jupiter aggregator bots
    "MEV",    // Generic MEV label
    "ARB",    // Arbitrage bots
    "SAND",   // Sandwich bots
    "FL4SH",  // Flash loan bots
    "B0T",    // Common bot naming
    "SNIP3R", // Sniper bots
    "jito",   // Jito MEV
    "BLXR",   // bloXroute relayers
];

/// Minimum trade size (as fraction of pool reserve) to consider MEV-worthy.
const MIN_MEV_FRACTION: f64 = 0.001;

/// Detects potential MEV threats for a given action by analyzing the
/// mempool, pool states, and known bot patterns.
#[derive(Debug, Clone)]
pub struct MevDetector {
    /// Sensitivity multiplier. Higher = more conservative (flags more threats).
    sensitivity: f64,
    /// Minimum probability threshold to report a threat.
    min_probability: f64,
}

impl MevDetector {
    pub fn new() -> Self {
        Self {
            sensitivity: 1.0,
            min_probability: 0.05,
        }
    }

    /// Create a detector with custom sensitivity.
    pub fn with_sensitivity(sensitivity: f64) -> Self {
        Self {
            sensitivity: math::clamp_f64(sensitivity, 0.1, 10.0),
            min_probability: 0.05,
        }
    }

    /// Analyze all MEV threat vectors for a given action.
    pub fn detect_threats(
        &self,
        action: &ExecutionAction,
        state: &OnChainState,
    ) -> Vec<MevThreat> {
        let mut threats = Vec::new();

        // Only pool-interactive actions are MEV targets
        match action.kind {
            ActionKind::Swap | ActionKind::AddLiquidity | ActionKind::RemoveLiquidity => {}
            _ => return threats,
        }

        let pools = &state.pool_states;
        let pending = &state.pending_transactions;

        if let Some(threat) = self.analyze_sandwich_risk(action, pending, pools) {
            if threat.probability >= self.min_probability {
                threats.push(threat);
            }
        }

        if let Some(threat) = self.analyze_frontrun_risk(action, pending) {
            if threat.probability >= self.min_probability {
                threats.push(threat);
            }
        }

        if let Some(threat) = self.analyze_backrun_risk(action, pending) {
            if threat.probability >= self.min_probability {
                threats.push(threat);
            }
        }

        if let Some(pool) = pools.iter().find(|p| p.address == action.pool_address) {
            if let Some(threat) = self.analyze_jit_risk(action, pool) {
                if threat.probability >= self.min_probability {
                    threats.push(threat);
                }
            }
        }

        threats
    }

    /// Analyze sandwich attack risk.
    ///
    /// A sandwich attack occurs when an attacker:
    /// 1. Front-runs the victim's swap to move the price
    /// 2. The victim's swap executes at a worse price
    /// 3. The attacker back-runs to capture the price difference
    ///
    /// Risk factors:
    /// - Large trade relative to pool reserves
    /// - Known MEV bots in the mempool
    /// - High pending transaction volume on the same pool
    pub fn analyze_sandwich_risk(
        &self,
        action: &ExecutionAction,
        pending_txs: &[PendingTx],
        pools: &[PoolState],
    ) -> Option<MevThreat> {
        if action.kind != ActionKind::Swap {
            return None;
        }

        let pool = pools.iter().find(|p| p.address == action.pool_address)?;

        // Check if trade is large enough to sandwich
        let trade_fraction = action.amount as f64 / pool.reserve_a.max(1) as f64;
        if trade_fraction < MIN_MEV_FRACTION {
            return None;
        }

        // Signal 1: trade size relative to pool
        let size_signal = math::clamp_f64(trade_fraction * 20.0, 0.0, 1.0);

        // Signal 2: known MEV bots in pending txs for this pool
        let bot_txs: Vec<&PendingTx> = pending_txs
            .iter()
            .filter(|tx| tx.to == pool.address && Self::is_known_mev_bot(&tx.from))
            .collect();
        let bot_signal = math::clamp_f64(bot_txs.len() as f64 * 0.3, 0.0, 1.0);

        // Signal 3: pending transaction volume targeting same pool
        let pool_pending: Vec<&PendingTx> = pending_txs
            .iter()
            .filter(|tx| tx.to == pool.address)
            .collect();
        let volume_signal = if pool_pending.is_empty() {
            0.0
        } else {
            let total_pending_amount: u64 = pool_pending.iter().map(|tx| tx.amount).sum();
            math::clamp_f64(
                total_pending_amount as f64 / pool.reserve_a.max(1) as f64,
                0.0,
                1.0,
            )
        };

        // Signal 4: high-fee transactions (MEV bots pay more to get priority)
        let high_fee_txs = pool_pending
            .iter()
            .filter(|tx| tx.fee > action.priority_fee * 2)
            .count();
        let fee_signal = math::clamp_f64(high_fee_txs as f64 * 0.25, 0.0, 1.0);

        let signals = vec![size_signal, bot_signal, volume_signal, fee_signal];
        let probability = Self::calculate_probability(&signals) * self.sensitivity;
        let probability = math::clamp_f64(probability, 0.0, 0.99);

        let estimated_cost = Self::estimate_sandwich_cost(action.amount, pool);

        let source = bot_txs
            .first()
            .map(|tx| tx.from.clone())
            .unwrap_or_else(|| "unknown_sandwich_bot".to_string());

        Some(MevThreat::new(
            MevKind::Sandwich,
            probability,
            estimated_cost,
            &source,
            &pool.address,
        ))
    }

    /// Analyze front-running risk.
    ///
    /// Front-running occurs when a bot sees a pending profitable transaction
    /// and submits its own transaction with a higher fee to execute first.
    pub fn analyze_frontrun_risk(
        &self,
        action: &ExecutionAction,
        pending_txs: &[PendingTx],
    ) -> Option<MevThreat> {
        // Find pending txs targeting the same destination with higher fees
        let competing: Vec<&PendingTx> = pending_txs
            .iter()
            .filter(|tx| {
                tx.to == action.pool_address && tx.fee > action.priority_fee
            })
            .collect();

        if competing.is_empty() {
            return None;
        }

        // Signal 1: number of competing high-fee transactions
        let count_signal = math::clamp_f64(competing.len() as f64 * 0.2, 0.0, 1.0);
