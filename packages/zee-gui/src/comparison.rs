//! Multi-Symbol Comparison Module for Stanley GUI
//!
//! This module provides comprehensive comparison functionality for analyzing
//! multiple symbols side-by-side, including relative performance, correlation
//! analysis, and peer group comparisons.

// Allow dead_code for this module as it contains placeholder functions for future implementation
#![allow(dead_code)]

use crate::api::*;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use std::collections::HashMap;

// =============================================================================
// DATA STRUCTURES FOR COMPARISON
// =============================================================================

/// Comparison mode types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ComparisonMode {
    #[default]
    SideBySide,
    Overlay,
    RelativePerformance,
    Correlation,
    PeerGroup,
    SectorStrength,
}

/// Symbol data for comparison
#[derive(Debug, Clone)]
pub struct ComparisonSymbol {
    pub symbol: String,
    pub color: Hsla,
    pub enabled: bool,
    pub market_data: Option<MarketData>,
    pub equity_flow: Option<EquityFlowData>,
    pub research: Option<ResearchData>,
    pub history: Vec<HistoryPoint>,
}

#[derive(Debug, Clone, Default)]
pub struct HistoryPoint {
    pub date: String,
    pub close: f64,
}

/// Relative performance data point
#[derive(Debug, Clone)]
pub struct RelativePerformancePoint {
    pub date: String,
    pub values: HashMap<String, f64>, // symbol -> normalized % return
}

/// Correlation matrix entry
#[derive(Debug, Clone)]
pub struct CorrelationEntry {
    pub symbol_a: String,
    pub symbol_b: String,
    pub correlation: f64,
}

/// Peer comparison metrics
#[derive(Debug, Clone)]
pub struct PeerMetrics {
    pub symbol: String,
    pub pe_ratio: f64,
    pub forward_pe: f64,
    pub peg_ratio: f64,
    pub price_to_sales: f64,
    pub price_to_book: f64,
    pub ev_to_ebitda: f64,
    pub dividend_yield: f64,
    pub market_cap: f64,
    pub money_flow_score: f64,
    pub institutional_sentiment: f64,
}

// =============================================================================
// COMPARISON STATE
// =============================================================================

/// State for multi-symbol comparison
#[derive(Default)]
pub struct ComparisonState {
    pub mode: ComparisonMode,
    pub symbols: Vec<ComparisonSymbol>,
    pub base_symbol: Option<String>, // For relative performance calculations
    pub time_period: TimePeriod,
    pub correlation_matrix: HashMap<(String, String), f64>,
    pub peer_metrics: Vec<PeerMetrics>,
    pub loading: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimePeriod {
    OneDay,
    OneWeek,
    OneMonth,
    #[default]
    ThreeMonths,
    SixMonths,
    OneYear,
    YearToDate,
}

impl TimePeriod {
    pub fn label(&self) -> &'static str {
        match self {
            TimePeriod::OneDay => "1D",
            TimePeriod::OneWeek => "1W",
            TimePeriod::OneMonth => "1M",
            TimePeriod::ThreeMonths => "3M",
            TimePeriod::SixMonths => "6M",
            TimePeriod::OneYear => "1Y",
            TimePeriod::YearToDate => "YTD",
        }
    }
}

impl ComparisonState {
    pub fn new() -> Self {
        Self {
            mode: ComparisonMode::SideBySide,
            symbols: Vec::new(),
            base_symbol: None,
            time_period: TimePeriod::ThreeMonths,
            correlation_matrix: HashMap::new(),
            peer_metrics: Vec::new(),
            loading: false,
        }
    }

    /// Default colors for comparison symbols
    pub fn symbol_colors() -> Vec<Hsla> {
        vec![
            hsla(210.0 / 360.0, 0.92, 0.58, 1.0), // Blue
            hsla(152.0 / 360.0, 0.72, 0.48, 1.0), // Green
            hsla(4.0 / 360.0, 0.75, 0.55, 1.0),   // Red
            hsla(40.0 / 360.0, 0.92, 0.52, 1.0),  // Orange
            hsla(280.0 / 360.0, 0.70, 0.55, 1.0), // Purple
            hsla(180.0 / 360.0, 0.65, 0.45, 1.0), // Cyan
            hsla(320.0 / 360.0, 0.70, 0.55, 1.0), // Pink
            hsla(60.0 / 360.0, 0.80, 0.50, 1.0),  // Yellow
        ]
    }

    pub fn add_symbol(&mut self, symbol: String) {
        let color_idx = self.symbols.len() % Self::symbol_colors().len();
        self.symbols.push(ComparisonSymbol {
            symbol,
            color: Self::symbol_colors()[color_idx],
            enabled: true,
            market_data: None,
            equity_flow: None,
            research: None,
            history: Vec::new(),
        });
    }

    pub fn remove_symbol(&mut self, symbol: &str) {
        self.symbols.retain(|s| s.symbol != symbol);
    }

    pub fn toggle_symbol(&mut self, symbol: &str) {
        if let Some(s) = self.symbols.iter_mut().find(|s| s.symbol == symbol) {
            s.enabled = !s.enabled;
        }
    }
}

