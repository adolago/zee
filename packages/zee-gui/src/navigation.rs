//! Enhanced navigation system for Stanley GUI
//!
//! Provides a hierarchical navigation structure with:
//! - Grouped sections (Markets, Analytics, Research, etc.)
//! - Keyboard shortcuts (1-9 for views, Cmd+K for search)
//! - View history and breadcrumbs
//! - Multi-symbol tabs
//! - Symbol search with autocomplete
//! - Favorites and quick access

use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use std::collections::VecDeque;

// =============================================================================
// View System
// =============================================================================

/// All available views organized by category
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum View {
    // Markets & Overview
    #[default]
    Dashboard,
    Watchlist,

    // Flow Analytics
    MoneyFlow,
    EquityFlow,
    DarkPool,

    // Institutional
    Institutional,
    ThirteenF,

    // Options
    OptionsFlow,
    OptionsGamma,
    OptionsUnusual,
    MaxPain,

    // Research
    Research,
    Valuation,
    Earnings,
    Peers,

    // Portfolio
    Portfolio,
    PortfolioRisk,
    Sectors,

    // Macro & Commodities
    Macro,
    Commodities,
    CommodityCorrelations,

    // ETF Analytics
    ETFOverview,
    ETFFlows,
    SectorRotation,
    FactorRotation,
    Thematic,

    // Accounting & Filings
    Accounting,
    FinancialStatements,
    EarningsQuality,
    RedFlags,

    // Signals & Alerts
    Signals,
    SignalBacktest,
    SignalPerformance,

    // Notes & Research
    Notes,
    Theses,
    Trades,
    Events,

    // Comparison
    Comparison,

    // Settings
    Settings,
    Preferences,
    ApiConfig,
    Appearance,

    // System
    Observability,
}

impl View {
    /// Get the display name for the view
    pub fn label(&self) -> &'static str {
        match self {
            View::Dashboard => "Dashboard",
            View::Watchlist => "Watchlist",
            View::MoneyFlow => "Sector Flow",
            View::EquityFlow => "Equity Flow",
            View::DarkPool => "Dark Pool",
            View::Institutional => "Institutional",
            View::ThirteenF => "13F Filings",
            View::OptionsFlow => "Options Flow",
            View::OptionsGamma => "Gamma Exposure",
            View::OptionsUnusual => "Unusual Activity",
            View::MaxPain => "Max Pain",
            View::Research => "Research",
            View::Valuation => "Valuation",
            View::Earnings => "Earnings",
            View::Peers => "Peer Analysis",
            View::Portfolio => "Portfolio",
            View::PortfolioRisk => "Risk Analysis",
            View::Sectors => "Sector Exposure",
            View::Macro => "Macro",
            View::Commodities => "Commodities",
            View::CommodityCorrelations => "Correlations",
            View::ETFOverview => "ETF Overview",
            View::ETFFlows => "ETF Flows",
            View::SectorRotation => "Sector Rotation",
            View::FactorRotation => "Factor Rotation",
            View::Thematic => "Thematic",
            View::Accounting => "Accounting",
            View::FinancialStatements => "Financials",
            View::EarningsQuality => "Quality Score",
            View::RedFlags => "Red Flags",
            View::Signals => "Signals",
            View::SignalBacktest => "Backtest",
            View::SignalPerformance => "Performance",
            View::Notes => "Notes",
            View::Theses => "Theses",
            View::Trades => "Trade Log",
            View::Events => "Events",
            View::Comparison => "Comparison",
            View::Settings => "Settings",
            View::Preferences => "Preferences",
            View::ApiConfig => "API Config",
            View::Appearance => "Appearance",
            View::Observability => "Observability",
        }
    }

    /// Get the keyboard shortcut number (1-9, 0 for settings)
    pub fn shortcut(&self) -> Option<char> {
        match self {
            View::Dashboard => Some('1'),
            View::MoneyFlow => Some('2'),
            View::Institutional => Some('3'),
            View::DarkPool => Some('4'),
            View::OptionsFlow => Some('5'),
            View::Research => Some('6'),
            View::Portfolio => Some('7'),
            View::Signals => Some('8'),
            View::Notes => Some('9'),
            View::Settings => Some('0'),
            _ => None,
        }
    }

    /// Get the icon character for the view
    pub fn icon(&self) -> &'static str {
        match self {
            View::Dashboard => "D",
            View::Watchlist => "W",
            View::MoneyFlow | View::EquityFlow => "F",
            View::DarkPool => "P",
            View::Institutional | View::ThirteenF => "I",
            View::OptionsFlow | View::OptionsGamma | View::OptionsUnusual | View::MaxPain => "O",
            View::Research | View::Valuation | View::Earnings | View::Peers => "R",
            View::Portfolio | View::PortfolioRisk | View::Sectors => "P",
            View::Macro | View::Commodities | View::CommodityCorrelations => "M",
            View::ETFOverview | View::ETFFlows | View::SectorRotation | View::FactorRotation | View::Thematic => "E",
            View::Accounting | View::FinancialStatements | View::EarningsQuality | View::RedFlags => "A",
            View::Signals | View::SignalBacktest | View::SignalPerformance => "S",
            View::Notes | View::Theses | View::Trades | View::Events => "N",
            View::Comparison => "C",
            View::Settings | View::Preferences | View::ApiConfig | View::Appearance => "*",
            View::Observability => "O",
        }
    }

    /// Get all views for iteration
    pub fn all() -> &'static [View] {
        &[
            View::Dashboard,
            View::Watchlist,
            View::MoneyFlow,
            View::EquityFlow,
            View::DarkPool,
            View::Institutional,
            View::ThirteenF,
            View::OptionsFlow,
            View::OptionsGamma,
            View::OptionsUnusual,
            View::MaxPain,
            View::Research,
            View::Valuation,
            View::Earnings,
            View::Peers,
            View::Portfolio,
            View::PortfolioRisk,
            View::Sectors,
            View::Macro,
            View::Commodities,
            View::CommodityCorrelations,
            View::ETFOverview,
            View::ETFFlows,
            View::SectorRotation,
            View::FactorRotation,
            View::Thematic,
            View::Accounting,
            View::FinancialStatements,
            View::EarningsQuality,
            View::RedFlags,
            View::Signals,
            View::SignalBacktest,
            View::SignalPerformance,
            View::Notes,
            View::Theses,
            View::Trades,
            View::Events,
            View::Comparison,
            View::Settings,
            View::Preferences,
            View::ApiConfig,
            View::Appearance,
            View::Observability,
        ]
    }
}

