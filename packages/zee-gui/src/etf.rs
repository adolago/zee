//! ETF View for Stanley GUI
//!
//! Displays ETF analytics including:
//! - ETF fund flows with inflow/outflow visualization
//! - Sector rotation analysis with momentum signals
//! - Smart beta factor comparison and performance
//! - Thematic ETF tracking and trends

use crate::api::{EtfFlow, SectorRotation, SmartBetaFactor, ThematicEtf};
use crate::app::LoadState;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;

// ============================================================================
// ETF VIEW TYPES
// ============================================================================

/// Active tab within ETF view
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EtfTab {
    #[default]
    Flows,
    SectorRotation,
    SmartBeta,
    Thematic,
}

impl EtfTab {
    pub fn label(&self) -> &'static str {
        match self {
            EtfTab::Flows => "ETF Flows",
            EtfTab::SectorRotation => "Sector Rotation",
            EtfTab::SmartBeta => "Smart Beta",
            EtfTab::Thematic => "Thematic",
        }
    }

    pub fn all() -> &'static [EtfTab] {
        &[
            EtfTab::Flows,
            EtfTab::SectorRotation,
            EtfTab::SmartBeta,
            EtfTab::Thematic,
        ]
    }
}


// ============================================================================
// ETF VIEW STATE
// ============================================================================

/// State for ETF view
pub struct EtfState {
    pub active_tab: EtfTab,
    pub flows: LoadState<Vec<EtfFlow>>,
    pub sector_rotation: LoadState<Vec<SectorRotation>>,
    pub smart_beta: LoadState<Vec<SmartBetaFactor>>,
    pub thematic: LoadState<Vec<ThematicEtf>>,
    pub selected_etf: Option<String>,
    pub sort_column: Option<String>,
    pub sort_ascending: bool,
}

impl Default for EtfState {
    fn default() -> Self {
        Self {
            active_tab: EtfTab::Flows,
            flows: LoadState::NotLoaded,
            sector_rotation: LoadState::NotLoaded,
            smart_beta: LoadState::NotLoaded,
            thematic: LoadState::NotLoaded,
            selected_etf: None,
            sort_column: None,
            sort_ascending: false,
        }
    }
}

// ============================================================================
// ETF VIEW RENDERING
// ============================================================================

/// Render the main ETF view
pub fn render_etf(
    theme: &Theme,
    state: &EtfState,
    _cx: &mut Context<impl Sized>,
) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .child(render_etf_header(theme, state))
        .child(render_etf_content(theme, state))
}

/// Render ETF header with tab navigation
fn render_etf_header(theme: &Theme, state: &EtfState) -> impl IntoElement {
    // Calculate total flows summary
    let (total_flows, flow_trend) = match &state.flows {
        LoadState::Loaded(flows) => {
            let total: f64 = flows.iter().map(|f| f.flow_1d).sum();
            let trend = if total > 0.0 { "inflows" } else { "outflows" };
            (total, trend)
        }
        _ => (0.0, "loading"),
    };

    let flow_color = if total_flows >= 0.0 { theme.positive } else { theme.negative };

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
                        .child("ETF Analytics")
                )
                // Tab navigation
                .child(
                    div()
                        .flex()
                        .gap(px(4.0))
                        .children(
                            EtfTab::all().iter().map(|tab| {
                                render_tab_button(theme, *tab, state.active_tab)
                            }).collect::<Vec<_>>()
                        )
                )
        )
        .child(
            // Flow summary indicator
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Today's Net:")
                )
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(flow_color.opacity(0.15))
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(flow_color)
                                .child(format_flow(total_flows))
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(flow_color)
                                .child(flow_trend)
                        )
                )
        )
}

/// Render tab button
fn render_tab_button(theme: &Theme, tab: EtfTab, active: EtfTab) -> impl IntoElement {
    let is_active = tab == active;

    div()
        .px(px(14.0))
        .py(px(8.0))
        .rounded(px(6.0))
        .cursor_pointer()
        .bg(if is_active { theme.accent_subtle } else { transparent_black() })
        .text_color(if is_active { theme.accent } else { theme.text_muted })
        .text_size(px(13.0))
        .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
        .hover(|s| s.bg(if is_active { theme.accent_subtle } else { theme.hover_bg }))
        .child(tab.label())
}

