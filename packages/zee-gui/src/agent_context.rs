//! Agent Context Management for Stanley GUI
//!
//! Provides context-aware features for agent interactions:
//! - Context preview sidebar
//! - Active context sources indicator
//! - Manual context injection UI
//! - Context priority adjustment
//! - Session history browser

use crate::components::streaming::CatppuccinMocha;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =============================================================================
// Context Source Types
// =============================================================================

/// Type of context source
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum ContextSourceType {
    /// Portfolio holdings and positions
    Portfolio,
    /// Watchlist symbols
    Watchlist,
    /// Recent research queries
    Research,
    /// Market data snapshots
    MarketData,
    /// SEC filings and documents
    SECFilings,
    /// News and sentiment
    News,
    /// User notes
    Notes,
    /// Previous conversation context
    Conversation,
    /// Custom injected context
    Custom,
}

impl ContextSourceType {
    pub fn label(&self) -> &'static str {
        match self {
            ContextSourceType::Portfolio => "Portfolio",
            ContextSourceType::Watchlist => "Watchlist",
            ContextSourceType::Research => "Research",
            ContextSourceType::MarketData => "Market Data",
            ContextSourceType::SECFilings => "SEC Filings",
            ContextSourceType::News => "News",
            ContextSourceType::Notes => "Notes",
            ContextSourceType::Conversation => "Conversation",
            ContextSourceType::Custom => "Custom",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            ContextSourceType::Portfolio => "P",
            ContextSourceType::Watchlist => "W",
            ContextSourceType::Research => "R",
            ContextSourceType::MarketData => "M",
            ContextSourceType::SECFilings => "S",
            ContextSourceType::News => "N",
            ContextSourceType::Notes => "T",
            ContextSourceType::Conversation => "C",
            ContextSourceType::Custom => "*",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            ContextSourceType::Portfolio => CatppuccinMocha::blue(),
            ContextSourceType::Watchlist => CatppuccinMocha::mauve(),
            ContextSourceType::Research => CatppuccinMocha::green(),
            ContextSourceType::MarketData => CatppuccinMocha::peach(),
            ContextSourceType::SECFilings => CatppuccinMocha::yellow(),
            ContextSourceType::News => CatppuccinMocha::teal(),
            ContextSourceType::Notes => CatppuccinMocha::pink(),
            ContextSourceType::Conversation => CatppuccinMocha::lavender(),
            ContextSourceType::Custom => CatppuccinMocha::rosewater(),
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            ContextSourceType::Portfolio => "Current holdings and positions",
            ContextSourceType::Watchlist => "Symbols you're tracking",
            ContextSourceType::Research => "Recent research and analysis",
            ContextSourceType::MarketData => "Live market prices and metrics",
            ContextSourceType::SECFilings => "SEC documents and filings",
            ContextSourceType::News => "News articles and sentiment",
            ContextSourceType::Notes => "Your personal notes",
            ContextSourceType::Conversation => "Previous chat messages",
            ContextSourceType::Custom => "Manually added context",
        }
    }

    pub fn all() -> &'static [ContextSourceType] {
        &[
            ContextSourceType::Portfolio,
            ContextSourceType::Watchlist,
            ContextSourceType::Research,
            ContextSourceType::MarketData,
            ContextSourceType::SECFilings,
            ContextSourceType::News,
            ContextSourceType::Notes,
            ContextSourceType::Conversation,
            ContextSourceType::Custom,
        ]
    }
}

// =============================================================================
// Context Source
// =============================================================================

/// Priority level for context sources
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ContextPriority {
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4,
}

impl ContextPriority {
    pub fn label(&self) -> &'static str {
        match self {
            ContextPriority::Low => "Low",
            ContextPriority::Medium => "Medium",
            ContextPriority::High => "High",
            ContextPriority::Critical => "Critical",
        }
    }

    pub fn weight(&self) -> f32 {
        match self {
            ContextPriority::Low => 0.25,
            ContextPriority::Medium => 0.5,
            ContextPriority::High => 0.75,
            ContextPriority::Critical => 1.0,
        }
    }

    pub fn all() -> &'static [ContextPriority] {
        &[
            ContextPriority::Low,
            ContextPriority::Medium,
            ContextPriority::High,
            ContextPriority::Critical,
        ]
    }

    pub fn next(&self) -> Self {
        match self {
            ContextPriority::Low => ContextPriority::Medium,
            ContextPriority::Medium => ContextPriority::High,
            ContextPriority::High => ContextPriority::Critical,
            ContextPriority::Critical => ContextPriority::Critical,
        }
    }

    pub fn prev(&self) -> Self {
        match self {
            ContextPriority::Low => ContextPriority::Low,
            ContextPriority::Medium => ContextPriority::Low,
            ContextPriority::High => ContextPriority::Medium,
            ContextPriority::Critical => ContextPriority::High,
        }
    }
}

