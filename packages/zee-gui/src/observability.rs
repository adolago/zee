//! Observability View for Stanley GUI
//!
//! Displays system health and metrics including:
//! - Circuit breaker states and statistics
//! - Component health status
//! - API latency histograms
//! - Error rates and trends
//! - Data provider status
//! - WebSocket connection health

use crate::app::LoadState;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::{Div, Stateful, *};
use serde::{Deserialize, Serialize};

// ============================================================================
// API TYPES FOR OBSERVABILITY
// ============================================================================

/// Circuit breaker state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl CircuitState {
    pub fn label(&self) -> &'static str {
        match self {
            CircuitState::Closed => "Closed",
            CircuitState::Open => "Open",
            CircuitState::HalfOpen => "Half-Open",
        }
    }

    pub fn is_healthy(&self) -> bool {
        matches!(self, CircuitState::Closed)
    }
}

/// Circuit breaker status from API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerStatus {
    pub name: String,
    pub state: CircuitState,
    pub failure_count: u32,
    pub success_count: u32,
    pub total_failures: u32,
    pub total_successes: u32,
    pub total_rejected: u32,
    pub last_failure_time: Option<String>,
    pub last_success_time: Option<String>,
}

/// Component health status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

impl HealthStatus {
    pub fn label(&self) -> &'static str {
        match self {
            HealthStatus::Healthy => "Healthy",
            HealthStatus::Degraded => "Degraded",
            HealthStatus::Unhealthy => "Unhealthy",
            HealthStatus::Unknown => "Unknown",
        }
    }
}

/// Component health from API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentHealth {
    pub name: String,
    pub component_type: String,
    pub status: HealthStatus,
    pub last_check: Option<String>,
    pub response_time_ms: Option<f64>,
    pub consecutive_failures: u32,
    pub issues: Vec<HealthIssue>,
}

/// Health issue details
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthIssue {
    pub severity: String,
    pub message: String,
    pub timestamp: String,
}

/// API latency histogram statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyStats {
    pub endpoint: String,
    pub p50_ms: f64,
    pub p90_ms: f64,
    pub p99_ms: f64,
    pub avg_ms: f64,
    pub request_count: u64,
    pub error_count: u64,
}

/// Error rate summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorRateSummary {
    pub total_requests: u64,
    pub total_errors: u64,
    pub error_rate: f64,
    pub errors_by_type: Vec<ErrorTypeCount>,
}

/// Error count by type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorTypeCount {
    pub error_type: String,
    pub count: u64,
}

/// System metrics summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub circuit_breakers: Vec<CircuitBreakerStatus>,
    pub component_health: Vec<ComponentHealth>,
    pub latency_stats: Vec<LatencyStats>,
    pub error_summary: ErrorRateSummary,
    pub uptime_seconds: u64,
    pub timestamp: String,
}

// ============================================================================
// OBSERVABILITY VIEW STATE
// ============================================================================

/// Sub-view within Observability
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ObservabilitySubView {
    #[default]
    Overview,
    CircuitBreakers,
    Health,
    Latency,
    Errors,
}

impl ObservabilitySubView {
    pub fn label(&self) -> &'static str {
        match self {
            ObservabilitySubView::Overview => "Overview",
            ObservabilitySubView::CircuitBreakers => "Circuit Breakers",
            ObservabilitySubView::Health => "Health",
            ObservabilitySubView::Latency => "Latency",
            ObservabilitySubView::Errors => "Errors",
        }
    }

    pub fn all() -> &'static [ObservabilitySubView] {
        &[
            ObservabilitySubView::Overview,
            ObservabilitySubView::CircuitBreakers,
            ObservabilitySubView::Health,
            ObservabilitySubView::Latency,
            ObservabilitySubView::Errors,
        ]
    }
}

/// State for observability view
pub struct ObservabilityState {
    pub sub_view: ObservabilitySubView,
    pub metrics: LoadState<SystemMetrics>,
    pub auto_refresh: bool,
    pub _refresh_interval_seconds: u32,
}

impl Default for ObservabilityState {
    fn default() -> Self {
        Self {
            sub_view: ObservabilitySubView::Overview,
            metrics: LoadState::NotLoaded,
            auto_refresh: true,
            _refresh_interval_seconds: 5,
        }
    }
}

#[allow(dead_code)]
impl ObservabilityState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_sub_view(&mut self, view: ObservabilitySubView) {
        self.sub_view = view;
    }

    pub fn toggle_auto_refresh(&mut self) {
        self.auto_refresh = !self.auto_refresh;
    }
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