/// Render content based on active tab
fn render_etf_content(theme: &Theme, state: &EtfState) -> Div {
    match state.active_tab {
        EtfTab::Flows => render_flows_tab(theme, state),
        EtfTab::SectorRotation => render_rotation_tab(theme, state),
        EtfTab::SmartBeta => render_smart_beta_tab(theme, state),
        EtfTab::Thematic => render_thematic_tab(theme, state),
    }
}

// ============================================================================
// FLOWS TAB - ETF Inflows/Outflows
// ============================================================================

fn render_flows_tab(theme: &Theme, state: &EtfState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
                .child(
            match &state.flows {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(flows) => render_flows_content(theme, flows),
                _ => loading_indicator(theme),
            }
        )
}

fn render_flows_content(theme: &Theme, flows: &[EtfFlow]) -> Div {
    // Split flows into inflows and outflows
    let inflows: Vec<_> = flows.iter().filter(|f| f.flow_1d > 0.0).collect();
    let outflows: Vec<_> = flows.iter().filter(|f| f.flow_1d < 0.0).collect();

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Summary metrics
        .child(render_flow_summary(theme, flows))
        // Two-column layout for inflows/outflows
        .child(
            div()
                .flex()
                .gap(px(20.0))
                .child(
                    div()
                        .flex_1()
                        .child(card(theme, "Top Inflows", render_flow_list(theme, &inflows, true)))
                )
                .child(
                    div()
                        .flex_1()
                        .child(card(theme, "Top Outflows", render_flow_list(theme, &outflows, false)))
                )
        )
        // Full ETF table
        .child(card(theme, "All ETF Flows", render_flows_table(theme, flows)))
}

fn render_flow_summary(theme: &Theme, flows: &[EtfFlow]) -> impl IntoElement {
    let total_1d: f64 = flows.iter().map(|f| f.flow_1d).sum();
    let total_1w: f64 = flows.iter().map(|f| f.flow_1w).sum();
    let total_1m: f64 = flows.iter().map(|f| f.flow_1m).sum();
    let total_aum: f64 = flows.iter().map(|f| f.aum).sum();

    let inflow_count = flows.iter().filter(|f| f.flow_1d > 0.0).count();
    let outflow_count = flows.iter().filter(|f| f.flow_1d < 0.0).count();

    div()
        .flex()
        .gap(px(16.0))
        .child(flow_metric_card(theme, "1-Day Net Flow", total_1d, "M"))
        .child(flow_metric_card(theme, "1-Week Net Flow", total_1w, "M"))
        .child(flow_metric_card(theme, "1-Month Net Flow", total_1m, "M"))
        .child(
            div()
                .flex_1()
                .p(px(16.0))
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
                        .child("Total AUM")
                )
                .child(
                    div()
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .child(format_aum(total_aum))
                )
        )
        .child(
            div()
                .flex_1()
                .p(px(16.0))
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
                        .child("Flow Direction")
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .size(px(8.0))
                                        .rounded_full()
                                        .bg(theme.positive)
                                )
                                .child(
                                    div()
                                        .text_size(px(16.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.positive)
                                        .child(format!("{}", inflow_count))
                                )
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .size(px(8.0))
                                        .rounded_full()
                                        .bg(theme.negative)
                                )
                                .child(
                                    div()
                                        .text_size(px(16.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.negative)
                                        .child(format!("{}", outflow_count))
                                )
                        )
                )
        )
}

fn flow_metric_card(theme: &Theme, label: &str, value: f64, suffix: &str) -> impl IntoElement {
    let positive = value >= 0.0;
    let color = if positive { theme.positive } else { theme.negative };

    div()
        .flex_1()
        .p(px(16.0))
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
                .child(label.to_string())
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:+.1}{}", value / 1_000_000.0, suffix))
                )
        )
}

