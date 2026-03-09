//! Portfolio management module.
//!
//! Provides position tracking, performance analytics, and risk metrics.

mod performance;
mod risk;
mod tracker;

pub use performance::{
    annualize_return, holding_period_return, time_weighted_return, PortfolioPerformance,
};
pub use risk::{
    calculate_max_drawdown, calculate_risk_metrics, norm_ppf, sharpe_ratio, sortino_ratio,
    value_at_risk, volatility,
};
pub use tracker::PortfolioTracker;