/// Navigation section grouping related views
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavSection {
    Markets,
    FlowAnalytics,
    Institutional,
    Options,
    Research,
    Portfolio,
    Macro,
    ETF,
    Accounting,
    Signals,
    Notes,
    Settings,
    System,
}

impl NavSection {
    pub fn label(&self) -> &'static str {
        match self {
            NavSection::Markets => "MARKETS",
            NavSection::FlowAnalytics => "FLOW ANALYTICS",
            NavSection::Institutional => "INSTITUTIONAL",
            NavSection::Options => "OPTIONS",
            NavSection::Research => "RESEARCH",
            NavSection::Portfolio => "PORTFOLIO",
            NavSection::Macro => "MACRO",
            NavSection::ETF => "ETF ANALYTICS",
            NavSection::Accounting => "ACCOUNTING",
            NavSection::Signals => "SIGNALS",
            NavSection::Notes => "NOTES",
            NavSection::Settings => "SETTINGS",
            NavSection::System => "SYSTEM",
        }
    }

    pub fn views(&self) -> &'static [View] {
        match self {
            NavSection::Markets => &[View::Dashboard, View::Watchlist],
            NavSection::FlowAnalytics => &[View::MoneyFlow, View::EquityFlow, View::DarkPool],
            NavSection::Institutional => &[View::Institutional, View::ThirteenF],
            NavSection::Options => &[View::OptionsFlow, View::OptionsGamma, View::OptionsUnusual, View::MaxPain],
            NavSection::Research => &[View::Research, View::Valuation, View::Earnings, View::Peers],
            NavSection::Portfolio => &[View::Portfolio, View::PortfolioRisk, View::Sectors],
            NavSection::Macro => &[View::Macro, View::Commodities, View::CommodityCorrelations],
            NavSection::ETF => &[View::ETFOverview, View::ETFFlows, View::SectorRotation, View::FactorRotation, View::Thematic],
            NavSection::Accounting => &[View::Accounting, View::FinancialStatements, View::EarningsQuality, View::RedFlags],
            NavSection::Signals => &[View::Signals, View::SignalBacktest, View::SignalPerformance],
            NavSection::Notes => &[View::Notes, View::Theses, View::Trades, View::Events],
            NavSection::Settings => &[View::Settings, View::Preferences, View::ApiConfig, View::Appearance],
            NavSection::System => &[View::Observability],
        }
    }

    /// All sections in display order
    pub fn all() -> &'static [NavSection] {
        &[
            NavSection::Markets,
            NavSection::FlowAnalytics,
            NavSection::Institutional,
            NavSection::Options,
            NavSection::Research,
            NavSection::Portfolio,
            NavSection::Macro,
            NavSection::ETF,
            NavSection::Accounting,
            NavSection::Signals,
            NavSection::Notes,
            NavSection::Settings,
            NavSection::System,
        ]
    }
}

// =============================================================================
// Symbol Tab System
// =============================================================================

/// A tab representing an open symbol analysis
#[derive(Debug, Clone)]
pub struct SymbolTab {
    pub symbol: String,
    pub view: View,
    pub is_pinned: bool,
}

