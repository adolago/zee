//! Quick Actions Panel for Stanley GUI
//!
//! Provides predefined prompts for common tasks, recent queries history,
//! favorite queries bookmarking, and voice input placeholder.

use crate::components::modals::render_tooltip;
use crate::components::streaming::CatppuccinMocha;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

// =============================================================================
// Quick Action Types
// =============================================================================

/// Category of quick action
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionCategory {
    Market,
    Portfolio,
    Research,
    Institutional,
    Technical,
    Macro,
    Custom,
}

impl ActionCategory {
    pub fn label(&self) -> &'static str {
        match self {
            ActionCategory::Market => "Market",
            ActionCategory::Portfolio => "Portfolio",
            ActionCategory::Research => "Research",
            ActionCategory::Institutional => "Institutional",
            ActionCategory::Technical => "Technical",
            ActionCategory::Macro => "Macro",
            ActionCategory::Custom => "Custom",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            ActionCategory::Market => CatppuccinMocha::blue(),
            ActionCategory::Portfolio => CatppuccinMocha::green(),
            ActionCategory::Research => CatppuccinMocha::mauve(),
            ActionCategory::Institutional => CatppuccinMocha::peach(),
            ActionCategory::Technical => CatppuccinMocha::teal(),
            ActionCategory::Macro => CatppuccinMocha::yellow(),
            ActionCategory::Custom => CatppuccinMocha::pink(),
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            ActionCategory::Market => "M",
            ActionCategory::Portfolio => "P",
            ActionCategory::Research => "R",
            ActionCategory::Institutional => "I",
            ActionCategory::Technical => "T",
            ActionCategory::Macro => "E",
            ActionCategory::Custom => "*",
        }
    }

    pub fn all() -> &'static [ActionCategory] {
        &[
            ActionCategory::Market,
            ActionCategory::Portfolio,
            ActionCategory::Research,
            ActionCategory::Institutional,
            ActionCategory::Technical,
            ActionCategory::Macro,
        ]
    }
}

/// A quick action / predefined prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickAction {
    /// Unique identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// The prompt template (may contain {symbol} placeholder)
    pub prompt: String,
    /// Category
    pub category: ActionCategory,
    /// Description
    pub description: String,
    /// Icon (single character)
    pub icon: String,
    /// Whether this requires a symbol
    pub requires_symbol: bool,
    /// Usage count (for sorting by popularity)
    pub usage_count: u32,
}

impl QuickAction {
    /// Create the final prompt, substituting symbol if needed
    pub fn build_prompt(&self, symbol: Option<&str>) -> String {
        if self.requires_symbol {
            if let Some(s) = symbol {
                self.prompt.replace("{symbol}", s)
            } else {
                self.prompt.replace("{symbol}", "AAPL") // Default fallback
            }
        } else {
            self.prompt.clone()
        }
    }
}

/// A recent query entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentQuery {
    /// The query text
    pub query: String,
    /// Timestamp (ISO format)
    pub timestamp: String,
    /// Symbol context if any
    pub symbol: Option<String>,
    /// Whether this is bookmarked
    pub is_favorite: bool,
}

impl RecentQuery {
    pub fn new(query: String, symbol: Option<String>) -> Self {
        Self {
            query,
            timestamp: chrono_now(),
            symbol,
            is_favorite: false,
        }
    }
}

// =============================================================================
// Quick Actions State
// =============================================================================

/// State for quick actions panel
#[derive(Debug, Clone)]
pub struct QuickActionsState {
    /// Available quick actions
    pub actions: Vec<QuickAction>,
    /// Recent queries (most recent first)
    pub recent_queries: VecDeque<RecentQuery>,
    /// Maximum number of recent queries to keep
    pub max_recent: usize,
    /// Favorite queries (bookmarked)
    pub favorites: Vec<RecentQuery>,
    /// Currently selected category filter
    pub selected_category: Option<ActionCategory>,
    /// Search filter for actions
    pub search_filter: String,
    /// Whether the panel is expanded
    pub is_expanded: bool,
    /// Currently hovered action
    pub hovered_action: Option<String>,
    /// Voice input state
    pub voice_input_enabled: bool,
    pub voice_input_active: bool,
}

