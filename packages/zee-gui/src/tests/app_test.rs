//! Unit tests for the application state module
//!
//! Tests cover:
//! - Application state initialization
//! - View navigation
//! - Loading state management
//! - Data parsing from API responses

use super::super::app::*;
use serde_json::json;

// ============================================================================
// LOADING STATE TESTS
// ============================================================================

#[test]
fn test_loading_state_not_started() {
    let state: LoadingState<String> = LoadingState::NotStarted;
    assert!(!state.is_loading());
    assert!(!state.is_loaded());
    assert!(!state.is_error());
}

#[test]
fn test_loading_state_loading() {
    let state: LoadingState<String> = LoadingState::Loading;
    assert!(state.is_loading());
    assert!(!state.is_loaded());
    assert!(!state.is_error());
}

#[test]
fn test_loading_state_loaded() {
    let state: LoadingState<String> = LoadingState::Loaded("data".to_string());
    assert!(!state.is_loading());
    assert!(state.is_loaded());
    assert!(!state.is_error());
}

#[test]
fn test_loading_state_error() {
    let state: LoadingState<String> = LoadingState::Error("error message".to_string());
    assert!(!state.is_loading());
    assert!(!state.is_loaded());
    assert!(state.is_error());
}

#[test]
fn test_loading_state_default() {
    let state: LoadingState<String> = Default::default();
    assert!(matches!(state, LoadingState::NotStarted));
}

// ============================================================================
// LOAD STATE TESTS (Alternate naming)
// ============================================================================

#[test]
fn test_load_state_not_loaded() {
    let state: LoadState<Vec<u8>> = LoadState::NotLoaded;
    assert!(!state.is_loading());
}

#[test]
fn test_load_state_loading() {
    let state: LoadState<Vec<u8>> = LoadState::Loading;
    assert!(state.is_loading());
}

#[test]
fn test_load_state_loaded() {
    let state: LoadState<Vec<u8>> = LoadState::Loaded(vec![1, 2, 3]);
    assert!(!state.is_loading());
}

#[test]
fn test_load_state_error() {
    let state: LoadState<Vec<u8>> = LoadState::Error("Failed to load".to_string());
    assert!(!state.is_loading());
}

// ============================================================================
// FORMAT NUMBER TESTS
// ============================================================================

#[test]
fn test_format_number_small() {
    assert_eq!(format_number(0.0), "0");
    assert_eq!(format_number(1.0), "1");
    assert_eq!(format_number(999.0), "999");
}

#[test]
fn test_format_number_thousands() {
    assert_eq!(format_number(1000.0), "1.0K");
    assert_eq!(format_number(1500.0), "1.5K");
    assert_eq!(format_number(999999.0), "1000.0K");
}

#[test]
fn test_format_number_millions() {
    assert_eq!(format_number(1_000_000.0), "1.0M");
    assert_eq!(format_number(2_500_000.0), "2.5M");
    assert_eq!(format_number(999_999_999.0), "1000.0M");
}

#[test]
fn test_format_number_billions() {
    assert_eq!(format_number(1_000_000_000.0), "1.0B");
    assert_eq!(format_number(2_500_000_000.0), "2.5B");
    assert_eq!(format_number(100_000_000_000.0), "100.0B");
}

#[test]
fn test_format_number_decimals() {
    assert_eq!(format_number(1_234_567_890.0), "1.2B");
    assert_eq!(format_number(12_345_678.0), "12.3M");
    assert_eq!(format_number(123_456.0), "123.5K");
}

// ============================================================================
// NOTES TAB TESTS
// ============================================================================

#[test]
fn test_notes_tab_default() {
    let tab: NotesTab = Default::default();
    assert_eq!(tab, NotesTab::Theses);
}

// ============================================================================
// THESIS STATUS TESTS
// ============================================================================

#[test]
fn test_thesis_status_label() {
    assert_eq!(ThesisStatus::Research.label(), "Research");
    assert_eq!(ThesisStatus::Watchlist.label(), "Watchlist");
    assert_eq!(ThesisStatus::Active.label(), "Active");
    assert_eq!(ThesisStatus::Closed.label(), "Closed");
    assert_eq!(ThesisStatus::Invalidated.label(), "Invalidated");
}

// ============================================================================
// THESIS NOTE PARSING TESTS
// ============================================================================

#[test]
fn test_thesis_note_from_note_response_complete() {
    use super::super::api::NoteResponse;

    let frontmatter = json!({
        "symbol": "AAPL",
        "status": "active",
        "conviction": "High",
        "entry_price": 150.0,
        "target_price": 200.0,
        "modified": "2024-01-15"
    });

    let note = NoteResponse {
        name: "AAPL Bull Case".to_string(),
        path: "/notes/theses/AAPL.md".to_string(),
        content: "Bull case for Apple".to_string(),
        frontmatter: frontmatter.as_object().unwrap().clone(),
        created: "2024-01-01".to_string(),
        modified: "2024-01-15".to_string(),
    };

    let thesis = ThesisNote::from_note_response(&note);
    assert!(thesis.is_some());

    let thesis = thesis.unwrap();
    assert_eq!(thesis.name, "AAPL Bull Case");
    assert_eq!(thesis.symbol, "AAPL");
    assert_eq!(thesis.status, ThesisStatus::Active);
    assert_eq!(thesis.conviction, "High");
    assert_eq!(thesis.entry_price, Some(150.0));
    assert_eq!(thesis.target_price, Some(200.0));
}

