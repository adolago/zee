//! Commodities View for Stanley GUI
//!
//! Displays commodity market data including:
//! - Market overview grid by category
//! - Individual commodity detail view
//! - Macro-commodity linkage analysis
//! - Correlation matrix visualization
//! - Price trend indicators
//! - Supply/demand factors

use crate::app::{format_number, LoadState};
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;

// Re-export API types for convenience
pub use crate::api::{
    CategoryOverview, CommoditiesOverview, CommodityPrice, CommoditySummary, CorrelationMatrix,
    MacroAnalysis, MacroLinkage,
};

/// Sub-view within Commodities
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[allow(dead_code)]
pub enum CommoditiesSubView {
    #[default]
    Overview,
    Detail,
    Correlations,
    MacroLinkages,
}

/// Category filter for commodities view
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CommodityCategory {
    #[default]
    All,
    Energy,
    PreciousMetals,
    BaseMetals,
    Agriculture,
    Softs,
    Livestock,
}

impl CommodityCategory {
    /// Get the display label for the category
    pub fn label(&self) -> &'static str {
        match self {
            CommodityCategory::All => "All",
            CommodityCategory::Energy => "Energy",
            CommodityCategory::PreciousMetals => "Precious Metals",
            CommodityCategory::BaseMetals => "Base Metals",
            CommodityCategory::Agriculture => "Agriculture",
            CommodityCategory::Softs => "Softs",
            CommodityCategory::Livestock => "Livestock",
        }
    }

    /// Get the API category key
    pub fn api_key(&self) -> Option<&'static str> {
        match self {
            CommodityCategory::All => None,
            CommodityCategory::Energy => Some("energy"),
            CommodityCategory::PreciousMetals => Some("precious_metals"),
            CommodityCategory::BaseMetals => Some("base_metals"),
            CommodityCategory::Agriculture => Some("agriculture"),
            CommodityCategory::Softs => Some("softs"),
            CommodityCategory::Livestock => Some("livestock"),
        }
    }

    /// All categories for iteration
    pub fn all() -> &'static [CommodityCategory] {
        &[
            CommodityCategory::All,
            CommodityCategory::Energy,
            CommodityCategory::PreciousMetals,
            CommodityCategory::BaseMetals,
            CommodityCategory::Agriculture,
            CommodityCategory::Softs,
            CommodityCategory::Livestock,
        ]
    }
}

// ============================================================================
// COMMODITIES VIEW STATE
// ============================================================================

/// State for commodities view
pub struct CommoditiesState {
    pub sub_view: CommoditiesSubView,
    pub selected_commodity: Option<String>,
    pub overview: LoadState<CommoditiesOverview>,
    pub detail: LoadState<CommoditySummary>,
    pub macro_analysis: LoadState<MacroAnalysis>,
    pub correlations: LoadState<CorrelationMatrix>,
    pub category_filter: CommodityCategory,
}

impl Default for CommoditiesState {
    fn default() -> Self {
        Self {
            sub_view: CommoditiesSubView::Overview,
            selected_commodity: None,
            overview: LoadState::NotLoaded,
            detail: LoadState::NotLoaded,
            macro_analysis: LoadState::NotLoaded,
            correlations: LoadState::NotLoaded,
            category_filter: CommodityCategory::All,
        }
    }
}

impl CommoditiesState {
    /// Create a new commodities state
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the active sub-view
    #[allow(dead_code)]
    pub fn set_sub_view(&mut self, view: CommoditiesSubView) {
        self.sub_view = view;
    }

    /// Set the category filter
    #[allow(dead_code)]
    pub fn set_category_filter(&mut self, category: CommodityCategory) {
        self.category_filter = category;
    }

    /// Select a commodity for detail view
    #[allow(dead_code)]
    pub fn select_commodity(&mut self, symbol: String) {
        self.selected_commodity = Some(symbol);
        self.sub_view = CommoditiesSubView::Detail;
    }

    /// Clear commodity selection
    #[allow(dead_code)]
    pub fn clear_selection(&mut self) {
        self.selected_commodity = None;
        self.sub_view = CommoditiesSubView::Overview;
    }

    /// Check if a category matches the filter
    pub fn matches_filter(&self, category_key: &str) -> bool {
        match self.category_filter {
            CommodityCategory::All => true,
            _ => self.category_filter.api_key() == Some(category_key),
        }
    }
}

// ============================================================================
// COMMODITIES VIEW RENDERING
// ============================================================================

/// Render the main commodities view
pub fn render_commodities(
    theme: &Theme,
    state: &CommoditiesState,
    cx: &mut Context<impl Sized>,
) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .child(render_commodities_header(theme, state, cx))
        .child(render_commodities_content(theme, state, cx))
}