/// A context source with its data and metadata
#[derive(Debug, Clone)]
pub struct ContextSource {
    pub id: String,
    pub source_type: ContextSourceType,
    pub title: String,
    pub content: String,
    pub priority: ContextPriority,
    pub enabled: bool,
    pub token_count: usize,
    pub last_updated: String,
    pub metadata: HashMap<String, String>,
}

impl ContextSource {
    pub fn new(source_type: ContextSourceType, title: &str, content: &str) -> Self {
        Self {
            id: generate_context_id(),
            source_type,
            title: title.to_string(),
            content: content.to_string(),
            priority: ContextPriority::Medium,
            enabled: true,
            token_count: estimate_tokens(content),
            last_updated: format_now(),
            metadata: HashMap::new(),
        }
    }

    pub fn with_priority(mut self, priority: ContextPriority) -> Self {
        self.priority = priority;
        self
    }

    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }

    pub fn toggle_enabled(&mut self) {
        self.enabled = !self.enabled;
    }

    pub fn increase_priority(&mut self) {
        self.priority = self.priority.next();
    }

    pub fn decrease_priority(&mut self) {
        self.priority = self.priority.prev();
    }
}

// =============================================================================
// Session History
// =============================================================================

/// A session in the history
#[derive(Debug, Clone)]
pub struct SessionEntry {
    pub id: String,
    pub title: String,
    pub timestamp: String,
    pub message_count: usize,
    pub symbols: Vec<String>,
    pub summary: Option<String>,
    pub is_current: bool,
}

impl SessionEntry {
    pub fn new(title: &str) -> Self {
        Self {
            id: generate_session_id(),
            title: title.to_string(),
            timestamp: format_now(),
            message_count: 0,
            symbols: Vec::new(),
            summary: None,
            is_current: false,
        }
    }

    pub fn with_symbols(mut self, symbols: Vec<String>) -> Self {
        self.symbols = symbols;
        self
    }

    pub fn with_summary(mut self, summary: &str) -> Self {
        self.summary = Some(summary.to_string());
        self
    }
}

// =============================================================================
// Manual Context Injection
// =============================================================================

/// Input for manual context injection
#[derive(Debug, Clone, Default)]
pub struct ContextInjection {
    pub title: String,
    pub content: String,
    pub priority: ContextPriority,
    pub source_type: ContextSourceType,
    pub is_temporary: bool,
}

impl Default for ContextPriority {
    fn default() -> Self {
        ContextPriority::Medium
    }
}

impl Default for ContextSourceType {
    fn default() -> Self {
        ContextSourceType::Custom
    }
}

// =============================================================================
// Context State
// =============================================================================

/// State for context management
#[derive(Debug, Clone)]
pub struct ContextState {
    /// All available context sources
    pub sources: Vec<ContextSource>,
    /// Priority overrides by source type
    pub type_priorities: HashMap<ContextSourceType, ContextPriority>,
    /// Session history
    pub sessions: Vec<SessionEntry>,
    /// Current session ID
    pub current_session_id: Option<String>,
    /// Whether context sidebar is visible
    pub sidebar_visible: bool,
    /// Active tab in sidebar
    pub active_tab: ContextTab,
    /// Manual injection input
    pub injection: ContextInjection,
    /// Search/filter text
    pub filter_text: String,
    /// Maximum context tokens
    pub max_tokens: usize,
    /// Whether to auto-include context
    pub auto_include: bool,
}

/// Tabs in the context sidebar
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ContextTab {
    #[default]
    Sources,
    History,
    Inject,
}