fn render_flow_list(theme: &Theme, flows: &[&EtfFlow], is_inflow: bool) -> impl IntoElement {
    let color = if is_inflow { theme.positive } else { theme.negative };
    let sorted_flows: Vec<_> = if is_inflow {
        let mut v: Vec<_> = flows.iter().collect();
        v.sort_by(|a, b| b.flow_1d.partial_cmp(&a.flow_1d).unwrap_or(std::cmp::Ordering::Equal));
        v.into_iter().take(5).collect()
    } else {
        let mut v: Vec<_> = flows.iter().collect();
        v.sort_by(|a, b| a.flow_1d.partial_cmp(&b.flow_1d).unwrap_or(std::cmp::Ordering::Equal));
        v.into_iter().take(5).collect()
    };

    if sorted_flows.is_empty() {
        return div()
            .py(px(20.0))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.text_muted)
                    .child(if is_inflow { "No inflows today" } else { "No outflows today" })
            );
    }

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .children(
            sorted_flows.iter().enumerate().map(|(idx, flow)| {
                let max_flow = sorted_flows.first().map(|f| f.flow_1d.abs()).unwrap_or(1.0);
                let bar_width = ((flow.flow_1d.abs() / max_flow) * 100.0).min(100.0) as f32;

                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .py(px(10.0))
                    .px(px(12.0))
                    .rounded(px(6.0))
                    .bg(theme.card_bg_elevated)
                    .relative()
                    // Flow bar background
                    .child(
                        div()
                            .absolute()
                            .inset_0()
                            .rounded(px(6.0))
                            .child(
                                div()
                                    .h_full()
                                    .w(px(bar_width * 2.0)) // Scale to container
                                    .rounded(px(6.0))
                                    .bg(color.opacity(0.1))
                            )
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .size(px(24.0))
                                    .rounded(px(6.0))
                                    .bg(color.opacity(0.2))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(color)
                                    .child(format!("{}", idx + 1))
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(flow.symbol.clone())
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(theme.text_muted)
                                            .max_w(px(150.0))
                                            .overflow_hidden()
                                            .child(flow.name.clone())
                                    )
                            )
                    )
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(color)
                            .child(format_flow(flow.flow_1d))
                    )
            }).collect::<Vec<_>>()
        )
}

