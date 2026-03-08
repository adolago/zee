//! Signals View for Stanley GUI
//!
//! Displays trading signals, backtest results, and performance tracking:
//! - Active signals grid with buy/sell/hold indicators
//! - Signal cards with entry, target, and stop-loss prices
//! - Confidence meter/bar for each signal
//! - Backtest summary panel with key metrics
//! - Performance statistics dashboard
//! - Filtering by symbol and signal type

pub use crate::app::LoadState;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::Deserialize;

// ============================================================================
// DATA TYPES FOR SIGNALS
// ============================================================================

/// Signal direction type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SignalType {
    Buy,
    Sell,
    #[default]
    Hold,
}

impl SignalType {
    pub fn label(&self) -> &'static str {
        match self {
            SignalType::Buy => "BUY",
            SignalType::Sell => "SELL",
            SignalType::Hold => "HOLD",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "buy" => SignalType::Buy,
            "sell" => SignalType::Sell,
            _ => SignalType::Hold,
        }
    }
}

/// Signal conviction strength
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SignalStrength {
    Weak,
    #[default]
    Moderate,
    Strong,
    VeryStrong,
}

impl SignalStrength {
    pub fn label(&self) -> &'static str {
        match self {
            SignalStrength::Weak => "Weak",
            SignalStrength::Moderate => "Moderate",
            SignalStrength::Strong => "Strong",
            SignalStrength::VeryStrong => "Very Strong",
        }
    }

    pub fn from_conviction(conviction: f64) -> Self {
        if conviction >= 0.8 {
            SignalStrength::VeryStrong
        } else if conviction >= 0.6 {
            SignalStrength::Strong
        } else if conviction >= 0.4 {
            SignalStrength::Moderate
        } else {
            SignalStrength::Weak
        }
    }
}

/// Trading signal from API
#[derive(Debug, Deserialize, Clone)]
pub struct Signal {
    #[serde(rename = "signalId")]
    pub signal_id: String,
    pub symbol: String,
    #[serde(rename = "signalType")]
    pub signal_type: String,
    pub strength: String,
    pub conviction: f64,
    pub factors: std::collections::HashMap<String, f64>,
    #[serde(rename = "priceAtSignal")]
    pub price_at_signal: Option<f64>,
    #[serde(rename = "targetPrice")]
    pub target_price: Option<f64>,
    #[serde(rename = "stopLoss")]
    pub stop_loss: Option<f64>,
    #[serde(rename = "holdingPeriodDays")]
    pub holding_period_days: Option<i32>,
    pub reasoning: Option<String>,
    pub timestamp: String,
}

impl Signal {
    pub fn get_signal_type(&self) -> SignalType {
        SignalType::from_str(&self.signal_type)
    }

    pub fn get_strength(&self) -> SignalStrength {
        SignalStrength::from_conviction(self.conviction)
    }

    /// Calculate potential upside percentage
    pub fn upside_percent(&self) -> Option<f64> {
        match (self.price_at_signal, self.target_price) {
            (Some(price), Some(target)) if price > 0.0 => {
                Some((target - price) / price * 100.0)
            }
            _ => None,
        }
    }

    /// Calculate risk percentage to stop loss
    pub fn risk_percent(&self) -> Option<f64> {
        match (self.price_at_signal, self.stop_loss) {
            (Some(price), Some(stop)) if price > 0.0 => {
                Some((price - stop) / price * 100.0)
            }
            _ => None,
        }
    }

    /// Calculate risk/reward ratio
    pub fn risk_reward_ratio(&self) -> Option<f64> {
        match (self.upside_percent(), self.risk_percent()) {
            (Some(upside), Some(risk)) if risk > 0.0 => Some(upside / risk),
            _ => None,
        }
    }
}

