//! Enhanced Dashboard View for Stanley GUI
//!
//! Provides a comprehensive dashboard with:
//! - Market overview bar (S&P 500, Nasdaq, VIX)
//! - Watchlist with real-time prices
//! - Portfolio snapshot card
//! - Quick signals preview
//! - Recent SEC filings ticker
//! - Auto-refresh capability

use crate::api::ZeeApiClient;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use std::sync::Arc;
use std::time::Duration;

// =============================================================================
// Loading State (re-exported for convenience)
// =============================================================================

/// Loading state for async data
#[derive(Debug, Clone, Default)]
pub enum LoadState<T> {
    #[default]
    NotLoaded,
    Loading,
    Loaded(T),
    Error(String),
}

impl<T> LoadState<T> {
    pub fn is_loading(&self) -> bool {
        matches!(self, LoadState::Loading)
    }

    pub fn is_loaded(&self) -> bool {
        matches!(self, LoadState::Loaded(_))
    }

    pub fn as_ref(&self) -> Option<&T> {
        match self {
            LoadState::Loaded(data) => Some(data),
            _ => None,
        }
    }
}

// =============================================================================
// Data Models
// =============================================================================

/// Watchlist item with price data
#[derive(Clone, Debug)]
pub struct WatchlistItem {
    pub symbol: String,
    pub price: f64,
    pub change: f64,
    pub change_pct: f64,
    pub volume: i64,
}

impl WatchlistItem {
    pub fn new(symbol: String) -> Self {
        Self {
            symbol,
            price: 0.0,
            change: 0.0,
            change_pct: 0.0,
            volume: 0,
        }
    }

    pub fn is_positive(&self) -> bool {
        self.change >= 0.0
    }
}

/// Portfolio snapshot with aggregate metrics
#[derive(Clone, Debug, Default)]
pub struct PortfolioSnapshot {
    pub total_value: f64,
    pub day_change: f64,
    pub day_change_pct: f64,
    pub total_return: f64,
    pub total_return_pct: f64,
    pub top_gainers: Vec<(String, f64)>,
    pub top_losers: Vec<(String, f64)>,
    pub cash_balance: f64,
    pub buying_power: f64,
}

impl PortfolioSnapshot {
    pub fn is_positive_day(&self) -> bool {
        self.day_change >= 0.0
    }

    pub fn is_positive_total(&self) -> bool {
        self.total_return >= 0.0
    }
}

/// Quick signal with action recommendation
#[derive(Clone, Debug)]
pub struct QuickSignal {
    pub symbol: String,
    pub signal_type: SignalType,
    pub confidence: f64,
    pub reason: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SignalType {
    Buy,
    Sell,
    Hold,
    Watch,
}

impl SignalType {
    pub fn label(&self) -> &'static str {
        match self {
            SignalType::Buy => "BUY",
            SignalType::Sell => "SELL",
            SignalType::Hold => "HOLD",
            SignalType::Watch => "WATCH",
        }
    }
}

/// Market index data for overview bar
#[derive(Clone, Debug, Default)]
pub struct MarketIndex {
    pub name: String,
    pub symbol: String,
    pub value: f64,
    pub change: f64,
    pub change_pct: f64,
}

impl MarketIndex {
    pub fn is_positive(&self) -> bool {
        self.change >= 0.0
    }
}

/// Market overview with major indices
#[derive(Clone, Debug, Default)]
pub struct MarketOverview {
    pub sp500: MarketIndex,
    pub nasdaq: MarketIndex,
    pub dow: MarketIndex,
    pub vix: MarketIndex,
    pub treasury_10y: MarketIndex,
    pub dollar_index: MarketIndex,
    pub last_updated: String,
}

/// Recent SEC filing
#[derive(Clone, Debug)]
pub struct RecentFiling {
    pub symbol: String,
    pub filing_type: String,
    pub description: String,
    pub filed_date: String,
    pub is_important: bool,
}

impl RecentFiling {
    pub fn type_label(&self) -> &str {
        match self.filing_type.as_str() {
            "10-K" => "Annual Report",
            "10-Q" => "Quarterly Report",
            "8-K" => "Current Report",
            "4" => "Insider Trade",
            "13F" => "Institutional Holdings",
            "SC 13D" | "SC 13G" => "Major Holder",
            "DEF 14A" => "Proxy Statement",
            _ => &self.filing_type,
        }
    }
}

// =============================================================================
// Dashboard View
// =============================================================================