// =============================================================================
// COMPARISON VIEW COMPONENT
// =============================================================================

/// Renders the comparison mode selector tabs
pub fn render_comparison_mode_tabs(
    theme: &Theme,
    current_mode: ComparisonMode,
    on_mode_change: impl Fn(ComparisonMode) + 'static + Clone,
) -> impl IntoElement {
    let modes = [
        (ComparisonMode::SideBySide, "Side by Side"),
        (ComparisonMode::Overlay, "Overlay"),
        (ComparisonMode::RelativePerformance, "Relative"),
        (ComparisonMode::Correlation, "Correlation"),
        (ComparisonMode::PeerGroup, "Peer Group"),
        (ComparisonMode::SectorStrength, "Sector"),
    ];

    div()
        .flex()
        .gap(px(4.0))
        .px(px(8.0))
        .py(px(8.0))
        .bg(theme.card_bg)
        .rounded(px(8.0))
        .children(modes.iter().map(|(mode, label)| {
            let is_active = current_mode == *mode;
            let mode_clone = *mode;
            let on_change = on_mode_change.clone();

            div()
                .id(SharedString::from(format!("mode-{:?}", mode)))
                .px(px(14.0))
                .py(px(8.0))
                .rounded(px(6.0))
                .cursor_pointer()
                .bg(if is_active {
                    theme.accent_subtle
                } else {
                    transparent_black()
                })
                .text_color(if is_active {
                    theme.accent
                } else {
                    theme.text_muted
                })
                .text_size(px(12.0))
                .font_weight(if is_active {
                    FontWeight::SEMIBOLD
                } else {
                    FontWeight::NORMAL
                })
                .hover(|s| s.bg(theme.hover_bg))
                .on_click(move |_, _, _| {
                    on_change(mode_clone);
                })
                .child(label.to_string())
        }))
}

/// Renders the time period selector
pub fn render_time_period_selector(
    theme: &Theme,
    current_period: TimePeriod,
    on_period_change: impl Fn(TimePeriod) + 'static + Clone,
) -> impl IntoElement {
    let periods = [
        TimePeriod::OneDay,
        TimePeriod::OneWeek,
        TimePeriod::OneMonth,
        TimePeriod::ThreeMonths,
        TimePeriod::SixMonths,
        TimePeriod::OneYear,
        TimePeriod::YearToDate,
    ];

    div()
        .flex()
        .gap(px(2.0))
        .children(periods.iter().map(|period| {
            let is_active = current_period == *period;
            let period_clone = *period;
            let on_change = on_period_change.clone();

            div()
                .id(SharedString::from(format!("period-{:?}", period)))
                .px(px(10.0))
                .py(px(6.0))
                .rounded(px(4.0))
                .cursor_pointer()
                .bg(if is_active {
                    theme.accent
                } else {
                    transparent_black()
                })
                .text_color(if is_active {
                    hsla(0.0, 0.0, 1.0, 1.0)
                } else {
                    theme.text_muted
                })
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .hover(|s| {
                    s.bg(if is_active {
                        theme.accent_hover
                    } else {
                        theme.hover_bg
                    })
                })
                .on_click(move |_, _, _| {
                    on_change(period_clone);
                })
                .child(period.label().to_string())
        }))
}

