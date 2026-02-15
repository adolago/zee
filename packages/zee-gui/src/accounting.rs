//! Accounting View for Stanley GUI
//!
//! Displays SEC filings, earnings quality metrics, and financial red flags:
//! - SEC filings list (10-K, 10-Q, 8-K)
//! - Earnings quality scores (M-Score, F-Score, Z-Score)
//! - Red flags with severity indicators
//! - Financial statement highlights

use crate::api::{EarningsQuality, Filing, RedFlag, RedFlagsResponse};
use crate::app::LoadState;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;

// ============================================================================
// ACCOUNTING VIEW STATE
// ============================================================================

/// Sub-view within Accounting
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AccountingSubView {
    #[default]
    Overview,
    Filings,
    Quality,
    RedFlags,
}

/// State for accounting view
pub struct AccountingState {
    pub sub_view: AccountingSubView,
    pub symbol: String,
    pub filings: LoadState<Vec<Filing>>,
    pub quality: LoadState<EarningsQuality>,
    pub red_flags: LoadState<RedFlagsResponse>,
    pub selected_filing: Option<usize>,
}

impl Default for AccountingState {
    fn default() -> Self {
        Self {
            sub_view: AccountingSubView::Overview,
            symbol: String::new(),
            filings: LoadState::NotLoaded,
            quality: LoadState::NotLoaded,
            red_flags: LoadState::NotLoaded,
            selected_filing: None,
        }
    }
}

impl AccountingState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_symbol(symbol: String) -> Self {
        Self {
            symbol,
            ..Default::default()
        }
    }
}

// ============================================================================
// ACCOUNTING VIEW RENDERING
// ============================================================================

/// Render the main accounting view
pub fn render_accounting(
    theme: &Theme,
    state: &AccountingState,
    _cx: &mut Context<impl Sized>,
) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .child(render_accounting_header(theme, state))
        .child(render_accounting_content(theme, state))
}

/// Render accounting header with symbol input and sub-navigation
fn render_accounting_header(theme: &Theme, state: &AccountingState) -> impl IntoElement {
    let (risk_label, risk_color) = match &state.quality {
        LoadState::Loaded(q) => match q.manipulation_risk.as_str() {
            "low" => ("LOW RISK", theme.positive),
            "medium" => ("MEDIUM RISK", theme.warning),
            "high" => ("HIGH RISK", theme.negative),
            _ => ("UNKNOWN", theme.text_muted),
        },
        _ => ("LOADING", theme.text_dimmed),
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
                // Title with symbol
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        .child(
                            div()
                                .text_size(px(20.0))
                                .font_weight(FontWeight::BOLD)
                                .child("Accounting"),
                        )
                        .when(!state.symbol.is_empty(), |d| {
                            d.child(
                                div()
                                    .px(px(10.0))
                                    .py(px(4.0))
                                    .rounded(px(6.0))
                                    .bg(theme.accent.opacity(0.15))
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.accent)
                                    .child(state.symbol.clone()),
                            )
                        }),
                )
                // Sub-navigation tabs
                .child(
                    div()
                        .flex()
                        .gap(px(4.0))
                        .child(sub_nav_tab(
                            theme,
                            "Overview",
                            AccountingSubView::Overview,
                            state.sub_view,
                        ))
                        .child(sub_nav_tab(
                            theme,
                            "Filings",
                            AccountingSubView::Filings,
                            state.sub_view,
                        ))
                        .child(sub_nav_tab(
                            theme,
                            "Quality",
                            AccountingSubView::Quality,
                            state.sub_view,
                        ))
                        .child(sub_nav_tab(
                            theme,
                            "Red Flags",
                            AccountingSubView::RedFlags,
                            state.sub_view,
                        )),
                ),
        )
        .child(
            // Manipulation risk indicator
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Manipulation Risk:"),
                )
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(risk_color.opacity(0.15))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(risk_color)
                        .child(risk_label),
                ),
        )
}

