//! Performance benchmark tests for Stanley GUI
//!
//! These tests measure performance characteristics:
//! - Large dataset handling
//! - Memory usage patterns
//! - Data transformation speed
//! - Serialization/deserialization performance

use std::time::Instant;

// ============================================================================
// LARGE DATASET TESTS
// ============================================================================

#[test]
fn bench_parse_large_note_collection() {
    // Simulate parsing a large collection of notes
    let num_notes = 10_000;

    let start = Instant::now();

    let notes: Vec<_> = (0..num_notes)
        .map(|i| super::super::notes::Note {
            name: format!("Note {}", i),
            note_type: if i % 5 == 0 {
                "thesis"
            } else if i % 3 == 0 {
                "trade"
            } else {
                "research"
            }
            .to_string(),
            content: format!("Content for note {}. This is a longer description that simulates real content with multiple sentences. The note discusses investment analysis for symbol XYZ.", i),
            tags: vec![format!("tag{}", i % 10), format!("category{}", i % 5)],
            symbols: vec![format!("SYM{}", i % 100)],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-15T12:00:00Z".to_string(),
        })
        .collect();

    let parse_duration = start.elapsed();

    // All notes should be created
    assert_eq!(notes.len(), num_notes);

    // Performance assertion: should complete in under 100ms
    assert!(
        parse_duration.as_millis() < 100,
        "Note creation took too long: {:?}",
        parse_duration
    );

    // Test type parsing
    let start = Instant::now();
    let _types: Vec<_> = notes.iter().map(|n| n.get_type()).collect();
    let type_parse_duration = start.elapsed();

    assert!(
        type_parse_duration.as_millis() < 50,
        "Type parsing took too long: {:?}",
        type_parse_duration
    );
}

#[test]
fn bench_thesis_conversion_pipeline() {
    use super::super::api::NoteResponse;
    use super::super::app::ThesisNote;
    use serde_json::json;

    let num_notes = 5_000;

    // Create API responses
    let start = Instant::now();

    let api_responses: Vec<NoteResponse> = (0..num_notes)
        .map(|i| NoteResponse {
            name: format!("Thesis {}", i),
            path: format!("/notes/theses/thesis_{}.md", i),
            content: format!("Investment thesis for symbol SYM{}. This contains detailed analysis.", i),
            frontmatter: json!({
                "symbol": format!("SYM{}", i % 100),
                "status": if i % 3 == 0 { "active" } else { "watchlist" },
                "conviction": if i % 2 == 0 { "High" } else { "Medium" },
                "entry_price": 100.0 + (i as f64 * 0.1),
                "target_price": 150.0 + (i as f64 * 0.1),
                "modified": "2024-01-15"
            })
            .as_object()
            .unwrap()
            .clone(),
            created: "2024-01-01".to_string(),
            modified: "2024-01-15".to_string(),
        })
        .collect();

    let creation_duration = start.elapsed();

    // Convert to ThesisNotes
    let start = Instant::now();
    let theses: Vec<ThesisNote> = api_responses
        .iter()
        .filter_map(|n| ThesisNote::from_note_response(n))
        .collect();
    let conversion_duration = start.elapsed();

    assert_eq!(theses.len(), num_notes);

    // Performance assertions
    assert!(
        creation_duration.as_millis() < 200,
        "API response creation took too long: {:?}",
        creation_duration
    );
    assert!(
        conversion_duration.as_millis() < 100,
        "Thesis conversion took too long: {:?}",
        conversion_duration
    );

    println!(
        "Benchmark: {} theses - Creation: {:?}, Conversion: {:?}",
        num_notes, creation_duration, conversion_duration
    );
}