fn render_flows_table(theme: &Theme, flows: &[EtfFlow]) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        // Header row
        .child(
            div()
                .flex()
                .items_center()
                .py(px(12.0))
                .px(px(8.0))
                .border_b_1()
                .border_color(theme.border)
                .child(div().w(px(80.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Symbol"))
                .child(div().w(px(200.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Name"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("1-Day"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("1-Week"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("1-Month"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("AUM"))
                .child(div().w(px(80.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Flow %"))
        )
        // Data rows
        .children(
            flows.iter().take(15).map(|flow| {
                let color_1d = if flow.flow_1d >= 0.0 { theme.positive } else { theme.negative };
                let color_1w = if flow.flow_1w >= 0.0 { theme.positive } else { theme.negative };
                let color_1m = if flow.flow_1m >= 0.0 { theme.positive } else { theme.negative };
                let color_pct = if flow.flow_pct >= 0.0 { theme.positive } else { theme.negative };

                div()
                    .flex()
                    .items_center()
                    .py(px(10.0))
                    .px(px(8.0))
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .hover(|s| s.bg(theme.hover_bg))
                    .child(
                        div()
                            .w(px(80.0))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(flow.symbol.clone())
                    )
                    .child(
                        div()
                            .w(px(200.0))
                            .text_size(px(12.0))
                            .text_color(theme.text_secondary)
                            .overflow_hidden()
                            .child(flow.name.clone())
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color_1d)
                            .child(format_flow(flow.flow_1d))
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color_1w)
                            .child(format_flow(flow.flow_1w))
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color_1m)
                            .child(format_flow(flow.flow_1m))
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .child(format_aum(flow.aum))
                    )
                    .child(
                        div()
                            .w(px(80.0))
                            .child(
                                div()
                                    .px(px(6.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .bg(color_pct.opacity(0.15))
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(color_pct)
                                    .child(format!("{:+.2}%", flow.flow_pct))
                            )
                    )
            }).collect::<Vec<_>>()
        )
}

// ============================================================================
// SECTOR ROTATION TAB
// ============================================================================

fn render_rotation_tab(theme: &Theme, state: &EtfState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
                .child(
            match &state.sector_rotation {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(rotations) => render_rotation_content(theme, rotations),
                _ => loading_indicator(theme),
            }
        )
}

fn render_rotation_content(theme: &Theme, rotations: &[SectorRotation]) -> Div {
    // Split by signal
    let overweight: Vec<_> = rotations.iter().filter(|r| r.signal == "overweight").collect();
    let underweight: Vec<_> = rotations.iter().filter(|r| r.signal == "underweight").collect();

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Rotation heatmap
        .child(card(theme, "Sector Rotation Heatmap", render_rotation_heatmap(theme, rotations)))
        // Signal breakdown
        .child(
            div()
                .flex()
                .gap(px(20.0))
                .child(
                    div()
                        .flex_1()
                        .child(card(theme, "Overweight Sectors", render_signal_list(theme, &overweight, true)))
                )
                .child(
                    div()
                        .flex_1()
                        .child(card(theme, "Underweight Sectors", render_signal_list(theme, &underweight, false)))
                )
        )
        // Full table
        .child(card(theme, "Sector Rotation Analysis", render_rotation_table(theme, rotations)))
}

fn render_rotation_heatmap(theme: &Theme, rotations: &[SectorRotation]) -> impl IntoElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .children(
            rotations.iter().map(|r| {
                let signal_color = match r.signal.as_str() {
                    "overweight" => theme.positive,
                    "underweight" => theme.negative,
                    _ => theme.text_muted,
                };

                // Calculate intensity based on momentum score
                let intensity = (r.momentum_score.abs() / 100.0).min(1.0);

                div()
                    .w(px(120.0))
                    .p(px(12.0))
                    .rounded(px(8.0))
                    .bg(signal_color.opacity(intensity as f32 * 0.3 + 0.1))
                    .border_1()
                    .border_color(signal_color.opacity(0.3))
                    .cursor_pointer()
                    .hover(|s| s.border_color(signal_color))
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
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::BOLD)
                                    .child(r.sector.clone())
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_muted)
                                    .child(r.etf.clone())
                            )
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(px(16.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(signal_color)
                                    .child(format!("{:+.1}", r.momentum_score))
                            )
                            .child(
                                div()
                                    .px(px(6.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .bg(signal_color.opacity(0.2))
                                    .text_size(px(9.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(signal_color)
                                    .child(r.signal.to_uppercase())
                            )
                    )
            }).collect::<Vec<_>>()
        )
}

fn render_signal_list(theme: &Theme, rotations: &[&SectorRotation], is_overweight: bool) -> impl IntoElement {
    let color = if is_overweight { theme.positive } else { theme.negative };

    if rotations.is_empty() {
        return div()
            .py(px(20.0))
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.text_muted)
                    .child(if is_overweight { "No overweight signals" } else { "No underweight signals" })
            );
    }

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .children(
            rotations.iter().map(|r| {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .py(px(12.0))
                    .px(px(16.0))
                    .rounded(px(8.0))
                    .bg(theme.card_bg_elevated)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .size(px(32.0))
                                    .rounded(px(8.0))
                                    .bg(color.opacity(0.15))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(color)
                                    .child(r.etf.clone())
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(r.sector.clone())
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(8.0))
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_muted)
                                                    .child(format!("Momentum: {:+.1}", r.momentum_score))
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_muted)
                                                    .child(format!("Flow: {:+.1}", r.flow_score))
                                            )
                                    )
                            )
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_end()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(16.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(color)
                                    .child(format!("{:+.1}", r.relative_strength))
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Rel. Strength")
                            )
                    )
            }).collect::<Vec<_>>()
        )
}