/// Render commodities header with sub-navigation and category filter
fn render_commodities_header(
    theme: &Theme,
    state: &CommoditiesState,
    _cx: &mut Context<impl Sized>,
) -> impl IntoElement {
    let sentiment = match &state.overview {
        LoadState::Loaded(o) => o.sentiment.clone(),
        _ => "loading".to_string(),
    };

    let sentiment_color = match sentiment.as_str() {
        "bullish" => theme.positive,
        "bearish" => theme.negative,
        _ => theme.text_muted,
    };

    div()
        .flex()
        .flex_col()
        // Top row: Title, sub-navigation, and sentiment
        .child(
            div()
                .h(px(56.0))
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
                                .child("Commodities"),
                        )
                        // Sub-navigation tabs
                        .child(
                            div()
                                .flex()
                                .gap(px(4.0))
                                .child(sub_nav_tab(
                                    theme,
                                    "Overview",
                                    CommoditiesSubView::Overview,
                                    state.sub_view,
                                ))
                                .child(sub_nav_tab(
                                    theme,
                                    "Correlations",
                                    CommoditiesSubView::Correlations,
                                    state.sub_view,
                                ))
                                .child(sub_nav_tab(
                                    theme,
                                    "Macro Linkages",
                                    CommoditiesSubView::MacroLinkages,
                                    state.sub_view,
                                )),
                        ),
                )
                .child(
                    // Market sentiment indicator
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_muted)
                                .child("Market Sentiment:"),
                        )
                        .child(
                            div()
                                .px(px(12.0))
                                .py(px(6.0))
                                .rounded(px(6.0))
                                .bg(sentiment_color.opacity(0.15))
                                .text_size(px(12.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(sentiment_color)
                                .child(sentiment.to_uppercase()),
                        ),
                ),
        )
        // Category filter row (only show on Overview)
        .when(state.sub_view == CommoditiesSubView::Overview, |el| {
            el.child(render_category_filter_bar(theme, state))
        })
}

/// Render category filter bar
fn render_category_filter_bar(theme: &Theme, state: &CommoditiesState) -> impl IntoElement {
    div()
        .h(px(44.0))
        .px(px(24.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .bg(theme.card_bg)
        .border_b_1()
        .border_color(theme.border_subtle)
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_dimmed)
                .mr(px(8.0))
                .child("Filter:"),
        )
        .children(
            CommodityCategory::all()
                .iter()
                .map(|cat| render_category_tab(theme, *cat, state.category_filter))
                .collect::<Vec<_>>(),
        )
}

/// Render a single category filter tab
fn render_category_tab(
    theme: &Theme,
    category: CommodityCategory,
    active: CommodityCategory,
) -> impl IntoElement {
    let is_active = category == active;
    let cat_color = match category {
        CommodityCategory::All => theme.accent,
        CommodityCategory::Energy => hsla(0.08, 0.8, 0.5, 1.0),
        CommodityCategory::PreciousMetals => hsla(0.14, 0.9, 0.6, 1.0),
        CommodityCategory::BaseMetals => hsla(0.55, 0.6, 0.5, 1.0),
        CommodityCategory::Agriculture => hsla(0.33, 0.7, 0.45, 1.0),
        CommodityCategory::Softs => hsla(0.08, 0.6, 0.35, 1.0),
        CommodityCategory::Livestock => hsla(0.0, 0.6, 0.5, 1.0),
    };

    div()
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(16.0))
        .cursor_pointer()
        .bg(if is_active {
            cat_color.opacity(0.2)
        } else {
            transparent_black()
        })
        .border_1()
        .border_color(if is_active {
            cat_color.opacity(0.5)
        } else {
            theme.border_subtle
        })
        .text_color(if is_active {
            cat_color
        } else {
            theme.text_muted
        })
        .text_size(px(12.0))
        .font_weight(if is_active {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        })
        .hover(|s| {
            s.bg(cat_color.opacity(0.1))
                .border_color(cat_color.opacity(0.3))
        })
        .child(category.label())
}

