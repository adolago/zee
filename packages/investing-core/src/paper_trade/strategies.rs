//! Built-in trading strategies for paper trading and backtesting.

use crate::types::StrategyParameters;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

/// Trading strategy definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Strategy {
    /// Strategy identifier
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Description of how the strategy works
    pub description: String,
    /// Strategy parameters
    pub parameters: StrategyParameters,
}

/// Built-in trading strategies.
pub static BUILTIN_STRATEGIES: LazyLock<HashMap<String, Strategy>> = LazyLock::new(|| {
    let mut strategies = HashMap::new();

    strategies.insert(
        "momentum".to_string(),
        Strategy {
            id: "momentum".to_string(),
            name: "Momentum Strategy".to_string(),
            description: "Buy assets with positive momentum, sell when momentum reverses"
                .to_string(),
            parameters: StrategyParameters {
                lookback_period: Some(20),
                momentum_threshold: Some(0.02),
                ..Default::default()
            },
        },
    );

    strategies.insert(
        "mean_reversion".to_string(),
        Strategy {
            id: "mean_reversion".to_string(),
            name: "Mean Reversion Strategy".to_string(),
            description:
                "Buy oversold assets, sell overbought assets based on Bollinger Bands".to_string(),
            parameters: StrategyParameters {
                bb_period: Some(20),
                bb_std: Some(2.0),
                ..Default::default()
            },
        },
    );

    strategies.insert(
        "sma_crossover".to_string(),
        Strategy {
            id: "sma_crossover".to_string(),
            name: "SMA Crossover Strategy".to_string(),
            description: "Buy when short SMA crosses above long SMA, sell on opposite".to_string(),
            parameters: StrategyParameters {
                short_period: Some(10),
                long_period: Some(50),
                ..Default::default()
            },
        },
    );

    strategies.insert(
        "rsi_strategy".to_string(),
        Strategy {
            id: "rsi_strategy".to_string(),
            name: "RSI Strategy".to_string(),
            description: "Buy when RSI oversold (<30), sell when overbought (>70)".to_string(),
            parameters: StrategyParameters {
                rsi_period: Some(14),
                oversold: Some(30.0),
                overbought: Some(70.0),
                ..Default::default()
            },
        },
    );

    strategies.insert(
        "buy_and_hold".to_string(),
        Strategy {
            id: "buy_and_hold".to_string(),
            name: "Buy and Hold".to_string(),
            description: "Simple buy and hold benchmark strategy".to_string(),
            parameters: StrategyParameters::default(),
        },
    );

    strategies
});

/// List all available strategies.
pub fn list_strategies() -> Vec<Strategy> {
    BUILTIN_STRATEGIES.values().cloned().collect()
}

/// Get a specific strategy by ID.
pub fn get_strategy(id: &str) -> Option<Strategy> {
    BUILTIN_STRATEGIES.get(&id.to_lowercase()).cloned()
}

/// Validate that a strategy exists.
pub fn is_valid_strategy(id: &str) -> bool {
    BUILTIN_STRATEGIES.contains_key(&id.to_lowercase())
}

/// Get all strategy IDs.
pub fn strategy_ids() -> Vec<String> {
    BUILTIN_STRATEGIES.keys().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_strategies() {
        let strategies = list_strategies();
        assert_eq!(strategies.len(), 5);
    }

    #[test]
    fn test_get_strategy() {
        let momentum = get_strategy("momentum").unwrap();
        assert_eq!(momentum.name, "Momentum Strategy");
        assert_eq!(momentum.parameters.lookback_period, Some(20));
    }

    #[test]
    fn test_get_strategy_case_insensitive() {
        assert!(get_strategy("MOMENTUM").is_some());
        assert!(get_strategy("Momentum").is_some());
        assert!(get_strategy("momentum").is_some());
    }

    #[test]
    fn test_get_strategy_not_found() {
        assert!(get_strategy("nonexistent").is_none());
    }

    #[test]
    fn test_is_valid_strategy() {
        assert!(is_valid_strategy("momentum"));
        assert!(is_valid_strategy("sma_crossover"));
        assert!(!is_valid_strategy("invalid"));
    }

    #[test]
    fn test_all_strategies_have_names() {
        for strategy in list_strategies() {
            assert!(!strategy.name.is_empty());
            assert!(!strategy.description.is_empty());
        }
    }
}
