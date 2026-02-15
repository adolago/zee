//! Integration tests for Stanley GUI
//!
//! These tests verify the interaction between different components:
//! - API client with app state
//! - Notes view with data loading
//! - Tab switching and navigation
//! - Data transformation pipelines

use super::super::api::*;
use super::super::app::*;
use serde_json::json;

// ============================================================================
// API TO APP STATE INTEGRATION TESTS
// ============================================================================

#[test]
fn test_thesis_loading_pipeline() {
    // Simulate API response -> ThesisNote conversion pipeline

    let api_responses = vec![
        NoteResponse {
            name: "AAPL Bull Case".to_string(),
            path: "/notes/theses/AAPL.md".to_string(),
            content: "Strong conviction on Apple".to_string(),
            frontmatter: json!({
                "symbol": "AAPL",
                "status": "active",
                "conviction": "High",
                "entry_price": 150.0,
                "target_price": 200.0
            })
            .as_object()
            .unwrap()
            .clone(),
            created: "2024-01-01".to_string(),
            modified: "2024-01-15".to_string(),
        },
        NoteResponse {
            name: "MSFT Watchlist".to_string(),
            path: "/notes/theses/MSFT.md".to_string(),
            content: "Watching Microsoft for entry".to_string(),
            frontmatter: json!({
                "symbol": "MSFT",
                "status": "watchlist",
                "conviction": "Medium"
            })
            .as_object()
            .unwrap()
            .clone(),
            created: "2024-01-02".to_string(),
            modified: "2024-01-16".to_string(),
        },
        NoteResponse {
            name: "Invalid Note".to_string(),
            path: "/notes/theses/invalid.md".to_string(),
            content: "Missing symbol".to_string(),
            frontmatter: json!({
                "status": "research"
            })
            .as_object()
            .unwrap()
            .clone(),
            created: "2024-01-03".to_string(),
            modified: "2024-01-17".to_string(),
        },
    ];

    // Convert to ThesisNotes (filter_map removes invalid entries)
    let theses: Vec<ThesisNote> = api_responses
        .iter()
        .filter_map(|n| ThesisNote::from_note_response(n))
        .collect();

    // Should have 2 valid theses (third is missing symbol)
    assert_eq!(theses.len(), 2);
    assert_eq!(theses[0].symbol, "AAPL");
    assert_eq!(theses[0].status, ThesisStatus::Active);
    assert_eq!(theses[1].symbol, "MSFT");
    assert_eq!(theses[1].status, ThesisStatus::Watchlist);
}

#[test]
fn test_trade_loading_pipeline() {
    // Simulate API response -> TradeNote conversion pipeline

    let api_responses = vec![
        NoteResponse {
            name: "AAPL Long Trade".to_string(),
            path: "/notes/trades/AAPL_20240101.md".to_string(),
            content: "Entered long position".to_string(),
            frontmatter: json!({
                "symbol": "AAPL",
                "direction": "long",
                "status": "open",
                "entry_price": 150.0,
                "shares": 100.0,
                "entry_date": "2024-01-01"
            })
            .as_object()
            .unwrap()
            .clone(),
            created: "2024-01-01".to_string(),
            modified: "2024-01-15".to_string(),
        },
        NoteResponse {
            name: "NVDA Short".to_string(),
            path: "/notes/trades/NVDA_20240110.md".to_string(),
            content: "Short position".to_string(),
            frontmatter: json!({
                "symbol": "NVDA",
                "direction": "short",
                "status": "closed",
                "entry_price": 500.0,
                "exit_price": 450.0,
                "shares": 50.0,
                "pnl": 2500.0,
                "pnl_percent": 10.0,
                "entry_date": "2024-01-10"
            })
            .as_object()
            .unwrap()
            .clone(),
            created: "2024-01-10".to_string(),
            modified: "2024-01-20".to_string(),
        },
    ];

    let trades: Vec<TradeNote> = api_responses
        .iter()
        .filter_map(|n| TradeNote::from_note_response(n))
        .collect();

    assert_eq!(trades.len(), 2);

    // First trade: open long
    assert_eq!(trades[0].symbol, "AAPL");
    assert_eq!(trades[0].direction, TradeDirection::Long);
    assert_eq!(trades[0].status, TradeStatus::Open);
    assert!(trades[0].exit_price.is_none());

    // Second trade: closed short
    assert_eq!(trades[1].symbol, "NVDA");
    assert_eq!(trades[1].direction, TradeDirection::Short);
    assert_eq!(trades[1].status, TradeStatus::Closed);
    assert_eq!(trades[1].exit_price, Some(450.0));
    assert_eq!(trades[1].pnl, Some(2500.0));
}

// ============================================================================
// DATA FILTERING TESTS
// ============================================================================