/// Sub-navigation tab
fn sub_nav_tab(
    theme: &Theme,
    label: &str,
    view: CommoditiesSubView,
    active: CommoditiesSubView,
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
fn render_commodities_content(
    theme: &Theme,
    state: &CommoditiesState,
    cx: &mut Context<impl Sized>,
) -> Div {
    match state.sub_view {
        CommoditiesSubView::Overview => render_overview(theme, state, cx),
        CommoditiesSubView::Detail => render_detail(theme, state, cx),
        CommoditiesSubView::Correlations => render_correlations(theme, state, cx),
        CommoditiesSubView::MacroLinkages => render_macro_linkages(theme, state, cx),
    }
}

// ============================================================================
// OVERVIEW VIEW - Market grid by category
// ============================================================================

fn render_overview(theme: &Theme, state: &CommoditiesState, _cx: &mut Context<impl Sized>) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_hidden()
        .child(match &state.overview {
            LoadState::Loading => loading_indicator(theme),
            LoadState::Error(e) => error_message(theme, e),
            LoadState::Loaded(overview) => {
                // Filter categories based on selected filter
                let filtered_categories: Vec<_> = overview
                    .categories
                    .iter()
                    .filter(|(name, _)| state.matches_filter(name))
                    .collect();

                if filtered_categories.is_empty() {
                    div()
                        .py(px(40.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .text_color(theme.text_muted)
                                .child("No commodities in this category"),
                        )
                } else {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(24.0))
                        // Category sections (filtered)
                        .children(
                            filtered_categories
                                .iter()
                                .map(|(name, cat)| render_category_section(theme, name, cat))
                                .collect::<Vec<_>>(),
                        )
                }
            }
            _ => loading_indicator(theme),
        })
}

/// Render a category section with commodity cards
fn render_category_section(
    theme: &Theme,
    category_name: &str,
    category: &CategoryOverview,
) -> impl IntoElement {
    let display_name = format_category_name(category_name);
    let positive = category.avg_change >= 0.0;
    let change_color = if positive {
        theme.positive
    } else {
        theme.negative
    };

    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        // Category header
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
                                .bg(category_color(category_name).opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .text_size(px(14.0))
                                        .child(category_icon(category_name)),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(16.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(display_name),
                        )
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(theme.border_subtle)
                                .text_size(px(11.0))
                                .text_color(theme.text_muted)
                                .child(format!("{} items", category.count)),
                        ),
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
                                .child("Avg:"),
                        )
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(change_color)
                                .child(format!("{:+.2}%", category.avg_change)),
                        ),
                ),
        )
        // Commodity cards grid
        .child(
            div().flex().flex_wrap().gap(px(12.0)).children(
                category
                    .commodities
                    .iter()
                    .map(|c| render_commodity_card(theme, c))
                    .collect::<Vec<_>>(),
            ),
        )
}

/// Render individual commodity card
fn render_commodity_card(theme: &Theme, commodity: &CommodityPrice) -> impl IntoElement {
    let positive = commodity.change_percent >= 0.0;
    let change_color = if positive {
        theme.positive
    } else {
        theme.negative
    };

    div()
        .w(px(200.0))
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
        // Symbol and name
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .child(commodity.symbol.clone()),
                )
                .child(
                    // Trend indicator
                    trend_indicator(theme, commodity.change_percent),
                ),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .child(commodity.name.clone()),
        )
        // Price
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(format_commodity_price(commodity.price, &commodity.symbol)),
                )
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(change_color.opacity(0.15))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(change_color)
                        .child(format!("{:+.2}%", commodity.change_percent)),
                ),
        )
        // Day range bar
        .child(render_day_range(theme, commodity))
        // Volume
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child(div().child(format!("Vol: {}", format_number(commodity.volume as f64))))
                .child(div().child(format!(
                    "OI: {}",
                    format_number(commodity.open_interest as f64)
                ))),
        )
}

/// Render day range bar (low to high)
fn render_day_range(theme: &Theme, commodity: &CommodityPrice) -> impl IntoElement {
    let range = commodity.high - commodity.low;
    let position = if range > 0.0 {
        ((commodity.price - commodity.low) / range * 100.0).clamp(0.0, 100.0) as f32
    } else {
        50.0
    };

    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .h(px(4.0))
                .rounded(px(2.0))
                .bg(theme.border_subtle)
                .relative()
                .child(
                    // Price position marker
                    div()
                        .absolute()
                        .top(px(-2.0))
                        .left(px(position * 1.8)) // Scale to card width
                        .size(px(8.0))
                        .rounded_full()
                        .bg(theme.accent)
                        .border_2()
                        .border_color(theme.card_bg),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .text_size(px(9.0))
                .text_color(theme.text_dimmed)
                .child(format!("L: {:.2}", commodity.low))
                .child(format!("H: {:.2}", commodity.high)),
        )
}