/// Enhanced dashboard view with comprehensive market overview
pub struct DashboardView {
    // Data states
    watchlist: LoadState<Vec<WatchlistItem>>,
    portfolio_snapshot: LoadState<PortfolioSnapshot>,
    quick_signals: LoadState<Vec<QuickSignal>>,
    market_overview: LoadState<MarketOverview>,
    recent_filings: LoadState<Vec<RecentFiling>>,

    // Configuration
    watchlist_symbols: Vec<String>,
    api_client: Arc<ZeeApiClient>,
    theme: Theme,

    // Auto-refresh
    auto_refresh_enabled: bool,
    last_refresh: Option<std::time::Instant>,
    refresh_interval: Duration,
}

impl DashboardView {
    /// Create a new dashboard view
    pub fn new(api_client: Arc<ZeeApiClient>, theme: Theme) -> Self {
        let default_watchlist = vec![
            "AAPL".to_string(),
            "MSFT".to_string(),
            "GOOGL".to_string(),
            "AMZN".to_string(),
            "NVDA".to_string(),
            "META".to_string(),
            "TSLA".to_string(),
            "SPY".to_string(),
        ];

        Self {
            watchlist: LoadState::NotLoaded,
            portfolio_snapshot: LoadState::NotLoaded,
            quick_signals: LoadState::NotLoaded,
            market_overview: LoadState::NotLoaded,
            recent_filings: LoadState::NotLoaded,
            watchlist_symbols: default_watchlist,
            api_client,
            theme,
            auto_refresh_enabled: true,
            last_refresh: None,
            refresh_interval: Duration::from_secs(60),
        }
    }

    /// Initialize with custom watchlist
    pub fn with_watchlist(mut self, symbols: Vec<String>) -> Self {
        self.watchlist_symbols = symbols;
        self
    }

    /// Set auto-refresh interval
    pub fn with_refresh_interval(mut self, interval: Duration) -> Self {
        self.refresh_interval = interval;
        self
    }