/// Sub-navigation tab
fn sub_nav_tab(
    theme: &Theme,
    label: &str,
    view: AccountingSubView,
    active: AccountingSubView,
) -> impl IntoElement {
    let is_active = view == active;

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
        .child(label.to_string())
}

/// Render content based on sub-view
fn render_accounting_content(theme: &Theme, state: &AccountingState) -> Div {
    if state.symbol.is_empty() {
        return render_symbol_selector(theme);
    }

    match state.sub_view {
        AccountingSubView::Overview => render_overview(theme, state),
        AccountingSubView::Filings => render_filings(theme, state),
        AccountingSubView::Quality => render_quality(theme, state),
        AccountingSubView::RedFlags => render_red_flags_view(theme, state),
    }
}

// ============================================================================
// SYMBOL SELECTOR
// ============================================================================

fn render_symbol_selector(theme: &Theme) -> Div {
    let common_symbols = vec![
        ("AAPL", "Apple Inc."),
        ("MSFT", "Microsoft Corp."),
        ("GOOGL", "Alphabet Inc."),
        ("AMZN", "Amazon.com Inc."),
        ("NVDA", "NVIDIA Corp."),
        ("META", "Meta Platforms"),
        ("TSLA", "Tesla Inc."),
        ("JPM", "JPMorgan Chase"),
    ];

    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .child(
            div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .flex()
                .flex_col()
                .gap(px(16.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("Select a symbol to analyze"),
                )
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child(
                            "View SEC filings, earnings quality metrics, and financial red flags",
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(12.0))
                        .children(common_symbols.iter().map(|(sym, name)| {
                            div()
                                .px(px(16.0))
                                .py(px(12.0))
                                .rounded(px(8.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border)
                                .cursor_pointer()
                                .hover(|s| s.border_color(theme.accent).bg(theme.hover_bg))
                                .flex()
                                .flex_col()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .text_size(px(14.0))
                                        .font_weight(FontWeight::BOLD)
                                        .child(sym.to_string()),
                                )
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.text_muted)
                                        .child(name.to_string()),
                                )
                        })),
                ),
        )
}

// ============================================================================
// OVERVIEW VIEW - Combined summary
// ============================================================================

fn render_overview(theme: &Theme, state: &AccountingState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        // Quality scores row
        .child(render_quality_scores_summary(theme, state))
        // Two column layout
        .child(
            div()
                .flex()
                .gap(px(20.0))
                // Left: Recent filings
                .child(
                    div()
                        .flex_1()
                        .child(card(
                            theme,
                            "Recent SEC Filings",
                            render_filings_list(theme, state, 5),
                        )),
                )
                // Right: Red flags summary
                .child(
                    div()
                        .flex_1()
                        .child(card(
                            theme,
                            "Red Flags Summary",
                            render_red_flags_summary(theme, state),
                        )),
                ),
        )
}

/// Render quality scores summary row
fn render_quality_scores_summary(theme: &Theme, state: &AccountingState) -> impl IntoElement {
    match &state.quality {
        LoadState::Loading => loading_indicator(theme),
        LoadState::Error(e) => error_message(theme, e),
        LoadState::Loaded(q) => div()
            .flex()
            .gap(px(16.0))
            .child(score_card(
                theme,
                "Beneish M-Score",
                q.m_score,
                m_score_interpretation(q.m_score),
                m_score_color(theme, q.m_score),
            ))
            .child(score_card(
                theme,
                "Piotroski F-Score",
                q.f_score as f64,
                f_score_interpretation(q.f_score),
                f_score_color(theme, q.f_score),
            ))
            .child(score_card(
                theme,
                "Altman Z-Score",
                q.z_score,
                z_score_interpretation(q.z_score),
                z_score_color(theme, q.z_score),
            ))
            .child(score_card(
                theme,
                "Accruals Ratio",
                q.accruals_ratio,
                accruals_interpretation(q.accruals_ratio),
                accruals_color(theme, q.accruals_ratio),
            )),
        _ => loading_indicator(theme),
    }
}