/// Backtest result from API
#[derive(Debug, Deserialize, Clone)]
pub struct BacktestResult {
    #[serde(rename = "totalReturn")]
    pub total_return: f64,
    #[serde(rename = "sharpeRatio")]
    pub sharpe_ratio: f64,
    #[serde(rename = "maxDrawdown")]
    pub max_drawdown: f64,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
    pub trades: i32,
    #[serde(rename = "profitFactor")]
    pub profit_factor: Option<f64>,
    #[serde(rename = "avgHoldingDays")]
    pub avg_holding_days: Option<f64>,
    #[serde(rename = "equityCurve", default)]
    pub equity_curve: Vec<EquityCurvePoint>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct EquityCurvePoint {
    pub date: String,
    pub value: f64,
}

/// Performance statistics from API
#[derive(Debug, Deserialize, Clone)]
pub struct PerformanceStats {
    #[serde(rename = "totalSignals")]
    pub total_signals: i32,
    #[serde(rename = "completedSignals")]
    pub completed_signals: i32,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
    #[serde(rename = "avgReturn")]
    pub avg_return: f64,
    #[serde(rename = "avgWin")]
    pub avg_win: f64,
    #[serde(rename = "avgLoss")]
    pub avg_loss: f64,
    #[serde(rename = "profitFactor")]
    pub profit_factor: f64,
    #[serde(rename = "factorPerformance")]
    pub factor_performance: std::collections::HashMap<String, f64>,
}

/// Sub-view within Signals
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SignalsSubView {
    #[default]
    ActiveSignals,
    Backtest,
    Performance,
}

// Note: API fetch methods for signals should be added to api.rs ZeeApiClient
// when the backend integration is implemented. These types align with the
// Stanley runtime signals HTTP endpoints.

// ============================================================================
// SIGNALS VIEW STATE
// ============================================================================

/// State for signals view
pub struct SignalsState {
    pub sub_view: SignalsSubView,
    pub signals: LoadState<Vec<Signal>>,
    pub backtest: LoadState<BacktestResult>,
    pub performance: LoadState<PerformanceStats>,
    pub symbol_filter: String,
    pub signal_type_filter: Option<SignalType>,
    pub min_conviction_filter: f64,
}

impl Default for SignalsState {
    fn default() -> Self {
        Self {
            sub_view: SignalsSubView::ActiveSignals,
            signals: LoadState::NotLoaded,
            backtest: LoadState::NotLoaded,
            performance: LoadState::NotLoaded,
            symbol_filter: String::new(),
            signal_type_filter: None,
            min_conviction_filter: 0.3,
        }
    }
}

impl SignalsState {
    /// Filter signals based on current filters
    pub fn filtered_signals(&self) -> Vec<Signal> {
        match &self.signals {
            LoadState::Loaded(signals) => {
                signals
                    .iter()
                    .filter(|s| {
                        // Symbol filter
                        if !self.symbol_filter.is_empty() {
                            if !s.symbol.to_uppercase().contains(&self.symbol_filter.to_uppercase()) {
                                return false;
                            }
                        }
                        // Signal type filter
                        if let Some(filter_type) = &self.signal_type_filter {
                            if s.get_signal_type() != *filter_type {
                                return false;
                            }
                        }
                        // Conviction filter
                        if s.conviction < self.min_conviction_filter {
                            return false;
                        }
                        true
                    })
                    .cloned()
                    .collect()
            }
            _ => Vec::new(),
        }
    }
}

// ============================================================================
// SIGNALS VIEW RENDERING
// ============================================================================

/// Render the main signals view
pub fn render_signals(
    theme: &Theme,
    state: &SignalsState,
    _cx: &mut Context<impl Sized>,
) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .child(render_signals_header(theme, state))
        .child(render_signals_content(theme, state))
}

/// Render signals header with sub-navigation and filters
fn render_signals_header(
    theme: &Theme,
    state: &SignalsState,
) -> impl IntoElement {
    let signals_count = match &state.signals {
        LoadState::Loaded(s) => s.len(),
        _ => 0,
    };

    div()
        .h(px(64.0))
        .px(px(24.0))
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(theme.border_subtle)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(24.0))
                // Title
                .child(
                    div()
                        .text_size(px(20.0))
                        .font_weight(FontWeight::BOLD)
                        .child("Trading Signals")
                )
                // Sub-navigation tabs
                .child(
                    div()
                        .flex()
                        .gap(px(4.0))
                        .child(sub_nav_tab(theme, "Active Signals", SignalsSubView::ActiveSignals, state.sub_view))
                        .child(sub_nav_tab(theme, "Backtest", SignalsSubView::Backtest, state.sub_view))
                        .child(sub_nav_tab(theme, "Performance", SignalsSubView::Performance, state.sub_view))
                )
        )
        .child(
            // Signal count badge
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Active Signals:")
                )
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(theme.accent.opacity(0.15))
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.accent)
                        .child(format!("{}", signals_count))
                )
        )
}