impl SymbolTab {
    pub fn new(symbol: String, view: View) -> Self {
        Self {
            symbol,
            view,
            is_pinned: false,
        }
    }
}

// =============================================================================
// View History
// =============================================================================

/// Maintains history of visited views for back/forward navigation
#[derive(Debug, Clone, Default)]
pub struct ViewHistory {
    history: VecDeque<(View, String)>, // (view, symbol)
    current_index: usize,
    max_size: usize,
}

impl ViewHistory {
    pub fn new() -> Self {
        Self {
            history: VecDeque::new(),
            current_index: 0,
            max_size: 50,
        }
    }

    pub fn push(&mut self, view: View, symbol: String) {
        // Remove any forward history
        while self.history.len() > self.current_index + 1 {
            self.history.pop_back();
        }

        // Add new entry
        self.history.push_back((view, symbol));

        // Trim to max size
        while self.history.len() > self.max_size {
            self.history.pop_front();
        }

        self.current_index = self.history.len().saturating_sub(1);
    }

    pub fn can_go_back(&self) -> bool {
        self.current_index > 0
    }

    pub fn can_go_forward(&self) -> bool {
        self.current_index + 1 < self.history.len()
    }

    pub fn go_back(&mut self) -> Option<(View, String)> {
        if self.can_go_back() {
            self.current_index -= 1;
            self.history.get(self.current_index).cloned()
        } else {
            None
        }
    }

    pub fn go_forward(&mut self) -> Option<(View, String)> {
        if self.can_go_forward() {
            self.current_index += 1;
            self.history.get(self.current_index).cloned()
        } else {
            None
        }
    }

    pub fn current(&self) -> Option<&(View, String)> {
        self.history.get(self.current_index)
    }

    /// Get recent history entries for display
    pub fn recent(&self, count: usize) -> Vec<(View, String)> {
        self.history
            .iter()
            .rev()
            .take(count)
            .cloned()
            .collect()
    }
}

// =============================================================================
// Navigation State
// =============================================================================

/// Complete navigation state
#[derive(Debug, Clone)]
pub struct NavigationState {
    pub active_view: View,
    pub active_symbol: String,
    pub expanded_sections: Vec<NavSection>,
    pub favorites: Vec<View>,
    pub symbol_tabs: Vec<SymbolTab>,
    pub active_tab_index: usize,
    pub history: ViewHistory,
    pub search_query: String,
    pub search_results: Vec<String>,
    pub show_search: bool,
    pub show_command_palette: bool,
}

impl Default for NavigationState {
    fn default() -> Self {
        Self {
            active_view: View::Dashboard,
            active_symbol: "AAPL".to_string(),
            expanded_sections: vec![
                NavSection::Markets,
                NavSection::FlowAnalytics,
                NavSection::Research,
            ],
            favorites: vec![
                View::Dashboard,
                View::MoneyFlow,
                View::Institutional,
                View::Research,
            ],
            symbol_tabs: vec![SymbolTab::new("AAPL".to_string(), View::Dashboard)],
            active_tab_index: 0,
            history: ViewHistory::new(),
            search_query: String::new(),
            search_results: Vec::new(),
            show_search: false,
            show_command_palette: false,
        }
    }
}

impl NavigationState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_view(&mut self, view: View) {
        self.active_view = view;
        self.history.push(view, self.active_symbol.clone());
    }

    pub fn set_symbol(&mut self, symbol: String) {
        if self.active_symbol != symbol {
            self.active_symbol = symbol.clone();
            self.history.push(self.active_view, symbol);
        }
    }

    pub fn toggle_section(&mut self, section: NavSection) {
        if let Some(pos) = self.expanded_sections.iter().position(|s| *s == section) {
            self.expanded_sections.remove(pos);
        } else {
            self.expanded_sections.push(section);
        }
    }

    pub fn is_section_expanded(&self, section: NavSection) -> bool {
        self.expanded_sections.contains(&section)
    }

    pub fn toggle_favorite(&mut self, view: View) {
        if let Some(pos) = self.favorites.iter().position(|v| *v == view) {
            self.favorites.remove(pos);
        } else {
            self.favorites.push(view);
        }
    }

    pub fn is_favorite(&self, view: View) -> bool {
        self.favorites.contains(&view)
    }

    pub fn add_tab(&mut self, symbol: String, view: View) {
        // Check if tab already exists
        if let Some(idx) = self.symbol_tabs.iter().position(|t| t.symbol == symbol) {
            self.active_tab_index = idx;
            self.symbol_tabs[idx].view = view;
        } else {
            self.symbol_tabs.push(SymbolTab::new(symbol, view));
            self.active_tab_index = self.symbol_tabs.len() - 1;
        }
    }

    pub fn close_tab(&mut self, index: usize) {
        if self.symbol_tabs.len() > 1 && index < self.symbol_tabs.len() {
            // Don't close pinned tabs
            if !self.symbol_tabs[index].is_pinned {
                self.symbol_tabs.remove(index);
                if self.active_tab_index >= self.symbol_tabs.len() {
                    self.active_tab_index = self.symbol_tabs.len() - 1;
                }
            }
        }
    }

    pub fn toggle_pin_tab(&mut self, index: usize) {
        if index < self.symbol_tabs.len() {
            self.symbol_tabs[index].is_pinned = !self.symbol_tabs[index].is_pinned;
        }
    }

    pub fn go_back(&mut self) -> bool {
        if let Some((view, symbol)) = self.history.go_back() {
            self.active_view = view;
            self.active_symbol = symbol;
            true
        } else {
            false
        }
    }

    pub fn go_forward(&mut self) -> bool {
        if let Some((view, symbol)) = self.history.go_forward() {
            self.active_view = view;
            self.active_symbol = symbol;
            true
        } else {
            false
        }
    }

    /// Get breadcrumb trail for current location
    pub fn breadcrumbs(&self) -> Vec<(&'static str, Option<View>)> {
        let mut crumbs = vec![("Home", Some(View::Dashboard))];

        // Find section for current view
        for section in NavSection::all() {
            if section.views().contains(&self.active_view) {
                crumbs.push((section.label(), None));
                crumbs.push((self.active_view.label(), Some(self.active_view)));
                break;
            }
        }

        crumbs
    }
}

