//! Notes View for Stanley GUI Research Vault
//!
//! Displays research notes, investment theses, and trade journal:
//! - Notes: Research notes with tags and symbols
//! - Theses: Active investment theses with conviction levels
//! - Trades: Trade journal with P&L tracking
//! - Events: Market events and catalysts

#![allow(dead_code)]

use crate::api::{ApiError, ApiResponse, ZeeApiClient};
use crate::app::LoadState;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::Deserialize;

// ============================================================================
// DATA TYPES FOR NOTES
// ============================================================================

/// Note type classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NoteType {
    #[default]
    Research,
    Thesis,
    Trade,
    Event,
    Daily,
}

impl NoteType {
    pub fn label(&self) -> &'static str {
        match self {
            NoteType::Research => "Research",
            NoteType::Thesis => "Thesis",
            NoteType::Trade => "Trade",
            NoteType::Event => "Event",
            NoteType::Daily => "Daily",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            NoteType::Research => "R",
            NoteType::Thesis => "T",
            NoteType::Trade => "J",
            NoteType::Event => "E",
            NoteType::Daily => "D",
        }
    }
}

/// Research note from API
#[derive(Debug, Deserialize, Clone)]
pub struct Note {
    pub name: String,
    #[serde(rename = "noteType", default)]
    pub note_type: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub symbols: Vec<String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
}

impl Note {
    pub fn get_type(&self) -> NoteType {
        match self.note_type.as_str() {
            "research" => NoteType::Research,
            "thesis" => NoteType::Thesis,
            "trade" => NoteType::Trade,
            "event" => NoteType::Event,
            "daily" => NoteType::Daily,
            _ => NoteType::Research,
        }
    }
}

/// Investment thesis from API
#[derive(Debug, Deserialize, Clone)]
pub struct Thesis {
    pub name: String,
    pub symbol: String,
    pub direction: String,  // "long" or "short"
    pub status: String,     // "active", "closed", "watching"
    pub conviction: String, // "low", "medium", "high"
    #[serde(rename = "entryPrice")]
    pub entry_price: Option<f64>,
    #[serde(rename = "targetPrice")]
    pub target_price: Option<f64>,
    #[serde(rename = "stopLoss")]
    pub stop_loss: Option<f64>,
    #[serde(rename = "thesisSummary", default)]
    pub thesis_summary: String,
    #[serde(rename = "catalysts", default)]
    pub catalysts: Vec<String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: String,
}

/// Trade journal entry from API
#[derive(Debug, Deserialize, Clone)]
pub struct TradeEntry {
    pub name: String,
    pub symbol: String,
    pub direction: String, // "long" or "short"
    #[serde(rename = "entryDate")]
    pub entry_date: String,
    #[serde(rename = "entryPrice")]
    pub entry_price: f64,
    #[serde(rename = "exitDate")]
    pub exit_date: Option<String>,
    #[serde(rename = "exitPrice")]
    pub exit_price: Option<f64>,
    pub quantity: Option<f64>,
    pub pnl: Option<f64>,
    #[serde(rename = "pnlPercent")]
    pub pnl_percent: Option<f64>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Market event
#[derive(Debug, Deserialize, Clone)]
pub struct MarketEvent {
    pub name: String,
    #[serde(rename = "eventType")]
    pub event_type: String, // "earnings", "fed", "economic", "company"
    #[serde(rename = "eventDate")]
    pub event_date: String,
    pub symbol: Option<String>,
    pub description: String,
    pub impact: String, // "high", "medium", "low"
    #[serde(default)]
    pub completed: bool,
}

/// Trade statistics summary
#[derive(Debug, Deserialize, Clone)]
pub struct TradeStats {
    #[serde(rename = "totalTrades")]
    pub total_trades: i32,
    #[serde(rename = "winningTrades")]
    pub winning_trades: i32,
    #[serde(rename = "losingTrades")]
    pub losing_trades: i32,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
    #[serde(rename = "totalPnl")]
    pub total_pnl: f64,
    #[serde(rename = "avgWin")]
    pub avg_win: f64,
    #[serde(rename = "avgLoss")]
    pub avg_loss: f64,
    #[serde(rename = "profitFactor")]
    pub profit_factor: f64,
}

/// Active tab within notes view
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NotesTab {
    #[default]
    Notes,
    Theses,
    Trades,
    Events,
}

impl NotesTab {
    pub fn label(&self) -> &'static str {
        match self {
            NotesTab::Notes => "Notes",
            NotesTab::Theses => "Theses",
            NotesTab::Trades => "Trade Journal",
            NotesTab::Events => "Events",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            NotesTab::Notes => "N",
            NotesTab::Theses => "T",
            NotesTab::Trades => "J",
            NotesTab::Events => "E",
        }
    }
}

