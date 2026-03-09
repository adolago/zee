//! Portfolio position tracking and persistence.

use crate::types::{Portfolio, Position};
use crate::{Error, Result};
use chrono::Utc;
use std::env;
use std::fs;
use std::path::PathBuf;

/// Portfolio tracker that manages positions and persists to JSON.
#[derive(Debug)]
pub struct PortfolioTracker {
    /// Path to the portfolio JSON file
    path: PathBuf,
    /// In-memory portfolio state
    portfolio: Portfolio,
}

impl PortfolioTracker {
    /// Create a new portfolio tracker with the default path.
    ///
    /// Default path: `~/.zee/investing/portfolio.json`
    /// Can be overridden with `ZEE_INVESTING_PORTFOLIO_FILE` environment variable.
    pub fn new() -> Self {
        let path = Self::default_path();
        let portfolio = Self::load_from_path(&path).unwrap_or_default();
        Self { path, portfolio }
    }

    /// Create a tracker with a custom path.
    pub fn with_path(path: PathBuf) -> Self {
        let portfolio = Self::load_from_path(&path).unwrap_or_default();
        Self { path, portfolio }
    }

    /// Create an in-memory tracker (no persistence).
    pub fn in_memory() -> Self {
        Self {
            path: PathBuf::new(),
            portfolio: Portfolio::default(),
        }
    }

    /// Get the default portfolio file path.
    pub fn default_path() -> PathBuf {
        if let Ok(path) = env::var("ZEE_INVESTING_PORTFOLIO_FILE") {
            return PathBuf::from(path);
        }

        directories::BaseDirs::new()
            .map(|dirs| dirs.home_dir().join(".zee/investing/portfolio.json"))
            .unwrap_or_else(|| PathBuf::from("portfolio.json"))
    }

    /// Get the current path.
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Load portfolio from a specific path.
    fn load_from_path(path: &PathBuf) -> Result<Portfolio> {
        if !path.exists() {
            return Ok(Portfolio::default());
        }

        let content = fs::read_to_string(path)?;
        let data: serde_json::Value = serde_json::from_str(&content)?;

        // Handle legacy format (list of positions)
        if data.is_array() {
            let positions: Vec<Position> = serde_json::from_value(data)?;
            return Ok(Portfolio {
                positions,
                cash: 0.0,
                created_at: None,
                updated_at: None,
            });
        }

        Ok(serde_json::from_value(data)?)
    }

    /// Save the current portfolio to disk.
    pub fn save(&mut self) -> Result<()> {
        // Skip if in-memory only
        if self.path.as_os_str().is_empty() {
            return Ok(());
        }

        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Update timestamps
        if self.portfolio.created_at.is_none() {
            self.portfolio.created_at = Some(Utc::now());
        }
        self.portfolio.updated_at = Some(Utc::now());

        let content = serde_json::to_string_pretty(&self.portfolio)?;
        fs::write(&self.path, content)?;
        Ok(())
    }

    /// Reload the portfolio from disk.
    pub fn reload(&mut self) -> Result<()> {
        self.portfolio = Self::load_from_path(&self.path)?;
        Ok(())
    }

    /// Get a reference to the current portfolio.
    pub fn get(&self) -> &Portfolio {
        &self.portfolio
    }

    /// Get a mutable reference to the current portfolio.
    pub fn get_mut(&mut self) -> &mut Portfolio {
        &mut self.portfolio
    }

    /// Get all positions.
    pub fn positions(&self) -> &[Position] {
        &self.portfolio.positions
    }

    /// Find a position by symbol.
    pub fn find_position(&self, symbol: &str) -> Option<&Position> {
        let symbol_upper = symbol.to_uppercase();
        self.portfolio
            .positions
            .iter()
            .find(|p| p.symbol == symbol_upper)
    }

    /// Find a mutable position by symbol.
    pub fn find_position_mut(&mut self, symbol: &str) -> Option<&mut Position> {
        let symbol_upper = symbol.to_uppercase();
        self.portfolio
            .positions
            .iter_mut()
            .find(|p| p.symbol == symbol_upper)
    }

    /// Add or update a position in the portfolio.
    ///
    /// If the position already exists, applies cost averaging:
    /// - New total shares = old shares + new shares
    /// - New avg cost = (old_shares * old_cost + new_shares * new_cost) / total_shares
    ///
    /// Returns the updated position and whether it was an update (true) or add (false).
    pub fn add_position(&mut self, symbol: &str, shares: f64, cost_basis: f64) -> (Position, bool) {
        let symbol_upper = symbol.to_uppercase();

        // Check if position exists
        if let Some(idx) = self
            .portfolio
            .positions
            .iter()
            .position(|p| p.symbol == symbol_upper)
        {
            // Update existing position with cost averaging
            let existing = &self.portfolio.positions[idx];
            let old_shares = existing.shares;
            let old_cost = existing.cost_basis;

            let total_shares = old_shares + shares;
            let avg_cost = if total_shares > 0.0 {
                ((old_shares * old_cost) + (shares * cost_basis)) / total_shares
            } else {
                0.0
            };

            let position = Position::new(&symbol_upper, total_shares, avg_cost);
            self.portfolio.positions[idx] = position.clone();
            (position, true)
        } else {
            // Add new position
            let position = Position::new(&symbol_upper, shares, cost_basis);
            self.portfolio.positions.push(position.clone());
            (position, false)
        }
    }

    /// Remove a position from the portfolio.
    ///
    /// Returns the removed position if found.
    pub fn remove_position(&mut self, symbol: &str) -> Result<Position> {
        let symbol_upper = symbol.to_uppercase();

        if let Some(idx) = self
            .portfolio
            .positions
            .iter()
            .position(|p| p.symbol == symbol_upper)
        {
            Ok(self.portfolio.positions.remove(idx))
        } else {
            Err(Error::PositionNotFound(symbol_upper))
        }
    }