/// Main render function for observability view
pub fn render_observability(state: &ObservabilityState, theme: &Theme) -> Stateful<Div> {
    let theme = theme.clone();

    div()
        .id("observability-view")
        .size_full()
        .flex()
        .flex_col()
        .bg(theme.background)
        // Header with sub-view tabs
        .child(render_observability_header(state, &theme))
        // Main content
        .child(
            div()
                .id("observability-content")
                .flex_grow()
                .overflow_y_scroll()
                .p(px(20.0))
                .child(match state.sub_view {
                    ObservabilitySubView::Overview => render_overview(state, &theme),
                    ObservabilitySubView::CircuitBreakers => render_circuit_breakers(state, &theme),
                    ObservabilitySubView::Health => render_health(state, &theme),
                    ObservabilitySubView::Latency => render_latency(state, &theme),
                    ObservabilitySubView::Errors => render_errors(state, &theme),
                }),
        )
}

/// Header with navigation tabs
fn render_observability_header(state: &ObservabilityState, theme: &Theme) -> Div {
    let theme = theme.clone();

    div()
        .h(px(56.0))
        .px(px(20.0))
        .flex()
        .items_center()
        .gap(px(16.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        // Title
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .size(px(32.0))
                        .rounded(px(6.0))
                        .bg(theme.accent)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                                .child("O"),
                        ),
                )
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("System Observability"),
                ),
        )
        // Sub-view tabs
        .child(div().flex().items_center().gap(px(4.0)).children(
            ObservabilitySubView::all().iter().map(|sub| {
                let is_active = state.sub_view == *sub;
                let theme = theme.clone();

                div()
                    .px(px(12.0))
                    .py(px(6.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .bg(if is_active {
                        theme.accent_subtle
                    } else {
                        transparent_black()
                    })
                    .hover(|s| {
                        s.bg(if is_active {
                            theme.accent_subtle
                        } else {
                            theme.hover_bg
                        })
                    })
                    .text_size(px(13.0))
                    .font_weight(if is_active {
                        FontWeight::SEMIBOLD
                    } else {
                        FontWeight::MEDIUM
                    })
                    .text_color(if is_active {
                        theme.accent
                    } else {
                        theme.text_secondary
                    })
                    .child(sub.label())
            }),
        ))
        // Spacer
        .child(div().flex_grow())
        // Auto-refresh toggle
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.text_dimmed)
                        .child("Auto-refresh"),
                )
                .child(
                    div()
                        .size(px(16.0))
                        .rounded(px(4.0))
                        .bg(if state.auto_refresh {
                            theme.positive
                        } else {
                            theme.card_bg_elevated
                        })
                        .cursor_pointer(),
                ),
        )
        // Refresh button
        .child(
            div()
                .px(px(12.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border_subtle)
                .cursor_pointer()
                .hover(|s| s.bg(theme.hover_bg))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child("Refresh"),
        )
}

/// Overview tab - summary of all metrics
fn render_overview(state: &ObservabilityState, theme: &Theme) -> Div {
    let theme = theme.clone();

    match &state.metrics {
        LoadState::NotLoaded => render_loading_placeholder("Loading metrics...", &theme),
        LoadState::Loading => render_loading_placeholder("Fetching system metrics...", &theme),
        LoadState::Error(e) => render_error_state(&format!("Error: {}", e), &theme),
        LoadState::Loaded(metrics) => {
            div()
                .flex()
                .flex_col()
                .gap(px(20.0))
                // Summary cards row
                .child(
                    div()
                        .flex()
                        .gap(px(16.0))
                        .child(render_summary_card(
                            "Uptime",
                            &format_uptime(metrics.uptime_seconds),
                            None,
                            &theme,
                        ))
                        .child(render_summary_card(
                            "Circuit Breakers",
                            &format!(
                                "{} / {}",
                                metrics
                                    .circuit_breakers
                                    .iter()
                                    .filter(|cb| cb.state.is_healthy())
                                    .count(),
                                metrics.circuit_breakers.len()
                            ),
                            Some(
                                metrics
                                    .circuit_breakers
                                    .iter()
                                    .all(|cb| cb.state.is_healthy()),
                            ),
                            &theme,
                        ))
                        .child(render_summary_card(
                            "Components",
                            &format!(
                                "{} / {}",
                                metrics
                                    .component_health
                                    .iter()
                                    .filter(|c| c.status == HealthStatus::Healthy)
                                    .count(),
                                metrics.component_health.len()
                            ),
                            Some(
                                metrics
                                    .component_health
                                    .iter()
                                    .all(|c| c.status == HealthStatus::Healthy),
                            ),
                            &theme,
                        ))
                        .child(render_summary_card(
                            "Error Rate",
                            &format!("{:.2}%", metrics.error_summary.error_rate * 100.0),
                            Some(metrics.error_summary.error_rate < 0.01),
                            &theme,
                        )),
                )
                // Circuit breakers mini-table
                .child(render_section_card(
                    "Circuit Breakers",
                    render_circuit_breakers_mini(&metrics.circuit_breakers, &theme),
                    &theme,
                ))
                // Health status grid
                .child(render_section_card(
                    "Component Health",
                    render_health_mini(&metrics.component_health, &theme),
                    &theme,
                ))
        }
    }
}

