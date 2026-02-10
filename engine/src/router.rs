use crate::bridge::{BridgeAdapter, BridgeRegistry};
use crate::minimax::MinimaxSearcher;
use crate::path_discovery::{CandidatePath, PathDiscovery};
use crate::scoring::{compare_routes, get_strategy_weights, RouteScorer};
use crate::types::{
    BridgeQuote, Chain, Route, RouteHop, RouteRequest, RouterConfig, SearchStats, Strategy, Token,
};

/// The main MNMX cross-chain router.
pub struct MnmxRouter {
    config: RouterConfig,
    registry: BridgeRegistry,
}

/// Result of a routing operation.
#[derive(Debug)]
pub struct RoutingResult {
    pub best_route: Option<Route>,
    pub alternatives: Vec<Route>,
    pub stats: SearchStats,
}

impl MnmxRouter {
    /// Create a new router with the given configuration.
    pub fn new(config: RouterConfig) -> Self {
        Self {
            config,
            registry: BridgeRegistry::new(),
        }
    }

    /// Create a router with default config.
    pub fn default_router() -> Self {
        Self::new(RouterConfig::default())
    }

    /// Register a bridge adapter with the router.
    pub fn register_bridge(&mut self, adapter: Box<dyn BridgeAdapter>) {
        self.registry.register(adapter);
    }

    /// Set the bridge registry directly (useful for testing).
    pub fn set_registry(&mut self, registry: BridgeRegistry) {
        self.registry = registry;
    }

    /// Find the best route for the given request.
    pub fn find_route(&mut self, request: &RouteRequest) -> RoutingResult {
        // Update weights based on strategy
        self.config.weights = get_strategy_weights(request.strategy);
        self.config.max_hops = request.max_hops;
        self.config.strategy = request.strategy;

        // Run minimax search
        let mut searcher = MinimaxSearcher::new(self.config.clone());
        let (best_route, stats) = searcher.search(
            &self.registry,
            request.from_chain,
            &request.from_token,
            request.to_chain,
            &request.to_token,
            request.amount,
        );

        // Also find alternatives using different strategies
        let alternatives = self.find_alternative_routes(request, &best_route);

        RoutingResult {
            best_route,
            alternatives,
            stats,
        }
    }

    /// Find all candidate routes sorted by minimax score.
    pub fn find_all_routes(&mut self, request: &RouteRequest) -> (Vec<Route>, SearchStats) {
        let path_discovery = PathDiscovery::new(&self.registry, request.max_hops);
        let candidate_paths = path_discovery.discover_paths(
            request.from_chain,
            &request.from_token,
            request.to_chain,
            &request.to_token,
        );

        let scorer = RouteScorer::new(get_strategy_weights(request.strategy));
        let mut routes = Vec::new();

        for path in &candidate_paths {
            if let Some(route) = self.evaluate_candidate_path(path, request.amount) {
                routes.push(route);
            }
        }

        // Score all routes
        for route in &mut routes {
            route.minimax_score = scorer.score_route(route);
        }

        // Sort by minimax score (best first)
        routes.sort_by(compare_routes);

        let stats = SearchStats {
            nodes_explored: candidate_paths.len() as u64,
            nodes_pruned: 0,
            max_depth_reached: request.max_hops as u32,
            search_time_ms: 0,
        };

        (routes, stats)
    }

    /// Get all chains supported by registered bridges.
    pub fn get_supported_chains(&self) -> Vec<Chain> {
        let mut chains = std::collections::HashSet::new();
        for pair in self.registry.supported_pairs() {
            chains.insert(pair.0);
            chains.insert(pair.1);
        }
        let mut result: Vec<Chain> = chains.into_iter().collect();
        result.sort_by_key(|c| c.chain_id());
        result
    }

    /// Get bridge quotes for a specific chain pair and amount.
    pub fn get_quotes(
        &self,
        from_token: &Token,
        to_token: &Token,
        amount: f64,
    ) -> Vec<BridgeQuote> {
        let bridges = self
            .registry
            .get_bridges_for_pair(from_token.chain, to_token.chain);
        let mut quotes = Vec::new();
        for bridge in bridges {
            if let Some(quote) = bridge.get_quote(from_token, to_token, amount) {
                quotes.push(quote);
            }
        }
        // Sort by output amount (best first)
        quotes.sort_by(|a, b| {
            b.output_amount
                .partial_cmp(&a.output_amount)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        quotes
    }

    /// Update the router's configuration.
    pub fn update_config(&mut self, config: RouterConfig) {
        self.config = config;
    }

    /// Get current configuration.
    pub fn config(&self) -> &RouterConfig {
        &self.config
    }

    /// Get reference to the bridge registry.
    pub fn registry(&self) -> &BridgeRegistry {
        &self.registry
    }

    // ------- Internal methods -------

    /// Find alternative routes using strategies other than the primary one.
    fn find_alternative_routes(
        &self,
        request: &RouteRequest,
        primary: &Option<Route>,
    ) -> Vec<Route> {
        let alt_strategies = [Strategy::Cheapest, Strategy::Fastest, Strategy::Safest];
        let mut alternatives = Vec::new();

        let path_discovery = PathDiscovery::new(&self.registry, request.max_hops);
        let candidate_paths = path_discovery.discover_paths(
            request.from_chain,
            &request.from_token,
            request.to_chain,
            &request.to_token,
