use crate::math;
use crate::types::{Route, RouteHop, ScoringWeights, Strategy};

/// Scores routes using weighted multi-objective evaluation.
pub struct RouteScorer {
    weights: ScoringWeights,
}

/// Component scores for a route or hop.
#[derive(Debug, Clone)]
pub struct ScoreBreakdown {
    pub fee_score: f64,
    pub slippage_score: f64,
    pub speed_score: f64,
    pub reliability_score: f64,
    pub mev_score: f64,
    pub composite: f64,
}

impl RouteScorer {
    pub fn new(weights: ScoringWeights) -> Self {
        Self { weights }
    }

    pub fn with_strategy(strategy: Strategy) -> Self {
        Self {
            weights: get_strategy_weights(strategy),
        }
    }

    /// Score a complete route, returning a value in [0, 1] where 1 is best.
    pub fn score_route(&self, route: &Route) -> f64 {
        if route.hops.is_empty() {
            return 0.0;
        }

        let fee_score = self.normalize_fee(route.total_fees, route.expected_output + route.total_fees);
        let slippage_score = self.compute_route_slippage_score(route);
        let speed_score = self.normalize_speed(route.estimated_time);
        let reliability_score = self.compute_route_reliability(route);
        let mev_score = self.normalize_mev(route);

        let composite = self.weights.fees * fee_score
            + self.weights.slippage * slippage_score
            + self.weights.speed * speed_score
            + self.weights.reliability * reliability_score
            + self.weights.mev_exposure * mev_score;

        math::clamp_f64(composite, 0.0, 1.0)
    }

    /// Score a complete route and return the breakdown.
    pub fn score_route_detailed(&self, route: &Route) -> ScoreBreakdown {
        if route.hops.is_empty() {
            return ScoreBreakdown {
                fee_score: 0.0,
                slippage_score: 0.0,
                speed_score: 0.0,
                reliability_score: 0.0,
                mev_score: 0.0,
                composite: 0.0,
            };
        }

        let fee_score = self.normalize_fee(route.total_fees, route.expected_output + route.total_fees);
        let slippage_score = self.compute_route_slippage_score(route);
        let speed_score = self.normalize_speed(route.estimated_time);
        let reliability_score = self.compute_route_reliability(route);
        let mev_score = self.normalize_mev(route);

        let composite = self.weights.fees * fee_score
            + self.weights.slippage * slippage_score
            + self.weights.speed * speed_score
            + self.weights.reliability * reliability_score
            + self.weights.mev_exposure * mev_score;

        ScoreBreakdown {
            fee_score,
            slippage_score,
            speed_score,
            reliability_score,
            mev_score,
            composite: math::clamp_f64(composite, 0.0, 1.0),
        }
    }

    /// Score a single hop.
    pub fn score_hop(&self, hop: &RouteHop) -> f64 {
        let fee_score = self.normalize_fee(hop.fee, hop.input_amount);
        let slippage_score = self.normalize_slippage(hop.slippage());
        let speed_score = self.normalize_speed(hop.estimated_time);
        // For a single hop, reliability is estimated from the bridge and chains
        let reliability_score = self.estimate_hop_reliability(hop);
        let mev_score = self.estimate_hop_mev(hop);

        let composite = self.weights.fees * fee_score
            + self.weights.slippage * slippage_score
            + self.weights.speed * speed_score
            + self.weights.reliability * reliability_score
            + self.weights.mev_exposure * mev_score;

        math::clamp_f64(composite, 0.0, 1.0)
    }

    /// Normalize fee to a score in [0, 1] where lower fees are better (higher score).
    /// fee_ratio = fee / total_value, mapped through an inverse curve.
    pub fn normalize_fee(&self, fee: f64, total_value: f64) -> f64 {
        if total_value <= 0.0 {
            return 0.0;
        }
        let fee_ratio = fee / total_value;
        // Map fee ratio to score: 0% fee = 1.0, 1% = 0.8, 5% = 0.2, 10%+ = ~0
        // Using exponential decay: score = e^(-k * fee_ratio)
        let k = 30.0;
        let score = (-k * fee_ratio).exp();
        math::clamp_f64(score, 0.0, 1.0)
    }