// =============================================================================
// Rendering Components (stateless, for use in ZeeApp)
// =============================================================================

/// Render the logo section of the sidebar
pub fn render_logo(theme: &Theme) -> Div {
    div()
        .px(px(20.0))
        .py(px(16.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .size(px(36.0))
                .bg(theme.accent)
                .rounded(px(8.0))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::BLACK)
                        .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                        .child("S")
                )
        )
        .child(
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("Stanley")
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("Institutional Analysis")
                )
        )
}

/// Render the search bar (static display, click to activate)
pub fn render_search_trigger(theme: &Theme) -> Div {
    div()
        .mx(px(12.0))
        .my(px(12.0))
        .px(px(12.0))
        .py(px(8.0))
        .rounded(px(6.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border_subtle)
        .cursor_pointer()
        .hover(|s| s.border_color(theme.border))
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_dimmed)
                .child("Search...")
        )
        .child(
            div()
                .ml_auto()
                .px(px(6.0))
                .py(px(2.0))
                .rounded(px(4.0))
                .bg(theme.card_bg_elevated)
                .text_size(px(10.0))
                .text_color(theme.text_muted)
                .child("Cmd+K")
        )
}

/// Render a navigation section header
pub fn render_section_header(
    section: NavSection,
    is_expanded: bool,
    has_active: bool,
    theme: &Theme,
) -> Div {
    div()
        .px(px(12.0))
        .py(px(6.0))
        .cursor_pointer()
        .hover(|s| s.bg(theme.hover_bg))
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child(if is_expanded { "v" } else { ">" })
        )
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(if has_active { theme.accent } else { theme.text_dimmed })
                .child(section.label())
        )
}

/// Render a navigation item
pub fn render_nav_item_static(
    view: View,
    is_active: bool,
    is_favorite: bool,
    theme: &Theme,
) -> Div {
    div()
        .ml(px(20.0))
        .mr(px(12.0))
        .px(px(12.0))
        .py(px(8.0))
        .rounded(px(6.0))
        .cursor_pointer()
        .bg(if is_active { theme.accent_subtle } else { transparent_black() })
        .hover(|s| s.bg(if is_active { theme.accent_subtle } else { theme.hover_bg }))
        .flex()
        .items_center()
        .gap(px(10.0))
        // Icon
        .child(
            div()
                .size(px(20.0))
                .rounded(px(4.0))
                .bg(if is_active { theme.accent.opacity(0.2) } else { theme.card_bg_elevated })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .text_color(if is_active { theme.accent } else { theme.text_muted })
                .child(view.icon())
        )
        // Label
        .child(
            div()
                .flex_grow()
                .text_size(px(13.0))
                .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
                .text_color(if is_active { theme.accent } else { theme.text_secondary })
                .child(view.label())
        )
        // Shortcut badge (if any)
        .when(view.shortcut().is_some(), |el| {
            el.child(
                div()
                    .px(px(6.0))
                    .py(px(2.0))
                    .rounded(px(4.0))
                    .bg(theme.card_bg_elevated)
                    .text_size(px(9.0))
                    .text_color(theme.text_dimmed)
                    .child(view.shortcut().unwrap().to_string())
            )
        })
        // Favorite indicator
        .when(is_favorite, |el| {
            el.child(
                div()
                    .text_size(px(10.0))
                    .text_color(theme.warning)
                    .child("*")
            )
        })
}

