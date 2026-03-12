use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Which side of the game tree we are evaluating.
/// Agent = the autonomous on-chain agent (maximizing player).
/// Adversary = MEV bots / extractors (minimizing player).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Player {
    Agent,
    Adversary,
}

impl Player {
    pub fn opponent(&self) -> Player {
        match self {
            Player::Agent => Player::Adversary,
            Player::Adversary => Player::Agent,
        }
    }
}

/// The kind of on-chain action that can be taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ActionKind {
    Swap,
    Transfer,
    Stake,
    Unstake,
    Liquidate,
    AddLiquidity,
    RemoveLiquidity,
}

impl ActionKind {
    /// Returns a deterministic ordering index used by move ordering heuristics.
    pub fn priority_index(&self) -> u32 {
        match self {
            ActionKind::Liquidate => 0,
            ActionKind::Swap => 1,
            ActionKind::RemoveLiquidity => 2,
            ActionKind::AddLiquidity => 3,
            ActionKind::Transfer => 4,
            ActionKind::Unstake => 5,
            ActionKind::Stake => 6,
        }
    }

    /// Returns a human-readable label for logging.
    pub fn label(&self) -> &'static str {
        match self {
            ActionKind::Swap => "swap",
            ActionKind::Transfer => "transfer",
            ActionKind::Stake => "stake",
            ActionKind::Unstake => "unstake",
            ActionKind::Liquidate => "liquidate",
            ActionKind::AddLiquidity => "add_liq",
            ActionKind::RemoveLiquidity => "rem_liq",
        }
    }
}

/// A concrete on-chain action the agent can execute.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExecutionAction {
    pub kind: ActionKind,
    pub token_mint: String,
    pub amount: u64,
    pub destination: String,
    pub slippage_bps: u16,
    pub pool_address: String,
    pub priority_fee: u64,
}

impl ExecutionAction {
    pub fn new(
        kind: ActionKind,
        token_mint: &str,
        amount: u64,
        destination: &str,
        slippage_bps: u16,
        pool_address: &str,
        priority_fee: u64,
    ) -> Self {
        Self {
            kind,
            token_mint: token_mint.to_string(),
            amount,
            destination: destination.to_string(),
            slippage_bps,
            pool_address: pool_address.to_string(),
            priority_fee,
        }
    }

    /// Produce a compact key for hashing / history tables.
    pub fn action_key(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.kind.label(),
            self.token_mint,
            self.amount,
            self.pool_address
        )
    }

    /// Estimated total cost in lamports (priority fee + base fee estimate).
    pub fn estimated_total_fee(&self) -> u64 {
        self.priority_fee.saturating_add(5000)
    }
}

/// A single node in the game tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameNode {
    pub action: Option<ExecutionAction>,
    pub state_hash: String,
    pub children: Vec<GameNode>,
    pub score: f64,
    pub depth: u32,
    pub is_terminal: bool,
    pub player: Player,
}

impl GameNode {
    pub fn new_root(state_hash: String) -> Self {
        Self {
            action: None,
            state_hash,
            children: Vec::new(),
            score: 0.0,
            depth: 0,
            is_terminal: false,
            player: Player::Agent,
        }
    }

    pub fn new_child(
        action: ExecutionAction,
        state_hash: String,
        depth: u32,
        player: Player,
    ) -> Self {
        Self {
            action: Some(action),
            state_hash,
            children: Vec::new(),
            score: 0.0,
            depth,
            is_terminal: false,
            player,
        }
    }

    /// Total number of nodes in this subtree, including self.
    pub fn subtree_size(&self) -> usize {
        1 + self.children.iter().map(|c| c.subtree_size()).sum::<usize>()
    }

    /// Maximum depth found in this subtree.
    pub fn max_depth(&self) -> u32 {
        if self.children.is_empty() {
            self.depth
        } else {
            self.children.iter().map(|c| c.max_depth()).max().unwrap_or(self.depth)
        }
    }
}

/// Current on-chain state snapshot used for evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnChainState {
    pub token_balances: HashMap<String, u64>,
    pub pool_states: Vec<PoolState>,
    pub pending_transactions: Vec<PendingTx>,
    pub slot: u64,
    pub block_time: i64,
}

impl OnChainState {
    pub fn new(slot: u64, block_time: i64) -> Self {
        Self {
            token_balances: HashMap::new(),
            pool_states: Vec::new(),
            pending_transactions: Vec::new(),
            slot,
            block_time,
        }
    }

    /// Total value of all token balances (simple sum of raw amounts).
    pub fn total_balance(&self) -> u64 {
        self.token_balances.values().sum()
    }

    /// Find a pool by its address.
    pub fn find_pool(&self, address: &str) -> Option<&PoolState> {
        self.pool_states.iter().find(|p| p.address == address)
    }