    /// Normalize slippage to [0, 1] where lower slippage is better.
    pub fn normalize_slippage(&self, slippage: f64) -> f64 {
        if slippage <= 0.0 {
            return 1.0;
        }
        // 0.1% slippage = ~0.97, 1% = ~0.74, 5% = ~0.22
        let k = 30.0;
        let score = (-k * slippage).exp();
        math::clamp_f64(score, 0.0, 1.0)
    }

    /// Normalize time (in seconds) to [0, 1] where faster is better.
    pub fn normalize_speed(&self, time_seconds: u64) -> f64 {
        if time_seconds == 0 {
            return 1.0;
        }
        // Mapping: 30s = ~0.95, 120s = ~0.8, 600s = ~0.4, 1800s = ~0.1
        // Using: score = 1 / (1 + t/300)
        let t = time_seconds as f64;
        let score = 1.0 / (1.0 + t / 300.0);
        math::clamp_f64(score, 0.0, 1.0)
    }

    /// Normalize bridge reliability to [0, 1].
    pub fn normalize_reliability(&self, success_rate: f64, congestion_factor: f64) -> f64 {
        let raw = success_rate * congestion_factor;
        math::clamp_f64(raw, 0.0, 1.0)
    }

    /// Normalize MEV exposure to [0, 1] where lower exposure is better.
    pub fn normalize_mev(&self, route: &Route) -> f64 {
        // MEV risk increases with:
        // - Number of hops (more transactions = more surface)
        // - Value of route (larger amounts attract more MEV)
        // - Chains involved (Ethereum mainnet has highest MEV)
        let hop_penalty = match route.hops.len() {
            0 => return 1.0,
            1 => 0.05,
            2 => 0.12,
            3 => 0.20,
            _ => 0.30,
        };

        let value_penalty = if route.expected_output > 100_000.0 {
            0.15
        } else if route.expected_output > 10_000.0 {
            0.08
        } else if route.expected_output > 1_000.0 {
            0.03
        } else {
            0.01
        };

        let eth_mainnet_hops = route
            .hops
            .iter()
            .filter(|h| {
                h.from_chain == crate::types::Chain::Ethereum
                    || h.to_chain == crate::types::Chain::Ethereum
            })
            .count();
        let chain_penalty = eth_mainnet_hops as f64 * 0.05;

        let total_penalty = hop_penalty + value_penalty + chain_penalty;
        let score = 1.0 - total_penalty;
        math::clamp_f64(score, 0.0, 1.0)
    }

    /// Compute aggregate slippage score for a route.
    fn compute_route_slippage_score(&self, route: &Route) -> f64 {
        if route.hops.is_empty() {
            return 1.0;
        }
        // Compound slippage across hops
        let mut cumulative_retention = 1.0;
        for hop in &route.hops {
            let hop_slippage = hop.slippage();
            cumulative_retention *= 1.0 - hop_slippage;
        }
        let total_slippage = 1.0 - cumulative_retention;
        self.normalize_slippage(total_slippage)
    }

    /// Compute aggregate reliability for a route.
    fn compute_route_reliability(&self, route: &Route) -> f64 {
        if route.hops.is_empty() {
            return 1.0;
        }
        // Route reliability is the product of hop reliabilities
        let mut reliability = 1.0;
        for hop in &route.hops {
            let hop_rel = self.estimate_hop_reliability(hop);
            reliability *= hop_rel;
        }
        reliability
    }

    /// Estimate reliability for a single hop based on bridge and chains.
    fn estimate_hop_reliability(&self, hop: &RouteHop) -> f64 {
        // Base reliability from bridge name heuristic
        let base = match hop.bridge.as_str() {
            "Wormhole" => 0.97,
            "LayerZero" => 0.98,
            "deBridge" => 0.96,
            "Allbridge" => 0.94,
            _ => 0.90,
        };