/// Trend indicator icon
fn trend_indicator(theme: &Theme, change: f64) -> impl IntoElement {
    let (icon, color) = if change > 1.0 {
        ("^", theme.positive) // Strong up
    } else if change > 0.0 {
        ("-^", theme.positive) // Slight up
    } else if change < -1.0 {
        ("v", theme.negative) // Strong down
    } else if change < 0.0 {
        ("-v", theme.negative) // Slight down
    } else {
        ("-", theme.text_muted) // Flat
    };

    div()
        .size(px(20.0))
        .rounded(px(4.0))
        .bg(color.opacity(0.15))
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(10.0))
        .font_weight(FontWeight::BOLD)
        .text_color(color)
        .child(icon)
}

// ============================================================================
// DETAIL VIEW - Individual commodity analysis
// ============================================================================

fn render_detail(theme: &Theme, state: &CommoditiesState, _cx: &mut Context<impl Sized>) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_hidden()
        .child(match &state.detail {
            LoadState::Loading => loading_indicator(theme),
            LoadState::Error(e) => error_message(theme, e),
            LoadState::Loaded(detail) => {
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.0))
                    // Header with price
                    .child(render_detail_header(theme, detail))
                    // Metrics row
                    .child(render_detail_metrics(theme, detail))
                    // Data-derived price path proxy (YTD -> now)
                    .child(card(
                        theme,
                        "Price Path Proxy",
                        render_price_profile(theme, detail),
                    ))
                    // Data-derived market factors
                    .child(card(
                        theme,
                        "Market Factors (Data-Derived)",
                        render_supply_demand(theme, detail),
                    ))
            }
            _ => div()
                .py(px(40.0))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(theme.text_muted)
                        .child("Select a commodity to view details"),
                ),
        })
}

/// Render detail header
fn render_detail_header(theme: &Theme, detail: &CommoditySummary) -> impl IntoElement {
    let positive = detail.change_1d >= 0.0;
    let change_color = if positive {
        theme.positive
    } else {
        theme.negative
    };

    let trend_color = match detail.trend.as_str() {
        "bullish" => theme.positive,
        "bearish" => theme.negative,
        _ => theme.text_muted,
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                .child(
                    div()
                        .size(px(48.0))
                        .rounded(px(12.0))
                        .bg(category_color(&detail.category).opacity(0.15))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(20.0))
                        .child(category_icon(&detail.category)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(12.0))
                                .child(
                                    div()
                                        .text_size(px(24.0))
                                        .font_weight(FontWeight::BOLD)
                                        .child(detail.symbol.clone()),
                                )
                                .child(
                                    div()
                                        .px(px(8.0))
                                        .py(px(2.0))
                                        .rounded(px(4.0))
                                        .bg(trend_color.opacity(0.15))
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(trend_color)
                                        .child(detail.trend.to_uppercase()),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(theme.text_muted)
                                .child(detail.name.clone()),
                        ),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                .child(
                    div()
                        .text_size(px(28.0))
                        .font_weight(FontWeight::BOLD)
                        .child(format!("${:.2}", detail.price)),
                )
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(change_color.opacity(0.15))
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(change_color)
                        .child(format!("{:+.2}%", detail.change_1d)),
                ),
        )
}

/// Render detail metrics row
fn render_detail_metrics(theme: &Theme, detail: &CommoditySummary) -> impl IntoElement {
    div()
        .flex()
        .gap(px(16.0))
        .child(period_metric(theme, "1 Week", detail.change_1w))
        .child(period_metric(theme, "1 Month", detail.change_1m))
        .child(period_metric(theme, "YTD", detail.change_ytd))
        .child(volatility_metric(
            theme,
            "30D Volatility",
            detail.volatility_30d,
        ))
        .child(strength_metric(
            theme,
            "Relative Strength",
            detail.relative_strength,
        ))
}

/// Period change metric card
fn period_metric(theme: &Theme, label: &str, value: f64) -> impl IntoElement {
    let positive = value >= 0.0;
    let color = if positive {
        theme.positive
    } else {
        theme.negative
    };

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
                .child(label.to_string()),
        )
        .child(
            div()
                .text_size(px(20.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(format!("{:+.2}%", value)),
        )
}

/// Volatility metric card
fn volatility_metric(theme: &Theme, label: &str, value: f64) -> impl IntoElement {
    let color = if value > 30.0 {
        theme.negative // High volatility
    } else if value > 15.0 {
        theme.accent // Medium volatility
    } else {
        theme.positive // Low volatility
    };

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
                .child(label.to_string()),
        )
        .child(
            div()
                .text_size(px(20.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(format!("{:.1}%", value)),
        )
}

/// Relative strength metric card
fn strength_metric(theme: &Theme, label: &str, value: f64) -> impl IntoElement {
    let positive = value >= 0.0;
    let color = if positive {
        theme.positive
    } else {
        theme.negative
    };

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
                .child(label.to_string()),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(20.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:+.2}", value)),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("vs category"),
                ),
        )
}

