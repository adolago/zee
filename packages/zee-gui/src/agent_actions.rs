//! Agent Actions for Stanley GUI
//!
//! Provides action-oriented features for agent interactions:
//! - Quick action buttons (Analyze, Compare, Research)
//! - Drag-drop symbols into chat
//! - Copy response to notes
//! - Export to PDF/Excel
//! - Share analysis via link

use crate::components::streaming::CatppuccinMocha;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =============================================================================
// Quick Action Types
// =============================================================================

/// Type of quick action
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QuickActionType {
    Analyze,
    Compare,
    Research,
    Summarize,
    Alert,
    Trade,
    Custom,
}

impl QuickActionType {
    pub fn label(&self) -> &'static str {
        match self {
            QuickActionType::Analyze => "Analyze",
            QuickActionType::Compare => "Compare",
            QuickActionType::Research => "Research",
            QuickActionType::Summarize => "Summarize",
            QuickActionType::Alert => "Set Alert",
            QuickActionType::Trade => "Trade",
            QuickActionType::Custom => "Custom",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            QuickActionType::Analyze => "A",
            QuickActionType::Compare => "C",
            QuickActionType::Research => "R",
            QuickActionType::Summarize => "S",
            QuickActionType::Alert => "!",
            QuickActionType::Trade => "$",
            QuickActionType::Custom => "*",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            QuickActionType::Analyze => CatppuccinMocha::blue(),
            QuickActionType::Compare => CatppuccinMocha::mauve(),
            QuickActionType::Research => CatppuccinMocha::green(),
            QuickActionType::Summarize => CatppuccinMocha::peach(),
            QuickActionType::Alert => CatppuccinMocha::yellow(),
            QuickActionType::Trade => CatppuccinMocha::teal(),
            QuickActionType::Custom => CatppuccinMocha::pink(),
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            QuickActionType::Analyze => "Deep analysis of metrics and trends",
            QuickActionType::Compare => "Compare with peers or benchmarks",
            QuickActionType::Research => "Full research report",
            QuickActionType::Summarize => "Quick summary of key points",
            QuickActionType::Alert => "Set price or event alerts",
            QuickActionType::Trade => "Trade ideas and execution",
            QuickActionType::Custom => "Custom query",
        }
    }

    pub fn all() -> &'static [QuickActionType] {
        &[
            QuickActionType::Analyze,
            QuickActionType::Compare,
            QuickActionType::Research,
            QuickActionType::Summarize,
            QuickActionType::Alert,
            QuickActionType::Trade,
        ]
    }
}

/// Quick action definition
#[derive(Debug, Clone)]
pub struct QuickActionButton {
    pub id: String,
    pub action_type: QuickActionType,
    pub label: String,
    pub prompt_template: String,
    pub requires_symbol: bool,
    pub keyboard_shortcut: Option<String>,
}

impl QuickActionButton {
    pub fn new(action_type: QuickActionType) -> Self {
        let prompt_template = match action_type {
            QuickActionType::Analyze => "Provide a detailed analysis of {symbol} including fundamentals, technicals, and market positioning.".to_string(),
            QuickActionType::Compare => "Compare {symbol} with its sector peers on key metrics including valuation, growth, and profitability.".to_string(),
            QuickActionType::Research => "Generate a comprehensive research report on {symbol} covering business model, financials, risks, and investment thesis.".to_string(),
            QuickActionType::Summarize => "Give me a quick summary of {symbol}'s current situation and recent developments.".to_string(),
            QuickActionType::Alert => "What price levels and events should I monitor for {symbol}?".to_string(),
            QuickActionType::Trade => "Analyze potential trade setups for {symbol} with entry, exit, and risk parameters.".to_string(),
            QuickActionType::Custom => "{query}".to_string(),
        };

        Self {
            id: generate_action_id(),
            action_type,
            label: action_type.label().to_string(),
            prompt_template,
            requires_symbol: action_type != QuickActionType::Custom,
            keyboard_shortcut: Self::default_shortcut(action_type),
        }
    }

