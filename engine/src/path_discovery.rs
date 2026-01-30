use crate::bridge::BridgeRegistry;
use crate::types::{Chain, Token};

/// Candidate path: a sequence of (from_chain, to_chain, bridge_name) tuples.
#[derive(Debug, Clone)]
pub struct CandidatePath {
    pub steps: Vec<PathStep>,
}

#[derive(Debug, Clone)]
pub struct PathStep {
    pub from_chain: Chain,
    pub to_chain: Chain,
    pub from_token: Token,
    pub to_token: Token,
    pub bridge_name: String,
}

/// Discovers all possible paths between two chain/token pairs.
pub struct PathDiscovery<'a> {
    registry: &'a BridgeRegistry,
    max_hops: usize,
}

impl<'a> PathDiscovery<'a> {
    pub fn new(registry: &'a BridgeRegistry, max_hops: usize) -> Self {
        Self { registry, max_hops }
    }

    /// Enumerate all candidate paths from source to destination.
    pub fn discover_paths(
        &self,
        from_chain: Chain,
        from_token: &Token,
        to_chain: Chain,
        to_token: &Token,
    ) -> Vec<CandidatePath> {
        let mut all_paths = Vec::new();

        // Direct paths (1 hop)
        let direct = self.expand_direct_paths(from_chain, from_token, to_chain, to_token);
        all_paths.extend(direct);

        // Multi-hop paths (2-3 hops)
        if self.max_hops >= 2 {
            let multi = self.expand_multi_hop_paths(from_chain, from_token, to_chain, to_token);
            all_paths.extend(multi);
        }

        // Remove dominated and duplicate paths
        let filtered = self.filter_dominated_paths(all_paths);
        self.deduplicate_paths(filtered)
    }

    /// Find all single-hop direct bridges between two chains.
    pub fn expand_direct_paths(
        &self,
        from_chain: Chain,
        from_token: &Token,
        to_chain: Chain,
        to_token: &Token,
    ) -> Vec<CandidatePath> {
        let bridges = self.registry.get_bridges_for_pair(from_chain, to_chain);
        bridges
            .into_iter()
            .map(|bridge| {
                CandidatePath {
                    steps: vec![PathStep {
                        from_chain,
                        to_chain,
                        from_token: from_token.clone(),
                        to_token: to_token.clone(),
                        bridge_name: bridge.name().to_string(),
                    }],
                }
            })
            .collect()
    }

    /// Expand multi-hop paths through intermediate chains.
    pub fn expand_multi_hop_paths(
        &self,
        from_chain: Chain,
        from_token: &Token,
        to_chain: Chain,
        to_token: &Token,
    ) -> Vec<CandidatePath> {
        let mut paths = Vec::new();
        let intermediates = self.get_intermediate_chains(from_chain, to_chain);

        // 2-hop paths: from -> intermediate -> to
        for &mid_chain in &intermediates {
            let mid_token = self.infer_intermediate_token(from_token, mid_chain);
            let first_leg = self.registry.get_bridges_for_pair(from_chain, mid_chain);
            let second_leg = self.registry.get_bridges_for_pair(mid_chain, to_chain);

            for bridge1 in &first_leg {
                for bridge2 in &second_leg {
                    paths.push(CandidatePath {
                        steps: vec![
                            PathStep {
                                from_chain,
                                to_chain: mid_chain,
                                from_token: from_token.clone(),
                                to_token: mid_token.clone(),
                                bridge_name: bridge1.name().to_string(),
                            },
                            PathStep {
                                from_chain: mid_chain,
                                to_chain,
                                from_token: mid_token.clone(),
                                to_token: to_token.clone(),
                                bridge_name: bridge2.name().to_string(),
                            },
                        ],
                    });
                }
            }
        }

        // 3-hop paths (only if max_hops >= 3)
        if self.max_hops >= 3 {
            for &mid1 in &intermediates {
                let mid1_token = self.infer_intermediate_token(from_token, mid1);
                let second_intermediates = self.get_intermediate_chains(mid1, to_chain);

                for &mid2 in &second_intermediates {
                    if mid2 == from_chain || mid2 == mid1 {
                        continue;
                    }
                    let mid2_token = self.infer_intermediate_token(from_token, mid2);

                    let leg1 = self.registry.get_bridges_for_pair(from_chain, mid1);
                    let leg2 = self.registry.get_bridges_for_pair(mid1, mid2);
                    let leg3 = self.registry.get_bridges_for_pair(mid2, to_chain);

                    if leg1.is_empty() || leg2.is_empty() || leg3.is_empty() {
                        continue;
                    }

                    // For 3-hop, only use the best bridge per leg to limit combinatorics
                    let b1_name = leg1[0].name().to_string();
                    let b2_name = leg2[0].name().to_string();
                    let b3_name = leg3[0].name().to_string();

                    paths.push(CandidatePath {
                        steps: vec![
                            PathStep {
                                from_chain,
                                to_chain: mid1,
                                from_token: from_token.clone(),
                                to_token: mid1_token.clone(),
                                bridge_name: b1_name,
                            },
                            PathStep {
                                from_chain: mid1,
                                to_chain: mid2,
                                from_token: mid1_token.clone(),
                                to_token: mid2_token.clone(),
                                bridge_name: b2_name,
                            },
                            PathStep {
                                from_chain: mid2,
                                to_chain,
                                from_token: mid2_token.clone(),
                                to_token: to_token.clone(),
                                bridge_name: b3_name,
                            },
                        ],
                    });
                }
            }
        }

        paths
    }

