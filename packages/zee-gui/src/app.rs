//! Main application state and rendering for Stanley GUI

use crate::accounting::{render_accounting, AccountingState};
use crate::agent::{render_agent_panel, AgentState, AgentStatus};
use crate::agent_core::{AgentCoreClient, Persona, StreamEvent};
use crate::api::{
    EquityFlowResponse, InstitutionalHolder, InstitutionalOwnershipResponse, KalshiMarket,
    KalshiMarketPrice, MarketData, MarketPricePoint, NoteResponse, PolymarketMarket,
    PortfolioHolding, PredictionMarketsHealth, SectorFlow, ZeeApiClient,
};
use crate::commodities::{render_commodities, CommoditiesState};
use crate::comparison::{
    render_correlation_matrix, render_overlay_chart, render_peer_group_comparison,
    render_relative_performance, render_sector_strength, render_side_by_side_comparison,
    ComparisonMode, ComparisonState, HistoryPoint, TimePeriod as ComparisonTimePeriod,
};
use crate::etf::{render_etf, EtfState};
use crate::keyboard::{get_shortcuts_help, search_symbols, KeyboardAction, KeyboardManager};
use crate::notes_editor::{
    handle_notes_action, load_note_summaries, render_notes_editor, save_note, NotesAction,
    NotesEditorState,
};
use crate::signals::{
    render_signals, BacktestResult as SignalsBacktestResult,
    PerformanceStats as SignalsPerformanceStats, Signal as UiSignal, SignalsState,
};
use crate::components::modals::render_tooltip;
use crate::observability::{render_observability, ObservabilityState};
// Standalone render functions (render_risk_standalone, render_sectors_standalone) are
// exported for use in compact/sidebar views. render_portfolio_compact uses them together.
#[allow(unused_imports)]
use crate::portfolio::{
    render_portfolio_compact, render_portfolio_content, render_risk_standalone,
    render_sectors_standalone, Holding, LoadState as PortfolioLoadState, RiskMetrics,
    SectorAllocation,
};
use crate::quick_actions::QuickActionsState;
use crate::runtime::{GuiRuntimeConfig, RuntimeMode};
use crate::suggestions::{
    generate_chart_suggestions, Suggestion, SuggestionContext, SuggestionType, SuggestionsState,
};
use crate::sync::{ConnectionStatus, SyncClient, SyncCommand, SyncEvent, SyncEventType, WsMessage};
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use std::sync::Arc;

/// Loading state for async data
#[derive(Debug, Clone, Default)]
pub enum LoadingState<T> {
    #[default]
    NotStarted,
    Loading,
    Loaded(T),
    Error(String),
}

impl<T> LoadingState<T> {
    pub fn is_loading(&self) -> bool {
        matches!(self, LoadingState::Loading)
    }

    #[allow(dead_code)]
    pub fn is_loaded(&self) -> bool {
        matches!(self, LoadingState::Loaded(_))
    }

    #[allow(dead_code)]
    pub fn is_error(&self) -> bool {
        matches!(self, LoadingState::Error(_))
    }
}

/// Loading state for async data (standard naming used by commodity views)
#[derive(Debug, Clone, Default)]
pub enum LoadState<T> {
    #[default]
    NotLoaded,
    Loading,
    Loaded(T),
    Error(String),
}

impl<T> LoadState<T> {
    /// Check if the state is currently loading.
    /// This is a utility method for checking loading state in view rendering.
    #[allow(dead_code)]
    pub fn is_loading(&self) -> bool {
        matches!(self, LoadState::Loading)
    }
}

#[derive(Debug, Clone)]
struct MarketSidePrice {
    label: String,
    _token_id: String,
    price: Option<MarketPricePoint>,
}

#[derive(Debug, Clone)]
struct PolymarketPriceSnapshot {
    side_a: MarketSidePrice,
    side_b: MarketSidePrice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PredictionMarketKind {
    Polymarket,
    Kalshi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarketStatusFilter {
    All,
    Open,
    Closed,
}

impl MarketStatusFilter {
    fn label(&self) -> &'static str {
        match self {
            MarketStatusFilter::All => "All",
            MarketStatusFilter::Open => "Open",
            MarketStatusFilter::Closed => "Closed",
        }
    }
}

#[derive(Debug, Clone)]
struct PredictionMarketFilters {
    search_query: String,
    status: MarketStatusFilter,
    min_volume: Option<f64>,
    limit: u32,
    offset: u32,
    only_open: bool,
}

impl PredictionMarketFilters {
    fn effective_status(&self) -> Option<&'static str> {
        if self.only_open {
            return Some("open");
        }
        match self.status {
            MarketStatusFilter::All => None,
            MarketStatusFilter::Open => Some("open"),
            MarketStatusFilter::Closed => Some("closed"),
        }
    }

    fn page(&self) -> u32 {
        (self.offset / self.limit).saturating_add(1)
    }
}

impl Default for PredictionMarketFilters {
    fn default() -> Self {
        Self {
            search_query: String::new(),
            status: MarketStatusFilter::All,
            min_volume: None,
            limit: 20,
            offset: 0,
            only_open: false,
        }
    }
}

#[derive(Debug, Clone)]
struct PredictionMarketsState {
    polymarket_markets: LoadState<Vec<PolymarketMarket>>,
    polymarket_selected: Option<PolymarketMarket>,
    polymarket_prices: LoadState<PolymarketPriceSnapshot>,
    polymarket_filters: PredictionMarketFilters,
    kalshi_markets: LoadState<Vec<KalshiMarket>>,
    kalshi_selected: Option<KalshiMarket>,
    kalshi_prices: LoadState<KalshiMarketPrice>,
    kalshi_filters: PredictionMarketFilters,
}

impl Default for PredictionMarketsState {
    fn default() -> Self {
        Self {
            polymarket_markets: LoadState::NotLoaded,
            polymarket_selected: None,
            polymarket_prices: LoadState::NotLoaded,
            polymarket_filters: PredictionMarketFilters::default(),
            kalshi_markets: LoadState::NotLoaded,
            kalshi_selected: None,
            kalshi_prices: LoadState::NotLoaded,
            kalshi_filters: PredictionMarketFilters::default(),
        }
    }
}

/// Format a number with K/M/B suffix for readability
pub fn format_number(n: f64) -> String {
    if n >= 1_000_000_000.0 {
        format!("{:.1}B", n / 1_000_000_000.0)
    } else if n >= 1_000_000.0 {
        format!("{:.1}M", n / 1_000_000.0)
    } else if n >= 1_000.0 {
        format!("{:.1}K", n / 1_000.0)
    } else {
        format!("{:.0}", n)
    }
}

fn format_probability(value: f64) -> String {
    format!("{:.1}%", value * 100.0)
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

const MONEY_FLOW_SECTORS: [&str; 10] = [
    "XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLP", "XLB", "XLRE", "XTL",
];

/// Main application state
pub struct ZeeApp {
    /// Current active view/tab
    active_view: ActiveView,
    /// Theme configuration
    theme: Theme,
    /// Selected symbol for analysis
    selected_symbol: Option<String>,
    /// List of watched symbols
    watchlist: Vec<String>,
    /// Currently selected index in the watchlist
    watchlist_selected_index: usize,
    /// Symbol search query text
    symbol_search_query: String,
    /// Symbol search results selected index
    symbol_search_selected_index: usize,
    /// Selected time period for charts
    selected_period: TimePeriod,
    /// Notes-related state
    #[allow(dead_code)]
    notes_search_query: String,
    notes_active_tab: NotesTab,
    /// Cached notes data with loading states
    theses: Vec<ThesisNote>,
    theses_loading: LoadingState<()>,
    trades: Vec<TradeNote>,
    trades_loading: LoadingState<()>,
    /// Commodities view state
    commodities_state: CommoditiesState,
    /// ETF analytics view state
    etf_state: EtfState,
    /// Trading signals view state
    signals_state: SignalsState,
    /// Accounting/filings view state
    accounting_state: AccountingState,
    /// Prediction markets view state
    prediction_markets_state: PredictionMarketsState,
    /// Prediction markets health
    prediction_markets_health: LoadingState<PredictionMarketsHealth>,
    /// Comparison view state for multi-symbol analysis
    comparison_state: ComparisonState,
    /// Portfolio view state
    portfolio_holdings: PortfolioLoadState<Vec<Holding>>,
    portfolio_risk: PortfolioLoadState<RiskMetrics>,
    portfolio_sectors: PortfolioLoadState<Vec<SectorAllocation>>,
    portfolio_total_value: f64,
    /// Dashboard data - market data for selected symbol
    market_data: LoadingState<MarketData>,
    /// Dashboard data - sector money flow
    sector_flow: LoadingState<Vec<SectorFlow>>,
    /// Money flow sector selection
    money_flow_sectors: Vec<String>,
    /// Dashboard data - equity flow metrics
    equity_flow: LoadingState<EquityFlowResponse>,
    /// Dashboard data - institutional holders
    institutional: LoadingState<Vec<InstitutionalHolder>>,
    /// Institutional summary metrics for the active symbol
    institutional_summary: LoadingState<InstitutionalOwnershipResponse>,
    /// API client for backend communication
    api_client: Arc<ZeeApiClient>,
    /// API connection status
    api_connected: LoadingState<bool>,
    /// Notes editor state for markdown editing
    notes_editor_state: NotesEditorState,
    /// Agent panel state
    agent_state: AgentState,
    /// Agent input text buffer
    agent_input: String,
    /// Agent-core daemon client
    agent_core_client: Arc<AgentCoreClient>,
    /// Current agent session ID (created lazily)
    agent_session_id: Option<String>,
    /// WebSocket sync client for real-time communication
    sync_client: Option<SyncClient>,
    /// WebSocket connection status
    sync_status: ConnectionStatus,
    /// Runtime transport/backend configuration
    runtime_config: GuiRuntimeConfig,
    /// Last sync event received
    last_sync_event: Option<SyncEvent>,
    /// Sync command sender for emitting events (obtained after connection)
    sync_command_tx: Option<tokio::sync::mpsc::Sender<crate::sync::SyncCommand>>,
    /// Inline suggestions state for data views
    suggestions_state: SuggestionsState,
    /// Quick actions panel state
    quick_actions_state: QuickActionsState,
    /// Currently active modal (unified modal system)
    active_modal: Option<ModalType>,
    /// Keyboard manager for global keyboard shortcuts
    keyboard_manager: KeyboardManager,
    /// Whether dark theme is active (true = dark, false = light)
    is_dark_theme: bool,
    /// Data refresh interval in seconds
    data_refresh_interval_seconds: u32,
    /// Observability view state
    observability_state: ObservabilityState,
    /// Whether the sidebar is currently open
    is_sidebar_open: bool,
    /// Whether Zee sidecar chat panel is open for pair-working
    is_zee_sidecar_open: bool,
}

/// Notes panel tabs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NotesTab {
    #[default]
    Theses,
    Trades,
    Search,
    /// Markdown editor for notes
    Editor,
}

/// Investment thesis note data
#[derive(Debug, Clone)]
pub struct ThesisNote {
    pub name: String,
    pub symbol: String,
    pub status: ThesisStatus,
    pub conviction: String,
    pub entry_price: Option<f64>,
    pub target_price: Option<f64>,
    pub modified: String,
}

impl ThesisNote {
    /// Parse a ThesisNote from API NoteResponse
    pub fn from_note_response(note: &NoteResponse) -> Option<Self> {
        let frontmatter = &note.frontmatter;

        // Extract fields from frontmatter JSON
        let symbol = frontmatter.get("symbol")?.as_str()?.to_string();
        let status_str = frontmatter
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("research");
        let conviction = frontmatter
            .get("conviction")
            .and_then(|v| v.as_str())
            .unwrap_or("Medium")
            .to_string();
        let entry_price = frontmatter.get("entry_price").and_then(|v| v.as_f64());
        let target_price = frontmatter.get("target_price").and_then(|v| v.as_f64());
        let modified = frontmatter
            .get("modified")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let status = match status_str.to_lowercase().as_str() {
            "active" => ThesisStatus::Active,
            "watchlist" => ThesisStatus::Watchlist,
            "closed" => ThesisStatus::Closed,
            "invalidated" => ThesisStatus::Invalidated,
            _ => ThesisStatus::Research,
        };

        Some(ThesisNote {
            name: note.name.clone(),
            symbol,
            status,
            conviction,
            entry_price,
            target_price,
            modified,
        })
    }
}

/// Thesis status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ThesisStatus {
    Research,
    Watchlist,
    Active,
    Closed,
    Invalidated,
}

impl ThesisStatus {
    pub fn label(&self) -> &'static str {
        match self {
            ThesisStatus::Research => "Research",
            ThesisStatus::Watchlist => "Watchlist",
            ThesisStatus::Active => "Active",
            ThesisStatus::Closed => "Closed",
            ThesisStatus::Invalidated => "Invalidated",
        }
    }
}

/// Trade journal note data
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct TradeNote {
    pub name: String,
    pub symbol: String,
    pub direction: TradeDirection,
    pub status: TradeStatus,
    pub entry_price: f64,
    pub exit_price: Option<f64>,
    pub shares: f64,
    pub pnl: Option<f64>,
    pub pnl_percent: Option<f64>,
    pub entry_date: String,
}

impl TradeNote {
    /// Parse a TradeNote from API NoteResponse
    pub fn from_note_response(note: &NoteResponse) -> Option<Self> {
        let frontmatter = &note.frontmatter;

        // Extract fields from frontmatter JSON
        let symbol = frontmatter.get("symbol")?.as_str()?.to_string();
        let direction_str = frontmatter
            .get("direction")
            .and_then(|v| v.as_str())
            .unwrap_or("long");
        let status_str = frontmatter
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("open");
        let entry_price = frontmatter
            .get("entry_price")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let exit_price = frontmatter.get("exit_price").and_then(|v| v.as_f64());
        let shares = frontmatter
            .get("shares")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let pnl = frontmatter.get("pnl").and_then(|v| v.as_f64());
        let pnl_percent = frontmatter.get("pnl_percent").and_then(|v| v.as_f64());
        let entry_date = frontmatter
            .get("entry_date")
            .or_else(|| frontmatter.get("created"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let direction = match direction_str.to_lowercase().as_str() {
            "short" => TradeDirection::Short,
            _ => TradeDirection::Long,
        };

        let status = match status_str.to_lowercase().as_str() {
            "closed" => TradeStatus::Closed,
            "partial" => TradeStatus::Partial,
            _ => TradeStatus::Open,
        };

        Some(TradeNote {
            name: note.name.clone(),
            symbol,
            direction,
            status,
            entry_price,
            exit_price,
            shares,
            pnl,
            pnl_percent,
            entry_date,
        })
    }
}

/// Trade direction
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TradeDirection {
    Long,
    Short,
}

impl TradeDirection {
    pub fn label(&self) -> &'static str {
        match self {
            TradeDirection::Long => "Long",
            TradeDirection::Short => "Short",
        }
    }
}

/// Trade status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum TradeStatus {
    Open,
    Closed,
    Partial,
}

impl TradeStatus {
    pub fn label(&self) -> &'static str {
        match self {
            TradeStatus::Open => "Open",
            TradeStatus::Closed => "Closed",
            TradeStatus::Partial => "Partial",
        }
    }
}

/// Modal types for unified modal system
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)] // Some variants are for future modal dialogs
pub enum ModalType {
    /// Keyboard shortcuts help modal
    Shortcuts,
    /// Quick actions panel (expanded)
    QuickActions,
    /// Symbol search modal
    SymbolSearch,
    /// Prediction market search modal
    PredictionMarketsSearch { kind: PredictionMarketKind },
    /// Settings modal
    Settings,
    /// Confirmation dialog
    Confirmation {
        title: String,
        message: String,
        on_confirm: String, // Action identifier
    },
    /// Error display modal
    Error { title: String, message: String },
    /// Custom modal with arbitrary content identifier
    Custom(String),
}

impl ModalType {
    /// Get the modal title for display
    pub fn title(&self) -> &str {
        match self {
            ModalType::Shortcuts => "Keyboard Shortcuts",
            ModalType::QuickActions => "Quick Actions",
            ModalType::SymbolSearch => "Search Symbol",
            ModalType::PredictionMarketsSearch { kind } => match kind {
                PredictionMarketKind::Polymarket => "Search Polymarket",
                PredictionMarketKind::Kalshi => "Search Kalshi",
            },
            ModalType::Settings => "Settings",
            ModalType::Confirmation { title, .. } => title,
            ModalType::Error { title, .. } => title,
            ModalType::Custom(id) => id,
        }
    }
}

/// Available views in the application
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ActiveView {
    #[default]
    Dashboard,
    Market,
    PredictionMarkets,
    MoneyFlow,
    Institutional,
    DarkPool,
    Options,
    Portfolio,
    Research,
    Etf,
    Signals,
    Accounting,
    Commodities,
    Comparison,
    Notes,
    Agent,
    #[allow(dead_code)]
    Observability,
}

impl ActiveView {
    /// Get the view name for sync events
    pub fn name(&self) -> &'static str {
        match self {
            ActiveView::Dashboard => "dashboard",
            ActiveView::Market => "market",
            ActiveView::PredictionMarkets => "prediction_markets",
            ActiveView::MoneyFlow => "money_flow",
            ActiveView::Institutional => "institutional",
            ActiveView::DarkPool => "dark_pool",
            ActiveView::Options => "options",
            ActiveView::Portfolio => "portfolio",
            ActiveView::Research => "research",
            ActiveView::Etf => "etf",
            ActiveView::Signals => "signals",
            ActiveView::Accounting => "accounting",
            ActiveView::Commodities => "commodities",
            ActiveView::Comparison => "comparison",
            ActiveView::Notes => "notes",
            ActiveView::Agent => "agent",
            ActiveView::Observability => "observability",
        }
    }

    /// Get the view type category for sync events
    pub fn view_type(&self) -> &'static str {
        match self {
            ActiveView::Dashboard => "dashboard",
            ActiveView::Market => "market_data",
            ActiveView::PredictionMarkets => "market_data",
            ActiveView::MoneyFlow
            | ActiveView::Institutional
            | ActiveView::DarkPool
            | ActiveView::Comparison
            | ActiveView::Etf
            | ActiveView::Signals
            | ActiveView::Accounting => "analysis",
            ActiveView::Options => "trading",
            ActiveView::Portfolio => "portfolio",
            ActiveView::Research => "research",
            ActiveView::Commodities => "market_data",
            ActiveView::Notes => "notes",
            ActiveView::Agent => "agent",
            ActiveView::Observability => "system",
        }
    }
}

/// Available time periods for chart display
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TimePeriod {
    #[default]
    OneDay,
    OneWeek,
    OneMonth,
    ThreeMonths,
    OneYear,
}

impl TimePeriod {
    pub fn label(&self) -> &'static str {
        match self {
            TimePeriod::OneDay => "1D",
            TimePeriod::OneWeek => "1W",
            TimePeriod::OneMonth => "1M",
            TimePeriod::ThreeMonths => "3M",
            TimePeriod::OneYear => "1Y",
        }
    }

    pub fn all() -> &'static [TimePeriod] {
        &[
            TimePeriod::OneDay,
            TimePeriod::OneWeek,
            TimePeriod::OneMonth,
            TimePeriod::ThreeMonths,
            TimePeriod::OneYear,
        ]
    }
}

impl ZeeApp {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let runtime_config = GuiRuntimeConfig::from_env();
        let api_client = Arc::new(ZeeApiClient::new());
        let agent_core_client = Arc::new(AgentCoreClient::new(None, Persona::Zee));

        let mut app = Self {
            active_view: ActiveView::Dashboard,
            theme: Theme::dark(),
            selected_symbol: Some("AAPL".to_string()),
            watchlist: vec![
                "AAPL".to_string(),
                "MSFT".to_string(),
                "GOOGL".to_string(),
                "AMZN".to_string(),
                "NVDA".to_string(),
            ],
            watchlist_selected_index: 0,
            symbol_search_query: String::new(),
            symbol_search_selected_index: 0,
            selected_period: TimePeriod::default(),
            notes_search_query: String::new(),
            notes_active_tab: NotesTab::default(),
            theses: Vec::new(),
            theses_loading: LoadingState::NotStarted,
            trades: Vec::new(),
            trades_loading: LoadingState::NotStarted,
            commodities_state: CommoditiesState::default(),
            etf_state: EtfState::default(),
            signals_state: SignalsState::default(),
            accounting_state: AccountingState::default(),
            prediction_markets_state: PredictionMarketsState::default(),
            comparison_state: ComparisonState::new(),
            portfolio_holdings: PortfolioLoadState::NotLoaded,
            portfolio_risk: PortfolioLoadState::NotLoaded,
            portfolio_sectors: PortfolioLoadState::NotLoaded,
            portfolio_total_value: 0.0,
            market_data: LoadingState::NotStarted,
            sector_flow: LoadingState::NotStarted,
            money_flow_sectors: vec![
                "XLK".to_string(),
                "XLF".to_string(),
                "XLE".to_string(),
                "XLV".to_string(),
                "XLI".to_string(),
            ],
            equity_flow: LoadingState::NotStarted,
            institutional: LoadingState::NotStarted,
            institutional_summary: LoadingState::NotStarted,
            api_client,
            api_connected: LoadingState::NotStarted,
            prediction_markets_health: LoadingState::NotStarted,
            notes_editor_state: NotesEditorState::new(),
            agent_state: AgentState::new(),
            agent_input: String::new(),
            agent_core_client,
            agent_session_id: None,
            sync_client: None,
            sync_status: ConnectionStatus::Disconnected,
            runtime_config,
            last_sync_event: None,
            sync_command_tx: None,
            suggestions_state: SuggestionsState::new(),
            quick_actions_state: QuickActionsState::new(),
            active_modal: None,
            keyboard_manager: KeyboardManager::new(),
            is_dark_theme: true,
            data_refresh_interval_seconds: 60,
            observability_state: ObservabilityState::new(),
            is_sidebar_open: true,
            is_zee_sidecar_open: env_flag("ZEE_GUI_SIDECAR"),
        };

        // Load notes from disk
        app.load_notes_from_disk();

        // Start loading data from API
        app.check_api_health(cx);

        // Start WebSocket connection
        app.start_sync_connection(cx);