/// Renders the symbol legend with toggle functionality
pub fn render_symbol_legend(
    theme: &Theme,
    symbols: &[ComparisonSymbol],
    on_toggle: impl Fn(&str) + 'static + Clone,
    on_remove: impl Fn(&str) + 'static + Clone,
) -> impl IntoElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .children(symbols.iter().map(|sym| {
            let symbol = sym.symbol.clone();
            let symbol_for_toggle = symbol.clone();
            let symbol_for_remove = symbol.clone();
            let on_toggle = on_toggle.clone();
            let on_remove = on_remove.clone();

            div()
                .id(SharedString::from(format!("legend-{}", &symbol)))
                .flex()
                .items_center()
                .gap(px(8.0))
                .px(px(10.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(if sym.enabled {
                    theme.card_bg_elevated
                } else {
                    theme.card_bg
                })
                .border_1()
                .border_color(if sym.enabled {
                    sym.color.opacity(0.5)
                } else {
                    theme.border_subtle
                })
                .cursor_pointer()
                .hover(|s| s.bg(theme.hover_bg))
                .on_click(move |_, _, _| {
                    on_toggle(&symbol_for_toggle);
                })
                .child(
                    // Color indicator
                    div().size(px(10.0)).rounded_full().bg(if sym.enabled {
                        sym.color
                    } else {
                        theme.text_dimmed
                    }),
                )
                .child(
                    // Symbol name
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if sym.enabled {
                            theme.text
                        } else {
                            theme.text_muted
                        })
                        .child(symbol.clone()),
                )
                // Price/change if available
                .when_some(sym.market_data.as_ref(), |el, m| {
                    let is_positive = m.change >= 0.0;
                    let color = if is_positive {
                        theme.positive
                    } else {
                        theme.negative
                    };
                    el.child(
                        div()
                            .text_size(px(11.0))
                            .text_color(color)
                            .child(format!("{:+.2}%", m.change_percent)),
                    )
                })
                .child(
                    // Remove button
                    div()
                        .id(SharedString::from(format!("remove-{}", &symbol)))
                        .size(px(16.0))
                        .rounded(px(4.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(12.0))
                        .text_color(theme.text_dimmed)
                        .hover(|s| s.bg(theme.negative_subtle).text_color(theme.negative))
                        .on_click(move |_, _, _| {
                            on_remove(&symbol_for_remove);
                        })
                        .child("x"),
                )
        }))
}

// =============================================================================
// SIDE-BY-SIDE COMPARISON VIEW
// =============================================================================

/// Renders side-by-side comparison of multiple symbols
pub fn render_side_by_side_comparison(
    theme: &Theme,
    symbols: &[ComparisonSymbol],
) -> impl IntoElement {
    let enabled_symbols: Vec<_> = symbols.iter().filter(|s| s.enabled).collect();
    let card_width = if enabled_symbols.len() <= 2 {
        px(400.0)
    } else if enabled_symbols.len() <= 4 {
        px(280.0)
    } else {
        px(220.0)
    };

    div().flex().flex_wrap().gap(px(16.0)).children(
        enabled_symbols
            .iter()
            .map(|sym| render_symbol_comparison_card(theme, sym, card_width)),
    )
}

/// Single symbol comparison card
fn render_symbol_comparison_card(
    theme: &Theme,
    symbol: &ComparisonSymbol,
    width: Pixels,
) -> impl IntoElement {
    let (price, change, change_pct) = symbol
        .market_data
        .as_ref()
        .map(|m| (m.price, m.change, m.change_percent))
        .unwrap_or((0.0, 0.0, 0.0));

    let (flow_score, inst_sentiment) = symbol
        .equity_flow
        .as_ref()
        .map(|e| (e.money_flow_score, e.institutional_sentiment))
        .unwrap_or((0.0, 0.0));

    let valuation = symbol.research.as_ref().and_then(|r| r.valuation.as_ref());

    let is_positive = change >= 0.0;
    let change_color = if is_positive {
        theme.positive
    } else {
        theme.negative
    };

    div()
        .w(width)
        .p(px(16.0))
        .rounded(px(10.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .border_l_4()
        .border_color(symbol.color)
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Header with symbol and price
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::BOLD)
                        .child(symbol.symbol.clone()),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_end()
                        .child(
                            div()
                                .text_size(px(16.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(format!("${:.2}", price)),
                        )
                        .child(
                            div()
                                .px(px(6.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(change_color.opacity(0.15))
                                .text_size(px(11.0))
                                .text_color(change_color)
                                .font_weight(FontWeight::MEDIUM)
                                .child(format!("{:+.2}%", change_pct)),
                        ),
                ),
        )
        // Money Flow Metrics
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_comparison_metric(
                    theme,
                    "Money Flow",
                    flow_score,
                    flow_score >= 0.0,
                ))
                .child(render_comparison_metric(
                    theme,
                    "Inst. Sentiment",
                    inst_sentiment,
                    inst_sentiment >= 0.0,
                )),
        )
        // Valuation Metrics
        .when_some(valuation, |el, v| {
            el.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .pt(px(8.0))
                    .border_t_1()
                    .border_color(theme.border_subtle)
                    .child(render_valuation_row(theme, "P/E", v.pe_ratio))
                    .child(render_valuation_row(theme, "Forward P/E", v.forward_pe))
                    .child(render_valuation_row(theme, "PEG", v.peg_ratio))
                    .child(render_valuation_row(theme, "P/S", v.price_to_sales)),
            )
        })
}

fn render_comparison_metric(
    theme: &Theme,
    label: &str,
    value: f64,
    positive: bool,
) -> impl IntoElement {
    let color = if positive {
        theme.positive
    } else {
        theme.negative
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .child(label.to_string()),
        )
        .child(
            div()
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(color)
                .child(format!("{:+.2}", value)),
        )
}

fn render_valuation_row(theme: &Theme, label: &str, value: f64) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child(label.to_string()),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_secondary)
                .child(format!("{:.2}", value)),
        )
}

// =============================================================================
// OVERLAY CHART VIEW
// =============================================================================

/// Renders an overlay chart showing multiple symbols on the same axis
pub fn render_overlay_chart(
    theme: &Theme,
    symbols: &[ComparisonSymbol],
    normalized: bool, // If true, show % returns instead of absolute prices
) -> impl IntoElement {
    let enabled_symbols: Vec<_> = symbols.iter().filter(|s| s.enabled).collect();

    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Chart header with toggle
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(if normalized {
                            "Relative Performance (%)"
                        } else {
                            "Price Overlay"
                        }),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .text_size(px(11.0))
                        .text_color(theme.text_muted)
                        .child("Normalize"), // Toggle switch would go here
                ),
        )
        // Chart area
        .child(
            div()
                .w_full()
                .rounded(px(8.0))
                .bg(theme.card_bg_elevated)
                .border_1()
                .border_color(theme.border_subtle)
                .p(px(14.0))
                .flex()
                .flex_col()
                .gap(px(10.0))
                .children(enabled_symbols.iter().map(|sym| {
                    let series = build_chart_series(sym, normalized);
                    render_chart_row(theme, sym, &series, normalized)
                })),
        )
        // Legend below chart
        .child(
            div()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(px(16.0))
                .children(enabled_symbols.iter().map(|sym| {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(div().w(px(24.0)).h(px(3.0)).rounded(px(2.0)).bg(sym.color))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_secondary)
                                .child(sym.symbol.clone()),
                        )
                })),
        )
}

