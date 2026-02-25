use std::collections::HashMap;

use mnmx_engine::*;

fn make_state() -> OnChainState {
    let mut balances = HashMap::new();
    balances.insert("SOL".to_string(), 1_000_000);
    balances.insert("USDC".to_string(), 5_000_000);

    OnChainState {
        token_balances: balances,
        pool_states: vec![PoolState::new(
            "pool1",
            10_000_000,
            50_000_000,
            30,
            "SOL",
            "USDC",
        )],
        pending_transactions: Vec::new(),
        slot: 100,
        block_time: 1700000000,
    }
}

fn make_swap_action(amount: u64, priority_fee: u64) -> ExecutionAction {
    ExecutionAction::new(
        ActionKind::Swap,
        "SOL",
        amount,
        "USDC",
        50,
        "pool1",
        priority_fee,
    )
}

#[test]
fn test_gas_cost_scoring() {
    let state = make_state();

    // Low fee action
    let low_fee = make_swap_action(100_000, 1000);
    let gas_low = PositionEvaluator::evaluate_gas_cost(&low_fee, &state);

    // High fee action
    let high_fee = make_swap_action(100_000, 50_000);
    let gas_high = PositionEvaluator::evaluate_gas_cost(&high_fee, &state);

    // Both should be negative (gas is a cost)
    assert!(gas_low < 0.0, "gas_low={}", gas_low);
    assert!(gas_high < 0.0, "gas_high={}", gas_high);

    // Higher fee should have worse (more negative) score
    assert!(
        gas_high < gas_low,
        "Higher fee should produce lower score: high={} low={}",
        gas_high,
        gas_low
    );
}

#[test]
fn test_slippage_calculation() {
    let pool = PoolState::new("pool1", 10_000_000, 50_000_000, 30, "SOL", "USDC");

    // Small swap: low slippage
    let small_swap = make_swap_action(10_000, 5000);
    let slip_small = PositionEvaluator::evaluate_slippage(&small_swap, &pool);

    // Large swap: high slippage
    let large_swap = make_swap_action(5_000_000, 5000);
    let slip_large = PositionEvaluator::evaluate_slippage(&large_swap, &pool);

    // Both should be negative (slippage is bad)
    assert!(slip_small < 0.0);
    assert!(slip_large < 0.0);

    // Larger swap should have worse slippage
    assert!(
        slip_large < slip_small,
        "Larger swap should have worse slippage: large={} small={}",
        slip_large,
        slip_small
    );
}

#[test]
fn test_mev_exposure_scoring() {
    let action = make_swap_action(100_000, 5000);

    // No pending transactions: no MEV exposure
    let mev_clean = PositionEvaluator::evaluate_mev_exposure(&action, &[]);
    assert_eq!(mev_clean, 0.0);

    // Pending transactions on the same pool
    let pending = vec![
        PendingTx::new("sig1", "bot1", "pool1", 50_000, 100, 20_000),
        PendingTx::new("sig2", "bot2", "pool1", 80_000, 100, 30_000),
    ];
    let mev_risky = PositionEvaluator::evaluate_mev_exposure(&action, &pending);
