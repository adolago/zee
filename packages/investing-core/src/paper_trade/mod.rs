//! Paper trading simulation module.
//!
//! Provides a state machine for simulated trading without real money.

mod state;
mod strategies;

pub use state::{PaperPosition, PaperTradingResult, PaperTradingState, PaperTradingStatus};
pub use strategies::{
    get_strategy, is_valid_strategy, list_strategies, strategy_ids, Strategy, BUILTIN_STRATEGIES,
};