/// Render the status bar at bottom of sidebar
pub fn render_status_bar(status: &str, is_connected: bool, theme: &Theme) -> Div {
    let color = if is_connected { theme.positive } else { theme.negative };
    let status = status.to_string();

    div()
        .px(px(16.0))
        .py(px(10.0))
        .border_t_1()
        .border_color(theme.border_subtle)
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .size(px(8.0))
                .rounded_full()
                .bg(color)
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(color)
                .child(status)
        )
}

/// Render a single tab
pub fn render_tab_static(
    symbol: &str,
    is_active: bool,
    is_pinned: bool,
    theme: &Theme,
) -> Div {
    div()
        .h(px(28.0))
        .px(px(12.0))
        .rounded_t(px(6.0))
        .cursor_pointer()
        .bg(if is_active { theme.card_bg } else { transparent_black() })
        .border_t_1()
        .border_l_1()
        .border_r_1()
        .border_color(if is_active { theme.border_subtle } else { transparent_black() })
        .hover(|s| s.bg(if is_active { theme.card_bg } else { theme.hover_bg }))
        .flex()
        .items_center()
        .gap(px(8.0))
        // Pin indicator
        .when(is_pinned, |el| {
            el.child(
                div()
                    .text_size(px(8.0))
                    .text_color(theme.accent)
                    .child("*")
            )
        })
        // Symbol
        .child(
            div()
                .text_size(px(12.0))
                .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                .text_color(if is_active { theme.text } else { theme.text_secondary })
                .child(symbol.to_string())
        )
        // Close button placeholder (not for pinned tabs)
        .when(!is_pinned, |el| {
            el.child(
                div()
                    .size(px(14.0))
                    .rounded(px(2.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(10.0))
                    .text_color(theme.text_dimmed)
                    .hover(|s| s.bg(theme.negative_subtle).text_color(theme.negative))
                    .child("x")
            )
        })
}

/// Render breadcrumbs from navigation state
pub fn render_breadcrumbs_static(
    breadcrumbs: &[(&'static str, Option<View>)],
    theme: &Theme,
) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .children(
            breadcrumbs.iter().enumerate().flat_map(|(idx, (label, _view))| {
                let mut elements: Vec<Div> = Vec::new();

                // Separator (except for first item)
                if idx > 0 {
                    elements.push(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.text_dimmed)
                            .child("/")
                    );
                }

                // Crumb item
                let is_last = idx == breadcrumbs.len() - 1;
                elements.push(
                    div()
                        .text_size(px(11.0))
                        .text_color(if is_last { theme.text } else { theme.text_muted })
                        .child(label.to_string())
                );

                elements
            }).collect::<Vec<_>>()
        )
}

/// Render back/forward navigation buttons
pub fn render_nav_buttons(
    can_go_back: bool,
    can_go_forward: bool,
    theme: &Theme,
) -> Div {
    div()
        .flex()
        .gap(px(4.0))
        .child(
            div()
                .size(px(28.0))
                .rounded(px(4.0))
                .cursor(if can_go_back { CursorStyle::PointingHand } else { CursorStyle::default() })
                .bg(transparent_black())
                .hover(|s| if can_go_back { s.bg(theme.hover_bg) } else { s })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(14.0))
                .text_color(if can_go_back { theme.text_muted } else { theme.text_dimmed })
                .child("<")
        )
        .child(
            div()
                .size(px(28.0))
                .rounded(px(4.0))
                .cursor(if can_go_forward { CursorStyle::PointingHand } else { CursorStyle::default() })
                .bg(transparent_black())
                .hover(|s| if can_go_forward { s.bg(theme.hover_bg) } else { s })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(14.0))
                .text_color(if can_go_forward { theme.text_muted } else { theme.text_dimmed })
                .child(">")
        )
}

/// Render command palette item
pub fn render_palette_item(
    view: View,
    theme: &Theme,
) -> Div {
    div()
        .px(px(16.0))
        .py(px(10.0))
        .cursor_pointer()
        .hover(|s| s.bg(theme.hover_bg))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .size(px(24.0))
                .rounded(px(4.0))
                .bg(theme.card_bg_elevated)
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(11.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text_muted)
                .child(view.icon())
        )
        .child(
            div()
                .flex_grow()
                .text_size(px(13.0))
                .text_color(theme.text)
                .child(view.label())
        )
        .when(view.shortcut().is_some(), |el| {
            el.child(
                div()
                    .px(px(8.0))
                    .py(px(4.0))
                    .rounded(px(4.0))
                    .bg(theme.card_bg_elevated)
                    .text_size(px(10.0))
                    .text_color(theme.text_dimmed)
                    .child(view.shortcut().unwrap().to_string())
            )
        })
}