fn render_chart_row(
    theme: &Theme,
    symbol: &ComparisonSymbol,
    series: &[f64],
    normalized: bool,
) -> impl IntoElement {
    let latest = series.last().copied().unwrap_or(0.0);
    let display = if normalized {
        format!("{:+.2}%", latest)
    } else {
        format!("${:.2}", latest)
    };
    let color = if latest >= 0.0 {
        theme.positive
    } else {
        theme.negative
    };
    let sparkline = build_sparkline(series);

    div()
        .w_full()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(12.0))
        .child(
            div()
                .w(px(68.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(symbol.color)
                .child(symbol.symbol.clone()),
        )
        .child(
            div()
                .flex_grow()
                .h(px(26.0))
                .rounded(px(6.0))
                .bg(theme.background)
                .border_1()
                .border_color(theme.border_subtle)
                .px(px(8.0))
                .flex()
                .items_center()
                .text_size(px(11.0))
                .text_color(theme.text_secondary)
                .child(if sparkline.is_empty() {
                    "No history data".to_string()
                } else {
                    sparkline
                }),
        )
        .child(
            div()
                .w(px(78.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(color)
                .text_align(gpui::TextAlign::Right)
                .child(display),
        )
}

fn build_chart_series(symbol: &ComparisonSymbol, normalized: bool) -> Vec<f64> {
    let mut values: Vec<f64> = symbol
        .history
        .iter()
        .filter_map(|point| if point.close.is_finite() { Some(point.close) } else { None })
        .collect();

    if values.len() < 2 {
        if let Some(market) = &symbol.market_data {
            values.push((market.price - market.change).max(0.0));
            values.push(market.price);
        }
    }

    if !normalized {
        return values;
    }

    if values.is_empty() {
        return values;
    }
    let first = values[0];
    if first.abs() < f64::EPSILON {
        return vec![0.0; values.len()];
    }
    values
        .into_iter()
        .map(|v| ((v / first) - 1.0) * 100.0)
        .collect()
}

fn build_sparkline(values: &[f64]) -> String {
    if values.is_empty() {
        return String::new();
    }

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
        .collect()
}

// =============================================================================
// RELATIVE PERFORMANCE VIEW
// =============================================================================

/// Renders relative performance comparison (indexed to 100 at start)
pub fn render_relative_performance(
    theme: &Theme,
    symbols: &[ComparisonSymbol],
    _base_symbol: Option<&str>,
) -> impl IntoElement {
    let enabled_symbols: Vec<_> = symbols.iter().filter(|s| s.enabled).collect();

    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Performance summary cards
        .child(
            div()
                .flex()
                .gap(px(12.0))
                .children(enabled_symbols.iter().map(|sym| {
                    let perf = performance_percent(sym);
                    let is_positive = perf >= 0.0;
                    let color = if is_positive {
                        theme.positive
                    } else {
                        theme.negative
                    };

                    div()
                        .flex_1()
                        .p(px(12.0))
                        .rounded(px(8.0))
                        .bg(theme.card_bg_elevated)
                        .border_l_4()
                        .border_color(sym.color)
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(sym.symbol.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(18.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(color)
                                .child(format!("{:+.2}%", perf)),
                        )
                })),
        )
        // Relative performance chart
        .child(render_overlay_chart(theme, symbols, true))
        // Performance ranking table
        .child(render_performance_ranking(theme, &enabled_symbols))
}

fn render_performance_ranking(theme: &Theme, symbols: &[&ComparisonSymbol]) -> impl IntoElement {
    // Sort by performance
    let mut sorted: Vec<_> = symbols
        .iter()
        .map(|s| {
            let perf = performance_percent(s);
            (*s, perf)
        })
        .collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    div()
        .p(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_muted)
                .child("Performance Ranking"),
        )
        .children(sorted.iter().enumerate().map(|(i, (sym, perf))| {
            let is_positive = *perf >= 0.0;
            let color = if is_positive {
                theme.positive
            } else {
                theme.negative
            };

            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .py(px(8.0))
                .when(i < sorted.len() - 1, |d| {
                    d.border_b_1().border_color(theme.border_subtle)
                })
                .child(
                    div()
                        .size(px(24.0))
                        .rounded_full()
                        .bg(sym.color.opacity(0.2))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(sym.color)
                        .child(format!("{}", i + 1)),
                )
                .child(
                    div()
                        .flex_grow()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(sym.symbol.clone()),
                )
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:+.2}%", perf)),
                )
        }))
}

fn performance_percent(symbol: &ComparisonSymbol) -> f64 {
    let history_values: Vec<f64> = symbol
        .history
        .iter()
        .map(|point| point.close)
        .filter(|value| value.is_finite())
        .collect();

    if history_values.len() >= 2 {
        let first = history_values[0];
        let last = history_values[history_values.len() - 1];
        if first.abs() >= f64::EPSILON {
            return ((last / first) - 1.0) * 100.0;
        }
    }

    symbol
        .market_data
        .as_ref()
        .map(|market| market.change_percent)
        .unwrap_or(0.0)
}

// =============================================================================
// CORRELATION MATRIX VIEW
// =============================================================================

/// Renders a correlation matrix heatmap
pub fn render_correlation_matrix(
    theme: &Theme,
    symbols: &[ComparisonSymbol],
    correlations: &HashMap<(String, String), f64>,
) -> impl IntoElement {
    let enabled_symbols: Vec<_> = symbols
        .iter()
        .filter(|s| s.enabled)
        .map(|s| s.symbol.clone())
        .collect();

    let cell_size = px(60.0);

    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child("Correlation Matrix"),
        )
        // Matrix container
        .child(
            div().overflow_x_hidden().child(
                div()
                    .flex()
                    .flex_col()
                    // Header row
                    .child(
                        div()
                            .flex()
                            .child(div().size(cell_size)) // Empty corner
                            .children(enabled_symbols.iter().map(|sym| {
                                div()
                                    .size(cell_size)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(sym.clone())
                            })),
                    )
                    // Matrix rows
                    .children(enabled_symbols.iter().map(|row_sym| {
                        div()
                            .flex()
                            // Row header
                            .child(
                                div()
                                    .size(cell_size)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(row_sym.clone()),
                            )
                            // Correlation cells
                            .children(enabled_symbols.iter().map(|col_sym| {
                                let corr = if row_sym == col_sym {
                                    1.0
                                } else {
                                    correlations
                                        .get(&(row_sym.clone(), col_sym.clone()))
                                        .or_else(|| {
                                            correlations.get(&(col_sym.clone(), row_sym.clone()))
                                        })
                                        .copied()
                                        .unwrap_or(0.0)
                                };

                                render_correlation_cell(theme, corr, cell_size)
                            }))
                    })),
            ),
        )
        // Legend
        .child(render_correlation_legend(theme))
}

