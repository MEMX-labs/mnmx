use crate::math;
use crate::types::*;

/// Evaluates on-chain positions and actions, producing a score that the
/// minimax engine uses to compare game tree branches.
///
/// Higher scores are better for the Agent; lower scores favor the Adversary.
#[derive(Debug, Clone)]
pub struct PositionEvaluator {
    weights: EvalWeights,
}

impl PositionEvaluator {
    pub fn new(weights: EvalWeights) -> Self {
        Self { weights }
    }

    /// Produce a full evaluation of an action taken from the given state.
    pub fn evaluate(
        &self,
        state: &OnChainState,
        action: &ExecutionAction,
    ) -> EvaluationResult {
        let gas = Self::evaluate_gas_cost(action, state);
        let slippage = self.evaluate_slippage_for_action(action, state);
        let mev = Self::evaluate_mev_exposure(action, &state.pending_transactions);
        let profit = Self::evaluate_profit(action, state);
        let confidence = Self::calculate_confidence(state);

        let breakdown = EvalBreakdown {
            gas_cost: gas,
            slippage_impact: slippage,
            mev_exposure: mev,
            profit_potential: profit,
        };

        let score = self.weights.combine(&breakdown);

        EvaluationResult {
            score,
            breakdown,
            confidence,
        }
    }

    /// Evaluate the gas cost component. Returns a negative value (cost).
    ///
    /// Normalization: we divide the total fee by a baseline of 10_000 lamports
    /// so that a "normal" fee produces a value around -0.5 to -1.0.
    pub fn evaluate_gas_cost(action: &ExecutionAction, _state: &OnChainState) -> f64 {
        let total_fee = action.estimated_total_fee();
        // Baseline: 10_000 lamports = -1.0 score
        let normalized = total_fee as f64 / 10_000.0;
        -normalized
    }

    /// Evaluate slippage impact for a given action.
    fn evaluate_slippage_for_action(
        &self,
        action: &ExecutionAction,
        state: &OnChainState,
    ) -> f64 {
        match Self::find_pool_for_action(action, &state.pool_states) {
            Some(pool) => Self::evaluate_slippage(action, pool),
            None => -0.1, // Small penalty when pool is unknown
        }
    }

    /// Evaluate slippage from a specific pool. Returns a negative value.
    ///
    /// Only Swap, AddLiquidity, and RemoveLiquidity are pool-interactive;
    /// other action kinds incur zero slippage.
    pub fn evaluate_slippage(action: &ExecutionAction, pool: &PoolState) -> f64 {
        // Guard: zero reserves or zero amount produce no slippage
        if pool.reserve_a == 0 || pool.reserve_b == 0 || action.amount == 0 {
            return 0.0;
        }

        match action.kind {
            ActionKind::Swap => {
                let is_a_to_b = action.token_mint == pool.token_a_mint;
                let (reserve_in, reserve_out) = if is_a_to_b {
                    (pool.reserve_a, pool.reserve_b)
                } else {
                    (pool.reserve_b, pool.reserve_a)
                };

                // Clamp input to reserve size to prevent nonsensical slippage values
                let clamped_amount = action.amount.min(reserve_in);

                let slippage = math::calculate_slippage(
                    clamped_amount,
                    reserve_in,
                    reserve_out,
                    pool.fee_rate_bps,
                );

                // Bound: slippage score should not exceed -10.0 (100% slippage cap)
                let score = -(slippage * 100.0);
                score.max(-10.0)
            }
            ActionKind::AddLiquidity | ActionKind::RemoveLiquidity => {
                let impact = math::calculate_price_impact(
                    action.amount,
                    pool.reserve_a,
                    pool.reserve_b,
                );
                let score = -(impact * 50.0);
                score.max(-5.0) // Cap liquidity slippage penalty
            }
            _ => 0.0,
        }
    }

