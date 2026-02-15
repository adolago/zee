//! Table components for data display
//!
//! Sortable, filterable tables for institutional holdings,
//! money flow data, and other tabular information.

/// Data table component
#[allow(dead_code)]
pub struct DataTable {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Institutional holdings table
#[allow(dead_code)]
pub struct HoldingsTable {
    pub holdings: Vec<HoldingRow>,
}

/// Single holding row data
#[allow(dead_code)]
pub struct HoldingRow {
    pub manager_name: String,
    pub shares: u64,
    pub value: f64,
    pub ownership_pct: f32,
    pub change_pct: f32,
}