impl ContextTab {
    pub fn label(&self) -> &'static str {
        match self {
            ContextTab::Sources => "Sources",
            ContextTab::History => "History",
            ContextTab::Inject => "Inject",
        }
    }

    pub fn all() -> &'static [ContextTab] {
        &[ContextTab::Sources, ContextTab::History, ContextTab::Inject]
    }
}

impl Default for ContextState {
    fn default() -> Self {
        Self {
            sources: Self::default_sources(),
            type_priorities: HashMap::new(),
            sessions: Vec::new(),
            current_session_id: None,
            sidebar_visible: false,
            active_tab: ContextTab::Sources,
            injection: ContextInjection::default(),
            filter_text: String::new(),
            max_tokens: 4000,
            auto_include: true,
        }
    }
}

impl ContextState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Default context sources
    fn default_sources() -> Vec<ContextSource> {
        vec![
            ContextSource::new(
                ContextSourceType::Portfolio,
                "Current Portfolio",
                "Portfolio holdings will be loaded from the backend.",
            ).with_priority(ContextPriority::High),
            ContextSource::new(
                ContextSourceType::Watchlist,
                "Active Watchlist",
                "Watchlist symbols will be loaded from the backend.",
            ).with_priority(ContextPriority::Medium),
            ContextSource::new(
                ContextSourceType::Conversation,
                "Recent Conversation",
                "Recent messages from the current session.",
            ).with_priority(ContextPriority::High),
        ]
    }

    /// Toggle sidebar visibility
    pub fn toggle_sidebar(&mut self) {
        self.sidebar_visible = !self.sidebar_visible;
    }

    /// Set active tab
    pub fn set_tab(&mut self, tab: ContextTab) {
        self.active_tab = tab;
    }

    /// Get enabled sources sorted by priority
    pub fn get_enabled_sources(&self) -> Vec<&ContextSource> {
        let mut sources: Vec<_> = self.sources.iter()
            .filter(|s| s.enabled)
            .collect();
        sources.sort_by(|a, b| b.priority.cmp(&a.priority));
        sources
    }

    /// Get total token count of enabled sources
    pub fn get_total_tokens(&self) -> usize {
        self.sources.iter()
            .filter(|s| s.enabled)
            .map(|s| s.token_count)
            .sum()
    }

    /// Check if over token limit
    pub fn is_over_limit(&self) -> bool {
        self.get_total_tokens() > self.max_tokens
    }

    /// Add a new context source
    pub fn add_source(&mut self, source: ContextSource) {
        self.sources.push(source);
    }

    /// Remove a context source by ID
    pub fn remove_source(&mut self, id: &str) {
        self.sources.retain(|s| s.id != id);
    }

    /// Toggle source enabled state
    pub fn toggle_source(&mut self, id: &str) {
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == id) {
            source.toggle_enabled();
        }
    }

    /// Update source priority
    pub fn set_source_priority(&mut self, id: &str, priority: ContextPriority) {
        if let Some(source) = self.sources.iter_mut().find(|s| s.id == id) {
            source.priority = priority;
        }
    }

    /// Add a session to history
    pub fn add_session(&mut self, session: SessionEntry) {
        // Set all other sessions as not current
        for s in self.sessions.iter_mut() {
            s.is_current = false;
        }
        self.current_session_id = Some(session.id.clone());
        self.sessions.insert(0, session);
        // Keep only last 50 sessions
        if self.sessions.len() > 50 {
            self.sessions.pop();
        }
    }

    /// Get sessions filtered by search text
    pub fn get_filtered_sessions(&self) -> Vec<&SessionEntry> {
        if self.filter_text.is_empty() {
            return self.sessions.iter().collect();
        }
        let filter = self.filter_text.to_lowercase();
        self.sessions.iter()
            .filter(|s| {
                s.title.to_lowercase().contains(&filter) ||
                s.symbols.iter().any(|sym| sym.to_lowercase().contains(&filter)) ||
                s.summary.as_ref().map(|sum| sum.to_lowercase().contains(&filter)).unwrap_or(false)
            })
            .collect()
    }

    /// Inject custom context
    pub fn inject_context(&mut self) {
        if self.injection.content.is_empty() {
            return;
        }

        let source = ContextSource::new(
            self.injection.source_type,
            &self.injection.title,
            &self.injection.content,
        ).with_priority(self.injection.priority);

        self.add_source(source);

        // Clear injection form
        self.injection = ContextInjection::default();
    }

    /// Build context string for agent
    pub fn build_context_string(&self) -> String {
        let mut parts = Vec::new();
        let enabled = self.get_enabled_sources();

        for source in enabled {
            parts.push(format!(
                "## {} ({})\n{}",
                source.title,
                source.source_type.label(),
                source.content
            ));
        }

        parts.join("\n\n---\n\n")
    }
}