    /// Evaluate MEV exposure based on pending mempool transactions.
    ///
    /// Heuristic: count pending transactions that target the same pool,
    /// weight by their fee (high-fee txs are more likely MEV).
    pub fn evaluate_mev_exposure(
        action: &ExecutionAction,
        pending_txs: &[PendingTx],
    ) -> f64 {
        if pending_txs.is_empty() {
            return 0.0;
        }

        let pool = &action.pool_address;
        let competing: Vec<&PendingTx> = pending_txs
            .iter()
            .filter(|tx| tx.to == *pool)
            .collect();

        if competing.is_empty() {
            return 0.0;
        }

        // Each competing tx adds exposure proportional to its fee and amount
        let mut exposure = 0.0;
        for tx in &competing {
            let fee_signal = tx.fee as f64 / 10_000.0;
            let amount_signal = if action.amount > 0 {
                tx.amount as f64 / action.amount as f64
            } else {
                0.0
            };
            // Higher fees and larger amounts relative to ours => more risk
            exposure += fee_signal * (1.0 + amount_signal);
        }

        // Count of competing txs amplifies exposure
        let count_factor = 1.0 + (competing.len() as f64).ln();
        -exposure * count_factor
    }

    /// Evaluate the profit potential of an action.
    ///
    /// For swaps: estimates the output value minus input value.
    /// For other actions: heuristic based on action type.
    pub fn evaluate_profit(action: &ExecutionAction, state: &OnChainState) -> f64 {
        match action.kind {
            ActionKind::Swap => {
                Self::evaluate_swap_profit(action, state)
            }
            ActionKind::Liquidate => {
                // Liquidations are typically profitable; estimate based on amount
                let balance = state
                    .token_balances
                    .get(&action.token_mint)
                    .copied()
                    .unwrap_or(0);
                if action.amount > 0 && balance > 0 {
                    let profit_ratio = action.amount as f64 / balance as f64;
                    profit_ratio * 5.0 // Liquidations can be very profitable
                } else {
                    0.5 // Small positive signal for liquidation opportunities
                }
            }
            ActionKind::AddLiquidity => {
                // Fee income potential from providing liquidity
                if let Some(pool) = Self::find_pool_for_action(action, &state.pool_states) {
                    let pending_count = state.pending_for_pool(&pool.address);
                    let fee_income = math::bps_to_decimal(pool.fee_rate_bps)
                        * action.amount as f64
                        * (1.0 + pending_count as f64 * 0.1);
                    fee_income / 1_000_000.0
                } else {
                    0.0
                }
            }
            ActionKind::RemoveLiquidity => {
                // Recovering liquidity: small positive unless pool is dangerous
                0.2
            }
            ActionKind::Transfer => {
                // Transfers don't directly profit, but may enable other strategies
                0.0
            }
            ActionKind::Stake => {
                // Staking earns yield; estimate annualized yield / time
                0.3
            }
            ActionKind::Unstake => {
                // Unstaking is often done to redeploy capital
                0.1
            }
        }
    }

    /// Estimate swap profit by computing the output minus the cost.
    fn evaluate_swap_profit(action: &ExecutionAction, state: &OnChainState) -> f64 {
        let pool = match Self::find_pool_for_action(action, &state.pool_states) {
            Some(p) => p,
            None => return 0.0,
        };

        let is_a_to_b = action.token_mint == pool.token_a_mint;
        let (reserve_in, reserve_out) = if is_a_to_b {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };

        let output = Self::constant_product_output(
            action.amount,
            reserve_in,
            reserve_out,
            pool.fee_rate_bps,
        );

        // Profit = output value - input value
        // We normalize against the input amount.
        if action.amount == 0 {
            return 0.0;
        }
        let spot_price = reserve_out as f64 / reserve_in as f64;
        let expected_output = action.amount as f64 * spot_price;
        let actual_output = output as f64;

        // Ratio of actual to expected (1.0 = no slippage, <1.0 = loss)
        let efficiency = actual_output / expected_output.max(1.0);

        // If efficiency is close to 1.0, profit potential is good
        // Scale so that efficiency=1.0 -> score ~1.0
        (efficiency - 0.5) * 2.0
    }