/// Score card with gauge-like indicator
fn score_card(
    theme: &Theme,
    label: &str,
    value: f64,
    interpretation: &str,
    color: Hsla,
) -> impl IntoElement {
    div()
        .flex_1()
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
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .child(label.to_string()),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(28.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:.2}", value)),
                )
                .child(render_score_gauge(theme, color)),
        )
        .child(
            div()
                .px(px(8.0))
                .py(px(4.0))
                .rounded(px(4.0))
                .bg(color.opacity(0.15))
                .text_size(px(10.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(color)
                .child(interpretation.to_string()),
        )
}

/// Simple horizontal gauge for score visualization
fn render_score_gauge(theme: &Theme, color: Hsla) -> impl IntoElement {
    div()
        .w(px(60.0))
        .h(px(8.0))
        .rounded(px(4.0))
        .bg(theme.border_subtle)
        .child(
            div()
                .h_full()
                .w(px(40.0)) // Simplified gauge fill
                .rounded(px(4.0))
                .bg(color),
        )
}

// ============================================================================
// FILINGS VIEW - SEC filings list
// ============================================================================

fn render_filings(theme: &Theme, state: &AccountingState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        .child(card(
            theme,
            "SEC Filings",
            render_filings_list(theme, state, 20),
        ))
}

fn render_filings_list(theme: &Theme, state: &AccountingState, limit: usize) -> impl IntoElement {
    match &state.filings {
        LoadState::Loading => loading_indicator(theme),
        LoadState::Error(e) => error_message(theme, e),
        LoadState::Loaded(filings) => div()
            .flex()
            .flex_col()
            .gap(px(2.0))
            // Header row
            .child(
                div()
                    .flex()
                    .items_center()
                    .py(px(10.0))
                    .px(px(12.0))
                    .bg(theme.card_bg_elevated)
                    .rounded_t(px(6.0))
                    .child(
                        div()
                            .w(px(80.0))
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Form"),
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Filed Date"),
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Period End"),
                    )
                    .child(
                        div()
                            .flex_grow()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Description"),
                    ),
            )
            // Filing rows
            .children(filings.iter().take(limit).enumerate().map(|(i, filing)| {
                let is_selected = state.selected_filing == Some(i);
                let form_color = form_type_color(theme, &filing.form_type);

                div()
                    .flex()
                    .items_center()
                    .py(px(12.0))
                    .px(px(12.0))
                    .bg(if is_selected {
                        theme.accent_subtle
                    } else {
                        transparent_black()
                    })
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .cursor_pointer()
                    .hover(|s| s.bg(theme.hover_bg))
                    .child(
                        div().w(px(80.0)).child(
                            div()
                                .px(px(8.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(form_color.opacity(0.15))
                                .text_size(px(11.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(form_color)
                                .child(filing.form_type.clone()),
                        ),
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .text_color(theme.text_secondary)
                            .child(filing.filed_date.clone()),
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .text_color(theme.text_secondary)
                            .child(filing.period_end.clone()),
                    )
                    .child(
                        div()
                            .flex_grow()
                            .text_size(px(12.0))
                            .text_color(theme.text)
                            .overflow_hidden()
                            .child(filing.description.clone()),
                    )
            })),
        _ => loading_indicator(theme),
    }
}

/// Get color for form type badge
fn form_type_color(theme: &Theme, form_type: &str) -> Hsla {
    match form_type {
        "10-K" => theme.accent,               // Annual report - blue
        "10-Q" => theme.positive,             // Quarterly - green
        "8-K" => theme.warning,               // Current report - amber
        "DEF 14A" => hsla(0.75, 0.6, 0.5, 1.0), // Proxy - purple
        _ => theme.text_muted,
    }
}

// ============================================================================
// QUALITY VIEW - Detailed earnings quality analysis
// ============================================================================

fn render_quality(theme: &Theme, state: &AccountingState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        .child(match &state.quality {
            LoadState::Loading => loading_indicator(theme),
            LoadState::Error(e) => error_message(theme, e),
            LoadState::Loaded(quality) => div()
                .flex()
                .flex_col()
                .gap(px(20.0))
                // Large score cards
                .child(render_quality_score_cards(theme, quality))
                // Score explanations
                .child(card(
                    theme,
                    "Score Interpretations",
                    render_score_explanations(theme, quality),
                )),
            _ => loading_indicator(theme),
        })
}

/// Render large quality score cards
fn render_quality_score_cards(theme: &Theme, quality: &EarningsQuality) -> impl IntoElement {
    div()
        .flex()
        .gap(px(20.0))
        // M-Score card
        .child(large_score_card(
            theme,
            "Beneish M-Score",
            quality.m_score,
            m_score_interpretation(quality.m_score),
            m_score_color(theme, quality.m_score),
            "Probability of earnings manipulation. Values > -1.78 suggest potential manipulation.",
        ))
        // F-Score card
        .child(large_score_card(
            theme,
            "Piotroski F-Score",
            quality.f_score as f64,
            f_score_interpretation(quality.f_score),
            f_score_color(theme, quality.f_score),
            "Financial strength indicator (0-9). Higher is better. 8-9 indicates strong fundamentals.",
        ))
        // Z-Score card
        .child(large_score_card(
            theme,
            "Altman Z-Score",
            quality.z_score,
            z_score_interpretation(quality.z_score),
            z_score_color(theme, quality.z_score),
            "Bankruptcy probability indicator. < 1.81 = distress zone, > 2.99 = safe zone.",
        ))
}

/// Large score card with detailed info
fn large_score_card(
    theme: &Theme,
    title: &str,
    value: f64,
    interpretation: &str,
    color: Hsla,
    description: &str,
) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(24.0))
        .rounded(px(12.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Title
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title.to_string()),
        )
        // Value with gauge
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                .child(
                    div()
                        .text_size(px(48.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:.2}", value)),
                )
                .child(render_vertical_gauge(theme, color)),
        )
        // Interpretation badge
        .child(
            div()
                .px(px(12.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(color.opacity(0.15))
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(color)
                .child(interpretation.to_string()),
        )
        // Description
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .line_height(px(16.0))
                .child(description.to_string()),
        )
}

/// Vertical gauge indicator
fn render_vertical_gauge(theme: &Theme, color: Hsla) -> impl IntoElement {
    div()
        .w(px(12.0))
        .h(px(60.0))
        .rounded(px(6.0))
        .bg(theme.border_subtle)
        .flex()
        .flex_col()
        .justify_end()
        .child(
            div()
                .w_full()
                .h(px(40.0)) // Simplified gauge fill
                .rounded(px(6.0))
                .bg(color),
        )
}

/// Render score explanations panel
fn render_score_explanations(theme: &Theme, quality: &EarningsQuality) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        // M-Score explanation
        .child(explanation_row(
            theme,
            "M-Score Analysis",
            if quality.m_score > -1.78 {
                "Elevated manipulation probability detected. Review accruals and revenue recognition carefully."
            } else {
                "M-Score within normal range. No immediate manipulation concerns based on this metric."
            },
            m_score_color(theme, quality.m_score),
        ))
        // F-Score explanation
        .child(explanation_row(
            theme,
            "F-Score Analysis",
            if quality.f_score >= 8 {
                "Strong financial fundamentals. Company shows profitability, leverage, and efficiency improvements."
            } else if quality.f_score >= 5 {
                "Moderate financial health. Some positive indicators, but room for improvement."
            } else {
                "Weak fundamentals indicated. Multiple financial health concerns present."
            },
            f_score_color(theme, quality.f_score),
        ))
        // Z-Score explanation
        .child(explanation_row(
            theme,
            "Z-Score Analysis",
            if quality.z_score > 2.99 {
                "Safe zone - low bankruptcy risk. Company appears financially stable."
            } else if quality.z_score > 1.81 {
                "Grey zone - moderate uncertainty. Monitor financial trends closely."
            } else {
                "Distress zone - elevated bankruptcy risk. Significant financial stress detected."
            },
            z_score_color(theme, quality.z_score),
        ))
        // Accruals explanation
        .child(explanation_row(
            theme,
            "Accruals Analysis",
            if quality.accruals_ratio.abs() > 0.10 {
                "High accruals relative to cash flow. May indicate aggressive accounting or earnings manipulation."
            } else {
                "Accruals within normal range. Earnings quality appears reasonable."
            },
            accruals_color(theme, quality.accruals_ratio),
        ))
}

/// Explanation row
fn explanation_row(
    theme: &Theme,
    title: &str,
    description: &str,
    color: Hsla,
) -> impl IntoElement {
    div()
        .flex()
        .items_start()
        .gap(px(12.0))
        .py(px(12.0))
        .px(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .child(
            div()
                .w(px(4.0))
                .h(px(40.0))
                .rounded(px(2.0))
                .bg(color),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(title.to_string()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .line_height(px(18.0))
                        .child(description.to_string()),
                ),
        )
}

// ============================================================================
// RED FLAGS VIEW
// ============================================================================

fn render_red_flags_view(theme: &Theme, state: &AccountingState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        .child(match &state.red_flags {
            LoadState::Loading => loading_indicator(theme),
            LoadState::Error(e) => error_message(theme, e),
            LoadState::Loaded(flags) => div()
                .flex()
                .flex_col()
                .gap(px(20.0))
                // Summary header
                .child(render_red_flags_header(theme, flags))
                // Flags list
                .child(card(
                    theme,
                    "Detected Red Flags",
                    render_red_flags_list(theme, &flags.red_flags),
                )),
            _ => loading_indicator(theme),
        })
}

/// Red flags summary header
fn render_red_flags_header(theme: &Theme, flags: &RedFlagsResponse) -> impl IntoElement {
    div()
        .flex()
        .gap(px(16.0))
        // Total flags
        .child(flag_count_card(
            theme,
            "Total Flags",
            flags.total_flags,
            theme.text,
        ))
        // Critical count
        .child(flag_count_card(
            theme,
            "Critical",
            flags.critical_count,
            theme.negative,
        ))
        // Warning count
        .child(flag_count_card(
            theme,
            "Warnings",
            flags.warning_count,
            theme.warning,
        ))
}

/// Flag count card
fn flag_count_card(theme: &Theme, label: &str, count: i32, color: Hsla) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(20.0))
        .rounded(px(10.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .child(label.to_string()),
        )
        .child(
            div()
                .text_size(px(36.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(count.to_string()),
        )
}

/// Red flags summary for overview
fn render_red_flags_summary(theme: &Theme, state: &AccountingState) -> Div {
    match &state.red_flags {
        LoadState::Loading => loading_indicator(theme),
        LoadState::Error(e) => error_message(theme, e),
        LoadState::Loaded(flags) => {
            if flags.red_flags.is_empty() {
                div()
                    .py(px(20.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .size(px(20.0))
                                    .rounded_full()
                                    .bg(theme.positive.opacity(0.15))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(12.0))
                                    .text_color(theme.positive)
                                    .child("OK"),
                            )
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .text_color(theme.positive)
                                    .child("No red flags detected"),
                            ),
                    )
            } else {
                let limited_flags: Vec<RedFlag> =
                    flags.red_flags.iter().take(5).cloned().collect();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .children(limited_flags.iter().map(|flag| render_red_flag_item(theme, flag)))
            }
        }
        _ => loading_indicator(theme),
    }
}

/// Red flags list
fn render_red_flags_list(theme: &Theme, flags: &Vec<RedFlag>) -> impl IntoElement {
    if flags.is_empty() {
        return div()
            .py(px(20.0))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .text_size(px(13.0))
                    .text_color(theme.positive)
                    .child("No red flags detected"),
            );
    }

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .children(flags.iter().map(|flag| render_red_flag_item(theme, flag)))
}

/// Individual red flag item
fn render_red_flag_item(theme: &Theme, flag: &RedFlag) -> impl IntoElement {
    let severity_color = match flag.severity.as_str() {
        "critical" => theme.negative,
        "warning" => theme.warning,
        _ => theme.text_muted,
    };

    div()
        .flex()
        .items_start()
        .gap(px(12.0))
        .py(px(14.0))
        .px(px(16.0))
        .rounded(px(8.0))
        .bg(severity_color.opacity(0.05))
        .border_l_4()
        .border_color(severity_color)
        // Severity badge and category
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(severity_color.opacity(0.15))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(severity_color)
                                .child(flag.severity.to_uppercase()),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_muted)
                                .child(flag.category.clone()),
                        ),
                )
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(flag.description.clone()),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(16.0))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.text_dimmed)
                                        .child(format!("{}:", flag.metric)),
                                )
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(severity_color)
                                        .child(format!("{:.2}", flag.value)),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.text_dimmed)
                                        .child("Threshold:"),
                                )
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(theme.text_secondary)
                                        .child(format!("{:.2}", flag.threshold)),
                                ),
                        ),
                ),
        )
}