    /// Find a pool that contains a given token mint on either side.
    pub fn find_pool_for_mint(&self, mint: &str) -> Option<&PoolState> {
        self.pool_states
            .iter()
            .find(|p| p.token_a_mint == mint || p.token_b_mint == mint)
    }

    /// Number of pending transactions targeting a specific pool.
    pub fn pending_for_pool(&self, pool_address: &str) -> usize {
        self.pending_transactions
            .iter()
            .filter(|tx| tx.to == pool_address)
            .count()
    }
}

/// State of a single AMM liquidity pool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PoolState {
    pub address: String,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub fee_rate_bps: u16,
    pub token_a_mint: String,
    pub token_b_mint: String,
    pub liquidity: u128,
    pub sqrt_price: u128,
}

impl PoolState {
    pub fn new(
        address: &str,
        reserve_a: u64,
        reserve_b: u64,
        fee_rate_bps: u16,
        token_a_mint: &str,
        token_b_mint: &str,
    ) -> Self {
        let liquidity = (reserve_a as u128).saturating_mul(reserve_b as u128);
        let sqrt_price = if reserve_a > 0 {
            crate::math::isqrt(
                ((reserve_b as u128) << 64) / (reserve_a as u128),
            )
        } else {
            0
        };
        Self {
            address: address.to_string(),
            reserve_a,
            reserve_b,
            fee_rate_bps,
            token_a_mint: token_a_mint.to_string(),
            token_b_mint: token_b_mint.to_string(),
            liquidity,
            sqrt_price,
        }
    }

    /// Instantaneous price of token A denominated in token B.
    pub fn price_a_in_b(&self) -> f64 {
        if self.reserve_a == 0 {
            return 0.0;
        }
        self.reserve_b as f64 / self.reserve_a as f64
    }

    /// Total value locked (sum of both reserves).
    pub fn tvl(&self) -> u64 {
        self.reserve_a.saturating_add(self.reserve_b)
    }
}

/// A pending (unconfirmed) transaction observed in the mempool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PendingTx {
    pub signature: String,
    pub from: String,
    pub to: String,
    pub amount: u64,
    pub instruction_data: Vec<u8>,
    pub slot: u64,
    pub fee: u64,
}

impl PendingTx {
    pub fn new(
        signature: &str,
        from: &str,
        to: &str,
        amount: u64,
        slot: u64,
        fee: u64,
    ) -> Self {
        Self {
            signature: signature.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            amount,
            instruction_data: Vec::new(),
            slot,
            fee,
        }
    }

    /// Whether this transaction has a higher fee than another, indicating
    /// it may be trying to front-run.
    pub fn outbids(&self, other: &PendingTx) -> bool {
        self.fee > other.fee
    }
}

/// The result of evaluating a position/action pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationResult {
    pub score: f64,
    pub breakdown: EvalBreakdown,
    pub confidence: f64,
}

impl EvaluationResult {
    pub fn zero() -> Self {
        Self {
            score: 0.0,
            breakdown: EvalBreakdown::zero(),
            confidence: 0.0,
        }
    }
}

/// Detailed breakdown of an evaluation score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalBreakdown {
    pub gas_cost: f64,
    pub slippage_impact: f64,
    pub mev_exposure: f64,
    pub profit_potential: f64,
}

impl EvalBreakdown {
    pub fn zero() -> Self {
        Self {
            gas_cost: 0.0,
            slippage_impact: 0.0,
            mev_exposure: 0.0,
            profit_potential: 0.0,
        }
    }

    /// Sum of all component scores (unsigned for inspection).
    pub fn total_magnitude(&self) -> f64 {
        self.gas_cost.abs()
            + self.slippage_impact.abs()
            + self.mev_exposure.abs()
            + self.profit_potential.abs()
    }
}

/// Configuration for the minimax search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchConfig {
    pub max_depth: u32,
    pub alpha_beta_enabled: bool,
    pub time_limit_ms: u64,
    pub eval_weights: EvalWeights,
    pub transposition_enabled: bool,
    pub move_ordering_enabled: bool,
    /// Number of threads for parallel root-level search. 1 = sequential.
    pub num_threads: u32,
    /// Minimum branching factor before parallel search kicks in.
    pub parallel_threshold: u32,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            max_depth: 6,
            alpha_beta_enabled: true,
            time_limit_ms: 2000,
            eval_weights: EvalWeights::default(),
            transposition_enabled: true,
            move_ordering_enabled: true,
            num_threads: 1,
            parallel_threshold: 4,
        }
    }
}

impl SearchConfig {
    pub fn fast() -> Self {
        Self {
            max_depth: 3,
            time_limit_ms: 500,
            ..Self::default()
        }
    }

    pub fn deep() -> Self {
        Self {
            max_depth: 10,
            time_limit_ms: 10000,
            ..Self::default()
        }
    }
}

/// Weight multipliers for each evaluation component.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalWeights {
    pub gas: f64,
    pub slippage: f64,
    pub mev: f64,
    pub profit: f64,
}