/// Circuit breakers detail tab
fn render_circuit_breakers(state: &ObservabilityState, theme: &Theme) -> Div {
    let theme = theme.clone();

    match &state.metrics {
        LoadState::NotLoaded | LoadState::Loading => {
            render_loading_placeholder("Loading circuit breaker data...", &theme)
        }
        LoadState::Error(e) => render_error_state(&format!("Error: {}", e), &theme),
        LoadState::Loaded(metrics) => {
            div()
                .flex()
                .flex_col()
                .gap(px(16.0))
                .children(metrics.circuit_breakers.iter().map(|cb| {
                    let theme = theme.clone();
                    render_circuit_breaker_card(cb, &theme)
                }))
        }
    }
}

/// Render a single circuit breaker card
fn render_circuit_breaker_card(cb: &CircuitBreakerStatus, theme: &Theme) -> Div {
    let state_color = match cb.state {
        CircuitState::Closed => theme.positive,
        CircuitState::Open => theme.negative,
        CircuitState::HalfOpen => theme.warning,
    };

    div()
        .p(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border_subtle)
        .flex()
        .flex_col()
        .gap(px(12.0))
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        .child(div().size(px(12.0)).rounded_full().bg(state_color))
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text)
                                .child(cb.name.clone()),
                        ),
                )
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(state_color.opacity(0.15))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(state_color)
                        .child(cb.state.label()),
                ),
        )
        // Stats grid
        .child(
            div()
                .flex()
                .gap(px(24.0))
                .child(render_stat_item(
                    "Failures",
                    &cb.failure_count.to_string(),
                    theme,
                ))
                .child(render_stat_item(
                    "Successes",
                    &cb.success_count.to_string(),
                    theme,
                ))
                .child(render_stat_item(
                    "Total Failures",
                    &cb.total_failures.to_string(),
                    theme,
                ))
                .child(render_stat_item(
                    "Total Successes",
                    &cb.total_successes.to_string(),
                    theme,
                ))
                .child(render_stat_item(
                    "Rejected",
                    &cb.total_rejected.to_string(),
                    theme,
                )),
        )
}

/// Health detail tab
fn render_health(state: &ObservabilityState, theme: &Theme) -> Div {
    let theme = theme.clone();

    match &state.metrics {
        LoadState::NotLoaded | LoadState::Loading => {
            render_loading_placeholder("Loading health data...", &theme)
        }
        LoadState::Error(e) => render_error_state(&format!("Error: {}", e), &theme),
        LoadState::Loaded(metrics) => {
            div()
                .flex()
                .flex_col()
                .gap(px(16.0))
                .children(metrics.component_health.iter().map(|comp| {
                    let theme = theme.clone();
                    render_health_card(comp, &theme)
                }))
        }
    }
}

/// Render a single component health card
fn render_health_card(comp: &ComponentHealth, theme: &Theme) -> Div {
    let status_color = match comp.status {
        HealthStatus::Healthy => theme.positive,
        HealthStatus::Degraded => theme.warning,
        HealthStatus::Unhealthy => theme.negative,
        HealthStatus::Unknown => theme.text_dimmed,
    };

    div()
        .p(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border_subtle)
        .flex()
        .flex_col()
        .gap(px(12.0))
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        .child(div().size(px(12.0)).rounded_full().bg(status_color))
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text)
                                .child(comp.name.clone()),
                        )
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(theme.card_bg_elevated)
                                .text_size(px(10.0))
                                .text_color(theme.text_muted)
                                .child(comp.component_type.clone()),
                        ),
                )
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(status_color.opacity(0.15))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(status_color)
                        .child(comp.status.label()),
                ),
        )
        // Stats
        .child(
            div().flex().gap(px(24.0)).child(render_stat_item(
                "Response Time",
                &comp
                    .response_time_ms
                    .map(|ms| format!("{:.1}ms", ms))
                    .unwrap_or_else(|| "N/A".to_string()),
                theme,
            )),
        )
        // Issues (if any)
        .when(!comp.issues.is_empty(), |el| {
            el.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_dimmed)
                            .child("ISSUES"),
                    )
                    .children(comp.issues.iter().map(|issue| {
                        let severity_color = match issue.severity.as_str() {
                            "critical" => theme.negative,
                            "warning" => theme.warning,
                            _ => theme.text_muted,
                        };

                        div()
                            .px(px(10.0))
                            .py(px(6.0))
                            .rounded(px(4.0))
                            .bg(severity_color.opacity(0.1))
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .child(div().size(px(6.0)).rounded_full().bg(severity_color))
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(theme.text_secondary)
                                    .child(issue.message.clone()),
                            )
                    })),
            )
        })
}