// ============================================================================
// SCORE INTERPRETATION HELPERS
// ============================================================================

/// M-Score interpretation
fn m_score_interpretation(score: f64) -> &'static str {
    if score > -1.78 {
        "LIKELY MANIPULATION"
    } else if score > -2.22 {
        "POSSIBLE MANIPULATION"
    } else {
        "UNLIKELY MANIPULATION"
    }
}

/// M-Score color
fn m_score_color(theme: &Theme, score: f64) -> Hsla {
    if score > -1.78 {
        theme.negative
    } else if score > -2.22 {
        theme.warning
    } else {
        theme.positive
    }
}

/// F-Score interpretation (0-9)
fn f_score_interpretation(score: u8) -> &'static str {
    match score {
        8..=9 => "STRONG",
        5..=7 => "MODERATE",
        2..=4 => "WEAK",
        _ => "VERY WEAK",
    }
}

/// F-Score color
fn f_score_color(theme: &Theme, score: u8) -> Hsla {
    match score {
        8..=9 => theme.positive,
        5..=7 => theme.accent,
        2..=4 => theme.warning,
        _ => theme.negative,
    }
}

/// Z-Score interpretation
fn z_score_interpretation(score: f64) -> &'static str {
    if score > 2.99 {
        "SAFE ZONE"
    } else if score > 1.81 {
        "GREY ZONE"
    } else {
        "DISTRESS ZONE"
    }
}

/// Z-Score color
fn z_score_color(theme: &Theme, score: f64) -> Hsla {
    if score > 2.99 {
        theme.positive
    } else if score > 1.81 {
        theme.warning
    } else {
        theme.negative
    }
}

/// Accruals interpretation
fn accruals_interpretation(ratio: f64) -> &'static str {
    if ratio.abs() > 0.15 {
        "HIGH ACCRUALS"
    } else if ratio.abs() > 0.10 {
        "ELEVATED ACCRUALS"
    } else {
        "NORMAL ACCRUALS"
    }
}

/// Accruals color
fn accruals_color(theme: &Theme, ratio: f64) -> Hsla {
    if ratio.abs() > 0.15 {
        theme.negative
    } else if ratio.abs() > 0.10 {
        theme.warning
    } else {
        theme.positive
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
                .child(title.to_string()),
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
                .child("Loading..."),
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