fn render_rotation_table(theme: &Theme, rotations: &[SectorRotation]) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .py(px(12.0))
                .px(px(8.0))
                .border_b_1()
                .border_color(theme.border)
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Sector"))
                .child(div().w(px(80.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("ETF"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Momentum"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Flow Score"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Rel. Strength"))
                .child(div().w(px(100.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text_muted).child("Signal"))
        )
        // Rows
        .children(
            rotations.iter().map(|r| {
                let signal_color = match r.signal.as_str() {
                    "overweight" => theme.positive,
                    "underweight" => theme.negative,
                    _ => theme.text_muted,
                };
                let momentum_color = if r.momentum_score >= 0.0 { theme.positive } else { theme.negative };
                let flow_color = if r.flow_score >= 0.0 { theme.positive } else { theme.negative };
                let rs_color = if r.relative_strength >= 0.0 { theme.positive } else { theme.negative };

                div()
                    .flex()
                    .items_center()
                    .py(px(10.0))
                    .px(px(8.0))
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .hover(|s| s.bg(theme.hover_bg))
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(r.sector.clone())
                    )
                    .child(
                        div()
                            .w(px(80.0))
                            .text_size(px(12.0))
                            .text_color(theme.accent)
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(r.etf.clone())
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(momentum_color)
                            .child(format!("{:+.2}", r.momentum_score))
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(flow_color)
                            .child(format!("{:+.2}", r.flow_score))
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(rs_color)
                            .child(format!("{:+.2}", r.relative_strength))
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .child(
                                div()
                                    .px(px(8.0))
                                    .py(px(4.0))
                                    .rounded(px(4.0))
                                    .bg(signal_color.opacity(0.15))
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(signal_color)
                                    .child(r.signal.to_uppercase())
                            )
                    )
            }).collect::<Vec<_>>()
        )
}

// ============================================================================
// SMART BETA TAB
// ============================================================================

fn render_smart_beta_tab(theme: &Theme, state: &EtfState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
                .child(
            match &state.smart_beta {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(factors) => render_smart_beta_content(theme, factors),
                _ => loading_indicator(theme),
            }
        )
}

fn render_smart_beta_content(theme: &Theme, factors: &[SmartBetaFactor]) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Factor performance bars
        .child(card(theme, "Factor Performance (1 Month)", render_factor_bars(theme, factors, true)))
        // YTD performance comparison
        .child(card(theme, "Factor Performance (YTD)", render_factor_bars(theme, factors, false)))
        // Factor cards grid
        .child(card(theme, "Smart Beta Factors", render_factor_cards(theme, factors)))
}

fn render_factor_bars(theme: &Theme, factors: &[SmartBetaFactor], is_1m: bool) -> impl IntoElement {
    let max_return = factors.iter()
        .map(|f| if is_1m { f.return_1m.abs() } else { f.return_ytd.abs() })
        .fold(0.0_f64, |a, b| a.max(b));

    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .children(
            factors.iter().map(|f| {
                let value = if is_1m { f.return_1m } else { f.return_ytd };
                let positive = value >= 0.0;
                let color = if positive { theme.positive } else { theme.negative };
                let bar_width = if max_return > 0.0 {
                    (value.abs() / max_return * 150.0) as f32
                } else {
                    0.0
                };

                div()
                    .flex()
                    .items_center()
                    .gap(px(16.0))
                    // Factor name
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(f.factor.clone())
                    )
                    // ETF
                    .child(
                        div()
                            .w(px(60.0))
                            .text_size(px(12.0))
                            .text_color(theme.accent)
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(f.etf.clone())
                    )
                    // Bar
                    .child(
                        div()
                            .flex_grow()
                            .h(px(24.0))
                            .flex()
                            .items_center()
                            .child(
                                if positive {
                                    div()
                                        .h(px(20.0))
                                        .w(px(bar_width))
                                        .rounded(px(4.0))
                                        .bg(color.opacity(0.8))
                                } else {
                                    div()
                                        .h(px(20.0))
                                        .w(px(bar_width))
                                        .rounded(px(4.0))
                                        .bg(color.opacity(0.8))
                                }
                            )
                    )
                    // Value
                    .child(
                        div()
                            .w(px(70.0))
                            .text_size(px(14.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(color)
                            .text_align(gpui::TextAlign::Right)
                            .child(format!("{:+.2}%", value))
                    )
                    // Flow trend
                    .child(
                        render_flow_trend_badge(theme, &f.flow_trend)
                    )
            }).collect::<Vec<_>>()
        )
}

fn render_flow_trend_badge(theme: &Theme, trend: &str) -> impl IntoElement {
    let (color, icon) = match trend {
        "inflow" => (theme.positive, "^"),
        "outflow" => (theme.negative, "v"),
        _ => (theme.text_muted, "-"),
    };
    let trend_label = trend.to_string();

    div()
        .w(px(70.0))
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .px(px(8.0))
                .py(px(4.0))
                .rounded(px(4.0))
                .bg(color.opacity(0.15))
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(icon)
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(color)
                        .child(trend_label)
                )
        )
}