// ============================================================================
// API CLIENT EXTENSIONS FOR NOTES
// ============================================================================

impl ZeeApiClient {
    /// Get all research notes
    pub async fn get_notes(&self) -> Result<ApiResponse<Vec<Note>>, ApiError> {
        let url = format!("{}/api/notes", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get a specific note by name
    pub async fn get_note(&self, name: &str) -> Result<ApiResponse<Note>, ApiError> {
        let url = format!("{}/api/notes/{}", self.base_url, name);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Search notes (notes view version)
    pub async fn search_research_notes(
        &self,
        query: &str,
    ) -> Result<ApiResponse<Vec<Note>>, ApiError> {
        let url = format!("{}/api/notes/search?q={}", self.base_url, query);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get all investment theses (notes view version)
    pub async fn get_theses_notes(&self) -> Result<ApiResponse<Vec<Thesis>>, ApiError> {
        let url = format!("{}/api/theses", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get trade journal entries (notes view version)
    pub async fn get_trades_notes(&self) -> Result<ApiResponse<Vec<TradeEntry>>, ApiError> {
        let url = format!("{}/api/trades", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get trade statistics (notes view version)
    pub async fn get_trade_stats_notes(&self) -> Result<ApiResponse<TradeStats>, ApiError> {
        let url = format!("{}/api/trades/stats", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get market events (notes view version)
    pub async fn get_market_events(&self) -> Result<ApiResponse<Vec<MarketEvent>>, ApiError> {
        let url = format!("{}/api/events", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response
            .json()
            .await
            .map_err(|e| ApiError::Parse(e.to_string()))
    }
}

// ============================================================================
// NOTES VIEW STATE
// ============================================================================

/// State for notes view
pub struct NotesState {
    pub active_tab: NotesTab,
    pub notes: LoadState<Vec<Note>>,
    pub theses: LoadState<Vec<Thesis>>,
    pub trades: LoadState<Vec<TradeEntry>>,
    pub events: LoadState<Vec<MarketEvent>>,
    pub trade_stats: LoadState<TradeStats>,
    pub selected_note: Option<String>,
    pub search_query: String,
    pub filter_type: Option<NoteType>,
    pub filter_symbol: Option<String>,
}

impl Default for NotesState {
    fn default() -> Self {
        Self {
            active_tab: NotesTab::Notes,
            notes: LoadState::NotLoaded,
            theses: LoadState::NotLoaded,
            trades: LoadState::NotLoaded,
            events: LoadState::NotLoaded,
            trade_stats: LoadState::NotLoaded,
            selected_note: None,
            search_query: String::new(),
            filter_type: None,
            filter_symbol: None,
        }
    }
}

// ============================================================================
// NOTES VIEW RENDERING
// ============================================================================

/// Render the main notes view
pub fn render_notes(theme: &Theme, state: &NotesState, _cx: &mut Context<impl Sized>) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .child(render_notes_header(theme, state))
        .child(render_notes_content(theme, state))
}

/// Render notes header with tab navigation
fn render_notes_header(theme: &Theme, state: &NotesState) -> impl IntoElement {
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
                        .child("Research Vault"),
                )
                // Tab navigation
                .child(
                    div()
                        .flex()
                        .gap(px(4.0))
                        .child(render_tab_button(theme, NotesTab::Notes, state.active_tab))
                        .child(render_tab_button(theme, NotesTab::Theses, state.active_tab))
                        .child(render_tab_button(theme, NotesTab::Trades, state.active_tab))
                        .child(render_tab_button(theme, NotesTab::Events, state.active_tab)),
                ),
        )
        .child(
            // Search bar placeholder
            div()
                .w(px(240.0))
                .h(px(32.0))
                .px(px(12.0))
                .rounded(px(6.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border_subtle)
                .flex()
                .items_center()
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_dimmed)
                        .child(if state.search_query.is_empty() {
                            "Search notes...".to_string()
                        } else {
                            state.search_query.clone()
                        }),
                ),
        )
}

/// Render tab button
fn render_tab_button(theme: &Theme, tab: NotesTab, active: NotesTab) -> impl IntoElement {
    let is_active = tab == active;

    div()
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
        .text_size(px(13.0))
        .font_weight(if is_active {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        })
        .hover(|s| s.bg(theme.hover_bg))
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .size(px(18.0))
                .rounded(px(4.0))
                .bg(if is_active {
                    theme.accent.opacity(0.2)
                } else {
                    theme.card_bg_elevated
                })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .text_color(if is_active {
                    theme.accent
                } else {
                    theme.text_dimmed
                })
                .child(tab.icon()),
        )
        .child(tab.label())
}

/// Render content based on active tab
fn render_notes_content(theme: &Theme, state: &NotesState) -> Div {
    match state.active_tab {
        NotesTab::Notes => render_notes_tab(theme, state),
        NotesTab::Theses => render_theses_tab(theme, state),
        NotesTab::Trades => render_trades_tab(theme, state),
        NotesTab::Events => render_events_tab(theme, state),
    }
}

// ============================================================================
// NOTES TAB
// ============================================================================

fn render_notes_tab(theme: &Theme, state: &NotesState) -> Div {
    div()
        .flex_grow()
        .flex()
        .flex_row()
        // Left sidebar: note list
        .child(render_notes_sidebar(theme, state))
        // Right: note content
        .child(render_note_content(theme, state))
}

/// Render notes sidebar with list
fn render_notes_sidebar(theme: &Theme, state: &NotesState) -> impl IntoElement {
    div()
        .w(px(320.0))
        .h_full()
        .flex()
        .flex_col()
        .border_r_1()
        .border_color(theme.border_subtle)
        .bg(theme.sidebar_bg)
        // Filter bar
        .child(
            div()
                .px(px(16.0))
                .py(px(12.0))
                .border_b_1()
                .border_color(theme.border_subtle)
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(filter_chip(theme, "All", state.filter_type.is_none()))
                .child(filter_chip(
                    theme,
                    "Research",
                    matches!(state.filter_type, Some(NoteType::Research)),
                ))
                .child(filter_chip(
                    theme,
                    "Daily",
                    matches!(state.filter_type, Some(NoteType::Daily)),
                )),
        )
        // Note list
        .child(
            div()
                .flex_grow()
                .overflow_hidden()
                .child(match &state.notes {
                    LoadState::Loading => loading_indicator(theme),
                    LoadState::Error(e) => error_message(theme, e),
                    LoadState::Loaded(notes) => {
                        if notes.is_empty() {
                            empty_state(theme, "No notes yet", "Create your first research note")
                        } else {
                            div().flex().flex_col().children(
                                notes
                                    .iter()
                                    .map(|note| {
                                        render_note_list_item(
                                            theme,
                                            note,
                                            state.selected_note.as_ref(),
                                        )
                                    })
                                    .collect::<Vec<_>>(),
                            )
                        }
                    }
                    _ => loading_indicator(theme),
                }),
        )
}

/// Filter chip
fn filter_chip(theme: &Theme, label: &str, is_active: bool) -> impl IntoElement {
    div()
        .px(px(10.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .cursor_pointer()
        .bg(if is_active {
            theme.accent_subtle
        } else {
            theme.card_bg
        })
        .text_color(if is_active {
            theme.accent
        } else {
            theme.text_muted
        })
        .text_size(px(11.0))
        .font_weight(if is_active {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        })
        .hover(|s| s.bg(theme.hover_bg))
        .child(label.to_string())
}

/// Render note list item
fn render_note_list_item(
    theme: &Theme,
    note: &Note,
    selected: Option<&String>,
) -> impl IntoElement {
    let is_selected = selected.map(|s| s == &note.name).unwrap_or(false);
    let note_type = note.get_type();

    div()
        .px(px(16.0))
        .py(px(14.0))
        .cursor_pointer()
        .bg(if is_selected {
            theme.accent_subtle
        } else {
            transparent_black()
        })
        .border_b_1()
        .border_color(theme.border_subtle)
        .hover(|s| s.bg(theme.hover_bg))
        .flex()
        .flex_col()
        .gap(px(8.0))
        // Title row
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .child(
                    // Type icon
                    div()
                        .size(px(24.0))
                        .rounded(px(4.0))
                        .bg(note_type_color(theme, note_type).opacity(0.15))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(note_type_color(theme, note_type))
                        .child(note_type.icon()),
                )
                .child(
                    div()
                        .flex_grow()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if is_selected {
                            theme.text
                        } else {
                            theme.text_secondary
                        })
                        .overflow_hidden()
                        .child(note.name.clone()),
                ),
        )
        // Preview text
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.text_dimmed)
                .max_w(px(280.0))
                .overflow_hidden()
                .child(
                    note.content.chars().take(80).collect::<String>()
                        + if note.content.len() > 80 { "..." } else { "" },
                ),
        )
        // Tags and symbols row
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .children(
                    note.symbols
                        .iter()
                        .take(3)
                        .map(|sym| {
                            div()
                                .px(px(6.0))
                                .py(px(2.0))
                                .rounded(px(3.0))
                                .bg(theme.accent.opacity(0.1))
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.accent)
                                .child(sym.clone())
                        })
                        .collect::<Vec<_>>(),
                )
                .children(
                    note.tags
                        .iter()
                        .take(2)
                        .map(|tag| {
                            div()
                                .px(px(6.0))
                                .py(px(2.0))
                                .rounded(px(3.0))
                                .bg(theme.border_subtle)
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child(format!("#{}", tag))
                        })
                        .collect::<Vec<_>>(),
                ),
        )
        // Date
        .child(
            div()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .child(format_relative_time(&note.updated_at)),
        )
}

/// Render note content area
fn render_note_content(theme: &Theme, state: &NotesState) -> impl IntoElement {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.background)
        .child(match (&state.notes, &state.selected_note) {
            (LoadState::Loaded(notes), Some(selected)) => {
                if let Some(note) = notes.iter().find(|n| &n.name == selected) {
                    render_note_detail(theme, note)
                } else {
                    empty_state(theme, "Note not found", "Select a note from the list")
                }
            }
            (LoadState::Loaded(_), None) => empty_state(
                theme,
                "Select a note",
                "Choose a note from the list to view its content",
            ),
            _ => loading_indicator(theme),
        })
}

/// Render note detail
fn render_note_detail(theme: &Theme, note: &Note) -> Div {
    let note_type = note.get_type();

    div()
        .flex_grow()
        .flex()
        .flex_col()
        .overflow_hidden()
        // Header
        .child(
            div()
                .px(px(32.0))
                .py(px(24.0))
                .border_b_1()
                .border_color(theme.border_subtle)
                .flex()
                .flex_col()
                .gap(px(12.0))
                // Title with type badge
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.0))
                        .child(
                            div()
                                .size(px(32.0))
                                .rounded(px(6.0))
                                .bg(note_type_color(theme, note_type).opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(note_type_color(theme, note_type))
                                .child(note_type.icon()),
                        )
                        .child(
                            div()
                                .text_size(px(24.0))
                                .font_weight(FontWeight::BOLD)
                                .child(note.name.clone()),
                        ),
                )
                // Metadata row
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(16.0))
                        // Symbols
                        .child(
                            div().flex().items_center().gap(px(6.0)).children(
                                note.symbols
                                    .iter()
                                    .map(|sym| {
                                        div()
                                            .px(px(10.0))
                                            .py(px(4.0))
                                            .rounded(px(4.0))
                                            .bg(theme.accent.opacity(0.1))
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.accent)
                                            .child(sym.clone())
                                    })
                                    .collect::<Vec<_>>(),
                            ),
                        )
                        // Tags
                        .child(
                            div().flex().items_center().gap(px(6.0)).children(
                                note.tags
                                    .iter()
                                    .map(|tag| {
                                        div()
                                            .px(px(8.0))
                                            .py(px(4.0))
                                            .rounded(px(4.0))
                                            .bg(theme.card_bg)
                                            .text_size(px(11.0))
                                            .text_color(theme.text_muted)
                                            .child(format!("#{}", tag))
                                    })
                                    .collect::<Vec<_>>(),
                            ),
                        )
                        // Date
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_dimmed)
                                .child(format!(
                                    "Updated {}",
                                    format_relative_time(&note.updated_at)
                                )),
                        ),
                ),
        )
        // Content
        .child(
            div().p(px(32.0)).flex().flex_col().child(
                div()
                    .text_size(px(14.0))
                    .text_color(theme.text_secondary)
                    .child(note.content.clone()),
            ),
        )
}

