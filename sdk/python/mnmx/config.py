from .types import RouterConfig, ScoringWeights, AdversarialModel


STRATEGY_DEFAULTS = {
    "minimax": ScoringWeights(fees=0.25, slippage=0.25, speed=0.15, reliability=0.20, mev_exposure=0.15),
    "cheapest": ScoringWeights(fees=0.45, slippage=0.30, speed=0.05, reliability=0.10, mev_exposure=0.10),
    "fastest": ScoringWeights(fees=0.10, slippage=0.15, speed=0.50, reliability=0.15, mev_exposure=0.10),
    "safest": ScoringWeights(fees=0.10, slippage=0.15, speed=0.10, reliability=0.40, mev_exposure=0.25),
}

DEFAULT_ADVERSARIAL = AdversarialModel(
    slippage_multiplier=2.0,
    gas_multiplier=1.5,
    bridge_delay_multiplier=3.0,
    mev_extraction=0.003,
    price_movement=0.005,
)


def get_default_config(strategy: str = "minimax") -> RouterConfig:
    """Return a default RouterConfig for the given strategy."""
    weights = STRATEGY_DEFAULTS.get(strategy, STRATEGY_DEFAULTS["minimax"])
    return RouterConfig(
        strategy=strategy,
        slippage_tolerance=0.5,
        timeout_ms=30_000,
        max_hops=3,
        weights=weights,
        adversarial_model=DEFAULT_ADVERSARIAL,
    )
