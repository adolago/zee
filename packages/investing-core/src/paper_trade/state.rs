//! Paper trading state machine.

use crate::types::{Position, Trade, TradeSide};
use crate::{Error, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;

/// Paper trading session state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperTradingState {
    /// Whether paper trading is currently active
    pub active: bool,
    /// Strategy identifier
    pub strategy: Option<String>,
    /// Human-readable strategy name
    pub strategy_name: Option<String>,
    /// Symbols being traded
    pub symbols: Vec<String>,
    /// Current cash balance
    pub capital: f64,
    /// Starting capital
    pub starting_capital: f64,
    /// Current positions
    pub positions: Vec<PaperPosition>,
    /// Trade history
    pub trades: Vec<Trade>,
    /// When the session started
    pub started_at: Option<DateTime<Utc>>,
    /// When the session was last updated
    pub updated_at: Option<DateTime<Utc>>,
    /// Results from last completed session
    pub last_session: Option<PaperTradingResult>,
}

/// A position in paper trading (extends Position with entry info).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperPosition {
    /// Stock symbol
    pub symbol: String,
    /// Number of shares
    pub shares: f64,
    /// Entry price
    pub entry_price: f64,
    /// Current price (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_price: Option<f64>,
    /// Current market value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub market_value: Option<f64>,
    /// Unrealized P&L
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unrealized_pnl: Option<f64>,
    /// Unrealized P&L percentage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pnl_percent: Option<f64>,
    /// When the position was opened
    pub opened_at: DateTime<Utc>,
}

impl PaperPosition {
    /// Create a new paper position.
    pub fn new(symbol: &str, shares: f64, entry_price: f64) -> Self {
        Self {
            symbol: symbol.to_uppercase(),
            shares,
            entry_price,
            current_price: None,
            market_value: None,
            unrealized_pnl: None,
            pnl_percent: None,
            opened_at: Utc::now(),
        }
    }

    /// Update position with current price.
    pub fn with_price(&self, current_price: f64) -> Self {
        let market_value = self.shares * current_price;
        let entry_value = self.shares * self.entry_price;
        let unrealized_pnl = market_value - entry_value;
        let pnl_percent = if entry_value > 0.0 {
            (unrealized_pnl / entry_value) * 100.0
        } else {
            0.0
        };

        Self {
            current_price: Some(current_price),
            market_value: Some(market_value),
            unrealized_pnl: Some(unrealized_pnl),
            pnl_percent: Some(pnl_percent),
            ..self.clone()
        }
    }

    /// Convert to a standard Position.
    pub fn to_position(&self) -> Position {
        Position {
            symbol: self.symbol.clone(),
            shares: self.shares,
            cost_basis: self.entry_price,
            current_price: self.current_price,
            market_value: self.market_value,
            gain_loss: self.unrealized_pnl,
            gain_loss_percent: self.pnl_percent,
        }
    }
}

/// Results from a completed paper trading session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperTradingResult {
    /// Strategy used
    pub strategy: Option<String>,
    /// Strategy name
    pub strategy_name: Option<String>,
    /// Symbols traded
    pub symbols: Vec<String>,
    /// Starting capital
    pub starting_capital: f64,
    /// Final capital
    pub final_capital: f64,
    /// Total return percentage
    pub total_return_percent: f64,
    /// Total number of trades
    pub total_trades: usize,
    /// Win rate percentage
    pub win_rate_percent: f64,
    /// When the session started
    pub started_at: Option<DateTime<Utc>>,
    /// When the session stopped
    pub stopped_at: Option<DateTime<Utc>>,
}

impl Default for PaperTradingState {
    fn default() -> Self {
        Self {
            active: false,
            strategy: None,
            strategy_name: None,
            symbols: Vec::new(),
            capital: 0.0,
            starting_capital: 0.0,
            positions: Vec::new(),
            trades: Vec::new(),
            started_at: None,
            updated_at: None,
            last_session: None,
        }
    }
}