fn render_correlation_cell(theme: &Theme, correlation: f64, size: Pixels) -> impl IntoElement {
    // Color based on correlation value
    let bg_color = if correlation >= 0.7 {
        theme.positive.opacity(correlation.abs() as f32 * 0.6)
    } else if correlation >= 0.3 {
        theme.positive.opacity(correlation.abs() as f32 * 0.4)
    } else if correlation >= -0.3 {
        theme.text_muted.opacity(0.1)
    } else if correlation >= -0.7 {
        theme.negative.opacity(correlation.abs() as f32 * 0.4)
    } else {
        theme.negative.opacity(correlation.abs() as f32 * 0.6)
    };

    let text_color = if correlation.abs() > 0.5 {
        theme.text
    } else {
        theme.text_secondary
    };

    div()
        .size(size)
        .flex()
        .items_center()
        .justify_center()
        .bg(bg_color)
        .border_1()
        .border_color(theme.border_subtle)
        .text_size(px(12.0))
        .font_weight(FontWeight::MEDIUM)
        .text_color(text_color)
        .child(format!("{:.2}", correlation))
}

fn render_correlation_legend(theme: &Theme) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_center()
        .gap(px(16.0))
        .pt(px(12.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .size(px(12.0))
                        .rounded(px(2.0))
                        .bg(theme.negative.opacity(0.6)),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("-1.0"),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .size(px(12.0))
                        .rounded(px(2.0))
                        .bg(theme.text_muted.opacity(0.1)),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("0"),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .size(px(12.0))
                        .rounded(px(2.0))
                        .bg(theme.positive.opacity(0.6)),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("+1.0"),
                ),
        )
}

// =============================================================================
// PEER GROUP COMPARISON VIEW
// =============================================================================

/// Renders comprehensive peer group comparison table
pub fn render_peer_group_comparison(
    theme: &Theme,
    peers: &[PeerMetrics],
    highlight_symbol: Option<&str>,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child("Peer Group Comparison"),
        )
        // Scrollable table
        .child(
            div()
                .overflow_x_hidden()
                .rounded(px(8.0))
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        // Header
                        .child(render_peer_table_header(theme))
                        // Rows
                        .children(peers.iter().map(|peer| {
                            let is_highlight =
                                highlight_symbol.map(|s| s == peer.symbol).unwrap_or(false);
                            render_peer_table_row(theme, peer, is_highlight)
                        })),
                ),
        )
}