#[test]
fn test_thesis_note_from_note_response_missing_symbol() {
    use super::super::api::NoteResponse;

    let frontmatter = json!({
        "status": "active",
        "conviction": "High"
    });

    let note = NoteResponse {
        name: "Missing Symbol".to_string(),
        path: "/notes/theses/unknown.md".to_string(),
        content: "No symbol specified".to_string(),
        frontmatter: frontmatter.as_object().unwrap().clone(),
        created: "2024-01-01".to_string(),
        modified: "2024-01-15".to_string(),
    };

    let thesis = ThesisNote::from_note_response(&note);
    assert!(thesis.is_none());
}

#[test]
fn test_thesis_note_status_parsing() {
    use super::super::api::NoteResponse;

    let test_cases = vec![
        ("active", ThesisStatus::Active),
        ("ACTIVE", ThesisStatus::Active),
        ("Active", ThesisStatus::Active),
        ("watchlist", ThesisStatus::Watchlist),
        ("closed", ThesisStatus::Closed),
        ("invalidated", ThesisStatus::Invalidated),
        ("research", ThesisStatus::Research),
        ("unknown", ThesisStatus::Research), // Default case
    ];

    for (status_str, expected_status) in test_cases {
        let frontmatter = json!({
            "symbol": "TEST",
            "status": status_str
        });

        let note = NoteResponse {
            name: format!("Test {}", status_str),
            path: "/notes/test.md".to_string(),
            content: "".to_string(),
            frontmatter: frontmatter.as_object().unwrap().clone(),
            created: "".to_string(),
            modified: "".to_string(),
        };

        let thesis = ThesisNote::from_note_response(&note).unwrap();
        assert_eq!(
            thesis.status, expected_status,
            "Failed for status: {}",
            status_str
        );
    }
}

// ============================================================================
// TRADE NOTE PARSING TESTS
// ============================================================================

#[test]
fn test_trade_note_from_note_response_complete() {
    use super::super::api::NoteResponse;

    let frontmatter = json!({
        "symbol": "AAPL",
        "direction": "long",
        "status": "closed",
        "entry_price": 150.0,
        "exit_price": 175.0,
        "shares": 100.0,
        "pnl": 2500.0,
        "pnl_percent": 16.67,
        "entry_date": "2024-01-01"
    });

    let note = NoteResponse {
        name: "AAPL Long Trade".to_string(),
        path: "/notes/trades/AAPL_20240101.md".to_string(),
        content: "Closed for profit".to_string(),
        frontmatter: frontmatter.as_object().unwrap().clone(),
        created: "2024-01-01".to_string(),
        modified: "2024-01-15".to_string(),
    };

    let trade = TradeNote::from_note_response(&note);
    assert!(trade.is_some());

    let trade = trade.unwrap();
    assert_eq!(trade.name, "AAPL Long Trade");
    assert_eq!(trade.symbol, "AAPL");
    assert_eq!(trade.direction, TradeDirection::Long);
    assert_eq!(trade.status, TradeStatus::Closed);
    assert_eq!(trade.entry_price, 150.0);
    assert_eq!(trade.exit_price, Some(175.0));
    assert_eq!(trade.shares, 100.0);
    assert_eq!(trade.pnl, Some(2500.0));
}

#[test]
fn test_trade_note_direction_parsing() {
    use super::super::api::NoteResponse;

    let test_cases = vec![
        ("long", TradeDirection::Long),
        ("Long", TradeDirection::Long),
        ("LONG", TradeDirection::Long),
        ("short", TradeDirection::Short),
        ("Short", TradeDirection::Short),
        ("unknown", TradeDirection::Long), // Default
    ];

    for (direction_str, expected_direction) in test_cases {
        let frontmatter = json!({
            "symbol": "TEST",
            "direction": direction_str
        });

        let note = NoteResponse {
            name: format!("Test {}", direction_str),
            path: "/notes/test.md".to_string(),
            content: "".to_string(),
            frontmatter: frontmatter.as_object().unwrap().clone(),
            created: "".to_string(),
            modified: "".to_string(),
        };

        let trade = TradeNote::from_note_response(&note).unwrap();
        assert_eq!(
            trade.direction, expected_direction,
            "Failed for direction: {}",
            direction_str
        );
    }
}