impl PaperTradingState {
    /// Create a new inactive paper trading state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the default state file path.
    pub fn default_path() -> PathBuf {
        if let Ok(path) = env::var("ZEE_INVESTING_PAPER_TRADING_FILE") {
            return PathBuf::from(path);
        }

        directories::BaseDirs::new()
            .map(|dirs| dirs.home_dir().join(".zee/investing/paper_trading.json"))
            .unwrap_or_else(|| PathBuf::from("paper_trading.json"))
    }

    /// Load state from the default path.
    pub fn load() -> Result<Self> {
        Self::load_from_path(&Self::default_path())
    }

    /// Load state from a specific path.
    pub fn load_from_path(path: &PathBuf) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }

        let content = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&content)?)
    }

    /// Save state to the default path.
    pub fn save(&mut self) -> Result<()> {
        self.save_to_path(&Self::default_path())
    }

    /// Save state to a specific path.
    pub fn save_to_path(&mut self, path: &PathBuf) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        self.updated_at = Some(Utc::now());
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }

    /// Start a new paper trading session.
    pub fn start(
        &mut self,
        strategy: &str,
        strategy_name: &str,
        symbols: Vec<String>,
        capital: f64,
    ) -> Result<()> {
        if self.active {
            return Err(Error::InvalidOperation(
                "Paper trading already active. Stop current session first.".to_string(),
            ));
        }

        self.active = true;
        self.strategy = Some(strategy.to_lowercase());
        self.strategy_name = Some(strategy_name.to_string());
        self.symbols = symbols.into_iter().map(|s| s.to_uppercase()).collect();
        self.capital = capital;
        self.starting_capital = capital;
        self.positions = Vec::new();
        self.trades = Vec::new();
        self.started_at = Some(Utc::now());
        self.updated_at = Some(Utc::now());

        Ok(())
    }

    /// Stop the current paper trading session.
    pub fn stop(&mut self) -> Result<PaperTradingResult> {
        if !self.active {
            return Err(Error::InvalidOperation(
                "No active paper trading session".to_string(),
            ));
        }

        // Calculate final results
        let position_value: f64 = self
            .positions
            .iter()
            .filter_map(|p| p.market_value)
            .sum();
        let final_capital = self.capital + position_value;

        let total_return_percent = if self.starting_capital > 0.0 {
            ((final_capital - self.starting_capital) / self.starting_capital) * 100.0
        } else {
            0.0
        };

        let winning_trades = self
            .trades
            .iter()
            .filter(|t| t.pnl.map(|p| p > 0.0).unwrap_or(false))
            .count();
        let win_rate_percent = if !self.trades.is_empty() {
            (winning_trades as f64 / self.trades.len() as f64) * 100.0
        } else {
            0.0
        };

        let result = PaperTradingResult {
            strategy: self.strategy.clone(),
            strategy_name: self.strategy_name.clone(),
            symbols: self.symbols.clone(),
            starting_capital: self.starting_capital,
            final_capital,
            total_return_percent,
            total_trades: self.trades.len(),
            win_rate_percent,
            started_at: self.started_at,
            stopped_at: Some(Utc::now()),
        };

        // Reset state
        self.active = false;
        self.strategy = None;
        self.strategy_name = None;
        self.symbols = Vec::new();
        self.capital = 0.0;
        self.starting_capital = 0.0;
        self.positions = Vec::new();
        self.trades = Vec::new();
        self.started_at = None;
        self.last_session = Some(result.clone());

        Ok(result)
    }

    /// Execute a buy trade.
    pub fn buy(&mut self, symbol: &str, shares: f64, price: f64) -> Result<Trade> {
        if !self.active {
            return Err(Error::InvalidOperation(
                "No active paper trading session".to_string(),
            ));
        }

        let cost = shares * price;
        if cost > self.capital {
            return Err(Error::InvalidOperation(format!(
                "Insufficient capital. Need ${:.2}, have ${:.2}",
                cost, self.capital
            )));
        }

        let symbol_upper = symbol.to_uppercase();

        // Deduct capital
        self.capital -= cost;

        // Update or create position
        if let Some(pos) = self
            .positions
            .iter_mut()
            .find(|p| p.symbol == symbol_upper)
        {
            // Average down/up
            let old_value = pos.shares * pos.entry_price;
            let new_value = shares * price;
            let total_shares = pos.shares + shares;
            pos.entry_price = (old_value + new_value) / total_shares;
            pos.shares = total_shares;
        } else {
            self.positions
                .push(PaperPosition::new(&symbol_upper, shares, price));
        }

        // Record trade
        let trade = Trade::new(&symbol_upper, TradeSide::Buy, shares, price);
        self.trades.push(trade.clone());
        self.updated_at = Some(Utc::now());

        Ok(trade)
    }

    /// Execute a sell trade.
    pub fn sell(&mut self, symbol: &str, shares: f64, price: f64) -> Result<Trade> {
        if !self.active {
            return Err(Error::InvalidOperation(
                "No active paper trading session".to_string(),
            ));
        }

        let symbol_upper = symbol.to_uppercase();

        // Find position
        let pos_idx = self
            .positions
            .iter()
            .position(|p| p.symbol == symbol_upper)
            .ok_or_else(|| Error::PositionNotFound(symbol_upper.clone()))?;

        let position = &self.positions[pos_idx];
        if shares > position.shares {
            return Err(Error::InvalidOperation(format!(
                "Cannot sell {} shares, only have {}",
                shares, position.shares
            )));
        }

        // Calculate P&L
        let entry_value = shares * position.entry_price;
        let exit_value = shares * price;
        let pnl = exit_value - entry_value;

        // Add proceeds to capital
        self.capital += exit_value;

        // Update position
        let remaining_shares = position.shares - shares;
        if remaining_shares <= 0.0 {
            self.positions.remove(pos_idx);
        } else {
            self.positions[pos_idx].shares = remaining_shares;
        }

        // Record trade
        let trade = Trade::new(&symbol_upper, TradeSide::Sell, shares, price).with_pnl(pnl);
        self.trades.push(trade.clone());
        self.updated_at = Some(Utc::now());

        Ok(trade)
    }

    /// Get current status summary.
    pub fn status(&self) -> PaperTradingStatus {
        let position_value: f64 = self
            .positions
            .iter()
            .filter_map(|p| p.market_value)
            .sum();

        let total_value = self.capital + position_value;
        let total_return_percent = if self.starting_capital > 0.0 {
            ((total_value - self.starting_capital) / self.starting_capital) * 100.0
        } else {
            0.0
        };

        PaperTradingStatus {
            active: self.active,
            strategy: self.strategy_name.clone(),
            symbols: self.symbols.clone(),
            starting_capital: self.starting_capital,
            cash: self.capital,
            position_value,
            total_value,
            total_return_percent,
            position_count: self.positions.len(),
            trade_count: self.trades.len(),
            started_at: self.started_at,
            last_session: self.last_session.clone(),
        }
    }

    /// Update positions with current prices.
    pub fn update_prices(&mut self, prices: &[(String, f64)]) {
        for (symbol, price) in prices {
            if let Some(pos) = self
                .positions
                .iter_mut()
                .find(|p| p.symbol == symbol.to_uppercase())
            {
                *pos = pos.with_price(*price);
            }
        }
        self.updated_at = Some(Utc::now());
    }
}