// ============================================================================
// THESES TAB
// ============================================================================

fn render_theses_tab(theme: &Theme, state: &NotesState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        // Summary cards
        .child(render_theses_summary(theme, state))
        // Thesis list
        .child(card(
            theme,
            "Investment Theses",
            match &state.theses {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(theses) => {
                    if theses.is_empty() {
                        empty_state(theme, "No theses", "Create your first investment thesis")
                    } else {
                        div().flex().flex_col().gap(px(12.0)).children(
                            theses
                                .iter()
                                .map(|thesis| render_thesis_card(theme, thesis))
                                .collect::<Vec<_>>(),
                        )
                    }
                }
                _ => loading_indicator(theme),
            },
        ))
}

/// Render theses summary cards
fn render_theses_summary(theme: &Theme, state: &NotesState) -> impl IntoElement {
    let (active, watching, long, short) = match &state.theses {
        LoadState::Loaded(theses) => {
            let active = theses.iter().filter(|t| t.status == "active").count();
            let watching = theses.iter().filter(|t| t.status == "watching").count();
            let long = theses.iter().filter(|t| t.direction == "long").count();
            let short = theses.iter().filter(|t| t.direction == "short").count();
            (active, watching, long, short)
        }
        _ => (0, 0, 0, 0),
    };

    div()
        .flex()
        .gap(px(16.0))
        .child(summary_card(
            theme,
            "Active Theses",
            &active.to_string(),
            theme.accent,
        ))
        .child(summary_card(
            theme,
            "Watching",
            &watching.to_string(),
            theme.warning,
        ))
        .child(summary_card(
            theme,
            "Long Positions",
            &long.to_string(),
            theme.positive,
        ))
        .child(summary_card(
            theme,
            "Short Positions",
            &short.to_string(),
            theme.negative,
        ))
}