#[test]
fn test_thesis_filtering_by_status() {
    let theses = vec![
        ThesisNote {
            name: "Active 1".to_string(),
            symbol: "AAPL".to_string(),
            status: ThesisStatus::Active,
            conviction: "High".to_string(),
            entry_price: Some(150.0),
            target_price: Some(200.0),
            modified: "2024-01-01".to_string(),
        },
        ThesisNote {
            name: "Watchlist 1".to_string(),
            symbol: "MSFT".to_string(),
            status: ThesisStatus::Watchlist,
            conviction: "Medium".to_string(),
            entry_price: None,
            target_price: None,
            modified: "2024-01-02".to_string(),
        },
        ThesisNote {
            name: "Active 2".to_string(),
            symbol: "NVDA".to_string(),
            status: ThesisStatus::Active,
            conviction: "High".to_string(),
            entry_price: Some(500.0),
            target_price: Some(700.0),
            modified: "2024-01-03".to_string(),
        },
    ];

    // Filter active only
    let active: Vec<&ThesisNote> = theses
        .iter()
        .filter(|t| t.status == ThesisStatus::Active)
        .collect();
    assert_eq!(active.len(), 2);

    // Filter watchlist only
    let watchlist: Vec<&ThesisNote> = theses
        .iter()
        .filter(|t| t.status == ThesisStatus::Watchlist)
        .collect();
    assert_eq!(watchlist.len(), 1);
}

#[test]
fn test_trade_filtering_by_symbol() {
    let trades = vec![
        TradeNote {
            name: "AAPL Trade 1".to_string(),
            symbol: "AAPL".to_string(),
            direction: TradeDirection::Long,
            status: TradeStatus::Closed,
            entry_price: 150.0,
            exit_price: Some(175.0),
            shares: 100.0,
            pnl: Some(2500.0),
            pnl_percent: Some(16.67),
            entry_date: "2024-01-01".to_string(),
        },
        TradeNote {
            name: "MSFT Trade".to_string(),
            symbol: "MSFT".to_string(),
            direction: TradeDirection::Long,
            status: TradeStatus::Open,
            entry_price: 350.0,
            exit_price: None,
            shares: 50.0,
            pnl: None,
            pnl_percent: None,
            entry_date: "2024-01-05".to_string(),
        },
        TradeNote {
            name: "AAPL Trade 2".to_string(),
            symbol: "AAPL".to_string(),
            direction: TradeDirection::Short,
            status: TradeStatus::Open,
            entry_price: 180.0,
            exit_price: None,
            shares: 25.0,
            pnl: None,
            pnl_percent: None,
            entry_date: "2024-01-10".to_string(),
        },
    ];

    // Filter by symbol
    let aapl_trades: Vec<&TradeNote> =
        trades.iter().filter(|t| t.symbol == "AAPL").collect();
    assert_eq!(aapl_trades.len(), 2);

    // Filter by status
    let open_trades: Vec<&TradeNote> = trades
        .iter()
        .filter(|t| t.status == TradeStatus::Open)
        .collect();
    assert_eq!(open_trades.len(), 2);
}

// ============================================================================
// PNL CALCULATION TESTS
// ============================================================================

#[test]
fn test_portfolio_pnl_aggregation() {
    let trades = vec![
        TradeNote {
            name: "Trade 1".to_string(),
            symbol: "AAPL".to_string(),
            direction: TradeDirection::Long,
            status: TradeStatus::Closed,
            entry_price: 100.0,
            exit_price: Some(120.0),
            shares: 100.0,
            pnl: Some(2000.0),
            pnl_percent: Some(20.0),
            entry_date: "2024-01-01".to_string(),
        },
        TradeNote {
            name: "Trade 2".to_string(),
            symbol: "MSFT".to_string(),
            direction: TradeDirection::Long,
            status: TradeStatus::Closed,
            entry_price: 300.0,
            exit_price: Some(280.0),
            shares: 50.0,
            pnl: Some(-1000.0),
            pnl_percent: Some(-6.67),
            entry_date: "2024-01-05".to_string(),
        },
        TradeNote {
            name: "Trade 3".to_string(),
            symbol: "NVDA".to_string(),
            direction: TradeDirection::Short,
            status: TradeStatus::Closed,
            entry_price: 500.0,
            exit_price: Some(450.0),
            shares: 20.0,
            pnl: Some(1000.0),
            pnl_percent: Some(10.0),
            entry_date: "2024-01-10".to_string(),
        },
    ];

    // Calculate total PnL
    let total_pnl: f64 = trades
        .iter()
        .filter_map(|t| t.pnl)
        .sum();
    assert!((total_pnl - 2000.0).abs() < 0.01); // 2000 - 1000 + 1000 = 2000

    // Calculate win rate
    let closed_trades: Vec<&TradeNote> = trades
        .iter()
        .filter(|t| t.status == TradeStatus::Closed)
        .collect();
    let winning_trades = closed_trades
        .iter()
        .filter(|t| t.pnl.unwrap_or(0.0) > 0.0)
        .count();
    let win_rate = winning_trades as f64 / closed_trades.len() as f64;
    assert!((win_rate - 0.6667).abs() < 0.01); // 2/3 = 66.67%
}