    /// Refresh all dashboard data
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.last_refresh = Some(std::time::Instant::now());
        self.load_market_overview(cx);
        self.load_watchlist(cx);
        self.load_portfolio_snapshot(cx);
        self.load_quick_signals(cx);
        self.load_recent_filings(cx);
    }

    /// Load market overview data
    fn load_market_overview(&mut self, cx: &mut Context<Self>) {
        self.market_overview = LoadState::Loading;

        // For now, use mock data - in production this would call an API
        cx.spawn(async move |this, cx: &mut AsyncApp| {
            // Simulate API delay
            gpui::Timer::after(Duration::from_millis(100)).await;

            let overview = MarketOverview {
                sp500: MarketIndex {
                    name: "S&P 500".to_string(),
                    symbol: "SPX".to_string(),
                    value: 5021.84,
                    change: 45.23,
                    change_pct: 0.91,
                },
                nasdaq: MarketIndex {
                    name: "Nasdaq".to_string(),
                    symbol: "NDX".to_string(),
                    value: 17856.12,
                    change: 178.34,
                    change_pct: 1.01,
                },
                dow: MarketIndex {
                    name: "Dow Jones".to_string(),
                    symbol: "DJI".to_string(),
                    value: 38989.45,
                    change: 123.67,
                    change_pct: 0.32,
                },
                vix: MarketIndex {
                    name: "VIX".to_string(),
                    symbol: "VIX".to_string(),
                    value: 13.42,
                    change: -0.87,
                    change_pct: -6.09,
                },
                treasury_10y: MarketIndex {
                    name: "10Y Treasury".to_string(),
                    symbol: "TNX".to_string(),
                    value: 4.23,
                    change: 0.02,
                    change_pct: 0.48,
                },
                dollar_index: MarketIndex {
                    name: "Dollar Index".to_string(),
                    symbol: "DXY".to_string(),
                    value: 104.12,
                    change: -0.23,
                    change_pct: -0.22,
                },
                last_updated: format_timestamp(),
            };

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.market_overview = LoadState::Loaded(overview);
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load watchlist data from API
    fn load_watchlist(&mut self, cx: &mut Context<Self>) {
        self.watchlist = LoadState::Loading;
        let symbols = self.watchlist_symbols.clone();
        let client = self.api_client.clone();

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            let mut items = Vec::new();

            for symbol in &symbols {
                match client.get_market_data(symbol).await {
                    Ok(response) if response.success => {
                        if let Some(data) = response.data {
                            items.push(WatchlistItem {
                                symbol: data.symbol,
                                price: data.price,
                                change: data.change,
                                change_pct: data.change_percent,
                                volume: data.volume,
                            });
                        }
                    }
                    _ => {
                        // Use placeholder for failed requests
                        items.push(WatchlistItem::new(symbol.clone()));
                    }
                }
            }

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.watchlist = LoadState::Loaded(items);
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load portfolio snapshot
    fn load_portfolio_snapshot(&mut self, cx: &mut Context<Self>) {
        self.portfolio_snapshot = LoadState::Loading;

        // Mock data - would call portfolio API in production
        cx.spawn(async move |this, cx: &mut AsyncApp| {
            gpui::Timer::after(Duration::from_millis(150)).await;

            let snapshot = PortfolioSnapshot {
                total_value: 1_250_847.32,
                day_change: 8_234.56,
                day_change_pct: 0.66,
                total_return: 125_847.32,
                total_return_pct: 11.19,
                top_gainers: vec![
                    ("NVDA".to_string(), 4.23),
                    ("META".to_string(), 2.87),
                    ("AMZN".to_string(), 1.94),
                ],
                top_losers: vec![
                    ("TSLA".to_string(), -2.15),
                    ("AAPL".to_string(), -0.82),
                ],
                cash_balance: 45_000.00,
                buying_power: 90_000.00,
            };

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.portfolio_snapshot = LoadState::Loaded(snapshot);
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load quick signals
    fn load_quick_signals(&mut self, cx: &mut Context<Self>) {
        self.quick_signals = LoadState::Loading;

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            gpui::Timer::after(Duration::from_millis(200)).await;

            let signals = vec![
                QuickSignal {
                    symbol: "NVDA".to_string(),
                    signal_type: SignalType::Buy,
                    confidence: 0.87,
                    reason: "Strong institutional accumulation, positive momentum".to_string(),
                    timestamp: "10m ago".to_string(),
                },
                QuickSignal {
                    symbol: "AAPL".to_string(),
                    signal_type: SignalType::Hold,
                    confidence: 0.72,
                    reason: "Fair valuation, awaiting earnings catalyst".to_string(),
                    timestamp: "25m ago".to_string(),
                },
                QuickSignal {
                    symbol: "TSLA".to_string(),
                    signal_type: SignalType::Watch,
                    confidence: 0.65,
                    reason: "High volatility, mixed signals from options flow".to_string(),
                    timestamp: "1h ago".to_string(),
                },
                QuickSignal {
                    symbol: "META".to_string(),
                    signal_type: SignalType::Buy,
                    confidence: 0.81,
                    reason: "Undervalued vs peers, strong free cash flow".to_string(),
                    timestamp: "2h ago".to_string(),
                },
            ];

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.quick_signals = LoadState::Loaded(signals);
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Load recent SEC filings
    fn load_recent_filings(&mut self, cx: &mut Context<Self>) {
        self.recent_filings = LoadState::Loading;

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            gpui::Timer::after(Duration::from_millis(180)).await;

            let filings = vec![
                RecentFiling {
                    symbol: "AAPL".to_string(),
                    filing_type: "8-K".to_string(),
                    description: "Entry into Material Agreement".to_string(),
                    filed_date: "Today".to_string(),
                    is_important: true,
                },
                RecentFiling {
                    symbol: "MSFT".to_string(),
                    filing_type: "4".to_string(),
                    description: "Satya Nadella sold 5,000 shares".to_string(),
                    filed_date: "Today".to_string(),
                    is_important: false,
                },
                RecentFiling {
                    symbol: "NVDA".to_string(),
                    filing_type: "13F".to_string(),
                    description: "Vanguard increased position by 2.3%".to_string(),
                    filed_date: "Yesterday".to_string(),
                    is_important: true,
                },
                RecentFiling {
                    symbol: "GOOGL".to_string(),
                    filing_type: "10-Q".to_string(),
                    description: "Q4 2024 Quarterly Report".to_string(),
                    filed_date: "2 days ago".to_string(),
                    is_important: false,
                },
                RecentFiling {
                    symbol: "AMZN".to_string(),
                    filing_type: "SC 13G".to_string(),
                    description: "BlackRock reports 6.8% ownership".to_string(),
                    filed_date: "3 days ago".to_string(),
                    is_important: true,
                },
            ];

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.recent_filings = LoadState::Loaded(filings);
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// Toggle auto-refresh
    pub fn toggle_auto_refresh(&mut self) {
        self.auto_refresh_enabled = !self.auto_refresh_enabled;
    }

    /// Add symbol to watchlist
    pub fn add_to_watchlist(&mut self, symbol: String, cx: &mut Context<Self>) {
        if !self.watchlist_symbols.contains(&symbol) {
            self.watchlist_symbols.push(symbol);
            self.load_watchlist(cx);
        }
    }

    /// Remove symbol from watchlist
    pub fn remove_from_watchlist(&mut self, symbol: &str, cx: &mut Context<Self>) {
        if let Some(pos) = self.watchlist_symbols.iter().position(|s| s == symbol) {
            self.watchlist_symbols.remove(pos);
            self.load_watchlist(cx);
        }
    }
}

// =============================================================================
// Render Implementation
// =============================================================================

impl Render for DashboardView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(theme.background)
            // Market overview bar at top
            .child(self.render_market_overview(cx))
            // Main content grid
            .child(
                div()
                    .flex_grow()
                    .p(px(20.0))
                    .flex()
                    .flex_col()
                    .gap(px(16.0))
                    // Top row: Portfolio + Quick Signals
                    .child(
                        div()
                            .flex()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .flex_1()
                                    .child(self.render_portfolio_snapshot())
                            )
                            .child(
                                div()
                                    .w(px(320.0))
                                    .child(self.render_quick_signals())
                            )
                    )
                    // Bottom row: Watchlist + Recent Filings
                    .child(
                        div()
                            .flex_grow()
                            .flex()
                            .gap(px(16.0))
                            .child(
                                div()
                                    .flex_1()
                                    .child(self.render_watchlist())
                            )
                            .child(
                                div()
                                    .w(px(400.0))
                                    .child(self.render_recent_filings())
                            )
                    )
            )
    }
}

impl DashboardView {
    // =========================================================================
    // Market Overview Bar
    // =========================================================================

    fn render_market_overview(&self, cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        match &self.market_overview {
            LoadState::Loading => {
                div()
                    .h(px(48.0))
                    .px(px(20.0))
                    .bg(theme.card_bg)
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.text_dimmed)
                            .child("Loading market data...")
                    )
            }
            LoadState::Loaded(overview) => {
                div()
                    .h(px(48.0))
                    .px(px(20.0))
                    .bg(theme.card_bg)
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .flex()
                    .items_center()
                    .gap(px(24.0))
                    // Indices
                    .child(self.render_index_chip(&overview.sp500))
                    .child(self.render_index_chip(&overview.nasdaq))
                    .child(self.render_index_chip(&overview.dow))
                    // Separator
                    .child(
                        div()
                            .w(px(1.0))
                            .h(px(24.0))
                            .bg(theme.border_subtle)
                    )
                    // VIX
                    .child(self.render_index_chip(&overview.vix))
                    // Separator
                    .child(
                        div()
                            .w(px(1.0))
                            .h(px(24.0))
                            .bg(theme.border_subtle)
                    )
                    // Treasury & Dollar
                    .child(self.render_index_chip(&overview.treasury_10y))
                    .child(self.render_index_chip(&overview.dollar_index))
                    // Spacer
                    .child(div().flex_grow())
                    // Last updated
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.text_dimmed)
                            .child(format!("Updated: {}", overview.last_updated))
                    )
                    // Refresh button
                    .child(
                        div()
                            .h(px(28.0))
                            .px(px(8.0))
                            .rounded(px(4.0))
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.hover_bg))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(12.0))
                            .text_color(theme.text_muted)
                            .child("Refresh")
                            .on_click(cx.listener(|this, _, cx| {
                                this.refresh(cx);
                            }))
                    )
            }
            LoadState::Error(e) => {
                div()
                    .h(px(48.0))
                    .px(px(20.0))
                    .bg(theme.negative_subtle)
                    .border_b_1()
                    .border_color(theme.negative_muted)
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.negative)
                            .child(format!("Failed to load market data: {}", e))
                    )
            }
            LoadState::NotLoaded => {
                div()
                    .h(px(48.0))
                    .px(px(20.0))
                    .bg(theme.card_bg)
                    .border_b_1()
                    .border_color(theme.border_subtle)
            }
        }
    }

    fn render_index_chip(&self, index: &MarketIndex) -> Div {
        let theme = &self.theme;
        let color = if index.is_positive() {
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
                    .text_color(theme.text_muted)
                    .child(index.name.clone())
            )
            .child(
                div()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.text)
                    .child(format_value(index.value, &index.symbol))
            )
            .child(
                div()
                    .px(px(6.0))
                    .py(px(2.0))
                    .rounded(px(4.0))
                    .bg(color.opacity(0.15))
                    .text_size(px(10.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(color)
                    .child(format!("{:+.2}%", index.change_pct))
            )
    }

    // =========================================================================
    // Portfolio Snapshot Card
    // =========================================================================

    fn render_portfolio_snapshot(&self) -> Div {
        let theme = &self.theme;

        self.card(
            "Portfolio Snapshot",
            match &self.portfolio_snapshot {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(snapshot) => {
                    let day_color = if snapshot.is_positive_day() {
                        theme.positive
                    } else {
                        theme.negative
                    };
                    let total_color = if snapshot.is_positive_total() {
                        theme.positive
                    } else {
                        theme.negative
                    };

                    div()
                        .flex()
                        .flex_col()
                        .gap(px(16.0))
                        // Main metrics row
                        .child(
                            div()
                                .flex()
                                .gap(px(20.0))
                                // Total value
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.0))
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child("Total Value")
                                        )
                                        .child(
                                            div()
                                                .text_size(px(28.0))
                                                .font_weight(FontWeight::BOLD)
                                                .text_color(theme.text)
                                                .child(format_currency(snapshot.total_value))
                                        )
                                )
                                // Day change
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.0))
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child("Today")
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(8.0))
                                                .child(
                                                    div()
                                                        .text_size(px(20.0))
                                                        .font_weight(FontWeight::SEMIBOLD)
                                                        .text_color(day_color)
                                                        .child(format!("{:+}", format_currency(snapshot.day_change)))
                                                )
                                                .child(
                                                    div()
                                                        .px(px(8.0))
                                                        .py(px(4.0))
                                                        .rounded(px(4.0))
                                                        .bg(day_color.opacity(0.15))
                                                        .text_size(px(12.0))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(day_color)
                                                        .child(format!("{:+.2}%", snapshot.day_change_pct))
                                                )
                                        )
                                )
                                // Total return
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.0))
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child("Total Return")
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(8.0))
                                                .child(
                                                    div()
                                                        .text_size(px(20.0))
                                                        .font_weight(FontWeight::SEMIBOLD)
                                                        .text_color(total_color)
                                                        .child(format!("{:+}", format_currency(snapshot.total_return)))
                                                )
                                                .child(
                                                    div()
                                                        .px(px(8.0))
                                                        .py(px(4.0))
                                                        .rounded(px(4.0))
                                                        .bg(total_color.opacity(0.15))
                                                        .text_size(px(12.0))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(total_color)
                                                        .child(format!("{:+.2}%", snapshot.total_return_pct))
                                                )
                                        )
                                )
                        )
                        // Divider
                        .child(
                            div()
                                .h(px(1.0))
                                .bg(theme.border_subtle)
                        )
                        // Bottom row: Gainers/Losers + Cash
                        .child(
                            div()
                                .flex()
                                .gap(px(24.0))
                                // Top gainers
                                .child(
                                    div()
                                        .flex_1()
                                        .flex()
                                        .flex_col()
                                        .gap(px(8.0))
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child("Top Gainers")
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .gap(px(12.0))
                                                .children(
                                                    snapshot.top_gainers.iter().map(|(sym, pct)| {
                                                        div()
                                                            .flex()
                                                            .items_center()
                                                            .gap(px(6.0))
                                                            .child(
                                                                div()
                                                                    .text_size(px(12.0))
                                                                    .font_weight(FontWeight::MEDIUM)
                                                                    .text_color(theme.text)
                                                                    .child(sym.clone())
                                                            )
                                                            .child(
                                                                div()
                                                                    .text_size(px(11.0))
                                                                    .text_color(theme.positive)
                                                                    .child(format!("+{:.1}%", pct))
                                                            )
                                                    }).collect::<Vec<_>>()
                                                )
                                        )
                                )
                                // Top losers
                                .child(
                                    div()
                                        .flex_1()
                                        .flex()
                                        .flex_col()
                                        .gap(px(8.0))
                                        .child(
                                            div()
                                                .text_size(px(11.0))
                                                .text_color(theme.text_dimmed)
                                                .child("Top Losers")
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .gap(px(12.0))
                                                .children(
                                                    snapshot.top_losers.iter().map(|(sym, pct)| {
                                                        div()
                                                            .flex()
                                                            .items_center()
                                                            .gap(px(6.0))
                                                            .child(
                                                                div()
                                                                    .text_size(px(12.0))
                                                                    .font_weight(FontWeight::MEDIUM)
                                                                    .text_color(theme.text)
                                                                    .child(sym.clone())
                                                            )
                                                            .child(
                                                                div()
                                                                    .text_size(px(11.0))
                                                                    .text_color(theme.negative)
                                                                    .child(format!("{:.1}%", pct))
                                                            )
                                                    }).collect::<Vec<_>>()
                                                )
                                        )
                                )
                                // Cash/Buying power
                                .child(
                                    div()
                                        .flex()
                                        .gap(px(16.0))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(4.0))
                                                .child(
                                                    div()
                                                        .text_size(px(11.0))
                                                        .text_color(theme.text_dimmed)
                                                        .child("Cash")
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(14.0))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(theme.text)
                                                        .child(format_currency(snapshot.cash_balance))
                                                )
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(4.0))
                                                .child(
                                                    div()
                                                        .text_size(px(11.0))
                                                        .text_color(theme.text_dimmed)
                                                        .child("Buying Power")
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(14.0))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(theme.accent)
                                                        .child(format_currency(snapshot.buying_power))
                                                )
                                        )
                                )
                        )
                }
                LoadState::NotLoaded => {
                    div()
                        .py(px(40.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(theme.text_dimmed)
                                .child("No portfolio data")
                        )
                }
            },
        )
    }

    // =========================================================================
    // Quick Signals Widget
    // =========================================================================

    fn render_quick_signals(&self) -> Div {
        let theme = &self.theme;

        self.card(
            "Active Signals",
            match &self.quick_signals {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(signals) => {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.0))
                        .children(
                            signals.iter().map(|signal| {
                                let signal_color = match signal.signal_type {
                                    SignalType::Buy => theme.positive,
                                    SignalType::Sell => theme.negative,
                                    SignalType::Hold => theme.warning,
                                    SignalType::Watch => theme.accent,
                                };

                                div()
                                    .p(px(12.0))
                                    .rounded(px(6.0))
                                    .bg(theme.card_bg_elevated)
                                    .cursor_pointer()
                                    .hover(|s| s.bg(theme.hover_bg))
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
                                                    .flex()
                                                    .items_center()
                                                    .gap(px(8.0))
                                                    .child(
                                                        div()
                                                            .text_size(px(14.0))
                                                            .font_weight(FontWeight::BOLD)
                                                            .text_color(theme.text)
                                                            .child(signal.symbol.clone())
                                                    )
                                                    .child(
                                                        div()
                                                            .px(px(8.0))
                                                            .py(px(3.0))
                                                            .rounded(px(4.0))
                                                            .bg(signal_color.opacity(0.15))
                                                            .text_size(px(10.0))
                                                            .font_weight(FontWeight::BOLD)
                                                            .text_color(signal_color)
                                                            .child(signal.signal_type.label())
                                                    )
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(10.0))
                                                    .text_color(theme.text_dimmed)
                                                    .child(signal.timestamp.clone())
                                            )
                                    )
                                    // Reason
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(theme.text_muted)
                                            .child(signal.reason.clone())
                                    )
                                    // Confidence bar
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(8.0))
                                            .child(
                                                div()
                                                    .text_size(px(10.0))
                                                    .text_color(theme.text_dimmed)
                                                    .child("Confidence")
                                            )
                                            .child(
                                                div()
                                                    .flex_grow()
                                                    .h(px(4.0))
                                                    .rounded(px(2.0))
                                                    .bg(theme.border_subtle)
                                                    .child(
                                                        div()
                                                            .h_full()
                                                            .w(px(signal.confidence as f32 * 100.0))
                                                            .rounded(px(2.0))
                                                            .bg(signal_color)
                                                    )
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(10.0))
                                                    .font_weight(FontWeight::MEDIUM)
                                                    .text_color(theme.text_secondary)
                                                    .child(format!("{:.0}%", signal.confidence * 100.0))
                                            )
                                    )
                            }).collect::<Vec<_>>()
                        )
                }
                LoadState::NotLoaded => {
                    div()
                        .py(px(40.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(theme.text_dimmed)
                                .child("No active signals")
                        )
                }
            },
        )
    }

    // =========================================================================
    // Watchlist Widget
    // =========================================================================

    fn render_watchlist(&self) -> Div {
        let theme = &self.theme;

        self.card(
            "Watchlist",
            match &self.watchlist {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(items) => {
                    div()
                        .flex()
                        .flex_col()
                        // Header row
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .px(px(12.0))
                                .py(px(8.0))
                                .border_b_1()
                                .border_color(theme.border_subtle)
                                .child(
                                    div()
                                        .w(px(80.0))
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text_dimmed)
                                        .child("SYMBOL")
                                )
                                .child(
                                    div()
                                        .flex_1()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text_dimmed)
                                        .text_align(gpui::TextAlign::Right)
                                        .child("PRICE")
                                )
                                .child(
                                    div()
                                        .w(px(100.0))
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text_dimmed)
                                        .text_align(gpui::TextAlign::Right)
                                        .child("CHANGE")
                                )
                                .child(
                                    div()
                                        .w(px(100.0))
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text_dimmed)
                                        .text_align(gpui::TextAlign::Right)
                                        .child("VOLUME")
                                )
                        )
                        // Data rows
                        .children(
                            items.iter().map(|item| {
                                let color = if item.is_positive() {
                                    theme.positive
                                } else {
                                    theme.negative
                                };

                                div()
                                    .flex()
                                    .items_center()
                                    .px(px(12.0))
                                    .py(px(10.0))
                                    .border_b_1()
                                    .border_color(theme.border_subtle)
                                    .cursor_pointer()
                                    .hover(|s| s.bg(theme.hover_bg))
                                    // Symbol
                                    .child(
                                        div()
                                            .w(px(80.0))
                                            .flex()
                                            .items_center()
                                            .gap(px(8.0))
                                            .child(
                                                div()
                                                    .size(px(28.0))
                                                    .rounded(px(6.0))
                                                    .bg(theme.accent_subtle)
                                                    .flex()
                                                    .items_center()
                                                    .justify_center()
                                                    .text_size(px(10.0))
                                                    .font_weight(FontWeight::BOLD)
                                                    .text_color(theme.accent)
                                                    .child(item.symbol.chars().next().unwrap_or('?').to_string())
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(13.0))
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .text_color(theme.text)
                                                    .child(item.symbol.clone())
                                            )
                                    )
                                    // Price
                                    .child(
                                        div()
                                            .flex_1()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.text)
                                            .text_align(gpui::TextAlign::Right)
                                            .child(format!("${:.2}", item.price))
                                    )
                                    // Change
                                    .child(
                                        div()
                                            .w(px(100.0))
                                            .flex()
                                            .justify_end()
                                            .child(
                                                div()
                                                    .px(px(8.0))
                                                    .py(px(4.0))
                                                    .rounded(px(4.0))
                                                    .bg(color.opacity(0.15))
                                                    .text_size(px(12.0))
                                                    .font_weight(FontWeight::MEDIUM)
                                                    .text_color(color)
                                                    .child(format!("{:+.2}%", item.change_pct))
                                            )
                                    )
                                    // Volume
                                    .child(
                                        div()
                                            .w(px(100.0))
                                            .text_size(px(12.0))
                                            .text_color(theme.text_muted)
                                            .text_align(gpui::TextAlign::Right)
                                            .child(format_volume(item.volume))
                                    )
                            }).collect::<Vec<_>>()
                        )
                }
                LoadState::NotLoaded => {
                    div()
                        .py(px(40.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(theme.text_dimmed)
                                .child("No watchlist data")
                        )
                }
            },
        )
    }

    // =========================================================================
    // Recent Filings Widget
    // =========================================================================

    fn render_recent_filings(&self) -> Div {
        let theme = &self.theme;

        self.card(
            "Recent SEC Filings",
            match &self.recent_filings {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(filings) => {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .children(
                            filings.iter().map(|filing| {
                                let type_color = match filing.filing_type.as_str() {
                                    "10-K" | "10-Q" => theme.accent,
                                    "8-K" => theme.warning,
                                    "4" | "SC 13D" | "SC 13G" | "13F" => theme.positive,
                                    _ => theme.text_muted,
                                };

                                div()
                                    .py(px(10.0))
                                    .px(px(12.0))
                                    .border_b_1()
                                    .border_color(theme.border_subtle)
                                    .cursor_pointer()
                                    .hover(|s| s.bg(theme.hover_bg))
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.0))
                                    // Top row: Symbol + Type + Date
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(8.0))
                                            .child(
                                                div()
                                                    .text_size(px(13.0))
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .text_color(theme.text)
                                                    .child(filing.symbol.clone())
                                            )
                                            .child(
                                                div()
                                                    .px(px(6.0))
                                                    .py(px(2.0))
                                                    .rounded(px(4.0))
                                                    .bg(type_color.opacity(0.15))
                                                    .text_size(px(10.0))
                                                    .font_weight(FontWeight::BOLD)
                                                    .text_color(type_color)
                                                    .child(filing.filing_type.clone())
                                            )
                                            .when(filing.is_important, |el| {
                                                el.child(
                                                    div()
                                                        .size(px(6.0))
                                                        .rounded_full()
                                                        .bg(theme.warning)
                                                )
                                            })
                                            .child(div().flex_grow())
                                            .child(
                                                div()
                                                    .text_size(px(10.0))
                                                    .text_color(theme.text_dimmed)
                                                    .child(filing.filed_date.clone())
                                            )
                                    )
                                    // Description
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(theme.text_muted)
                                            .child(filing.description.clone())
                                    )
                            }).collect::<Vec<_>>()
                        )
                }
                LoadState::NotLoaded => {
                    div()
                        .py(px(40.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(theme.text_dimmed)
                                .child("No recent filings")
                        )
                }
            },
        )
    }

    // =========================================================================
    // Helper Components
    // =========================================================================

    fn card(&self, title: &str, content: Div) -> Div {
        let theme = &self.theme;

        div()
            .h_full()
            .rounded(px(10.0))
            .bg(theme.card_bg)
            .border_1()
            .border_color(theme.border)
            .flex()
            .flex_col()
            .overflow_hidden()
            // Header
            .child(
                div()
                    .px(px(16.0))
                    .py(px(12.0))
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .child(title.to_string())
                    )
            )
            // Content
            .child(
                div()
                    .id("main-content-scroll")
                    .flex_grow()
                    .overflow_y_scroll()
                    .child(content)
            )
    }

    fn loading_indicator(&self) -> Div {
        let theme = &self.theme;

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

    fn error_message(&self, msg: &str) -> Div {
        let theme = &self.theme;

        div()
            .m(px(16.0))
            .p(px(16.0))
            .rounded(px(6.0))
            .bg(theme.negative_subtle)
            .text_size(px(12.0))
            .text_color(theme.negative)
            .child(msg.to_string())
    }
}