/// Sub-navigation tab
fn sub_nav_tab(
    theme: &Theme,
    label: &str,
    view: SignalsSubView,
    active: SignalsSubView,
) -> impl IntoElement {
    let is_active = view == active;

    div()
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .cursor_pointer()
        .bg(if is_active { theme.accent_subtle } else { transparent_black() })
        .text_color(if is_active { theme.accent } else { theme.text_muted })
        .text_size(px(12.0))
        .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
        .hover(|s| s.bg(theme.hover_bg))
        .child(label.to_string())
}

/// Render content based on sub-view
fn render_signals_content(
    theme: &Theme,
    state: &SignalsState,
) -> impl IntoElement {
    match state.sub_view {
        SignalsSubView::ActiveSignals => render_active_signals(theme, state).into_any_element(),
        SignalsSubView::Backtest => render_backtest(theme, state).into_any_element(),
        SignalsSubView::Performance => render_performance(theme, state).into_any_element(),
    }
}

// ============================================================================
// ACTIVE SIGNALS VIEW
// ============================================================================

fn render_active_signals(
    theme: &Theme,
    state: &SignalsState,
) -> impl IntoElement {
    div()
        .id("active-signals-scroll")
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_scroll()
        // Filters row
        .child(render_filters(theme, state))
        // Signals content
        .child(
            match &state.signals {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(_) => {
                    let filtered = state.filtered_signals();
                    if filtered.is_empty() {
                        div()
                            .py(px(40.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .text_color(theme.text_muted)
                                    .child("No signals match the current filters")
                            )
                    } else {
                        div()
                            .flex()
                            .gap(px(20.0))
                            .items_start()
                            .child(
                                div()
                                    .flex_1()
                                    .child(render_signals_grid(theme, &filtered))
                            )
                            .child(
                                div()
                                    .w(px(260.0))
                                    .flex()
                                    .flex_col()
                                    .gap(px(12.0))
                                    .child(render_signal_summary(theme, &filtered))
                                    .child(render_top_signals(theme, &filtered, 6))
                            )
                    }
                }
                _ => render_empty_state(theme),
            }
        )
}

/// Render filter controls
fn render_filters(
    theme: &Theme,
    state: &SignalsState,
) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(16.0))
        // Symbol filter (placeholder - would need text input component)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Filter:")
                )
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(theme.card_bg)
                        .border_1()
                        .border_color(theme.border)
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .child(if state.symbol_filter.is_empty() {
                            "All symbols".to_string()
                        } else {
                            state.symbol_filter.clone()
                        })
                )
        )
        // Signal type filters
        .child(
            div()
                .flex()
                .gap(px(4.0))
                .child(signal_type_filter_button(theme, "All", None, state.signal_type_filter))
                .child(signal_type_filter_button(theme, "Buy", Some(SignalType::Buy), state.signal_type_filter))
                .child(signal_type_filter_button(theme, "Sell", Some(SignalType::Sell), state.signal_type_filter))
                .child(signal_type_filter_button(theme, "Hold", Some(SignalType::Hold), state.signal_type_filter))
        )
        // Conviction threshold
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Min Conviction:")
                )
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(theme.card_bg_elevated)
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(format!("{:.0}%", state.min_conviction_filter * 100.0))
                )
        )
}