/// Summary card
fn summary_card(theme: &Theme, label: &str, value: &str, color: Hsla) -> impl IntoElement {
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
                .text_size(px(28.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(value.to_string()),
        )
}

/// Render individual thesis card
fn render_thesis_card(theme: &Theme, thesis: &Thesis) -> impl IntoElement {
    let direction_color = if thesis.direction == "long" {
        theme.positive
    } else {
        theme.negative
    };
    let status_color = match thesis.status.as_str() {
        "active" => theme.positive,
        "watching" => theme.warning,
        "closed" => theme.text_muted,
        _ => theme.text_muted,
    };
    let conviction_color = match thesis.conviction.as_str() {
        "high" => theme.positive,
        "medium" => theme.accent,
        "low" => theme.text_muted,
        _ => theme.text_muted,
    };

    div()
        .p(px(20.0))
        .rounded(px(10.0))
        .bg(theme.card_bg_elevated)
        .border_1()
        .border_color(theme.border)
        .cursor_pointer()
        .hover(|s| s.border_color(theme.accent))
        .flex()
        .flex_col()
        .gap(px(16.0))
        // Header row
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
                        // Symbol
                        .child(
                            div()
                                .text_size(px(18.0))
                                .font_weight(FontWeight::BOLD)
                                .child(thesis.symbol.clone()),
                        )
                        // Direction badge
                        .child(
                            div()
                                .px(px(10.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(direction_color.opacity(0.15))
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(direction_color)
                                .child(thesis.direction.to_uppercase()),
                        )
                        // Status badge
                        .child(
                            div()
                                .px(px(10.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(status_color.opacity(0.15))
                                .text_size(px(11.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(status_color)
                                .child(thesis.status.to_uppercase()),
                        ),
                )
                .child(
                    // Conviction level
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_dimmed)
                                .child("Conviction:"),
                        )
                        .child(
                            div()
                                .px(px(10.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(conviction_color.opacity(0.15))
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(conviction_color)
                                .child(thesis.conviction.to_uppercase()),
                        ),
                ),
        )
        // Name / summary
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(thesis.name.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .child(thesis.thesis_summary.clone()),
                ),
        )
        // Price levels
        .when(
            thesis.entry_price.is_some() || thesis.target_price.is_some(),
            |el| {
                el.child(
                    div()
                        .flex()
                        .gap(px(24.0))
                        .when_some(thesis.entry_price, |d, price| {
                            d.child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Entry"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(format!("${:.2}", price)),
                                    ),
                            )
                        })
                        .when_some(thesis.target_price, |d, price| {
                            d.child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Target"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.positive)
                                            .child(format!("${:.2}", price)),
                                    ),
                            )
                        })
                        .when_some(thesis.stop_loss, |d, price| {
                            d.child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Stop"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.negative)
                                            .child(format!("${:.2}", price)),
                                    ),
                            )
                        }),
                )
            },
        )
        // Catalysts
        .when(!thesis.catalysts.is_empty(), |el| {
            el.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.text_dimmed)
                            .child("CATALYSTS"),
                    )
                    .child(
                        div().flex().flex_wrap().gap(px(6.0)).children(
                            thesis
                                .catalysts
                                .iter()
                                .map(|cat| {
                                    div()
                                        .px(px(8.0))
                                        .py(px(4.0))
                                        .rounded(px(4.0))
                                        .bg(theme.border_subtle)
                                        .text_size(px(11.0))
                                        .text_color(theme.text_secondary)
                                        .child(cat.clone())
                                })
                                .collect::<Vec<_>>(),
                        ),
                    ),
            )
        })
}