// =============================================================================
// Formatting Helpers
// =============================================================================

fn format_currency(n: f64) -> String {
    if n.abs() >= 1_000_000_000.0 {
        format!("${:.2}B", n / 1_000_000_000.0)
    } else if n.abs() >= 1_000_000.0 {
        format!("${:.2}M", n / 1_000_000.0)
    } else if n.abs() >= 1_000.0 {
        // Format with thousands separator manually
        let int_part = n as i64;
        let formatted = format_with_commas(int_part);
        format!("${}", formatted)
    } else {
        format!("${:.2}", n)
    }
}

fn format_with_commas(n: i64) -> String {
    let s = n.abs().to_string();
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(*c);
    }
    if n < 0 {
        format!("-{}", result)
    } else {
        result
    }
}

fn format_volume(n: i64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.1}B", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}K", n as f64 / 1_000.0)
    } else {
        format!("{}", n)
    }
}

fn format_value(value: f64, symbol: &str) -> String {
    match symbol {
        "VIX" => format!("{:.2}", value),
        "TNX" => format!("{:.2}%", value),
        "DXY" => format!("{:.2}", value),
        _ => {
            // Format with thousands separator manually
            let int_part = value as i64;
            let frac = (value.fract().abs() * 100.0).round() as i64;
            let formatted_int = format_with_commas(int_part);
            format!("{}.{:02}", formatted_int, frac)
        }
    }
}