    fn default_shortcut(action_type: QuickActionType) -> Option<String> {
        match action_type {
            QuickActionType::Analyze => Some("Cmd+1".to_string()),
            QuickActionType::Compare => Some("Cmd+2".to_string()),
            QuickActionType::Research => Some("Cmd+3".to_string()),
            QuickActionType::Summarize => Some("Cmd+4".to_string()),
            _ => None,
        }
    }

    /// Build the final prompt with symbol substitution
    pub fn build_prompt(&self, symbol: Option<&str>, custom_query: Option<&str>) -> String {
        let mut prompt = self.prompt_template.clone();

        if let Some(s) = symbol {
            prompt = prompt.replace("{symbol}", s);
        }
        if let Some(q) = custom_query {
            prompt = prompt.replace("{query}", q);
        }

        prompt
    }
}

// =============================================================================
// Drag-Drop Symbol Support
// =============================================================================

/// Drag-drop state for symbols
#[derive(Debug, Clone, Default)]
pub struct DragDropState {
    /// Currently dragged symbol
    pub dragging_symbol: Option<String>,
    /// Source of the drag (e.g., "watchlist", "portfolio")
    pub drag_source: Option<String>,
    /// Whether currently over a valid drop target
    pub over_drop_zone: bool,
    /// Drop zone identifier
    pub drop_zone_id: Option<String>,
}

impl DragDropState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start dragging a symbol
    pub fn start_drag(&mut self, symbol: &str, source: &str) {
        self.dragging_symbol = Some(symbol.to_string());
        self.drag_source = Some(source.to_string());
    }

    /// End dragging
    pub fn end_drag(&mut self) {
        self.dragging_symbol = None;
        self.drag_source = None;
        self.over_drop_zone = false;
        self.drop_zone_id = None;
    }

    /// Enter a drop zone
    pub fn enter_drop_zone(&mut self, zone_id: &str) {
        self.over_drop_zone = true;
        self.drop_zone_id = Some(zone_id.to_string());
    }

    /// Leave drop zone
    pub fn leave_drop_zone(&mut self) {
        self.over_drop_zone = false;
        self.drop_zone_id = None;
    }

    /// Check if dragging
    pub fn is_dragging(&self) -> bool {
        self.dragging_symbol.is_some()
    }
}

/// Draggable symbol chip that can be dropped into chat
pub fn render_draggable_symbol<F, G>(
    theme: &Theme,
    symbol: &str,
    source: &str,
    on_drag_start: F,
    on_click: G,
) -> impl IntoElement
where
    F: Fn(&str, &str) + 'static,
    G: Fn(&str) + 'static,
{
    let symbol_owned = symbol.to_string();
    let symbol_for_click = symbol.to_string();
    let source_owned = source.to_string();

    div()
        .id(format!("symbol-{}", symbol))
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(CatppuccinMocha::surface1())
        .border_1()
        .border_color(CatppuccinMocha::surface2())
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface2()).border_color(CatppuccinMocha::blue()))
        // Note: GPUI doesn't have native drag-drop, so we use click handlers
        .on_click(move |_event, _window, _cx| {
            on_click(&symbol_for_click);
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                // Drag handle indicator
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay0())
                        .child("::")
                )
                // Symbol text
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::text())
                        .child(symbol_owned.clone())
                )
        )
}

/// Drop zone for symbols in chat
pub fn render_symbol_drop_zone<F>(
    theme: &Theme,
    is_active: bool,
    placeholder: &str,
    on_drop: F,
) -> Div
where
    F: Fn(&str) + 'static,
{
    div()
        .id("symbol-drop-zone")
        .w_full()
        .h(px(48.0))
        .rounded(px(8.0))
        .border_2()
        .border_style(if is_active {
            BorderStyle::Solid
        } else {
            BorderStyle::Hidden // GPUI uses BorderStyle
        })
        .border_color(if is_active {
            CatppuccinMocha::blue()
        } else {
            CatppuccinMocha::surface1()
        })
        .bg(if is_active {
            CatppuccinMocha::blue().opacity(0.1)
        } else {
            CatppuccinMocha::surface0().opacity(0.5)
        })
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(12.0))
                .text_color(if is_active {
                    CatppuccinMocha::blue()
                } else {
                    CatppuccinMocha::overlay1()
                })
                .child(if is_active {
                    "Drop symbol here".to_string()
                } else {
                    placeholder.to_string()
                })
        )
}