/// Render favorites bar
pub fn render_favorites_bar(
    favorites: &[View],
    active_view: View,
    theme: &Theme,
) -> Div {
    if favorites.is_empty() {
        return div();
    }

    div()
        .px(px(12.0))
        .py(px(8.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .px(px(8.0))
                .py(px(4.0))
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_dimmed)
                .child("FAVORITES")
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(6.0))
                .children(
                    favorites.iter().map(|view| {
                        let is_active = active_view == *view;

                        div()
                            .px(px(8.0))
                            .py(px(4.0))
                            .rounded(px(4.0))
                            .cursor_pointer()
                            .bg(if is_active { theme.accent_subtle } else { theme.card_bg })
                            .text_color(if is_active { theme.accent } else { theme.text_muted })
                            .text_size(px(11.0))
                            .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                            .hover(|s| s.bg(theme.hover_bg))
                            .child(view.label())
                    }).collect::<Vec<_>>()
                )
        )
}

// =============================================================================
// Main Composite Rendering Functions (Static - No Event Handlers)
// =============================================================================
//
// Note: These functions render static UI elements. Event handlers should be
// attached by the caller using GPUI's listener pattern. For dynamic event handling,
// the caller (app.rs) should build the UI directly using the static helper
// functions defined above and attach event handlers via cx.listener().
//
// The render_enhanced_sidebar, render_main_with_tabs, etc. methods in app.rs
// demonstrate the correct pattern for wiring up event handlers.
// =============================================================================

/// Render sidebar structure (static version for reference/documentation)
///
/// For actual use, see ZeeApp::render_enhanced_sidebar() which properly
/// wires up event handlers using cx.listener().
#[allow(dead_code)]
pub fn render_sidebar_static(nav: &NavigationState, theme: &Theme) -> Div {
    let theme = theme.clone();
    let nav = nav.clone();

    div()
        .w(px(240.0))
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.sidebar_bg)
        .border_r_1()
        .border_color(theme.border_subtle)
        // Logo
        .child(render_logo(&theme))
        // Search trigger (no event handler - static display only)
        .child(render_search_trigger(&theme))
        // Favorites bar
        .child(render_favorites_bar(&nav.favorites, nav.active_view, &theme))
        // Navigation sections
        .child(
            div()
                .id("nav-sections-scroll")
                .flex_grow()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .py(px(8.0))
                .children(
                    NavSection::all().iter().map(|section| {
                        let section = *section;
                        let is_expanded = nav.is_section_expanded(section);
                        let has_active = section.views().contains(&nav.active_view);
                        let theme = theme.clone();
                        let nav = nav.clone();

                        div()
                            .flex()
                            .flex_col()
                            // Section header
                            .child(render_section_header(section, is_expanded, has_active, &theme))
                            // Section items (only if expanded)
                            .when(is_expanded, |el| {
                                el.children(
                                    section.views().iter().map(|view| {
                                        let view = *view;
                                        let is_active = nav.active_view == view;
                                        let is_favorite = nav.is_favorite(view);
                                        let theme = theme.clone();

                                        render_nav_item_static(view, is_active, is_favorite, &theme)
                                    }).collect::<Vec<_>>()
                                )
                            })
                    }).collect::<Vec<_>>()
                )
        )
        // Status bar at bottom
        .child(render_status_bar("Connected", true, &theme))
}

/// Render the tab bar for multi-symbol navigation (static version)
pub fn render_tab_bar_static(nav: &NavigationState, theme: &Theme) -> Div {
    let theme = theme.clone();

    div()
        .h(px(36.0))
        .px(px(8.0))
        .flex()
        .items_end()
        .gap(px(2.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        .bg(theme.sidebar_bg)
        // Tabs
        .children(
            nav.symbol_tabs.iter().enumerate().map(|(idx, tab)| {
                let is_active = idx == nav.active_tab_index;
                let theme = theme.clone();

                div()
                    .id(SharedString::from(format!("tab-{}", idx)))
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .h(px(28.0))
                            .px(px(12.0))
                            .rounded_t(px(6.0))
                            .cursor_pointer()
                            .bg(if is_active { theme.card_bg } else { transparent_black() })
                            .border_t_1()
                            .border_l_1()
                            .border_r_1()
                            .border_color(if is_active { theme.border_subtle } else { transparent_black() })
                            .hover(|s| s.bg(if is_active { theme.card_bg } else { theme.hover_bg }))
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            // Pin indicator
                            .when(tab.is_pinned, |el| {
                                el.child(
                                    div()
                                        .text_size(px(8.0))
                                        .text_color(theme.accent)
                                        .child("*")
                                )
                            })
                            // Symbol
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                                    .text_color(if is_active { theme.text } else { theme.text_secondary })
                                    .child(tab.symbol.clone())
                            )
                            // Close button (not for pinned tabs)
                            .when(!tab.is_pinned, |el| {
                                el.child(
                                    div()
                                        .id(SharedString::from(format!("close-tab-{}", idx)))
                                        .size(px(14.0))
                                        .rounded(px(2.0))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .text_size(px(10.0))
                                        .text_color(theme.text_dimmed)
                                        .hover(|s| s.bg(theme.negative_subtle).text_color(theme.negative))
                                        .child("x")
                                )
                            })
                    )
            }).collect::<Vec<_>>()
        )
        // Add tab button
        .child(
            div()
                .id("add-tab")
                .size(px(24.0))
                .mb(px(4.0))
                .rounded(px(4.0))
                .cursor_pointer()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(14.0))
                .text_color(theme.text_dimmed)
                .hover(|s| s.bg(theme.hover_bg).text_color(theme.text_muted))
                .child("+")
        )
}