fn render_factor_cards(theme: &Theme, factors: &[SmartBetaFactor]) -> impl IntoElement {
    div()
        .flex()
        .flex_wrap()
        .gap(px(16.0))
        .children(
            factors.iter().map(|f| {
                let return_1m_positive = f.return_1m >= 0.0;
                let return_ytd_positive = f.return_ytd >= 0.0;
                let color_1m = if return_1m_positive { theme.positive } else { theme.negative };
                let color_ytd = if return_ytd_positive { theme.positive } else { theme.negative };

                let flow_color = match f.flow_trend.as_str() {
                    "inflow" => theme.positive,
                    "outflow" => theme.negative,
                    _ => theme.text_muted,
                };

                div()
                    .w(px(280.0))
                    .p(px(20.0))
                    .rounded(px(12.0))
                    .bg(theme.card_bg_elevated)
                    .border_1()
                    .border_color(theme.border)
                    .hover(|s| s.border_color(theme.accent))
                    .flex()
                    .flex_col()
                    .gap(px(16.0))
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
                                    .gap(px(10.0))
                                    .child(
                                        div()
                                            .size(px(36.0))
                                            .rounded(px(8.0))
                                            .bg(theme.accent.opacity(0.15))
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.accent)
                                            .child(f.etf.clone())
                                    )
                                    .child(
                                        div()
                                            .text_size(px(16.0))
                                            .font_weight(FontWeight::BOLD)
                                            .child(f.factor.clone())
                                    )
                            )
                            .child(
                                div()
                                    .px(px(8.0))
                                    .py(px(4.0))
                                    .rounded(px(4.0))
                                    .bg(flow_color.opacity(0.15))
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(flow_color)
                                    .child(f.flow_trend.to_uppercase())
                            )
                    )
                    // Description
                    .when_some(f.description.as_ref(), |el, desc| {
                        el.child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_muted)
                                .child(desc.clone())
                        )
                    })
                    // Performance metrics
                    .child(
                        div()
                            .flex()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.0))
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("1-Month")
                                    )
                                    .child(
                                        div()
                                            .text_size(px(20.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(color_1m)
                                            .child(format!("{:+.2}%", f.return_1m))
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
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("YTD")
                                    )
                                    .child(
                                        div()
                                            .text_size(px(20.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(color_ytd)
                                            .child(format!("{:+.2}%", f.return_ytd))
                                    )
                            )
                    )
            }).collect::<Vec<_>>()
        )
}

// ============================================================================
// THEMATIC TAB
// ============================================================================

fn render_thematic_tab(theme: &Theme, state: &EtfState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
                .child(
            match &state.thematic {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(thematics) => render_thematic_content(theme, thematics),
                _ => loading_indicator(theme),
            }
        )
}

fn render_thematic_content(theme: &Theme, thematics: &[ThematicEtf]) -> Div {
    // Group by theme
    let mut themes: std::collections::HashMap<String, Vec<&ThematicEtf>> = std::collections::HashMap::new();
    for t in thematics {
        themes.entry(t.theme.clone()).or_default().push(t);
    }

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Theme sections
        .children(
            themes.iter().map(|(theme_name, etfs)| {
                render_theme_section(theme, theme_name, etfs)
            }).collect::<Vec<_>>()
        )
}

