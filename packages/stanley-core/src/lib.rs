//! Stanley Core - Trading and portfolio management library.
//!
//! This crate provides the core functionality for the Stanley trading persona:
//!
//! - **Portfolio tracking**: Position management with cost averaging
//! - **Risk metrics**: VaR, Sharpe ratio, Sortino ratio, max drawdown
//! - **Technical indicators**: SMA, RSI
//! - **Paper trading**: Simulated trading state machine
//!
//! # Example
//!
//! ```rust,no_run
//! use stanley_core::portfolio::PortfolioTracker;
//!
//! // Create a tracker (uses default path ~/.zee/stanley/portfolio.json)
//! let mut tracker = PortfolioTracker::new();
//!
//! // Add a position (returns (Position, was_update))
//! let (position, was_update) = tracker.add_position("AAPL", 10.0, 150.0);
//! println!("Added: {} shares at ${}", position.shares, position.cost_basis);
//!
//! // Get portfolio summary
//! let portfolio = tracker.get();
//! println!("Total positions: {}", portfolio.position_count());
//! ```

pub mod indicators;
pub mod paper_trade;
pub mod portfolio;
pub mod research;
pub mod runtime;
pub mod server;
pub mod surface;
pub mod types;

// Re-export commonly used types
pub use types::{
    ApiResponse, BacktestResult, Portfolio, Position, RiskMetrics, Strategy, StrategyParameters,
    Trade, TradeSide,
};

// Re-export main functionality
pub use indicators::{
    bollinger_bands, crossover_signals, ema, macd, momentum, rsi, sma, BollingerBands, Macd,
};
pub use paper_trade::{get_strategy, list_strategies, PaperTradingState, BUILTIN_STRATEGIES};
pub use portfolio::{
    calculate_max_drawdown, calculate_risk_metrics, sharpe_ratio, sortino_ratio, value_at_risk,
    volatility, PortfolioPerformance, PortfolioTracker,
};
pub use runtime::{
    CloseTradeRequest, CreateEventRequest, CreatePersonRequest, CreateSectorRequest,
    CreateThesisRequest, CreateTradeRequest, GraphResponse, NoteResponse, SearchResult,
    StanleyRuntime, TradeStatsResponse,
};
pub use server::{serve, ServerOptions};

/// Error types for stanley-core operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Position not found: {0}")]
    PositionNotFound(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    #[error("Insufficient data: {0}")]
    InsufficientData(String),

    #[error("Unknown strategy: {0}")]
    UnknownStrategy(String),

    #[error("Not found: {0}")]
    NotFound(String),
}

/// Result type for stanley-core operations.
pub type Result<T> = std::result::Result<T, Error>;