/// Signal type filter button
fn signal_type_filter_button(
    theme: &Theme,
    label: &str,
    filter_type: Option<SignalType>,
    current: Option<SignalType>,
) -> impl IntoElement {
    let is_active = filter_type == current;

    div()
        .px(px(10.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .cursor_pointer()
        .bg(if is_active { theme.accent_subtle } else { theme.card_bg })
        .text_color(if is_active { theme.accent } else { theme.text_muted })
        .text_size(px(11.0))
        .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
        .hover(|s| s.bg(theme.hover_bg))
        .child(label.to_string())
}

/// Render signals grid
fn render_signals_grid(theme: &Theme, signals: &[Signal]) -> Div {
    div()
        .flex()
        .flex_wrap()
        .gap(px(16.0))
        .children(
            signals.iter().map(|signal| {
                render_signal_card(theme, signal)
            }).collect::<Vec<_>>()
        )
}

/// Render individual signal card
fn render_signal_card(theme: &Theme, signal: &Signal) -> impl IntoElement {
    let signal_type = signal.get_signal_type();
    let strength = signal.get_strength();
    let strength_label = if signal.strength.trim().is_empty() {
        strength.label().to_string()
    } else {
        format_strength_label(&signal.strength)
    };
    let signal_id_short: String = signal.signal_id.chars().take(10).collect();
    let timestamp_display: String = signal.timestamp.chars().take(16).collect();

    let type_color = match signal_type {
        SignalType::Buy => theme.positive,
        SignalType::Sell => theme.negative,
        SignalType::Hold => theme.warning,
    };

    let strength_color = match strength {
        SignalStrength::VeryStrong => theme.positive,
        SignalStrength::Strong => theme.accent,
        SignalStrength::Moderate => theme.warning,
        SignalStrength::Weak => theme.text_muted,
    };

    div()
        .w(px(320.0))
        .p(px(20.0))
        .rounded(px(12.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .hover(|s| s.border_color(theme.accent).bg(theme.card_bg_elevated))
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Header: Symbol + Signal Type Badge
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
                        .child(
                            div()
                                .text_size(px(18.0))
                                .font_weight(FontWeight::BOLD)
                                .child(signal.symbol.clone())
                        )
                        .child(
                            // Signal type badge
                            div()
                                .px(px(10.0))
                                .py(px(4.0))
                                .rounded(px(6.0))
                                .bg(type_color.opacity(0.15))
                                .text_size(px(11.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(type_color)
                                .child(signal_type.label())
                        )
                )
                .child(
                    // Strength badge
                    div()
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(strength_color.opacity(0.15))
                        .text_size(px(10.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(strength_color)
                        .child(strength_label)
                )
        )
        // Confidence meter
        .child(render_confidence_meter(theme, signal.conviction))
        // Price targets
        .child(render_price_targets(theme, signal))
        // Factor breakdown
        .child(render_factor_breakdown(theme, signal))
        // Reasoning (if available)
        .when_some(signal.reasoning.as_ref(), |d, reasoning| {
            d.child(
                div()
                    .pt(px(12.0))
                    .border_t_1()
                    .border_color(theme.border_subtle)
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_secondary)
                            .line_height(px(16.0))
                            .child(reasoning.clone())
                    )
            )
        })
        // Timestamp
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(format!("Generated: {}", timestamp_display))
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(format!(
                            "ID: {}{}",
                            signal_id_short,
                            if signal.signal_id.len() > 10 { "..." } else { "" }
                        ))
                )
        )
        .when_some(signal.holding_period_days, |d, days| {
            d.child(
                div()
                    .text_size(px(10.0))
                    .text_color(theme.text_muted)
                    .child(format!("Suggested hold: {}d", days))
            )
        })
}

/// Render confidence meter bar
fn render_confidence_meter(theme: &Theme, conviction: f64) -> impl IntoElement {
    let pct = (conviction * 100.0).clamp(0.0, 100.0) as f32;
    let color = if conviction >= 0.7 {
        theme.positive
    } else if conviction >= 0.5 {
        theme.accent
    } else if conviction >= 0.3 {
        theme.warning
    } else {
        theme.negative
    };

    div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.text_muted)
                        .child("Confidence")
                )
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:.0}%", conviction * 100.0))
                )
        )
        .child(
            // Progress bar background
            div()
                .h(px(8.0))
                .rounded(px(4.0))
                .bg(theme.border_subtle)
                .child(
                    // Progress bar fill
                    div()
                        .h_full()
                        .w(px(pct * 2.8)) // Scale to card width ~280px
                        .rounded(px(4.0))
                        .bg(color)
                )
        )
}

/// Render price targets section
fn render_price_targets(theme: &Theme, signal: &Signal) -> impl IntoElement {
    div()
        .flex()
        .gap(px(12.0))
        // Entry Price
        .child(
            price_target_box(
                theme,
                "Entry",
                signal.price_at_signal,
                theme.text,
            )
        )
        // Target Price
        .child(
            price_target_box(
                theme,
                "Target",
                signal.target_price,
                theme.positive,
            )
        )
        // Stop Loss
        .child(
            price_target_box(
                theme,
                "Stop",
                signal.stop_loss,
                theme.negative,
            )
        )
        // Risk/Reward
        .when_some(signal.risk_reward_ratio(), |d, rr| {
            d.child(
                div()
                    .flex_1()
                    .p(px(10.0))
                    .rounded(px(6.0))
                    .bg(theme.card_bg_elevated)
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(4.0))
                    .child(
                        div()
                            .text_size(px(9.0))
                            .text_color(theme.text_dimmed)
                            .child("R/R")
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(if rr >= 2.0 { theme.positive } else { theme.text })
                            .child(format!("{:.1}:1", rr))
                    )
            )
        })
}