// ============================================================================
// VIEW NAVIGATION INTEGRATION
// ============================================================================

#[test]
fn test_view_switching_preserves_state() {
    // Simulate view switching behavior
    struct AppState {
        active_view: ActiveView,
        selected_symbol: Option<String>,
        notes_tab: NotesTab,
    }

    let mut state = AppState {
        active_view: ActiveView::Dashboard,
        selected_symbol: Some("AAPL".to_string()),
        notes_tab: NotesTab::Theses,
    };

    // Switch to Notes view
    state.active_view = ActiveView::Notes;
    assert_eq!(state.active_view, ActiveView::Notes);
    // Symbol should still be selected
    assert_eq!(state.selected_symbol, Some("AAPL".to_string()));

    // Switch tabs within Notes
    state.notes_tab = NotesTab::Trades;
    assert_eq!(state.notes_tab, NotesTab::Trades);

    // Switch back to Dashboard
    state.active_view = ActiveView::Dashboard;
    assert_eq!(state.active_view, ActiveView::Dashboard);
    // Notes tab should preserve its state
    assert_eq!(state.notes_tab, NotesTab::Trades);
}

// ============================================================================
// DATA TRANSFORMATION TESTS
// ============================================================================

#[test]
fn test_market_data_display_formatting() {
    let market_data = MarketData {
        symbol: "AAPL".to_string(),
        price: 175.50,
        change: 2.30,
        change_percent: 1.33,
        volume: 50_000_000,
        avg_volume: Some(42_000_000),
        market_cap: Some(2_500_000_000_000.0),
        pe_ratio: Some(28.5),
        dividend_yield: Some(0.006),
        high_52w: Some(199.62),
        low_52w: Some(143.90),
        timestamp: Some("2024-01-15T16:00:00Z".to_string()),
    };

    // Format price display
    let price_str = format!("${:.2}", market_data.price);
    assert_eq!(price_str, "$175.50");

    // Format change display
    let change_str = if market_data.change >= 0.0 {
        format!("+${:.2} (+{:.2}%)", market_data.change, market_data.change_percent)
    } else {
        format!("${:.2} ({:.2}%)", market_data.change, market_data.change_percent)
    };
    assert_eq!(change_str, "+$2.30 (+1.33%)");

    // Format volume
    let volume_str = format_number(market_data.volume as f64);
    assert_eq!(volume_str, "50.0M");
}

#[test]
fn test_sector_flow_aggregation() {
    let sector_flows = vec![
        SectorFlow {
            symbol: "XLK".to_string(),
            net_flow_1m: 5_000_000_000.0,
            net_flow_3m: 8_000_000_000.0,
            institutional_change: 0.012,
            smart_money_sentiment: 0.54,
            flow_acceleration: 0.006,
            confidence_score: 0.78,
        },
        SectorFlow {
            symbol: "XLV".to_string(),
            net_flow_1m: -1_000_000_000.0,
            net_flow_3m: -1_500_000_000.0,
            institutional_change: -0.004,
            smart_money_sentiment: -0.18,
            flow_acceleration: -0.002,
            confidence_score: 0.62,
        },
        SectorFlow {
            symbol: "XLF".to_string(),
            net_flow_1m: 2_000_000_000.0,
            net_flow_3m: 3_200_000_000.0,
            institutional_change: 0.007,
            smart_money_sentiment: 0.31,
            flow_acceleration: 0.004,
            confidence_score: 0.7,
        },
    ];

    // Calculate total net flow
    let total_net_flow: f64 = sector_flows.iter().map(|s| s.net_flow_1m).sum();
    assert!((total_net_flow - 6_000_000_000.0).abs() < 1.0);

    // Find sectors with positive flow
    let positive_sectors: Vec<&SectorFlow> =
        sector_flows.iter().filter(|s| s.net_flow_1m > 0.0).collect();
    assert_eq!(positive_sectors.len(), 2);

    // Find sector with highest flow
    let max_flow_sector = sector_flows
        .iter()
        .max_by(|a, b| a.net_flow_1m.partial_cmp(&b.net_flow_1m).unwrap())
        .unwrap();
    assert_eq!(max_flow_sector.symbol, "XLK");
}

// ============================================================================
// CONCURRENT STATE UPDATES
// ============================================================================