impl Default for EvalWeights {
    fn default() -> Self {
        Self {
            gas: 1.0,
            slippage: 1.5,
            mev: 2.0,
            profit: 3.0,
        }
    }
}

impl EvalWeights {
    /// Combine an eval breakdown into a single weighted score.
    pub fn combine(&self, b: &EvalBreakdown) -> f64 {
        b.gas_cost * self.gas
            + b.slippage_impact * self.slippage
            + b.mev_exposure * self.mev
            + b.profit_potential * self.profit
    }
}

/// The final output of a search: an ordered plan of actions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub actions: Vec<ExecutionAction>,
    pub expected_score: f64,
    pub total_cost: u64,
    pub search_stats: SearchStats,
}

impl ExecutionPlan {
    pub fn empty(stats: SearchStats) -> Self {
        Self {
            actions: Vec::new(),
            expected_score: 0.0,
            total_cost: 0,
            search_stats: stats,
        }
    }
}

/// Summary statistics from a completed search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchStats {
    pub nodes_explored: u64,
    pub nodes_pruned: u64,
    pub max_depth_reached: u32,
    pub time_ms: u64,
    pub tt_hits: u64,
    pub tt_misses: u64,
    pub branching_factor: f64,
}

impl SearchStats {
    pub fn new() -> Self {
        Self {
            nodes_explored: 0,
            nodes_pruned: 0,
            max_depth_reached: 0,
            time_ms: 0,
            tt_hits: 0,
            tt_misses: 0,
            branching_factor: 0.0,
        }
    }
}

impl Default for SearchStats {
    fn default() -> Self {
        Self::new()
    }
}

/// A detected MEV threat against the agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MevThreat {
    pub kind: MevKind,
    pub probability: f64,
    pub estimated_cost: u64,
    pub source_address: String,
    pub affected_pool: String,
}

impl MevThreat {
    pub fn new(
        kind: MevKind,
        probability: f64,
        estimated_cost: u64,
        source_address: &str,
        affected_pool: &str,
    ) -> Self {
        Self {
            kind,
            probability,
            estimated_cost,
            source_address: source_address.to_string(),
            affected_pool: affected_pool.to_string(),
        }
    }

    /// Expected value of the threat (probability * cost).
    pub fn expected_value(&self) -> f64 {
        self.probability * self.estimated_cost as f64
    }
}

/// Kind of MEV attack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MevKind {
    Sandwich,
    Frontrun,
    Backrun,
    JitLiquidity,
}

impl MevKind {
    pub fn severity_multiplier(&self) -> f64 {
        match self {
            MevKind::Sandwich => 2.0,
            MevKind::Frontrun => 1.5,
            MevKind::Backrun => 0.8,
            MevKind::JitLiquidity => 1.2,
        }
    }
}

/// How time budget is allocated across the search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeAllocation {
    pub total_ms: u64,
    pub per_depth: Vec<u64>,
    pub emergency_stop_ms: u64,
}

impl TimeAllocation {
    pub fn new(total_ms: u64, max_depth: u32) -> Self {
        let mut per_depth = Vec::with_capacity(max_depth as usize);
        let mut remaining = total_ms;
        for d in 0..max_depth {
            // Exponential allocation: deeper depths get more time.
            let fraction = 1u64 << d;
            let total_fractions: u64 = (0..max_depth).map(|i| 1u64 << i).sum();
            let alloc = if total_fractions > 0 {
                (remaining as u128 * fraction as u128 / total_fractions as u128) as u64
            } else {
                remaining
            };
            per_depth.push(alloc);
        }
        // Remaining time after allocation serves as emergency buffer.
        let allocated: u64 = per_depth.iter().sum();
        remaining = total_ms.saturating_sub(allocated);
        let emergency_stop_ms = total_ms.saturating_sub(remaining / 2);
        Self {
            total_ms,
            per_depth,
            emergency_stop_ms,
        }
    }

    /// How much time is left for a given depth.
    pub fn time_for_depth(&self, depth: u32) -> u64 {
        self.per_depth
            .get(depth as usize)
            .copied()
            .unwrap_or(0)
    }
}

/// Flag indicating the type of bound stored in a transposition table entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TranspositionFlag {
    Exact,
    LowerBound,
    UpperBound,
}

/// A single entry in the transposition table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranspositionEntry {
    pub hash: String,
    pub depth: u32,
    pub score: f64,
    pub flag: TranspositionFlag,
    pub best_action: Option<ExecutionAction>,
    pub age: u64,
}

impl TranspositionEntry {
    pub fn new(
        hash: String,
        depth: u32,
        score: f64,
        flag: TranspositionFlag,
        best_action: Option<ExecutionAction>,
        age: u64,
    ) -> Self {
        Self {
            hash,
            depth,
            score,
            flag,
            best_action,
            age,
        }
    }
}