/// Individual price target box
fn price_target_box(
    theme: &Theme,
    label: &str,
    value: Option<f64>,
    color: Hsla,
) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(10.0))
        .rounded(px(6.0))
        .bg(theme.card_bg_elevated)
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(9.0))
                .text_color(theme.text_dimmed)
                .child(label.to_string())
        )
        .child(
            div()
                .text_size(px(13.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(
                    value.map(|v| format!("${:.2}", v)).unwrap_or("--".to_string())
                )
        )
}

/// Render factor breakdown bars
fn render_factor_breakdown(theme: &Theme, signal: &Signal) -> impl IntoElement {
    let factors: Vec<(&str, f64)> = signal.factors.iter()
        .take(4) // Show top 4 factors
        .map(|(k, v)| (k.as_str(), *v))
        .collect();

    div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child("FACTOR BREAKDOWN")
        )
        .children(
            factors.iter().map(|(name, value)| {
                let positive = *value >= 0.0;
                let color = if positive { theme.positive } else { theme.negative };
                let pct = (value.abs() * 100.0).min(100.0) as f32;

                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .w(px(70.0))
                            .text_size(px(10.0))
                            .text_color(theme.text_secondary)
                            .child(format_factor_name(name))
                    )
                    .child(
                        div()
                            .flex_grow()
                            .h(px(4.0))
                            .rounded(px(2.0))
                            .bg(theme.border_subtle)
                            .child(
                                div()
                                    .h_full()
                                    .w(px(pct * 0.8)) // Scale to available width
                                    .rounded(px(2.0))
                                    .bg(color)
                            )
                    )
                    .child(
                        div()
                            .w(px(40.0))
                            .text_size(px(10.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color)
                            .text_align(gpui::TextAlign::Right)
                            .child(format!("{:+.0}%", value * 100.0))
                    )
            }).collect::<Vec<_>>()
        )
}

// ============================================================================
// BACKTEST VIEW
// ============================================================================

fn render_backtest(
    theme: &Theme,
    state: &SignalsState,
) -> impl IntoElement {
    div()
        .id("backtest-scroll")
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_scroll()
        .child(
            card(theme, "Backtest Results",
                match &state.backtest {
                    LoadState::Loading => loading_indicator(theme),
                    LoadState::Error(e) => error_message(theme, e),
                    LoadState::Loaded(result) => render_backtest_results(theme, result),
                    _ => render_backtest_form(theme),
                }
            )
        )
        .child(
            card(
                theme,
                "Equity Curve",
                match &state.backtest {
                    LoadState::Loading => loading_indicator(theme),
                    LoadState::Error(e) => error_message(theme, e),
                    LoadState::Loaded(result) => render_equity_curve(theme, &result.equity_curve),
                    _ => render_equity_curve_empty(theme),
                },
            )
        )
}

/// Render backtest form (placeholder)
fn render_backtest_form(theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(14.0))
                .text_color(theme.text_secondary)
                .child("Configure backtest parameters and run analysis on historical signals.")
        )
        .child(
            div()
                .flex()
                .gap(px(12.0))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_muted)
                                .child("Holding Period")
                        )
                        .child(
                            div()
                                .p(px(12.0))
                                .rounded(px(6.0))
                                .bg(theme.card_bg_elevated)
                                .text_size(px(14.0))
                                .child("30 days")
                        )
                )
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_muted)
                                .child("Initial Capital")
                        )
                        .child(
                            div()
                                .p(px(12.0))
                                .rounded(px(6.0))
                                .bg(theme.card_bg_elevated)
                                .text_size(px(14.0))
                                .child("$100,000")
                        )
                )
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_muted)
                                .child("Position Size")
                        )
                        .child(
                            div()
                                .p(px(12.0))
                                .rounded(px(6.0))
                                .bg(theme.card_bg_elevated)
                                .text_size(px(14.0))
                                .child("10%")
                        )
                )
        )
        .child(
            div()
                .px(px(20.0))
                .py(px(12.0))
                .rounded(px(8.0))
                .bg(theme.accent)
                .cursor_pointer()
                .hover(|s| s.bg(theme.accent_hover))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                .child("Run Backtest")
        )
}