fn render_price_profile(theme: &Theme, detail: &CommoditySummary) -> impl IntoElement {
    let points = price_profile_points(detail);
    let values: Vec<f64> = points.iter().map(|(_, value)| *value).collect();
    let sparkline = build_price_profile_sparkline(&values);

    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child(sparkline),
        )
        .child(
            div()
                .flex()
                .gap(px(10.0))
                .children(points.into_iter().map(|(label, value)| {
                    div()
                        .flex_1()
                        .p(px(10.0))
                        .rounded(px(6.0))
                        .bg(theme.card_bg_elevated)
                        .border_1()
                        .border_color(theme.border_subtle)
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child(label),
                        )
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text)
                                .child(format!("{:.1}", value)),
                        )
                })),
        )
}

fn price_profile_points(detail: &CommoditySummary) -> Vec<(String, f64)> {
    fn recover_base(change_percent: f64) -> f64 {
        let denom = 1.0 + (change_percent / 100.0);
        if denom.abs() < 1e-6 {
            100.0
        } else {
            100.0 / denom
        }
    }

    vec![
        ("YTD".to_string(), recover_base(detail.change_ytd)),
        ("1M".to_string(), recover_base(detail.change_1m)),
        ("1W".to_string(), recover_base(detail.change_1w)),
        ("1D".to_string(), recover_base(detail.change_1d)),
        ("Now".to_string(), 100.0),
    ]
}

fn build_price_profile_sparkline(values: &[f64]) -> String {
    if values.is_empty() {
        return "No data".to_string();
    }

    let min = values
        .iter()
        .copied()
        .fold(f64::INFINITY, |acc, value| acc.min(value));
    let max = values
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, |acc, value| acc.max(value));

    if (max - min).abs() < f64::EPSILON {
        return "-----".to_string();
    }

    let blocks = ["-", "=", "^", "A", "M", "W", "#", "@"];

    values
        .iter()
        .map(|value| {
            let normalized = ((*value - min) / (max - min)).clamp(0.0, 1.0);
            let index = (normalized * (blocks.len() as f64 - 1.0)).round() as usize;
            blocks[index]
        })
        .collect::<Vec<&str>>()
        .join("")
}

/// Data-derived market factors
fn render_supply_demand(theme: &Theme, detail: &CommoditySummary) -> impl IntoElement {
    let trend_signal = match detail.trend.as_str() {
        "bullish" => ("Bullish", "bullish"),
        "bearish" => ("Bearish", "bearish"),
        _ => ("Neutral", "neutral"),
    };

    let momentum_signal = if detail.change_1m > 1.0 {
        "bullish"
    } else if detail.change_1m < -1.0 {
        "bearish"
    } else {
        "neutral"
    };

    let ytd_signal = if detail.change_ytd > 0.0 {
        "bullish"
    } else if detail.change_ytd < 0.0 {
        "bearish"
    } else {
        "neutral"
    };

    let relative_strength_signal = if detail.relative_strength > 0.0 {
        "bullish"
    } else if detail.relative_strength < 0.0 {
        "bearish"
    } else {
        "neutral"
    };

    let volatility_signal = if detail.volatility_30d >= 30.0 {
        "bearish"
    } else if detail.volatility_30d >= 15.0 {
        "neutral"
    } else {
        "bullish"
    };

    div()
        .flex()
        .gap(px(24.0))
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_secondary)
                        .child("MOMENTUM"),
                )
                .child(factor_item(theme, "Trend", trend_signal.0, trend_signal.1))
                .child(factor_item(
                    theme,
                    "1M Change",
                    &format!("{:+.2}%", detail.change_1m),
                    momentum_signal,
                ))
                .child(factor_item(
                    theme,
                    "YTD Change",
                    &format!("{:+.2}%", detail.change_ytd),
                    ytd_signal,
                )),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_secondary)
                        .child("RISK / RELATIVE"),
                )
                .child(factor_item(
                    theme,
                    "Relative Strength",
                    &format!("{:+.2}", detail.relative_strength),
                    relative_strength_signal,
                ))
                .child(factor_item(
                    theme,
                    "30D Volatility",
                    &format!("{:.1}%", detail.volatility_30d),
                    volatility_signal,
                ))
                .child(factor_item(
                    theme,
                    "1D Change",
                    &format!("{:+.2}%", detail.change_1d),
                    if detail.change_1d > 0.0 {
                        "bullish"
                    } else if detail.change_1d < 0.0 {
                        "bearish"
                    } else {
                        "neutral"
                    },
                )),
        )
}

