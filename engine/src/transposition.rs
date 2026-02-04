use std::collections::HashMap;

use crate::types::*;

/// A hash table that caches previously evaluated positions to avoid
/// redundant work during the minimax search.
///
/// Uses a depth-preferred replacement policy: an existing entry is only
/// overwritten if the new entry was searched to an equal or greater depth,
/// or if the existing entry is sufficiently old.
#[derive(Debug, Clone)]
pub struct TranspositionTable {
    table: HashMap<String, TranspositionEntry>,
    max_entries: usize,
    hits: u64,
    misses: u64,
    overwrites: u64,
    current_age: u64,
}

impl TranspositionTable {
    pub fn new(max_entries: usize) -> Self {
        Self {
            table: HashMap::with_capacity(max_entries.min(1_000_000)),
            max_entries,
            hits: 0,
            misses: 0,
            overwrites: 0,
            current_age: 0,
        }
    }

    /// Look up a position hash and return a usable score if the stored
    /// entry is deep enough and the bounds match.
    ///
    /// Returns `Some(score)` if the entry can produce a cutoff or exact value,
    /// `None` if the entry is missing, too shallow, or the bounds don't allow
    /// a cutoff.
    pub fn lookup(
        &mut self,
        hash: &str,
        depth: u32,
        alpha: f64,
        beta: f64,
    ) -> Option<f64> {
        match self.table.get(hash) {
            Some(entry) => {
                if entry.depth < depth {
                    self.misses += 1;
                    return None;
                }

                self.hits += 1;

                match entry.flag {
                    TranspositionFlag::Exact => Some(entry.score),
                    TranspositionFlag::LowerBound => {
                        if entry.score >= beta {
                            Some(entry.score)
                        } else {
                            None
                        }
                    }
                    TranspositionFlag::UpperBound => {
                        if entry.score <= alpha {
                            Some(entry.score)
                        } else {
                            None
                        }
                    }
                }
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Store an evaluation result in the table.
    ///
    /// Replacement policy:
    /// 1. If the slot is empty, insert.
    /// 2. If the new depth >= existing depth, replace.
    /// 3. If the existing entry is old (age difference >= 2), replace.
    /// 4. Otherwise, keep the existing entry.
    pub fn store(
        &mut self,
        hash: String,
        depth: u32,
        score: f64,
        flag: TranspositionFlag,
        best_action: Option<ExecutionAction>,
    ) {
        // Evict if at capacity
        if self.table.len() >= self.max_entries && !self.table.contains_key(&hash) {
            self.evict_oldest();
        }

        let should_replace = match self.table.get(&hash) {
            None => true,
            Some(existing) => {
                if depth >= existing.depth {
                    true
                } else if self.current_age.saturating_sub(existing.age) >= 2 {
                    true
                } else {
                    false
                }
            }
        };

        if should_replace {
            if self.table.contains_key(&hash) {
                self.overwrites += 1;
            }
            self.table.insert(
                hash.clone(),
                TranspositionEntry::new(hash, depth, score, flag, best_action, self.current_age),
            );
        }
    }

    /// Retrieve the best action stored for a position, if any.
    pub fn get_best_action(&self, hash: &str) -> Option<&ExecutionAction> {
        self.table
            .get(hash)
            .and_then(|entry| entry.best_action.as_ref())
    }

    /// Clear all entries and reset statistics.
    pub fn clear(&mut self) {
        self.table.clear();
        self.hits = 0;
        self.misses = 0;
        self.overwrites = 0;
        self.current_age += 1;
    }

    /// Number of entries currently stored.
    pub fn len(&self) -> usize {
        self.table.len()
    }

    /// Whether the table is empty.
    pub fn is_empty(&self) -> bool {
        self.table.is_empty()
    }

    /// Hit rate as a fraction [0.0, 1.0].
    pub fn hit_rate(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f64 / total as f64
        }
    }

    /// Total number of lookups (hits + misses).
    pub fn total_lookups(&self) -> u64 {
        self.hits + self.misses
    }

    /// Number of successful lookups.
    pub fn total_hits(&self) -> u64 {
        self.hits
    }

    /// Number of unsuccessful lookups.
    pub fn total_misses(&self) -> u64 {
        self.misses
    }

    /// Number of times an entry was overwritten.
    pub fn total_overwrites(&self) -> u64 {
        self.overwrites
    }

    /// Increment the age counter. Called at the start of each new search.
    pub fn new_search(&mut self) {
        self.current_age += 1;
    }

    /// Evict the oldest entry to make room.
    fn evict_oldest(&mut self) {
        if self.table.is_empty() {
            return;
        }

        // Find the entry with the smallest age
        let oldest_key = self
            .table
            .iter()
            .min_by_key(|(_, entry)| entry.age)
            .map(|(key, _)| key.clone());

        if let Some(key) = oldest_key {
            self.table.remove(&key);
        }
    }

    /// Evict all entries older than a given age threshold.
    pub fn evict_older_than(&mut self, min_age: u64) {
        self.table.retain(|_, entry| entry.age >= min_age);
    }

    /// Utilization as a fraction of max_entries.
    pub fn utilization(&self) -> f64 {
        if self.max_entries == 0 {
            return 0.0;
        }
        self.table.len() as f64 / self.max_entries as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_lookup_exact() {
        let mut tt = TranspositionTable::new(1000);
        tt.store(
            "hash1".to_string(),
            3,
            42.0,
            TranspositionFlag::Exact,
            None,
        );
        let result = tt.lookup("hash1", 3, f64::NEG_INFINITY, f64::INFINITY);
        assert_eq!(result, Some(42.0));
    }

    #[test]
    fn test_lookup_too_shallow() {
        let mut tt = TranspositionTable::new(1000);
        tt.store(
            "hash1".to_string(),
            2,
            42.0,
            TranspositionFlag::Exact,
            None,
        );
        // Requesting depth 3 but stored at depth 2
        let result = tt.lookup("hash1", 3, f64::NEG_INFINITY, f64::INFINITY);
        assert_eq!(result, None);
    }

    #[test]
    fn test_lower_bound_cutoff() {
        let mut tt = TranspositionTable::new(1000);
        tt.store(
            "hash1".to_string(),
            3,
            50.0,
            TranspositionFlag::LowerBound,
            None,
        );
        // beta = 40 < score = 50 => cutoff
        let result = tt.lookup("hash1", 3, 30.0, 40.0);
        assert_eq!(result, Some(50.0));
        // beta = 60 > score = 50 => no cutoff
        let result = tt.lookup("hash1", 3, 30.0, 60.0);
        assert_eq!(result, None);
    }

    #[test]
    fn test_upper_bound_cutoff() {
        let mut tt = TranspositionTable::new(1000);
        tt.store(
            "hash1".to_string(),
            3,
            20.0,
            TranspositionFlag::UpperBound,
            None,
        );
        // alpha = 25 > score = 20 => cutoff
        let result = tt.lookup("hash1", 3, 25.0, 40.0);
        assert_eq!(result, Some(20.0));
        // alpha = 15 < score = 20 => no cutoff
        let result = tt.lookup("hash1", 3, 15.0, 40.0);
        assert_eq!(result, None);
    }

    #[test]
    fn test_depth_preferred_replacement() {
        let mut tt = TranspositionTable::new(1000);
        tt.store("h".to_string(), 5, 100.0, TranspositionFlag::Exact, None);
        // Try to overwrite with shallower depth
        tt.store("h".to_string(), 3, 200.0, TranspositionFlag::Exact, None);
        let result = tt.lookup("h", 3, f64::NEG_INFINITY, f64::INFINITY);
        // Should still have the deeper entry
        assert_eq!(result, Some(100.0));
    }

    #[test]
    fn test_hit_rate() {
        let mut tt = TranspositionTable::new(1000);
        tt.store("a".to_string(), 3, 1.0, TranspositionFlag::Exact, None);
        tt.lookup("a", 3, f64::NEG_INFINITY, f64::INFINITY); // hit
        tt.lookup("b", 3, f64::NEG_INFINITY, f64::INFINITY); // miss
        assert!((tt.hit_rate() - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_clear() {
        let mut tt = TranspositionTable::new(1000);
        tt.store("a".to_string(), 3, 1.0, TranspositionFlag::Exact, None);
        tt.store("b".to_string(), 3, 2.0, TranspositionFlag::Exact, None);
        assert_eq!(tt.len(), 2);
        tt.clear();
        assert_eq!(tt.len(), 0);
        assert_eq!(tt.hit_rate(), 0.0);
    }

    #[test]
    fn test_best_action_retrieval() {
        let mut tt = TranspositionTable::new(1000);
        let action = ExecutionAction::new(
            ActionKind::Swap,
            "SOL",
            1000,
            "USDC",
            50,
            "pool1",
            5000,
        );
        tt.store(
            "h".to_string(),
            4,
            99.0,
            TranspositionFlag::Exact,
            Some(action.clone()),
        );
        let retrieved = tt.get_best_action("h");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().amount, 1000);
    }

    #[test]
    fn test_capacity_eviction() {
        let mut tt = TranspositionTable::new(3);
        tt.store("a".to_string(), 1, 1.0, TranspositionFlag::Exact, None);
        tt.store("b".to_string(), 2, 2.0, TranspositionFlag::Exact, None);
        tt.store("c".to_string(), 3, 3.0, TranspositionFlag::Exact, None);
        // Table is full, adding one more should evict
        tt.store("d".to_string(), 4, 4.0, TranspositionFlag::Exact, None);
        assert!(tt.len() <= 3);
    }
}
