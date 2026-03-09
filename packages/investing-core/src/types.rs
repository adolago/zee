//! Core data types for Investing trading system.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A position in the portfolio representing shares owned of a particular asset.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Position {
    /// Stock ticker symbol (uppercase)
    pub symbol: String,
    /// Number of shares owned
    pub shares: f64,
    /// Average cost per share
    pub cost_basis: f64,
    /// Current market price (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_price: Option<f64>,
    /// Current market value (shares * current_price)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market_value: Option<f64>,
    /// Unrealized gain/loss in dollars
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain_loss: Option<f64>,
    /// Unrealized gain/loss percentage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain_loss_percent: Option<f64>,
}

impl Position {
    /// Create a new position with the given symbol, shares, and cost basis.
    pub fn new(symbol: &str, shares: f64, cost_basis: f64) -> Self {
        Self {
            symbol: symbol.to_uppercase(),
            shares,
            cost_basis,
            current_price: None,
            market_value: None,
            gain_loss: None,
            gain_loss_percent: None,
        }
    }

    /// Calculate the total cost of this position.
    pub fn total_cost(&self) -> f64 {
        self.shares * self.cost_basis
    }

    /// Update the position with current market price and calculate metrics.
    pub fn with_price(&self, current_price: f64) -> Self {
        let market_value = self.shares * current_price;
        let total_cost = self.total_cost();
        let gain_loss = market_value - total_cost;
        let gain_loss_percent = if total_cost > 0.0 {
            (gain_loss / total_cost) * 100.0
        } else {
            0.0
        };

        Self {
            current_price: Some(current_price),
            market_value: Some(market_value),
            gain_loss: Some(gain_loss),
            gain_loss_percent: Some(gain_loss_percent),
            ..self.clone()
        }
    }
}

/// A portfolio containing cash and positions.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Portfolio {
    /// List of positions
    pub positions: Vec<Position>,
    /// Cash balance
    pub cash: f64,
    /// When the portfolio was created
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    /// When the portfolio was last updated
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

impl Portfolio {
    /// Create a new empty portfolio.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a portfolio with initial cash.
    pub fn with_cash(cash: f64) -> Self {
        Self {
            cash,
            ..Default::default()
        }
    }

    /// Calculate total cost basis of all positions.
    pub fn total_cost(&self) -> f64 {
        self.positions.iter().map(|p| p.total_cost()).sum()
    }

    /// Calculate total market value (requires current prices to be set).
    pub fn total_market_value(&self) -> f64 {
        self.positions
            .iter()
            .filter_map(|p| p.market_value)
            .sum::<f64>()
            + self.cash
    }

    /// Get the number of positions.
    pub fn position_count(&self) -> usize {
        self.positions.len()
    }
}

/// Risk metrics for a portfolio.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskMetrics {
    /// Confidence level used for VaR calculation (e.g., 0.95 for 95%)
    pub confidence_level: f64,
    /// Value at Risk in dollars
    pub var: f64,
    /// Value at Risk as percentage of portfolio
    pub var_percent: f64,
    /// Conditional VaR (Expected Shortfall) in dollars
    pub cvar: f64,
    /// Conditional VaR as percentage of portfolio
    pub cvar_percent: f64,
    /// Sharpe ratio (annualized risk-adjusted return)
    pub sharpe_ratio: f64,
    /// Sortino ratio (downside risk-adjusted return)
    pub sortino_ratio: f64,
    /// Maximum drawdown percentage
    pub max_drawdown_percent: f64,
    /// Annualized volatility percentage
    pub volatility_percent: f64,
    /// Daily mean return percentage
    pub daily_mean_return_percent: f64,
    /// Total portfolio value used in calculations
    pub total_portfolio_value: f64,
}