// ============================================================================
// TRADES TAB
// ============================================================================

fn render_trades_tab(theme: &Theme, state: &NotesState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        // Trade stats summary
        .child(render_trade_stats(theme, state))
        // Trade list
        .child(card(
            theme,
            "Trade Journal",
            match &state.trades {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(trades) => {
                    if trades.is_empty() {
                        empty_state(theme, "No trades", "Start logging your trades")
                    } else {
                        render_trades_table(theme, trades)
                    }
                }
                _ => loading_indicator(theme),
            },
        ))
}

/// Render trade statistics cards
fn render_trade_stats(theme: &Theme, state: &NotesState) -> impl IntoElement {
    match &state.trade_stats {
        LoadState::Loaded(stats) => {
            let pnl_positive = stats.total_pnl >= 0.0;
            let pnl_color = if pnl_positive {
                theme.positive
            } else {
                theme.negative
            };

            div()
                .flex()
                .gap(px(16.0))
                .child(stat_card(
                    theme,
                    "Total P&L",
                    &format!("{:+.2}", stats.total_pnl),
                    pnl_color,
                    true,
                ))
                .child(stat_card(
                    theme,
                    "Win Rate",
                    &format!("{:.1}%", stats.win_rate * 100.0),
                    if stats.win_rate >= 0.5 {
                        theme.positive
                    } else {
                        theme.negative
                    },
                    false,
                ))
                .child(stat_card(
                    theme,
                    "Total Trades",
                    &stats.total_trades.to_string(),
                    theme.accent,
                    false,
                ))
                .child(stat_card(
                    theme,
                    "Profit Factor",
                    &format!("{:.2}", stats.profit_factor),
                    if stats.profit_factor >= 1.0 {
                        theme.positive
                    } else {
                        theme.negative
                    },
                    false,
                ))
                .child(stat_card(
                    theme,
                    "Avg Win",
                    &format!("+{:.2}", stats.avg_win),
                    theme.positive,
                    true,
                ))
                .child(stat_card(
                    theme,
                    "Avg Loss",
                    &format!("{:.2}", stats.avg_loss),
                    theme.negative,
                    true,
                ))
        }
        LoadState::Loading => div()
            .flex()
            .gap(px(16.0))
            .child(stat_card_loading(theme))
            .child(stat_card_loading(theme))
            .child(stat_card_loading(theme))
            .child(stat_card_loading(theme)),
        _ => div(),
    }
}

