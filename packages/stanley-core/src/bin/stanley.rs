//! Stanley CLI - Command line interface for Stanley trading operations.
//!
//! This binary provides JSON output for integration with TypeScript bridge.

use clap::{Parser, Subcommand};
use serde_json::json;
use stanley_core::{
    paper_trade::{get_strategy, list_strategies, PaperTradingState},
    portfolio::PortfolioTracker,
    serve, ApiResponse, ServerOptions, StanleyRuntime,
};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "stanley")]
#[command(about = "Stanley trading CLI - portfolio and risk management")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the Stanley HTTP runtime
    Serve {
        /// Interface to bind the HTTP server to
        #[arg(long)]
        host: Option<String>,
        /// Port to bind the HTTP server to
        #[arg(long)]
        port: Option<u16>,
        /// Override the Stanley runtime data directory
        #[arg(long)]
        data_dir: Option<PathBuf>,
    },
    /// Portfolio management commands
    Portfolio {
        #[command(subcommand)]
        action: PortfolioAction,
    },
    /// Paper trading commands
    Paper {
        #[command(subcommand)]
        action: PaperAction,
    },
    /// Strategy commands
    Strategy {
        #[command(subcommand)]
        action: StrategyAction,
    },
    /// Calculate risk metrics
    Risk {
        /// Confidence level for VaR (0.95 = 95%)
        #[arg(long, default_value = "0.95")]
        confidence: f64,
    },
}

#[derive(Subcommand)]
enum PortfolioAction {
    /// Get portfolio status
    Status,
    /// List all positions
    Positions,
    /// Add a position
    Add {
        /// Stock symbol
        #[arg(short, long)]
        symbol: String,
        /// Number of shares
        #[arg(short = 'n', long)]
        shares: f64,
        /// Cost per share
        #[arg(short, long)]
        cost: f64,
    },
    /// Remove a position
    Remove {
        /// Stock symbol
        #[arg(short, long)]
        symbol: String,
    },
    /// Get or set cash balance
    Cash {
        /// Cash amount to set (optional)
        #[arg(short, long)]
        set: Option<f64>,
    },
}

#[derive(Subcommand)]
enum PaperAction {
    /// Start paper trading
    Start {
        /// Strategy to use
        #[arg(short, long)]
        strategy: String,
        /// Symbols to trade (comma-separated)
        #[arg(short = 'y', long)]
        symbols: String,
        /// Starting capital
        #[arg(short, long, default_value = "100000")]
        capital: f64,
    },
    /// Stop paper trading
    Stop,
    /// Get paper trading status
    Status,
    /// Execute a buy order
    Buy {
        /// Stock symbol
        #[arg(short, long)]
        symbol: String,
        /// Number of shares
        #[arg(short = 'n', long)]
        shares: f64,
        /// Price per share
        #[arg(short, long)]
        price: f64,
    },
    /// Execute a sell order
    Sell {
        /// Stock symbol
        #[arg(short, long)]
        symbol: String,
        /// Number of shares
        #[arg(short = 'n', long)]
        shares: f64,
        /// Price per share
        #[arg(short, long)]
        price: f64,
    },
}

#[derive(Subcommand)]
enum StrategyAction {
    /// List available strategies
    List,
    /// Get strategy details
    Get {
        /// Strategy ID
        #[arg(short, long)]
        id: String,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Serve {
            host,
            port,
            data_dir,
        } => {
            let defaults = ServerOptions::default();
            let options = ServerOptions {
                host: host.unwrap_or(defaults.host),
                port: port.unwrap_or(defaults.port),
                data_dir: data_dir.unwrap_or_else(StanleyRuntime::default_data_dir),
            };

            if let Err(error) = serve(options) {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        Commands::Portfolio { action } => println!("{}", handle_portfolio(action)),
        Commands::Paper { action } => println!("{}", handle_paper(action)),
        Commands::Strategy { action } => println!("{}", handle_strategy(action)),
        Commands::Risk { confidence } => println!("{}", handle_risk(confidence)),
    }
}

fn handle_portfolio(action: PortfolioAction) -> String {
    let mut tracker = PortfolioTracker::new();

    match action {
        PortfolioAction::Status => {
            let portfolio = tracker.get();
            serde_json::to_string_pretty(&ApiResponse::ok(json!({
                "positions": portfolio.positions,
                "position_count": portfolio.position_count(),
                "total_cost": portfolio.total_cost(),
                "cash": portfolio.cash,
                "updated_at": portfolio.updated_at,
            })))
            .unwrap()
        }
        PortfolioAction::Positions => {
            let positions = tracker.positions();
            serde_json::to_string_pretty(&ApiResponse::ok(json!({
                "positions": positions,
            })))
            .unwrap()
        }
        PortfolioAction::Add {
            symbol,
            shares,
            cost,
        } => {
            let (position, was_update) = tracker.add_position(&symbol, shares, cost);
            if let Err(e) = tracker.save() {
                return serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string()))
                    .unwrap();
            }
            serde_json::to_string_pretty(&ApiResponse::ok(json!({
                "position": position,
                "action": if was_update { "updated" } else { "added" },
            })))
            .unwrap()
        }
        PortfolioAction::Remove { symbol } => match tracker.remove_position(&symbol) {
            Ok(removed) => {
                if let Err(e) = tracker.save() {
                    return serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string()))
                        .unwrap();
                }
                serde_json::to_string_pretty(&ApiResponse::ok(json!({
                    "removed": removed,
                })))
                .unwrap()
            }
            Err(e) => serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string())).unwrap(),
        },
        PortfolioAction::Cash { set } => {
            if let Some(amount) = set {
                tracker.set_cash(amount);
                if let Err(e) = tracker.save() {
                    return serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string()))
                        .unwrap();
                }
            }
            serde_json::to_string_pretty(&ApiResponse::ok(json!({
                "cash": tracker.cash(),
            })))
            .unwrap()
        }
    }
}