// =============================================================================
// Export Actions
// =============================================================================

/// Export format options
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportFormat {
    Markdown,
    PDF,
    Excel,
    JSON,
    PlainText,
}

impl ExportFormat {
    pub fn label(&self) -> &'static str {
        match self {
            ExportFormat::Markdown => "Markdown",
            ExportFormat::PDF => "PDF",
            ExportFormat::Excel => "Excel",
            ExportFormat::JSON => "JSON",
            ExportFormat::PlainText => "Plain Text",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            ExportFormat::Markdown => "md",
            ExportFormat::PDF => "pdf",
            ExportFormat::Excel => "xlsx",
            ExportFormat::JSON => "json",
            ExportFormat::PlainText => "txt",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            ExportFormat::Markdown => "M",
            ExportFormat::PDF => "P",
            ExportFormat::Excel => "X",
            ExportFormat::JSON => "J",
            ExportFormat::PlainText => "T",
        }
    }

    pub fn all() -> &'static [ExportFormat] {
        &[
            ExportFormat::Markdown,
            ExportFormat::PDF,
            ExportFormat::Excel,
            ExportFormat::JSON,
            ExportFormat::PlainText,
        ]
    }
}

/// Export options for agent responses
#[derive(Debug, Clone)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub include_metadata: bool,
    pub include_tool_calls: bool,
    pub include_citations: bool,
    pub filename_prefix: String,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            format: ExportFormat::Markdown,
            include_metadata: true,
            include_tool_calls: true,
            include_citations: true,
            filename_prefix: "stanley-analysis".to_string(),
        }
    }
}

impl ExportOptions {
    /// Generate filename based on options
    pub fn generate_filename(&self, symbol: Option<&str>) -> String {
        let timestamp = chrono_now_short();
        let symbol_part = symbol.map(|s| format!("-{}", s)).unwrap_or_default();
        format!(
            "{}{}-{}.{}",
            self.filename_prefix,
            symbol_part,
            timestamp,
            self.format.extension()
        )
    }
}

// =============================================================================
// Copy to Notes Actions
// =============================================================================

/// Note type for copying agent responses
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoteType {
    Research,
    Thesis,
    TradeIdea,
    Meeting,
    General,
}

impl NoteType {
    pub fn label(&self) -> &'static str {
        match self {
            NoteType::Research => "Research Note",
            NoteType::Thesis => "Investment Thesis",
            NoteType::TradeIdea => "Trade Idea",
            NoteType::Meeting => "Meeting Note",
            NoteType::General => "General Note",
        }
    }

    pub fn folder(&self) -> &'static str {
        match self {
            NoteType::Research => "research",
            NoteType::Thesis => "theses",
            NoteType::TradeIdea => "trades",
            NoteType::Meeting => "meetings",
            NoteType::General => "notes",
        }
    }

    pub fn all() -> &'static [NoteType] {
        &[
            NoteType::Research,
            NoteType::Thesis,
            NoteType::TradeIdea,
            NoteType::Meeting,
            NoteType::General,
        ]
    }
}

/// Options for copying response to notes
#[derive(Debug, Clone)]
pub struct CopyToNotesOptions {
    pub note_type: NoteType,
    pub title: String,
    pub symbol: Option<String>,
    pub tags: Vec<String>,
    pub append_to_existing: bool,
}

impl Default for CopyToNotesOptions {
    fn default() -> Self {
        Self {
            note_type: NoteType::General,
            title: String::new(),
            symbol: None,
            tags: Vec::new(),
            append_to_existing: false,
        }
    }
}

// =============================================================================
// Share Analysis Actions
// =============================================================================

/// Share method options
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShareMethod {
    Link,
    Email,
    Slack,
    Teams,
    Clipboard,
}