/// Result of a backtest run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestResult {
    /// Strategy identifier
    pub strategy: String,
    /// Human-readable strategy name
    pub strategy_name: String,
    /// Symbols traded
    pub symbols: Vec<String>,
    /// Start date (YYYY-MM-DD)
    pub start_date: String,
    /// End date (YYYY-MM-DD)
    pub end_date: String,
    /// Total return percentage
    pub total_return_percent: f64,
    /// Sharpe ratio
    pub sharpe_ratio: f64,
    /// Maximum drawdown percentage
    pub max_drawdown_percent: f64,
    /// Total number of trades
    pub total_trades: u32,
    /// Win rate percentage
    pub win_rate_percent: f64,
}

/// A single trade record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    /// Stock symbol
    pub symbol: String,
    /// Buy or Sell
    pub side: TradeSide,
    /// Number of shares
    pub shares: f64,
    /// Price per share at execution
    pub price: f64,
    /// Total value of the trade
    pub value: f64,
    /// Realized P&L (for closing trades)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pnl: Option<f64>,
    /// When the trade was executed
    pub executed_at: DateTime<Utc>,
}

impl Trade {
    /// Create a new trade.
    pub fn new(symbol: &str, side: TradeSide, shares: f64, price: f64) -> Self {
        Self {
            symbol: symbol.to_uppercase(),
            side,
            shares,
            price,
            value: shares * price,
            pnl: None,
            executed_at: Utc::now(),
        }
    }

    /// Create a closing trade with P&L.
    pub fn with_pnl(mut self, pnl: f64) -> Self {
        self.pnl = Some(pnl);
        self
    }
}

/// Trade direction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TradeSide {
    Buy,
    Sell,
}

/// Built-in trading strategy definition.
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

/// Parameters for different strategy types.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StrategyParameters {
    /// Lookback period for momentum
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookback_period: Option<usize>,
    /// Momentum threshold
    #[serde(skip_serializing_if = "Option::is_none")]
    pub momentum_threshold: Option<f64>,
    /// Bollinger Band period
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bb_period: Option<usize>,
    /// Bollinger Band standard deviations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bb_std: Option<f64>,
    /// Short SMA period
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_period: Option<usize>,
    /// Long SMA period
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_period: Option<usize>,
    /// RSI period
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rsi_period: Option<usize>,
    /// RSI oversold threshold
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oversold: Option<f64>,
    /// RSI overbought threshold
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overbought: Option<f64>,
}

/// API response wrapper for success cases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    /// Create a successful response.
    pub fn ok(data: T) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    /// Create an error response.
    pub fn err(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_new() {
        let pos = Position::new("aapl", 10.0, 150.0);
        assert_eq!(pos.symbol, "AAPL");
        assert_eq!(pos.shares, 10.0);
        assert_eq!(pos.cost_basis, 150.0);
        assert!(pos.current_price.is_none());
    }

    #[test]
    fn test_position_with_price() {
        let pos = Position::new("AAPL", 10.0, 150.0);
        let pos = pos.with_price(175.0);

        assert_eq!(pos.current_price, Some(175.0));
        assert_eq!(pos.market_value, Some(1750.0));
        assert_eq!(pos.gain_loss, Some(250.0));
        // 250 / 1500 = 16.67%
        assert!((pos.gain_loss_percent.unwrap() - 16.666666666666668).abs() < 0.001);
    }

    #[test]
    fn test_portfolio_total_cost() {
        let mut portfolio = Portfolio::new();
        portfolio.positions.push(Position::new("AAPL", 10.0, 150.0));
        portfolio.positions.push(Position::new("GOOGL", 5.0, 100.0));

        assert_eq!(portfolio.total_cost(), 2000.0); // 1500 + 500
    }

    #[test]
    fn test_trade_new() {
        let trade = Trade::new("AAPL", TradeSide::Buy, 10.0, 150.0);
        assert_eq!(trade.symbol, "AAPL");
        assert_eq!(trade.value, 1500.0);
        assert!(trade.pnl.is_none());
    }

    #[test]
    fn test_api_response() {
        let response: ApiResponse<String> = ApiResponse::ok("test".to_string());
        assert!(response.ok);
        assert_eq!(response.data, Some("test".to_string()));

        let err_response: ApiResponse<String> = ApiResponse::err("error");
        assert!(!err_response.ok);
        assert_eq!(err_response.error, Some("error".to_string()));
    }
}