impl Default for QuickActionsState {
    fn default() -> Self {
        Self {
            actions: Self::default_actions(),
            recent_queries: VecDeque::with_capacity(20),
            max_recent: 20,
            favorites: Vec::new(),
            selected_category: None,
            search_filter: String::new(),
            is_expanded: false,
            hovered_action: None,
            voice_input_enabled: false, // Placeholder for future
            voice_input_active: false,
        }
    }
}

impl QuickActionsState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get default quick actions
    fn default_actions() -> Vec<QuickAction> {
        vec![
            // Market Actions
            QuickAction {
                id: "market-overview".to_string(),
                name: "Market Overview".to_string(),
                prompt: "Give me a comprehensive market overview including major indices, sector performance, and notable movers.".to_string(),
                category: ActionCategory::Market,
                description: "Get current market conditions".to_string(),
                icon: "M".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            QuickAction {
                id: "sector-rotation".to_string(),
                name: "Sector Rotation".to_string(),
                prompt: "Analyze current sector rotation trends and identify which sectors are leading or lagging.".to_string(),
                category: ActionCategory::Market,
                description: "Sector rotation analysis".to_string(),
                icon: "S".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            QuickAction {
                id: "stock-summary".to_string(),
                name: "Stock Summary".to_string(),
                prompt: "Provide a comprehensive summary of {symbol} including price, fundamentals, and recent news.".to_string(),
                category: ActionCategory::Market,
                description: "Quick stock overview".to_string(),
                icon: "$".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            // Portfolio Actions
            QuickAction {
                id: "portfolio-risk".to_string(),
                name: "Portfolio Risk".to_string(),
                prompt: "Analyze my portfolio's risk metrics including VaR, beta, and sector concentration.".to_string(),
                category: ActionCategory::Portfolio,
                description: "Portfolio risk analysis".to_string(),
                icon: "R".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            QuickAction {
                id: "portfolio-optimization".to_string(),
                name: "Optimize Portfolio".to_string(),
                prompt: "Suggest optimizations for my portfolio to improve risk-adjusted returns.".to_string(),
                category: ActionCategory::Portfolio,
                description: "Get optimization suggestions".to_string(),
                icon: "O".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            QuickAction {
                id: "rebalance-check".to_string(),
                name: "Rebalance Check".to_string(),
                prompt: "Check if my portfolio needs rebalancing based on target allocations.".to_string(),
                category: ActionCategory::Portfolio,
                description: "Check rebalancing needs".to_string(),
                icon: "B".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            // Research Actions
            QuickAction {
                id: "full-research".to_string(),
                name: "Full Research".to_string(),
                prompt: "Provide a full research report on {symbol} including fundamentals, technicals, and investment thesis.".to_string(),
                category: ActionCategory::Research,
                description: "Comprehensive research report".to_string(),
                icon: "R".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            QuickAction {
                id: "valuation-analysis".to_string(),
                name: "Valuation".to_string(),
                prompt: "Analyze the valuation of {symbol} using multiple methods including DCF, comparables, and historical ranges.".to_string(),
                category: ActionCategory::Research,
                description: "Detailed valuation analysis".to_string(),
                icon: "V".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            QuickAction {
                id: "earnings-preview".to_string(),
                name: "Earnings Preview".to_string(),
                prompt: "Preview upcoming earnings for {symbol} including estimates, historical surprises, and key metrics to watch.".to_string(),
                category: ActionCategory::Research,
                description: "Earnings preview and estimates".to_string(),
                icon: "E".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            // Institutional Actions
            QuickAction {
                id: "institutional-activity".to_string(),
                name: "Institutional Activity".to_string(),
                prompt: "Show recent institutional activity in {symbol} including 13F filings, notable buyers/sellers.".to_string(),
                category: ActionCategory::Institutional,
                description: "Track institutional moves".to_string(),
                icon: "I".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            QuickAction {
                id: "smart-money".to_string(),
                name: "Smart Money Flow".to_string(),
                prompt: "Analyze smart money flow for {symbol} including dark pool activity and block trades.".to_string(),
                category: ActionCategory::Institutional,
                description: "Smart money analysis".to_string(),
                icon: "S".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            QuickAction {
                id: "ownership-changes".to_string(),
                name: "Ownership Changes".to_string(),
                prompt: "Show recent ownership changes for {symbol} from latest 13F and 13D filings.".to_string(),
                category: ActionCategory::Institutional,
                description: "Recent ownership changes".to_string(),
                icon: "O".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            // Technical Actions
            QuickAction {
                id: "technical-analysis".to_string(),
                name: "Technical Analysis".to_string(),
                prompt: "Provide technical analysis for {symbol} including trend, support/resistance, and indicators.".to_string(),
                category: ActionCategory::Technical,
                description: "Technical chart analysis".to_string(),
                icon: "T".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            QuickAction {
                id: "key-levels".to_string(),
                name: "Key Levels".to_string(),
                prompt: "Identify key technical levels for {symbol} including support, resistance, and pivot points.".to_string(),
                category: ActionCategory::Technical,
                description: "Support and resistance".to_string(),
                icon: "L".to_string(),
                requires_symbol: true,
                usage_count: 0,
            },
            QuickAction {
                id: "momentum-scan".to_string(),
                name: "Momentum Scan".to_string(),
                prompt: "Scan for stocks showing strong momentum with RSI, MACD, and volume confirmation.".to_string(),
                category: ActionCategory::Technical,
                description: "Find momentum stocks".to_string(),
                icon: "M".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            // Macro Actions
            QuickAction {
                id: "macro-outlook".to_string(),
                name: "Macro Outlook".to_string(),
                prompt: "Provide a macro economic outlook including GDP, inflation, and Fed policy expectations.".to_string(),
                category: ActionCategory::Macro,
                description: "Economic outlook".to_string(),
                icon: "E".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            QuickAction {
                id: "fed-watch".to_string(),
                name: "Fed Watch".to_string(),
                prompt: "Analyze current Fed policy stance, rate expectations, and upcoming FOMC meetings.".to_string(),
                category: ActionCategory::Macro,
                description: "Federal Reserve analysis".to_string(),
                icon: "F".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
            QuickAction {
                id: "economic-calendar".to_string(),
                name: "Economic Calendar".to_string(),
                prompt: "Show upcoming economic events and data releases for the next week.".to_string(),
                category: ActionCategory::Macro,
                description: "Upcoming economic events".to_string(),
                icon: "C".to_string(),
                requires_symbol: false,
                usage_count: 0,
            },
        ]
    }

    /// Add a query to recent history
    pub fn add_recent_query(&mut self, query: String, symbol: Option<String>) {
        // Remove if already exists (to move to front)
        self.recent_queries.retain(|q| q.query != query);

        // Add to front
        self.recent_queries
            .push_front(RecentQuery::new(query, symbol));

        // Trim to max size
        while self.recent_queries.len() > self.max_recent {
            self.recent_queries.pop_back();
        }
    }

    /// Toggle favorite status of a recent query
    pub fn toggle_favorite(&mut self, query: &str) {
        // Check if in recent
        if let Some(recent) = self.recent_queries.iter_mut().find(|q| q.query == query) {
            recent.is_favorite = !recent.is_favorite;
            if recent.is_favorite {
                self.favorites.push(recent.clone());
            } else {
                self.favorites.retain(|f| f.query != query);
            }
        }
    }

    /// Get filtered actions based on current state
    pub fn get_filtered_actions(&self) -> Vec<&QuickAction> {
        self.actions
            .iter()
            .filter(|action| {
                // Category filter
                if let Some(cat) = self.selected_category {
                    if action.category != cat {
                        return false;
                    }
                }
                // Search filter
                if !self.search_filter.is_empty() {
                    let search = self.search_filter.to_lowercase();
                    if !action.name.to_lowercase().contains(&search)
                        && !action.description.to_lowercase().contains(&search)
                    {
                        return false;
                    }
                }
                true
            })
            .collect()
    }

    /// Increment usage count for an action
    pub fn record_usage(&mut self, action_id: &str) {
        if let Some(action) = self.actions.iter_mut().find(|a| a.id == action_id) {
            action.usage_count += 1;
        }
    }

    /// Get most used actions
    pub fn get_popular_actions(&self, limit: usize) -> Vec<&QuickAction> {
        let mut sorted: Vec<_> = self.actions.iter().collect();
        sorted.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
        sorted.into_iter().take(limit).collect()
    }

    /// Set category filter
    pub fn set_category_filter(&mut self, category: Option<ActionCategory>) {
        self.selected_category = category;
    }

    /// Set search filter
    pub fn set_search_filter(&mut self, filter: String) {
        self.search_filter = filter;
    }

    /// Toggle panel expansion
    pub fn toggle_expanded(&mut self) {
        self.is_expanded = !self.is_expanded;
    }

    /// Clear recent queries
    pub fn clear_recent(&mut self) {
        self.recent_queries.clear();
    }
}

// =============================================================================
// Rendering
// =============================================================================

/// Render the quick actions panel (compact mode)
pub fn render_quick_actions_compact<F>(
    theme: &Theme,
    state: &QuickActionsState,
    current_symbol: Option<&str>,
    on_action: F,
) -> Div
where
    F: Fn(String) + Clone + 'static,
{
    let popular = state.get_popular_actions(4);

    div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .p(px(8.0))
        // Popular actions
        .children(popular.iter().map(|action| {
            let callback = on_action.clone();
            let prompt = action.build_prompt(current_symbol);
            render_compact_action_button(theme, action, move || {
                callback(prompt.clone());
            })
        }))
        // More button
        .child(
            div()
                .id("more-actions")
                .px(px(10.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(CatppuccinMocha::surface0())
                .border_1()
                .border_color(CatppuccinMocha::surface1())
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface1()))
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::subtext0())
                        .child("More..."),
                ),
        )
}

/// Render a compact action button
fn render_compact_action_button<F>(
    _theme: &Theme,
    action: &QuickAction,
    on_click: F,
) -> impl IntoElement
where
    F: Fn() + 'static,
{
    let color = action.category.color();

    div()
        .id(action.id.clone())
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(color.opacity(0.12))
        .border_1()
        .border_color(color.opacity(0.25))
        .cursor_pointer()
        .hover(|s| s.bg(color.opacity(0.20)))
        .on_click(move |_event, _window, _cx| {
            on_click();
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(action.icon.clone()),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::text())
                        .child(action.name.clone()),
                ),
        )
}

/// Render the full quick actions panel (expanded mode)
pub fn render_quick_actions_full<F>(
    theme: &Theme,
    state: &QuickActionsState,
    current_symbol: Option<&str>,
    on_action: F,
    on_close: impl Fn() + 'static,
) -> Div
where
    F: Fn(String) + Clone + 'static,
{
    div()
        .w(px(400.0))
        .max_h(px(500.0))
        .flex()
        .flex_col()
        .bg(CatppuccinMocha::mantle())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .rounded(px(12.0))
        .shadow_lg()
        .overflow_hidden()
        // Header
        .child(render_panel_header(theme, state, on_close))
        // Category tabs
        .child(render_category_tabs(theme, state))
        // Actions grid
        .child(render_actions_grid(
            theme,
            state,
            current_symbol,
            on_action.clone(),
        ))
        // Recent queries
        .child(render_recent_queries(theme, state, on_action))
}

/// Render panel header
fn render_panel_header(
    theme: &Theme,
    _state: &QuickActionsState,
    on_close: impl Fn() + 'static,
) -> Div {
    div()
        .px(px(16.0))
        .py(px(12.0))
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .child(
                    div()
                        .size(px(24.0))
                        .rounded(px(6.0))
                        .bg(CatppuccinMocha::blue().opacity(0.2))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(CatppuccinMocha::blue())
                                .child(">"),
                        ),
                )
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::text())
                        .child("Quick Actions"),
                ),
        )
        .child(
            div()
                .id("close-quick-actions")
                .group("qa-close-btn")
                .relative()
                .size(px(24.0))
                .rounded(px(4.0))
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface1()))
                .flex()
                .items_center()
                .justify_center()
                .on_click(move |_event, _window, _cx| {
                    on_close();
                })
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(CatppuccinMocha::overlay1())
                        .child("x"),
                )
                .child(
                    div()
                        .absolute()
                        .top(px(28.0))
                        .right(px(0.0))
                        .child(render_tooltip(theme, "Close (Esc)", "qa-close-btn")),
                ),
        )
}

/// Render category filter tabs
fn render_category_tabs(_theme: &Theme, state: &QuickActionsState) -> impl IntoElement {
    div()
        .id("category-tabs-scroll")
        .px(px(12.0))
        .py(px(8.0))
        .flex()
        .items_center()
        .gap(px(4.0))
        .overflow_x_scroll()
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        // All tab
        .child({
            let is_selected = state.selected_category.is_none();
            div()
                .id("category-all")
                .px(px(10.0))
                .py(px(5.0))
                .rounded(px(6.0))
                .bg(if is_selected {
                    CatppuccinMocha::surface1()
                } else {
                    CatppuccinMocha::surface0().opacity(0.0)
                })
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface0()))
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(if is_selected {
                            CatppuccinMocha::text()
                        } else {
                            CatppuccinMocha::subtext0()
                        })
                        .child("All"),
                )
        })
        // Category tabs
        .children(ActionCategory::all().iter().map(|cat| {
            let is_selected = state.selected_category == Some(*cat);
            div()
                .id(format!("category-{}", cat.label().to_lowercase()))
                .px(px(10.0))
                .py(px(5.0))
                .rounded(px(6.0))
                .bg(if is_selected {
                    cat.color().opacity(0.2)
                } else {
                    CatppuccinMocha::surface0().opacity(0.0)
                })
                .cursor_pointer()
                .hover(|s| s.bg(cat.color().opacity(0.1)))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(9.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(cat.color())
                                .child(cat.icon()),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(if is_selected {
                                    CatppuccinMocha::text()
                                } else {
                                    CatppuccinMocha::subtext0()
                                })
                                .child(cat.label()),
                        ),
                )
        }))
}

/// Render actions grid
fn render_actions_grid<F>(
    theme: &Theme,
    state: &QuickActionsState,
    current_symbol: Option<&str>,
    on_action: F,
) -> impl IntoElement
where
    F: Fn(String) + Clone + 'static,
{
    let filtered = state.get_filtered_actions();

    div()
        .id("actions-grid-scroll")
        .flex_grow()
        .overflow_y_scroll()
        .p(px(12.0))
        .child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(8.0))
                .children(filtered.iter().map(|action| {
                    let callback = on_action.clone();
                    let prompt = action.build_prompt(current_symbol);
                    render_action_card(theme, action, move || {
                        callback(prompt.clone());
                    })
                })),
        )
}