    /// Filter out paths that are provably dominated by another path.
    /// A path is dominated if another path uses a subset of its bridges
    /// with fewer hops (fewer hops generally means lower fees).
    pub fn filter_dominated_paths(&self, paths: Vec<CandidatePath>) -> Vec<CandidatePath> {
        if paths.len() <= 1 {
            return paths;
        }

        let mut kept = Vec::new();

        for (i, path) in paths.iter().enumerate() {
            let mut is_dominated = false;
            for (j, other) in paths.iter().enumerate() {
                if i == j {
                    continue;
                }
                // other dominates path if it has fewer hops and covers the same chain pair
                if other.steps.len() < path.steps.len() {
                    let same_endpoints = path.steps.first().map(|s| s.from_chain)
                        == other.steps.first().map(|s| s.from_chain)
                        && path.steps.last().map(|s| s.to_chain)
                            == other.steps.last().map(|s| s.to_chain);

                    let uses_same_bridge = other.steps.iter().any(|os| {
                        path.steps.iter().any(|ps| ps.bridge_name == os.bridge_name)
                    });

                    if same_endpoints && uses_same_bridge {
                        is_dominated = true;
                        break;
                    }
                }
            }
            if !is_dominated {
                kept.push(path.clone());
            }
        }

        kept
    }

    /// Remove duplicate paths that traverse the same chain sequence with the same bridges.
    pub fn deduplicate_paths(&self, paths: Vec<CandidatePath>) -> Vec<CandidatePath> {
        let mut seen = std::collections::HashSet::new();
        let mut unique = Vec::new();

        for path in paths {
            let key = path
                .steps
                .iter()
                .map(|s| {
                    format!(
                        "{}->{}:{}",
                        s.from_chain.chain_id(),
                        s.to_chain.chain_id(),
                        s.bridge_name
                    )
                })
                .collect::<Vec<_>>()
                .join("|");

            if seen.insert(key) {
                unique.push(path);
            }
        }

        unique
    }

    /// Get viable intermediate chains for routing between two chains.
    pub fn get_intermediate_chains(&self, from: Chain, to: Chain) -> Vec<Chain> {
        Chain::all()
            .iter()
            .filter(|&&c| {
                c != from
                    && c != to
                    && self.registry.has_pair(from, c)
                    && self.registry.has_pair(c, to)
            })
            .copied()
            .collect()
    }

    /// Infer what token to use on an intermediate chain.
    /// If the source is a stablecoin, use the same stablecoin on the intermediate chain.
    /// Otherwise, use the native wrapped token or USDC as a fallback.
    fn infer_intermediate_token(&self, source_token: &Token, chain: Chain) -> Token {
        if source_token.is_stablecoin() {
            // Use the same stablecoin on the intermediate chain
            Token::new(
                &source_token.symbol,
                chain,
                source_token.decimals,
                &format!("0x{}_{}", source_token.symbol, chain.chain_id()),
            )
        } else {
            // Use USDC as a universal intermediate
            Token::new(
                "USDC",
                chain,
                6,
                &format!("0xUSDC_{}", chain.chain_id()),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::build_mock_registry;

    #[test]
    fn test_direct_path_discovery() {
        let registry = build_mock_registry();
        let pd = PathDiscovery::new(&registry, 3);
        let from = Token::new("USDC", Chain::Ethereum, 6, "0xaaa");
        let to = Token::new("USDC", Chain::Arbitrum, 6, "0xbbb");
        let paths = pd.expand_direct_paths(Chain::Ethereum, &from, Chain::Arbitrum, &to);
        assert!(!paths.is_empty(), "should find at least one direct path");
        for path in &paths {
            assert_eq!(path.steps.len(), 1);
        }
    }

    #[test]
    fn test_multi_hop_discovery() {
        let registry = build_mock_registry();
        let pd = PathDiscovery::new(&registry, 3);
        let from = Token::new("USDC", Chain::Ethereum, 6, "0xaaa");
        let to = Token::new("USDC", Chain::Arbitrum, 6, "0xbbb");
        let paths = pd.expand_multi_hop_paths(Chain::Ethereum, &from, Chain::Arbitrum, &to);
        assert!(!paths.is_empty());
        for path in &paths {
            assert!(path.steps.len() >= 2);
        }
    }

    #[test]
    fn test_intermediate_chains() {
        let registry = build_mock_registry();
        let pd = PathDiscovery::new(&registry, 3);
        let intermediates = pd.get_intermediate_chains(Chain::Ethereum, Chain::Arbitrum);
        assert!(!intermediates.is_empty());
        assert!(!intermediates.contains(&Chain::Ethereum));
        assert!(!intermediates.contains(&Chain::Arbitrum));
    }

    #[test]
    fn test_deduplication() {
        let registry = build_mock_registry();
        let pd = PathDiscovery::new(&registry, 3);
        let from = Token::new("USDC", Chain::Ethereum, 6, "0xaaa");
        let to = Token::new("USDC", Chain::Arbitrum, 6, "0xbbb");

        let path = CandidatePath {
            steps: vec![PathStep {
                from_chain: Chain::Ethereum,
                to_chain: Chain::Arbitrum,
                from_token: from.clone(),
                to_token: to.clone(),
                bridge_name: "Wormhole".to_string(),
            }],
        };
        let paths = vec![path.clone(), path.clone()];
        let deduped = pd.deduplicate_paths(paths);
        assert_eq!(deduped.len(), 1);
    }

    #[test]
    fn test_full_discovery() {
        let registry = build_mock_registry();
        let pd = PathDiscovery::new(&registry, 2);
        let from = Token::new("USDC", Chain::Ethereum, 6, "0xaaa");
        let to = Token::new("USDC", Chain::Base, 6, "0xbbb");
        let paths = pd.discover_paths(Chain::Ethereum, &from, Chain::Base, &to);
        assert!(!paths.is_empty());
    }
}