fn render_peer_table_header(theme: &Theme) -> impl IntoElement {
    let columns = [
        ("Symbol", px(80.0)),
        ("Market Cap", px(100.0)),
        ("P/E", px(70.0)),
        ("Fwd P/E", px(70.0)),
        ("PEG", px(70.0)),
        ("P/S", px(70.0)),
        ("P/B", px(70.0)),
        ("EV/EBITDA", px(80.0)),
        ("Div Yield", px(80.0)),
        ("Flow Score", px(90.0)),
        ("Inst. Sent.", px(90.0)),
    ];

    div()
        .flex()
        .bg(theme.card_bg_elevated)
        .border_b_1()
        .border_color(theme.border)
        .children(columns.iter().map(|(label, width)| {
            div()
                .w(*width)
                .px(px(8.0))
                .py(px(12.0))
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_muted)
                .child(label.to_string())
        }))
}

fn render_peer_table_row(theme: &Theme, peer: &PeerMetrics, highlight: bool) -> impl IntoElement {
    let flow_positive = peer.money_flow_score >= 0.0;
    let inst_positive = peer.institutional_sentiment >= 0.0;

    div()
        .flex()
        .bg(if highlight {
            theme.accent_subtle
        } else {
            transparent_black()
        })
        .border_b_1()
        .border_color(theme.border_subtle)
        .hover(|s| s.bg(theme.hover_bg))
        // Symbol
        .child(
            div()
                .w(px(80.0))
                .px(px(8.0))
                .py(px(10.0))
                .text_size(px(12.0))
                .font_weight(if highlight {
                    FontWeight::BOLD
                } else {
                    FontWeight::SEMIBOLD
                })
                .text_color(if highlight { theme.accent } else { theme.text })
                .child(peer.symbol.clone()),
        )
        // Market Cap
        .child(
            div()
                .w(px(100.0))
                .px(px(8.0))
                .py(px(10.0))
                .text_size(px(11.0))
                .child(format_market_cap(peer.market_cap)),
        )
        // P/E
        .child(render_metric_cell(theme, peer.pe_ratio, px(70.0), None))
        // Forward P/E
        .child(render_metric_cell(theme, peer.forward_pe, px(70.0), None))
        // PEG
        .child(render_metric_cell(
            theme,
            peer.peg_ratio,
            px(70.0),
            Some(1.0),
        )) // PEG < 1 is good
        // P/S
        .child(render_metric_cell(
            theme,
            peer.price_to_sales,
            px(70.0),
            None,
        ))
        // P/B
        .child(render_metric_cell(
            theme,
            peer.price_to_book,
            px(70.0),
            None,
        ))
        // EV/EBITDA
        .child(render_metric_cell(theme, peer.ev_to_ebitda, px(80.0), None))
        // Dividend Yield
        .child(
            div()
                .w(px(80.0))
                .px(px(8.0))
                .py(px(10.0))
                .text_size(px(11.0))
                .text_color(if peer.dividend_yield > 0.0 {
                    theme.positive
                } else {
                    theme.text_secondary
                })
                .child(format!("{:.2}%", peer.dividend_yield)),
        )
        // Flow Score
        .child(
            div()
                .w(px(90.0))
                .px(px(8.0))
                .py(px(10.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(if flow_positive {
                    theme.positive
                } else {
                    theme.negative
                })
                .child(format!("{:+.2}", peer.money_flow_score)),
        )
        // Institutional Sentiment
        .child(
            div()
                .w(px(90.0))
                .px(px(8.0))
                .py(px(10.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(if inst_positive {
                    theme.positive
                } else {
                    theme.negative
                })
                .child(format!("{:+.2}", peer.institutional_sentiment)),
        )
}

fn render_metric_cell(
    theme: &Theme,
    value: f64,
    width: Pixels,
    threshold: Option<f64>,
) -> impl IntoElement {
    let color = threshold
        .map(|t| {
            if value < t {
                theme.positive
            } else {
                theme.text_secondary
            }
        })
        .unwrap_or(theme.text_secondary);

    div()
        .w(width)
        .px(px(8.0))
        .py(px(10.0))
        .text_size(px(11.0))
        .text_color(color)
        .child(format!("{:.2}", value))
}

fn format_market_cap(value: f64) -> String {
    if value >= 1_000_000_000_000.0 {
        format!("${:.1}T", value / 1_000_000_000_000.0)
    } else if value >= 1_000_000_000.0 {
        format!("${:.1}B", value / 1_000_000_000.0)
    } else if value >= 1_000_000.0 {
        format!("${:.1}M", value / 1_000_000.0)
    } else {
        format!("${:.0}", value)
    }
}

// =============================================================================
// SECTOR RELATIVE STRENGTH VIEW
// =============================================================================

/// Renders sector relative strength analysis
pub fn render_sector_strength(
    theme: &Theme,
    sectors: &[(String, f64, f64)], // (symbol, relative_strength, momentum)
) -> impl IntoElement {
    // Sort by relative strength
    let mut sorted: Vec<_> = sectors.to_vec();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child("Sector Relative Strength"),
        )
        // Strength bars
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .children(sorted.iter().map(|(symbol, strength, momentum)| {
                    render_strength_bar(theme, symbol, *strength, *momentum)
                })),
        )
}

fn render_strength_bar(
    theme: &Theme,
    symbol: &str,
    strength: f64,
    momentum: f64,
) -> impl IntoElement {
    let is_positive = strength >= 0.0;
    let color = if is_positive {
        theme.positive
    } else {
        theme.negative
    };
    let bar_width = (strength.abs() * 100.0).min(100.0) as f32;
    let momentum_positive = momentum >= 0.0;

    div()
        .flex()
        .items_center()
        .gap(px(12.0))
        .py(px(8.0))
        .hover(|s| s.bg(theme.hover_bg))
        .rounded(px(4.0))
        .px(px(8.0))
        // Symbol
        .child(
            div()
                .w(px(60.0))
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(symbol.to_string()),
        )
        // Strength bar
        .child(
            div()
                .flex_grow()
                .h(px(20.0))
                .rounded(px(4.0))
                .bg(theme.border_subtle)
                .overflow_hidden()
                .child(
                    div()
                        .h_full()
                        .w(px(bar_width * 2.0)) // Scale for visibility
                        .rounded(px(4.0))
                        .bg(color),
                ),
        )
        // Strength value
        .child(
            div()
                .w(px(60.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(color)
                .child(format!("{:+.2}", strength)),
        )
        // Momentum indicator
        .child(
            div()
                .w(px(40.0))
                .text_size(px(10.0))
                .text_color(if momentum_positive {
                    theme.positive
                } else {
                    theme.negative
                })
                .child(if momentum_positive { "^ Up" } else { "v Down" }),
        )
}

// =============================================================================
// MULTI-SYMBOL WATCHLIST VIEW
// =============================================================================

/// Renders an enhanced watchlist view with comparison capabilities
pub fn render_multi_watchlist(
    theme: &Theme,
    symbols: &[ComparisonSymbol],
    on_select: impl Fn(&str) + 'static + Clone,
    on_compare: impl Fn(&str) + 'static + Clone,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .children(symbols.iter().map(|sym| {
            let symbol = sym.symbol.clone();
            let symbol_for_select = symbol.clone();
            let symbol_for_compare = symbol.clone();
            let on_select = on_select.clone();
            let on_compare = on_compare.clone();

            let (price, change_pct, volume) = sym
                .market_data
                .as_ref()
                .map(|m| (m.price, m.change_percent, m.volume))
                .unwrap_or((0.0, 0.0, 0));

            let is_positive = change_pct >= 0.0;
            let change_color = if is_positive {
                theme.positive
            } else {
                theme.negative
            };

            div()
                .id(SharedString::from(format!("watchlist-{}", &symbol)))
                .flex()
                .items_center()
                .px(px(12.0))
                .py(px(10.0))
                .rounded(px(6.0))
                .cursor_pointer()
                .bg(if sym.enabled {
                    theme.accent_subtle
                } else {
                    transparent_black()
                })
                .hover(|s| s.bg(theme.hover_bg))
                .on_click(move |_, _, _| {
                    on_select(&symbol_for_select);
                })
                // Symbol and name
                .child(
                    div()
                        .flex_grow()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(symbol.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child(format!("Vol: {}M", volume / 1_000_000)),
                        ),
                )
                // Price
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_end()
                        .mr(px(12.0))
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .child(format!("${:.2}", price)),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(change_color)
                                .font_weight(FontWeight::MEDIUM)
                                .child(format!("{:+.2}%", change_pct)),
                        ),
                )
                // Compare button
                .child(
                    div()
                        .id(SharedString::from(format!("compare-{}", &symbol)))
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(theme.accent_subtle)
                        .text_size(px(10.0))
                        .text_color(theme.accent)
                        .font_weight(FontWeight::MEDIUM)
                        .hover(|s| s.bg(theme.accent.opacity(0.2)))
                        .on_click(move |_, _, _| {
                            on_compare(&symbol_for_compare);
                        })
                        .child("+Compare"),
                )
        }))
}