    /// Update the shares of a position.
    ///
    /// If shares becomes zero or negative, the position is removed.
    pub fn update_shares(&mut self, symbol: &str, shares: f64) -> Result<Option<Position>> {
        let symbol_upper = symbol.to_uppercase();

        if shares <= 0.0 {
            return Ok(Some(self.remove_position(&symbol_upper)?));
        }

        if let Some(pos) = self.find_position_mut(&symbol_upper) {
            pos.shares = shares;
            Ok(Some(pos.clone()))
        } else {
            Err(Error::PositionNotFound(symbol_upper))
        }
    }

    /// Get or set the cash balance.
    pub fn cash(&self) -> f64 {
        self.portfolio.cash
    }

    /// Set the cash balance.
    pub fn set_cash(&mut self, cash: f64) {
        self.portfolio.cash = cash;
    }

    /// Add to the cash balance.
    pub fn add_cash(&mut self, amount: f64) {
        self.portfolio.cash += amount;
    }

    /// Calculate the total cost basis of all positions.
    pub fn total_cost(&self) -> f64 {
        self.portfolio.total_cost()
    }

    /// Clear all positions (keeps cash).
    pub fn clear_positions(&mut self) {
        self.portfolio.positions.clear();
    }
}

impl Default for PortfolioTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn create_temp_tracker() -> PortfolioTracker {
        let dir = tempdir().unwrap();
        let path = dir.path().join("portfolio.json");
        // Don't drop dir, leak it so file persists during test
        std::mem::forget(dir);
        PortfolioTracker::with_path(path)
    }

    #[test]
    fn test_add_new_position() {
        let mut tracker = PortfolioTracker::in_memory();
        let (position, was_update) = tracker.add_position("AAPL", 10.0, 150.0);

        assert!(!was_update);
        assert_eq!(position.symbol, "AAPL");
        assert_eq!(position.shares, 10.0);
        assert_eq!(position.cost_basis, 150.0);
        assert_eq!(tracker.positions().len(), 1);
    }

    #[test]
    fn test_add_position_cost_averaging() {
        let mut tracker = PortfolioTracker::in_memory();

        // Initial purchase: 10 shares at $150
        tracker.add_position("AAPL", 10.0, 150.0);

        // Second purchase: 10 shares at $170
        let (position, was_update) = tracker.add_position("AAPL", 10.0, 170.0);

        assert!(was_update);
        assert_eq!(position.shares, 20.0);
        // (10 * 150 + 10 * 170) / 20 = 3200 / 20 = 160
        assert_eq!(position.cost_basis, 160.0);
    }

    #[test]
    fn test_remove_position() {
        let mut tracker = PortfolioTracker::in_memory();
        tracker.add_position("AAPL", 10.0, 150.0);
        tracker.add_position("GOOGL", 5.0, 100.0);

        let removed = tracker.remove_position("AAPL").unwrap();
        assert_eq!(removed.symbol, "AAPL");
        assert_eq!(tracker.positions().len(), 1);
        assert_eq!(tracker.positions()[0].symbol, "GOOGL");
    }

    #[test]
    fn test_remove_position_not_found() {
        let mut tracker = PortfolioTracker::in_memory();
        let result = tracker.remove_position("AAPL");
        assert!(matches!(result, Err(Error::PositionNotFound(_))));
    }

    #[test]
    fn test_find_position() {
        let mut tracker = PortfolioTracker::in_memory();
        tracker.add_position("AAPL", 10.0, 150.0);

        assert!(tracker.find_position("AAPL").is_some());
        assert!(tracker.find_position("aapl").is_some()); // Case insensitive
        assert!(tracker.find_position("GOOGL").is_none());
    }

    #[test]
    fn test_cash_operations() {
        let mut tracker = PortfolioTracker::in_memory();

        assert_eq!(tracker.cash(), 0.0);

        tracker.set_cash(10000.0);
        assert_eq!(tracker.cash(), 10000.0);

        tracker.add_cash(500.0);
        assert_eq!(tracker.cash(), 10500.0);

        tracker.add_cash(-200.0);
        assert_eq!(tracker.cash(), 10300.0);
    }

    #[test]
    fn test_persistence() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("portfolio.json");

        // Create and save
        {
            let mut tracker = PortfolioTracker::with_path(path.clone());
            tracker.add_position("AAPL", 10.0, 150.0);
            tracker.set_cash(5000.0);
            tracker.save().unwrap();
        }

        // Reload and verify
        {
            let tracker = PortfolioTracker::with_path(path);
            assert_eq!(tracker.positions().len(), 1);
            assert_eq!(tracker.positions()[0].symbol, "AAPL");
            assert_eq!(tracker.cash(), 5000.0);
        }
    }

    #[test]
    fn test_total_cost() {
        let mut tracker = PortfolioTracker::in_memory();
        tracker.add_position("AAPL", 10.0, 150.0); // 1500
        tracker.add_position("GOOGL", 5.0, 100.0); // 500

        assert_eq!(tracker.total_cost(), 2000.0);
    }

    #[test]
    fn test_symbol_case_insensitive() {
        let mut tracker = PortfolioTracker::in_memory();

        tracker.add_position("aapl", 10.0, 150.0);
        assert_eq!(tracker.positions()[0].symbol, "AAPL");

        // Adding with different case should update same position
        let (pos, was_update) = tracker.add_position("AAPL", 5.0, 160.0);
        assert!(was_update);
        assert_eq!(tracker.positions().len(), 1);
        assert_eq!(pos.shares, 15.0);
    }
}
