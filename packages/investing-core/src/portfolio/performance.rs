//! Portfolio performance analytics.

use crate::types::Portfolio;
use serde::{Deserialize, Serialize};

/// Portfolio performance summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioPerformance {
    /// Total cost basis of all positions
    pub total_cost: f64,
    /// Total market value (requires current prices)
    pub total_market_value: f64,
    /// Total unrealized gain/loss in dollars
    pub total_gain_loss: f64,
    /// Total unrealized gain/loss percentage
    pub total_gain_loss_percent: f64,
    /// Cash balance
    pub cash: f64,
    /// Number of positions
    pub position_count: usize,
    /// Number of positions with gains
    pub positions_in_profit: usize,
    /// Number of positions with losses
    pub positions_in_loss: usize,
}

impl PortfolioPerformance {
    /// Calculate performance metrics from a portfolio.
    ///
    /// Note: This requires positions to have current prices set via `Position::with_price()`.
    pub fn from_portfolio(portfolio: &Portfolio) -> Self {
        let total_cost = portfolio.total_cost();
        let total_market_value = portfolio.total_market_value();
        let total_gain_loss = total_market_value - total_cost - portfolio.cash;

        let total_gain_loss_percent = if total_cost > 0.0 {
            (total_gain_loss / total_cost) * 100.0
        } else {
            0.0
        };

        let positions_in_profit = portfolio
            .positions
            .iter()
            .filter(|p| p.gain_loss.map(|g| g > 0.0).unwrap_or(false))
            .count();

        let positions_in_loss = portfolio
            .positions
            .iter()
            .filter(|p| p.gain_loss.map(|g| g < 0.0).unwrap_or(false))
            .count();

        Self {
            total_cost,
            total_market_value,
            total_gain_loss,
            total_gain_loss_percent,
            cash: portfolio.cash,
            position_count: portfolio.positions.len(),
            positions_in_profit,
            positions_in_loss,
        }
    }

    /// Calculate weight of each position in the portfolio.
    pub fn position_weights(portfolio: &Portfolio) -> Vec<(String, f64)> {
        let total_value = portfolio.total_market_value();
        if total_value <= 0.0 {
            return Vec::new();
        }

        portfolio
            .positions
            .iter()
            .filter_map(|p| {
                p.market_value
                    .map(|mv| (p.symbol.clone(), mv / total_value))
            })
            .collect()
    }
}

/// Time-weighted return calculation for a series of portfolio values.
pub fn time_weighted_return(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }

    let mut twr = 1.0;
    for i in 1..values.len() {
        if values[i - 1] > 0.0 {
            twr *= values[i] / values[i - 1];
        }
    }

    (twr - 1.0) * 100.0
}

/// Calculate holding period return.
pub fn holding_period_return(initial_value: f64, final_value: f64) -> f64 {
    if initial_value <= 0.0 {
        return 0.0;
    }
    ((final_value - initial_value) / initial_value) * 100.0
}

/// Annualize a return given the number of periods and periods per year.
pub fn annualize_return(return_pct: f64, periods: usize, periods_per_year: usize) -> f64 {
    if periods == 0 {
        return 0.0;
    }

    let years = periods as f64 / periods_per_year as f64;
    let total_return = 1.0 + (return_pct / 100.0);

    (total_return.powf(1.0 / years) - 1.0) * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Position;

    #[test]
    fn test_portfolio_performance() {
        let mut portfolio = Portfolio::new();
        portfolio.cash = 1000.0;

        // Add positions with prices
        let pos1 = Position::new("AAPL", 10.0, 150.0).with_price(175.0);
        let pos2 = Position::new("GOOGL", 5.0, 100.0).with_price(90.0);

        portfolio.positions.push(pos1);
        portfolio.positions.push(pos2);

        let perf = PortfolioPerformance::from_portfolio(&portfolio);

        assert_eq!(perf.total_cost, 2000.0); // 1500 + 500
        assert_eq!(perf.total_market_value, 3200.0); // 1750 + 450 + 1000 cash
        assert_eq!(perf.total_gain_loss, 200.0); // (1750 - 1500) + (450 - 500) = 250 - 50
        assert_eq!(perf.position_count, 2);
        assert_eq!(perf.positions_in_profit, 1); // AAPL
        assert_eq!(perf.positions_in_loss, 1); // GOOGL
    }

    #[test]
    fn test_time_weighted_return() {
        // Portfolio values over time
        let values = vec![10000.0, 10500.0, 10200.0, 11000.0];
        let twr = time_weighted_return(&values);

        // (10500/10000) * (10200/10500) * (11000/10200) - 1 = 10%
        assert!((twr - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_holding_period_return() {
        let hpr = holding_period_return(10000.0, 11500.0);
        assert!((hpr - 15.0).abs() < 0.01);
    }

    #[test]
    fn test_annualize_return() {
        // 10% return over 6 months (half year)
        let annualized = annualize_return(10.0, 6, 12);

        // (1.10)^2 - 1 = 21%
        assert!((annualized - 21.0).abs() < 0.5);
    }

    #[test]
    fn test_position_weights() {
        let mut portfolio = Portfolio::new();

        let pos1 = Position::new("AAPL", 10.0, 100.0).with_price(100.0); // $1000
        let pos2 = Position::new("GOOGL", 10.0, 100.0).with_price(100.0); // $1000

        portfolio.positions.push(pos1);
        portfolio.positions.push(pos2);

        let weights = PortfolioPerformance::position_weights(&portfolio);

        assert_eq!(weights.len(), 2);
        assert!((weights[0].1 - 0.5).abs() < 0.01); // 50% each
        assert!((weights[1].1 - 0.5).abs() < 0.01);
    }
}