/// Paper trading status summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperTradingStatus {
    pub active: bool,
    pub strategy: Option<String>,
    pub symbols: Vec<String>,
    pub starting_capital: f64,
    pub cash: f64,
    pub position_value: f64,
    pub total_value: f64,
    pub total_return_percent: f64,
    pub position_count: usize,
    pub trade_count: usize,
    pub started_at: Option<DateTime<Utc>>,
    pub last_session: Option<PaperTradingResult>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_start_session() {
        let mut state = PaperTradingState::new();

        state
            .start(
                "momentum",
                "Momentum Strategy",
                vec!["AAPL".to_string(), "GOOGL".to_string()],
                100000.0,
            )
            .unwrap();

        assert!(state.active);
        assert_eq!(state.strategy, Some("momentum".to_string()));
        assert_eq!(state.capital, 100000.0);
        assert_eq!(state.symbols, vec!["AAPL", "GOOGL"]);
    }

    #[test]
    fn test_start_already_active() {
        let mut state = PaperTradingState::new();
        state.start("momentum", "Test", vec![], 100000.0).unwrap();

        let result = state.start("other", "Other", vec![], 50000.0);
        assert!(matches!(result, Err(Error::InvalidOperation(_))));
    }

    #[test]
    fn test_buy_trade() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 100000.0).unwrap();

        let trade = state.buy("AAPL", 10.0, 150.0).unwrap();

        assert_eq!(trade.symbol, "AAPL");
        assert_eq!(trade.shares, 10.0);
        assert_eq!(trade.price, 150.0);
        assert_eq!(state.capital, 98500.0); // 100000 - 1500
        assert_eq!(state.positions.len(), 1);
        assert_eq!(state.positions[0].shares, 10.0);
    }

    #[test]
    fn test_buy_insufficient_capital() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 1000.0).unwrap();

        let result = state.buy("AAPL", 100.0, 150.0); // 15000 > 1000
        assert!(matches!(result, Err(Error::InvalidOperation(_))));
    }

    #[test]
    fn test_sell_trade() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 100000.0).unwrap();

        // Buy first
        state.buy("AAPL", 10.0, 150.0).unwrap();

        // Sell at higher price
        let trade = state.sell("AAPL", 5.0, 175.0).unwrap();

        assert_eq!(trade.side, TradeSide::Sell);
        assert_eq!(trade.pnl, Some(125.0)); // (175 - 150) * 5
        assert_eq!(state.capital, 98500.0 + 875.0); // Original - buy + sell proceeds
        assert_eq!(state.positions[0].shares, 5.0);
    }

    #[test]
    fn test_sell_no_position() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 100000.0).unwrap();

        let result = state.sell("AAPL", 10.0, 150.0);
        assert!(matches!(result, Err(Error::PositionNotFound(_))));
    }

    #[test]
    fn test_sell_removes_position() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 100000.0).unwrap();

        state.buy("AAPL", 10.0, 150.0).unwrap();
        state.sell("AAPL", 10.0, 150.0).unwrap();

        assert!(state.positions.is_empty());
    }

    #[test]
    fn test_stop_session() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test Strategy", vec!["AAPL".to_string()], 100000.0).unwrap();

        // Make some trades
        state.buy("AAPL", 10.0, 150.0).unwrap();
        state.sell("AAPL", 10.0, 175.0).unwrap(); // +250 profit

        let result = state.stop().unwrap();

        assert!(!state.active);
        assert_eq!(result.total_trades, 2);
        assert!(result.total_return_percent > 0.0);
        assert!(state.last_session.is_some());
    }

    #[test]
    fn test_status() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 100000.0).unwrap();

        state.buy("AAPL", 10.0, 150.0).unwrap();

        // Update with current price
        state.update_prices(&[("AAPL".to_string(), 175.0)]);

        let status = state.status();

        assert!(status.active);
        assert_eq!(status.cash, 98500.0);
        assert_eq!(status.position_value, 1750.0);
        assert_eq!(status.total_value, 100250.0);
        assert!(status.total_return_percent > 0.0);
    }

    #[test]
    fn test_cost_averaging() {
        let mut state = PaperTradingState::new();
        state.start("test", "Test", vec![], 100000.0).unwrap();

        // Buy at different prices
        state.buy("AAPL", 10.0, 150.0).unwrap();
        state.buy("AAPL", 10.0, 170.0).unwrap();

        // Should have 20 shares at average of 160
        assert_eq!(state.positions.len(), 1);
        assert_eq!(state.positions[0].shares, 20.0);
        assert!((state.positions[0].entry_price - 160.0).abs() < 0.01);
    }
}