/// Render the header with navigation controls and symbol info (static version)
#[allow(dead_code)]
pub fn render_header_static(
    nav: &NavigationState,
    price: f64,
    change: f64,
    change_pct: f64,
    theme: &Theme,
) -> Div {
    let theme = theme.clone();
    let is_positive = change >= 0.0;
    let change_color = if is_positive { theme.positive } else { theme.negative };
    let can_go_back = nav.history.can_go_back();
    let can_go_forward = nav.history.can_go_forward();
    let breadcrumbs = nav.breadcrumbs();

    div()
        .h(px(56.0))
        .px(px(20.0))
        .flex()
        .items_center()
        .gap(px(16.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        // Back/Forward buttons
        .child(
            div()
                .flex()
                .gap(px(4.0))
                // Back button
                .child(
                    div()
                        .id("nav-back")
                        .size(px(28.0))
                        .rounded(px(4.0))
                        .cursor(if can_go_back { CursorStyle::PointingHand } else { CursorStyle::default() })
                        .bg(transparent_black())
                        .hover(|s| if can_go_back { s.bg(theme.hover_bg) } else { s })
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(14.0))
                        .text_color(if can_go_back { theme.text_muted } else { theme.text_dimmed })
                        .child("<")
                )
                // Forward button
                .child(
                    div()
                        .id("nav-forward")
                        .size(px(28.0))
                        .rounded(px(4.0))
                        .cursor(if can_go_forward { CursorStyle::PointingHand } else { CursorStyle::default() })
                        .bg(transparent_black())
                        .hover(|s| if can_go_forward { s.bg(theme.hover_bg) } else { s })
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(14.0))
                        .text_color(if can_go_forward { theme.text_muted } else { theme.text_dimmed })
                        .child(">")
                )
        )
        // Breadcrumbs
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .children(
                    breadcrumbs.iter().enumerate().flat_map(|(idx, (label, _view))| {
                        let mut elements: Vec<Div> = Vec::new();

                        // Separator (except for first item)
                        if idx > 0 {
                            elements.push(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_dimmed)
                                    .child("/")
                            );
                        }

                        // Crumb item
                        let is_last = idx == breadcrumbs.len() - 1;
                        elements.push(
                            div()
                                .text_size(px(11.0))
                                .text_color(if is_last { theme.text } else { theme.text_muted })
                                .when(!is_last, |el| el.cursor_pointer().hover(|s| s.text_color(theme.accent)))
                                .child(label.to_string())
                        );

                        elements
                    }).collect::<Vec<_>>()
                )
        )
        // Spacer
        .child(div().flex_grow())
        // Symbol info
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                // Symbol name
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child(nav.active_symbol.clone())
                )
                // Price
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_secondary)
                        .child(format!("${:.2}", price))
                )
                // Change badge
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(change_color.opacity(0.15))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(change_color)
                        .child(format!("{:+.2} ({:+.2}%)", change, change_pct))
                )
        )
        // View indicator
        .child(
            div()
                .px(px(10.0))
                .py(px(4.0))
                .rounded(px(4.0))
                .bg(theme.accent_subtle)
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.accent)
                .child(nav.active_view.label())
        )
}

