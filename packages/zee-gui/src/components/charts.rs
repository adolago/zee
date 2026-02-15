//! Chart components for data visualization
//!
//! Includes bar charts, line charts, and specialized financial charts
//! for money flow and institutional analysis.

/// Simple bar chart component
#[allow(dead_code)]
pub struct BarChart {
    pub data: Vec<f32>,
    pub labels: Vec<String>,
}

/// Line chart for time series data
#[allow(dead_code)]
pub struct LineChart {
    pub data: Vec<(f64, f64)>,
}

/// Money flow visualization chart
#[allow(dead_code)]
pub struct MoneyFlowChart {
    pub inflow: f32,
    pub outflow: f32,
}