/// Latency detail tab
fn render_latency(state: &ObservabilityState, theme: &Theme) -> Div {
    let theme = theme.clone();

    match &state.metrics {
        LoadState::NotLoaded | LoadState::Loading => {
            render_loading_placeholder("Loading latency data...", &theme)
        }
        LoadState::Error(e) => render_error_state(&format!("Error: {}", e), &theme),
        LoadState::Loaded(metrics) => {
            div()
                .flex()
                .flex_col()
                .gap(px(16.0))
                // Table header
                .child(
                    div()
                        .flex()
                        .px(px(16.0))
                        .py(px(8.0))
                        .child(
                            div()
                                .w(px(200.0))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_dimmed)
                                .child("ENDPOINT"),
                        )
                        .child(
                            div()
                                .w(px(80.0))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_dimmed)
                                .child("P50"),
                        )
                        .child(
                            div()
                                .w(px(80.0))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_dimmed)
                                .child("P90"),
                        )
                        .child(
                            div()
                                .w(px(80.0))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_dimmed)
                                .child("P99"),
                        )
                        .child(
                            div()
                                .w(px(80.0))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_dimmed)
                                .child("REQUESTS"),
                        )
                        .child(
                            div()
                                .w(px(80.0))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_dimmed)
                                .child("ERRORS"),
                        ),
                )
                // Table rows
                .children(metrics.latency_stats.iter().map(|stat| {
                    let theme = theme.clone();
                    render_latency_row(stat, &theme)
                }))
        }
    }
}

fn render_latency_row(stat: &LatencyStats, theme: &Theme) -> Div {
    let error_rate = if stat.request_count > 0 {
        stat.error_count as f64 / stat.request_count as f64
    } else {
        0.0
    };
    let error_color = if error_rate > 0.05 {
        theme.negative
    } else if error_rate > 0.01 {
        theme.warning
    } else {
        theme.text_secondary
    };

    div()
        .flex()
        .px(px(16.0))
        .py(px(10.0))
        .rounded(px(6.0))
        .bg(theme.card_bg)
        .hover(|s| s.bg(theme.hover_bg))
        .child(
            div()
                .w(px(200.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.text)
                .child(stat.endpoint.clone()),
        )
        .child(
            div()
                .w(px(80.0))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child(format!("{:.1}ms", stat.p50_ms)),
        )
        .child(
            div()
                .w(px(80.0))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child(format!("{:.1}ms", stat.p90_ms)),
        )
        .child(
            div()
                .w(px(80.0))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child(format!("{:.1}ms", stat.p99_ms)),
        )
        .child(
            div()
                .w(px(80.0))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child(stat.request_count.to_string()),
        )
        .child(
            div()
                .w(px(80.0))
                .text_size(px(12.0))
                .text_color(error_color)
                .child(stat.error_count.to_string()),
        )
}

/// Errors detail tab
fn render_errors(state: &ObservabilityState, theme: &Theme) -> Div {
    let theme = theme.clone();

    match &state.metrics {
        LoadState::NotLoaded | LoadState::Loading => {
            render_loading_placeholder("Loading error data...", &theme)
        }
        LoadState::Error(e) => render_error_state(&format!("Error: {}", e), &theme),
        LoadState::Loaded(metrics) => {
            let summary = &metrics.error_summary;

            div()
                .flex()
                .flex_col()
                .gap(px(20.0))
                // Summary cards
                .child(
                    div()
                        .flex()
                        .gap(px(16.0))
                        .child(render_summary_card(
                            "Total Requests",
                            &summary.total_requests.to_string(),
                            None,
                            &theme,
                        ))
                        .child(render_summary_card(
                            "Total Errors",
                            &summary.total_errors.to_string(),
                            Some(summary.total_errors == 0),
                            &theme,
                        ))
                        .child(render_summary_card(
                            "Error Rate",
                            &format!("{:.3}%", summary.error_rate * 100.0),
                            Some(summary.error_rate < 0.01),
                            &theme,
                        )),
                )
                // Error type breakdown
                .child(render_section_card(
                    "Errors by Type",
                    div().flex().flex_col().gap(px(8.0)).children(
                        summary.errors_by_type.iter().map(|err| {
                            let theme = theme.clone();
                            let pct = if summary.total_errors > 0 {
                                err.count as f64 / summary.total_errors as f64 * 100.0
                            } else {
                                0.0
                            };

                            div()
                                .flex()
                                .items_center()
                                .gap(px(12.0))
                                .child(
                                    div()
                                        .w(px(150.0))
                                        .text_size(px(12.0))
                                        .text_color(theme.text)
                                        .child(err.error_type.clone()),
                                )
                                .child(
                                    div()
                                        .flex_grow()
                                        .h(px(8.0))
                                        .rounded(px(4.0))
                                        .bg(theme.card_bg_elevated)
                                        .child(
                                            div()
                                                .h_full()
                                                .rounded(px(4.0))
                                                .bg(theme.negative)
                                                .w(px(pct as f32 * 2.0)),
                                        ),
                                )
                                .child(
                                    div()
                                        .w(px(60.0))
                                        .text_size(px(12.0))
                                        .text_color(theme.text_secondary)
                                        .child(err.count.to_string()),
                                )
                        }),
                    ),
                    &theme,
                ))
        }
    }
}

// ============================================================================
// HELPER RENDER FUNCTIONS
// ============================================================================

fn render_loading_placeholder(message: &str, theme: &Theme) -> Div {
    div()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(14.0))
                .text_color(theme.text_muted)
                .child(message.to_string()),
        )
}