#[test]
fn bench_trade_filtering() {
    use super::super::app::{TradeDirection, TradeNote, TradeStatus};

    let num_trades = 10_000;

    // Create trades
    let trades: Vec<TradeNote> = (0..num_trades)
        .map(|i| TradeNote {
            name: format!("Trade {}", i),
            symbol: format!("SYM{}", i % 50),
            direction: if i % 2 == 0 {
                TradeDirection::Long
            } else {
                TradeDirection::Short
            },
            status: if i % 3 == 0 {
                TradeStatus::Closed
            } else if i % 3 == 1 {
                TradeStatus::Open
            } else {
                TradeStatus::Partial
            },
            entry_price: 100.0 + (i as f64),
            exit_price: if i % 3 == 0 { Some(120.0) } else { None },
            shares: 100.0,
            pnl: if i % 3 == 0 { Some(2000.0) } else { None },
            pnl_percent: if i % 3 == 0 { Some(20.0) } else { None },
            entry_date: "2024-01-01".to_string(),
        })
        .collect();

    // Benchmark filtering by symbol
    let start = Instant::now();
    let filtered_by_symbol: Vec<&TradeNote> =
        trades.iter().filter(|t| t.symbol == "SYM25").collect();
    let symbol_filter_duration = start.elapsed();

    // Benchmark filtering by status
    let start = Instant::now();
    let open_trades: Vec<&TradeNote> = trades
        .iter()
        .filter(|t| t.status == TradeStatus::Open)
        .collect();
    let status_filter_duration = start.elapsed();

    // Benchmark PnL aggregation
    let start = Instant::now();
    let total_pnl: f64 = trades.iter().filter_map(|t| t.pnl).sum();
    let pnl_aggregation_duration = start.elapsed();

    // Assertions
    assert!(!filtered_by_symbol.is_empty());
    assert!(!open_trades.is_empty());
    assert!(total_pnl > 0.0);

    // Performance assertions - all should be under 10ms for 10k items
    assert!(
        symbol_filter_duration.as_millis() < 10,
        "Symbol filtering took too long: {:?}",
        symbol_filter_duration
    );
    assert!(
        status_filter_duration.as_millis() < 10,
        "Status filtering took too long: {:?}",
        status_filter_duration
    );
    assert!(
        pnl_aggregation_duration.as_millis() < 10,
        "PnL aggregation took too long: {:?}",
        pnl_aggregation_duration
    );

    println!(
        "Benchmark: {} trades - Symbol filter: {:?}, Status filter: {:?}, PnL sum: {:?}",
        num_trades, symbol_filter_duration, status_filter_duration, pnl_aggregation_duration
    );
}

// ============================================================================
// SERIALIZATION BENCHMARKS
// ============================================================================

#[test]
fn bench_json_serialization() {
    use super::super::api::{CreateThesisRequest, SectorFlowRequest};

    let num_iterations = 1_000;

    // Benchmark request serialization
    let request = CreateThesisRequest {
        name: "Test Thesis".to_string(),
        symbol: "AAPL".to_string(),
        direction: "long".to_string(),
        status: Some("active".to_string()),
        conviction: Some("high".to_string()),
        entry_price: Some(150.0),
        target_price: Some(200.0),
        stop_loss: Some(130.0),
        thesis_summary: Some("This is a comprehensive bull case for AAPL based on strong product cycle and services growth".to_string()),
        catalysts: Some(vec![
            "iPhone launch".to_string(),
            "Services growth".to_string(),
            "AR/VR expansion".to_string(),
        ]),
    };

    let start = Instant::now();
    for _ in 0..num_iterations {
        let _ = serde_json::to_string(&request).unwrap();
    }
    let serialization_duration = start.elapsed();

    // Benchmark sector flow request
    let sector_request = SectorFlowRequest {
        sectors: vec![
            "Technology".to_string(),
            "Healthcare".to_string(),
            "Financial".to_string(),
            "Energy".to_string(),
            "Consumer Discretionary".to_string(),
        ],
    };

    let start = Instant::now();
    for _ in 0..num_iterations {
        let _ = serde_json::to_string(&sector_request).unwrap();
    }
    let sector_serialization_duration = start.elapsed();

    // Should serialize 1000 times in under 50ms
    assert!(
        serialization_duration.as_millis() < 50,
        "Thesis serialization too slow: {:?}",
        serialization_duration
    );
    assert!(
        sector_serialization_duration.as_millis() < 50,
        "Sector serialization too slow: {:?}",
        sector_serialization_duration
    );

    println!(
        "Benchmark: {} iterations - Thesis serialize: {:?}, Sector serialize: {:?}",
        num_iterations, serialization_duration, sector_serialization_duration
    );
}