/// Render the command palette overlay (static version)
#[allow(dead_code)]
pub fn render_command_palette_static(
    nav: &NavigationState,
    theme: &Theme,
) -> impl IntoElement {
    if !nav.show_command_palette {
        return div().into_any_element();
    }

    let theme = theme.clone();

    // Backdrop
    div()
        .id("command-palette-backdrop")
        .absolute()
        .inset_0()
        .bg(hsla(0.0, 0.0, 0.0, 0.5))
        .flex()
        .items_start()
        .justify_center()
        .pt(px(100.0))
        .child(
            // Palette container
            div()
                .w(px(500.0))
                .max_h(px(400.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .overflow_hidden()
                .flex()
                .flex_col()
                // Search input area
                .child(
                    div()
                        .px(px(16.0))
                        .py(px(12.0))
                        .border_b_1()
                        .border_color(theme.border_subtle)
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        // Search icon
                        .child(
                            div()
                                .text_size(px(14.0))
                                .text_color(theme.text_dimmed)
                                .child(">")
                        )
                        // Input placeholder
                        .child(
                            div()
                                .flex_grow()
                                .text_size(px(14.0))
                                .text_color(theme.text_muted)
                                .child(if nav.search_query.is_empty() {
                                    "Type to search views...".to_string()
                                } else {
                                    nav.search_query.clone()
                                })
                        )
                        // Escape hint
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(theme.card_bg_elevated)
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child("ESC")
                        )
                )
                // Results list
                .child(
                    div()
                        .id("palette-results-scroll")
                        .flex_grow()
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .children(
                            View::all().iter().filter(|view| {
                                if nav.search_query.is_empty() {
                                    true
                                } else {
                                    view.label().to_lowercase().contains(&nav.search_query.to_lowercase())
                                }
                            }).map(|view| {
                                let view = *view;
                                let theme = theme.clone();

                                div()
                                    .id(SharedString::from(format!("palette-{:?}", view)))
                                    .child(render_palette_item(view, &theme))
                            }).collect::<Vec<_>>()
                        )
                )
                // Footer with hints
                .child(
                    div()
                        .px(px(16.0))
                        .py(px(8.0))
                        .border_t_1()
                        .border_color(theme.border_subtle)
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
                                        .px(px(6.0))
                                        .py(px(2.0))
                                        .rounded(px(4.0))
                                        .bg(theme.card_bg_elevated)
                                        .text_size(px(10.0))
                                        .text_color(theme.text_dimmed)
                                        .child("^")
                                )
                                .child(
                                    div()
                                        .px(px(6.0))
                                        .py(px(2.0))
                                        .rounded(px(4.0))
                                        .bg(theme.card_bg_elevated)
                                        .text_size(px(10.0))
                                        .text_color(theme.text_dimmed)
                                        .child("v")
                                )
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .text_color(theme.text_dimmed)
                                        .child("Navigate")
                                )
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .px(px(6.0))
                                        .py(px(2.0))
                                        .rounded(px(4.0))
                                        .bg(theme.card_bg_elevated)
                                        .text_size(px(10.0))
                                        .text_color(theme.text_dimmed)
                                        .child("Enter")
                                )
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .text_color(theme.text_dimmed)
                                        .child("Select")
                                )
                        )
                )
        )
        .into_any_element()
}

/// Render the keyboard shortcuts help overlay
pub fn render_shortcuts_overlay(
    show: bool,
    theme: &Theme,
) -> impl IntoElement {
    if !show {
        return div().into_any_element();
    }

    let theme = theme.clone();
    let shortcuts = crate::keyboard::get_shortcuts_help();

    // Backdrop
    div()
        .id("shortcuts-backdrop")
        .absolute()
        .inset_0()
        .bg(hsla(0.0, 0.0, 0.0, 0.6))
        .flex()
        .items_center()
        .justify_center()
        .child(
            // Modal container
            div()
                .w(px(700.0))
                .max_h(px(600.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .overflow_hidden()
                .flex()
                .flex_col()
                // Header
                .child(
                    div()
                        .px(px(20.0))
                        .py(px(16.0))
                        .border_b_1()
                        .border_color(theme.border_subtle)
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(16.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.text)
                                .child("Keyboard Shortcuts")
                        )
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(theme.card_bg_elevated)
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child("Press ? or ESC to close")
                        )
                )
                // Shortcuts grid
                .child(
                    div()
                        .id("shortcuts-grid-scroll")
                        .flex_grow()
                        .overflow_y_scroll()
                        .p(px(20.0))
                        .flex()
                        .flex_wrap()
                        .gap(px(24.0))
                        .children(
                            shortcuts.iter().map(|(category, bindings)| {
                                let theme = theme.clone();

                                div()
                                    .w(px(200.0))
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.0))
                                    // Category header
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.accent)
                                            .child(category.to_string())
                                    )
                                    // Bindings
                                    .children(
                                        bindings.iter().map(|(key, desc)| {
                                            let theme = theme.clone();

                                            div()
                                                .flex()
                                                .items_center()
                                                .justify_between()
                                                .py(px(4.0))
                                                .child(
                                                    div()
                                                        .text_size(px(11.0))
                                                        .text_color(theme.text_secondary)
                                                        .child(desc.to_string())
                                                )
                                                .child(
                                                    div()
                                                        .px(px(6.0))
                                                        .py(px(2.0))
                                                        .rounded(px(4.0))
                                                        .bg(theme.card_bg_elevated)
                                                        .text_size(px(10.0))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(theme.text_muted)
                                                        .child(key.to_string())
                                                )
                                        }).collect::<Vec<_>>()
                                    )
                            }).collect::<Vec<_>>()
                        )
                )
        )
        .into_any_element()
}

/// Render a Settings-style view (placeholder)
pub fn render_settings_view() -> View {
    // Settings is handled by the Settings view
    View::Dashboard
}