impl ShareMethod {
    pub fn label(&self) -> &'static str {
        match self {
            ShareMethod::Link => "Copy Link",
            ShareMethod::Email => "Email",
            ShareMethod::Slack => "Slack",
            ShareMethod::Teams => "Teams",
            ShareMethod::Clipboard => "Clipboard",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            ShareMethod::Link => "L",
            ShareMethod::Email => "@",
            ShareMethod::Slack => "S",
            ShareMethod::Teams => "T",
            ShareMethod::Clipboard => "C",
        }
    }

    pub fn all() -> &'static [ShareMethod] {
        &[
            ShareMethod::Link,
            ShareMethod::Clipboard,
            ShareMethod::Email,
            ShareMethod::Slack,
            ShareMethod::Teams,
        ]
    }
}

/// Share options
#[derive(Debug, Clone)]
pub struct ShareOptions {
    pub method: ShareMethod,
    pub include_charts: bool,
    pub include_data: bool,
    pub expiry_hours: Option<u32>,
    pub password_protected: bool,
}

impl Default for ShareOptions {
    fn default() -> Self {
        Self {
            method: ShareMethod::Link,
            include_charts: true,
            include_data: true,
            expiry_hours: Some(72),
            password_protected: false,
        }
    }
}

// =============================================================================
// Action Bar State
// =============================================================================

/// State for the action bar
#[derive(Debug, Clone)]
pub struct ActionBarState {
    /// Available quick actions
    pub quick_actions: Vec<QuickActionButton>,
    /// Current export options
    pub export_options: ExportOptions,
    /// Current copy to notes options
    pub copy_options: CopyToNotesOptions,
    /// Current share options
    pub share_options: ShareOptions,
    /// Whether the action menu is open
    pub menu_open: bool,
    /// Which submenu is open
    pub active_submenu: Option<ActionSubmenu>,
    /// Selected symbol for actions
    pub selected_symbol: Option<String>,
    /// Drag-drop state
    pub drag_drop: DragDropState,
    /// Last action result
    pub last_action_result: Option<ActionResult>,
}

/// Submenu types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionSubmenu {
    Export,
    CopyToNotes,
    Share,
    QuickActions,
}

/// Result of an action
#[derive(Debug, Clone)]
pub struct ActionResult {
    pub success: bool,
    pub message: String,
    pub action_type: String,
    pub timestamp: String,
}

impl Default for ActionBarState {
    fn default() -> Self {
        Self {
            quick_actions: QuickActionType::all()
                .iter()
                .map(|t| QuickActionButton::new(*t))
                .collect(),
            export_options: ExportOptions::default(),
            copy_options: CopyToNotesOptions::default(),
            share_options: ShareOptions::default(),
            menu_open: false,
            active_submenu: None,
            selected_symbol: None,
            drag_drop: DragDropState::new(),
            last_action_result: None,
        }
    }
}

impl ActionBarState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Toggle menu open state
    pub fn toggle_menu(&mut self) {
        self.menu_open = !self.menu_open;
        if !self.menu_open {
            self.active_submenu = None;
        }
    }

    /// Open a specific submenu
    pub fn open_submenu(&mut self, submenu: ActionSubmenu) {
        self.menu_open = true;
        self.active_submenu = Some(submenu);
    }

    /// Close all menus
    pub fn close_menus(&mut self) {
        self.menu_open = false;
        self.active_submenu = None;
    }

    /// Set action result
    pub fn set_result(&mut self, success: bool, message: &str, action_type: &str) {
        self.last_action_result = Some(ActionResult {
            success,
            message: message.to_string(),
            action_type: action_type.to_string(),
            timestamp: chrono_now_short(),
        });
    }

    /// Clear action result
    pub fn clear_result(&mut self) {
        self.last_action_result = None;
    }
}

// =============================================================================
// Rendering
// =============================================================================