/// Render an action card
fn render_action_card<F>(_theme: &Theme, action: &QuickAction, on_click: F) -> impl IntoElement
where
    F: Fn() + 'static,
{
    let color = action.category.color();

    div()
        .id(action.id.clone())
        .w(px(180.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .cursor_pointer()
        .hover(|s| {
            s.bg(CatppuccinMocha::surface1())
                .border_color(color.opacity(0.5))
        })
        .on_click(move |_event, _window, _cx| {
            on_click();
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                // Header
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .size(px(24.0))
                                .rounded(px(6.0))
                                .bg(color.opacity(0.2))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(color)
                                        .child(action.icon.clone()),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(CatppuccinMocha::text())
                                .child(action.name.clone()),
                        ),
                )
                // Description
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::subtext0())
                        .child(action.description.clone()),
                )
                // Requires symbol indicator
                .when(action.requires_symbol, |el| {
                    el.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .size(px(4.0))
                                    .rounded_full()
                                    .bg(CatppuccinMocha::yellow()),
                            )
                            .child(
                                div()
                                    .text_size(px(9.0))
                                    .text_color(CatppuccinMocha::overlay1())
                                    .child("Requires symbol"),
                            ),
                    )
                }),
        )
}

/// Render recent queries section
fn render_recent_queries<F>(theme: &Theme, state: &QuickActionsState, on_action: F) -> Div
where
    F: Fn(String) + Clone + 'static,
{
    div()
        .border_t_1()
        .border_color(CatppuccinMocha::surface0())
        .px(px(12.0))
        .py(px(10.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::subtext0())
                        .child("Recent Queries"),
                )
                .child(
                    div()
                        .id("clear-recent")
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay1())
                        .cursor_pointer()
                        .hover(|s| s.text_color(CatppuccinMocha::text()))
                        .child("Clear"),
                ),
        )
        // Recent items
        .when(!state.recent_queries.is_empty(), |el| {
            el.child(div().flex().flex_col().gap(px(4.0)).children(
                state.recent_queries.iter().take(5).map(|query| {
                    let callback = on_action.clone();
                    let query_text = query.query.clone();
                    render_recent_query_item(theme, query, move || {
                        callback(query_text.clone());
                    })
                }),
            ))
        })
        .when(state.recent_queries.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(11.0))
                    .text_color(CatppuccinMocha::overlay0())
                    .italic()
                    .child("No recent queries"),
            )
        })
}