        app
    }

    /// Handle a suggestion click by sending the prompt to the agent
    pub fn handle_suggestion_prompt(&mut self, prompt: String, cx: &mut Context<Self>) {
        // Add to agent input and trigger send via agent-core daemon
        self.agent_input = prompt.clone();
        self.agent_state.add_user_message(prompt.clone());
        self.agent_input.clear();
        self.send_to_agent_core(prompt, cx);
        cx.notify();
    }

    /// Send a message to the agent-core daemon
    fn send_to_agent_core(&mut self, prompt: String, cx: &mut Context<Self>) {
        // Mark as responding
        self.agent_state.status = AgentStatus::Responding;
        self.agent_state.start_streaming();

        let client = self.agent_core_client.clone();
        let session_id = self.agent_session_id.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            // Create session if needed
            let session_id = match session_id {
                Some(id) => id,
                None => {
                    match client.create_session(Some("Zee GUI".to_string())).await {
                        Ok(session) => {
                            let id = session.id.clone();
                            // Store session ID
                            let _ = cx.update(|cx| {
                                if let Some(entity) = this.upgrade() {
                                    entity.update(cx, |app: &mut Self, _cx: &mut Context<Self>| {
                                        app.agent_session_id = Some(id.clone());
                                    });
                                }
                            });
                            id
                        }
                        Err(e) => {
                            // Report error
                            let _ = cx.update(|cx| {
                                if let Some(entity) = this.upgrade() {
                                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                        app.agent_state.finish_streaming();
                                        app.agent_state.status = AgentStatus::Error(format!("Failed to create session: {}", e));
                                        app.agent_state.add_assistant_message(format!("Error: Failed to connect to agent-core daemon. Is it running? ({})", e));
                                        cx.notify();
                                    });
                                }
                            });
                            return;
                        }
                    }
                }
            };

            // Send prompt with streaming
            match client.prompt_stream(&session_id, &prompt, None).await {
                Ok(mut rx) => {
                    // Process stream events
                    while let Some(event) = rx.recv().await {
                        let event_clone = event.clone();
                        let should_break = matches!(event_clone, StreamEvent::Done { .. } | StreamEvent::Error { .. });

                        let _ = cx.update(|cx| {
                            if let Some(entity) = this.upgrade() {
                                entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                    match event_clone {
                                        StreamEvent::Text { text } => {
                                            app.agent_state.append_streaming(&text);
                                        }
                                        StreamEvent::Done { message } => {
                                            // Extract text content from parts
                                            let mut content = String::new();
                                            for part in &message.parts {
                                                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                                                    content.push_str(text);
                                                }
                                            }
                                            if !content.is_empty() && app.agent_state.messages.last().map(|m| m.content.is_empty()).unwrap_or(false) {
                                                // If streaming message is empty, replace with full content
                                                if let Some(msg) = app.agent_state.messages.last_mut() {
                                                    msg.content = content;
                                                }
                                            }
                                            app.agent_state.finish_streaming();
                                            app.agent_state.status = AgentStatus::Connected;
                                        }
                                        StreamEvent::Error { message } => {
                                            app.agent_state.finish_streaming();
                                            app.agent_state.status = AgentStatus::Error(message.clone());
                                            app.agent_state.add_assistant_message(format!("Error: {}", message));
                                        }
                                        StreamEvent::ToolUse { name, .. } => {
                                            app.agent_state.append_streaming(&format!("\n[Using tool: {}]\n", name));
                                        }
                                        StreamEvent::ToolResult { .. } => {
                                            // Tool results are handled internally
                                        }
                                        StreamEvent::Ping => {
                                            // Heartbeat, ignore
                                        }
                                    }
                                    cx.notify();
                                });
                            }
                        });

                        if should_break {
                            break;
                        }
                    }
                }
                Err(e) => {
                    let _ = cx.update(|cx| {
                        if let Some(entity) = this.upgrade() {
                            entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                app.agent_state.finish_streaming();
                                app.agent_state.status = AgentStatus::Error(e.to_string());
                                app.agent_state.add_assistant_message(format!("Error: {}", e));
                                cx.notify();
                            });
                        }
                    });
                }
            }
        })
        .detach();
    }

    /// Toggle inline suggestions display
    pub fn toggle_suggestions(&mut self, cx: &mut Context<Self>) {
        self.suggestions_state.toggle();
        cx.notify();
    }
    /// Render contextual suggestions for the current symbol with click handlers
    /// This method creates suggestion chips that call handle_suggestion_prompt when clicked
    fn render_contextual_suggestions(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        // Only show if suggestions are enabled
        if !self.suggestions_state.enabled {
            return div().id("contextual-suggestions-empty");
        }

        // Generate suggestions based on current context
        let suggestions = if let Some(ref symbol) = self.selected_symbol {
            // Get current price from equity flow data if available
            let current_value = match &self.equity_flow {
                LoadingState::Loaded(data) => Some(data.money_flow_score * 100.0),
                _ => None,
            };
            generate_chart_suggestions("equity", Some(symbol.as_str()), "price", current_value)
        } else {
            // Default suggestions when no symbol is selected
            vec![
                Suggestion::ask_about(SuggestionContext::new("market").with_metric("overview")),
                Suggestion::analyze(
                    SuggestionContext::new("market").with_metric("sectors"),
                    "sector rotation",
                ),
            ]
        };

        div()
            .id("contextual-suggestions")
            .flex()
            .flex_wrap()
            .gap(px(6.0))
            .children(suggestions.into_iter().take(5).map(|suggestion| {
                let prompt = suggestion.prompt.clone();
                let suggestion_text = suggestion.text.clone();
                let type_color = match suggestion.suggestion_type {
                    SuggestionType::AskAbout => theme.accent,
                    SuggestionType::Analyze => theme.positive,
                    SuggestionType::Compare => theme.warning,
                    SuggestionType::Historical => theme.accent_muted,
                    SuggestionType::Action => theme.accent,
                    SuggestionType::Insight => theme.warning,
                };
                let icon = suggestion.suggestion_type.icon();

                div()
                    .id(SharedString::from(suggestion.id.clone()))
                    .px(px(10.0))
                    .py(px(5.0))
                    .rounded(px(12.0))
                    .bg(type_color.opacity(0.12))
                    .border_1()
                    .border_color(type_color.opacity(0.25))
                    .cursor_pointer()
                    .hover(|s| {
                        s.bg(type_color.opacity(0.20))
                            .border_color(type_color.opacity(0.4))
                    })
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.handle_suggestion_prompt(prompt.clone(), cx);
                    }))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(5.0))
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(type_color)
                                    .child(icon),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text)
                                    .child(suggestion_text),
                            ),
                    )
            }))
    }

    /// Toggle keyboard shortcuts help modal
    pub fn toggle_shortcuts_modal(&mut self, cx: &mut Context<Self>) {
        if self.is_modal_open(&ModalType::Shortcuts) {
            self.close_modal(cx);
        } else {
            self.open_modal(ModalType::Shortcuts, cx);
        }
    }

    /// Open a modal of the specified type
    pub fn open_modal(&mut self, modal_type: ModalType, cx: &mut Context<Self>) {
        self.active_modal = Some(modal_type);
        cx.notify();
    }

    /// Close the currently active modal
    pub fn close_modal(&mut self, cx: &mut Context<Self>) {
        self.active_modal = None;
        cx.notify();
    }

    /// Check if a specific modal type is currently open
    pub fn is_modal_open(&self, modal_type: &ModalType) -> bool {
        self.active_modal.as_ref() == Some(modal_type)
    }

    /// Check if any modal is currently open
    pub fn has_active_modal(&self) -> bool {
        self.active_modal.is_some()
    }

    /// Toggle between dark and light theme
    pub fn toggle_theme(&mut self, cx: &mut Context<Self>) {
        self.is_dark_theme = !self.is_dark_theme;
        self.theme = if self.is_dark_theme {
            Theme::dark()
        } else {
            Theme::light()
        };
        cx.notify();
    }

    /// Toggle sidebar visibility
    pub fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.is_sidebar_open = !self.is_sidebar_open;
        cx.notify();
    }

    /// Toggle Zee sidecar pair-working panel visibility
    pub fn toggle_zee_sidecar(&mut self, cx: &mut Context<Self>) {
        self.is_zee_sidecar_open = !self.is_zee_sidecar_open;
        cx.notify();
    }

    /// Set data refresh interval in seconds
    #[allow(dead_code)]
    pub fn set_data_refresh_interval(&mut self, seconds: u32, cx: &mut Context<Self>) {
        self.data_refresh_interval_seconds = seconds;
        cx.notify();
    }

    /// Show an error modal with the given title and message
    #[allow(dead_code)] // Available for future error handling
    pub fn show_error(
        &mut self,
        title: impl Into<String>,
        message: impl Into<String>,
        cx: &mut Context<Self>,
    ) {
        self.open_modal(
            ModalType::Error {
                title: title.into(),
                message: message.into(),
            },
            cx,
        );
    }

    /// Show a confirmation modal with the given title, message, and action identifier
    #[allow(dead_code)] // Available for future confirmation dialogs
    pub fn show_confirmation(
        &mut self,
        title: impl Into<String>,
        message: impl Into<String>,
        on_confirm: impl Into<String>,
        cx: &mut Context<Self>,
    ) {
        self.open_modal(
            ModalType::Confirmation {
                title: title.into(),
                message: message.into(),
                on_confirm: on_confirm.into(),
            },
            cx,
        );
    }

    /// Handle a keyboard action from the KeyboardManager
    pub fn handle_keyboard_action(&mut self, action: KeyboardAction, cx: &mut Context<Self>) {
        // Handle symbol search modal navigation first if modal is open
        if self.is_modal_open(&ModalType::SymbolSearch) {
            match action {
                KeyboardAction::TableUp | KeyboardAction::VimUp => {
                    self.symbol_search_move_up(cx);
                    return;
                }
                KeyboardAction::TableDown | KeyboardAction::VimDown => {
                    self.symbol_search_move_down(cx);
                    return;
                }
                KeyboardAction::ConfirmAction | KeyboardAction::TableSelect => {
                    self.symbol_search_select_current(cx);
                    return;
                }
                KeyboardAction::CloseModal => {
                    self.close_modal(cx);
                    return;
                }
                _ => {} // Fall through to normal handling
            }
        }

        match action {
            // View Navigation
            KeyboardAction::GotoDashboard => self.set_active_view(ActiveView::Dashboard, cx),
            KeyboardAction::GotoMoneyFlow => self.set_active_view(ActiveView::MoneyFlow, cx),
            KeyboardAction::GotoInstitutional => {
                self.set_active_view(ActiveView::Institutional, cx)
            }
            KeyboardAction::GotoDarkPool => self.set_active_view(ActiveView::DarkPool, cx),
            KeyboardAction::GotoOptions => self.set_active_view(ActiveView::Options, cx),
            KeyboardAction::GotoResearch => self.set_active_view(ActiveView::Research, cx),
            KeyboardAction::GotoPortfolio => self.set_active_view(ActiveView::Portfolio, cx),
            KeyboardAction::GotoCommodities => self.set_active_view(ActiveView::Commodities, cx),
            KeyboardAction::GotoMacro => self.set_active_view(ActiveView::Notes, cx), // Map Macro to Notes for now

            // UI Actions
            KeyboardAction::ToggleSidebar => {
                self.toggle_sidebar(cx);
            }
            KeyboardAction::ShowHelp | KeyboardAction::ShowShortcuts => {
                self.toggle_shortcuts_modal(cx);
            }
            KeyboardAction::OpenSettings => {
                self.open_modal(ModalType::Settings, cx);
            }

            // Search Actions
            KeyboardAction::OpenSymbolSearch | KeyboardAction::FocusSearch => {
                self.open_symbol_search(cx);
            }

            // Watchlist Navigation
            KeyboardAction::WatchlistUp => {
                self.watchlist_move_up(cx);
            }
            KeyboardAction::WatchlistDown => {
                self.watchlist_move_down(cx);
            }
            KeyboardAction::WatchlistSelect => {
                self.watchlist_select_current(cx);
            }
            KeyboardAction::WatchlistFirst => {
                self.watchlist_go_first(cx);
            }
            KeyboardAction::WatchlistLast => {
                self.watchlist_go_last(cx);
            }
            KeyboardAction::AddToWatchlist => {
                self.add_current_to_watchlist(cx);
            }
            KeyboardAction::RemoveFromWatchlist => {
                self.remove_from_watchlist_at_index(cx);
            }

            // Data Actions
            KeyboardAction::RefreshData => {
                // Refresh current view data
                self.check_api_health(cx);
                cx.notify();
            }
            KeyboardAction::RefreshAll => {
                self.check_api_health(cx);
                cx.notify();
            }

            // Quick Actions Panel
            KeyboardAction::ToggleSuggestions => {
                self.toggle_suggestions(cx);
            }
            KeyboardAction::ToggleQuickActions => {
                self.toggle_quick_actions(cx);
            }
            KeyboardAction::OpenQuickActionsPanel => {
                self.quick_actions_state.toggle_expanded();
                cx.notify();
            }
            KeyboardAction::CloseQuickActionsPanel => {
                self.quick_actions_state.is_expanded = false;
                cx.notify();
            }
            KeyboardAction::ExecuteQuickAction1 => self.execute_quick_action_by_index(0, cx),
            KeyboardAction::ExecuteQuickAction2 => self.execute_quick_action_by_index(1, cx),
            KeyboardAction::ExecuteQuickAction3 => self.execute_quick_action_by_index(2, cx),
            KeyboardAction::ExecuteQuickAction4 => self.execute_quick_action_by_index(3, cx),
            KeyboardAction::ExecuteQuickAction5 => self.execute_quick_action_by_index(4, cx),
            KeyboardAction::FocusAgentInput => {
                self.set_active_view(ActiveView::Agent, cx);
            }

            // Modal handling - close any active modal on Escape
            KeyboardAction::CloseModal => {
                if self.has_active_modal() {
                    self.close_modal(cx);
                }
            }

            // Notes Editor Tab Navigation
            KeyboardAction::NotesEditorNextTab => {
                self.notes_editor_next_tab(cx);
            }
            KeyboardAction::NotesEditorPrevTab => {
                self.notes_editor_prev_tab(cx);
            }

            // Other actions - placeholder for future implementation
            _ => {}
        }
    }

    /// Execute a quick action by index (1-5)
    pub fn execute_quick_action_by_index(&mut self, index: usize, cx: &mut Context<Self>) {
        let popular_actions = self.quick_actions_state.get_popular_actions(5);
        if let Some(action) = popular_actions.get(index.saturating_sub(1)) {
            let prompt = action.build_prompt(self.selected_symbol.as_deref());
            self.handle_quick_action(prompt, cx);
        }
    }

    // =========================================================================
    // SYMBOL SEARCH METHODS
    // =========================================================================

    /// Open the symbol search modal
    pub fn open_symbol_search(&mut self, cx: &mut Context<Self>) {
        self.symbol_search_query.clear();
        self.symbol_search_selected_index = 0;
        self.open_modal(ModalType::SymbolSearch, cx);
    }

    /// Update symbol search query
    pub fn update_symbol_search_query(&mut self, query: String, cx: &mut Context<Self>) {
        self.symbol_search_query = query;
        self.symbol_search_selected_index = 0;
        cx.notify();
    }

    /// Get filtered symbol search results based on current query
    pub fn get_symbol_search_results(&self) -> Vec<(&'static str, &'static str)> {
        search_symbols(&self.symbol_search_query)
    }

    /// Move selection up in symbol search results
    pub fn symbol_search_move_up(&mut self, cx: &mut Context<Self>) {
        if self.symbol_search_selected_index > 0 {
            self.symbol_search_selected_index -= 1;
            cx.notify();
        }
    }

    /// Move selection down in symbol search results
    pub fn symbol_search_move_down(&mut self, cx: &mut Context<Self>) {
        let results = self.get_symbol_search_results();
        if self.symbol_search_selected_index < results.len().saturating_sub(1) {
            self.symbol_search_selected_index += 1;
            cx.notify();
        }
    }

    /// Select the current symbol from search results
    pub fn symbol_search_select_current(&mut self, cx: &mut Context<Self>) {
        let results = self.get_symbol_search_results();
        if let Some((symbol, _)) = results.get(self.symbol_search_selected_index) {
            let symbol_str = (*symbol).to_string();
            self.select_symbol(symbol_str, cx);
            self.close_modal(cx);
        }
    }

    // =========================================================================
    // WATCHLIST NAVIGATION METHODS
    // =========================================================================

    /// Move selection up in watchlist
    pub fn watchlist_move_up(&mut self, cx: &mut Context<Self>) {
        if self.watchlist_selected_index > 0 {
            self.watchlist_selected_index -= 1;
            cx.notify();
        }
    }

    /// Move selection down in watchlist
    pub fn watchlist_move_down(&mut self, cx: &mut Context<Self>) {
        if self.watchlist_selected_index < self.watchlist.len().saturating_sub(1) {
            self.watchlist_selected_index += 1;
            cx.notify();
        }
    }

    /// Select the current watchlist item
    pub fn watchlist_select_current(&mut self, cx: &mut Context<Self>) {
        if let Some(symbol) = self.watchlist.get(self.watchlist_selected_index).cloned() {
            self.select_symbol(symbol, cx);
        }
    }

    /// Go to first item in watchlist
    pub fn watchlist_go_first(&mut self, cx: &mut Context<Self>) {
        self.watchlist_selected_index = 0;
        cx.notify();
    }

    /// Go to last item in watchlist
    pub fn watchlist_go_last(&mut self, cx: &mut Context<Self>) {
        self.watchlist_selected_index = self.watchlist.len().saturating_sub(1);
        cx.notify();
    }

    /// Add current symbol to watchlist
    pub fn add_current_to_watchlist(&mut self, cx: &mut Context<Self>) {
        if let Some(symbol) = &self.selected_symbol {
            if !self.watchlist.contains(symbol) {
                self.watchlist.push(symbol.clone());
                cx.notify();
            }
        }
    }

    /// Remove symbol at current watchlist index (shows confirmation dialog)
    pub fn remove_from_watchlist_at_index(&mut self, cx: &mut Context<Self>) {
        if self.watchlist_selected_index < self.watchlist.len() && self.watchlist.len() > 1 {
            let symbol = self
                .watchlist
                .get(self.watchlist_selected_index)
                .cloned()
                .unwrap_or_else(|| "symbol".to_string());

            self.open_modal(
                ModalType::Confirmation {
                    title: "Remove from Watchlist".to_string(),
                    message: format!(
                        "Are you sure you want to remove {} from your watchlist?",
                        symbol
                    ),
                    on_confirm: "remove_from_watchlist".to_string(),
                },
                cx,
            );
        }
    }

    /// Check API health and connection status
    pub fn check_api_health(&mut self, cx: &mut Context<Self>) {
        self.api_connected = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.health_check().await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(health) => {
                                app.api_connected = LoadingState::Loaded(health.core);
                                // If connected, load data
                                if health.core {
                                    app.load_theses(cx);
                                    app.load_trades(cx);
                                    app.load_dashboard_data(cx);
                                }
                            }
                            Err(e) => {
                                app.api_connected = LoadingState::Error(format!("{:?}", e));
                                app.theses_loading =
                                    LoadingState::Error("API unavailable".to_string());
                                app.trades_loading =
                                    LoadingState::Error("API unavailable".to_string());
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Start WebSocket sync connection
    pub fn start_sync_connection(&mut self, cx: &mut Context<Self>) {
        let runtime_config = self.runtime_config.clone();
        let mut sync_client = match runtime_config.mode {
            RuntimeMode::LegacyStanleyWs => {
                SyncClient::new_legacy(&runtime_config.legacy_sync_ws_url)
            }
            RuntimeMode::Zee | RuntimeMode::Dual => SyncClient::new_zee(&runtime_config.zee_http_base),
        };

        // Set initial status to connecting
        self.sync_status = ConnectionStatus::Connecting;
        self.agent_state
            .update_status_from_sync(ConnectionStatus::Connecting);

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            // Connect and get event receiver
            match sync_client.connect().await {
                Ok(mut event_rx) => {
                    // Get command sender for emitting events (available after connect)
                    let command_tx = sync_client.command_sender();

                    // Update status to connected and store command sender
                    let _ = cx.update(|cx| {
                        if let Some(entity) = this.upgrade() {
                            entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                app.sync_status = ConnectionStatus::Connected;
                                app.sync_command_tx = command_tx;
                                app.sync_client = Some(sync_client);
                                // Update agent status widget
                                app.agent_state
                                    .update_status_from_sync(ConnectionStatus::Connected);
                                cx.notify();
                            });
                        }
                    });

                    // Process incoming events
                    while let Some(event) = event_rx.recv().await {
                        let event_clone = event.clone();
                        let _ = cx.update(|cx| {
                            if let Some(entity) = this.upgrade() {
                                entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                    app.handle_sync_event(event_clone, cx);
                                });
                            }
                        });
                    }
                }
                Err(_e) if matches!(runtime_config.mode, RuntimeMode::Dual) => {
                    let mut fallback_client =
                        SyncClient::new_legacy(&runtime_config.legacy_sync_ws_url);

                    match fallback_client.connect().await {
                        Ok(mut event_rx) => {
                            let command_tx = fallback_client.command_sender();

                            let _ = cx.update(|cx| {
                                if let Some(entity) = this.upgrade() {
                                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                        app.sync_status = ConnectionStatus::Connected;
                                        app.sync_command_tx = command_tx;
                                        app.sync_client = Some(fallback_client);
                                        app.agent_state
                                            .update_status_from_sync(ConnectionStatus::Connected);
                                        cx.notify();
                                    });
                                }
                            });

                            while let Some(event) = event_rx.recv().await {
                                let event_clone = event.clone();
                                let _ = cx.update(|cx| {
                                    if let Some(entity) = this.upgrade() {
                                        entity.update(
                                            cx,
                                            |app: &mut Self, cx: &mut Context<Self>| {
                                                app.handle_sync_event(event_clone, cx);
                                            },
                                        );
                                    }
                                });
                            }
                        }
                        Err(_) => {
                            let _ = cx.update(|cx| {
                                if let Some(entity) = this.upgrade() {
                                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                        app.sync_status = ConnectionStatus::Error;
                                        app.agent_state
                                            .update_status_from_sync(ConnectionStatus::Error);
                                        cx.notify();
                                    });
                                }
                            });
                        }
                    }
                }
                Err(_) => {
                    let _ = cx.update(|cx| {
                        if let Some(entity) = this.upgrade() {
                            entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                                app.sync_status = ConnectionStatus::Error;
                                app.agent_state
                                    .update_status_from_sync(ConnectionStatus::Error);
                                cx.notify();
                            });
                        }
                    });
                }
            }
        })
        .detach();
    }

    /// Handle incoming sync event
    fn handle_sync_event(&mut self, event: SyncEvent, cx: &mut Context<Self>) {
        self.last_sync_event = Some(event.clone());

        match event.event_type {
            SyncEventType::PortfolioUpdate => {
                // Refresh portfolio data
                self.load_portfolio_data(cx);
            }
            SyncEventType::NoteSaved | SyncEventType::NoteUpdated => {
                // Reload notes
                self.load_notes_from_disk();
            }
            SyncEventType::ResearchComplete => {
                // Could trigger a notification
                // Also forward to agent state
                self.agent_state.handle_sync_event(event.clone());
            }
            SyncEventType::AlertTriggered => {
                // Could show alert UI
                // Also forward to agent state
                self.agent_state.handle_sync_event(event.clone());
            }
            SyncEventType::ClientConnected => {
                self.sync_status = ConnectionStatus::Connected;
                // Update agent status widget
                self.agent_state
                    .update_status_from_sync(ConnectionStatus::Connected);
            }
            SyncEventType::ClientDisconnected => {
                self.sync_status = ConnectionStatus::Disconnected;
                // Update agent status widget
                self.agent_state
                    .update_status_from_sync(ConnectionStatus::Disconnected);
            }
            SyncEventType::SyncError => {
                self.sync_status = ConnectionStatus::Error;
                // Update agent status widget
                self.agent_state
                    .update_status_from_sync(ConnectionStatus::Error);
                // Show error notification in agent panel
                if let Some(data) = &event.data {
                    if let Some(error_msg) = data.get("error").and_then(|v| v.as_str()) {
                        self.agent_state
                            .add_assistant_message(format!("[SYNC ERROR] {}", error_msg));
                    }
                }
            }
            // Market data update event
            SyncEventType::MarketDataUpdate => {
                if let Some(data) = &event.data {
                    if let Ok(market_data) = serde_json::from_value::<MarketData>(data.clone()) {
                        self.market_data = LoadingState::Loaded(market_data.clone());
                        self.agent_state.add_assistant_message(format!(
                            "[MARKET UPDATE] {} - ${:.2} ({:+.2}%)",
                            market_data.symbol, market_data.price, market_data.change_percent
                        ));
                    }
                }
            }
            // Commodity update event
            SyncEventType::CommodityUpdate => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let price = data.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let change = data
                        .get("change_percent")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    if let Some(commodity_symbol) = data.get("symbol").and_then(|v| v.as_str()) {
                        self.commodities_state.selected_commodity =
                            Some(commodity_symbol.to_string());
                    }
                    self.commodities_state.overview = LoadState::Loading;
                    self.agent_state.add_assistant_message(format!(
                        "[COMMODITY UPDATE] {} - ${:.2} ({:+.2}%)",
                        symbol, price, change
                    ));
                }
            }
            // Price alert event
            SyncEventType::PriceAlert => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let alert_type = data
                        .get("alertType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("PRICE");
                    let price = data.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let threshold = data
                        .get("threshold")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let message = data
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Price alert triggered");
                    self.agent_state.add_assistant_message(format!(
                        "[PRICE ALERT] {} - {} triggered at ${:.2} (threshold: ${:.2})\n{}",
                        symbol, alert_type, price, threshold, message
                    ));
                    self.agent_state.handle_sync_event(event.clone());
                }
            }
            // Flow alert event
            SyncEventType::FlowAlert => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let flow_type = data
                        .get("flowType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("FLOW");
                    let message = data
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Flow alert triggered");
                    self.agent_state.add_assistant_message(format!(
                        "[FLOW ALERT] {} - {} Alert\n{}",
                        symbol, flow_type, message
                    ));
                    self.agent_state.handle_sync_event(event.clone());
                }
            }
            // Agent-specific events
            SyncEventType::AgentQueryStart
            | SyncEventType::AgentQueryComplete
            | SyncEventType::AgentToolCall
            | SyncEventType::AgentToolResult
            | SyncEventType::AgentError => {
                self.agent_state.handle_sync_event(event.clone());
            }
            // Research events
            SyncEventType::ResearchStarted => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    self.agent_state.add_assistant_message(format!(
                        "[RESEARCH] Starting research for {}...",
                        symbol
                    ));
                }
            }
            SyncEventType::ResearchProgress => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let progress = data.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let stage = data
                        .get("stage")
                        .and_then(|v| v.as_str())
                        .unwrap_or("processing");
                    self.agent_state.add_assistant_message(format!(
                        "[RESEARCH] {} - {:.0}% complete ({})",
                        symbol,
                        progress * 100.0,
                        stage
                    ));
                }
            }
            // Portfolio events
            SyncEventType::PortfolioHoldingAdded => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    self.agent_state
                        .add_assistant_message(format!("[PORTFOLIO] Added holding: {}", symbol));
                }
                self.load_portfolio_data(cx);
            }
            SyncEventType::PortfolioHoldingRemoved => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    self.agent_state
                        .add_assistant_message(format!("[PORTFOLIO] Removed holding: {}", symbol));
                }
                self.load_portfolio_data(cx);
            }
            // Note events
            SyncEventType::NoteDeleted => {
                if let Some(data) = &event.data {
                    let note_id = data.get("noteId").and_then(|v| v.as_str()).unwrap_or("N/A");
                    self.agent_state
                        .add_assistant_message(format!("[NOTES] Note deleted: {}", note_id));
                }
                self.load_notes_from_disk();
            }
            SyncEventType::ThesisCreated => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    self.agent_state.add_assistant_message(format!(
                        "[THESIS] New thesis created for {}",
                        symbol
                    ));
                }
                self.load_notes_from_disk();
            }
            SyncEventType::TradeOpened => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let side = data.get("side").and_then(|v| v.as_str()).unwrap_or("BUY");
                    self.agent_state.add_assistant_message(format!(
                        "[TRADE] {} position opened for {}",
                        side, symbol
                    ));
                }
                self.load_notes_from_disk();
            }
            SyncEventType::TradeClosed => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let pnl = data.get("pnl").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    self.agent_state.add_assistant_message(format!(
                        "[TRADE] Position closed for {} - P/L: ${:.2}",
                        symbol, pnl
                    ));
                }
                self.load_notes_from_disk();
            }
            SyncEventType::AlertAcknowledged => {
                if let Some(data) = &event.data {
                    let alert_id = data
                        .get("alertId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("N/A");
                    self.agent_state
                        .add_assistant_message(format!("[ALERT] Alert {} acknowledged", alert_id));
                }
            }
            // Real-time streaming events
            SyncEventType::BarUpdate => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let timeframe = data
                        .get("timeframe")
                        .and_then(|v| v.as_str())
                        .unwrap_or("1m");
                    let close = data.get("close").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let volume = data.get("volume").and_then(|v| v.as_i64()).unwrap_or(0);
                    log::debug!(
                        "[BAR] {} {} - Close: ${:.2}, Volume: {}",
                        symbol,
                        timeframe,
                        close,
                        volume
                    );
                    // Forward to agent state for potential display
                    self.agent_state.handle_sync_event(event.clone());
                }
            }
            SyncEventType::OptionsFlowUpdate => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let option_type = data
                        .get("option_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("call");
                    let strike = data.get("strike").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let premium = data.get("premium").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let trade_type = data
                        .get("trade_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("split");
                    let sentiment = data
                        .get("sentiment")
                        .and_then(|v| v.as_str())
                        .unwrap_or("neutral");

                    // Log significant options flow
                    if premium >= 100_000.0 {
                        self.agent_state.add_assistant_message(format!(
                            "[OPTIONS FLOW] {} {} ${:.0} - ${:.0}K {} ({})",
                            symbol,
                            option_type,
                            strike,
                            premium / 1000.0,
                            trade_type,
                            sentiment
                        ));
                    }
                    self.agent_state.handle_sync_event(event.clone());
                }
            }
            SyncEventType::DarkPoolActivity => {
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let price = data.get("price").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let size = data.get("size").and_then(|v| v.as_i64()).unwrap_or(0);
                    let notional = data.get("notional").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let venue = data.get("venue").and_then(|v| v.as_str()).unwrap_or("N/A");

                    // Log significant dark pool prints (> $500K)
                    if notional >= 500_000.0 {
                        self.agent_state.add_assistant_message(format!(
                            "[DARK POOL] {} - {} shares @ ${:.2} (${:.1}M) via {}",
                            symbol,
                            size,
                            price,
                            notional / 1_000_000.0,
                            venue
                        ));
                    }
                    self.agent_state.handle_sync_event(event.clone());
                }
            }
            // View events (typically sent from GUI, but handle if received)
            SyncEventType::ViewOpened
            | SyncEventType::ViewClosed
            | SyncEventType::SymbolSelected
            | SyncEventType::SymbolDeselected => {
                // These are typically outbound events, but log if received
            }
        }

        cx.notify();
    }

    /// Emit view opened event via WebSocket (non-blocking)
    fn emit_view_change(&self, view: ActiveView) {
        if let Some(ref tx) = self.sync_command_tx {
            let view_name = view.name();
            let view_type = view.view_type();
            let symbol = self.selected_symbol.clone();

            let event = SyncEvent::view_opened(view_name, view_type, symbol.as_deref());
            let message = WsMessage::event(event);

            // Use try_send to avoid blocking the UI thread
            let _ = tx.try_send(SyncCommand::Send(message));
        }
    }

    /// Emit symbol selected event via WebSocket (non-blocking)
    fn emit_symbol_change(&self, symbol: &str, context: &str, previous: Option<&str>) {
        if let Some(ref tx) = self.sync_command_tx {
            let event = SyncEvent::symbol_selected(symbol, context, previous);
            let message = WsMessage::event(event);

            // Use try_send to avoid blocking the UI thread
            let _ = tx.try_send(SyncCommand::Send(message));
        }
    }

    /// Handle a quick action click by sending the prompt to the agent
    pub fn handle_quick_action(&mut self, prompt: String, cx: &mut Context<Self>) {
        // Record recent query
        self.quick_actions_state
            .add_recent_query(prompt.clone(), self.selected_symbol.clone());

        // Add to agent and trigger send via agent-core daemon
        self.agent_input = prompt.clone();
        self.agent_state.add_user_message(prompt.clone());
        self.agent_input.clear();
        self.send_to_agent_core(prompt, cx);
        cx.notify();
    }

    /// Toggle quick actions panel expansion
    pub fn toggle_quick_actions(&mut self, cx: &mut Context<Self>) {
        self.quick_actions_state.toggle_expanded();
        cx.notify();
    }

    /// Load theses from API
    pub fn load_theses(&mut self, cx: &mut Context<Self>) {
        self.theses_loading = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_theses(None, None).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(notes) => {
                                app.theses = notes
                                    .into_iter()
                                    .filter_map(|n| ThesisNote::from_note_response(&n))
                                    .collect();
                                app.theses_loading = LoadingState::Loaded(());
                            }
                            Err(e) => {
                                app.theses_loading = LoadingState::Error(format!("{:?}", e));
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load trades from API
    pub fn load_trades(&mut self, cx: &mut Context<Self>) {
        self.trades_loading = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_trades(None, None).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(notes) => {
                                app.trades = notes
                                    .into_iter()
                                    .filter_map(|n| TradeNote::from_note_response(&n))
                                    .collect();
                                app.trades_loading = LoadingState::Loaded(());
                            }
                            Err(e) => {
                                app.trades_loading = LoadingState::Error(format!("{:?}", e));
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load commodities data from API
    pub fn load_commodities_data(&mut self, cx: &mut Context<Self>) {
        let client = self.api_client.clone();

        // Load commodities overview
        self.commodities_state.overview = LoadState::Loading;
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_commodities_overview().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.commodities_state.overview = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        // Load correlations data
        self.commodities_state.correlations = LoadState::Loading;
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_commodities_correlations().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.commodities_state.correlations = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        // If a specific commodity is selected, load its detail and macro analysis
        if let Some(symbol) = self.commodities_state.selected_commodity.clone() {
            self.load_commodity_detail(&symbol, cx);
        }
    }

    /// Load detail for a specific commodity
    pub fn load_commodity_detail(&mut self, symbol: &str, cx: &mut Context<Self>) {
        let client = self.api_client.clone();
        let symbol_owned = symbol.to_string();

        // Load commodity detail
        self.commodities_state.detail = LoadState::Loading;
        let symbol_clone = symbol_owned.clone();
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_commodity_detail(&symbol_clone).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.commodities_state.detail = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        // Load macro linkage analysis
        self.commodities_state.macro_analysis = LoadState::Loading;
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_commodity_macro(&symbol_owned).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.commodities_state.macro_analysis = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn api_signal_to_ui_signal(signal: crate::api::Signal) -> UiSignal {
        UiSignal {
            signal_id: signal.signal_id,
            symbol: signal.symbol,
            signal_type: signal.signal_type,
            strength: signal.strength,
            conviction: signal.conviction,
            factors: signal.factors,
            price_at_signal: signal.price_at_signal,
            target_price: signal.target_price,
            stop_loss: signal.stop_loss,
            holding_period_days: None,
            reasoning: signal.reasoning,
            timestamp: signal.timestamp,
        }
    }

    fn api_backtest_to_ui_backtest(backtest: crate::api::BacktestResult) -> SignalsBacktestResult {
        SignalsBacktestResult {
            total_return: backtest.total_return,
            sharpe_ratio: backtest.sharpe_ratio,
            max_drawdown: backtest.max_drawdown,
            win_rate: backtest.win_rate,
            trades: backtest.trades,
            profit_factor: backtest.profit_factor,
            avg_holding_days: backtest.avg_holding_days,
            equity_curve: backtest
                .equity_curve
                .into_iter()
                .map(|point| crate::signals::EquityCurvePoint {
                    date: point.date,
                    value: point.value,
                })
                .collect(),
        }
    }

    fn api_performance_to_ui_performance(
        performance: crate::api::PerformanceStats,
    ) -> SignalsPerformanceStats {
        SignalsPerformanceStats {
            total_signals: performance.total_signals,
            completed_signals: performance.total_signals,
            win_rate: performance.win_rate,
            avg_return: performance.avg_return,
            avg_win: 0.0,
            avg_loss: 0.0,
            profit_factor: performance.profit_factor,
            factor_performance: std::collections::HashMap::new(),
        }
    }

    fn comparison_period_days(period: ComparisonTimePeriod) -> u32 {
        match period {
            ComparisonTimePeriod::OneDay => 1,
            ComparisonTimePeriod::OneWeek => 7,
            ComparisonTimePeriod::OneMonth => 30,
            ComparisonTimePeriod::ThreeMonths => 90,
            ComparisonTimePeriod::SixMonths => 180,
            ComparisonTimePeriod::OneYear => 365,
            ComparisonTimePeriod::YearToDate => 365,
        }
    }

    fn extract_json_f64(value: &serde_json::Value, keys: &[&str]) -> Option<f64> {
        for key in keys {
            if let Some(num) = value.get(*key).and_then(|v| v.as_f64()) {
                return Some(num);
            }
        }
        None
    }

    fn load_comparison_data(&mut self, cx: &mut Context<Self>) {
        if self.comparison_state.symbols.is_empty() {
            if let Some(symbol) = self.selected_symbol.clone() {
                self.comparison_state.add_symbol(symbol);
            }
        }

        let symbols: Vec<String> = self
            .comparison_state
            .symbols
            .iter()
            .filter(|symbol| symbol.enabled)
            .map(|symbol| symbol.symbol.clone())
            .collect();

        if symbols.is_empty() {
            self.comparison_state.loading = false;
            cx.notify();
            return;
        }

        self.comparison_state.loading = true;
        cx.notify();

        let period_days = Self::comparison_period_days(self.comparison_state.time_period);
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let mut market_map: std::collections::HashMap<String, MarketData> =
                std::collections::HashMap::new();
            let mut equity_map: std::collections::HashMap<String, EquityFlowResponse> =
                std::collections::HashMap::new();
            let mut history_map: std::collections::HashMap<String, Vec<HistoryPoint>> =
                std::collections::HashMap::new();
            let mut research_map: std::collections::HashMap<String, crate::api::ResearchData> =
                std::collections::HashMap::new();
            let mut peer_metrics: Vec<crate::comparison::PeerMetrics> = Vec::new();
            let mut correlation_matrix: std::collections::HashMap<(String, String), f64> =
                std::collections::HashMap::new();

            for symbol in &symbols {
                if let Ok(response) = client.get_market_data(symbol).await {
                    if response.success {
                        if let Some(data) = response.data {
                            market_map.insert(symbol.clone(), data);
                        }
                    }
                }

                if let Ok(flow) = client.get_equity_flow(symbol).await {
                    equity_map.insert(symbol.clone(), flow);
                }

                if let Ok(response) = client.get_market_history(symbol, period_days, "1d").await {
                    if response.success {
                        if let Some(history) = response.data {
                            let points = history
                                .data_points
                                .into_iter()
                                .map(|point| HistoryPoint {
                                    date: point.date,
                                    close: point.close,
                                })
                                .collect::<Vec<_>>();
                            history_map.insert(symbol.clone(), points);
                        }
                    }
                }

                if let Ok(response) = client.get_valuation(symbol).await {
                    if response.success {
                        if let Some(payload) = response.data {
                            let valuation = payload
                                .get("valuation")
                                .cloned()
                                .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
                            let valuation_data = crate::api::ValuationData {
                                pe_ratio: Self::extract_json_f64(
                                    &valuation,
                                    &["peRatio", "pe_ratio"],
                                )
                                .unwrap_or(0.0),
                                forward_pe: Self::extract_json_f64(
                                    &valuation,
                                    &["forwardPe", "forward_pe"],
                                )
                                .unwrap_or(0.0),
                                peg_ratio: Self::extract_json_f64(
                                    &valuation,
                                    &["pegRatio", "peg_ratio"],
                                )
                                .unwrap_or(0.0),
                                price_to_sales: Self::extract_json_f64(
                                    &valuation,
                                    &["priceToSales", "price_to_sales", "psRatio"],
                                )
                                .unwrap_or(0.0),
                                pb_ratio: Self::extract_json_f64(
                                    &valuation,
                                    &["priceToBook", "pbRatio", "pb_ratio"],
                                )
                                .unwrap_or(0.0),
                                ps_ratio: Self::extract_json_f64(
                                    &valuation,
                                    &["priceToSales", "psRatio", "ps_ratio"],
                                )
                                .unwrap_or(0.0),
                                ev_ebitda: Self::extract_json_f64(
                                    &valuation,
                                    &["evToEbitda", "ev_ebitda"],
                                )
                                .unwrap_or(0.0),
                                dcf_value: Self::extract_json_f64(
                                    &payload,
                                    &["fairValue", "dcfValue", "intrinsicValue"],
                                )
                                .unwrap_or(0.0),
                            };

                            research_map.insert(
                                symbol.clone(),
                                crate::api::ResearchData {
                                    symbol: symbol.clone(),
                                    company_name: symbol.clone(),
                                    sector: String::new(),
                                    industry: String::new(),
                                    analyst_rating: None,
                                    price_target: None,
                                    eps_estimate: None,
                                    revenue_estimate: None,
                                    valuation: Some(valuation_data.clone()),
                                },
                            );

                            let flow = equity_map.get(symbol);
                            peer_metrics.push(crate::comparison::PeerMetrics {
                                symbol: symbol.clone(),
                                pe_ratio: valuation_data.pe_ratio,
                                forward_pe: valuation_data.forward_pe,
                                peg_ratio: valuation_data.peg_ratio,
                                price_to_sales: valuation_data.price_to_sales,
                                price_to_book: valuation_data.pb_ratio,
                                ev_to_ebitda: valuation_data.ev_ebitda,
                                dividend_yield: Self::extract_json_f64(
                                    &valuation,
                                    &["dividendYield", "dividend_yield"],
                                )
                                .unwrap_or(0.0),
                                market_cap: Self::extract_json_f64(
                                    &valuation,
                                    &["marketCap", "market_cap"],
                                )
                                .unwrap_or(0.0),
                                money_flow_score: flow.map(|f| f.money_flow_score).unwrap_or(0.0),
                                institutional_sentiment: flow
                                    .map(|f| f.institutional_sentiment)
                                    .unwrap_or(0.0),
                            });
                        }
                    }
                }
            }

            let correlation_holdings: Vec<crate::api::PortfolioHolding> = symbols
                .iter()
                .map(|symbol| crate::api::PortfolioHolding {
                    symbol: symbol.clone(),
                    shares: 1.0,
                    average_cost: None,
                })
                .collect();

            if correlation_holdings.len() >= 2 {
                if let Ok(response) = client
                    .get_portfolio_correlation(correlation_holdings, period_days.max(30))
                    .await
                {
                    if response.success {
                        if let Some(data) = response.data {
                            for (i, left) in data.symbols.iter().enumerate() {
                                for (j, right) in data.symbols.iter().enumerate() {
                                    if let Some(row) = data.matrix.get(i) {
                                        if let Some(value) = row.get(j) {
                                            correlation_matrix
                                                .insert((left.clone(), right.clone()), *value);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        for item in &mut app.comparison_state.symbols {
                            if let Some(market) = market_map.get(&item.symbol) {
                                item.market_data = Some(market.clone());
                            }
                            if let Some(flow) = equity_map.get(&item.symbol) {
                                item.equity_flow = Some(flow.clone());
                            }
                            if let Some(history) = history_map.get(&item.symbol) {
                                item.history = history.clone();
                            }
                            if let Some(research) = research_map.get(&item.symbol) {
                                item.research = Some(research.clone());
                            }
                        }

                        app.comparison_state.peer_metrics = peer_metrics;
                        app.comparison_state.correlation_matrix = correlation_matrix;
                        app.comparison_state.loading = false;
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load ETF analytics data from API
    pub fn load_etf_data(&mut self, cx: &mut Context<Self>) {
        let client = self.api_client.clone();

        self.etf_state.flows = LoadState::Loading;
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_etf_flows().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.etf_state.flows = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        self.etf_state.sector_rotation = LoadState::Loading;
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_sector_rotation().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.etf_state.sector_rotation = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        self.etf_state.smart_beta = LoadState::Loading;
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_smart_beta_flows().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.etf_state.smart_beta = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        self.etf_state.thematic = LoadState::Loading;
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_thematic_flows().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.etf_state.thematic = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load signals and backtesting analytics from API
    pub fn load_signals_data(&mut self, cx: &mut Context<Self>) {
        let mut symbols = if !self.signals_state.symbol_filter.trim().is_empty() {
            vec![self.signals_state.symbol_filter.trim().to_uppercase()]
        } else if let Some(symbol) = self.selected_symbol.clone() {
            vec![symbol]
        } else {
            self.watchlist.clone()
        };
        if symbols.is_empty() {
            symbols.push("AAPL".to_string());
        }

        self.signals_state.signals = LoadState::Loading;
        self.signals_state.backtest = LoadState::Loading;
        self.signals_state.performance = LoadState::Loading;

        let client = self.api_client.clone();
        let min_conviction = self.signals_state.min_conviction_filter;

        let client_clone = client.clone();
        let symbols_for_generation = symbols.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone
                .generate_signals(symbols_for_generation, min_conviction)
                .await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.signals_state.signals = match result {
                            Ok(r) if r.success => {
                                if let Some(data) = r.data {
                                    LoadState::Loaded(
                                        data.signals
                                            .into_iter()
                                            .map(Self::api_signal_to_ui_signal)
                                            .collect(),
                                    )
                                } else {
                                    LoadState::Error("No data".into())
                                }
                            }
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_signal_performance().await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.signals_state.performance = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(Self::api_performance_to_ui_performance)
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        let request = crate::api::BacktestRequest {
            symbols,
            start_date: None,
            end_date: None,
            holding_period_days: 30,
            initial_capital: 100_000.0,
        };
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.backtest_signals(request).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.signals_state.backtest = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(Self::api_backtest_to_ui_backtest)
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load accounting/filings analytics for a symbol
    pub fn load_accounting_data(&mut self, symbol: String, cx: &mut Context<Self>) {
        self.accounting_state.symbol = symbol.clone();
        self.accounting_state.filings = LoadState::Loading;
        self.accounting_state.quality = LoadState::Loading;
        self.accounting_state.red_flags = LoadState::Loading;

        let client = self.api_client.clone();

        let client_clone = client.clone();
        let filings_symbol = symbol.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_filings(&filings_symbol).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.accounting_state.filings = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        let client_clone = client.clone();
        let quality_symbol = symbol.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_earnings_quality(&quality_symbol).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.accounting_state.quality = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_red_flags(&symbol).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.accounting_state.red_flags = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("No data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load prediction markets data from API
    pub fn load_prediction_markets_data(&mut self, cx: &mut Context<Self>) {
        self.load_prediction_markets_health(cx);
        self.load_polymarket_markets(cx);
        self.load_kalshi_markets(cx);
    }

    fn load_prediction_markets_health(&mut self, cx: &mut Context<Self>) {
        self.prediction_markets_health = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.prediction_markets_health().await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.prediction_markets_health = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadingState::Loaded)
                                .unwrap_or(LoadingState::Error("No data".into())),
                            Ok(r) => LoadingState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadingState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn load_polymarket_markets(&mut self, cx: &mut Context<Self>) {
        let filters = self.prediction_markets_state.polymarket_filters.clone();
        let client = self.api_client.clone();

        self.prediction_markets_state.polymarket_markets = LoadState::Loading;
        self.prediction_markets_state.polymarket_selected = None;
        self.prediction_markets_state.polymarket_prices = LoadState::NotLoaded;

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let status = filters.effective_status();
            let search = if filters.search_query.is_empty() {
                None
            } else {
                Some(filters.search_query.as_str())
            };
            let result = client
                .get_polymarket_markets(
                    search,
                    status,
                    filters.min_volume,
                    Some(filters.limit),
                    Some(filters.offset),
                )
                .await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.prediction_markets_state.polymarket_markets = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(|data| LoadState::Loaded(data.markets))
                                .unwrap_or(LoadState::Error("No markets returned".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };

                        if let LoadState::Loaded(markets) =
                            &app.prediction_markets_state.polymarket_markets
                        {
                            if let Some(first) = markets.first() {
                                app.select_polymarket_market(first.clone(), cx);
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn load_kalshi_markets(&mut self, cx: &mut Context<Self>) {
        let filters = self.prediction_markets_state.kalshi_filters.clone();
        let client = self.api_client.clone();

        self.prediction_markets_state.kalshi_markets = LoadState::Loading;
        self.prediction_markets_state.kalshi_selected = None;
        self.prediction_markets_state.kalshi_prices = LoadState::NotLoaded;

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let status = filters.effective_status();
            let search = if filters.search_query.is_empty() {
                None
            } else {
                Some(filters.search_query.as_str())
            };
            let result = client
                .get_kalshi_markets(
                    search,
                    status,
                    filters.min_volume,
                    Some(filters.limit),
                    Some(filters.offset),
                )
                .await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.prediction_markets_state.kalshi_markets = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(|data| LoadState::Loaded(data.markets))
                                .unwrap_or(LoadState::Error("No markets returned".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };

                        if let LoadState::Loaded(markets) =
                            &app.prediction_markets_state.kalshi_markets
                        {
                            if let Some(first) = markets.first() {
                                app.select_kalshi_market(first.clone(), cx);
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn select_polymarket_market(&mut self, market: PolymarketMarket, cx: &mut Context<Self>) {
        self.prediction_markets_state.polymarket_selected = Some(market.clone());
        self.load_polymarket_prices(&market, cx);
        cx.notify();
    }

    fn select_kalshi_market(&mut self, market: KalshiMarket, cx: &mut Context<Self>) {
        self.prediction_markets_state.kalshi_selected = Some(market.clone());
        self.load_kalshi_prices(&market, cx);
        cx.notify();
    }

    fn load_polymarket_prices(&mut self, market: &PolymarketMarket, cx: &mut Context<Self>) {
        let side_a = match market.side_a.clone() {
            Some(side) => side,
            None => {
                self.prediction_markets_state.polymarket_prices =
                    LoadState::Error("Missing side A token".into());
                return;
            }
        };
        let side_b = match market.side_b.clone() {
            Some(side) => side,
            None => {
                self.prediction_markets_state.polymarket_prices =
                    LoadState::Error("Missing side B token".into());
                return;
            }
        };

        self.prediction_markets_state.polymarket_prices = LoadState::Loading;
        let client = self.api_client.clone();
        let side_a_id = side_a.id.clone();
        let side_b_id = side_b.id.clone();
        let side_a_label = side_a.label.clone();
        let side_b_label = side_b.label.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result_a = client.get_polymarket_market_price(&side_a_id).await;
            let result_b = client.get_polymarket_market_price(&side_b_id).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        let side_a_price = match result_a {
                            Ok(r) if r.success => {
                                r.data.ok_or_else(|| "Missing side A price".to_string())
                            }
                            Ok(r) => Err(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => Err(e.to_string()),
                        };
                        let side_b_price = match result_b {
                            Ok(r) if r.success => {
                                r.data.ok_or_else(|| "Missing side B price".to_string())
                            }
                            Ok(r) => Err(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => Err(e.to_string()),
                        };

                        match (side_a_price, side_b_price) {
                            (Ok(price_a), Ok(price_b)) => {
                                app.prediction_markets_state.polymarket_prices =
                                    LoadState::Loaded(PolymarketPriceSnapshot {
                                        side_a: MarketSidePrice {
                                            label: side_a_label.clone(),
                                            _token_id: side_a_id.clone(),
                                            price: Some(price_a),
                                        },
                                        side_b: MarketSidePrice {
                                            label: side_b_label.clone(),
                                            _token_id: side_b_id.clone(),
                                            price: Some(price_b),
                                        },
                                    });
                            }
                            (Err(err), _) | (_, Err(err)) => {
                                app.prediction_markets_state.polymarket_prices =
                                    LoadState::Error(err);
                            }
                        }

                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn load_kalshi_prices(&mut self, market: &KalshiMarket, cx: &mut Context<Self>) {
        self.prediction_markets_state.kalshi_prices = LoadState::Loading;
        let client = self.api_client.clone();
        let ticker = market.market_ticker.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_kalshi_market_price(&ticker).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        app.prediction_markets_state.kalshi_prices = match result {
                            Ok(r) if r.success => r
                                .data
                                .map(LoadState::Loaded)
                                .unwrap_or(LoadState::Error("Missing price data".into())),
                            Ok(r) => LoadState::Error(r.error.unwrap_or("Unknown error".into())),
                            Err(e) => LoadState::Error(e.to_string()),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn prediction_market_filters(&self, kind: PredictionMarketKind) -> &PredictionMarketFilters {
        match kind {
            PredictionMarketKind::Polymarket => &self.prediction_markets_state.polymarket_filters,
            PredictionMarketKind::Kalshi => &self.prediction_markets_state.kalshi_filters,
        }
    }

    fn prediction_market_filters_mut(
        &mut self,
        kind: PredictionMarketKind,
    ) -> &mut PredictionMarketFilters {
        match kind {
            PredictionMarketKind::Polymarket => {
                &mut self.prediction_markets_state.polymarket_filters
            }
            PredictionMarketKind::Kalshi => &mut self.prediction_markets_state.kalshi_filters,
        }
    }

    fn reload_prediction_market(&mut self, kind: PredictionMarketKind, cx: &mut Context<Self>) {
        match kind {
            PredictionMarketKind::Polymarket => self.load_polymarket_markets(cx),
            PredictionMarketKind::Kalshi => self.load_kalshi_markets(cx),
        }
    }

    fn open_prediction_markets_search(
        &mut self,
        kind: PredictionMarketKind,
        cx: &mut Context<Self>,
    ) {
        self.open_modal(ModalType::PredictionMarketsSearch { kind }, cx);
    }

    fn update_prediction_markets_search_query(
        &mut self,
        kind: PredictionMarketKind,
        query: String,
        cx: &mut Context<Self>,
    ) {
        let filters = self.prediction_market_filters_mut(kind);
        filters.search_query = query;
        filters.offset = 0;
        cx.notify();
    }

    fn apply_prediction_markets_search(
        &mut self,
        kind: PredictionMarketKind,
        cx: &mut Context<Self>,
    ) {
        self.reload_prediction_market(kind, cx);
        self.close_modal(cx);
    }

    fn update_prediction_market_status(
        &mut self,
        kind: PredictionMarketKind,
        status: MarketStatusFilter,
        cx: &mut Context<Self>,
    ) {
        let filters = self.prediction_market_filters_mut(kind);
        filters.status = status;
        if filters.only_open && status != MarketStatusFilter::Open {
            filters.only_open = false;
        }
        filters.offset = 0;
        self.reload_prediction_market(kind, cx);
    }

    fn toggle_prediction_market_only_open(
        &mut self,
        kind: PredictionMarketKind,
        cx: &mut Context<Self>,
    ) {
        let filters = self.prediction_market_filters_mut(kind);
        filters.only_open = !filters.only_open;
        if filters.only_open {
            filters.status = MarketStatusFilter::Open;
        }
        filters.offset = 0;
        self.reload_prediction_market(kind, cx);
    }

    fn update_prediction_market_min_volume(
        &mut self,
        kind: PredictionMarketKind,
        min_volume: Option<f64>,
        cx: &mut Context<Self>,
    ) {
        let filters = self.prediction_market_filters_mut(kind);
        filters.min_volume = min_volume;
        filters.offset = 0;
        self.reload_prediction_market(kind, cx);
    }

    fn update_prediction_market_limit(
        &mut self,
        kind: PredictionMarketKind,
        limit: u32,
        cx: &mut Context<Self>,
    ) {
        let filters = self.prediction_market_filters_mut(kind);
        filters.limit = limit;
        filters.offset = 0;
        self.reload_prediction_market(kind, cx);
    }

    fn change_prediction_market_page(
        &mut self,
        kind: PredictionMarketKind,
        delta: i32,
        cx: &mut Context<Self>,
    ) {
        let filters = self.prediction_market_filters_mut(kind);
        let limit = filters.limit;
        let delta_offset = (delta as i64) * (limit as i64);
        let next = (filters.offset as i64 + delta_offset).max(0) as u32;
        filters.offset = next;
        self.reload_prediction_market(kind, cx);
    }

    // === DASHBOARD DATA LOADING ===

    /// Load all dashboard data from API
    pub fn load_dashboard_data(&mut self, cx: &mut Context<Self>) {
        // Load market data for selected symbol
        if let Some(symbol) = self.selected_symbol.clone() {
            self.load_market_data(symbol.clone(), cx);
            self.load_equity_flow(symbol.clone(), cx);
            self.load_institutional(symbol.clone(), cx);
            self.load_institutional_summary(symbol, cx);
        }
        // Load sector flow data
        self.load_sector_flow(cx);
    }

    /// Load market data for a symbol
    fn load_market_data(&mut self, symbol: String, cx: &mut Context<Self>) {
        self.market_data = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_market_data(&symbol).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(response) => {
                                if response.success {
                                    if let Some(data) = response.data {
                                        app.market_data = LoadingState::Loaded(data);
                                    } else {
                                        app.market_data =
                                            LoadingState::Error("No data returned".to_string());
                                    }
                                } else {
                                    app.market_data = LoadingState::Error(
                                        response.error.unwrap_or("Unknown error".to_string()),
                                    );
                                }
                            }
                            Err(e) => {
                                app.market_data = LoadingState::Error(e.to_string());
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load sector money flow data
    fn load_sector_flow(&mut self, cx: &mut Context<Self>) {
        self.sector_flow = LoadingState::Loading;
        let client = self.api_client.clone();
        let selected_sectors = self.money_flow_sectors.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_money_flow(selected_sectors).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(response) => {
                                if response.success {
                                    if let Some(data) = response.data {
                                        let mut sectors: Vec<SectorFlow> =
                                            data.sectors.into_values().collect();
                                        sectors.sort_by(|a, b| a.symbol.cmp(&b.symbol));
                                        app.sector_flow = LoadingState::Loaded(sectors);
                                    } else {
                                        app.sector_flow =
                                            LoadingState::Error("No data returned".to_string());
                                    }
                                } else {
                                    app.sector_flow = LoadingState::Error(
                                        response.error.unwrap_or("Unknown error".to_string()),
                                    );
                                }
                            }
                            Err(e) => {
                                app.sector_flow = LoadingState::Error(e.to_string());
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load equity flow data for a symbol
    fn load_equity_flow(&mut self, symbol: String, cx: &mut Context<Self>) {
        self.equity_flow = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_equity_flow(&symbol).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        // get_equity_flow returns EquityFlowResponse directly (not wrapped in ApiResponse)
                        match result {
                            Ok(data) => {
                                app.equity_flow = LoadingState::Loaded(data);
                            }
                            Err(e) => {
                                app.equity_flow = LoadingState::Error(e.to_string());
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load institutional holders for a symbol
    fn load_institutional(&mut self, symbol: String, cx: &mut Context<Self>) {
        self.institutional = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_institutional(&symbol).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(response) => {
                                if response.success {
                                    if let Some(data) = response.data {
                                        app.institutional = LoadingState::Loaded(data);
                                    } else {
                                        app.institutional =
                                            LoadingState::Error("No data returned".to_string());
                                    }
                                } else {
                                    app.institutional = LoadingState::Error(
                                        response.error.unwrap_or("Unknown error".to_string()),
                                    );
                                }
                            }
                            Err(e) => {
                                app.institutional = LoadingState::Error(e.to_string());
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load institutional summary metrics for a symbol
    fn load_institutional_summary(&mut self, symbol: String, cx: &mut Context<Self>) {
        self.institutional_summary = LoadingState::Loading;
        let client = self.api_client.clone();

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client.get_institutional_ownership(&symbol).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app: &mut Self, cx: &mut Context<Self>| {
                        match result {
                            Ok(response) => {
                                if response.success {
                                    if let Some(data) = response.data {
                                        app.institutional_summary = LoadingState::Loaded(data);
                                    } else {
                                        app.institutional_summary =
                                            LoadingState::Error("No data returned".to_string());
                                    }
                                } else {
                                    app.institutional_summary = LoadingState::Error(
                                        response.error.unwrap_or("Unknown error".to_string()),
                                    );
                                }
                            }
                            Err(e) => {
                                app.institutional_summary = LoadingState::Error(e.to_string());
                            }
                        }
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    // === PORTFOLIO VIEW ===

    /// Load portfolio data from API
    fn load_portfolio_data(&mut self, cx: &mut Context<Self>) {
        self.portfolio_holdings = PortfolioLoadState::Loading;
        self.portfolio_risk = PortfolioLoadState::Loading;
        self.portfolio_sectors = PortfolioLoadState::Loading;

        let client = self.api_client.clone();

        // Sample holdings to send to API
        let holdings = vec![
            PortfolioHolding {
                symbol: "AAPL".to_string(),
                shares: 100.0,
                average_cost: Some(150.0),
            },
            PortfolioHolding {
                symbol: "MSFT".to_string(),
                shares: 50.0,
                average_cost: Some(280.0),
            },
            PortfolioHolding {
                symbol: "GOOGL".to_string(),
                shares: 25.0,
                average_cost: Some(120.0),
            },
            PortfolioHolding {
                symbol: "NVDA".to_string(),
                shares: 30.0,
                average_cost: Some(450.0),
            },
            PortfolioHolding {
                symbol: "AMZN".to_string(),
                shares: 40.0,
                average_cost: Some(130.0),
            },
            PortfolioHolding {
                symbol: "META".to_string(),
                shares: 35.0,
                average_cost: Some(290.0),
            },
            PortfolioHolding {
                symbol: "TSLA".to_string(),
                shares: 20.0,
                average_cost: Some(200.0),
            },
        ];

        let holdings_for_analytics = holdings.clone();
        let holdings_for_risk = holdings.clone();
        let holdings_for_sectors = holdings;

        // Load portfolio analytics
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone
                .get_portfolio_analytics(holdings_for_analytics, Some("SPY"))
                .await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app, cx| {
                        match result {
                            Ok(r) if r.success => {
                                if let Some(analytics) = r.data {
                                    let total_value = analytics.total_value;
                                    app.portfolio_total_value = total_value;
                                    let holdings: Vec<Holding> = analytics
                                        .top_holdings
                                        .iter()
                                        .map(|h| {
                                            let cost_basis = h.value
                                                / (1.0 + h.return_pct.unwrap_or(0.0) / 100.0);
                                            let shares_est =
                                                h.weight * total_value / h.value.max(1.0);
                                            Holding::new(
                                                h.symbol.clone(),
                                                shares_est,
                                                cost_basis / shares_est.max(1.0),
                                                h.value / shares_est.max(1.0),
                                                total_value,
                                            )
                                        })
                                        .collect();
                                    app.portfolio_holdings = PortfolioLoadState::Loaded(holdings);
                                    let sectors: Vec<SectorAllocation> = analytics
                                        .sector_exposure
                                        .iter()
                                        .map(|(s, w)| SectorAllocation {
                                            sector: s.clone(),
                                            weight: *w * 100.0,
                                            value: total_value * w,
                                        })
                                        .collect();
                                    if !sectors.is_empty() {
                                        app.portfolio_sectors = PortfolioLoadState::Loaded(sectors);
                                    }
                                } else {
                                    app.portfolio_holdings =
                                        PortfolioLoadState::Error("No data".into());
                                }
                            }
                            Ok(r) => {
                                app.portfolio_holdings =
                                    PortfolioLoadState::Error(r.error.unwrap_or("Error".into()));
                            }
                            Err(e) => {
                                app.portfolio_holdings = PortfolioLoadState::Error(e.to_string());
                            }
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        // Load risk metrics
        let client_clone = client.clone();
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone
                .get_portfolio_risk(holdings_for_risk, Some(0.95), Some("historical"))
                .await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app, cx| {
                        match result {
                            Ok(r) if r.success => {
                                if let Some(m) = r.data {
                                    app.portfolio_risk = PortfolioLoadState::Loaded(RiskMetrics {
                                        var_95: m.var_95,
                                        var_99: m.var_99,
                                        cvar_95: m.cvar_95,
                                        max_drawdown: m.max_drawdown,
                                        sharpe_ratio: m.sharpe_ratio,
                                        sortino_ratio: m.sortino_ratio,
                                        beta: m.beta,
                                    });
                                } else {
                                    app.portfolio_risk =
                                        PortfolioLoadState::Error("No data".into());
                                }
                            }
                            Ok(r) => {
                                app.portfolio_risk =
                                    PortfolioLoadState::Error(r.error.unwrap_or("Error".into()));
                            }
                            Err(e) => {
                                app.portfolio_risk = PortfolioLoadState::Error(e.to_string());
                            }
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        // Load sector exposure
        let client_clone = client;
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let result = client_clone.get_sector_exposure(holdings_for_sectors).await;
            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |app, cx| {
                        // Only update if not already loaded from analytics
                        if !matches!(app.portfolio_sectors, PortfolioLoadState::Loaded(_)) {
                            match result {
                                Ok(r) if r.success => {
                                    if let Some(e) = r.data {
                                        let tv = app.portfolio_total_value.max(1.0);
                                        let sectors: Vec<SectorAllocation> = e
                                            .portfolio_weights
                                            .iter()
                                            .map(|(s, w)| SectorAllocation {
                                                sector: s.clone(),
                                                weight: *w * 100.0,
                                                value: tv * w,
                                            })
                                            .collect();
                                        app.portfolio_sectors = PortfolioLoadState::Loaded(sectors);
                                    } else {
                                        app.portfolio_sectors =
                                            PortfolioLoadState::Error("No data".into());
                                    }
                                }
                                Ok(r) => {
                                    app.portfolio_sectors = PortfolioLoadState::Error(
                                        r.error.unwrap_or("Error".into()),
                                    );
                                }
                                Err(e) => {
                                    app.portfolio_sectors = PortfolioLoadState::Error(e.to_string());
                                }
                            };
                            cx.notify();
                        }
                    });
                }
            });
        })
        .detach();
    }

    /// Refresh all data from API
    #[allow(dead_code)]
    pub fn refresh_data(&mut self, cx: &mut Context<Self>) {
        self.check_api_health(cx);
    }

    /// Load notes from disk into notes editor state
    fn load_notes_from_disk(&mut self) {
        self.notes_editor_state.loading = true;
        self.notes_editor_state.all_notes = load_note_summaries();
        self.notes_editor_state.loading = false;
    }

    pub fn set_active_view(&mut self, view: ActiveView, cx: &mut Context<Self>) {
        self.active_view = view;

        // Emit view change event via WebSocket
        self.emit_view_change(view);

        // Load view-specific data when switching views
        if matches!(view, ActiveView::Commodities) {
            self.load_commodities_data(cx);
        }
        if matches!(view, ActiveView::PredictionMarkets)
            && (matches!(
                self.prediction_markets_state.polymarket_markets,
                LoadState::NotLoaded
            ) || matches!(
                self.prediction_markets_state.kalshi_markets,
                LoadState::NotLoaded
            ))
        {
            self.load_prediction_markets_data(cx);
        }
        if view == ActiveView::Portfolio
            && matches!(self.portfolio_holdings, PortfolioLoadState::NotLoaded)
        {
            self.load_portfolio_data(cx);
        }
        if view == ActiveView::MoneyFlow && matches!(self.sector_flow, LoadingState::NotStarted) {
            self.load_sector_flow(cx);
        }
        if view == ActiveView::Market && matches!(self.market_data, LoadingState::NotStarted) {
            if let Some(symbol) = self.selected_symbol.clone() {
                self.load_market_data(symbol, cx);
            }
        }
        if view == ActiveView::Institutional
            && matches!(self.institutional_summary, LoadingState::NotStarted)
        {
            if let Some(symbol) = self.selected_symbol.clone() {
                self.load_institutional_summary(symbol, cx);
            }
        }
        if view == ActiveView::Comparison {
            self.load_comparison_data(cx);
        }
        if view == ActiveView::Etf
            && (matches!(self.etf_state.flows, LoadState::NotLoaded)
                || matches!(self.etf_state.sector_rotation, LoadState::NotLoaded)
                || matches!(self.etf_state.smart_beta, LoadState::NotLoaded)
                || matches!(self.etf_state.thematic, LoadState::NotLoaded))
        {
            self.load_etf_data(cx);
        }
        if view == ActiveView::Signals
            && (matches!(self.signals_state.signals, LoadState::NotLoaded)
                || matches!(self.signals_state.backtest, LoadState::NotLoaded)
                || matches!(self.signals_state.performance, LoadState::NotLoaded))
        {
            self.load_signals_data(cx);
        }
        if view == ActiveView::Accounting {
            if let Some(symbol) = self.selected_symbol.clone() {
                let symbol_changed = self.accounting_state.symbol != symbol;
                let needs_load = matches!(self.accounting_state.filings, LoadState::NotLoaded)
                    || matches!(self.accounting_state.quality, LoadState::NotLoaded)
                    || matches!(self.accounting_state.red_flags, LoadState::NotLoaded);
                if symbol_changed || needs_load {
                    self.load_accounting_data(symbol, cx);
                }
            }
        }
        // Refresh notes list when switching to Notes view
        if view == ActiveView::Notes {
            self.load_notes_from_disk();
        }
        cx.notify();
    }

    fn toggle_money_flow_sector(&mut self, sector: String, cx: &mut Context<Self>) {
        if self.money_flow_sectors.iter().any(|s| s == &sector) {
            self.money_flow_sectors.retain(|s| s != &sector);
        } else {
            self.money_flow_sectors.push(sector);
        }

        self.money_flow_sectors.sort_by_key(|s| {
            MONEY_FLOW_SECTORS
                .iter()
                .position(|candidate| candidate == s)
                .unwrap_or(usize::MAX)
        });

        self.load_sector_flow(cx);
        cx.notify();
    }

    pub fn select_symbol(&mut self, symbol: String, cx: &mut Context<Self>) {
        let previous = self.selected_symbol.clone();
        let context = self.active_view.name();
        self.selected_symbol = Some(symbol.clone());

        // Emit symbol change event via WebSocket
        self.emit_symbol_change(&symbol, context, previous.as_deref());

        // Refresh symbol-specific data
        self.load_market_data(symbol.clone(), cx);
        self.load_equity_flow(symbol.clone(), cx);
        self.load_institutional(symbol.clone(), cx);
        self.load_institutional_summary(symbol.clone(), cx);
        self.accounting_state.symbol = symbol.clone();
        if self.active_view == ActiveView::Accounting {
            self.load_accounting_data(symbol.clone(), cx);
        }
        if self.active_view == ActiveView::Signals {
            self.load_signals_data(cx);
        }
        if self.active_view == ActiveView::Comparison {
            self.load_comparison_data(cx);
        }

        cx.notify();
    }

    pub fn set_time_period(&mut self, period: TimePeriod, cx: &mut Context<Self>) {
        self.selected_period = period;
        cx.notify();
    }

    pub fn set_notes_tab(&mut self, tab: NotesTab, cx: &mut Context<Self>) {
        self.notes_active_tab = tab;
        cx.notify();
    }

    // =========================================================================
    // NOTES EDITOR ACTIONS
    // =========================================================================

    /// Handle notes editor action - applies formatting or executes editor command
    pub fn handle_notes_editor_action(&mut self, action: NotesAction, cx: &mut Context<Self>) {
        handle_notes_action(&mut self.notes_editor_state, action);
        cx.notify();
    }

    /// Insert bold formatting in notes editor
    pub fn notes_editor_bold(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::InsertBold, cx);
        }
    }

    /// Insert italic formatting in notes editor
    pub fn notes_editor_italic(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::InsertItalic, cx);
        }
    }

    /// Insert code formatting in notes editor
    pub fn notes_editor_code(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::InsertCode, cx);
        }
    }

    /// Save current note in notes editor
    pub fn notes_editor_save(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            if let Some(buffer) = self.notes_editor_state.active_buffer_mut() {
                match save_note(buffer) {
                    Ok(()) => {
                        buffer.mark_saved();
                        // Optionally: show success notification
                    }
                    Err(e) => {
                        self.notes_editor_state.error = Some(format!("Failed to save: {}", e));
                    }
                }
            }
            cx.notify();
        }
    }

    /// Toggle preview mode in notes editor
    pub fn notes_editor_preview(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::TogglePreview, cx);
        }
    }

    /// Create new note in notes editor
    pub fn notes_editor_new_note(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::NewNote, cx);
        }
    }

    /// Close current note in notes editor
    pub fn notes_editor_close_note(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::CloseNote, cx);
        }
    }

    /// Toggle split view in notes editor
    pub fn notes_editor_split_view(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::ToggleSplit, cx);
        }
    }

    /// Navigate to next tab in notes editor
    pub fn notes_editor_next_tab(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::NextTab, cx);
        }
    }

    /// Navigate to previous tab in notes editor
    pub fn notes_editor_prev_tab(&mut self, cx: &mut Context<Self>) {
        if self.active_view == ActiveView::Notes && self.notes_active_tab == NotesTab::Editor {
            self.handle_notes_editor_action(NotesAction::PrevTab, cx);
        }
    }
}

impl Render for ZeeApp {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .id("stanley-app-root")
            .size_full()
            .flex()
            .flex_row()
            .bg(theme.background)
            .text_color(theme.text)
            .font_family("Inter")
            .key_context("ZeeApp")
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _window, cx| {
                // Handle text input for symbol search modal
                if this.is_modal_open(&ModalType::SymbolSearch) {
                    let key = &event.keystroke.key;
                    let has_modifiers = event.keystroke.modifiers.control
                        || event.keystroke.modifiers.alt
                        || event.keystroke.modifiers.platform;

                    // Handle backspace
                    if key == "backspace" && !has_modifiers {
                        let mut query = this.symbol_search_query.clone();
                        query.pop();
                        this.update_symbol_search_query(query, cx);
                        return;
                    }

                    // Handle character input (single printable character without modifiers)
                    if key.len() == 1 && !has_modifiers {
                        let mut query = this.symbol_search_query.clone();
                        query.push_str(key);
                        this.update_symbol_search_query(query, cx);
                        return;
                    }

                    // Handle space
                    if key == "space" && !has_modifiers {
                        let mut query = this.symbol_search_query.clone();
                        query.push(' ');
                        this.update_symbol_search_query(query, cx);
                        return;
                    }
                }

                if let Some(ModalType::PredictionMarketsSearch { kind }) = this.active_modal.clone()
                {
                    let key = &event.keystroke.key;
                    let has_modifiers = event.keystroke.modifiers.control
                        || event.keystroke.modifiers.alt
                        || event.keystroke.modifiers.platform;

                    if key == "escape" {
                        this.close_modal(cx);
                        return;
                    }

                    if key == "return" || key == "enter" {
                        this.apply_prediction_markets_search(kind, cx);
                        return;
                    }

                    if key == "backspace" && !has_modifiers {
                        let mut query = this.prediction_market_filters(kind).search_query.clone();
                        query.pop();
                        this.update_prediction_markets_search_query(kind, query, cx);
                        return;
                    }

                    if key == "space" && !has_modifiers {
                        let mut query = this.prediction_market_filters(kind).search_query.clone();
                        query.push(' ');
                        this.update_prediction_markets_search_query(kind, query, cx);
                        return;
                    }

                    if key.len() == 1 && !has_modifiers {
                        let mut query = this.prediction_market_filters(kind).search_query.clone();
                        query.push_str(key);
                        this.update_prediction_markets_search_query(kind, query, cx);
                        return;
                    }
                }

                // Process keyboard shortcuts/actions
                if let Some(action) = this.keyboard_manager.process_key(&event.keystroke) {
                    this.handle_keyboard_action(action, cx);
                }
            }))
            .when(self.is_sidebar_open, |el| el.child(self.render_sidebar(cx)))
            .child(self.render_main_content(cx))
            // Modal overlay - unified modal system renders active modal
            .when_some(self.active_modal.clone(), |el, modal_type| {
                el.child(self.render_active_modal(&modal_type, cx))
            })
            // Quick actions panel overlay (Ctrl+Shift+K) - legacy support
            .when(
                self.quick_actions_state.is_expanded && self.active_modal.is_none(),
                |el| el.child(self.render_quick_actions_panel(cx)),
            )
    }
}

impl ZeeApp {
    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .w(px(260.0))
            .h_full()
            .flex()
            .flex_col()
            .bg(theme.sidebar_bg)
            .border_r_1()
            .border_color(theme.border_subtle)
            .child(self.render_logo())
            .child(self.render_nav_items(cx))
            .child(self.render_watchlist(cx))
            .child(self.render_sidebar_footer(cx))
    }

    /// Render sidebar footer with settings and quick actions buttons
    fn render_sidebar_footer(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .mt_auto()
            .px(px(12.0))
            .py(px(12.0))
            .border_t_1()
            .border_color(theme.border_subtle)
            .flex()
            .items_center()
            .justify_between()
            .gap(px(8.0))
            // Quick Actions button
            .child(
                div()
                    .id("quick-actions-btn")
                    .group("quick-actions-tooltip-group")
                    .relative()
                    .flex_1()
                    .px(px(12.0))
                    .py(px(8.0))
                    .rounded(px(8.0))
                    .bg(theme.hover_bg)
                    .cursor_pointer()
                    .hover(|s| s.bg(theme.active_bg))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.open_modal(ModalType::QuickActions, cx);
                    }))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .text_color(theme.text_muted)
                                    .child(">>"),
                            )
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(theme.text_secondary)
                                    .child("Quick Actions"),
                            ),
                    )
                    .child(self.render_tooltip(
                        "Quick Actions (Ctrl+Shift+K)",
                        "quick-actions-tooltip-group",
                    )),
            )
            // Settings button (gear icon)
            .child(
                div()
                    .id("settings-btn")
                    .group("settings-tooltip-group")
                    .relative()
                    .size(px(36.0))
                    .rounded(px(8.0))
                    .bg(theme.hover_bg)
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .justify_center()
                    .hover(|s| s.bg(theme.active_bg))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.open_modal(ModalType::Settings, cx);
                    }))
                    .child(
                        // Gear icon using Unicode
                        div()
                            .text_size(px(16.0))
                            .text_color(theme.text_muted)
                            .child("\u{2699}"), // Unicode gear symbol
                    )
                    .child(self.render_tooltip("Settings", "settings-tooltip-group")),
            )
    }

    fn render_tooltip(&self, text: &str, group_id: impl Into<SharedString>) -> impl IntoElement {
        let theme = &self.theme;
        div()
            .absolute()
            .bottom(px(42.0))
            .left(px(0.0))
            .opacity(0.0)
            .group_hover(group_id, |s| s.opacity(1.0))
            .px(px(8.0))
            .py(px(4.0))
            .bg(theme.card_bg_elevated)
            .border_1()
            .border_color(theme.border)
            .shadow_sm()
            .rounded(px(4.0))
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.text)
                    .whitespace_nowrap()
                    .child(text.to_string()),
            )
    }

    fn render_clear_button(
        &self,
        group_id: impl Into<SharedString>,
        action: impl Fn(&mut Self, &mut Context<Self>) + 'static + Send + Sync,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let group_id = group_id.into();

        gpui::div()
            .id("clear-btn")
            .on_click(cx.listener(move |this, _event, _window, cx| {
                action(this, cx);
            }))
            .group(group_id.clone())
            .relative()
            .ml(px(4.0))
            .px(px(4.0))
            .py(px(2.0))
            .rounded(px(4.0))
            .cursor_pointer()
            .hover(|s| s.bg(theme.hover_bg))
            .child(
                gpui::div()
                    .text_size(px(12.0))
                    .text_color(theme.text_dimmed)
                    .child("✕"),
            )
            .child(
                div()
                    .absolute()
                    .top(px(24.0))
                    .right(px(0.0))
                    .opacity(0.0)
                    .group_hover(group_id, |s| s.opacity(1.0))
                    .px(px(8.0))
                    .py(px(4.0))
                    .bg(theme.card_bg_elevated)
                    .border_1()
                    .border_color(theme.border_subtle)
                    .rounded(px(4.0))
                    .shadow_md()
                    .text_size(px(11.0))
                    .text_color(theme.text)
                    .whitespace_nowrap()
                    .child("Clear"),
            )
    }

    fn render_logo(&self) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .px(px(20.0))
            .py(px(24.0))
            .flex()
            .items_center()
            .gap(px(14.0))
            .border_b_1()
            .border_color(theme.border_subtle)
            .mb(px(8.0))
            .child(
                // Logo icon with refined styling
                div()
                    .size(px(40.0))
                    .bg(theme.accent)
                    .rounded(px(10.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .border_1()
                    .border_color(theme.accent_glow)
                    .child(
                        div()
                            .text_size(px(20.0))
                            .font_weight(FontWeight::BLACK)
                            .text_color(hsla(0.0, 0.0, 1.0, 0.95))
                            .child("S"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_size(px(18.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child("Stanley"),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .child("Investment Analysis"),
                    ),
            )
    }

    fn render_nav_items(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex()
            .flex_col()
            .gap(px(2.0))
            .px(px(12.0))
            .py(px(12.0))
            // Section label
            .child(
                div()
                    .text_size(px(10.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text_dimmed)
                    .px(px(12.0))
                    .mb(px(8.0))
                    .child("NAVIGATION"),
            )
            .child(self.nav_item("Dashboard", ActiveView::Dashboard, cx))
            .child(self.nav_item("Market", ActiveView::Market, cx))
            .child(self.nav_item("Prediction Markets", ActiveView::PredictionMarkets, cx))
            .child(self.nav_item("Money Flow", ActiveView::MoneyFlow, cx))
            .child(self.nav_item("Institutional", ActiveView::Institutional, cx))
            .child(self.nav_item("Dark Pool", ActiveView::DarkPool, cx))
            .child(self.nav_item("Options Flow", ActiveView::Options, cx))
            .child(self.nav_item("Portfolio", ActiveView::Portfolio, cx))
            .child(self.nav_item("Research", ActiveView::Research, cx))
            .child(self.nav_item("ETF Analytics", ActiveView::Etf, cx))
            .child(self.nav_item("Signals", ActiveView::Signals, cx))
            .child(self.nav_item("Accounting", ActiveView::Accounting, cx))
            .child(self.nav_item("Commodities", ActiveView::Commodities, cx))
            .child(self.nav_item("Comparison", ActiveView::Comparison, cx))
            .child(self.nav_item("Notes", ActiveView::Notes, cx))
            .child(self.nav_item("AI Agent", ActiveView::Agent, cx))
    }

    fn nav_item(&self, label: &str, view: ActiveView, cx: &mut Context<Self>) -> impl IntoElement {
        let is_active = self.active_view == view;
        let theme = &self.theme;

        let bg = if is_active {
            theme.accent_subtle
        } else {
            transparent_black()
        };
        let text_color = if is_active {
            theme.accent
        } else {
            theme.text_muted
        };
        let hover_text = if is_active {
            theme.accent
        } else {
            theme.text_secondary
        };

        div()
            .id(SharedString::from(format!("nav-{:?}", view)))
            .relative()
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(12.0))
            .py(px(10.0))
            .rounded(px(8.0))
            .bg(bg)
            .text_color(text_color)
            .text_size(px(13.0))
            .font_weight(if is_active {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            })
            .cursor_pointer()
            .hover(|s| s.bg(theme.nav_hover).text_color(hover_text))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.set_active_view(view, cx);
            }))
            // Active indicator bar on the left
            .when(is_active, |s| {
                s.child(
                    div()
                        .absolute()
                        .left(px(-12.0))
                        .top(px(8.0))
                        .bottom(px(8.0))
                        .w(px(3.0))
                        .rounded(px(2.0))
                        .bg(theme.nav_active_indicator),
                )
            })
            .child(label.to_string())
    }

    fn render_watchlist(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex_grow()
            .flex()
            .flex_col()
            .px(px(12.0))
            .py(px(16.0))
            .border_t_1()
            .border_color(theme.border_subtle)
            .mt(px(8.0))
            .child(
                div()
                    .text_size(px(10.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text_dimmed)
                    .px(px(12.0))
                    .mb(px(12.0))
                    .child("WATCHLIST"),
            )
            .children(
                self.watchlist
                    .iter()
                    .enumerate()
                    .map(|(idx, symbol)| self.watchlist_item(symbol, idx, cx))
                    .collect::<Vec<_>>(),
            )
    }

    fn watchlist_item(
        &self,
        symbol: &str,
        index: usize,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let is_selected = self.selected_symbol.as_deref() == Some(symbol);
        let is_keyboard_focused = self.watchlist_selected_index == index;
        let symbol_owned = symbol.to_string();

        // Background: highlight if selected symbol OR keyboard focused
        let bg = if is_selected {
            theme.accent_subtle
        } else if is_keyboard_focused {
            theme.hover_bg
        } else {
            transparent_black()
        };
        let text_color = if is_selected {
            theme.text
        } else {
            theme.text_secondary
        };

        div()
            .id(SharedString::from(format!("watchlist-{}", symbol)))
            .relative()
            .px(px(12.0))
            .py(px(10.0))
            .rounded(px(8.0))
            .bg(bg)
            .cursor_pointer()
            .hover(|s| s.bg(theme.nav_hover))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.select_symbol(symbol_owned.clone(), cx);
            }))
            .flex()
            .justify_between()
            .items_center()
            // Selected indicator (left accent border)
            .when(is_selected, |s| {
                s.border_l_2().border_color(theme.accent).pl(px(10.0))
            })
            // Keyboard focus indicator (subtle outline when navigating with keyboard)
            .when(is_keyboard_focused && !is_selected, |s| {
                s.border_1().border_color(theme.border)
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(text_color)
                            .child(symbol.to_string()),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .child("$192.42"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.positive)
                            .child("+2.4%"),
                    )
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.positive_muted)
                            .child("+$4.52"),
                    ),
            )
    }

    fn render_main_content(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex_grow()
            .h_full()
            .flex()
            .flex_col()
            .child(self.render_header(cx))
            .child(self.render_quick_actions_bar(cx))
            .child(self.render_workspace_content(cx))
    }

    fn render_quick_actions_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let current_symbol = self.selected_symbol.clone();

        // Get popular actions to display
        let popular_actions = self.quick_actions_state.get_popular_actions(5);

        div()
            .id("quick-actions-bar")
            .w_full()
            .h(px(44.0))
            .px(px(28.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .bg(theme.sidebar_bg)
            .border_b_1()
            .border_color(theme.border_subtle)
            // Label
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.text_muted)
                    .font_weight(FontWeight::MEDIUM)
                    .child("Quick:"),
            )
            // Action buttons
            .children(popular_actions.into_iter().map(|action| {
                let prompt = action.build_prompt(current_symbol.as_deref());
                let category_color = action.category.color();
                let action_name = action.name.clone();
                let action_icon = action.icon.clone();

                div()
                    .id(SharedString::from(format!("qa-{}", action.id)))
                    .px(px(10.0))
                    .py(px(5.0))
                    .rounded(px(6.0))
                    .bg(theme.background)
                    .border_1()
                    .border_color(theme.border_subtle)
                    .hover(|s| s.bg(theme.hover_bg).border_color(category_color))
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.handle_quick_action(prompt.clone(), cx);
                    }))
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(category_color)
                            .child(action_icon.clone()),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_secondary)
                            .font_weight(FontWeight::MEDIUM)
                            .child(action_name),
                    )
            }))
            // Separator before suggestions
            .when(self.suggestions_state.enabled, |parent| {
                parent.child(
                    div()
                        .h(px(20.0))
                        .w(px(1.0))
                        .bg(theme.border_subtle)
                        .mx(px(4.0)),
                )
            })
            // Contextual suggestions (when enabled)
            .child(self.render_contextual_suggestions(cx))
            // Spacer
            .child(div().flex_grow())
            // Toggle suggestions button
            .child(
                div()
                    .id("toggle-suggestions")
                    .px(px(10.0))
                    .py(px(5.0))
                    .rounded(px(6.0))
                    .bg(if self.suggestions_state.enabled {
                        theme.accent_subtle
                    } else {
                        theme.background
                    })
                    .border_1()
                    .border_color(if self.suggestions_state.enabled {
                        theme.accent
                    } else {
                        theme.border_subtle
                    })
                    .hover(|s| s.bg(theme.hover_bg))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_suggestions(cx);
                    }))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(if self.suggestions_state.enabled {
                                theme.accent
                            } else {
                                theme.text_muted
                            })
                            .font_weight(FontWeight::MEDIUM)
                            .child(if self.suggestions_state.enabled {
                                "✓ Suggestions"
                            } else {
                                "Suggestions"
                            }),
                    ),
            )
    }

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let symbol = self.selected_symbol.as_deref().unwrap_or("Select Symbol");

        // Extract market data for the header
        let (price_change_text, is_positive, price_display) = match &self.market_data {
            LoadingState::Loaded(data) => {
                let change = data.change;
                let change_pct = data.change_percent;
                let is_pos = change >= 0.0;
                let sign = if is_pos { "+" } else { "" };
                let price_str =
                    format!("{}${:.2} ({}{:.2}%)", sign, change.abs(), sign, change_pct);
                let price = format!("${:.2}", data.price);
                (price_str, is_pos, Some(price))
            }
            LoadingState::Loading => ("...".to_string(), true, None),
            LoadingState::Error(_) => ("Data unavailable".to_string(), false, None),
            LoadingState::NotStarted => ("Not loaded".to_string(), false, None),
        };

        let (badge_bg, badge_border, badge_text) = if is_positive {
            (theme.positive_subtle, theme.positive_muted, theme.positive)
        } else {
            (theme.negative_subtle, theme.negative_muted, theme.negative)
        };

        div()
            .h(px(72.0))
            .px(px(28.0))
            .flex()
            .items_center()
            .justify_between()
            .border_b_1()
            .border_color(theme.border_subtle)
            .bg(theme.background)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(20.0))
                    // Sidebar toggle button
                    .child(
                        div()
                            .id("sidebar-toggle-btn")
                            .group("sidebar-toggle-tooltip")
                            .relative()
                            .size(px(32.0))
                            .rounded(px(6.0))
                            .bg(if self.is_sidebar_open {
                                transparent_black()
                            } else {
                                theme.hover_bg
                            })
                            .flex()
                            .items_center()
                            .justify_center()
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.hover_bg))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.toggle_sidebar(cx);
                            }))
                            .child(
                                div()
                                    .text_size(px(16.0))
                                    .text_color(theme.text_secondary)
                                    .child("\u{2630}"), // Hamburger menu icon
                            )
                            .child(
                                self.render_tooltip(
                                    if self.is_sidebar_open {
                                        "Collapse Sidebar (Ctrl+B)"
                                    } else {
                                        "Expand Sidebar (Ctrl+B)"
                                    },
                                    "sidebar-toggle-tooltip",
                                ),
                            ),
                    )
                    .child(
                        div()
                            .id("zee-sidecar-toggle-btn")
                            .group("zee-sidecar-toggle-tooltip")
                            .relative()
                            .h(px(32.0))
                            .px(px(10.0))
                            .rounded(px(6.0))
                            .bg(if self.is_zee_sidecar_open {
                                theme.accent_subtle
                            } else {
                                theme.hover_bg
                            })
                            .flex()
                            .items_center()
                            .justify_center()
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.hover_bg))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                this.toggle_zee_sidecar(cx);
                            }))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(if self.is_zee_sidecar_open {
                                        theme.accent
                                    } else {
                                        theme.text_secondary
                                    })
                                    .child("ZEE"),
                            )
                            .child(self.render_tooltip(
                                if self.is_zee_sidecar_open {
                                    "Hide Zee Sidecar"
                                } else {
                                    "Show Zee Sidecar"
                                },
                                "zee-sidecar-toggle-tooltip",
                            )),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .text_size(px(26.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .child(symbol.to_string()),
                            )
                            .when_some(price_display, |el, price| {
                                el.child(
                                    div()
                                        .text_size(px(18.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text)
                                        .child(price),
                                )
                            }),
                    )
                    .child(
                        // Price change badge with improved styling
                        div()
                            .px(px(12.0))
                            .py(px(6.0))
                            .rounded(px(6.0))
                            .bg(badge_bg)
                            .border_1()
                            .border_color(badge_border)
                            .text_color(badge_text)
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(price_change_text),
                    ),
            )
            .child(
                // Time period selector with improved styling
                div()
                    .flex()
                    .gap(px(4.0))
                    .p(px(4.0))
                    .rounded(px(8.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border_subtle)
                    .children(
                        TimePeriod::all()
                            .iter()
                            .map(|&period| self.time_period_button(period, cx))
                            .collect::<Vec<_>>(),
                    ),
            )
    }

    fn time_period_button(&self, period: TimePeriod, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let is_selected = self.selected_period == period;

        let bg = if is_selected {
            theme.accent_subtle
        } else {
            transparent_black()
        };
        let text_color = if is_selected {
            theme.accent
        } else {
            theme.text_muted
        };

        div()
            .id(SharedString::from(format!("period-{}", period.label())))
            .px(px(14.0))
            .py(px(6.0))
            .rounded(px(6.0))
            .bg(bg)
            .text_size(px(12.0))
            .font_weight(if is_selected {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::MEDIUM
            })
            .text_color(text_color)
            .cursor_pointer()
            .hover(|s| s.bg(theme.hover_bg).text_color(theme.text_secondary))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.set_time_period(period, cx);
            }))
            .child(period.label())
    }

    fn should_render_zee_sidecar(&self) -> bool {
        self.is_zee_sidecar_open && self.active_view != ActiveView::Agent
    }

    fn render_workspace_content(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex_grow()
            .min_h_0()
            .flex()
            .bg(theme.background)
            .child(div().flex_grow().min_w_0().child(self.render_content_area(cx)))
            .when(self.should_render_zee_sidecar(), |el| {
                el.child(self.render_zee_sidecar(cx))
            })
    }

    fn render_zee_sidecar(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        div()
            .w(px(420.0))
            .min_w(px(320.0))
            .h_full()
            .flex()
            .flex_col()
            .bg(theme.card_bg)
            .border_l_1()
            .border_color(theme.border_subtle)
            .child(
                div()
                    .h(px(44.0))
                    .px(px(14.0))
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .child(
                        div()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_secondary)
                            .child("Zee Sidecar"),
                    )
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.text_dimmed)
                            .child("Pair workspace"),
                    ),
            )
            .child(
                div().flex_grow().min_h_0().child(render_agent_panel(
                    &self.theme,
                    &self.agent_state,
                    &self.agent_input,
                    cx.listener(|this, _event, _window, cx| {
                        this.agent_input.clear();
                        cx.notify();
                    }),
                    cx,
                )),
            )
    }

    fn render_content_area(&self, cx: &mut Context<Self>) -> impl IntoElement {
        match self.active_view {
            ActiveView::Market => self.render_market_view(cx).into_any_element(),
            ActiveView::PredictionMarkets => {
                self.render_prediction_markets_view(cx).into_any_element()
            }
            ActiveView::MoneyFlow => self.render_money_flow_view(cx).into_any_element(),
            ActiveView::Institutional => self.render_institutional_view(cx).into_any_element(),
            ActiveView::Notes => self.render_notes_panel(cx).into_any_element(),
            ActiveView::Commodities => self.render_commodities_view(cx).into_any_element(),
            ActiveView::Portfolio => self.render_portfolio_view().into_any_element(),
            ActiveView::Comparison => self.render_comparison_view(cx).into_any_element(),
            ActiveView::Etf => self.render_etf_view(cx).into_any_element(),
            ActiveView::Signals => self.render_signals_view(cx).into_any_element(),
            ActiveView::Accounting => self.render_accounting_view(cx).into_any_element(),
            ActiveView::Agent => self.render_agent_view(cx).into_any_element(),
            ActiveView::Observability => {
                render_observability(&self.observability_state, &self.theme).into_any_element()
            }
            _ => self.render_dashboard_content(cx).into_any_element(),
        }
    }

    fn render_market_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = &self.theme;
        let content = self.render_market_content();

        div()
            .id("market-view-scroll")
            .flex_grow()
            .h_full()
            .overflow_y_scroll()
            .bg(theme.background)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.0))
                    .p(px(28.0))
                    .child(self.render_market_header(cx))
                    .child(content),
            )
            .into_any_element()
    }

    fn render_prediction_markets_view(&self, cx: &mut Context<Self>) -> Stateful<Div> {
        let theme = &self.theme;

        div()
            .id("prediction-markets-view")
            .flex_grow()
            .h_full()
            .overflow_y_scroll()
            .bg(theme.background)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.0))
                    .p(px(28.0))
                    .child(self.render_prediction_markets_header(cx))
                    .child(self.render_polymarket_section(cx))
                    .child(self.render_kalshi_section(cx)),
            )
    }

    fn render_prediction_markets_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .child(
                        div()
                            .text_size(px(24.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child("Prediction Markets"),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(theme.text_muted)
                            .child("Dome API feed: Polymarket and Kalshi"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .child(self.render_prediction_markets_health_badge())
                    .child(self.render_prediction_markets_refresh_button(cx)),
            )
    }

    fn render_prediction_markets_refresh_button(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .id("prediction-markets-refresh")
            .px(px(14.0))
            .py(px(8.0))
            .rounded(px(8.0))
            .bg(theme.accent_subtle)
            .border_1()
            .border_color(theme.accent_muted)
            .text_size(px(12.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.accent)
            .cursor_pointer()
            .hover(|s| s.bg(theme.accent.opacity(0.2)))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.load_prediction_markets_data(cx);
            }))
            .child("Refresh")
    }

    fn render_prediction_markets_health_badge(&self) -> impl IntoElement {
        let theme = &self.theme;

        let (label, bg, border, text) = match &self.prediction_markets_health {
            LoadingState::Loaded(health) => {
                if health.status == "healthy" {
                    (
                        "Dome: OK",
                        theme.positive_subtle,
                        theme.positive_muted,
                        theme.positive,
                    )
                } else {
                    (
                        "Dome: Degraded",
                        theme.warning.opacity(0.15),
                        theme.warning.opacity(0.3),
                        theme.warning,
                    )
                }
            }
            LoadingState::Loading => (
                "Dome: Checking",
                theme.accent_subtle,
                theme.accent_muted,
                theme.accent,
            ),
            LoadingState::Error(_) => (
                "Dome: Error",
                theme.negative_subtle,
                theme.negative_muted,
                theme.negative,
            ),
            LoadingState::NotStarted => (
                "Dome: Idle",
                theme.card_bg_elevated,
                theme.border_subtle,
                theme.text_muted,
            ),
        };

        div()
            .px(px(12.0))
            .py(px(6.0))
            .rounded(px(999.0))
            .bg(bg)
            .border_1()
            .border_color(border)
            .text_size(px(11.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(text)
            .child(label)
    }

    fn render_prediction_market_filters(
        &self,
        kind: PredictionMarketKind,
        cx: &mut Context<Self>,
    ) -> Div {
        let theme = &self.theme;
        let filters = self.prediction_market_filters(kind);
        let query_label = if filters.search_query.is_empty() {
            "All markets".to_string()
        } else {
            filters.search_query.clone()
        };
        let page_label = format!("Page {}", filters.page());
        let can_prev = filters.offset >= filters.limit;

        div()
            .flex()
            .flex_col()
            .gap(px(10.0))
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
                                    .text_size(px(12.0))
                                    .text_color(theme.text_muted)
                                    .child("Search:"),
                            )
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .child(query_label),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .child(self.render_filter_button(
                                "Search",
                                !filters.search_query.is_empty(),
                                false,
                                cx,
                                move |this, cx| {
                                    this.open_prediction_markets_search(kind, cx);
                                },
                            ))
                            .child(self.render_filter_button(
                                "Only Open",
                                filters.only_open,
                                false,
                                cx,
                                move |this, cx| {
                                    this.toggle_prediction_market_only_open(kind, cx);
                                },
                            )),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(8.0))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Status"),
                            )
                            .child(
                                div().flex().gap(px(6.0)).children(
                                    [
                                        MarketStatusFilter::All,
                                        MarketStatusFilter::Open,
                                        MarketStatusFilter::Closed,
                                    ]
                                    .iter()
                                    .map(|status| {
                                        let status_value = *status;
                                        self.render_filter_button(
                                            status_value.label(),
                                            filters.status == status_value,
                                            false,
                                            cx,
                                            move |this, cx| {
                                                this.update_prediction_market_status(
                                                    kind,
                                                    status_value,
                                                    cx,
                                                );
                                            },
                                        )
                                        .into_any_element()
                                    })
                                    .collect::<Vec<_>>(),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Min Vol"),
                            )
                            .child(
                                div().flex().gap(px(6.0)).children(
                                    [
                                        (None, "Any"),
                                        (Some(100_000.0), "100K"),
                                        (Some(1_000_000.0), "1M"),
                                        (Some(10_000_000.0), "10M"),
                                    ]
                                    .iter()
                                    .map(|(value, label)| {
                                        let value_copy = *value;
                                        self.render_filter_button(
                                            label,
                                            filters.min_volume == value_copy,
                                            false,
                                            cx,
                                            move |this, cx| {
                                                this.update_prediction_market_min_volume(
                                                    kind, value_copy, cx,
                                                );
                                            },
                                        )
                                        .into_any_element()
                                    })
                                    .collect::<Vec<_>>(),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Limit"),
                            )
                            .child(
                                div().flex().gap(px(6.0)).children(
                                    [10u32, 20u32, 50u32]
                                        .iter()
                                        .map(|limit| {
                                            let limit_value = *limit;
                                            self.render_filter_button(
                                                &limit_value.to_string(),
                                                filters.limit == limit_value,
                                                false,
                                                cx,
                                                move |this, cx| {
                                                    this.update_prediction_market_limit(
                                                        kind,
                                                        limit_value,
                                                        cx,
                                                    );
                                                },
                                            )
                                            .into_any_element()
                                        })
                                        .collect::<Vec<_>>(),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Page"),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.0))
                                    .child(self.render_filter_button(
                                        "Prev",
                                        false,
                                        !can_prev,
                                        cx,
                                        move |this, cx| {
                                            this.change_prediction_market_page(kind, -1, cx);
                                        },
                                    ))
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(theme.text)
                                            .child(page_label),
                                    )
                                    .child(self.render_filter_button(
                                        "Next",
                                        false,
                                        false,
                                        cx,
                                        move |this, cx| {
                                            this.change_prediction_market_page(kind, 1, cx);
                                        },
                                    )),
                            ),
                    ),
            )
    }

    fn render_filter_button<F>(
        &self,
        label: &str,
        active: bool,
        disabled: bool,
        cx: &mut Context<Self>,
        on_click: F,
    ) -> impl IntoElement
    where
        F: Fn(&mut Self, &mut Context<Self>) + 'static + Send + Sync,
    {
        let theme = &self.theme;
        let bg = if active {
            theme.accent_subtle
        } else {
            theme.card_bg_elevated
        };
        let text_color = if active {
            theme.accent
        } else {
            theme.text_muted
        };
        let border = if active {
            theme.accent_muted
        } else {
            theme.border_subtle
        };
        let disabled_bg = theme.card_bg;

        // Create a unique ID from the label
        let button_id = SharedString::from(format!(
            "filter-btn-{}",
            label.replace(' ', "-").to_lowercase()
        ));

        let base = div()
            .id(button_id)
            .px(px(10.0))
            .py(px(6.0))
            .rounded(px(6.0))
            .bg(if disabled { disabled_bg } else { bg })
            .border_1()
            .border_color(border)
            .text_size(px(11.0))
            .font_weight(FontWeight::MEDIUM)
            .text_color(if disabled {
                theme.text_dimmed
            } else {
                text_color
            })
            .child(label.to_string());

        if disabled {
            base
        } else {
            base.cursor_pointer()
                .hover(|s| s.bg(theme.hover_bg))
                .on_click(cx.listener(move |this, _event, _window, cx| {
                    on_click(this, cx);
                }))
        }
    }

    fn render_polymarket_section(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        let list = match &self.prediction_markets_state.polymarket_markets {
            LoadState::Loading => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Loading Polymarket markets...")
                .into_any_element(),
            LoadState::Error(message) => div()
                .text_size(px(12.0))
                .text_color(theme.negative)
                .child(format!("Failed to load Polymarket: {}", message))
                .into_any_element(),
            LoadState::Loaded(markets) => {
                let mut items: Vec<AnyElement> = Vec::new();
                let list_limit = self
                    .prediction_market_filters(PredictionMarketKind::Polymarket)
                    .limit as usize;
                for market in markets.iter().take(list_limit) {
                    let is_selected = self
                        .prediction_markets_state
                        .polymarket_selected
                        .as_ref()
                        .map(|selected| selected.market_slug == market.market_slug)
                        .unwrap_or(false);
                    let status = market.status.as_deref().unwrap_or("unknown");
                    let status_color = if status.eq_ignore_ascii_case("open") {
                        theme.positive
                    } else {
                        theme.text_muted
                    };
                    let volume = market
                        .volume_total
                        .map(|v| format!("${}", format_number(v)))
                        .unwrap_or_else(|| "N/A".to_string());
                    let market_clone = market.clone();
                    let market_id =
                        SharedString::from(format!("polymarket-{}", &market.market_slug));
                    items.push(
                        div()
                            .id(market_id)
                            .px(px(12.0))
                            .py(px(10.0))
                            .rounded(px(8.0))
                            .bg(if is_selected {
                                theme.accent_subtle
                            } else {
                                theme.card_bg_elevated
                            })
                            .border_1()
                            .border_color(if is_selected {
                                theme.accent_muted
                            } else {
                                theme.border_subtle
                            })
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.hover_bg))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.select_polymarket_market(market_clone.clone(), cx);
                            }))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.0))
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text)
                                            .child(market.title.clone()),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(10.0))
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(status_color)
                                                    .child(status.to_string()),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_muted)
                                                    .child(format!("Vol {}", volume)),
                                            ),
                                    ),
                            )
                            .into_any_element(),
                    );
                }
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .children(items)
                    .into_any_element()
            }
            LoadState::NotLoaded => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Load markets to view Polymarket.")
                .into_any_element(),
        };

        let detail = match (
            &self.prediction_markets_state.polymarket_selected,
            &self.prediction_markets_state.polymarket_prices,
        ) {
            (Some(market), LoadState::Loaded(snapshot)) => {
                let side_a_price = snapshot
                    .side_a
                    .price
                    .as_ref()
                    .map(|p| format_probability(p.price))
                    .unwrap_or_else(|| "N/A".to_string());
                let side_b_price = snapshot
                    .side_b
                    .price
                    .as_ref()
                    .map(|p| format_probability(p.price))
                    .unwrap_or_else(|| "N/A".to_string());

                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.0))
                    .child(
                        div()
                            .text_size(px(16.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child(market.title.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .flex_grow()
                                    .p(px(12.0))
                                    .rounded(px(8.0))
                                    .bg(theme.card_bg_elevated)
                                    .border_1()
                                    .border_color(theme.border_subtle)
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .text_color(theme.text_muted)
                                            .child(snapshot.side_a.label.clone()),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(18.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.text)
                                            .child(side_a_price),
                                    ),
                            )
                            .child(
                                div()
                                    .flex_grow()
                                    .p(px(12.0))
                                    .rounded(px(8.0))
                                    .bg(theme.card_bg_elevated)
                                    .border_1()
                                    .border_color(theme.border_subtle)
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .text_color(theme.text_muted)
                                            .child(snapshot.side_b.label.clone()),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(18.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.text)
                                            .child(side_b_price),
                                    ),
                            ),
                    )
                    .into_any_element()
            }
            (Some(market), LoadState::Loading) => div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Loading price snapshot..."),
                )
                .into_any_element(),
            (Some(market), LoadState::Error(message)) => div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.negative)
                        .child(format!("Price error: {}", message)),
                )
                .into_any_element(),
            (Some(market), LoadState::NotLoaded) => div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Select a market to load prices."),
                )
                .into_any_element(),
            (None, _) => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Select a Polymarket market to see details.")
                .into_any_element(),
        };

        div()
            .p(px(18.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border_subtle)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(16.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child("Polymarket"),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_muted)
                            .child(format!(
                                "Top {} markets",
                                self.prediction_market_filters(PredictionMarketKind::Polymarket)
                                    .limit
                            )),
                    ),
            )
            .child(self.render_prediction_market_filters(PredictionMarketKind::Polymarket, cx))
            .child(
                div()
                    .mt(px(16.0))
                    .flex()
                    .gap(px(16.0))
                    .child(
                        div()
                            .flex_grow()
                            .min_w(px(320.0))
                            .flex()
                            .flex_col()
                            .gap(px(8.0))
                            .child(list),
                    )
                    .child(
                        div()
                            .flex_grow()
                            .min_w(px(240.0))
                            .p(px(12.0))
                            .rounded(px(10.0))
                            .bg(theme.card_bg_elevated)
                            .border_1()
                            .border_color(theme.border_subtle)
                            .child(detail),
                    ),
            )
    }

    fn render_kalshi_section(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        let list = match &self.prediction_markets_state.kalshi_markets {
            LoadState::Loading => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Loading Kalshi markets...")
                .into_any_element(),
            LoadState::Error(message) => div()
                .text_size(px(12.0))
                .text_color(theme.negative)
                .child(format!("Failed to load Kalshi: {}", message))
                .into_any_element(),
            LoadState::Loaded(markets) => {
                let mut items: Vec<AnyElement> = Vec::new();
                let list_limit = self
                    .prediction_market_filters(PredictionMarketKind::Kalshi)
                    .limit as usize;
                for market in markets.iter().take(list_limit) {
                    let is_selected = self
                        .prediction_markets_state
                        .kalshi_selected
                        .as_ref()
                        .map(|selected| selected.market_ticker == market.market_ticker)
                        .unwrap_or(false);
                    let status = market.status.as_deref().unwrap_or("unknown");
                    let status_color = if status.eq_ignore_ascii_case("open") {
                        theme.positive
                    } else {
                        theme.text_muted
                    };
                    let volume = market
                        .volume
                        .map(|v| format!("${}", format_number(v)))
                        .unwrap_or_else(|| "N/A".to_string());
                    let last_price = market
                        .last_price
                        .map(|v| format!("{:.0}c", v))
                        .unwrap_or_else(|| "N/A".to_string());
                    let market_clone = market.clone();
                    let market_id = SharedString::from(format!("kalshi-{}", &market.market_ticker));
                    items.push(
                        div()
                            .id(market_id)
                            .px(px(12.0))
                            .py(px(10.0))
                            .rounded(px(8.0))
                            .bg(if is_selected {
                                theme.accent_subtle
                            } else {
                                theme.card_bg_elevated
                            })
                            .border_1()
                            .border_color(if is_selected {
                                theme.accent_muted
                            } else {
                                theme.border_subtle
                            })
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.hover_bg))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.select_kalshi_market(market_clone.clone(), cx);
                            }))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.0))
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text)
                                            .child(market.title.clone()),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(10.0))
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(status_color)
                                                    .child(status.to_string()),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_muted)
                                                    .child(format!("Last {}", last_price)),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_muted)
                                                    .child(format!("Vol {}", volume)),
                                            ),
                                    ),
                            )
                            .into_any_element(),
                    );
                }
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .children(items)
                    .into_any_element()
            }
            LoadState::NotLoaded => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Load markets to view Kalshi.")
                .into_any_element(),
        };

        let detail = match (
            &self.prediction_markets_state.kalshi_selected,
            &self.prediction_markets_state.kalshi_prices,
        ) {
            (Some(market), LoadState::Loaded(price)) => div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .flex()
                        .gap(px(12.0))
                        .child(
                            div()
                                .flex_grow()
                                .p(px(12.0))
                                .rounded(px(8.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border_subtle)
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(theme.text_muted)
                                        .child("Yes"),
                                )
                                .child(
                                    div()
                                        .text_size(px(18.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.text)
                                        .child(format_probability(price.yes.price)),
                                ),
                        )
                        .child(
                            div()
                                .flex_grow()
                                .p(px(12.0))
                                .rounded(px(8.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border_subtle)
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(theme.text_muted)
                                        .child("No"),
                                )
                                .child(
                                    div()
                                        .text_size(px(18.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.text)
                                        .child(format_probability(price.no.price)),
                                ),
                        ),
                )
                .into_any_element(),
            (Some(market), LoadState::Loading) => div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Loading price snapshot..."),
                )
                .into_any_element(),
            (Some(market), LoadState::Error(message)) => div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.negative)
                        .child(format!("Price error: {}", message)),
                )
                .into_any_element(),
            (Some(market), LoadState::NotLoaded) => div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(market.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("Select a market to load prices."),
                )
                .into_any_element(),
            (None, _) => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Select a Kalshi market to see details.")
                .into_any_element(),
        };

        div()
            .p(px(18.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border_subtle)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(16.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child("Kalshi"),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_muted)
                            .child(format!(
                                "Top {} markets",
                                self.prediction_market_filters(PredictionMarketKind::Kalshi)
                                    .limit
                            )),
                    ),
            )
            .child(self.render_prediction_market_filters(PredictionMarketKind::Kalshi, cx))
            .child(
                div()
                    .mt(px(16.0))
                    .flex()
                    .gap(px(16.0))
                    .child(
                        div()
                            .flex_grow()
                            .min_w(px(320.0))
                            .flex()
                            .flex_col()
                            .gap(px(8.0))
                            .child(list),
                    )
                    .child(
                        div()
                            .flex_grow()
                            .min_w(px(240.0))
                            .p(px(12.0))
                            .rounded(px(10.0))
                            .bg(theme.card_bg_elevated)
                            .border_1()
                            .border_color(theme.border_subtle)
                            .child(detail),
                    ),
            )
    }

    fn render_market_header(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = &self.theme;
        let symbol = self.selected_symbol.as_deref().unwrap_or("Select Symbol");

        div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .child(
                        div()
                            .text_size(px(24.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child("Market Data"),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(theme.text_muted)
                            .child(format!("Symbol: {}", symbol)),
                    ),
            )
            .child(
                div()
                    .id("market-change-symbol")
                    .px(px(14.0))
                    .py(px(8.0))
                    .rounded(px(8.0))
                    .bg(theme.accent)
                    .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .cursor_pointer()
                    .hover(|s| s.bg(theme.accent_hover))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.open_symbol_search(cx);
                    }))
                    .child("Change Symbol"),
            )
            .into_any_element()
    }

    fn render_market_content(&self) -> AnyElement {
        let theme = &self.theme;

        match &self.market_data {
            LoadingState::Loaded(data) => self.render_market_card(data),
            LoadingState::Loading => div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Loading market data..."),
                )
                .into_any_element(),
            LoadingState::Error(message) => div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.negative)
                        .child(format!("Failed to load market data: {}", message)),
                )
                .into_any_element(),
            LoadingState::NotStarted => div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Select a symbol to see market data."),
                )
                .into_any_element(),
        }
    }

    fn render_market_card(&self, data: &MarketData) -> AnyElement {
        let theme = &self.theme;
        let change_positive = data.change >= 0.0;
        let change_color = if change_positive {
            theme.positive
        } else {
            theme.negative
        };
        let change_text = format!("{:+.2} ({:+.2}%)", data.change, data.change_percent);

        let mut metric_tiles: Vec<AnyElement> = Vec::new();
        metric_tiles.push(self.market_metric_tile("Volume", format_number(data.volume as f64)));
        metric_tiles.push(
            self.market_metric_tile(
                "Avg Volume",
                data.avg_volume
                    .map(|v| format_number(v as f64))
                    .unwrap_or("N/A".to_string()),
            ),
        );
        metric_tiles.push(
            self.market_metric_tile(
                "Market Cap",
                data.market_cap
                    .map(|v| format!("${}", format_number(v)))
                    .unwrap_or("N/A".to_string()),
            ),
        );
        metric_tiles.push(
            self.market_metric_tile(
                "52W High",
                data.high_52w
                    .map(|v| format!("${:.2}", v))
                    .unwrap_or("N/A".to_string()),
            ),
        );
        metric_tiles.push(
            self.market_metric_tile(
                "52W Low",
                data.low_52w
                    .map(|v| format!("${:.2}", v))
                    .unwrap_or("N/A".to_string()),
            ),
        );

        let mut ratio_tiles: Vec<AnyElement> = Vec::new();
        ratio_tiles.push(
            self.market_metric_tile(
                "P/E Ratio",
                data.pe_ratio
                    .map(|v| format!("{:.2}", v))
                    .unwrap_or("N/A".to_string()),
            ),
        );
        ratio_tiles.push(
            self.market_metric_tile(
                "Dividend Yield",
                data.dividend_yield
                    .map(|v| format!("{:.2}%", v * 100.0))
                    .unwrap_or("N/A".to_string()),
            ),
        );

        div()
            .p(px(24.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .flex()
            .flex_col()
            .gap(px(20.0))
            .child(
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
                                    .text_size(px(26.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .child(format!("${:.2}", data.price)),
                            )
                            .child(
                                div()
                                    .px(px(10.0))
                                    .py(px(4.0))
                                    .rounded(px(6.0))
                                    .bg(if change_positive {
                                        theme.positive_subtle
                                    } else {
                                        theme.negative_subtle
                                    })
                                    .border_1()
                                    .border_color(if change_positive {
                                        theme.positive_muted
                                    } else {
                                        theme.negative_muted
                                    })
                                    .text_color(change_color)
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(change_text),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.text_dimmed)
                            .child(data.symbol.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(16.0))
                    .children(metric_tiles),
            )
            .child(div().flex().gap(px(16.0)).children(ratio_tiles))
            .into_any_element()
    }

    fn market_metric_tile(&self, label: &str, value: String) -> AnyElement {
        let theme = &self.theme;

        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .px(px(16.0))
            .py(px(12.0))
            .rounded(px(8.0))
            .bg(theme.card_bg_elevated)
            .border_1()
            .border_color(theme.border_subtle)
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.text_muted)
                    .child(label.to_string()),
            )
            .child(
                div()
                    .text_size(px(14.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text)
                    .child(value),
            )
            .into_any_element()
    }

    fn render_money_flow_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = &self.theme;

        div()
            .id("money-flow-view-scroll")
            .flex_grow()
            .h_full()
            .overflow_y_scroll()
            .bg(theme.background)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.0))
                    .p(px(28.0))
                    .child(self.render_money_flow_header())
                    .child(self.render_money_flow_sector_picker(cx))
                    .child(self.render_money_flow_results()),
            )
            .into_any_element()
    }

    fn render_money_flow_header(&self) -> AnyElement {
        let theme = &self.theme;

        div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .child(
                div()
                    .text_size(px(24.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.text)
                    .child("Money Flow Analysis"),
            )
            .child(
                div()
                    .text_size(px(13.0))
                    .text_color(theme.text_muted)
                    .child("Track institutional capital movement across sectors"),
            )
            .into_any_element()
    }

    fn render_money_flow_sector_picker(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = &self.theme;

        let mut sector_buttons: Vec<AnyElement> = Vec::new();
        for sector in MONEY_FLOW_SECTORS {
            let is_selected = self.money_flow_sectors.iter().any(|s| s == sector);
            let sector_owned = sector.to_string();
            sector_buttons.push(
                div()
                    .id(SharedString::from(format!("money-flow-sector-{sector}")))
                    .px(px(12.0))
                    .py(px(6.0))
                    .rounded(px(6.0))
                    .bg(if is_selected {
                        theme.accent
                    } else {
                        theme.card_bg_elevated
                    })
                    .text_color(if is_selected {
                        hsla(0.0, 0.0, 1.0, 1.0)
                    } else {
                        theme.text_secondary
                    })
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .cursor_pointer()
                    .border_1()
                    .border_color(if is_selected {
                        theme.accent
                    } else {
                        theme.border_subtle
                    })
                    .hover(|s| s.bg(theme.hover_bg))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.toggle_money_flow_sector(sector_owned.clone(), cx);
                    }))
                    .child(sector.to_string())
                    .into_any_element(),
            );
        }

        div()
            .p(px(20.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .child(
                div()
                    .text_size(px(14.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text)
                    .child("Select Sectors"),
            )
            .child(
                div()
                    .mt(px(12.0))
                    .flex()
                    .flex_wrap()
                    .gap(px(8.0))
                    .children(sector_buttons),
            )
            .into_any_element()
    }

    fn render_money_flow_results(&self) -> AnyElement {
        let theme = &self.theme;

        let content = match &self.sector_flow {
            LoadingState::Loaded(flows) => {
                if flows.is_empty() {
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("No money flow data for the selected sectors.")
                        .into_any_element()
                } else {
                    let mut rows: Vec<AnyElement> = Vec::new();
                    for flow in flows {
                        let confidence = (flow.confidence_score * 100.0).abs();
                        let flow_positive = flow.net_flow_3m >= 0.0;
                        let flow_color = if flow_positive {
                            theme.positive
                        } else {
                            theme.negative
                        };

                        rows.push(
                            div()
                                .p(px(16.0))
                                .rounded(px(10.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border_subtle)
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
                                                .flex()
                                                .items_center()
                                                .gap(px(10.0))
                                                .child(
                                                    div()
                                                        .text_size(px(14.0))
                                                        .font_weight(FontWeight::SEMIBOLD)
                                                        .text_color(theme.text)
                                                        .child(flow.symbol.clone()),
                                                )
                                                .child(
                                                    div()
                                                        .px(px(8.0))
                                                        .py(px(4.0))
                                                        .rounded(px(6.0))
                                                        .bg(if flow_positive {
                                                            theme.positive_subtle
                                                        } else {
                                                            theme.negative_subtle
                                                        })
                                                        .text_color(flow_color)
                                                        .text_size(px(11.0))
                                                        .font_weight(FontWeight::SEMIBOLD)
                                                        .child(format!(
                                                            "{:.0}% confidence",
                                                            confidence
                                                        )),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child(format!(
                                                    "Smart Money: {:+.2}",
                                                    flow.smart_money_sentiment
                                                )),
                                        ),
                                )
                                .child(self.render_money_flow_row_metrics(flow))
                                .into_any_element(),
                        );
                    }
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.0))
                        .children(rows)
                        .into_any_element()
                }
            }
            LoadingState::Loading => div()
                .text_size(px(13.0))
                .text_color(theme.text_muted)
                .child("Loading money flow data...")
                .into_any_element(),
            LoadingState::Error(message) => div()
                .text_size(px(13.0))
                .text_color(theme.negative)
                .child(format!("Failed to load money flow data: {}", message))
                .into_any_element(),
            LoadingState::NotStarted => div()
                .text_size(px(13.0))
                .text_color(theme.text_muted)
                .child("Select sectors to begin money flow analysis.")
                .into_any_element(),
        };

        div()
            .p(px(20.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .child(
                div()
                    .text_size(px(14.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text)
                    .child("Sector Money Flow"),
            )
            .child(div().mt(px(12.0)).child(content))
            .into_any_element()
    }

    fn render_money_flow_row_metrics(&self, flow: &SectorFlow) -> AnyElement {
        let theme = &self.theme;
        let metrics = [
            (
                "1M Net Flow",
                format!("${:.1}M", flow.net_flow_1m / 1_000_000.0),
                flow.net_flow_1m >= 0.0,
            ),
            (
                "3M Net Flow",
                format!("${:.1}M", flow.net_flow_3m / 1_000_000.0),
                flow.net_flow_3m >= 0.0,
            ),
            (
                "Institutional Change",
                format!("{:+.2}%", flow.institutional_change * 100.0),
                flow.institutional_change >= 0.0,
            ),
            (
                "Flow Acceleration",
                format!("{:+.3}", flow.flow_acceleration),
                flow.flow_acceleration >= 0.0,
            ),
        ];

        let mut tiles: Vec<AnyElement> = Vec::new();
        for (label, value, positive) in metrics {
            let value_color = if positive {
                theme.positive
            } else {
                theme.negative
            };
            tiles.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_muted)
                            .child(label),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(value_color)
                            .child(value),
                    )
                    .into_any_element(),
            );
        }

        div()
            .flex()
            .flex_wrap()
            .gap(px(16.0))
            .children(tiles)
            .into_any_element()
    }

    fn render_institutional_view(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = &self.theme;

        div()
            .id("institutional-view-scroll")
            .flex_grow()
            .h_full()
            .overflow_y_scroll()
            .bg(theme.background)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.0))
                    .p(px(28.0))
                    .child(self.render_institutional_header(cx))
                    .child(self.render_institutional_content()),
            )
            .into_any_element()
    }

    fn render_institutional_header(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = &self.theme;
        let symbol = self.selected_symbol.as_deref().unwrap_or("Select Symbol");

        div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .child(
                        div()
                            .text_size(px(24.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child("Institutional Holdings"),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(theme.text_muted)
                            .child(format!("Symbol: {}", symbol)),
                    ),
            )
            .child(
                div()
                    .id("institutional-change-symbol")
                    .px(px(14.0))
                    .py(px(8.0))
                    .rounded(px(8.0))
                    .bg(theme.accent)
                    .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .cursor_pointer()
                    .hover(|s| s.bg(theme.accent_hover))
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.open_symbol_search(cx);
                    }))
                    .child("Change Symbol"),
            )
            .into_any_element()
    }

    fn render_institutional_content(&self) -> AnyElement {
        let theme = &self.theme;

        match &self.institutional_summary {
            LoadingState::Loaded(summary) => {
                let ownership_pct = summary.institutional_ownership;
                let holders_total = summary.total_holders;
                let top10_concentration = summary.top10_concentration;
                let insider_ownership = summary.insider_ownership;

                let metrics = [
                    (
                        "Institutional Ownership",
                        format!("{:.1}%", ownership_pct),
                        theme.text,
                    ),
                    (
                        "Active Institutions",
                        format!("{}", holders_total),
                        theme.text,
                    ),
                    (
                        "Top 10 Concentration",
                        format!("{:.2}%", top10_concentration),
                        theme.warning,
                    ),
                    (
                        "Insider Ownership",
                        format!("{:.2}%", insider_ownership),
                        theme.text_secondary,
                    ),
                ];

                let mut metric_cards: Vec<AnyElement> = Vec::new();
                for (label, value, color) in metrics {
                    metric_cards.push(
                        div()
                            .flex_1()
                            .p(px(16.0))
                            .rounded(px(10.0))
                            .bg(theme.card_bg)
                            .border_1()
                            .border_color(theme.border)
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_muted)
                                    .child(label),
                            )
                            .child(
                                div()
                                    .mt(px(6.0))
                                    .text_size(px(18.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(color)
                                    .child(value),
                            )
                            .into_any_element(),
                    );
                }

                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.0))
                    .child(div().flex().gap(px(16.0)).children(metric_cards))
                    .child(self.render_institutional_holders_card())
                    .into_any_element()
            }
            LoadingState::Loading => div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Loading institutional data..."),
                )
                .into_any_element(),
            LoadingState::Error(message) => div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.negative)
                        .child(format!("Failed to load institutional data: {}", message)),
                )
                .into_any_element(),
            LoadingState::NotStarted => div()
                .p(px(24.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Select a symbol to view institutional holdings."),
                )
                .into_any_element(),
        }
    }

    fn render_institutional_holders_card(&self) -> AnyElement {
        let theme = &self.theme;

        div()
            .p(px(20.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .child(
                div()
                    .text_size(px(14.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text)
                    .child("Top Institutional Holders"),
            )
            .child(
                div()
                    .mt(px(12.0))
                    .child(self.render_institutional_holders()),
            )
            .into_any_element()
    }

    fn render_institutional_holders(&self) -> AnyElement {
        let theme = &self.theme;

        match &self.institutional {
            LoadingState::Loaded(holders) => {
                if holders.is_empty() {
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_muted)
                        .child("No institutional holders found.")
                        .into_any_element()
                } else {
                    let mut rows: Vec<AnyElement> = Vec::new();
                    for holder in holders.iter().take(12) {
                        rows.push(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .p(px(12.0))
                                .rounded(px(8.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border_subtle)
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.0))
                                        .child(
                                            div()
                                                .text_size(px(13.0))
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .text_color(theme.text)
                                                .child(holder.manager_name.clone()),
                                        )
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child(format!(
                                                    "${} held",
                                                    format_number(holder.value_held)
                                                )),
                                        ),
                                )
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text_secondary)
                                        .child(format!("{:.2}%", holder.ownership_percentage)),
                                )
                                .into_any_element(),
                        );
                    }
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.0))
                        .children(rows)
                        .into_any_element()
                }
            }
            LoadingState::Loading => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Loading holders...")
                .into_any_element(),
            LoadingState::Error(message) => div()
                .text_size(px(12.0))
                .text_color(theme.negative)
                .child(format!("Failed to load holders: {}", message))
                .into_any_element(),
            LoadingState::NotStarted => div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("No holders loaded yet.")
                .into_any_element(),
        }
    }

    fn render_comparison_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let state = &self.comparison_state;

        // Mode tab definitions
        let modes = [
            (ComparisonMode::SideBySide, "Side by Side"),
            (ComparisonMode::Overlay, "Overlay"),
            (ComparisonMode::RelativePerformance, "Relative"),
            (ComparisonMode::Correlation, "Correlation"),
            (ComparisonMode::PeerGroup, "Peer Group"),
            (ComparisonMode::SectorStrength, "Sector"),
        ];

        // Time period definitions
        let periods = [
            ComparisonTimePeriod::OneDay,
            ComparisonTimePeriod::OneWeek,
            ComparisonTimePeriod::OneMonth,
            ComparisonTimePeriod::ThreeMonths,
            ComparisonTimePeriod::SixMonths,
            ComparisonTimePeriod::OneYear,
            ComparisonTimePeriod::YearToDate,
        ];

        div()
            .id("comparison-view-scroll")
            .flex_grow()
            .h_full()
            .overflow_y_scroll()
            .bg(theme.background)
            .child(
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
                            // Mode tabs
                            .child(
                                div()
                                    .flex()
                                    .gap(px(4.0))
                                    .px(px(8.0))
                                    .py(px(8.0))
                                    .bg(theme.card_bg)
                                    .rounded(px(8.0))
                                    .children(modes.iter().map(|(mode, label)| {
                                        let is_active = state.mode == *mode;
                                        let mode_clone = *mode;

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
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.comparison_state.mode = mode_clone;
                                                    cx.notify();
                                                },
                                            ))
                                            .child(label.to_string())
                                    })),
                            )
                            // Time period selector
                            .child(div().flex().gap(px(2.0)).children(periods.iter().map(
                                |period| {
                                    let is_active = state.time_period == *period;
                                    let period_clone = *period;

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
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.comparison_state.time_period = period_clone;
                                            this.load_comparison_data(cx);
                                            cx.notify();
                                        }))
                                        .child(period.label().to_string())
                                },
                            ))),
                    )
                    // Symbol legend (inline implementation with proper GPUI callbacks)
                    .child(div().flex().flex_wrap().gap(px(8.0)).children(
                        state.symbols.iter().map(|sym| {
                            let symbol = sym.symbol.clone();
                            let symbol_for_toggle = symbol.clone();
                            let symbol_for_remove = symbol.clone();

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
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.comparison_state.toggle_symbol(&symbol_for_toggle);
                                    this.load_comparison_data(cx);
                                    cx.notify();
                                }))
                                // Color indicator
                                .child(div().size(px(10.0)).rounded_full().bg(if sym.enabled {
                                    sym.color
                                } else {
                                    theme.text_dimmed
                                }))
                                // Symbol name
                                .child(
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
                                // Remove button
                                .child(
                                    div()
                                        .id(SharedString::from(format!("remove-{}", &symbol)))
                                        .size(px(16.0))
                                        .rounded(px(4.0))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .text_size(px(12.0))
                                        .text_color(theme.text_dimmed)
                                        .hover(|s| {
                                            s.bg(theme.negative_subtle).text_color(theme.negative)
                                        })
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.comparison_state.remove_symbol(&symbol_for_remove);
                                            this.load_comparison_data(cx);
                                            cx.notify();
                                        }))
                                        .child("x"),
                                )
                        }),
                    ))
                    // Add symbol button
                    .child(
                        div()
                            .id("add-symbol-btn")
                            .px(px(16.0))
                            .py(px(8.0))
                            .rounded(px(6.0))
                            .bg(theme.accent)
                            .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.accent_hover))
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                // Add selected symbol from watchlist to comparison
                                if let Some(symbol) = this.selected_symbol.clone() {
                                    this.comparison_state.add_symbol(symbol);
                                    this.load_comparison_data(cx);
                                    cx.notify();
                                }
                            }))
                            .child("+ Add Current Symbol"),
                    )
                    // Content based on mode
                    .child(if state.loading {
                        div()
                            .py(px(56.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .text_color(theme.text_muted)
                                    .child("Loading comparison data..."),
                            )
                            .into_any_element()
                    } else {
                        match state.mode {
                            ComparisonMode::SideBySide => {
                                render_side_by_side_comparison(theme, &state.symbols).into_any_element()
                            }
                            ComparisonMode::Overlay => {
                                render_overlay_chart(theme, &state.symbols, false).into_any_element()
                            }
                            ComparisonMode::RelativePerformance => render_relative_performance(
                                theme,
                                &state.symbols,
                                state.base_symbol.as_deref(),
                            )
                            .into_any_element(),
                            ComparisonMode::Correlation => render_correlation_matrix(
                                theme,
                                &state.symbols,
                                &state.correlation_matrix,
                            )
                            .into_any_element(),
                            ComparisonMode::PeerGroup => render_peer_group_comparison(
                                theme,
                                &state.peer_metrics,
                                state.base_symbol.as_deref(),
                            )
                            .into_any_element(),
                            ComparisonMode::SectorStrength => {
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
                        }
                    }),
            )
    }

    fn render_agent_view(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;
        let current_symbol = self.selected_symbol.clone();
        let popular_actions = self.quick_actions_state.get_popular_actions(6);

        div()
            .flex_grow()
            .h_full()
            .flex()
            .flex_col()
            .bg(theme.background)
            // Quick actions panel at top of agent view
            .child(
                div()
                    .w_full()
                    .px(px(24.0))
                    .py(px(12.0))
                    .bg(theme.card_bg)
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    // Header row
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text_secondary)
                                    .child("Quick Actions"),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_muted)
                                    .child("Click to execute"),
                            ),
                    )
                    // Action buttons grid
                    .child(div().flex().flex_wrap().gap(px(6.0)).children(
                        popular_actions.into_iter().map(|action| {
                            let prompt = action.build_prompt(current_symbol.as_deref());
                            let category_color = action.category.color();
                            let action_name = action.name.clone();
                            let description = action.description.clone();

                            div()
                                .id(SharedString::from(format!("qa-agent-{}", action.id)))
                                .px(px(12.0))
                                .py(px(8.0))
                                .rounded(px(8.0))
                                .bg(theme.background)
                                .border_1()
                                .border_color(theme.border_subtle)
                                .hover(|s| s.bg(theme.hover_bg).border_color(category_color))
                                .cursor_pointer()
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.handle_quick_action(prompt.clone(), cx);
                                }))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(6.0))
                                        .child(
                                            div().size(px(6.0)).rounded_full().bg(category_color),
                                        )
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text)
                                                .font_weight(FontWeight::MEDIUM)
                                                .child(action_name),
                                        ),
                                )
                                .child(
                                    div()
                                        .text_size(px(9.0))
                                        .text_color(theme.text_muted)
                                        .child(description),
                                )
                        }),
                    ))
                    // Contextual suggestions row
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .pt(px(6.0))
                            .border_t_1()
                            .border_color(theme.border_subtle)
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_muted)
                                    .child("Suggestions:"),
                            )
                            .child(self.render_contextual_suggestions(cx)),
                    ),
            )
            // Main agent panel (uses agent_core daemon for chat)
            .child(render_agent_panel(
                &self.theme,
                &self.agent_state,
                &self.agent_input,
                cx.listener(|this, _event, _window, cx| {
                    this.agent_input.clear();
                    cx.notify();
                }),
                cx,
            ))
    }

    fn render_commodities_view(&self, cx: &mut Context<Self>) -> Div {
        render_commodities(&self.theme, &self.commodities_state, cx)
    }

    fn render_etf_view(&self, cx: &mut Context<Self>) -> Div {
        render_etf(&self.theme, &self.etf_state, cx)
    }

    fn render_signals_view(&self, cx: &mut Context<Self>) -> Div {
        render_signals(&self.theme, &self.signals_state, cx)
    }

    fn render_accounting_view(&self, cx: &mut Context<Self>) -> Div {
        render_accounting(&self.theme, &self.accounting_state, cx)
    }

    /// Render the portfolio view using data from portfolio state
    fn render_portfolio_view(&self) -> Div {
        render_portfolio_content(
            &self.portfolio_holdings,
            &self.portfolio_risk,
            &self.portfolio_sectors,
            self.portfolio_total_value,
            &self.theme,
        )
    }

    fn render_dashboard_content(&self, cx: &mut Context<Self>) -> Div {
        div()
            .flex_grow()
            .p(px(28.0))
            .flex()
            .flex_col()
            .gap(px(24.0))
            .overflow_hidden()
            .child(self.render_metrics_row())
            .child(self.render_analysis_cards(cx))
    }

    fn render_metrics_row(&self) -> impl IntoElement {
        // Use equity_flow data if available, otherwise show loading/placeholder
        let (
            flow_score,
            flow_label,
            inst_sent,
            inst_label,
            smart_money,
            sm_label,
            short_pressure,
            sp_label,
        ) = match &self.equity_flow {
            LoadingState::Loaded(data) => {
                let flow_score = format!("{:.2}", data.money_flow_score);
                let flow_label = if data.money_flow_score > 0.5 {
                    "Bullish"
                } else {
                    "Bearish"
                };
                let inst_sent = format!("{:.1}%", data.institutional_sentiment * 100.0);
                let inst_label = if data.institutional_sentiment > 0.0 {
                    "+QoQ"
                } else {
                    "-QoQ"
                };
                let smart_money = format!("{:.1}%", data.smart_money_activity * 100.0);
                let sm_label = if data.smart_money_activity > 0.3 {
                    "Active"
                } else {
                    "Quiet"
                };
                let short_pressure = format!("{:.1}%", data.short_pressure * 100.0);
                let sp_label = if data.short_pressure < 0.05 {
                    "Low"
                } else {
                    "Elevated"
                };
                (
                    flow_score,
                    flow_label,
                    inst_sent,
                    inst_label,
                    smart_money,
                    sm_label,
                    short_pressure,
                    sp_label,
                )
            }
            LoadingState::Loading => (
                "...".to_string(),
                "Loading",
                "...".to_string(),
                "",
                "...".to_string(),
                "",
                "...".to_string(),
                "",
            ),
            LoadingState::Error(_) | LoadingState::NotStarted => (
                "N/A".to_string(),
                "Unavailable",
                "N/A".to_string(),
                "Unavailable",
                "N/A".to_string(),
                "Unavailable",
                "N/A".to_string(),
                "Unavailable",
            ),
        };

        div()
            .flex()
            .gap(px(20.0))
            .child(self.metric_card("Money Flow Score", &flow_score, flow_label, true))
            .child(self.metric_card("Institutional %", &inst_sent, inst_label, true))
            .child(self.metric_card("Smart Money", &smart_money, sm_label, false))
            .child(self.metric_card("Short Pressure", &short_pressure, sp_label, false))
    }

    fn metric_card(
        &self,
        title: &str,
        value: &str,
        subtitle: &str,
        positive: bool,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let accent = if positive {
            theme.positive
        } else {
            theme.negative
        };
        let accent_subtle = if positive {
            theme.positive_subtle
        } else {
            theme.negative_subtle
        };
        let accent_muted = if positive {
            theme.positive_muted
        } else {
            theme.negative_muted
        };

        div()
            .flex_1()
            .p(px(20.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            // Hover effect for cards
            .cursor_pointer()
            .hover(|s| {
                s.bg(theme.card_bg_elevated)
                    .border_color(theme.border_strong)
            })
            .flex()
            .flex_col()
            .gap(px(12.0))
            // Top section with title and indicator
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.text_muted)
                            .child(title.to_string()),
                    )
                    // Colored indicator dot
                    .child(div().size(px(8.0)).rounded_full().bg(accent)),
            )
            // Value with improved typography
            .child(
                div()
                    .text_size(px(32.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.text)
                    .child(value.to_string()),
            )
            // Subtitle badge
            .child(
                div().flex().child(
                    div()
                        .px(px(10.0))
                        .py(px(4.0))
                        .rounded(px(6.0))
                        .bg(accent_subtle)
                        .border_1()
                        .border_color(accent_muted)
                        .text_color(accent)
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .child(subtitle.to_string()),
                ),
            )
    }

    fn render_analysis_cards(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .gap(px(20.0))
            .child(
                div()
                    .flex_1()
                    .child(self.analysis_card(
                        "Sector Money Flow",
                        self.render_sector_flow(),
                        Some(ActiveView::MoneyFlow),
                        cx,
                    )),
            )
            .child(
                div()
                    .flex_1()
                    .child(self.analysis_card(
                        "Top Institutional Holders",
                        self.render_holders(),
                        Some(ActiveView::Institutional),
                        cx,
                    )),
            )
    }

    fn analysis_card(
        &self,
        title: &str,
        content: impl IntoElement,
        target_view: Option<ActiveView>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .p(px(24.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .flex()
            .flex_col()
            .gap(px(20.0))
            // Card header
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .text_size(px(15.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child(title.to_string()),
                    )
                    // View all link
                    .when_some(target_view, |el, view| {
                        let id = format!("view-all-{}", title.to_lowercase().replace(' ', "-"));
                        el.child(
                            div()
                                .id(SharedString::from(id))
                                .text_size(px(12.0))
                                .text_color(theme.accent)
                                .cursor_pointer()
                                .hover(|s| s.text_color(theme.accent_hover))
                                .on_click(cx.listener(move |this: &mut Self, _: &ClickEvent, _, cx| {
                                    this.set_active_view(view, cx);
                                }))
                                .child("View All"),
                        )
                    }),
            )
            .child(content)
    }

    fn render_sector_flow(&self) -> impl IntoElement {
        let theme = &self.theme;

        match &self.sector_flow {
            LoadingState::Loaded(sectors) => {
                let mut container = div().flex().flex_col().gap(px(14.0));
                for sector in sectors.iter().take(5) {
                    let score = sector.smart_money_sentiment as f32;
                    let positive = score >= 0.0;
                    let name = format!(
                        "{} (Flow: {:.0}M)",
                        sector.symbol,
                        sector.net_flow_1m / 1_000_000.0
                    );
                    container = container.child(self.sector_row(&name, score, positive));
                }
                container
            }
            LoadingState::Loading => div()
                .flex()
                .items_center()
                .justify_center()
                .h(px(100.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Loading sector data..."),
                ),
            LoadingState::Error(msg) => div()
                .flex()
                .items_center()
                .justify_center()
                .h(px(100.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.negative)
                        .child(format!("Error: {}", msg)),
                ),
            LoadingState::NotStarted => div()
                .flex()
                .items_center()
                .justify_center()
                .h(px(100.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Sector flow not loaded yet"),
                ),
        }
    }

    fn sector_row(&self, name: &str, score: f32, positive: bool) -> impl IntoElement {
        let theme = &self.theme;
        let bar_color = if positive {
            theme.positive
        } else {
            theme.negative
        };
        let bar_bg = if positive {
            theme.positive_subtle
        } else {
            theme.negative_subtle
        };
        // Calculate bar width as percentage (max 100%)
        let bar_width_percent = (score.abs() * 100.0).min(100.0);
        let bar_width_px = bar_width_percent * 1.8; // Approximate conversion for visual width

        div()
            .flex()
            .items_center()
            .gap(px(16.0))
            .py(px(4.0))
            .px(px(8.0))
            .cursor_pointer()
            .rounded(px(6.0))
            .hover(|s| s.bg(theme.hover_bg))
            .child(
                div()
                    .w(px(130.0))
                    .text_size(px(13.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme.text_secondary)
                    .child(name.to_string()),
            )
            .child(
                // Progress bar container with improved styling
                div()
                    .flex_grow()
                    .h(px(10.0))
                    .rounded(px(5.0))
                    .bg(bar_bg)
                    .overflow_hidden()
                    .child(
                        // Progress bar fill
                        div()
                            .h_full()
                            .w(px(bar_width_px))
                            .rounded(px(5.0))
                            .bg(bar_color),
                    ),
            )
            .child(
                // Score display with improved styling
                div()
                    .w(px(60.0))
                    .text_size(px(13.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(bar_color)
                    .child(format!("{:+.2}", score)),
            )
    }

    fn render_holders(&self) -> impl IntoElement {
        let theme = &self.theme;

        match &self.institutional {
            LoadingState::Loaded(holders) => {
                let mut container = div().flex().flex_col().gap(px(0.0));

                // Show top 5 holders (or fewer if not available)
                for holder in holders.iter().take(5) {
                    let ownership_str = format!("{:.1}%", holder.ownership_percentage);
                    let value_str = format_number(holder.value_held);
                    container = container.child(self.holder_row_with_value(
                        &holder.manager_name,
                        &ownership_str,
                        &value_str,
                    ));
                }

                // If no holders, show placeholder
                if holders.is_empty() {
                    container = container.child(
                        div()
                            .py(px(16.0))
                            .text_size(px(13.0))
                            .text_color(theme.text_muted)
                            .child("No institutional holders found"),
                    );
                }

                container
            }
            LoadingState::Loading => div()
                .flex()
                .items_center()
                .justify_center()
                .py(px(32.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Loading holders..."),
                ),
            LoadingState::Error(msg) => div()
                .flex()
                .items_center()
                .justify_center()
                .py(px(32.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.negative)
                        .child(format!("Error: {}", msg)),
                ),
            LoadingState::NotStarted => div()
                .flex()
                .items_center()
                .justify_center()
                .py(px(32.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_muted)
                        .child("Institutional holders not loaded yet"),
                ),
        }
    }

    fn holder_row_with_value(&self, name: &str, ownership: &str, value: &str) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex()
            .items_center()
            .justify_between()
            .py(px(12.0))
            .px(px(8.0))
            .border_b_1()
            .border_color(theme.border_subtle)
            .cursor_pointer()
            .rounded(px(4.0))
            .hover(|s| s.bg(theme.hover_bg).border_color(transparent_black()))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    // Holder avatar/icon
                    .child(
                        div()
                            .size(px(32.0))
                            .rounded(px(6.0))
                            .bg(theme.accent_subtle)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.accent)
                            .child(name.chars().next().unwrap_or('?').to_string()),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.text_secondary)
                            .child(name.to_string()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap(px(20.0))
                    .items_center()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child(ownership.to_string()),
                    )
                    .child(
                        // Value badge instead of change
                        div()
                            .px(px(8.0))
                            .py(px(4.0))
                            .rounded(px(4.0))
                            .bg(theme.accent_subtle)
                            .text_size(px(11.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.accent)
                            .child(format!("${}", value)),
                    ),
            )
    }

    fn holder_row(
        &self,
        name: &str,
        ownership: &str,
        change: &str,
        is_positive: bool,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let change_color = if is_positive {
            theme.positive
        } else {
            theme.negative
        };

        div()
            .flex()
            .items_center()
            .justify_between()
            .py(px(12.0))
            .px(px(8.0))
            .border_b_1()
            .border_color(theme.border_subtle)
            .cursor_pointer()
            .rounded(px(4.0))
            .hover(|s| s.bg(theme.hover_bg).border_color(transparent_black()))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    // Holder avatar/icon
                    .child(
                        div()
                            .size(px(32.0))
                            .rounded(px(6.0))
                            .bg(theme.accent_subtle)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.accent)
                            .child(name.chars().next().unwrap_or('?').to_string()),
                    )
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.text_secondary)
                            .child(name.to_string()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap(px(20.0))
                    .items_center()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child(ownership.to_string()),
                    )
                    .child(
                        // Change badge
                        div()
                            .px(px(8.0))
                            .py(px(4.0))
                            .rounded(px(4.0))
                            .bg(if is_positive {
                                theme.positive_subtle
                            } else {
                                theme.negative_subtle
                            })
                            .text_size(px(11.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(change_color)
                            .child(change.to_string()),
                    ),
            )
    }

    // Notes Panel Rendering

    fn render_notes_panel(&self, cx: &mut Context<Self>) -> Div {
        // If Editor tab is selected, render the full notes editor view with interactive toolbar
        if self.notes_active_tab == NotesTab::Editor {
            return div()
                .flex_grow()
                .flex()
                .flex_col()
                // Minimal header with tab switcher
                .child(self.render_notes_header(cx))
                // Editor toolbar with interactive buttons
                .child(self.render_editor_toolbar(cx))
                // Full editor takes remaining space
                .child(render_notes_editor(&self.theme, &self.notes_editor_state));
        }

        let show_trade_stats = self.notes_active_tab == NotesTab::Trades;

        let mut panel = div()
            .flex_grow()
            .p(px(28.0))
            .flex()
            .flex_col()
            .gap(px(24.0))
            .overflow_hidden()
            // Notes header with tabs
            .child(self.render_notes_header(cx))
            // Notes content based on active tab
            .child(match self.notes_active_tab {
                NotesTab::Theses => self.render_theses_list(cx),
                NotesTab::Trades => self.render_trades_list(cx),
                NotesTab::Search => self.render_notes_search(cx),
                NotesTab::Editor => div(), // Handled above, unreachable
            });

        // Trade statistics card (shown for trades tab)
        if show_trade_stats {
            panel = panel.child(self.render_trade_stats());
        }

        panel
    }

    fn render_notes_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex()
            .justify_between()
            .items_center()
            .pb(px(16.0))
            .border_b_1()
            .border_color(theme.border_subtle)
            // Left: Title and tabs
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(32.0))
                    .child(
                        div()
                            .text_size(px(24.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child("Notes Vault"),
                    )
                    .child(self.render_notes_tabs(cx)),
            )
            // Right: Action buttons
            .child(
                div()
                    .flex()
                    .gap(px(12.0))
                    .child(self.render_action_button("New Thesis", theme.accent))
                    .child(self.render_action_button("New Trade", theme.positive)),
            )
    }

    fn render_notes_tabs(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex()
            .gap(px(4.0))
            .p(px(4.0))
            .rounded(px(8.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border_subtle)
            .child(self.notes_tab_button("Theses", NotesTab::Theses, cx))
            .child(self.notes_tab_button("Trades", NotesTab::Trades, cx))
            .child(self.notes_tab_button("Search", NotesTab::Search, cx))
            .child(self.notes_tab_button("Editor", NotesTab::Editor, cx))
    }

    fn notes_tab_button(
        &self,
        label: &str,
        tab: NotesTab,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let is_selected = self.notes_active_tab == tab;

        let bg = if is_selected {
            theme.accent_subtle
        } else {
            transparent_black()
        };
        let text_color = if is_selected {
            theme.accent
        } else {
            theme.text_muted
        };

        div()
            .id(SharedString::from(format!("notes-tab-{:?}", tab)))
            .px(px(16.0))
            .py(px(8.0))
            .rounded(px(6.0))
            .bg(bg)
            .text_size(px(13.0))
            .font_weight(if is_selected {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::MEDIUM
            })
            .text_color(text_color)
            .cursor_pointer()
            .hover(|s| s.bg(theme.hover_bg).text_color(theme.text_secondary))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.set_notes_tab(tab, cx);
            }))
            .child(label.to_string())
    }

    fn render_action_button(&self, label: &str, color: Hsla) -> impl IntoElement {
        div()
            .px(px(16.0))
            .py(px(10.0))
            .rounded(px(8.0))
            .bg(color.opacity(0.15))
            .border_1()
            .border_color(color.opacity(0.3))
            .text_size(px(13.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(color)
            .cursor_pointer()
            .hover(|s| s.bg(color.opacity(0.25)))
            .child(label.to_string())
    }

    /// Render the interactive editor toolbar with formatting and action buttons
    fn render_editor_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let has_active_buffer = self.notes_editor_state.active_buffer().is_some();
        let is_dirty = self
            .notes_editor_state
            .active_buffer()
            .map(|b| b.is_dirty)
            .unwrap_or(false);
        let preview_mode = self.notes_editor_state.preview_mode;

        div()
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(16.0))
            .py(px(8.0))
            .bg(theme.card_bg)
            .border_b_1()
            .border_color(theme.border_subtle)
            // Formatting group
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .child(
                        self.editor_toolbar_button(
                            "B",
                            Some("Bold"),
                            has_active_buffer,
                            cx,
                            |this, cx| {
                                this.notes_editor_bold(cx);
                            },
                        ),
                    )
                    .child(
                        self.editor_toolbar_button(
                            "I",
                            Some("Italic"),
                            has_active_buffer,
                            cx,
                            |this, cx| {
                                this.notes_editor_italic(cx);
                            },
                        ),
                    )
                    .child(
                        self.editor_toolbar_button(
                            "</>",
                            Some("Code Block"),
                            has_active_buffer,
                            cx,
                            |this, cx| {
                                this.notes_editor_code(cx);
                            },
                        ),
                    ),
            )
            // Separator
            .child(div().w(px(1.0)).h(px(20.0)).bg(theme.border_subtle))
            // File operations group
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .child(self.editor_toolbar_button(
                        "+",
                        Some("New Note"),
                        true,
                        cx,
                        |this, cx| {
                            this.notes_editor_new_note(cx);
                        },
                    ))
                    .child(self.editor_toolbar_save_button("Save", is_dirty, cx))
                    .child(
                        self.editor_toolbar_button(
                            "X",
                            Some("Close Note"),
                            has_active_buffer,
                            cx,
                            |this, cx| {
                                this.notes_editor_close_note(cx);
                            },
                        ),
                    ),
            )
            // Separator
            .child(div().w(px(1.0)).h(px(20.0)).bg(theme.border_subtle))
            // View options group
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .child(self.editor_toolbar_toggle_button(
                        "Preview",
                        preview_mode,
                        has_active_buffer,
                        cx,
                        |this, cx| {
                            this.notes_editor_preview(cx);
                        },
                    ))
                    .child(self.editor_toolbar_button(
                        "Split",
                        Some("Split View"),
                        has_active_buffer,
                        cx,
                        |this, cx| {
                            this.notes_editor_split_view(cx);
                        },
                    )),
            )
            // Spacer
            .child(div().flex_grow())
            // Keyboard shortcuts hint
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.text_dimmed)
                    .child("Ctrl+S to save"),
            )
    }

    /// Single editor toolbar button
    fn editor_toolbar_button<F>(
        &self,
        label: &str,
        tooltip: Option<&'static str>,
        enabled: bool,
        cx: &mut Context<Self>,
        on_click: F,
    ) -> impl IntoElement
    where
        F: Fn(&mut Self, &mut Context<Self>) + 'static,
    {
        let theme = &self.theme;
        let label_owned = label.to_string();
        let button_id = format!("editor-btn-{}", label.replace(' ', "-").to_lowercase());
        let tooltip_id = button_id.clone();

        div()
            .id(SharedString::from(button_id))
            .group(SharedString::from(tooltip_id.clone()))
            .relative()
            .px(px(8.0))
            .py(px(4.0))
            .rounded(px(4.0))
            .cursor(if enabled {
                CursorStyle::PointingHand
            } else {
                CursorStyle::default()
            })
            .text_size(px(12.0))
            .font_weight(FontWeight::MEDIUM)
            .text_color(if enabled {
                theme.text_muted
            } else {
                theme.text_dimmed
            })
            .opacity(if enabled { 1.0 } else { 0.5 })
            .when(enabled, |el| {
                el.hover(|s| s.bg(theme.hover_bg).text_color(theme.text))
            })
            .when(enabled, |el| {
                el.on_click(cx.listener(move |this, _event, _window, cx| {
                    on_click(this, cx);
                }))
            })
            .child(label_owned)
            .when_some(tooltip, |el, text| {
                el.child(
                    render_tooltip(theme, text, tooltip_id)
                        .absolute()
                        .top(px(30.0))
                        .left(px(0.0)),
                )
            })
    }

    /// Editor toolbar save button with dirty indicator
    fn editor_toolbar_save_button(
        &self,
        label: &str,
        is_dirty: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let label_owned = label.to_string();

        div()
            .id("editor-btn-save")
            .px(px(10.0))
            .py(px(4.0))
            .rounded(px(4.0))
            .cursor(if is_dirty {
                CursorStyle::PointingHand
            } else {
                CursorStyle::default()
            })
            .text_size(px(12.0))
            .font_weight(FontWeight::MEDIUM)
            .when(is_dirty, |el| {
                el.bg(theme.accent.opacity(0.15))
                    .text_color(theme.accent)
                    .hover(|s| s.bg(theme.accent.opacity(0.25)))
            })
            .when(!is_dirty, |el| {
                el.text_color(theme.text_dimmed).opacity(0.6)
            })
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.notes_editor_save(cx);
            }))
            .child(if is_dirty {
                format!("* {}", label_owned)
            } else {
                label_owned
            })
    }

    /// Editor toolbar toggle button (for preview mode)
    fn editor_toolbar_toggle_button<F>(
        &self,
        label: &str,
        is_active: bool,
        enabled: bool,
        cx: &mut Context<Self>,
        on_click: F,
    ) -> impl IntoElement
    where
        F: Fn(&mut Self, &mut Context<Self>) + 'static,
    {
        let theme = &self.theme;
        let label_owned = label.to_string();
        let button_id = format!("editor-toggle-{}", label.replace(' ', "-").to_lowercase());

        div()
            .id(SharedString::from(button_id))
            .px(px(10.0))
            .py(px(4.0))
            .rounded(px(4.0))
            .cursor(if enabled {
                CursorStyle::PointingHand
            } else {
                CursorStyle::default()
            })
            .text_size(px(12.0))
            .font_weight(FontWeight::MEDIUM)
            .when(is_active && enabled, |el| {
                el.bg(theme.accent_subtle).text_color(theme.accent)
            })
            .when(!is_active && enabled, |el| {
                el.text_color(theme.text_muted)
                    .hover(|s| s.bg(theme.hover_bg).text_color(theme.text))
            })
            .when(!enabled, |el| el.text_color(theme.text_dimmed).opacity(0.5))
            .when(enabled, |el| {
                el.on_click(cx.listener(move |this, _event, _window, cx| {
                    on_click(this, cx);
                }))
            })
            .child(label_owned)
    }

    fn render_theses_list(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        let mut container = div().flex().flex_col().gap(px(16.0));

        // Show loading state
        if self.theses_loading.is_loading() {
            return container.child(self.render_loading_state("Loading theses..."));
        }

        // Show error state
        if let LoadingState::Error(ref err) = self.theses_loading {
            return container
                .child(self.render_error_state(err, "theses"))
                .child(self.render_retry_button("Retry", cx));
        }

        // Header with count and API status
        container = container.child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child(format!("{} Investment Theses", self.theses.len())),
                )
                .child(self.render_api_status_badge())
                .child(self.render_sync_status_badge()),
        );

        // Theses list
        if self.theses.is_empty() {
            container = container.child(self.render_empty_state("No theses found"));
        } else {
            container = container.child(
                div().flex().flex_col().gap(px(12.0)).children(
                    self.theses
                        .iter()
                        .map(|thesis| self.render_thesis_card(thesis))
                        .collect::<Vec<_>>(),
                ),
            );
        }

        container
    }

    fn render_loading_state(&self, message: &str) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .p(px(40.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(12.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(theme.text_muted)
                    .child(message.to_string()),
            )
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.text_dimmed)
                    .child("Connecting to API..."),
            )
    }

    fn render_error_state(&self, error: &str, context: &str) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .p(px(20.0))
            .rounded(px(8.0))
            .bg(theme.negative_subtle)
            .border_1()
            .border_color(theme.negative_muted)
            .flex()
            .flex_col()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.negative)
                    .child(format!("Failed to load {}", context)),
            )
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(theme.text_muted)
                    .child(error.to_string()),
            )
    }

    fn render_empty_state(&self, message: &str) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .p(px(40.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(theme.text_muted)
                    .child(message.to_string()),
            )
    }

    fn render_retry_button(&self, label: &str, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .id("retry-button")
            .px(px(16.0))
            .py(px(8.0))
            .rounded(px(6.0))
            .bg(theme.accent_subtle)
            .border_1()
            .border_color(theme.accent_muted)
            .text_size(px(13.0))
            .font_weight(FontWeight::MEDIUM)
            .text_color(theme.accent)
            .cursor_pointer()
            .hover(|s| s.bg(theme.accent.opacity(0.2)))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.check_api_health(cx);
            }))
            .child(label.to_string())
    }

    fn render_api_status_badge(&self) -> impl IntoElement {
        let theme = &self.theme;

        let (status_text, bg, border, text_color): (&str, Hsla, Hsla, Hsla) =
            match &self.api_connected {
                LoadingState::NotStarted => (
                    "Connecting...",
                    theme.accent_subtle,
                    theme.accent_muted,
                    theme.accent,
                ),
                LoadingState::Loading => (
                    "Connecting...",
                    theme.accent_subtle,
                    theme.accent_muted,
                    theme.accent,
                ),
                LoadingState::Loaded(true) => (
                    "Live",
                    theme.positive_subtle,
                    theme.positive_muted,
                    theme.positive,
                ),
                LoadingState::Loaded(false) => (
                    "Offline",
                    theme.negative_subtle,
                    theme.negative_muted,
                    theme.negative,
                ),
                LoadingState::Error(_) => (
                    "Demo Mode",
                    hsla(0.12, 0.85, 0.55, 0.15),
                    hsla(0.12, 0.85, 0.55, 0.3),
                    hsla(0.12, 0.85, 0.55, 1.0),
                ),
            };

        div()
            .px(px(8.0))
            .py(px(3.0))
            .rounded(px(4.0))
            .bg(bg)
            .border_1()
            .border_color(border)
            .text_size(px(10.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(text_color)
            .child(status_text.to_string())
    }

    /// Render WebSocket sync status badge
    fn render_sync_status_badge(&self) -> impl IntoElement {
        let theme = &self.theme;

        let (status_color, status_text, status_icon) = match self.sync_status {
            ConnectionStatus::Connected => (
                hsla(0.4, 0.9, 0.5, 1.0), // Green
                "Sync",
                "●",
            ),
            ConnectionStatus::Connecting => (
                hsla(0.15, 0.9, 0.5, 1.0), // Yellow
                "Connecting",
                "◌",
            ),
            ConnectionStatus::Reconnecting => (
                hsla(0.08, 0.9, 0.6, 1.0), // Orange
                "Reconnecting",
                "◌",
            ),
            ConnectionStatus::Disconnected => (
                hsla(0.0, 0.0, 0.5, 1.0), // Gray
                "Offline",
                "○",
            ),
            ConnectionStatus::Error => (
                hsla(0.0, 0.9, 0.5, 1.0), // Red
                "Error",
                "✕",
            ),
        };

        div()
            .px(px(10.0))
            .py(px(4.0))
            .bg(status_color.opacity(0.15))
            .border_1()
            .border_color(status_color.opacity(0.3))
            .rounded(px(4.0))
            .flex()
            .items_center()
            .gap(px(6.0))
            .child(
                div()
                    .text_size(px(10.0))
                    .text_color(status_color)
                    .child(status_icon),
            )
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.text_muted)
                    .child(status_text),
            )
    }

    fn render_thesis_card(&self, thesis: &ThesisNote) -> impl IntoElement {
        let theme = &self.theme;
        let status_color = match thesis.status {
            ThesisStatus::Active => theme.positive,
            ThesisStatus::Research => theme.accent,
            ThesisStatus::Watchlist => hsla(0.12, 0.85, 0.55, 1.0), // Orange
            ThesisStatus::Closed => theme.text_muted,
            ThesisStatus::Invalidated => theme.negative,
        };

        div()
            .p(px(20.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .cursor_pointer()
            .hover(|s| {
                s.bg(theme.card_bg_elevated)
                    .border_color(theme.border_strong)
            })
            .flex()
            .flex_col()
            .gap(px(12.0))
            // Header row: Symbol, status badge, conviction
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .text_size(px(18.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .child(thesis.symbol.clone()),
                            )
                            .child(
                                // Status badge
                                div()
                                    .px(px(10.0))
                                    .py(px(4.0))
                                    .rounded(px(6.0))
                                    .bg(status_color.opacity(0.15))
                                    .border_1()
                                    .border_color(status_color.opacity(0.3))
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(status_color)
                                    .child(thesis.status.label().to_string()),
                            ),
                    )
                    .child(
                        // Conviction badge
                        div()
                            .px(px(10.0))
                            .py(px(4.0))
                            .rounded(px(6.0))
                            .bg(theme.accent_subtle)
                            .text_size(px(11.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.accent)
                            .child(format!("{} Conviction", thesis.conviction)),
                    ),
            )
            // Title
            .child(
                div()
                    .text_size(px(14.0))
                    .text_color(theme.text_secondary)
                    .child(thesis.name.clone()),
            )
            // Price info row
            .child(
                div()
                    .flex()
                    .gap(px(24.0))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Entry Price"),
                            )
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .child(
                                        thesis
                                            .entry_price
                                            .map(|p| format!("${:.2}", p))
                                            .unwrap_or_else(|| "—".to_string()),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Target Price"),
                            )
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.positive)
                                    .child(
                                        thesis
                                            .target_price
                                            .map(|p| format!("${:.2}", p))
                                            .unwrap_or_else(|| "—".to_string()),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Upside"),
                            )
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.positive)
                                    .child(match (thesis.entry_price, thesis.target_price) {
                                        (Some(entry), Some(target)) => {
                                            let upside = ((target / entry) - 1.0) * 100.0;
                                            format!("{:+.1}%", upside)
                                        }
                                        _ => "—".to_string(),
                                    }),
                            ),
                    )
                    .child(
                        div().flex_grow().flex().justify_end().child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_dimmed)
                                .child(format!("Updated {}", thesis.modified)),
                        ),
                    ),
            )
    }

    fn render_trades_list(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        let mut container = div().flex().flex_col().gap(px(16.0));

        // Show loading state
        if self.trades_loading.is_loading() {
            return container.child(self.render_loading_state("Loading trades..."));
        }

        // Show error state
        if let LoadingState::Error(ref err) = self.trades_loading {
            return container
                .child(self.render_error_state(err, "trades"))
                .child(self.render_retry_button("Retry", cx));
        }

        // Header with count and API status
        container = container.child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_muted)
                        .child(format!("{} Trade Journal Entries", self.trades.len())),
                )
                .child(self.render_api_status_badge())
                .child(self.render_sync_status_badge()),
        );

        // Trades list
        if self.trades.is_empty() {
            container = container.child(self.render_empty_state("No trades found"));
        } else {
            container = container.child(
                div().flex().flex_col().gap(px(12.0)).children(
                    self.trades
                        .iter()
                        .map(|trade| self.render_trade_card(trade))
                        .collect::<Vec<_>>(),
                ),
            );
        }

        container
    }

    fn render_trade_card(&self, trade: &TradeNote) -> impl IntoElement {
        let theme = &self.theme;
        let is_profitable = trade.pnl.map(|p| p > 0.0).unwrap_or(false);
        let pnl_color = if is_profitable {
            theme.positive
        } else {
            theme.negative
        };
        let direction_color = match trade.direction {
            TradeDirection::Long => theme.positive,
            TradeDirection::Short => theme.negative,
        };
        let status_color = match trade.status {
            TradeStatus::Open => theme.accent,
            TradeStatus::Closed => theme.text_muted,
            TradeStatus::Partial => hsla(0.12, 0.85, 0.55, 1.0),
        };

        div()
            .p(px(20.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .cursor_pointer()
            .hover(|s| {
                s.bg(theme.card_bg_elevated)
                    .border_color(theme.border_strong)
            })
            .flex()
            .justify_between()
            .items_center()
            // Left: Trade info
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(20.0))
                    // Symbol and direction
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .text_size(px(18.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .child(trade.symbol.clone()),
                            )
                            .child(
                                // Direction badge
                                div()
                                    .px(px(8.0))
                                    .py(px(4.0))
                                    .rounded(px(4.0))
                                    .bg(direction_color.opacity(0.15))
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(direction_color)
                                    .child(trade.direction.label().to_uppercase()),
                            )
                            .child(
                                // Status badge
                                div()
                                    .px(px(8.0))
                                    .py(px(4.0))
                                    .rounded(px(4.0))
                                    .bg(status_color.opacity(0.15))
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(status_color)
                                    .child(trade.status.label()),
                            ),
                    )
                    // Entry/Exit prices
                    .child(
                        div()
                            .flex()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Entry"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.text)
                                            .child(format!("${:.2}", trade.entry_price)),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Exit"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.text)
                                            .child(
                                                trade
                                                    .exit_price
                                                    .map(|p| format!("${:.2}", p))
                                                    .unwrap_or_else(|| "—".to_string()),
                                            ),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Shares"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.text)
                                            .child(format!("{:.0}", trade.shares)),
                                    ),
                            ),
                    )
                    // Date
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.text_dimmed)
                            .child(trade.entry_date.clone()),
                    ),
            )
            // Right: P&L
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap(px(2.0))
                    .when(trade.pnl.is_some(), |s| {
                        s.child(
                            div()
                                .text_size(px(16.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(pnl_color)
                                .child(format!("{:+.2}", trade.pnl.unwrap_or(0.0))),
                        )
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(pnl_color.opacity(0.8))
                                .child(format!("{:+.2}%", trade.pnl_percent.unwrap_or(0.0))),
                        )
                    })
                    .when(trade.pnl.is_none(), |s| {
                        s.child(
                            div()
                                .text_size(px(14.0))
                                .text_color(theme.text_dimmed)
                                .child("Open"),
                        )
                    }),
            )
    }

    fn render_trade_stats(&self) -> impl IntoElement {
        let theme = &self.theme;

        // Calculate stats from trades
        let closed_trades: Vec<_> = self
            .trades
            .iter()
            .filter(|t| t.status == TradeStatus::Closed)
            .collect();
        let total_pnl: f64 = closed_trades.iter().filter_map(|t| t.pnl).sum();
        let winners = closed_trades
            .iter()
            .filter(|t| t.pnl.map(|p| p > 0.0).unwrap_or(false))
            .count();
        let win_rate = if !closed_trades.is_empty() {
            (winners as f64 / closed_trades.len() as f64) * 100.0
        } else {
            0.0
        };

        div()
            .p(px(24.0))
            .rounded(px(12.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .flex()
            .flex_col()
            .gap(px(20.0))
            .child(
                div()
                    .text_size(px(15.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text)
                    .child("Trade Statistics"),
            )
            .child(
                div()
                    .flex()
                    .gap(px(32.0))
                    .child(self.stat_item(
                        "Total Trades",
                        &closed_trades.len().to_string(),
                        theme.text,
                    ))
                    .child(self.stat_item("Winners", &winners.to_string(), theme.positive))
                    .child(self.stat_item(
                        "Losers",
                        &(closed_trades.len() - winners).to_string(),
                        theme.negative,
                    ))
                    .child(self.stat_item("Win Rate", &format!("{:.1}%", win_rate), theme.accent))
                    .child(self.stat_item(
                        "Total P&L",
                        &format!("${:+.2}", total_pnl),
                        if total_pnl >= 0.0 {
                            theme.positive
                        } else {
                            theme.negative
                        },
                    )),
            )
    }

    fn stat_item(&self, label: &str, value: &str, color: Hsla) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.text_dimmed)
                    .child(label.to_string()),
            )
            .child(
                div()
                    .text_size(px(20.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(color)
                    .child(value.to_string()),
            )
    }

    fn render_notes_search(&self, _cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        div()
            .flex()
            .flex_col()
            .gap(px(20.0))
            // Search input placeholder
            .child(
                div()
                    .w_full()
                    .px(px(16.0))
                    .py(px(14.0))
                    .rounded(px(10.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .text_size(px(14.0))
                    .text_color(theme.text_dimmed)
                    .child("Search notes... (FTS5 powered)"),
            )
            // Search results placeholder
            .child(
                div()
                    .p(px(40.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(12.0))
                    .child(
                        div()
                            .text_size(px(48.0))
                            .text_color(theme.text_dimmed)
                            .child("..."),
                    )
                    .child(
                        div()
                            .text_size(px(14.0))
                            .text_color(theme.text_muted)
                            .child("Enter a search term to find notes"),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.text_dimmed)
                            .child("Supports FTS5 syntax: AND, OR, \"exact phrase\""),
                    ),
            )
    }

    /// Render keyboard shortcuts modal
    fn render_shortcuts_modal(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let modal_title = ModalType::Shortcuts.title();

        // Get shortcuts organized by category from keyboard.rs helper
        let shortcuts_data = get_shortcuts_help();

        // Group categories into sections for better organization
        let essential_categories = ["Navigation", "Search", "Modal"];
        let action_categories = ["Data", "UI", "Quick Actions", "Quick Actions Panel"];
        let navigation_categories = ["Table", "Watchlist", "Focus", "Vim"];
        let editor_categories = ["Notes Editor"];

        // Helper closure to filter and limit shortcuts
        let filter_shortcuts =
            |categories: &[&str]| -> Vec<(&'static str, Vec<(&'static str, &'static str)>)> {
                shortcuts_data
                    .iter()
                    .filter(|(cat, _)| categories.contains(cat))
                    .map(|(cat, items)| {
                        let limited_items: Vec<_> = items.iter().take(5).copied().collect();
                        (*cat, limited_items)
                    })
                    .collect()
            };

        let essential = filter_shortcuts(&essential_categories);
        let actions = filter_shortcuts(&action_categories);
        let navigation = filter_shortcuts(&navigation_categories);
        let editor = filter_shortcuts(&editor_categories);

        // Backdrop + modal with keyboard handling
        div()
            .id("shortcuts-modal")
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(hsla(0.0, 0.0, 0.0, 0.7))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.toggle_shortcuts_modal(cx);
            }))
            .child(
                div()
                    .id("shortcuts-modal-content")
                    .w(px(800.0))
                    .max_w(px(900.0))
                    .max_h(px(700.0))
                    .rounded(px(16.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .overflow_hidden()
                    // Prevent click propagation to backdrop
                    .on_click(|_event, _window, _cx| {
                        // Stop propagation - don't close modal when clicking content
                    })
                    // Header
                    .child(
                        div()
                            .px(px(24.0))
                            .py(px(16.0))
                            .border_b_1()
                            .border_color(theme.border_subtle)
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
                                            .text_color(theme.text)
                                            .child(modal_title),
                                    )
                                    .child(
                                        div()
                                            .px(px(8.0))
                                            .py(px(2.0))
                                            .rounded(px(4.0))
                                            .bg(theme.hover_bg)
                                            .text_size(px(11.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Press Esc or ? to close"),
                                    ),
                            )
                            .child(
                                div()
                                    .id("close-shortcuts")
                                    .size(px(28.0))
                                    .rounded(px(6.0))
                                    .bg(theme.hover_bg)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .cursor_pointer()
                                    .hover(|s| s.bg(theme.active_bg))
                                    .on_click(cx.listener(|this, _event, _window, cx| {
                                        this.toggle_shortcuts_modal(cx);
                                    }))
                                    .child(
                                        div()
                                            .text_size(px(16.0))
                                            .text_color(theme.text_muted)
                                            .child("x"),
                                    ),
                            ),
                    )
                    // Content - organized sections
                    .child(
                        div()
                            .id("shortcuts-content")
                            .p(px(24.0))
                            .overflow_y_scroll()
                            .max_h(px(580.0))
                            .flex()
                            .flex_col()
                            .gap(px(20.0))
                            // Essential Shortcuts Section
                            .child(self.render_shortcuts_section(
                                "Essential",
                                "Core navigation and search",
                                essential,
                            ))
                            // Actions Section
                            .child(self.render_shortcuts_section(
                                "Actions",
                                "Data operations and UI controls",
                                actions,
                            ))
                            // Navigation Section
                            .child(self.render_shortcuts_section(
                                "Navigation",
                                "Table, watchlist, and vim-style navigation",
                                navigation,
                            ))
                            // Editor Section
                            .child(self.render_shortcuts_section(
                                "Notes Editor",
                                "Markdown editor shortcuts",
                                editor,
                            ))
                            // Quick Tips Section
                            .child(self.render_quick_tips_section()),
                    ),
            )
    }

    /// Render a section of shortcuts with header and categories
    fn render_shortcuts_section(
        &self,
        section_title: &'static str,
        section_description: &'static str,
        categories: Vec<(&'static str, Vec<(&'static str, &'static str)>)>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        div()
            .flex()
            .flex_col()
            .gap(px(12.0))
            // Section header
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.text)
                            .child(section_title),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .child(section_description),
                    ),
            )
            // Categories in flex wrap
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(16.0))
                    .children(categories.into_iter().map(|(category, items)| {
                        let theme = &self.theme;
                        div()
                            .w(px(230.0))
                            .flex()
                            .flex_col()
                            .gap(px(6.0))
                            .p(px(12.0))
                            .rounded(px(8.0))
                            .bg(theme.hover_bg)
                            // Category header
                            .child(
                                div()
                                    .pb(px(4.0))
                                    .mb(px(2.0))
                                    .border_b_1()
                                    .border_color(theme.border_subtle)
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.accent)
                                    .child(category.to_uppercase()),
                            )
                            // Shortcut items
                            .children(items.into_iter().map(|(key, desc)| {
                                let theme = &self.theme;
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .py(px(2.0))
                                    // Description on left
                                    .child(
                                        div()
                                            .flex_1()
                                            .text_size(px(11.0))
                                            .text_color(theme.text_secondary)
                                            .overflow_hidden()
                                            .child(desc),
                                    )
                                    // Key combo on right
                                    .child(
                                        div()
                                            .ml(px(8.0))
                                            .px(px(6.0))
                                            .py(px(2.0))
                                            .rounded(px(3.0))
                                            .bg(theme.card_bg)
                                            .border_1()
                                            .border_color(theme.border_subtle)
                                            .text_size(px(9.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text_muted)
                                            .child(key),
                                    )
                            }))
                    })),
            )
    }

    /// Render quick tips section at bottom of shortcuts modal
    fn render_quick_tips_section(&self) -> impl IntoElement {
        let theme = &self.theme;
        let tips = [
            (
                "Vim Mode",
                "Use h/j/k/l for navigation when not in a text field",
            ),
            (
                "Quick Switch",
                "Press 1-9 to instantly switch between views",
            ),
            (
                "Symbol Search",
                "Ctrl+K opens the symbol search from anywhere",
            ),
            (
                "Refresh",
                "Ctrl+R refreshes current view, Ctrl+Shift+R refreshes all",
            ),
            ("Help", "Press ? anytime to show this help dialog"),
        ];

        div()
            .mt(px(8.0))
            .p(px(16.0))
            .rounded(px(8.0))
            .bg(hsla(theme.accent.h, theme.accent.s, theme.accent.l, 0.1))
            .border_1()
            .border_color(hsla(theme.accent.h, theme.accent.s, theme.accent.l, 0.2))
            .flex()
            .flex_col()
            .gap(px(10.0))
            // Tips header
            .child(
                div().flex().items_center().gap(px(8.0)).child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.accent)
                        .child("Quick Tips"),
                ),
            )
            // Tips list
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_x(px(24.0))
                    .gap_y(px(6.0))
                    .children(tips.into_iter().map(|(title, description)| {
                        let theme = &self.theme;
                        div()
                            .w(px(340.0))
                            .flex()
                            .items_start()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("*"),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text)
                                            .child(title),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(theme.text_muted)
                                            .child(description),
                                    ),
                            )
                    })),
            )
    }

    /// Render active modal based on modal type (unified modal system)
    fn render_active_modal(&self, modal_type: &ModalType, cx: &mut Context<Self>) -> AnyElement {
        match modal_type {
            ModalType::Shortcuts => self.render_shortcuts_modal(cx).into_any_element(),
            ModalType::QuickActions => self.render_quick_actions_panel(cx).into_any_element(),
            ModalType::SymbolSearch => self.render_symbol_search_modal(cx).into_any_element(),
            ModalType::PredictionMarketsSearch { kind } => self
                .render_prediction_markets_search_modal(*kind, cx)
                .into_any_element(),
            ModalType::Settings => self.render_settings_modal(cx).into_any_element(),
            ModalType::Confirmation { title, message, .. } => self
                .render_confirmation_modal(title, message, cx)
                .into_any_element(),
            ModalType::Error { title, message } => self
                .render_error_modal(title, message, cx)
                .into_any_element(),
            ModalType::Custom(id) => self.render_custom_modal(id, cx).into_any_element(),
        }
    }

    /// Render the settings modal with full options panel
    fn render_settings_modal(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let modal_title = ModalType::Settings.title();

        // Capture state for display
        let is_dark = self.is_dark_theme;
        let api_base_url = self.api_client.base_url.clone();
        let sync_status = self.sync_status;
        let current_model = self.agent_state.status_widget.model.name.clone();
        let model_provider = self.agent_state.status_widget.model.provider.clone();
        let refresh_interval = self.data_refresh_interval_seconds;

        // Connection status display
        let (ws_status_text, ws_status_color) = match sync_status {
            ConnectionStatus::Connected => ("Connected", theme.positive),
            ConnectionStatus::Connecting => ("Connecting...", theme.warning),
            ConnectionStatus::Reconnecting => ("Reconnecting...", theme.warning),
            ConnectionStatus::Disconnected => ("Disconnected", theme.text_muted),
            ConnectionStatus::Error => ("Error", theme.negative),
        };

        // Format interval text
        let interval_text = if refresh_interval >= 60 {
            format!("{} min", refresh_interval / 60)
        } else {
            format!("{} sec", refresh_interval)
        };

        div()
            .id("settings-modal")
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(hsla(0.0, 0.0, 0.0, 0.7))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.close_modal(cx);
            }))
            .child(
                div()
                    .id("settings-content")
                    .w(px(560.0))
                    .max_h(px(600.0))
                    .overflow_y_scroll()
                    .p(px(24.0))
                    .rounded(px(16.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .on_click(|_event, _window, _cx| {})
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(20.0))
                            // Header
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .pb(px(12.0))
                                    .border_b_1()
                                    .border_color(theme.border_subtle)
                                    .child(
                                        div()
                                            .text_size(px(18.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.text)
                                            .child(modal_title),
                                    )
                                    .child(
                                        div()
                                            .px(px(8.0))
                                            .py(px(2.0))
                                            .rounded(px(4.0))
                                            .bg(theme.hover_bg)
                                            .text_size(px(11.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Esc to close"),
                                    ),
                            )
                            // Appearance Section
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text_muted)
                                            .child("APPEARANCE"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(8.0))
                                            .p(px(12.0))
                                            .rounded(px(8.0))
                                            .bg(theme.hover_bg)
                                            .child(
                                                div()
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
                                                                    .text_size(px(14.0))
                                                                    .text_color(theme.text)
                                                                    .child("Theme"),
                                                            )
                                                            .child(
                                                                div()
                                                                    .text_size(px(12.0))
                                                                    .text_color(theme.text_muted)
                                                                    .child(if is_dark {
                                                                        "Dark"
                                                                    } else {
                                                                        "Light"
                                                                    }),
                                                            ),
                                                    )
                                                    .child(
                                                        div()
                                                            .id("theme-toggle")
                                                            .w(px(44.0))
                                                            .h(px(24.0))
                                                            .rounded(px(12.0))
                                                            .bg(if is_dark {
                                                                theme.accent
                                                            } else {
                                                                theme.border
                                                            })
                                                            .cursor_pointer()
                                                            .flex()
                                                            .items_center()
                                                            .px(px(2.0))
                                                            .on_click(cx.listener(
                                                                |this, _event, _window, cx| {
                                                                    this.toggle_theme(cx);
                                                                },
                                                            ))
                                                            .child(
                                                                div()
                                                                    .w(px(20.0))
                                                                    .h(px(20.0))
                                                                    .rounded_full()
                                                                    .bg(hsla(0.0, 0.0, 1.0, 1.0))
                                                                    .ml(if is_dark {
                                                                        px(20.0)
                                                                    } else {
                                                                        px(0.0)
                                                                    }),
                                                            ),
                                                    ),
                                            ),
                                    ),
                            )
                            // Connection Section
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text_muted)
                                            .child("CONNECTION"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(8.0))
                                            .p(px(12.0))
                                            .rounded(px(8.0))
                                            .bg(theme.hover_bg)
                                            // API Endpoint row
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .child(
                                                        div()
                                                            .text_size(px(14.0))
                                                            .text_color(theme.text)
                                                            .child("API Endpoint"),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_size(px(13.0))
                                                            .text_color(theme.text_secondary)
                                                            .child(api_base_url),
                                                    ),
                                            )
                                            // WebSocket Status row
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .child(
                                                        div()
                                                            .text_size(px(14.0))
                                                            .text_color(theme.text)
                                                            .child("WebSocket Status"),
                                                    )
                                                    .child(
                                                        div()
                                                            .flex()
                                                            .items_center()
                                                            .gap(px(6.0))
                                                            .child(
                                                                div()
                                                                    .w(px(8.0))
                                                                    .h(px(8.0))
                                                                    .rounded_full()
                                                                    .bg(ws_status_color),
                                                            )
                                                            .child(
                                                                div()
                                                                    .text_size(px(13.0))
                                                                    .text_color(
                                                                        theme.text_secondary,
                                                                    )
                                                                    .child(ws_status_text),
                                                            ),
                                                    ),
                                            ),
                                    ),
                            )
                            // Agent Configuration Section
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text_muted)
                                            .child("AGENT CONFIGURATION"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(8.0))
                                            .p(px(12.0))
                                            .rounded(px(8.0))
                                            .bg(theme.hover_bg)
                                            // Current Model row
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .child(
                                                        div()
                                                            .text_size(px(14.0))
                                                            .text_color(theme.text)
                                                            .child("Current Model"),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_size(px(13.0))
                                                            .text_color(theme.text_secondary)
                                                            .child(current_model),
                                                    ),
                                            )
                                            // Provider row
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .child(
                                                        div()
                                                            .text_size(px(14.0))
                                                            .text_color(theme.text)
                                                            .child("Provider"),
                                                    )
                                                    .child(
                                                        div()
                                                            .text_size(px(13.0))
                                                            .text_color(theme.text_secondary)
                                                            .child(model_provider),
                                                    ),
                                            ),
                                    ),
                            )
                            // Data Section
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text_muted)
                                            .child("DATA"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(8.0))
                                            .p(px(12.0))
                                            .rounded(px(8.0))
                                            .bg(theme.hover_bg)
                                            // Refresh Interval row
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .child(
                                                        div()
                                                            .text_size(px(14.0))
                                                            .text_color(theme.text)
                                                            .child("Refresh Interval"),
                                                    )
                                                    .child(
                                                        div()
                                                            .px(px(10.0))
                                                            .py(px(4.0))
                                                            .rounded(px(6.0))
                                                            .bg(theme.accent_subtle)
                                                            .text_size(px(12.0))
                                                            .text_color(theme.accent)
                                                            .child(interval_text),
                                                    ),
                                            ),
                                    ),
                            ),
                    ),
            )
    }

    /// Render a confirmation dialog modal
    fn render_confirmation_modal(
        &self,
        title: &str,
        message: &str,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let title_owned = title.to_string();
        let message_owned = message.to_string();

        // Extract the on_confirm action from the modal type
        let on_confirm_action =
            if let Some(ModalType::Confirmation { on_confirm, .. }) = &self.active_modal {
                on_confirm.clone()
            } else {
                String::new()
            };

        div()
            .id("confirmation-modal")
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(hsla(0.0, 0.0, 0.0, 0.7))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.close_modal(cx);
            }))
            .child(
                div()
                    .id("confirmation-content")
                    .w(px(400.0))
                    .p(px(24.0))
                    .rounded(px(16.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .on_click(|_event, _window, _cx| {})
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .text_size(px(18.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .child(title_owned),
                            )
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .text_color(theme.text_secondary)
                                    .child(message_owned),
                            )
                            .child(
                                div()
                                    .flex()
                                    .justify_end()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .id("cancel-btn")
                                            .px(px(16.0))
                                            .py(px(8.0))
                                            .rounded(px(8.0))
                                            .bg(theme.hover_bg)
                                            .cursor_pointer()
                                            .hover(|s| s.bg(theme.active_bg))
                                            .on_click(cx.listener(|this, _event, _window, cx| {
                                                this.close_modal(cx);
                                            }))
                                            .child(
                                                div()
                                                    .text_size(px(13.0))
                                                    .text_color(theme.text_muted)
                                                    .child("Cancel"),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .id("confirm-btn")
                                            .px(px(16.0))
                                            .py(px(8.0))
                                            .rounded(px(8.0))
                                            .bg(theme.accent)
                                            .cursor_pointer()
                                            .hover(|s| s.bg(theme.accent_hover))
                                            .on_click(cx.listener(
                                                move |this, _event, _window, cx| {
                                                    this.handle_confirmation_action(
                                                        &on_confirm_action,
                                                        cx,
                                                    );
                                                    this.close_modal(cx);
                                                },
                                            ))
                                            .child(
                                                div()
                                                    .text_size(px(13.0))
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                                                    .child("Confirm"),
                                            ),
                                    ),
                            ),
                    ),
            )
    }

    /// Handle confirmation action based on the action identifier
    fn handle_confirmation_action(&mut self, action: &str, cx: &mut Context<Self>) {
        match action {
            "remove_from_watchlist" => {
                self.confirm_remove_from_watchlist(cx);
            }
            _ => {
                // Unknown action - log or ignore
            }
        }
    }

    /// Actually remove symbol from watchlist (called after confirmation)
    fn confirm_remove_from_watchlist(&mut self, cx: &mut Context<Self>) {
        if self.watchlist_selected_index < self.watchlist.len() && self.watchlist.len() > 1 {
            self.watchlist.remove(self.watchlist_selected_index);
            // Adjust index if needed
            if self.watchlist_selected_index >= self.watchlist.len() {
                self.watchlist_selected_index = self.watchlist.len().saturating_sub(1);
            }
            cx.notify();
        }
    }

    /// Render an error display modal
    fn render_error_modal(
        &self,
        title: &str,
        message: &str,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let title_owned = title.to_string();
        let message_owned = message.to_string();

        div()
            .id("error-modal")
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(hsla(0.0, 0.0, 0.0, 0.7))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.close_modal(cx);
            }))
            .child(
                div()
                    .id("error-content")
                    .w(px(420.0))
                    .p(px(24.0))
                    .rounded(px(16.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.negative)
                    .shadow_lg()
                    .on_click(|_event, _window, _cx| {})
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .size(px(32.0))
                                            .rounded_full()
                                            .bg(theme.negative.opacity(0.15))
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .child(
                                                div()
                                                    .text_size(px(16.0))
                                                    .font_weight(FontWeight::BOLD)
                                                    .text_color(theme.negative)
                                                    .child("!"),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(18.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.negative)
                                            .child(title_owned),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .text_color(theme.text_secondary)
                                    .child(message_owned),
                            )
                            .child(
                                div().flex().justify_end().child(
                                    div()
                                        .id("dismiss-error-btn")
                                        .px(px(20.0))
                                        .py(px(8.0))
                                        .rounded(px(8.0))
                                        .bg(theme.negative)
                                        .cursor_pointer()
                                        .hover(|s| s.bg(theme.negative_hover))
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.close_modal(cx);
                                        }))
                                        .child(
                                            div()
                                                .text_size(px(13.0))
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                                                .child("Dismiss"),
                                        ),
                                ),
                            ),
                    ),
            )
    }

    /// Render a custom modal for extensibility
    fn render_custom_modal(&self, id: &str, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let id_owned = id.to_string();

        div()
            .id(format!("custom-modal-{}", id))
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(hsla(0.0, 0.0, 0.0, 0.7))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.close_modal(cx);
            }))
            .child(
                div()
                    .id("custom-modal-content")
                    .w(px(400.0))
                    .p(px(24.0))
                    .rounded(px(16.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .on_click(|_event, _window, _cx| {})
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .text_size(px(18.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.text)
                                            .child(id_owned.clone()),
                                    )
                                    .child(
                                        div()
                                            .px(px(8.0))
                                            .py(px(2.0))
                                            .rounded(px(4.0))
                                            .bg(theme.hover_bg)
                                            .text_size(px(11.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Esc to close"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .text_color(theme.text_muted)
                                    .child(format!("Custom modal: {}", id_owned)),
                            ),
                    ),
            )
    }

    /// Render quick actions panel overlay (Ctrl+Shift+K)
    fn render_quick_actions_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let current_symbol = self.selected_symbol.clone();

        // Backdrop + panel with centered overlay
        div()
            .id("quick-actions-overlay")
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(hsla(0.0, 0.0, 0.0, 0.6))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.quick_actions_state.is_expanded = false;
                cx.notify();
            }))
            .child(
                // Use the full panel render function from quick_actions module
                // Note: The render_quick_actions_full function expects simple Fn closures
                // for its callbacks. The buttons inside the panel handle their own clicks.
                crate::quick_actions::render_quick_actions_full(
                    theme,
                    &self.quick_actions_state,
                    current_symbol.as_deref(),
                    |_prompt: String| {
                        // Action callbacks are handled by the individual buttons inside
                        // the panel which use their own on_click handlers
                    },
                    || {
                        // Close callback - backdrop click handles this via on_click above
                    },
                ),
            )
    }

    /// Render symbol search modal
    fn render_symbol_search_modal(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let search_results = self.get_symbol_search_results();
        let selected_index = self.symbol_search_selected_index;

        // Backdrop + modal
        div()
            .id("symbol-search-modal")
            .absolute()
            .inset_0()
            .flex()
            .items_start()
            .justify_center()
            .pt(px(100.0))
            .bg(hsla(0.0, 0.0, 0.0, 0.6))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.close_modal(cx);
            }))
            .child(
                div()
                    .id("symbol-search-content")
                    .w(px(480.0))
                    .rounded(px(12.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .overflow_hidden()
                    // Prevent click propagation to backdrop
                    .on_click(|_event, _window, _cx| {})
                    // Header with search input
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
                                    .text_size(px(16.0))
                                    .text_color(theme.text_muted)
                                    .child("/"),
                            )
                            // Search input with cursor
                            .child(
                                div()
                                    .id("symbol-search-input")
                                    .flex_grow()
                                    .flex()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_size(px(15.0))
                                            .text_color(if self.symbol_search_query.is_empty() {
                                                theme.text_dimmed
                                            } else {
                                                theme.text
                                            })
                                            .child(if self.symbol_search_query.is_empty() {
                                                "Search symbols...".to_string()
                                            } else {
                                                self.symbol_search_query.clone()
                                            }),
                                    )
                                    // Cursor indicator
                                    .child(
                                        div().w(px(2.0)).h(px(18.0)).bg(theme.accent).ml(px(1.0)),
                                    )
                                    // Clear button
                                    .when(!self.symbol_search_query.is_empty(), |el| {
                                        el.child(self.render_clear_button(
                                            "clear-search-tooltip",
                                            |this, cx| {
                                                this.update_symbol_search_query(String::new(), cx);
                                            },
                                            cx,
                                        ))
                                    }),
                            )
                            // Clear button
                            .when(!self.symbol_search_query.is_empty(), |el| {
                                el.child(
                                    div()
                                        .id("clear-search-btn")
                                        .group("clear-search-group")
                                        .relative()
                                        .px(px(6.0))
                                        .py(px(2.0))
                                        .rounded(px(4.0))
                                        .cursor_pointer()
                                        .hover(|s| s.bg(theme.hover_bg))
                                        .on_click(cx.listener(|this, _event, _window, cx| {
                                            this.update_symbol_search_query(String::new(), cx);
                                        }))
                                        .child(
                                            div()
                                                .text_size(px(12.0))
                                                .text_color(theme.text_dimmed)
                                                .child("✕"),
                                        )
                                        .child(
                                            render_tooltip(
                                                theme,
                                                "Clear search",
                                                "clear-search-group",
                                            )
                                            .absolute()
                                            .top(px(24.0))
                                            .right(px(0.0)),
                                        ),
                                )
                            })
                            // Shortcut hint
                            .child(
                                div()
                                    .px(px(6.0))
                                    .py(px(2.0))
                                    .rounded(px(4.0))
                                    .bg(theme.hover_bg)
                                    .text_size(px(10.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Esc to close"),
                            ),
                    )
                    // Search results
                    .child(
                        div()
                            .id("symbol-search-results")
                            .max_h(px(320.0))
                            .overflow_y_scroll()
                            .children(search_results.iter().enumerate().map(
                                |(i, (symbol, name))| {
                                    let is_selected = i == selected_index;
                                    let symbol_str = (*symbol).to_string();
                                    let theme = &self.theme;

                                    div()
                                        .id(SharedString::from(format!("search-result-{}", i)))
                                        .px(px(16.0))
                                        .py(px(10.0))
                                        .flex()
                                        .items_center()
                                        .justify_between()
                                        .bg(if is_selected {
                                            theme.accent_subtle
                                        } else {
                                            transparent_black()
                                        })
                                        .border_l_2()
                                        .border_color(if is_selected {
                                            theme.accent
                                        } else {
                                            transparent_black()
                                        })
                                        .cursor_pointer()
                                        .hover(|s| s.bg(theme.hover_bg))
                                        .on_click(cx.listener(move |this, _event, _window, cx| {
                                            this.select_symbol(symbol_str.clone(), cx);
                                            this.close_modal(cx);
                                        }))
                                        // Symbol and company name
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(2.0))
                                                .child(
                                                    div()
                                                        .text_size(px(14.0))
                                                        .font_weight(FontWeight::SEMIBOLD)
                                                        .text_color(if is_selected {
                                                            theme.accent
                                                        } else {
                                                            theme.text
                                                        })
                                                        .child(symbol.to_string()),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(12.0))
                                                        .text_color(theme.text_muted)
                                                        .child(name.to_string()),
                                                ),
                                        )
                                        // Enter hint for selected item
                                        .when(is_selected, |el| {
                                            el.child(
                                                div()
                                                    .px(px(6.0))
                                                    .py(px(2.0))
                                                    .rounded(px(4.0))
                                                    .bg(theme.accent_subtle)
                                                    .text_size(px(10.0))
                                                    .text_color(theme.accent)
                                                    .child("Enter"),
                                            )
                                        })
                                },
                            )),
                    )
                    // Footer with navigation hints
                    .child(
                        div()
                            .px(px(16.0))
                            .py(px(10.0))
                            .border_t_1()
                            .border_color(theme.border_subtle)
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
                                            .flex()
                                            .items_center()
                                            .gap(px(4.0))
                                            .child(
                                                div()
                                                    .px(px(4.0))
                                                    .py(px(2.0))
                                                    .rounded(px(3.0))
                                                    .bg(theme.hover_bg)
                                                    .text_size(px(10.0))
                                                    .text_color(theme.text_muted)
                                                    .child("^"),
                                            )
                                            .child(
                                                div()
                                                    .px(px(4.0))
                                                    .py(px(2.0))
                                                    .rounded(px(3.0))
                                                    .bg(theme.hover_bg)
                                                    .text_size(px(10.0))
                                                    .text_color(theme.text_muted)
                                                    .child("v"),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_dimmed)
                                                    .child("navigate"),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(4.0))
                                            .child(
                                                div()
                                                    .px(px(4.0))
                                                    .py(px(2.0))
                                                    .rounded(px(3.0))
                                                    .bg(theme.hover_bg)
                                                    .text_size(px(10.0))
                                                    .text_color(theme.text_muted)
                                                    .child("Enter"),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.0))
                                                    .text_color(theme.text_dimmed)
                                                    .child("select"),
                                            ),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child(format!("{} symbols", search_results.len())),
                            ),
                    ),
            )
    }

    fn render_prediction_markets_search_modal(
        &self,
        kind: PredictionMarketKind,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = &self.theme;
        let filters = self.prediction_market_filters(kind);
        let modal_type = ModalType::PredictionMarketsSearch { kind };
        let modal_title = modal_type.title();

        div()
            .id("prediction-markets-search-modal")
            .absolute()
            .inset_0()
            .flex()
            .items_start()
            .justify_center()
            .pt(px(120.0))
            .bg(hsla(0.0, 0.0, 0.0, 0.6))
            .on_click(cx.listener(|this, _event, _window, cx| {
                this.close_modal(cx);
            }))
            .child(
                div()
                    .id("prediction-markets-search-content")
                    .w(px(520.0))
                    .rounded(px(12.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .overflow_hidden()
                    .on_click(|_event, _window, _cx| {})
                    .child(
                        div()
                            .px(px(18.0))
                            .py(px(14.0))
                            .border_b_1()
                            .border_color(theme.border_subtle)
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(px(16.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .child(modal_title.to_string()),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Enter to apply, Esc to close"),
                            ),
                    )
                    .child(
                        div()
                            .px(px(18.0))
                            .py(px(18.0))
                            .flex()
                            .items_center()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .text_size(px(16.0))
                                    .text_color(theme.text_muted)
                                    .child("/"),
                            )
                            .child(
                                div()
                                    .flex_grow()
                                    .text_size(px(15.0))
                                    .text_color(if filters.search_query.is_empty() {
                                        theme.text_dimmed
                                    } else {
                                        theme.text
                                    })
                                    .child(if filters.search_query.is_empty() {
                                        "Search markets...".to_string()
                                    } else {
                                        filters.search_query.clone()
                                    }),
                            )
                            .child(div().w(px(2.0)).h(px(18.0)).bg(theme.accent))
                            .when(!filters.search_query.is_empty(), |el| {
                                el.child(self.render_clear_button(
                                    "clear-pred-search-tooltip",
                                    move |this, cx| {
                                        this.update_prediction_markets_search_query(
                                            kind,
                                            String::new(),
                                            cx,
                                        );
                                    },
                                    cx,
                                ))
                            }),
                    ),
            )
    }
}