#[test]
fn test_multiple_loading_states() {
    // Simulate multiple async operations with independent loading states
    struct MultiLoadState {
        theses: LoadingState<Vec<ThesisNote>>,
        trades: LoadingState<Vec<TradeNote>>,
        market_data: LoadingState<MarketData>,
    }

    let mut state = MultiLoadState {
        theses: LoadingState::NotStarted,
        trades: LoadingState::NotStarted,
        market_data: LoadingState::NotStarted,
    };

    // Start loading all
    state.theses = LoadingState::Loading;
    state.trades = LoadingState::Loading;
    state.market_data = LoadingState::Loading;

    assert!(state.theses.is_loading());
    assert!(state.trades.is_loading());
    assert!(state.market_data.is_loading());

    // Complete trades first
    state.trades = LoadingState::Loaded(vec![]);
    assert!(!state.trades.is_loading());
    assert!(state.trades.is_loaded());

    // Error on market data
    state.market_data = LoadingState::Error("Timeout".to_string());
    assert!(state.market_data.is_error());

    // Complete theses
    state.theses = LoadingState::Loaded(vec![]);
    assert!(state.theses.is_loaded());

    // Final state check
    assert!(state.theses.is_loaded());
    assert!(state.trades.is_loaded());
    assert!(state.market_data.is_error());
}

// ============================================================================
// ERROR HANDLING INTEGRATION
// ============================================================================

#[test]
fn test_graceful_error_handling() {
    // Test that app can handle partial failures gracefully

    let api_error = ApiError::Network("Connection refused".to_string());

    // Convert to loading state error
    let error_msg = match api_error {
        ApiError::Network(msg) => format!("Network error: {}", msg),
        ApiError::Parse(msg) => format!("Parse error: {}", msg),
        ApiError::Server(code, msg) => format!("Server error {}: {}", code, msg),
        ApiError::NotFound(msg) => format!("Not found: {}", msg),
    };

    let state: LoadingState<Vec<ThesisNote>> = LoadingState::Error(error_msg.clone());

    assert!(state.is_error());
    match state {
        LoadingState::Error(msg) => {
            assert!(msg.contains("Connection refused"));
        }
        _ => panic!("Expected error state"),
    }
}

#[test]
fn test_empty_response_handling() {
    // API returns empty arrays - should still work
    let empty_theses: Vec<NoteResponse> = vec![];
    let parsed: Vec<ThesisNote> = empty_theses
        .iter()
        .filter_map(|n| ThesisNote::from_note_response(n))
        .collect();

    assert!(parsed.is_empty());

    // State should be Loaded, not Error
    let state: LoadingState<Vec<ThesisNote>> = LoadingState::Loaded(parsed);
    assert!(state.is_loaded());
}

// ============================================================================
// SYMBOL SEARCH INTEGRATION
// ============================================================================

#[test]
fn test_symbol_search_across_notes() {
    let theses = vec![
        ThesisNote {
            name: "AAPL Analysis".to_string(),
            symbol: "AAPL".to_string(),
            status: ThesisStatus::Active,
            conviction: "High".to_string(),
            entry_price: Some(150.0),
            target_price: Some(200.0),
            modified: "2024-01-01".to_string(),
        },
        ThesisNote {
            name: "MSFT Research".to_string(),
            symbol: "MSFT".to_string(),
            status: ThesisStatus::Watchlist,
            conviction: "Medium".to_string(),
            entry_price: None,
            target_price: None,
            modified: "2024-01-02".to_string(),
        },
    ];

    let trades = vec![
        TradeNote {
            name: "AAPL Trade 1".to_string(),
            symbol: "AAPL".to_string(),
            direction: TradeDirection::Long,
            status: TradeStatus::Closed,
            entry_price: 150.0,
            exit_price: Some(175.0),
            shares: 100.0,
            pnl: Some(2500.0),
            pnl_percent: Some(16.67),
            entry_date: "2024-01-01".to_string(),
        },
        TradeNote {
            name: "NVDA Trade".to_string(),
            symbol: "NVDA".to_string(),
            direction: TradeDirection::Long,
            status: TradeStatus::Open,
            entry_price: 500.0,
            exit_price: None,
            shares: 20.0,
            pnl: None,
            pnl_percent: None,
            entry_date: "2024-01-10".to_string(),
        },
    ];

    // Search for AAPL across both
    let search_term = "AAPL";
    let matching_theses: Vec<&ThesisNote> = theses
        .iter()
        .filter(|t| t.symbol.contains(search_term) || t.name.contains(search_term))
        .collect();
    let matching_trades: Vec<&TradeNote> = trades
        .iter()
        .filter(|t| t.symbol.contains(search_term) || t.name.contains(search_term))
        .collect();

    assert_eq!(matching_theses.len(), 1);
    assert_eq!(matching_trades.len(), 1);
}