/// Render a recent query item
fn render_recent_query_item<F>(_theme: &Theme, query: &RecentQuery, on_click: F) -> impl IntoElement
where
    F: Fn() + 'static,
{
    div()
        .id(format!("recent-{}", query.timestamp))
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(CatppuccinMocha::surface0().opacity(0.5))
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface0()))
        .on_click(move |_event, _window, _cx| {
            on_click();
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Favorite indicator
                        .when(query.is_favorite, |el| {
                            el.child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::yellow())
                                    .child("*"),
                            )
                        })
                        // Query text (truncated)
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(CatppuccinMocha::subtext1())
                                .max_w(px(250.0))
                                .overflow_hidden()
                                .child(truncate_text(&query.query, 40)),
                        ),
                )
                // Symbol badge if present
                .when_some(query.symbol.clone(), |el, symbol| {
                    el.child(
                        div()
                            .px(px(6.0))
                            .py(px(2.0))
                            .rounded(px(4.0))
                            .bg(CatppuccinMocha::blue().opacity(0.15))
                            .text_size(px(9.0))
                            .text_color(CatppuccinMocha::blue())
                            .child(symbol),
                    )
                }),
        )
}

/// Render voice input button (placeholder)
#[allow(dead_code)]
pub fn render_voice_input_button(_theme: &Theme, is_active: bool) -> impl IntoElement {
    div()
        .id("voice-input")
        .size(px(36.0))
        .rounded_full()
        .bg(if is_active {
            CatppuccinMocha::red().opacity(0.3)
        } else {
            CatppuccinMocha::surface1()
        })
        .border_1()
        .border_color(if is_active {
            CatppuccinMocha::red()
        } else {
            CatppuccinMocha::surface2()
        })
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface2()))
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(14.0))
                .text_color(if is_active {
                    CatppuccinMocha::red()
                } else {
                    CatppuccinMocha::subtext0()
                })
                .child(if is_active { "||" } else { "M" }), // Mic icon placeholder
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Get current timestamp
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", now.as_secs())
}