// =============================================================================
// Rendering
// =============================================================================

/// Render the context sidebar
pub fn render_context_sidebar<F, G, H>(
    theme: &Theme,
    state: &ContextState,
    on_toggle_source: F,
    on_select_session: G,
    on_inject: H,
) -> Div
where
    F: Fn(&str) + Clone + 'static,
    G: Fn(&str) + Clone + 'static,
    H: Fn() + Clone + 'static,
{
    div()
        .id("context-sidebar")
        .w(px(320.0))
        .h_full()
        .flex()
        .flex_col()
        .bg(CatppuccinMocha::mantle())
        .border_l_1()
        .border_color(CatppuccinMocha::surface0())
        // Header
        .child(render_sidebar_header(theme, state))
        // Tabs
        .child(render_sidebar_tabs(theme, state))
        // Content based on active tab
        .child(match state.active_tab {
            ContextTab::Sources => render_sources_tab(theme, state, on_toggle_source),
            ContextTab::History => render_history_tab(theme, state, on_select_session),
            ContextTab::Inject => render_inject_tab(theme, state, on_inject),
        })
}

/// Render sidebar header
fn render_sidebar_header(theme: &Theme, state: &ContextState) -> Div {
    let total_tokens = state.get_total_tokens();
    let is_over = state.is_over_limit();
    let token_color = if is_over {
        CatppuccinMocha::red()
    } else if total_tokens as f32 / state.max_tokens as f32 > 0.8 {
        CatppuccinMocha::yellow()
    } else {
        CatppuccinMocha::green()
    };

    div()
        .px(px(16.0))
        .py(px(12.0))
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        // Title
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::text())
                        .child("Context")
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(token_color)
                                .child(format!("{} / {} tokens", total_tokens, state.max_tokens))
                        )
                        .when(is_over, |el| {
                            el.child(
                                div()
                                    .text_size(px(9.0))
                                    .text_color(CatppuccinMocha::red())
                                    .child("(over limit)")
                            )
                        })
                )
        )
        // Token bar
        .child(
            div()
                .w(px(60.0))
                .h(px(6.0))
                .rounded_full()
                .bg(CatppuccinMocha::surface0())
                .overflow_hidden()
                .child(
                    div()
                        .h_full()
                        .rounded_full()
                        .bg(token_color)
                        .w(px((total_tokens as f32 / state.max_tokens as f32 * 60.0).min(60.0)))
                )
        )
}

/// Render sidebar tabs
fn render_sidebar_tabs(theme: &Theme, state: &ContextState) -> Div {
    div()
        .px(px(8.0))
        .py(px(8.0))
        .flex()
        .items_center()
        .gap(px(4.0))
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        .children(ContextTab::all().iter().map(|tab| {
            let is_active = state.active_tab == *tab;
            div()
                .id(format!("tab-{:?}", tab))
                .flex_grow()
                .px(px(12.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(if is_active {
                    CatppuccinMocha::surface1()
                } else {
                    CatppuccinMocha::mantle()
                })
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface0()))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
                        .text_color(if is_active {
                            CatppuccinMocha::text()
                        } else {
                            CatppuccinMocha::subtext0()
                        })
                        .child(tab.label())
                )
        }))
}