/// Factor item display
fn factor_item(theme: &Theme, label: &str, status: &str, signal: &str) -> impl IntoElement {
    let color = match signal {
        "bullish" => theme.positive,
        "bearish" => theme.negative,
        _ => theme.text_muted,
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .py(px(8.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child(label.to_string()),
        )
        .child(
            div()
                .px(px(8.0))
                .py(px(4.0))
                .rounded(px(4.0))
                .bg(color.opacity(0.15))
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(color)
                .child(status.to_string()),
        )
}

// ============================================================================
// CORRELATIONS VIEW - Correlation matrix heatmap
// ============================================================================

fn render_correlations(
    theme: &Theme,
    state: &CommoditiesState,
    _cx: &mut Context<impl Sized>,
) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_hidden()
        .child(card(
            theme,
            "Commodity Correlations Matrix",
            match &state.correlations {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(matrix) => render_correlation_matrix(theme, matrix),
                _ => loading_indicator(theme),
            },
        ))
        .child(card(
            theme,
            "Correlation Insights",
            render_correlation_insights(theme),
        ))
}

/// Render correlation matrix heatmap
fn render_correlation_matrix(theme: &Theme, matrix: &CorrelationMatrix) -> Div {
    let symbols = &matrix.symbols;
    let data = &matrix.matrix;

    div()
        .flex()
        .flex_col()
        .gap(px(2.0))
        // Header row
        .child(
            div()
                .flex()
                .gap(px(2.0))
                .child(div().w(px(60.0)).h(px(32.0)))
                .children(
                    symbols
                        .iter()
                        .map(|s| {
                            div()
                                .w(px(60.0))
                                .h(px(32.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_secondary)
                                .child(s.clone())
                        })
                        .collect::<Vec<_>>(),
                ),
        )
        // Matrix rows
        .children(
            symbols
                .iter()
                .enumerate()
                .map(|(i, sym)| {
                    div()
                        .flex()
                        .gap(px(2.0))
                        // Row label
                        .child(
                            div()
                                .w(px(60.0))
                                .h(px(32.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_secondary)
                                .child(sym.clone()),
                        )
                        // Correlation cells
                        .children(
                            data.get(i)
                                .unwrap_or(&vec![])
                                .iter()
                                .map(|corr| render_correlation_cell(theme, *corr))
                                .collect::<Vec<_>>(),
                        )
                })
                .collect::<Vec<_>>(),
        )
}

/// Render single correlation cell
fn render_correlation_cell(theme: &Theme, value: f64) -> impl IntoElement {
    let (bg, text_col) = correlation_color(theme, value);

    div()
        .w(px(60.0))
        .h(px(32.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(4.0))
        .bg(bg)
        .text_size(px(11.0))
        .font_weight(FontWeight::MEDIUM)
        .text_color(text_col)
        .child(format!("{:.2}", value))
}

/// Get correlation cell color
fn correlation_color(theme: &Theme, value: f64) -> (Hsla, Hsla) {
    if value >= 0.7 {
        (theme.positive.opacity(0.8), hsla(0.0, 0.0, 1.0, 1.0))
    } else if value >= 0.4 {
        (theme.positive.opacity(0.4), theme.text)
    } else if value >= 0.0 {
        (theme.positive.opacity(0.15), theme.text_secondary)
    } else if value >= -0.4 {
        (theme.negative.opacity(0.15), theme.text_secondary)
    } else if value >= -0.7 {
        (theme.negative.opacity(0.4), theme.text)
    } else {
        (theme.negative.opacity(0.8), hsla(0.0, 0.0, 1.0, 1.0))
    }
}

/// Correlation insights panel
fn render_correlation_insights(theme: &Theme) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .child(insight_row(
            theme,
            "Highest Correlation",
            "CL - BZ (Crude Oils)",
            0.95,
            "Brent and WTI move together",
        ))
        .child(insight_row(
            theme,
            "Lowest Correlation",
            "GC - ZC (Gold - Corn)",
            0.12,
            "Minimal relationship",
        ))
        .child(insight_row(
            theme,
            "Notable Inverse",
            "GC - DXY",
            -0.65,
            "Gold inversely tracks USD",
        ))
}

/// Insight row
fn insight_row(theme: &Theme, label: &str, pair: &str, corr: f64, desc: &str) -> impl IntoElement {
    let positive = corr >= 0.0;
    let color = if positive {
        theme.positive
    } else {
        theme.negative
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .py(px(10.0))
        .px(px(12.0))
        .rounded(px(6.0))
        .bg(theme.card_bg_elevated)
        .child(
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
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(pair.to_string()),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(color.opacity(0.15))
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(format!("{:+.2}", corr)),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.text_muted)
                        .max_w(px(150.0))
                        .child(desc.to_string()),
                ),
        )
}

// ============================================================================
// MACRO LINKAGES VIEW
// ============================================================================

fn render_macro_linkages(
    theme: &Theme,
    state: &CommoditiesState,
    _cx: &mut Context<impl Sized>,
) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_y_hidden()
        .child(match &state.macro_analysis {
            LoadState::Loading => loading_indicator(theme),
            LoadState::Error(e) => error_message(theme, e),
            LoadState::Loaded(analysis) => render_macro_analysis(theme, analysis),
            _ => render_macro_selector(theme),
        })
}

/// Commodity selector for macro analysis
fn render_macro_selector(theme: &Theme) -> Div {
    let common_commodities = [
        ("CL", "Crude Oil (WTI)"),
        ("GC", "Gold"),
        ("SI", "Silver"),
        ("HG", "Copper"),
        ("NG", "Natural Gas"),
        ("ZC", "Corn"),
        ("ZW", "Wheat"),
    ];

    div()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(
            div()
                .text_size(px(14.0))
                .text_color(theme.text_secondary)
                .child("Select a commodity to analyze macro linkages:"),
        )
        .child(
            div().flex().flex_wrap().gap(px(12.0)).children(
                common_commodities
                    .iter()
                    .map(|(sym, name)| {
                        div()
                            .px(px(16.0))
                            .py(px(12.0))
                            .rounded(px(8.0))
                            .bg(theme.card_bg)
                            .border_1()
                            .border_color(theme.border)
                            .cursor_pointer()
                            .hover(|s| s.border_color(theme.accent).bg(theme.card_bg_elevated))
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
                    })
                    .collect::<Vec<_>>(),
            ),
        )
}

/// Render macro analysis for selected commodity
fn render_macro_analysis(theme: &Theme, analysis: &MacroAnalysis) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(20.0))
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                .child(
                    div()
                        .size(px(40.0))
                        .rounded(px(10.0))
                        .bg(category_color(&analysis.category).opacity(0.15))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(18.0))
                        .child(category_icon(&analysis.category)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .child(
                            div()
                                .text_size(px(20.0))
                                .font_weight(FontWeight::BOLD)
                                .child(format!("{} - Macro Linkages", analysis.commodity)),
                        )
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_muted)
                                .child(analysis.name.clone()),
                        ),
                ),
        )
        // Primary driver
        .when_some(analysis.primary_driver.as_ref(), |d, driver| {
            d.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.text_muted)
                            .child("Primary Driver:"),
                    )
                    .child(
                        div()
                            .px(px(12.0))
                            .py(px(6.0))
                            .rounded(px(6.0))
                            .bg(theme.accent.opacity(0.15))
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.accent)
                            .child(driver.clone()),
                    ),
            )
        })
        // Linkages list
        .child(card(
            theme,
            "Macro-Commodity Relationships",
            div().flex().flex_col().gap(px(8.0)).children(
                analysis
                    .linkages
                    .iter()
                    .map(|link| render_linkage_row(theme, link))
                    .collect::<Vec<_>>(),
            ),
        ))
}

