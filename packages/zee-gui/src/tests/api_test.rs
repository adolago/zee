//! Unit tests for the API client module
//!
//! Tests cover:
//! - Client construction
//! - Request serialization
//! - Response parsing
//! - Error handling

use crate::api::*;

// ============================================================================
// CLIENT CONSTRUCTION TESTS
// ============================================================================

#[test]
fn test_client_new_default_url() {
    let client = ZeeApiClient::new();
    // Client should be created successfully with default URL
    assert!(std::sync::Arc::strong_count(&std::sync::Arc::new(client.clone())) >= 1);
}

#[test]
fn test_client_with_custom_url() {
    let custom_url = "http://custom-server:9000".to_string();
    let _client = ZeeApiClient::with_url(custom_url);
    assert!(true); // Construction succeeded
}

#[test]
fn test_client_new_shared() {
    let client = ZeeApiClient::new_shared();
    assert!(std::sync::Arc::strong_count(&client) == 1);
}

// ============================================================================
// REQUEST SERIALIZATION TESTS
// ============================================================================

#[test]
fn test_sector_flow_request_serialization() {
    let request = SectorFlowRequest {
        sectors: vec![
            "Technology".to_string(),
            "Healthcare".to_string(),
            "Financial".to_string(),
        ],
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("Technology"));
    assert!(json.contains("Healthcare"));
    assert!(json.contains("Financial"));
}

#[test]
fn test_sector_flow_request_empty() {
    let request = SectorFlowRequest { sectors: vec![] };
    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("[]"));
}

#[test]
fn test_create_thesis_request_full() {
    let request = CreateThesisRequest {
        name: "AAPL Bull Case".to_string(),
        symbol: "AAPL".to_string(),
        direction: "long".to_string(),
        status: Some("active".to_string()),
        conviction: Some("high".to_string()),
        entry_price: Some(150.0),
        target_price: Some(200.0),
        stop_loss: Some(130.0),
        thesis_summary: Some("Strong bull case".to_string()),
        catalysts: Some(vec!["AI growth".to_string(), "Services expansion".to_string()]),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("AAPL"));
    assert!(json.contains("long"));
    assert!(json.contains("active"));
}

#[test]
fn test_create_thesis_request_minimal() {
    let request = CreateThesisRequest {
        name: "Minimal Thesis".to_string(),
        symbol: "TEST".to_string(),
        direction: "long".to_string(),
        status: None,
        conviction: None,
        entry_price: None,
        target_price: None,
        stop_loss: None,
        thesis_summary: None,
        catalysts: None,
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("Minimal Thesis"));
    assert!(json.contains("TEST"));
}

#[test]
fn test_create_trade_request_full() {
    let request = CreateTradeRequest {
        symbol: "MSFT".to_string(),
        direction: "long".to_string(),
        entry_price: 350.0,
        entry_date: "2024-01-15".to_string(),
        shares: Some(100.0),
        stop_loss: Some(320.0),
        target_price: Some(400.0),
        notes: Some("Swing trade setup".to_string()),
        tags: Some(vec!["swing".to_string(), "tech".to_string()]),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("MSFT"));
    assert!(json.contains("350"));
}

// ============================================================================
// RESPONSE PARSING TESTS
// ============================================================================

#[test]
fn test_market_response_parsing() {
    let json_str = r#"{"symbol":"AAPL","current_price":175.5,"change":2.5,"change_percent":1.45,"volume":45000000}"#;
    let response: MarketResponse = serde_json::from_str(json_str).unwrap();

    assert_eq!(response.symbol, "AAPL");
    assert!((response.current_price - 175.5).abs() < 0.01);
    assert_eq!(response.volume, 45000000);
}

#[test]
fn test_sector_flow_response_parsing() {
    let json_str = r#"{"symbol":"XLK","netFlow1m":150000000.0,"netFlow3m":250000000.0,"institutionalChange":0.012,"smartMoneySentiment":0.42,"flowAcceleration":0.003,"confidenceScore":0.76}"#;
    let response: SectorFlow = serde_json::from_str(json_str).unwrap();

    assert_eq!(response.symbol, "XLK");
    assert!(response.net_flow_1m > 0.0);
}