/// Render sources tab content
fn render_sources_tab<F>(
    theme: &Theme,
    state: &ContextState,
    on_toggle: F,
) -> Div
where
    F: Fn(&str) + Clone + 'static,
{
    div()
        .flex_grow()
        .overflow_y_scroll()
        .p(px(12.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .children(state.sources.iter().map(|source| {
            let callback = on_toggle.clone();
            let source_id = source.id.clone();
            render_source_card(theme, source, move || callback(&source_id))
        }))
}

/// Render a single source card
fn render_source_card<F>(
    theme: &Theme,
    source: &ContextSource,
    on_toggle: F,
) -> Div
where
    F: Fn() + 'static,
{
    let color = source.source_type.color();
    let is_enabled = source.enabled;

    div()
        .id(source.id.clone())
        .w_full()
        .p(px(10.0))
        .rounded(px(8.0))
        .bg(if is_enabled {
            CatppuccinMocha::surface0()
        } else {
            CatppuccinMocha::mantle()
        })
        .border_1()
        .border_color(if is_enabled {
            color.opacity(0.3)
        } else {
            CatppuccinMocha::surface0()
        })
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface1()))
        .on_click(move |_event, _window, _cx| {
            on_toggle();
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(6.0))
                // Header
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        // Left: icon + title
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                // Type icon
                                .child(
                                    div()
                                        .size(px(24.0))
                                        .rounded(px(5.0))
                                        .bg(color.opacity(if is_enabled { 0.2 } else { 0.1 }))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .font_weight(FontWeight::BOLD)
                                                .text_color(if is_enabled {
                                                    color
                                                } else {
                                                    CatppuccinMocha::overlay0()
                                                })
                                                .child(source.source_type.icon())
                                        )
                                )
                                // Title
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(if is_enabled {
                                            CatppuccinMocha::text()
                                        } else {
                                            CatppuccinMocha::overlay1()
                                        })
                                        .child(source.title.clone())
                                )
                        )
                        // Right: priority + toggle
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.0))
                                // Priority badge
                                .child(
                                    div()
                                        .px(px(6.0))
                                        .py(px(2.0))
                                        .rounded(px(4.0))
                                        .bg(CatppuccinMocha::surface1())
                                        .child(
                                            div()
                                                .text_size(px(9.0))
                                                .text_color(CatppuccinMocha::subtext0())
                                                .child(source.priority.label())
                                        )
                                )
                                // Toggle indicator
                                .child(
                                    div()
                                        .size(px(16.0))
                                        .rounded(px(4.0))
                                        .bg(if is_enabled {
                                            color
                                        } else {
                                            CatppuccinMocha::surface1()
                                        })
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .child(
                                            div()
                                                .text_size(px(10.0))
                                                .text_color(if is_enabled {
                                                    CatppuccinMocha::crust()
                                                } else {
                                                    CatppuccinMocha::overlay0()
                                                })
                                                .child(if is_enabled { "+" } else { "-" })
                                        )
                                )
                        )
                )
                // Token count
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child(format!("{} tokens", source.token_count))
                        )
                        .child(
                            div()
                                .text_size(px(9.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child(source.last_updated.clone())
                        )
                )
        )
}

/// Render history tab content
fn render_history_tab<F>(
    theme: &Theme,
    state: &ContextState,
    on_select: F,
) -> Div
where
    F: Fn(&str) + Clone + 'static,
{
    let sessions = state.get_filtered_sessions();

    div()
        .flex_grow()
        .overflow_y_scroll()
        .flex()
        .flex_col()
        // Search input
        .child(
            div()
                .px(px(12.0))
                .py(px(8.0))
                .border_b_1()
                .border_color(CatppuccinMocha::surface0())
                .child(
                    div()
                        .w_full()
                        .px(px(10.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(CatppuccinMocha::surface0())
                        .border_1()
                        .border_color(CatppuccinMocha::surface1())
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(if state.filter_text.is_empty() {
                                    CatppuccinMocha::overlay0()
                                } else {
                                    CatppuccinMocha::text()
                                })
                                .child(if state.filter_text.is_empty() {
                                    "Search history...".to_string()
                                } else {
                                    state.filter_text.clone()
                                })
                        )
                )
        )
        // Session list
        .child(
            div()
                .flex_grow()
                .p(px(12.0))
                .flex()
                .flex_col()
                .gap(px(8.0))
                .when(sessions.is_empty(), |el| {
                    el.child(
                        div()
                            .flex()
                            .items_center()
                            .justify_center()
                            .py(px(24.0))
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child("No sessions found")
                            )
                    )
                })
                .children(sessions.iter().map(|session| {
                    let callback = on_select.clone();
                    let session_id = session.id.clone();
                    render_session_card(theme, session, move || callback(&session_id))
                }))
        )
}