/// Render backtest results
fn render_backtest_results(theme: &Theme, result: &BacktestResult) -> Div {
    let return_positive = result.total_return >= 0.0;
    let return_color = if return_positive { theme.positive } else { theme.negative };

    div()
        .flex()
        .flex_col()
        .gap(px(20.0))
        // Main metrics row
        .child(
            div()
                .flex()
                .gap(px(16.0))
                .child(backtest_metric(theme, "Total Return", &format!("{:+.2}%", result.total_return), return_color))
                .child(backtest_metric(theme, "Sharpe Ratio", &format!("{:.2}", result.sharpe_ratio), theme.accent))
                .child(backtest_metric(theme, "Max Drawdown", &format!("{:.2}%", result.max_drawdown), theme.negative))
                .child(backtest_metric(theme, "Win Rate", &format!("{:.1}%", result.win_rate * 100.0), theme.text))
        )
        // Secondary metrics
        .child(
            div()
                .flex()
                .gap(px(16.0))
                .child(backtest_metric(theme, "Total Trades", &format!("{}", result.trades), theme.text))
                .child(backtest_metric(
                    theme,
                    "Profit Factor",
                    &result.profit_factor.map(|pf| format!("{:.2}", pf)).unwrap_or("--".to_string()),
                    theme.accent,
                ))
                .child(backtest_metric(
                    theme,
                    "Avg Hold Days",
                    &result.avg_holding_days.map(|d| format!("{:.1}", d)).unwrap_or("--".to_string()),
                    theme.text,
                ))
        )
}

/// Single backtest metric card
fn backtest_metric(theme: &Theme, label: &str, value: &str, color: Hsla) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(16.0))
        .rounded(px(10.0))
        .bg(theme.card_bg_elevated)
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .child(label.to_string())
        )
        .child(
            div()
                .text_size(px(24.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(value.to_string())
        )
}

fn render_equity_curve(theme: &Theme, points: &[EquityCurvePoint]) -> Div {
    if points.is_empty() {
        return render_equity_curve_empty(theme);
    }

    let values: Vec<f64> = points
        .iter()
        .map(|point| point.value)
        .filter(|value| value.is_finite())
        .collect();
    let start = values.first().copied().unwrap_or(0.0);
    let end = values.last().copied().unwrap_or(0.0);
    let pnl = end - start;
    let pnl_pct = if start.abs() < f64::EPSILON {
        0.0
    } else {
        (pnl / start) * 100.0
    };
    let pnl_color = if pnl >= 0.0 { theme.positive } else { theme.negative };

    let sparkline = {
        let palette = ['.', ':', '-', '=', '+', '*', '#'];
        let min = values
            .iter()
            .fold(f64::INFINITY, |acc, v| if *v < acc { *v } else { acc });
        let max = values
            .iter()
            .fold(f64::NEG_INFINITY, |acc, v| if *v > acc { *v } else { acc });
        let range = (max - min).abs();

        values
            .iter()
            .map(|value| {
                if range < f64::EPSILON {
                    return '=';
                }
                let normalized = (value - min) / range;
                let idx = (normalized * (palette.len() - 1) as f64).round() as usize;
                palette[idx.min(palette.len() - 1)]
            })
            .collect::<String>()
    };

    div()
        .p(px(12.0))
        .flex()
        .flex_col()
        .gap(px(10.0))
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child(format!("{} points", values.len()))
        )
        .child(
            div()
                .rounded(px(6.0))
                .bg(theme.background)
                .border_1()
                .border_color(theme.border_subtle)
                .px(px(8.0))
                .py(px(8.0))
                .text_size(px(11.0))
                .text_color(theme.text_secondary)
                .child(sparkline)
        )
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child(format!("Start ${:.2}", start)),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child(format!("End ${:.2}", end)),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(pnl_color)
                        .child(format!("{:+.2}% ({:+.2})", pnl_pct, pnl)),
                )
        )
}