#[test]
fn bench_json_deserialization() {
    use super::super::api::{MarketData, SectorFlow};

    let num_iterations = 1_000;

    let market_data_json = r#"{
        "symbol": "AAPL",
        "price": 175.50,
        "change": 2.30,
        "changePercent": 1.33,
        "volume": 50000000,
        "avgVolume": 42000000,
        "marketCap": 2500000000000.0,
        "peRatio": 28.5,
        "dividendYield": 0.006,
        "high52w": 199.62,
        "low52w": 143.90,
        "timestamp": "2024-01-15T16:00:00Z"
    }"#;

    let sector_flow_json = r#"{
        "symbol": "XLK",
        "netFlow1m": 1500000000.0,
        "netFlow3m": 2400000000.0,
        "institutionalChange": 0.012,
        "smartMoneySentiment": 0.42,
        "flowAcceleration": 0.004,
        "confidenceScore": 0.78
    }"#;

    // Benchmark market data deserialization
    let start = Instant::now();
    for _ in 0..num_iterations {
        let _: MarketData = serde_json::from_str(market_data_json).unwrap();
    }
    let market_data_duration = start.elapsed();

    // Benchmark sector flow deserialization
    let start = Instant::now();
    for _ in 0..num_iterations {
        let _: SectorFlow = serde_json::from_str(sector_flow_json).unwrap();
    }
    let sector_flow_duration = start.elapsed();

    // Should deserialize 1000 times in under 50ms each
    assert!(
        market_data_duration.as_millis() < 50,
        "Market data deserialization too slow: {:?}",
        market_data_duration
    );
    assert!(
        sector_flow_duration.as_millis() < 50,
        "Sector flow deserialization too slow: {:?}",
        sector_flow_duration
    );

    println!(
        "Benchmark: {} iterations - MarketData deserialize: {:?}, SectorFlow deserialize: {:?}",
        num_iterations, market_data_duration, sector_flow_duration
    );
}

// ============================================================================
// MEMORY USAGE TESTS
// ============================================================================

#[test]
fn test_large_note_memory_footprint() {
    // Create notes with varying content sizes and measure relative memory impact

    // Small notes (< 1KB content)
    let small_notes: Vec<_> = (0..1000)
        .map(|i| super::super::notes::Note {
            name: format!("Small Note {}", i),
            note_type: "research".to_string(),
            content: "Short content".to_string(),
            tags: vec!["tag".to_string()],
            symbols: vec!["SYM".to_string()],
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
        })
        .collect();

    // Medium notes (1-10KB content)
    let medium_content = "M".repeat(5000);
    let medium_notes: Vec<_> = (0..1000)
        .map(|i| super::super::notes::Note {
            name: format!("Medium Note {}", i),
            note_type: "research".to_string(),
            content: medium_content.clone(),
            tags: vec!["tag1".to_string(), "tag2".to_string(), "tag3".to_string()],
            symbols: vec!["SYM1".to_string(), "SYM2".to_string()],
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
        })
        .collect();

    // Large notes (>10KB content)
    let large_content = "L".repeat(50000);
    let large_notes: Vec<_> = (0..100)
        .map(|i| super::super::notes::Note {
            name: format!("Large Note {}", i),
            note_type: "research".to_string(),
            content: large_content.clone(),
            tags: (0..20).map(|t| format!("tag{}", t)).collect(),
            symbols: (0..10).map(|s| format!("SYM{}", s)).collect(),
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
        })
        .collect();

    // Verify all collections are created
    assert_eq!(small_notes.len(), 1000);
    assert_eq!(medium_notes.len(), 1000);
    assert_eq!(large_notes.len(), 100);

    // Verify content integrity
    assert_eq!(small_notes[0].content, "Short content");
    assert_eq!(medium_notes[0].content.len(), 5000);
    assert_eq!(large_notes[0].content.len(), 50000);
}

#[test]
fn test_concurrent_loading_simulation() {
    use super::super::app::LoadingState;
    use std::thread;

    // Simulate concurrent loading states (without actual async)
    let start = Instant::now();

    // Simulate 10 concurrent load operations
    let handles: Vec<_> = (0..10)
        .map(|i| {
            thread::spawn(move || {
                let mut state: LoadingState<Vec<u8>> = LoadingState::Loading;

                // Simulate some work
                let data: Vec<u8> = (0..10000).map(|j| ((i + j) % 256) as u8).collect();

                state = LoadingState::Loaded(data);
                state
            })
        })
        .collect();

    // Wait for all to complete
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    let duration = start.elapsed();

    // All should be loaded
    assert!(results.iter().all(|r| r.is_loaded()));

    // Concurrent operations should complete quickly
    assert!(
        duration.as_millis() < 500,
        "Concurrent loading too slow: {:?}",
        duration
    );

    println!("Benchmark: 10 concurrent loads completed in {:?}", duration);
}

// ============================================================================
// STRING OPERATIONS BENCHMARKS
// ============================================================================