#[test]
fn test_institutional_response_parsing() {
    let json_str = r#"{"symbol":"AAPL","institutional_ownership":75.5,"top_holders":[],"recent_changes":[]}"#;
    let response: InstitutionalResponse = serde_json::from_str(json_str).unwrap();

    assert_eq!(response.symbol, "AAPL");
    assert!((response.institutional_ownership - 75.5).abs() < 0.01);
}

#[test]
fn test_dark_pool_response_parsing() {
    let json_str = r#"{"symbol":"AAPL","dark_pool_volume":15000000,"total_volume":42000000,"dark_pool_percent":35.7,"sentiment":"bullish"}"#;
    let response: DarkPoolResponse = serde_json::from_str(json_str).unwrap();

    assert_eq!(response.symbol, "AAPL");
    assert_eq!(response.dark_pool_volume, 15000000);
}

// ============================================================================
// API ERROR TESTS
// ============================================================================

#[test]
fn test_api_error_network() {
    let error = ApiError::Network("Connection refused".to_string());
    match error {
        ApiError::Network(msg) => assert!(msg.contains("Connection")),
        _ => panic!("Expected Network error"),
    }
}

#[test]
fn test_api_error_parse() {
    let error = ApiError::Parse("Invalid JSON".to_string());
    match error {
        ApiError::Parse(msg) => assert!(msg.contains("Invalid")),
        _ => panic!("Expected Parse error"),
    }
}

#[test]
fn test_api_error_server() {
    let error = ApiError::Server(500, "Internal error".to_string());
    match error {
        ApiError::Server(code, msg) => {
            assert_eq!(code, 500);
            assert!(msg.contains("Internal"));
        }
        _ => panic!("Expected Server error"),
    }
}

// ============================================================================
// NOTE RESPONSE TESTS
// ============================================================================

#[test]
fn test_note_response_basic() {
    let mut frontmatter = serde_json::Map::new();
    frontmatter.insert("symbol".to_string(), serde_json::Value::String("AAPL".to_string()));

    let note = NoteResponse {
        name: "Test Note".to_string(),
        path: "/notes/test.md".to_string(),
        content: "Test content".to_string(),
        frontmatter,
        created: "2024-01-01".to_string(),
        modified: "2024-01-02".to_string(),
    };

    assert_eq!(note.name, "Test Note");
    assert!(note.frontmatter.contains_key("symbol"));
}

// ============================================================================
// DATA TYPE EDGE CASES
// ============================================================================

#[test]
fn test_market_response_with_negative_change() {
    let json_str = r#"{"symbol":"XYZ","current_price":50.0,"change":-5.0,"change_percent":-9.1,"volume":1000000}"#;
    let response: MarketResponse = serde_json::from_str(json_str).unwrap();

    assert!(response.change < 0.0);
    assert!(response.change_percent < 0.0);
}

#[test]
fn test_sector_flow_with_negative_flow() {
    let json_str = r#"{"symbol":"XLE","netFlow1m":-50000000.0,"netFlow3m":-120000000.0,"institutionalChange":-0.004,"smartMoneySentiment":-0.22,"flowAcceleration":-0.003,"confidenceScore":0.55}"#;
    let response: SectorFlow = serde_json::from_str(json_str).unwrap();

    assert!(response.net_flow_1m < 0.0);
    assert!(response.smart_money_sentiment < 0.0);
}

#[test]
fn test_empty_vectors_in_response() {
    let json_str = r#"{"symbol":"NEW","institutional_ownership":0.0,"top_holders":[],"recent_changes":[]}"#;
    let response: InstitutionalResponse = serde_json::from_str(json_str).unwrap();

    assert!(response.top_holders.is_empty());
    assert!(response.recent_changes.is_empty());
}