#[test]
fn test_trade_note_status_parsing() {
    use super::super::api::NoteResponse;

    let test_cases = vec![
        ("open", TradeStatus::Open),
        ("closed", TradeStatus::Closed),
        ("partial", TradeStatus::Partial),
        ("unknown", TradeStatus::Open), // Default
    ];

    for (status_str, expected_status) in test_cases {
        let frontmatter = json!({
            "symbol": "TEST",
            "status": status_str
        });

        let note = NoteResponse {
            name: format!("Test {}", status_str),
            path: "/notes/test.md".to_string(),
            content: "".to_string(),
            frontmatter: frontmatter.as_object().unwrap().clone(),
            created: "".to_string(),
            modified: "".to_string(),
        };

        let trade = TradeNote::from_note_response(&note).unwrap();
        assert_eq!(
            trade.status, expected_status,
            "Failed for status: {}",
            status_str
        );
    }
}

// ============================================================================
// TRADE DIRECTION TESTS
// ============================================================================

#[test]
fn test_trade_direction_label() {
    assert_eq!(TradeDirection::Long.label(), "Long");
    assert_eq!(TradeDirection::Short.label(), "Short");
}

// ============================================================================
// TRADE STATUS TESTS
// ============================================================================

#[test]
fn test_trade_status_label() {
    assert_eq!(TradeStatus::Open.label(), "Open");
    assert_eq!(TradeStatus::Closed.label(), "Closed");
    assert_eq!(TradeStatus::Partial.label(), "Partial");
}

// ============================================================================
// ACTIVE VIEW TESTS
// ============================================================================

#[test]
fn test_active_view_default() {
    let view: ActiveView = Default::default();
    assert_eq!(view, ActiveView::Dashboard);
}

#[test]
fn test_active_view_equality() {
    assert_eq!(ActiveView::Dashboard, ActiveView::Dashboard);
    assert_ne!(ActiveView::Dashboard, ActiveView::Portfolio);
    assert_ne!(ActiveView::Notes, ActiveView::Research);
}

// ============================================================================
// TIME PERIOD TESTS
// ============================================================================

#[test]
fn test_time_period_label() {
    assert_eq!(TimePeriod::OneDay.label(), "1D");
    assert_eq!(TimePeriod::OneWeek.label(), "1W");
    assert_eq!(TimePeriod::OneMonth.label(), "1M");
    assert_eq!(TimePeriod::ThreeMonths.label(), "3M");
    assert_eq!(TimePeriod::OneYear.label(), "1Y");
}

#[test]
fn test_time_period_all() {
    let all = TimePeriod::all();
    assert_eq!(all.len(), 5);
    assert_eq!(all[0], TimePeriod::OneDay);
    assert_eq!(all[4], TimePeriod::OneYear);
}

#[test]
fn test_time_period_default() {
    let period: TimePeriod = Default::default();
    assert_eq!(period, TimePeriod::OneDay);
}

// ============================================================================
// EDGE CASES
// ============================================================================

#[test]
fn test_thesis_note_minimal_frontmatter() {
    use super::super::api::NoteResponse;

    let frontmatter = json!({
        "symbol": "MINIMAL"
    });

    let note = NoteResponse {
        name: "Minimal".to_string(),
        path: "/notes/minimal.md".to_string(),
        content: "".to_string(),
        frontmatter: frontmatter.as_object().unwrap().clone(),
        created: "".to_string(),
        modified: "".to_string(),
    };

    let thesis = ThesisNote::from_note_response(&note).unwrap();
    assert_eq!(thesis.symbol, "MINIMAL");
    assert_eq!(thesis.status, ThesisStatus::Research); // Default
    assert_eq!(thesis.conviction, "Medium"); // Default
    assert!(thesis.entry_price.is_none());
    assert!(thesis.target_price.is_none());
}

#[test]
fn test_trade_note_fallback_entry_date() {
    use super::super::api::NoteResponse;

    // When entry_date is missing, should fall back to created
    let frontmatter = json!({
        "symbol": "TEST",
        "created": "2024-01-01"
    });

    let note = NoteResponse {
        name: "Fallback Date".to_string(),
        path: "/notes/test.md".to_string(),
        content: "".to_string(),
        frontmatter: frontmatter.as_object().unwrap().clone(),
        created: "2024-01-01".to_string(),
        modified: "".to_string(),
    };

    let trade = TradeNote::from_note_response(&note).unwrap();
    assert_eq!(trade.entry_date, "2024-01-01");
}

#[test]
fn test_format_number_edge_cases() {
    // Negative numbers
    assert_eq!(format_number(-1000.0), "-1.0K");
    assert_eq!(format_number(-1_000_000.0), "-1.0M");
    assert_eq!(format_number(-1_000_000_000.0), "-1.0B");

    // Very small numbers
    assert_eq!(format_number(0.001), "0");
    assert_eq!(format_number(0.999), "1");
}

#[test]
fn test_loading_state_with_complex_type() {
    #[derive(Debug, Clone)]
    struct ComplexData {
        id: u64,
        name: String,
        values: Vec<f64>,
    }

    let data = ComplexData {
        id: 1,
        name: "test".to_string(),
        values: vec![1.0, 2.0, 3.0],
    };

    let state: LoadingState<ComplexData> = LoadingState::Loaded(data);
    assert!(state.is_loaded());
}