/// Render the quick action buttons bar
pub fn render_quick_action_bar<F>(
    theme: &Theme,
    state: &ActionBarState,
    on_action: F,
) -> Div
where
    F: Fn(QuickActionType, Option<&str>) + Clone + 'static,
{
    div()
        .id("quick-action-bar")
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(12.0))
        .py(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .rounded(px(8.0))
        // Quick action buttons
        .children(state.quick_actions.iter().take(4).map(|action| {
            let callback = on_action.clone();
            let action_type = action.action_type;
            let symbol = state.selected_symbol.clone();
            render_quick_action_button(theme, action, move || {
                callback(action_type, symbol.as_deref());
            })
        }))
        // More actions dropdown
        .child(
            div()
                .id("more-actions")
                .px(px(10.0))
                .py(px(6.0))
                .rounded(px(6.0))
                .bg(CatppuccinMocha::surface1())
                .border_1()
                .border_color(CatppuccinMocha::surface2())
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface2()))
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::subtext0())
                        .child("...")
                )
        )
}

/// Render a single quick action button
fn render_quick_action_button<F>(
    theme: &Theme,
    action: &QuickActionButton,
    on_click: F,
) -> impl IntoElement
where
    F: Fn() + 'static,
{
    let color = action.action_type.color();

    div()
        .id(action.id.clone())
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(color.opacity(0.12))
        .border_1()
        .border_color(color.opacity(0.25))
        .cursor_pointer()
        .hover(|s| s.bg(color.opacity(0.2)))
        .on_click(move |_event, _window, _cx| {
            on_click();
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                // Icon
                .child(
                    div()
                        .size(px(18.0))
                        .rounded(px(4.0))
                        .bg(color.opacity(0.2))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(color)
                                .child(action.action_type.icon())
                        )
                )
                // Label
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(CatppuccinMocha::text())
                        .child(action.label.clone())
                )
                // Shortcut hint
                .when_some(action.keyboard_shortcut.clone(), |el, shortcut| {
                    el.child(
                        div()
                            .px(px(4.0))
                            .py(px(1.0))
                            .rounded(px(2.0))
                            .bg(CatppuccinMocha::surface0())
                            .child(
                                div()
                                    .text_size(px(9.0))
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child(shortcut)
                            )
                    )
                })
        )
}

/// Render the response action bar (copy, export, share)
pub fn render_response_actions<F>(
    theme: &Theme,
    state: &ActionBarState,
    on_copy: F,
    on_export: impl Fn(ExportFormat) + Clone + 'static,
    on_share: impl Fn(ShareMethod) + Clone + 'static,
) -> Div
where
    F: Fn() + 'static,
{
    div()
        .id("response-actions")
        .flex()
        .items_center()
        .gap(px(4.0))
        // Copy button
        .child(render_action_icon_button(
            theme,
            "copy",
            "C",
            "Copy",
            CatppuccinMocha::blue(),
            on_copy,
        ))
        // Export button with dropdown
        .child({
            let export_callback = on_export.clone();
            render_action_dropdown(
                theme,
                "export",
                "E",
                "Export",
                CatppuccinMocha::green(),
                ExportFormat::all()
                    .iter()
                    .map(|f| (f.label().to_string(), *f))
                    .collect(),
                move |format| export_callback(format),
            )
        })
        // Share button with dropdown
        .child({
            let share_callback = on_share;
            render_action_dropdown(
                theme,
                "share",
                "S",
                "Share",
                CatppuccinMocha::mauve(),
                ShareMethod::all()
                    .iter()
                    .map(|m| (m.label().to_string(), *m))
                    .collect(),
                move |method| share_callback(method),
            )
        })
        // Save to notes button
        .child(render_action_icon_button(
            theme,
            "save-note",
            "N",
            "Save to Notes",
            CatppuccinMocha::peach(),
            || {},
        ))
}