    /// Calculate confidence in the evaluation based on state quality.
    ///
    /// Returns a value between 0.0 (no confidence) and 1.0 (full confidence).
    ///
    /// Factors:
    /// - Number of known pool states (more = better)
    /// - Freshness of block time
    /// - Pending tx count (more = more uncertainty)
    pub fn calculate_confidence(state: &OnChainState) -> f64 {
        let mut signals: Vec<(f64, f64)> = Vec::new();

        // Pool information quality
        let pool_score = if state.pool_states.is_empty() {
            0.2
        } else {
            let valid_pools = state
                .pool_states
                .iter()
                .filter(|p| p.reserve_a > 0 && p.reserve_b > 0)
                .count();
            math::clamp_f64(valid_pools as f64 / state.pool_states.len() as f64, 0.0, 1.0)
        };
        signals.push((pool_score, 2.0));

        // Mempool congestion (fewer pending txs = more confident)
        let congestion = state.pending_transactions.len() as f64;
        let congestion_score = 1.0 / (1.0 + congestion * 0.1);
        signals.push((congestion_score, 1.5));

        // Balance information (having balance info = more confident)
        let balance_score = if state.token_balances.is_empty() {
            0.3
        } else {
            0.9
        };
        signals.push((balance_score, 1.0));

        // Slot recency (higher slot = more recent data)
        let slot_score = if state.slot > 0 { 0.8 } else { 0.3 };
        signals.push((slot_score, 0.5));

        math::weighted_average(&signals)
    }

    /// Find the pool that matches an action's pool_address.
    pub fn find_pool_for_action<'a>(
        action: &ExecutionAction,
        pools: &'a [PoolState],
    ) -> Option<&'a PoolState> {
        pools.iter().find(|p| p.address == action.pool_address)
    }

    /// Wrapper around math::constant_product_swap for convenience.
    pub fn constant_product_output(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u16,
    ) -> u64 {
        math::constant_product_swap(amount_in, reserve_in, reserve_out, fee_bps)
    }

    /// Wrapper around math::calculate_price_impact for convenience.
    pub fn calculate_price_impact(amount: u64, reserve_a: u64, reserve_b: u64) -> f64 {
        math::calculate_price_impact(amount, reserve_a, reserve_b)
    }

    /// Evaluate a state without a specific action (static evaluation).
    /// Used for terminal nodes in the game tree.
    pub fn evaluate_static(&self, state: &OnChainState) -> f64 {
        let total_balance = state.total_balance() as f64;
        let pool_value: f64 = state
            .pool_states
            .iter()
            .map(|p| p.tvl() as f64 * 0.001) // Our share approximation
            .sum();
        let pending_risk: f64 = state
            .pending_transactions
            .iter()
            .map(|tx| tx.amount as f64 * 0.0001)
            .sum();

        let raw = (total_balance / 1_000_000.0) + pool_value - pending_risk;
        math::clamp_f64(raw, -100.0, 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn test_state() -> OnChainState {
        let mut balances = HashMap::new();
        balances.insert("TokenA".to_string(), 1_000_000);
        balances.insert("TokenB".to_string(), 2_000_000);

        OnChainState {
            token_balances: balances,
            pool_states: vec![PoolState::new(
                "pool1",
                1_000_000,
                2_000_000,
                30,
                "TokenA",
                "TokenB",
            )],
            pending_transactions: Vec::new(),
            slot: 100,
            block_time: 1700000000,
        }
    }

    fn test_swap_action() -> ExecutionAction {
        ExecutionAction::new(
            ActionKind::Swap,
            "TokenA",
            10_000,
            "wallet1",
            50,
            "pool1",
            5000,
        )
    }

    #[test]
    fn test_gas_cost_is_negative() {
        let state = test_state();
        let action = test_swap_action();
        let gas = PositionEvaluator::evaluate_gas_cost(&action, &state);
        assert!(gas < 0.0);
    }

    #[test]
    fn test_slippage_is_negative_for_swap() {
        let action = test_swap_action();
        let pool = &test_state().pool_states[0];
        let slip = PositionEvaluator::evaluate_slippage(&action, pool);
        assert!(slip < 0.0);
    }

    #[test]
    fn test_no_mev_exposure_empty_mempool() {
        let action = test_swap_action();
        let mev = PositionEvaluator::evaluate_mev_exposure(&action, &[]);
        assert_eq!(mev, 0.0);
    }

    #[test]
    fn test_confidence_range() {
        let state = test_state();
        let conf = PositionEvaluator::calculate_confidence(&state);
        assert!(conf >= 0.0 && conf <= 1.0, "confidence={}", conf);
    }

    #[test]
    fn test_evaluate_produces_result() {
        let evaluator = PositionEvaluator::new(EvalWeights::default());
        let state = test_state();
        let action = test_swap_action();
        let result = evaluator.evaluate(&state, &action);
        assert!(result.confidence > 0.0);
        // Score should be finite
        assert!(result.score.is_finite());
    }
}