fn render_theme_section(theme: &Theme, theme_name: &str, etfs: &[&ThematicEtf]) -> impl IntoElement {
    // Calculate theme average
    let avg_return: f64 = etfs.iter().map(|e| e.return_1m).sum::<f64>() / etfs.len() as f64;
    let avg_color = if avg_return >= 0.0 { theme.positive } else { theme.negative };

    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Theme header
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
                                .size(px(32.0))
                                .rounded(px(8.0))
                                .bg(theme_color(theme_name).opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(14.0))
                                .child(theme_icon(theme_name))
                        )
                        .child(
                            div()
                                .text_size(px(18.0))
                                .font_weight(FontWeight::BOLD)
                                .child(theme_name.to_string())
                        )
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(theme.border_subtle)
                                .text_size(px(11.0))
                                .text_color(theme.text_muted)
                                .child(format!("{} ETFs", etfs.len()))
                        )
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_muted)
                                .child("Theme Avg:")
                        )
                        .child(
                            div()
                                .px(px(10.0))
                                .py(px(4.0))
                                .rounded(px(6.0))
                                .bg(avg_color.opacity(0.15))
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(avg_color)
                                .child(format!("{:+.2}%", avg_return))
                        )
                )
        )
        // ETF cards in grid
        .child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(12.0))
                .children(
                    etfs.iter().map(|etf| {
                        render_thematic_etf_card(theme, etf)
                    }).collect::<Vec<_>>()
                )
        )
}

fn render_thematic_etf_card(theme: &Theme, etf: &ThematicEtf) -> impl IntoElement {
    let return_1m_positive = etf.return_1m >= 0.0;
    let return_ytd_positive = etf.return_ytd >= 0.0;
    let flow_positive = etf.flow_1m >= 0.0;
    let color_1m = if return_1m_positive { theme.positive } else { theme.negative };
    let color_ytd = if return_ytd_positive { theme.positive } else { theme.negative };
    let flow_color = if flow_positive { theme.positive } else { theme.negative };

    let momentum_color = match etf.momentum.as_str() {
        "accelerating" => theme.positive,
        "decelerating" => theme.negative,
        _ => theme.text_muted,
    };

    div()
        .w(px(220.0))
        .p(px(16.0))
        .rounded(px(10.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .cursor_pointer()
        .hover(|s| s.border_color(theme.accent).bg(theme.card_bg_elevated))
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
                        .text_size(px(15.0))
                        .font_weight(FontWeight::BOLD)
                        .child(etf.symbol.clone())
                )
                .child(
                    div()
                        .px(px(6.0))
                        .py(px(2.0))
                        .rounded(px(4.0))
                        .bg(momentum_color.opacity(0.15))
                        .text_size(px(9.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(momentum_color)
                        .child(etf.momentum.to_uppercase())
                )
        )
        // Name
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .h(px(32.0))
                .overflow_hidden()
                .child(etf.name.clone())
        )
        // Returns
        .child(
            div()
                .flex()
                .gap(px(12.0))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child("1M")
                        )
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(color_1m)
                                .child(format!("{:+.1}%", etf.return_1m))
                        )
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child("YTD")
                        )
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(color_ytd)
                                .child(format!("{:+.1}%", etf.return_ytd))
                        )
                )
        )
        // Flow and AUM
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .pt(px(8.0))
                .border_t_1()
                .border_color(theme.border_subtle)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child("Flow:")
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(flow_color)
                                .child(format_flow(etf.flow_1m))
                        )
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(format!("AUM: {}", format_aum(etf.aum)))
                )
        )
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
                .child("Loading...")
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

/// Format flow value (in millions)
fn format_flow(value: f64) -> String {
    let abs_val = value.abs();
    let sign = if value >= 0.0 { "+" } else { "-" };

    if abs_val >= 1_000_000_000.0 {
        format!("{}${:.1}B", sign, abs_val / 1_000_000_000.0)
    } else if abs_val >= 1_000_000.0 {
        format!("{}${:.1}M", sign, abs_val / 1_000_000.0)
    } else if abs_val >= 1_000.0 {
        format!("{}${:.1}K", sign, abs_val / 1_000.0)
    } else {
        format!("{}${:.0}", sign, abs_val)
    }
}

/// Format AUM value
fn format_aum(value: f64) -> String {
    if value >= 1_000_000_000.0 {
        format!("${:.1}B", value / 1_000_000_000.0)
    } else if value >= 1_000_000.0 {
        format!("${:.1}M", value / 1_000_000.0)
    } else if value >= 1_000.0 {
        format!("${:.1}K", value / 1_000.0)
    } else {
        format!("${:.0}", value)
    }
}