#[test]
fn bench_format_number() {
    use super::super::app::format_number;

    let num_iterations = 100_000;
    let test_values = vec![
        0.0,
        123.45,
        1234.56,
        12345.67,
        123456.78,
        1234567.89,
        12345678.90,
        123456789.01,
        1234567890.12,
    ];

    let start = Instant::now();
    for _ in 0..num_iterations {
        for &val in &test_values {
            let _ = format_number(val);
        }
    }
    let duration = start.elapsed();

    // 100k * 9 = 900k format operations
    let ops_per_second = (num_iterations * test_values.len()) as f64 / duration.as_secs_f64();

    println!(
        "Benchmark: format_number - {} ops in {:?} ({:.0} ops/sec)",
        num_iterations * test_values.len(),
        duration,
        ops_per_second
    );

    // Should handle at least 1M ops/sec
    assert!(
        ops_per_second > 1_000_000.0,
        "format_number too slow: {:.0} ops/sec",
        ops_per_second
    );
}

#[test]
fn bench_date_formatting() {
    use super::super::notes::{format_date, format_relative_time};

    let num_iterations = 100_000;
    let test_dates = vec![
        "",
        "2024",
        "2024-01-15",
        "2024-01-15T10:30:00Z",
        "2024-12-31T23:59:59+00:00",
    ];

    // Benchmark format_date
    let start = Instant::now();
    for _ in 0..num_iterations {
        for date in &test_dates {
            let _ = format_date(date);
        }
    }
    let format_date_duration = start.elapsed();

    // Benchmark format_relative_time
    let start = Instant::now();
    for _ in 0..num_iterations {
        for date in &test_dates {
            let _ = format_relative_time(date);
        }
    }
    let format_relative_duration = start.elapsed();

    println!(
        "Benchmark: date formatting - format_date: {:?}, format_relative_time: {:?} ({} iterations each)",
        format_date_duration, format_relative_duration, num_iterations * test_dates.len()
    );

    // Both should be fast
    assert!(
        format_date_duration.as_millis() < 100,
        "format_date too slow"
    );
    assert!(
        format_relative_duration.as_millis() < 100,
        "format_relative_time too slow"
    );
}

// ============================================================================
// SEARCH BENCHMARKS
// ============================================================================

#[test]
fn bench_note_search() {
    let num_notes = 10_000;

    // Create notes with searchable content
    let notes: Vec<super::super::notes::Note> = (0..num_notes)
        .map(|i| super::super::notes::Note {
            name: format!("Research Note on Company {} Analysis", i),
            note_type: "research".to_string(),
            content: format!(
                "This is a detailed analysis of company {}. The company operates in the {} sector. Key metrics include revenue growth of {}% and margin improvement.",
                i,
                if i % 3 == 0 { "technology" } else if i % 3 == 1 { "healthcare" } else { "financial" },
                (i % 50) + 5
            ),
            tags: vec![
                format!("sector{}", i % 5),
                "analysis".to_string(),
                if i % 2 == 0 { "bullish" } else { "neutral" }.to_string(),
            ],
            symbols: vec![format!("SYM{}", i % 100)],
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-15".to_string(),
        })
        .collect();

    // Benchmark simple contains search
    let search_term = "technology";
    let start = Instant::now();
    let results: Vec<&super::super::notes::Note> = notes
        .iter()
        .filter(|n| n.content.contains(search_term))
        .collect();
    let simple_search_duration = start.elapsed();

    // Benchmark multi-field search
    let start = Instant::now();
    let multi_results: Vec<&super::super::notes::Note> = notes
        .iter()
        .filter(|n| {
            n.name.to_lowercase().contains("analysis")
                || n.content.to_lowercase().contains("revenue")
                || n.tags.iter().any(|t| t.contains("bullish"))
        })
        .collect();
    let multi_search_duration = start.elapsed();

    // Benchmark symbol search
    let start = Instant::now();
    let symbol_results: Vec<&super::super::notes::Note> = notes
        .iter()
        .filter(|n| n.symbols.contains(&"SYM50".to_string()))
        .collect();
    let symbol_search_duration = start.elapsed();

    assert!(!results.is_empty());
    assert!(!multi_results.is_empty());
    assert!(!symbol_results.is_empty());

    println!(
        "Benchmark: {} notes search - Simple: {:?} ({} results), Multi-field: {:?} ({} results), Symbol: {:?} ({} results)",
        num_notes,
        simple_search_duration,
        results.len(),
        multi_search_duration,
        multi_results.len(),
        symbol_search_duration,
        symbol_results.len()
    );

    // All searches should be fast
    assert!(simple_search_duration.as_millis() < 20);
    assert!(multi_search_duration.as_millis() < 50);
    assert!(symbol_search_duration.as_millis() < 10);
}