fn render_equity_curve_empty(theme: &Theme) -> Div {
    div()
        .h(px(140.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .child(
            div()
                .text_size(px(13.0))
                .text_color(theme.text_muted)
                .child("No equity curve data returned"),
        )
}

// ============================================================================
// PERFORMANCE VIEW
// ============================================================================

fn render_performance(
    theme: &Theme,
    state: &SignalsState,
) -> impl IntoElement {
    div()
        .id("performance-scroll")
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_scroll()
        .child(
            match &state.performance {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(stats) => render_performance_dashboard(theme, stats),
                _ => render_performance_placeholder(theme),
            }
        )
}

/// Render performance dashboard
fn render_performance_dashboard(theme: &Theme, stats: &PerformanceStats) -> Div {
    let win_rate_color = if stats.win_rate >= 0.5 { theme.positive } else { theme.negative };
    let avg_return_color = if stats.avg_return >= 0.0 { theme.positive } else { theme.negative };

    div()
        .flex()
        .flex_col()
        .gap(px(20.0))
        // Overview metrics
        .child(
            card(theme, "Performance Overview",
                div()
                    .flex()
                    .gap(px(16.0))
                    .child(performance_metric(theme, "Total Signals", &format!("{}", stats.total_signals), theme.accent))
                    .child(performance_metric(theme, "Completed", &format!("{}", stats.completed_signals), theme.text))
                    .child(performance_metric(theme, "Win Rate", &format!("{:.1}%", stats.win_rate * 100.0), win_rate_color))
                    .child(performance_metric(theme, "Avg Return", &format!("{:+.2}%", stats.avg_return), avg_return_color))
            )
        )
        // Win/Loss analysis
        .child(
            card(theme, "Win/Loss Analysis",
                div()
                    .flex()
                    .gap(px(16.0))
                    .child(performance_metric(theme, "Avg Win", &format!("{:+.2}%", stats.avg_win), theme.positive))
                    .child(performance_metric(theme, "Avg Loss", &format!("{:.2}%", stats.avg_loss), theme.negative))
                    .child(performance_metric(theme, "Profit Factor", &format!("{:.2}", stats.profit_factor),
                        if stats.profit_factor >= 1.0 { theme.positive } else { theme.negative }
                    ))
            )
        )
        // Factor performance
        .child(
            card(theme, "Factor Performance", render_factor_performance(theme, stats))
        )
}

/// Single performance metric
fn performance_metric(theme: &Theme, label: &str, value: &str, color: Hsla) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(16.0))
        .rounded(px(10.0))
        .bg(theme.card_bg_elevated)
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .child(label.to_string())
        )
        .child(
            div()
                .text_size(px(22.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(value.to_string())
        )
}

/// Render factor performance bars
fn render_factor_performance(theme: &Theme, stats: &PerformanceStats) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .children(
            stats.factor_performance.iter().map(|(factor, performance)| {
                let positive = *performance >= 0.0;
                let color = if positive { theme.positive } else { theme.negative };
                let pct = (performance.abs() * 100.0).min(100.0) as f32;

                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.text_secondary)
                            .child(format_factor_name(factor))
                    )
                    .child(
                        div()
                            .flex_grow()
                            .h(px(12.0))
                            .rounded(px(6.0))
                            .bg(theme.border_subtle)
                            .child(
                                div()
                                    .h_full()
                                    .w(px(pct * 2.0)) // Scale to available width
                                    .rounded(px(6.0))
                                    .bg(color)
                            )
                    )
                    .child(
                        div()
                            .w(px(60.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(color)
                            .text_align(gpui::TextAlign::Right)
                            .child(format!("{:+.2}%", performance * 100.0))
                    )
            }).collect::<Vec<_>>()
        )
}