// =============================================================================
// SYMBOL SEARCH/ADD COMPONENT
// =============================================================================

/// Renders a symbol search input with add functionality
pub fn render_symbol_search(
    theme: &Theme,
    search_text: &str,
    _on_search_change: impl Fn(&str) + 'static,
    _on_add_symbol: impl Fn(&str) + 'static,
    suggestions: &[String],
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        // Search input row
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .flex_grow()
                        .px(px(12.0))
                        .py(px(8.0))
                        .rounded(px(6.0))
                        .bg(theme.card_bg_elevated)
                        .border_1()
                        .border_color(theme.border)
                        .text_size(px(13.0))
                        .child({
                            // Placeholder for input field
                            // In GPUI, you'd use a TextInput component
                            let display_text = if search_text.is_empty() {
                                "Search symbol...".to_string()
                            } else {
                                search_text.to_string()
                            };
                            let is_empty = search_text.is_empty();
                            div()
                                .text_color(if is_empty {
                                    theme.text_dimmed
                                } else {
                                    theme.text
                                })
                                .child(display_text)
                        }),
                )
                .child(
                    div()
                        .px(px(16.0))
                        .py(px(8.0))
                        .rounded(px(6.0))
                        .bg(theme.accent)
                        .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.accent_hover))
                        .child("Add"),
                ),
        )
        // Suggestions dropdown
        .when(!suggestions.is_empty(), |d| {
            d.child(
                div()
                    .p(px(8.0))
                    .rounded(px(6.0))
                    .bg(theme.card_bg_elevated)
                    .border_1()
                    .border_color(theme.border)
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .children(suggestions.iter().take(5).map(|s| {
                        div()
                            .px(px(8.0))
                            .py(px(6.0))
                            .rounded(px(4.0))
                            .cursor_pointer()
                            .hover(|d| d.bg(theme.hover_bg))
                            .text_size(px(12.0))
                            .child(s.clone())
                    })),
            )
        })
}