/// Truncate text with ellipsis
fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len.saturating_sub(3)])
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quick_action_build_prompt() {
        let action = QuickAction {
            id: "test".to_string(),
            name: "Test".to_string(),
            prompt: "Analyze {symbol} for trends".to_string(),
            category: ActionCategory::Market,
            description: "Test action".to_string(),
            icon: "T".to_string(),
            requires_symbol: true,
            usage_count: 0,
        };

        let prompt = action.build_prompt(Some("AAPL"));
        assert_eq!(prompt, "Analyze AAPL for trends");
    }

    #[test]
    fn test_quick_actions_state() {
        let mut state = QuickActionsState::new();
        assert!(!state.actions.is_empty());

        state.add_recent_query("Test query".to_string(), Some("AAPL".to_string()));
        assert_eq!(state.recent_queries.len(), 1);
        assert_eq!(state.recent_queries[0].query, "Test query");
    }

    #[test]
    fn test_category_filter() {
        let mut state = QuickActionsState::new();
        state.set_category_filter(Some(ActionCategory::Market));

        let filtered = state.get_filtered_actions();
        assert!(filtered
            .iter()
            .all(|a| a.category == ActionCategory::Market));
    }

    #[test]
    fn test_toggle_favorite() {
        let mut state = QuickActionsState::new();
        state.add_recent_query("Favorite query".to_string(), None);

        state.toggle_favorite("Favorite query");
        assert!(state.recent_queries[0].is_favorite);
        assert_eq!(state.favorites.len(), 1);

        state.toggle_favorite("Favorite query");
        assert!(!state.recent_queries[0].is_favorite);
        assert!(state.favorites.is_empty());
    }
}