fn render_error_state(message: &str, theme: &Theme) -> Div {
    div()
        .p(px(20.0))
        .rounded(px(8.0))
        .bg(theme.negative.opacity(0.1))
        .border_1()
        .border_color(theme.negative.opacity(0.3))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .size(px(24.0))
                .rounded_full()
                .bg(theme.negative)
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(12.0))
                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                .child("!"),
        )
        .child(
            div()
                .text_size(px(14.0))
                .text_color(theme.negative)
                .child(message.to_string()),
        )
}

fn render_summary_card(label: &str, value: &str, is_healthy: Option<bool>, theme: &Theme) -> Div {
    let indicator_color = match is_healthy {
        Some(true) => theme.positive,
        Some(false) => theme.negative,
        None => theme.text_dimmed,
    };

    div()
        .flex_1()
        .p(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border_subtle)
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(div().size(px(8.0)).rounded_full().bg(indicator_color))
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_dimmed)
                        .child(label.to_string()),
                ),
        )
        .child(
            div()
                .text_size(px(24.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child(value.to_string()),
        )
}

fn render_section_card(title: &str, content: Div, theme: &Theme) -> Div {
    div()
        .p(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border_subtle)
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(
            div()
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_dimmed)
                .child(title.to_string()),
        )
        .child(content)
}

fn render_stat_item(label: &str, value: &str, theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .child(
            div()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child(label.to_string()),
        )
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child(value.to_string()),
        )
}

fn render_circuit_breakers_mini(breakers: &[CircuitBreakerStatus], theme: &Theme) -> Div {
    div()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .children(breakers.iter().map(|cb| {
            let state_color = match cb.state {
                CircuitState::Closed => theme.positive,
                CircuitState::Open => theme.negative,
                CircuitState::HalfOpen => theme.warning,
            };

            div()
                .px(px(12.0))
                .py(px(8.0))
                .rounded(px(6.0))
                .bg(state_color.opacity(0.1))
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(div().size(px(8.0)).rounded_full().bg(state_color))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text)
                        .child(cb.name.clone()),
                )
        }))
}

fn render_health_mini(components: &[ComponentHealth], theme: &Theme) -> Div {
    div()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .children(components.iter().map(|comp| {
            let status_color = match comp.status {
                HealthStatus::Healthy => theme.positive,
                HealthStatus::Degraded => theme.warning,
                HealthStatus::Unhealthy => theme.negative,
                HealthStatus::Unknown => theme.text_dimmed,
            };

            div()
                .px(px(12.0))
                .py(px(8.0))
                .rounded(px(6.0))
                .bg(status_color.opacity(0.1))
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(div().size(px(8.0)).rounded_full().bg(status_color))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text)
                        .child(comp.name.clone()),
                )
        }))
}

fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let minutes = (seconds % 3600) / 60;

    if days > 0 {
        format!("{}d {}h {}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}