/// Render a session history card
fn render_session_card<F>(
    theme: &Theme,
    session: &SessionEntry,
    on_select: F,
) -> Div
where
    F: Fn() + 'static,
{
    div()
        .id(session.id.clone())
        .w_full()
        .p(px(10.0))
        .rounded(px(8.0))
        .bg(if session.is_current {
            CatppuccinMocha::surface1()
        } else {
            CatppuccinMocha::surface0()
        })
        .border_1()
        .border_color(if session.is_current {
            CatppuccinMocha::blue().opacity(0.3)
        } else {
            CatppuccinMocha::surface1()
        })
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface1()))
        .on_click(move |_event, _window, _cx| {
            on_select();
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(6.0))
                // Title row
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(session.title.clone())
                        )
                        .when(session.is_current, |el| {
                            el.child(
                                div()
                                    .px(px(6.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .bg(CatppuccinMocha::blue().opacity(0.2))
                                    .child(
                                        div()
                                            .text_size(px(9.0))
                                            .text_color(CatppuccinMocha::blue())
                                            .child("Current")
                                    )
                            )
                        })
                )
                // Metadata row
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child(session.timestamp.clone())
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child(format!("{} messages", session.message_count))
                        )
                )
                // Symbols
                .when(!session.symbols.is_empty(), |el| {
                    el.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .flex_wrap()
                            .children(session.symbols.iter().take(5).map(|sym| {
                                div()
                                    .px(px(6.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .bg(CatppuccinMocha::surface1())
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(CatppuccinMocha::blue())
                                            .child(sym.clone())
                                    )
                            }))
                    )
                })
                // Summary
                .when_some(session.summary.clone(), |el, summary| {
                    el.child(
                        div()
                            .text_size(px(10.0))
                            .text_color(CatppuccinMocha::subtext0())
                            .child(truncate_text(&summary, 80))
                    )
                })
        )
}

/// Render inject tab content
fn render_inject_tab<F>(
    theme: &Theme,
    state: &ContextState,
    on_inject: F,
) -> Div
where
    F: Fn() + Clone + 'static,
{
    div()
        .flex_grow()
        .p(px(12.0))
        .flex()
        .flex_col()
        .gap(px(12.0))
        // Title input
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(CatppuccinMocha::subtext0())
                        .child("Title")
                )
                .child(
                    div()
                        .w_full()
                        .px(px(10.0))
                        .py(px(8.0))
                        .rounded(px(6.0))
                        .bg(CatppuccinMocha::surface0())
                        .border_1()
                        .border_color(CatppuccinMocha::surface1())
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(if state.injection.title.is_empty() {
                                    CatppuccinMocha::overlay0()
                                } else {
                                    CatppuccinMocha::text()
                                })
                                .child(if state.injection.title.is_empty() {
                                    "Context title...".to_string()
                                } else {
                                    state.injection.title.clone()
                                })
                        )
                )
        )
        // Content textarea
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(CatppuccinMocha::subtext0())
                        .child("Content")
                )
                .child(
                    div()
                        .w_full()
                        .h(px(120.0))
                        .px(px(10.0))
                        .py(px(8.0))
                        .rounded(px(6.0))
                        .bg(CatppuccinMocha::surface0())
                        .border_1()
                        .border_color(CatppuccinMocha::surface1())
                        .overflow_y_scroll()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(if state.injection.content.is_empty() {
                                    CatppuccinMocha::overlay0()
                                } else {
                                    CatppuccinMocha::text()
                                })
                                .child(if state.injection.content.is_empty() {
                                    "Enter context content...".to_string()
                                } else {
                                    state.injection.content.clone()
                                })
                        )
                )
        )
        // Priority selector
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(CatppuccinMocha::subtext0())
                        .child("Priority")
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .children(ContextPriority::all().iter().map(|priority| {
                            let is_selected = state.injection.priority == *priority;
                            div()
                                .id(format!("priority-{:?}", priority))
                                .flex_grow()
                                .py(px(6.0))
                                .rounded(px(4.0))
                                .bg(if is_selected {
                                    CatppuccinMocha::blue()
                                } else {
                                    CatppuccinMocha::surface0()
                                })
                                .cursor_pointer()
                                .hover(|s| s.bg(if is_selected {
                                    CatppuccinMocha::blue()
                                } else {
                                    CatppuccinMocha::surface1()
                                }))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(if is_selected {
                                            CatppuccinMocha::crust()
                                        } else {
                                            CatppuccinMocha::subtext0()
                                        })
                                        .child(priority.label())
                                )
                        }))
                )
        )
        // Inject button
        .child(
            div()
                .id("inject-button")
                .w_full()
                .py(px(10.0))
                .rounded(px(6.0))
                .bg(CatppuccinMocha::green())
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::green().opacity(0.9)))
                .on_click(move |_event, _window, _cx| {
                    on_inject();
                })
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::crust())
                        .child("Inject Context")
                )
        )
}