/// Render an icon-only action button
fn render_action_icon_button<F>(
    theme: &Theme,
    id: &str,
    icon: &str,
    tooltip: &str,
    color: Hsla,
    on_click: F,
) -> impl IntoElement
where
    F: Fn() + 'static,
{
    div()
        .id(id.to_string())
        .size(px(28.0))
        .rounded(px(6.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .cursor_pointer()
        .hover(|s| s.bg(color.opacity(0.15)).border_color(color.opacity(0.3)))
        .on_click(move |_event, _window, _cx| {
            on_click();
        })
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(CatppuccinMocha::subtext0())
                .child(icon.to_string())
        )
}

/// Render an action button with dropdown menu
fn render_action_dropdown<T, F>(
    theme: &Theme,
    id: &str,
    icon: &str,
    label: &str,
    color: Hsla,
    options: Vec<(String, T)>,
    on_select: F,
) -> Div
where
    T: Clone + 'static,
    F: Fn(T) + Clone + 'static,
{
    // Simplified dropdown - just shows the button (full dropdown would need modal state)
    div()
        .id(id.to_string())
        .relative()
        .child(
            div()
                .px(px(8.0))
                .py(px(4.0))
                .rounded(px(6.0))
                .bg(CatppuccinMocha::surface0())
                .border_1()
                .border_color(CatppuccinMocha::surface1())
                .cursor_pointer()
                .hover(|s| s.bg(color.opacity(0.15)).border_color(color.opacity(0.3)))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(color)
                                .child(icon.to_string())
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::subtext0())
                                .child(label.to_string())
                        )
                        .child(
                            div()
                                .text_size(px(8.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("v")
                        )
                )
        )
}

/// Render action result toast notification
pub fn render_action_result(theme: &Theme, result: &ActionResult) -> Div {
    let color = if result.success {
        CatppuccinMocha::green()
    } else {
        CatppuccinMocha::red()
    };

    div()
        .id("action-result")
        .fixed()
        .bottom(px(20.0))
        .right(px(20.0))
        .px(px(16.0))
        .py(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::mantle())
        .border_1()
        .border_color(color.opacity(0.3))
        .shadow_lg()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                // Status icon
                .child(
                    div()
                        .size(px(20.0))
                        .rounded_full()
                        .bg(color.opacity(0.2))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(color)
                                .child(if result.success { "+" } else { "!" })
                        )
                )
                // Message
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(result.message.clone())
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(format!("{} - {}", result.action_type, result.timestamp))
                        )
                )
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate unique action ID
fn generate_action_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("action-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

/// Get current timestamp (short format)
fn chrono_now_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let hours = (secs / 3600) % 24;
    let minutes = (secs / 60) % 60;
    format!("{:02}:{:02}", hours, minutes)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quick_action_button() {
        let action = QuickActionButton::new(QuickActionType::Analyze);
        assert!(action.requires_symbol);
        assert!(!action.id.is_empty());
    }

    #[test]
    fn test_prompt_building() {
        let action = QuickActionButton::new(QuickActionType::Analyze);
        let prompt = action.build_prompt(Some("AAPL"), None);
        assert!(prompt.contains("AAPL"));
        assert!(!prompt.contains("{symbol}"));
    }

    #[test]
    fn test_export_filename() {
        let options = ExportOptions {
            format: ExportFormat::PDF,
            filename_prefix: "analysis".to_string(),
            ..Default::default()
        };
        let filename = options.generate_filename(Some("AAPL"));
        assert!(filename.contains("AAPL"));
        assert!(filename.ends_with(".pdf"));
    }

    #[test]
    fn test_drag_drop_state() {
        let mut state = DragDropState::new();
        assert!(!state.is_dragging());

        state.start_drag("AAPL", "watchlist");
        assert!(state.is_dragging());
        assert_eq!(state.dragging_symbol, Some("AAPL".to_string()));

        state.end_drag();
        assert!(!state.is_dragging());
    }

    #[test]
    fn test_action_bar_state() {
        let mut state = ActionBarState::new();
        assert!(!state.menu_open);

        state.toggle_menu();
        assert!(state.menu_open);

        state.open_submenu(ActionSubmenu::Export);
        assert_eq!(state.active_submenu, Some(ActionSubmenu::Export));

        state.close_menus();
        assert!(!state.menu_open);
        assert!(state.active_submenu.is_none());
    }

    #[test]
    fn test_action_result() {
        let mut state = ActionBarState::new();
        state.set_result(true, "Copied to clipboard", "copy");

        assert!(state.last_action_result.is_some());
        let result = state.last_action_result.as_ref().unwrap();
        assert!(result.success);
        assert_eq!(result.message, "Copied to clipboard");
    }
}