fn handle_paper(action: PaperAction) -> String {
    let mut state = PaperTradingState::load().unwrap_or_default();

    match action {
        PaperAction::Start {
            strategy,
            symbols,
            capital,
        } => {
            let strategy_info = match get_strategy(&strategy) {
                Some(s) => s,
                None => {
                    let available: Vec<_> =
                        list_strategies().iter().map(|s| s.id.clone()).collect();
                    return serde_json::to_string_pretty(&ApiResponse::<()>::err(format!(
                        "Unknown strategy: {}. Available: {:?}",
                        strategy, available
                    )))
                    .unwrap();
                }
            };

            let symbols_vec: Vec<String> =
                symbols.split(',').map(|s| s.trim().to_string()).collect();

            match state.start(&strategy_info.id, &strategy_info.name, symbols_vec, capital) {
                Ok(()) => {
                    if let Err(e) = state.save() {
                        return serde_json::to_string_pretty(&ApiResponse::<()>::err(
                            e.to_string(),
                        ))
                        .unwrap();
                    }
                    serde_json::to_string_pretty(&ApiResponse::ok(json!({
                        "message": "Paper trading started",
                        "strategy": strategy_info.name,
                        "symbols": state.symbols,
                        "capital": capital,
                    })))
                    .unwrap()
                }
                Err(e) => {
                    serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string())).unwrap()
                }
            }
        }
        PaperAction::Stop => match state.stop() {
            Ok(result) => {
                if let Err(e) = state.save() {
                    return serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string()))
                        .unwrap();
                }
                serde_json::to_string_pretty(&ApiResponse::ok(result)).unwrap()
            }
            Err(e) => serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string())).unwrap(),
        },
        PaperAction::Status => {
            let status = state.status();
            serde_json::to_string_pretty(&ApiResponse::ok(status)).unwrap()
        }
        PaperAction::Buy {
            symbol,
            shares,
            price,
        } => match state.buy(&symbol, shares, price) {
            Ok(trade) => {
                if let Err(e) = state.save() {
                    return serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string()))
                        .unwrap();
                }
                serde_json::to_string_pretty(&ApiResponse::ok(json!({
                    "trade": trade,
                    "capital": state.capital,
                })))
                .unwrap()
            }
            Err(e) => serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string())).unwrap(),
        },
        PaperAction::Sell {
            symbol,
            shares,
            price,
        } => match state.sell(&symbol, shares, price) {
            Ok(trade) => {
                if let Err(e) = state.save() {
                    return serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string()))
                        .unwrap();
                }
                serde_json::to_string_pretty(&ApiResponse::ok(json!({
                    "trade": trade,
                    "capital": state.capital,
                })))
                .unwrap()
            }
            Err(e) => serde_json::to_string_pretty(&ApiResponse::<()>::err(e.to_string())).unwrap(),
        },
    }
}

fn handle_strategy(action: StrategyAction) -> String {
    match action {
        StrategyAction::List => {
            let strategies = list_strategies();
            serde_json::to_string_pretty(&ApiResponse::ok(json!({
                "strategies": strategies,
            })))
            .unwrap()
        }
        StrategyAction::Get { id } => match get_strategy(&id) {
            Some(strategy) => serde_json::to_string_pretty(&ApiResponse::ok(strategy)).unwrap(),
            None => serde_json::to_string_pretty(&ApiResponse::<()>::err(format!(
                "Strategy not found: {}",
                id
            )))
            .unwrap(),
        },
    }
}

fn handle_risk(_confidence: f64) -> String {
    // For risk calculation, we need historical returns
    // In the CLI, we return a placeholder since we don't have market data access
    // The Python FFI layer will provide actual returns
    serde_json::to_string_pretty(&ApiResponse::<()>::err(
        "Risk metrics require historical returns. Use Python FFI layer for market data access."
            .to_string(),
    ))
    .unwrap()
}