/// Performance placeholder when no data
fn render_performance_placeholder(theme: &Theme) -> Div {
    div()
        .py(px(60.0))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(16.0))
        .child(
            div()
                .size(px(64.0))
                .rounded(px(16.0))
                .bg(theme.accent.opacity(0.15))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(28.0))
                .text_color(theme.accent)
                .child("S")
        )
        .child(
            div()
                .text_size(px(16.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child("No Performance Data Yet")
        )
        .child(
            div()
                .text_size(px(14.0))
                .text_color(theme.text_muted)
                .child("Generate signals and track their outcomes to see performance metrics.")
        )
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn format_strength_label(raw: &str) -> String {
    raw.split('_')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    let mut label = String::new();
                    label.extend(first.to_uppercase());
                    label.push_str(chars.as_str());
                    label
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Card wrapper component
fn card(theme: &Theme, title: &str, content: impl IntoElement) -> impl IntoElement {
    div()
        .p(px(20.0))
        .rounded(px(10.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title.to_string())
        )
        .child(content)
}

/// Loading indicator
fn loading_indicator(theme: &Theme) -> Div {
    div()
        .py(px(40.0))
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(13.0))
                .text_color(theme.text_dimmed)
                .child("Loading signals...")
        )
}

/// Error message display
fn error_message(theme: &Theme, msg: &str) -> Div {
    div()
        .py(px(20.0))
        .px(px(16.0))
        .rounded(px(6.0))
        .bg(theme.negative.opacity(0.1))
        .text_size(px(12.0))
        .text_color(theme.negative)
        .child(msg.to_string())
}

/// Empty state when no signals generated
fn render_empty_state(theme: &Theme) -> Div {
    div()
        .py(px(60.0))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(16.0))
        .child(
            div()
                .size(px(64.0))
                .rounded(px(16.0))
                .bg(theme.accent.opacity(0.15))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(28.0))
                .text_color(theme.accent)
                .child("S")
        )
        .child(
            div()
                .text_size(px(16.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child("No Active Signals")
        )
        .child(
            div()
                .text_size(px(14.0))
                .text_color(theme.text_muted)
                .max_w(px(400.0))
                .text_align(gpui::TextAlign::Center)
                .child("Generate signals for your watchlist to see trading opportunities based on multi-factor analysis.")
        )
        .child(
            div()
                .mt(px(8.0))
                .px(px(20.0))
                .py(px(12.0))
                .rounded(px(8.0))
                .bg(theme.accent)
                .cursor_pointer()
                .hover(|s| s.bg(theme.accent_hover))
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                .child("Generate Signals")
        )
}

/// Format factor name for display
fn format_factor_name(name: &str) -> String {
    name.replace("_", " ")
        .split_whitespace()
        .map(|word| {
            let mut chars: Vec<char> = word.chars().collect();
            if !chars.is_empty() {
                chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
            }
            chars.into_iter().collect::<String>()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ============================================================================
// SIGNAL SUMMARY WIDGET (for sidebar/dashboard)
// ============================================================================

/// Render compact signal summary for dashboard
pub fn render_signal_summary(
    theme: &Theme,
    signals: &[Signal],
) -> impl IntoElement {
    let buy_count = signals.iter().filter(|s| s.get_signal_type() == SignalType::Buy).count();
    let sell_count = signals.iter().filter(|s| s.get_signal_type() == SignalType::Sell).count();
    let hold_count = signals.iter().filter(|s| s.get_signal_type() == SignalType::Hold).count();

    div()
        .p(px(16.0))
        .rounded(px(10.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("Signal Summary")
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.text_muted)
                        .child(format!("{} total", signals.len()))
                )
        )
        .child(
            div()
                .flex()
                .gap(px(8.0))
                .child(signal_count_badge(theme, "Buy", buy_count, theme.positive))
                .child(signal_count_badge(theme, "Sell", sell_count, theme.negative))
                .child(signal_count_badge(theme, "Hold", hold_count, theme.warning))
        )
}

/// Signal count badge for summary
fn signal_count_badge(
    _theme: &Theme,
    label: &str,
    count: usize,
    color: Hsla,
) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(10.0))
        .rounded(px(6.0))
        .bg(color.opacity(0.1))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(18.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(format!("{}", count))
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(color)
                .child(label.to_string())
        )
}

// ============================================================================
// TOP SIGNALS WIDGET (for sidebar)
// ============================================================================

/// Render top signals list for sidebar
pub fn render_top_signals(
    theme: &Theme,
    signals: &[Signal],
    max_count: usize,
) -> impl IntoElement {
    // Sort by conviction and take top N
    let mut sorted: Vec<&Signal> = signals.iter().collect();
    sorted.sort_by(|a, b| b.conviction.partial_cmp(&a.conviction).unwrap_or(std::cmp::Ordering::Equal));

    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .children(
            sorted.iter().take(max_count).map(|signal| {
                let signal_type = signal.get_signal_type();
                let type_color = match signal_type {
                    SignalType::Buy => theme.positive,
                    SignalType::Sell => theme.negative,
                    SignalType::Hold => theme.warning,
                };

                div()
                    .px(px(12.0))
                    .py(px(10.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .hover(|s| s.bg(theme.hover_bg))
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(signal.symbol.clone())
                            )
                            .child(
                                div()
                                    .px(px(6.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .bg(type_color.opacity(0.15))
                                    .text_size(px(9.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(type_color)
                                    .child(signal_type.label())
                            )
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.accent)
                            .child(format!("{:.0}%", signal.conviction * 100.0))
                    )
            }).collect::<Vec<_>>()
        )
}