/// Render compact context indicator (for main UI)
pub fn render_context_indicator<F>(
    theme: &Theme,
    state: &ContextState,
    on_click: F,
) -> Div
where
    F: Fn() + 'static,
{
    let enabled_count = state.sources.iter().filter(|s| s.enabled).count();
    let total_tokens = state.get_total_tokens();
    let is_over = state.is_over_limit();

    div()
        .id("context-indicator")
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(if is_over {
            CatppuccinMocha::red().opacity(0.5)
        } else {
            CatppuccinMocha::surface1()
        })
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface1()))
        .on_click(move |_event, _window, _cx| {
            on_click();
        })
        // Context icon
        .child(
            div()
                .size(px(18.0))
                .rounded(px(4.0))
                .bg(CatppuccinMocha::blue().opacity(0.2))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(CatppuccinMocha::blue())
                        .child("C")
                )
        )
        // Source count
        .child(
            div()
                .text_size(px(11.0))
                .text_color(CatppuccinMocha::subtext0())
                .child(format!("{} sources", enabled_count))
        )
        // Token indicator
        .child(
            div()
                .text_size(px(10.0))
                .text_color(if is_over {
                    CatppuccinMocha::red()
                } else {
                    CatppuccinMocha::overlay0()
                })
                .child(format!("{}t", total_tokens))
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate context source ID
fn generate_context_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("ctx-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

/// Generate session ID
fn generate_session_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("session-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

/// Format current time
fn format_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let hours = (secs / 3600) % 24;
    let minutes = (secs / 60) % 60;
    format!("{:02}:{:02}", hours, minutes)
}

/// Estimate token count for text
fn estimate_tokens(text: &str) -> usize {
    // Rough estimation: ~4 chars per token
    (text.len() + 3) / 4
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
    fn test_context_source_creation() {
        let source = ContextSource::new(
            ContextSourceType::Portfolio,
            "Test Portfolio",
            "Holdings: AAPL, MSFT, GOOGL"
        );
        assert!(!source.id.is_empty());
        assert!(source.enabled);
        assert!(source.token_count > 0);
    }

    #[test]
    fn test_priority_ordering() {
        assert!(ContextPriority::Critical > ContextPriority::High);
        assert!(ContextPriority::High > ContextPriority::Medium);
        assert!(ContextPriority::Medium > ContextPriority::Low);
    }

    #[test]
    fn test_priority_navigation() {
        assert_eq!(ContextPriority::Low.next(), ContextPriority::Medium);
        assert_eq!(ContextPriority::Critical.next(), ContextPriority::Critical);
        assert_eq!(ContextPriority::Low.prev(), ContextPriority::Low);
    }

    #[test]
    fn test_context_state() {
        let mut state = ContextState::new();
        assert!(!state.sources.is_empty());

        let source = ContextSource::new(
            ContextSourceType::Custom,
            "Test",
            "Test content"
        );
        let id = source.id.clone();
        state.add_source(source);

        assert!(state.sources.iter().any(|s| s.id == id));

        state.toggle_source(&id);
        let found = state.sources.iter().find(|s| s.id == id).unwrap();
        assert!(!found.enabled);
    }

    #[test]
    fn test_session_entry() {
        let session = SessionEntry::new("Test Session")
            .with_symbols(vec!["AAPL".to_string(), "MSFT".to_string()])
            .with_summary("Analyzed tech stocks");

        assert!(!session.id.is_empty());
        assert_eq!(session.symbols.len(), 2);
        assert!(session.summary.is_some());
    }

    #[test]
    fn test_token_estimation() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("test"), 1);
        assert!(estimate_tokens("this is a longer text") > 0);
    }

    #[test]
    fn test_context_build() {
        let state = ContextState::new();
        let context = state.build_context_string();
        // Should have some content from default sources
        assert!(!context.is_empty());
    }
}