/// Get theme icon
fn theme_icon(theme_name: &str) -> &'static str {
    match theme_name.to_lowercase().as_str() {
        "technology" | "tech" => "T",
        "clean energy" | "renewable" | "solar" => "E",
        "artificial intelligence" | "ai" | "robotics" => "A",
        "cybersecurity" | "security" => "S",
        "cloud computing" | "cloud" => "C",
        "blockchain" | "crypto" => "B",
        "healthcare" | "biotech" => "H",
        "cannabis" | "marijuana" => "C",
        "esports" | "gaming" => "G",
        "space" | "aerospace" => "S",
        "electric vehicles" | "ev" => "V",
        "fintech" => "F",
        "metaverse" => "M",
        "infrastructure" => "I",
        _ => "?",
    }
}

/// Get theme color
fn theme_color(theme_name: &str) -> Hsla {
    match theme_name.to_lowercase().as_str() {
        "technology" | "tech" => hsla(210.0 / 360.0, 0.8, 0.5, 1.0), // Blue
        "clean energy" | "renewable" | "solar" => hsla(120.0 / 360.0, 0.7, 0.45, 1.0), // Green
        "artificial intelligence" | "ai" | "robotics" => hsla(280.0 / 360.0, 0.7, 0.5, 1.0), // Purple
        "cybersecurity" | "security" => hsla(0.0, 0.8, 0.5, 1.0), // Red
        "cloud computing" | "cloud" => hsla(200.0 / 360.0, 0.8, 0.6, 1.0), // Sky blue
        "blockchain" | "crypto" => hsla(35.0 / 360.0, 0.9, 0.5, 1.0), // Orange
        "healthcare" | "biotech" => hsla(340.0 / 360.0, 0.7, 0.5, 1.0), // Pink
        "electric vehicles" | "ev" => hsla(150.0 / 360.0, 0.7, 0.45, 1.0), // Teal
        "fintech" => hsla(45.0 / 360.0, 0.9, 0.5, 1.0), // Gold
        _ => hsla(0.0, 0.0, 0.5, 1.0), // Gray
    }
}

// ============================================================================
// ETF SIDEBAR COMPONENT (for main navigation)
// ============================================================================

/// Render ETF quick summary for sidebar
pub fn render_etf_summary(
    theme: &Theme,
    flows: &[EtfFlow],
    selected: Option<&str>,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .children(
            flows.iter().take(5).map(|f| {
                let is_selected = selected.map(|s| s == f.symbol).unwrap_or(false);
                let positive = f.flow_1d >= 0.0;
                let color = if positive { theme.positive } else { theme.negative };

                div()
                    .px(px(12.0))
                    .py(px(8.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .bg(if is_selected { theme.accent_subtle } else { transparent_black() })
                    .hover(|s| s.bg(theme.hover_bg))
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(if is_selected { theme.text } else { theme.text_secondary })
                                    .child(f.symbol.clone())
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_dimmed)
                                    .child(format_aum(f.aum))
                            )
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color)
                            .child(format_flow(f.flow_1d))
                    )
            }).collect::<Vec<_>>()
        )
}

// ============================================================================
// ETF TICKER COMPONENT (for dashboard)
// ============================================================================

/// Horizontal ETF flow ticker for dashboard
pub fn render_etf_ticker(theme: &Theme, flows: &[EtfFlow]) -> impl IntoElement {
    div()
        .h(px(36.0))
        .px(px(16.0))
        .flex()
        .items_center()
        .gap(px(24.0))
        .bg(theme.card_bg_elevated)
        .border_b_1()
        .border_color(theme.border_subtle)
                .children(
            flows.iter().take(10).map(|f| {
                let positive = f.flow_1d >= 0.0;
                let color = if positive { theme.positive } else { theme.negative };

                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_secondary)
                            .child(f.symbol.clone())
                    )
                    .child(
                        div()
                            .text_size(px(10.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color)
                            .child(format_flow(f.flow_1d))
                    )
            }).collect::<Vec<_>>()
        )
}