/// Render single macro linkage row
fn render_linkage_row(theme: &Theme, linkage: &MacroLinkage) -> impl IntoElement {
    let positive = linkage.correlation >= 0.0;
    let corr_color = if positive {
        theme.positive
    } else {
        theme.negative
    };

    let strength_color = match linkage.strength.as_str() {
        "strong" => theme.positive,
        "moderate" => theme.accent,
        _ => theme.text_muted,
    };

    let lead_lag_text = if linkage.lead_lag_days > 0 {
        format!("Commodity leads by {} days", linkage.lead_lag_days)
    } else if linkage.lead_lag_days < 0 {
        format!("Commodity lags by {} days", linkage.lead_lag_days.abs())
    } else {
        "Concurrent".to_string()
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .py(px(14.0))
        .px(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(linkage.macro_indicator.clone()),
                        )
                        .child(
                            div()
                                .px(px(6.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(strength_color.opacity(0.15))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(strength_color)
                                .child(linkage.strength.to_uppercase()),
                        ),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .child(linkage.relationship.clone()),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(lead_lag_text),
                ),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .items_end()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("Correlation"),
                )
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(corr_color.opacity(0.15))
                        .text_size(px(16.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(corr_color)
                        .child(format!("{:+.2}", linkage.correlation)),
                ),
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

/// Format category name for display
fn format_category_name(category: &str) -> String {
    match category {
        "energy" => "Energy".to_string(),
        "precious_metals" => "Precious Metals".to_string(),
        "base_metals" => "Base Metals".to_string(),
        "agriculture" => "Agriculture".to_string(),
        "softs" => "Softs".to_string(),
        "livestock" => "Livestock".to_string(),
        _ => category.to_string(),
    }
}

/// Get category icon
fn category_icon(category: &str) -> &'static str {
    match category {
        "energy" | "Energy" => "O",                   // Oil drop
        "precious_metals" | "Precious Metals" => "G", // Gold
        "base_metals" | "Base Metals" => "Cu",        // Copper
        "agriculture" | "Agriculture" => "W",         // Wheat
        "softs" | "Softs" => "C",                     // Coffee
        "livestock" | "Livestock" => "L",             // Livestock
        _ => "?",
    }
}

/// Get category color
fn category_color(category: &str) -> Hsla {
    match category {
        "energy" | "Energy" => hsla(0.08, 0.8, 0.5, 1.0), // Orange
        "precious_metals" | "Precious Metals" => hsla(0.14, 0.9, 0.6, 1.0), // Gold
        "base_metals" | "Base Metals" => hsla(0.55, 0.6, 0.5, 1.0), // Teal
        "agriculture" | "Agriculture" => hsla(0.33, 0.7, 0.45, 1.0), // Green
        "softs" | "Softs" => hsla(0.08, 0.6, 0.35, 1.0),  // Brown
        "livestock" | "Livestock" => hsla(0.0, 0.6, 0.5, 1.0), // Red
        _ => hsla(0.0, 0.0, 0.5, 1.0),                    // Gray
    }
}

/// Format commodity price with appropriate precision
fn format_commodity_price(price: f64, symbol: &str) -> String {
    // Different commodities have different price scales
    match symbol {
        // Large price commodities (Gold, Platinum, etc.)
        "GC" | "PL" | "PA" | "ZS" => format!("${:.2}", price),
        // Energy commodities
        "CL" | "BZ" | "HO" | "RB" => format!("${:.2}", price),
        // Natural gas (small price)
        "NG" => format!("${:.3}", price),
        // Metals per pound
        "HG" | "SI" => format!("${:.3}", price),
        // Grains (cents per bushel)
        "ZC" | "ZW" => format!("{:.1}c", price),
        // Default
        _ => format!("${:.2}", price),
    }
}

// ============================================================================
// COMMODITY WATCHLIST COMPONENT
// ============================================================================

/// Render commodity watchlist for sidebar
#[allow(dead_code)]
pub fn render_commodity_watchlist(
    theme: &Theme,
    commodities: &[CommodityPrice],
    selected: Option<&str>,
) -> impl IntoElement {
    div().flex().flex_col().gap(px(4.0)).children(
        commodities
            .iter()
            .map(|c| {
                let is_selected = selected.map(|s| s == c.symbol).unwrap_or(false);
                let positive = c.change_percent >= 0.0;
                let color = if positive {
                    theme.positive
                } else {
                    theme.negative
                };

                div()
                    .px(px(12.0))
                    .py(px(8.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .bg(if is_selected {
                        theme.accent_subtle
                    } else {
                        transparent_black()
                    })
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
                                    .text_color(if is_selected {
                                        theme.text
                                    } else {
                                        theme.text_secondary
                                    })
                                    .child(c.symbol.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_dimmed)
                                    .child(format!("${:.2}", c.price)),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(color)
                            .child(format!("{:+.1}%", c.change_percent)),
                    )
            })
            .collect::<Vec<_>>(),
    )
}

// ============================================================================
// MINI COMMODITY TICKER
// ============================================================================

/// Horizontal commodity ticker for dashboard
#[allow(dead_code)]
pub fn render_commodity_ticker(theme: &Theme, prices: &[CommodityPrice]) -> impl IntoElement {
    div()
        .h(px(36.0))
        .px(px(16.0))
        .flex()
        .items_center()
        .gap(px(24.0))
        .bg(theme.card_bg_elevated)
        .border_b_1()
        .border_color(theme.border_subtle)
        .overflow_x_hidden()
        .children(
            prices
                .iter()
                .map(|p| {
                    let positive = p.change_percent >= 0.0;
                    let color = if positive {
                        theme.positive
                    } else {
                        theme.negative
                    };

                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_secondary)
                                .child(p.symbol.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text)
                                .child(format!("${:.2}", p.price)),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(color)
                                .child(format!("{:+.2}%", p.change_percent)),
                        )
                })
                .collect::<Vec<_>>(),
        )
}