/// Stat card
fn stat_card(
    theme: &Theme,
    label: &str,
    value: &str,
    color: Hsla,
    is_currency: bool,
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
                .gap(px(4.0))
                .when(is_currency, |el| {
                    el.child(div().text_size(px(16.0)).text_color(color).child("$"))
                })
                .child(
                    div()
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(value.to_string()),
                ),
        )
}

/// Loading stat card
fn stat_card_loading(theme: &Theme) -> impl IntoElement {
    div()
        .flex_1()
        .p(px(16.0))
        .rounded(px(10.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .flex()
        .items_center()
        .justify_center()
        .h(px(80.0))
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_dimmed)
                .child("Loading..."),
        )
}

/// Render trades table
fn render_trades_table(theme: &Theme, trades: &[TradeEntry]) -> Div {
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
                .child(
                    div()
                        .w(px(80.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("Symbol"),
                )
                .child(
                    div()
                        .w(px(70.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("Direction"),
                )
                .child(
                    div()
                        .w(px(100.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("Entry Date"),
                )
                .child(
                    div()
                        .w(px(90.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("Entry Price"),
                )
                .child(
                    div()
                        .w(px(90.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("Exit Price"),
                )
                .child(
                    div()
                        .w(px(100.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("P&L"),
                )
                .child(
                    div()
                        .flex_grow()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child("Notes"),
                ),
        )
        // Rows
        .children(
            trades
                .iter()
                .map(|trade| render_trade_row(theme, trade))
                .collect::<Vec<_>>(),
        )
}

/// Render trade row
fn render_trade_row(theme: &Theme, trade: &TradeEntry) -> impl IntoElement {
    let direction_color = if trade.direction == "long" {
        theme.positive
    } else {
        theme.negative
    };
    let pnl = trade.pnl.unwrap_or(0.0);
    let pnl_color = if pnl >= 0.0 {
        theme.positive
    } else {
        theme.negative
    };
    let is_open = trade.exit_price.is_none();

    div()
        .flex()
        .items_center()
        .py(px(12.0))
        .px(px(8.0))
        .border_b_1()
        .border_color(theme.border_subtle)
        .hover(|s| s.bg(theme.hover_bg))
        .cursor_pointer()
        // Symbol
        .child(
            div()
                .w(px(80.0))
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .child(trade.symbol.clone()),
        )
        // Direction
        .child(
            div().w(px(70.0)).child(
                div()
                    .px(px(8.0))
                    .py(px(2.0))
                    .rounded(px(4.0))
                    .bg(direction_color.opacity(0.15))
                    .text_size(px(10.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(direction_color)
                    .child(trade.direction.to_uppercase()),
            ),
        )
        // Entry date
        .child(
            div()
                .w(px(100.0))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child(format_date(&trade.entry_date)),
        )
        // Entry price
        .child(
            div()
                .w(px(90.0))
                .text_size(px(12.0))
                .child(format!("${:.2}", trade.entry_price)),
        )
        // Exit price
        .child(
            div()
                .w(px(90.0))
                .text_size(px(12.0))
                .text_color(if is_open {
                    theme.text_dimmed
                } else {
                    theme.text_secondary
                })
                .child(
                    trade
                        .exit_price
                        .map(|p| format!("${:.2}", p))
                        .unwrap_or_else(|| "Open".to_string()),
                ),
        )
        // P&L
        .child(
            div()
                .w(px(100.0))
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if is_open {
                            theme.text_dimmed
                        } else {
                            pnl_color
                        })
                        .child(if is_open {
                            "--".to_string()
                        } else {
                            format!("{:+.2}", pnl)
                        }),
                )
                .when_some(trade.pnl_percent, |d, pct| {
                    d.child(
                        div()
                            .text_size(px(10.0))
                            .text_color(pnl_color)
                            .child(format!("{:+.1}%", pct)),
                    )
                }),
        )
        // Notes
        .child(
            div()
                .flex_grow()
                .text_size(px(11.0))
                .text_color(theme.text_muted)
                .overflow_hidden()
                .child(
                    trade.notes.chars().take(50).collect::<String>()
                        + if trade.notes.len() > 50 { "..." } else { "" },
                ),
        )
}

// ============================================================================
// EVENTS TAB
// ============================================================================

fn render_events_tab(theme: &Theme, state: &NotesState) -> Div {
    div()
        .flex_grow()
        .p(px(24.0))
        .flex()
        .flex_col()
        .gap(px(20.0))
        .overflow_hidden()
        .child(card(
            theme,
            "Upcoming Events",
            match &state.events {
                LoadState::Loading => loading_indicator(theme),
                LoadState::Error(e) => error_message(theme, e),
                LoadState::Loaded(events) => {
                    let upcoming: Vec<_> = events.iter().filter(|e| !e.completed).collect();

                    if upcoming.is_empty() {
                        empty_state(theme, "No upcoming events", "Add market events to track")
                    } else {
                        div().flex().flex_col().gap(px(10.0)).children(
                            upcoming
                                .iter()
                                .map(|event| render_event_card(theme, event))
                                .collect::<Vec<_>>(),
                        )
                    }
                }
                _ => loading_indicator(theme),
            },
        ))
        .child(card(
            theme,
            "Past Events",
            match &state.events {
                LoadState::Loaded(events) => {
                    let past: Vec<_> = events.iter().filter(|e| e.completed).collect();

                    if past.is_empty() {
                        empty_state(
                            theme,
                            "No past events",
                            "Events will appear here after completion",
                        )
                    } else {
                        div().flex().flex_col().gap(px(10.0)).children(
                            past.iter()
                                .take(10)
                                .map(|event| render_event_card(theme, event))
                                .collect::<Vec<_>>(),
                        )
                    }
                }
                _ => div(),
            },
        ))
}

/// Render event card
fn render_event_card(theme: &Theme, event: &MarketEvent) -> impl IntoElement {
    let impact_color = match event.impact.as_str() {
        "high" => theme.negative,
        "medium" => theme.warning,
        "low" => theme.text_muted,
        _ => theme.text_muted,
    };

    let type_color = match event.event_type.as_str() {
        "earnings" => theme.accent,
        "fed" => theme.warning,
        "economic" => theme.positive,
        "company" => theme.text_secondary,
        _ => theme.text_muted,
    };

    div()
        .px(px(16.0))
        .py(px(14.0))
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .flex()
        .items_center()
        .justify_between()
        .when(event.completed, |el| el.opacity(0.6))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                // Date column
                .child(
                    div().w(px(80.0)).flex().flex_col().items_center().child(
                        div()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child(format_date(&event.event_date)),
                    ),
                )
                // Event type badge
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(type_color.opacity(0.15))
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(type_color)
                        .child(event.event_type.to_uppercase()),
                )
                // Description
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .child(
                                    div()
                                        .text_size(px(13.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(event.name.clone()),
                                )
                                .when_some(event.symbol.as_ref(), |d, sym| {
                                    d.child(
                                        div()
                                            .px(px(6.0))
                                            .py(px(2.0))
                                            .rounded(px(3.0))
                                            .bg(theme.accent.opacity(0.1))
                                            .text_size(px(10.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.accent)
                                            .child(sym.clone()),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_secondary)
                                .child(event.description.clone()),
                        ),
                ),
        )
        .child(
            // Impact badge
            div()
                .px(px(10.0))
                .py(px(4.0))
                .rounded(px(4.0))
                .bg(impact_color.opacity(0.15))
                .text_size(px(10.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(impact_color)
                .child(format!("{} IMPACT", event.impact.to_uppercase())),
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

/// Empty state
fn empty_state(theme: &Theme, title: &str, subtitle: &str) -> Div {
    div()
        .py(px(48.0))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(14.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.text_muted)
                .child(title.to_string()),
        )
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_dimmed)
                .child(subtitle.to_string()),
        )
}

/// Get color for note type
fn note_type_color(theme: &Theme, note_type: NoteType) -> Hsla {
    match note_type {
        NoteType::Research => theme.accent,
        NoteType::Thesis => theme.positive,
        NoteType::Trade => theme.warning,
        NoteType::Event => theme.negative,
        NoteType::Daily => theme.text_muted,
    }
}

/// Format relative time (simplified)
fn format_relative_time(timestamp: &str) -> String {
    if timestamp.is_empty() {
        return "Unknown".to_string();
    }
    // Simplified: just return the date portion
    if timestamp.len() >= 10 {
        timestamp[..10].to_string()
    } else {
        timestamp.to_string()
    }
}

/// Format date for display
fn format_date(date: &str) -> String {
    if date.is_empty() {
        return "--".to_string();
    }
    // Simplified: return first 10 chars (YYYY-MM-DD)
    if date.len() >= 10 {
        date[..10].to_string()
    } else {
        date.to_string()
    }
}