fn format_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let hours = (secs / 3600) % 24;
    let minutes = (secs / 60) % 60;
    let seconds = secs % 60;
    format!("{:02}:{:02}:{:02} UTC", hours, minutes, seconds)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_watchlist_item_positive() {
        let item = WatchlistItem {
            symbol: "AAPL".to_string(),
            price: 185.50,
            change: 2.50,
            change_pct: 1.37,
            volume: 45_000_000,
        };
        assert!(item.is_positive());
    }

    #[test]
    fn test_watchlist_item_negative() {
        let item = WatchlistItem {
            symbol: "TSLA".to_string(),
            price: 242.30,
            change: -5.20,
            change_pct: -2.10,
            volume: 80_000_000,
        };
        assert!(!item.is_positive());
    }

    #[test]
    fn test_signal_type_labels() {
        assert_eq!(SignalType::Buy.label(), "BUY");
        assert_eq!(SignalType::Sell.label(), "SELL");
        assert_eq!(SignalType::Hold.label(), "HOLD");
        assert_eq!(SignalType::Watch.label(), "WATCH");
    }

    #[test]
    fn test_format_currency() {
        assert_eq!(format_currency(1_250_847.32), "$1,250,847");
        assert_eq!(format_currency(5_000_000_000.0), "$5.00B");
        assert_eq!(format_currency(2_500_000.0), "$2.50M");
        assert_eq!(format_currency(500.0), "$500.00");
    }

    #[test]
    fn test_format_volume() {
        assert_eq!(format_volume(45_000_000), "45.0M");
        assert_eq!(format_volume(1_500_000_000), "1.5B");
        assert_eq!(format_volume(500_000), "500.0K");
        assert_eq!(format_volume(500), "500");
    }
}