// =============================================================================
// MAIN COMPARISON VIEW CONTAINER
// =============================================================================

/// Main comparison view that orchestrates all sub-components
pub fn render_comparison_view(
    theme: &Theme,
    state: &ComparisonState,
    on_mode_change: impl Fn(ComparisonMode) + 'static + Clone,
    on_period_change: impl Fn(TimePeriod) + 'static + Clone,
    on_symbol_toggle: impl Fn(&str) + 'static + Clone,
    on_symbol_remove: impl Fn(&str) + 'static + Clone,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(20.0))
        .p(px(24.0))
        // Header with mode tabs and time period
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(render_comparison_mode_tabs(
                    theme,
                    state.mode,
                    on_mode_change,
                ))
                .child(render_time_period_selector(
                    theme,
                    state.time_period,
                    on_period_change,
                )),
        )
        // Symbol legend
        .child(render_symbol_legend(
            theme,
            &state.symbols,
            on_symbol_toggle.clone(),
            on_symbol_remove,
        ))
        // Content based on mode
        .child(match state.mode {
            ComparisonMode::SideBySide => {
                render_side_by_side_comparison(theme, &state.symbols).into_any_element()
            }
            ComparisonMode::Overlay => {
                render_overlay_chart(theme, &state.symbols, false).into_any_element()
            }
            ComparisonMode::RelativePerformance => {
                render_relative_performance(theme, &state.symbols, state.base_symbol.as_deref())
                    .into_any_element()
            }
            ComparisonMode::Correlation => {
                render_correlation_matrix(theme, &state.symbols, &state.correlation_matrix)
                    .into_any_element()
            }
            ComparisonMode::PeerGroup => render_peer_group_comparison(
                theme,
                &state.peer_metrics,
                state.base_symbol.as_deref(),
            )
            .into_any_element(),
            ComparisonMode::SectorStrength => {
                // Convert to sector strength format
                let sectors: Vec<_> = state
                    .symbols
                    .iter()
                    .filter(|s| s.enabled)
                    .map(|s| {
                        let strength = s
                            .equity_flow
                            .as_ref()
                            .map(|e| e.money_flow_score)
                            .unwrap_or(0.0);
                        let momentum = s
                            .equity_flow
                            .as_ref()
                            .map(|e| e.smart_money_activity)
                            .unwrap_or(0.0);
                        (s.symbol.clone(), strength, momentum)
                    })
                    .collect();
                render_sector_strength(theme, &sectors).into_any_element()
            }
        })
}

// =============================================================================
// API CLIENT EXTENSIONS FOR COMPARISON DATA
// =============================================================================

/// Extended API methods for comparison data (to be added to ZeeApiClient)
pub trait ComparisonApi {
    /// Fetch market data for multiple symbols in parallel
    async fn get_multi_market_data(&self, symbols: &[String]) -> Result<Vec<MarketData>, ApiError>;

    /// Fetch peer comparison data
    async fn get_peers(&self, symbol: &str) -> Result<Vec<PeerMetrics>, ApiError>;

    /// Fetch correlation matrix for symbols
    async fn get_symbol_correlations(
        &self,
        symbols: &[String],
    ) -> Result<HashMap<(String, String), f64>, ApiError>;
}

// Example implementation pattern (to be added to api.rs):
/*
impl ComparisonApi for ZeeApiClient {
    async fn get_multi_market_data(&self, symbols: &[String]) -> Result<Vec<MarketData>, ApiError> {
        let futures: Vec<_> = symbols.iter()
            .map(|s| self.get_market_data(s))
            .collect();

        let results = futures::future::join_all(futures).await;

        results.into_iter()
            .filter_map(|r| r.ok())
            .filter_map(|r| if r.success { r.data } else { None })
            .collect::<Result<Vec<_>, _>>()
    }

    async fn get_peers(&self, symbol: &str) -> Result<Vec<PeerMetrics>, ApiError> {
        let url = format!("{}/api/peers/{}", self.base_url, symbol);
        let response = self.client.get(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    async fn get_symbol_correlations(&self, symbols: &[String]) -> Result<HashMap<(String, String), f64>, ApiError> {
        // Use the commodities correlations endpoint pattern for stocks
        let symbols_param = symbols.join(",");
        let url = format!("{}/api/correlations?symbols={}", self.base_url, symbols_param);
        let response = self.client.get(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }
}
*/
