//! Macro View for Stanley GUI
//!
//! Displays economic indicators, market regime, yield curve, and recession probability.
//! Provides a comprehensive macro-economic dashboard for investment analysis.

use crate::api::ZeeApiClient;
use crate::app::LoadState;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{de::DeserializeOwned, Deserialize};
use std::sync::Arc;

// =============================================================================
// Data Types
// =============================================================================

/// Market regime classification
#[derive(Clone, Debug, PartialEq, Default)]
pub enum MarketRegime {
    #[default]
    RiskOn,
    RiskOff,
    Transition,
    Crisis,
    Goldilocks,
    Reflation,
    Stagflation,
    Deflation,
}

impl MarketRegime {
    /// Get color for regime indicator
    pub fn color(&self) -> Hsla {
        match self {
            MarketRegime::RiskOn | MarketRegime::Goldilocks => {
                hsla(152.0 / 360.0, 0.72, 0.48, 1.0) // Green
            }
            MarketRegime::RiskOff | MarketRegime::Deflation => {
                hsla(4.0 / 360.0, 0.75, 0.55, 1.0) // Red
            }
            MarketRegime::Transition | MarketRegime::Reflation => {
                hsla(40.0 / 360.0, 0.92, 0.52, 1.0) // Orange/Yellow
            }
            MarketRegime::Crisis | MarketRegime::Stagflation => {
                hsla(4.0 / 360.0, 0.90, 0.40, 1.0) // Dark red
            }
        }
    }

    /// Get display name for regime
    pub fn display_name(&self) -> &'static str {
        match self {
            MarketRegime::RiskOn => "RISK ON",
            MarketRegime::RiskOff => "RISK OFF",
            MarketRegime::Transition => "TRANSITION",
            MarketRegime::Crisis => "CRISIS",
            MarketRegime::Goldilocks => "GOLDILOCKS",
            MarketRegime::Reflation => "REFLATION",
            MarketRegime::Stagflation => "STAGFLATION",
            MarketRegime::Deflation => "DEFLATION",
        }
    }

    /// Parse from API string
    pub fn from_api_string(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "risk_on" | "riskon" => MarketRegime::RiskOn,
            "risk_off" | "riskoff" => MarketRegime::RiskOff,
            "transition" | "transitioning" => MarketRegime::Transition,
            "crisis" => MarketRegime::Crisis,
            "goldilocks" => MarketRegime::Goldilocks,
            "reflation" => MarketRegime::Reflation,
            "stagflation" => MarketRegime::Stagflation,
            "deflation" => MarketRegime::Deflation,
            _ => MarketRegime::Transition,
        }
    }
}

/// Single economic indicator
#[derive(Clone, Debug)]
pub struct EconomicIndicator {
    pub name: String,
    pub code: String,
    pub value: f64,
    pub previous: Option<f64>,
    pub change: Option<f64>,
    pub unit: String,
    pub trend: IndicatorTrend,
}

/// Trend direction for indicator
#[derive(Clone, Debug, PartialEq, Default)]
pub enum IndicatorTrend {
    Improving,
    #[default]
    Stable,
    Deteriorating,
}

impl IndicatorTrend {
    pub fn from_change(change: Option<f64>, is_higher_better: bool) -> Self {
        match change {
            Some(c) if c.abs() < 0.01 => IndicatorTrend::Stable,
            Some(c) if (c > 0.0) == is_higher_better => IndicatorTrend::Improving,
            Some(_) => IndicatorTrend::Deteriorating,
            None => IndicatorTrend::Stable,
        }
    }
}

/// Yield curve data point
#[derive(Clone, Debug)]
pub struct YieldCurvePoint {
    pub maturity: String,
    pub yield_value: f64,
    pub change: Option<f64>,
}

/// Regime analysis with positioning
#[derive(Clone, Debug)]
pub struct RegimeAnalysis {
    pub current_regime: MarketRegime,
    pub confidence: f64,
    pub regime_score: f64,
    pub positioning: RegimePositioning,
    pub signals: Vec<(String, f64)>,
    pub regime_duration_days: i32,
}

/// Asset class positioning recommendations
#[derive(Clone, Debug, Default)]
pub struct RegimePositioning {
    pub equity: String,
    pub duration: String,
    pub credit: String,
    pub volatility: String,
}

/// Recession risk data
#[derive(Clone, Debug)]
pub struct RecessionData {
    pub probability_12m: f64,
    pub probability_6m: f64,
    pub risk_level: String,
    pub risk_score: f64,
    pub factors: Vec<RecessionFactor>,
}

/// Individual recession risk factor
#[derive(Clone, Debug)]
pub struct RecessionFactor {
    pub name: String,
    pub severity: String,
    pub description: String,
    pub contribution: f64,
}

// =============================================================================
// API Response Types
// =============================================================================

#[derive(Debug, Deserialize, Clone)]
pub struct IndicatorsApiResponse {
    pub country: String,
    pub indicators: Vec<IndicatorApiData>,
    pub snapshot: Option<SnapshotApiData>,
    pub timestamp: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct IndicatorApiData {
    pub code: String,
    pub name: String,
    pub value: f64,
    #[serde(rename = "previousValue", alias = "previous_value")]
    pub previous_value: Option<f64>,
    pub change: Option<f64>,
    pub unit: String,
    pub frequency: String,
    #[serde(rename = "lastUpdate", alias = "last_update")]
    pub last_update: String,
    pub source: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SnapshotApiData {
    pub country: String,
    #[serde(rename = "gdpGrowth", alias = "gdp_growth")]
    pub gdp_growth: Option<f64>,
    pub inflation: Option<f64>,
    pub unemployment: Option<f64>,
    #[serde(rename = "policyRate", alias = "policy_rate")]
    pub policy_rate: Option<f64>,
    #[serde(rename = "currentAccount", alias = "current_account")]
    pub current_account: Option<f64>,
    pub regime: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RegimeApiResponse {
    #[serde(rename = "currentRegime", alias = "current_regime")]
    pub current_regime: String,
    pub confidence: String,
    #[serde(rename = "regimeScore", alias = "regime_score")]
    pub regime_score: f64,
    pub components: std::collections::HashMap<String, String>,
    pub metrics: std::collections::HashMap<String, Option<f64>>,
    pub positioning: PositioningApiData,
    pub signals: Vec<SignalApiData>,
    #[serde(rename = "regimeDurationDays", alias = "regime_duration_days")]
    pub regime_duration_days: i32,
    pub timestamp: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PositioningApiData {
    pub equity: String,
    pub duration: String,
    pub credit: String,
    pub volatility: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SignalApiData {
    pub source: String,
    pub signal: String,
    pub strength: f64,
    pub confidence: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct YieldCurveApiResponse {
    pub country: String,
    pub shape: String,
    #[serde(rename = "spread2y10y", alias = "spread_2y10y")]
    pub spread_2y10y: Option<f64>,
    #[serde(rename = "spread3m10y", alias = "spread_3m10y")]
    pub spread_3m10y: Option<f64>,
    #[serde(rename = "recessionSignal", alias = "recession_signal")]
    pub recession_signal: String,
    #[serde(
        rename = "recessionProbability12m",
        alias = "recession_probability_12m"
    )]
    pub recession_probability_12m: Option<f64>,
    #[serde(rename = "inversionDurationDays", alias = "inversion_duration_days")]
    pub inversion_duration_days: i32,
    pub curve: Vec<YieldPointApiData>,
    pub dynamic: String,
    pub timestamp: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct YieldPointApiData {
    pub tenor: String,
    #[serde(rename = "yield", alias = "yield_pct")]
    pub yield_pct: f64,
    #[serde(rename = "priorYield", alias = "prior_yield")]
    pub prior_yield: Option<f64>,
    pub change: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RecessionApiResponse {
    pub country: String,
    #[serde(rename = "probability12m", alias = "probability_12m")]
    pub probability_12m: f64,
    #[serde(rename = "probability6m", alias = "probability_6m")]
    pub probability_6m: f64,
    #[serde(rename = "riskLevel", alias = "risk_level")]
    pub risk_level: String,
    #[serde(rename = "riskScore", alias = "risk_score")]
    pub risk_score: f64,
    pub factors: Vec<RecessionFactorApiData>,
    #[serde(rename = "modelVersion", alias = "model_version")]
    pub model_version: String,
    pub confidence: f64,
    pub timestamp: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RecessionFactorApiData {
    pub factor: String,
    pub severity: String,
    pub description: String,
    pub contribution: f64,
}

// =============================================================================
// API Helper Functions
// =============================================================================

async fn fetch_macro_payload<T: DeserializeOwned>(
    api_client: &ZeeApiClient,
    path: String,
) -> Result<T, String> {
    let api_response = api_client
        .get_enveloped::<T>(&path)
        .await
        .map_err(|e| e.to_string())?;

    if api_response.success {
        api_response.data.ok_or_else(|| "No data".to_string())
    } else {
        Err(api_response
            .error
            .unwrap_or_else(|| "Unknown error".to_string()))
    }
}

/// Fetch macro indicators from API
pub async fn fetch_macro_indicators(
    api_client: &ZeeApiClient,
    country: &str,
) -> Result<IndicatorsApiResponse, String> {
    fetch_macro_payload(
        api_client,
        format!("/api/macro/indicators?country={country}"),
    )
    .await
}

/// Fetch market regime from API
pub async fn fetch_macro_regime(
    api_client: &ZeeApiClient,
    country: &str,
) -> Result<RegimeApiResponse, String> {
    fetch_macro_payload(api_client, format!("/api/macro/regime?country={country}")).await
}

/// Fetch yield curve from API
pub async fn fetch_yield_curve(
    api_client: &ZeeApiClient,
    country: &str,
) -> Result<YieldCurveApiResponse, String> {
    fetch_macro_payload(
        api_client,
        format!("/api/macro/yield-curve?country={country}"),
    )
    .await
}

/// Fetch recession probability from API
pub async fn fetch_recession_probability(
    api_client: &ZeeApiClient,
    country: &str,
) -> Result<RecessionApiResponse, String> {
    fetch_macro_payload(
        api_client,
        format!("/api/macro/recession-probability?country={country}"),
    )
    .await
}

// =============================================================================
// Macro View Component
// =============================================================================

/// Available countries for selection
const COUNTRIES: &[(&str, &str)] = &[
    ("USA", "United States"),
    ("DEU", "Germany"),
    ("GBR", "United Kingdom"),
    ("JPN", "Japan"),
    ("CHN", "China"),
    ("FRA", "France"),
    ("CAN", "Canada"),
    ("AUS", "Australia"),
];

/// Main Macro View state
pub struct MacroView {
    theme: Theme,
    api_client: Arc<ZeeApiClient>,
    selected_country: String,
    show_country_selector: bool,

    // Data states
    regime: LoadState<RegimeAnalysis>,
    indicators: LoadState<Vec<EconomicIndicator>>,
    yield_curve: LoadState<Vec<YieldCurvePoint>>,
    yield_curve_shape: String,
    yield_curve_spread: Option<f64>,
    recession: LoadState<RecessionData>,
}

impl MacroView {
    pub fn new(api_client: Arc<ZeeApiClient>, theme: Theme) -> Self {
        Self {
            theme,
            api_client,
            selected_country: "USA".to_string(),
            show_country_selector: false,
            regime: LoadState::NotLoaded,
            indicators: LoadState::NotLoaded,
            yield_curve: LoadState::NotLoaded,
            yield_curve_shape: "Unknown".to_string(),
            yield_curve_spread: None,
            recession: LoadState::NotLoaded,
        }
    }

    /// Load all macro data for selected country
    pub fn load_data(&mut self, cx: &mut Context<Self>) {
        self.load_indicators(cx);
        self.load_regime(cx);
        self.load_yield_curve(cx);
        self.load_recession(cx);
    }

    fn load_indicators(&mut self, cx: &mut Context<Self>) {
        self.indicators = LoadState::Loading;
        let api_client = self.api_client.clone();
        let country = self.selected_country.clone();

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            let result = fetch_macro_indicators(api_client.as_ref(), &country).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.indicators = match result {
                            Ok(data) => {
                                let indicators: Vec<EconomicIndicator> = data
                                    .indicators
                                    .into_iter()
                                    .map(|i| {
                                        let is_higher_better =
                                            i.code != "UNEMPLOYMENT" && i.code != "CPI";
                                        EconomicIndicator {
                                            name: i.name,
                                            code: i.code,
                                            value: i.value,
                                            previous: i.previous_value,
                                            change: i.change,
                                            unit: i.unit,
                                            trend: IndicatorTrend::from_change(
                                                i.change,
                                                is_higher_better,
                                            ),
                                        }
                                    })
                                    .collect();
                                LoadState::Loaded(indicators)
                            }
                            Err(e) => LoadState::Error(e),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn load_regime(&mut self, cx: &mut Context<Self>) {
        self.regime = LoadState::Loading;
        let api_client = self.api_client.clone();
        let country = self.selected_country.clone();

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            let result = fetch_macro_regime(api_client.as_ref(), &country).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.regime = match result {
                            Ok(data) => {
                                let confidence = match data.confidence.as_str() {
                                    "high" => 0.85,
                                    "medium" => 0.65,
                                    "low" => 0.45,
                                    _ => 0.5,
                                };
                                let signals: Vec<(String, f64)> = data
                                    .signals
                                    .into_iter()
                                    .map(|s| (s.source, s.strength))
                                    .collect();

                                LoadState::Loaded(RegimeAnalysis {
                                    current_regime: MarketRegime::from_api_string(
                                        &data.current_regime,
                                    ),
                                    confidence,
                                    regime_score: data.regime_score,
                                    positioning: RegimePositioning {
                                        equity: data.positioning.equity,
                                        duration: data.positioning.duration,
                                        credit: data.positioning.credit,
                                        volatility: data.positioning.volatility,
                                    },
                                    signals,
                                    regime_duration_days: data.regime_duration_days,
                                })
                            }
                            Err(e) => LoadState::Error(e),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn load_yield_curve(&mut self, cx: &mut Context<Self>) {
        self.yield_curve = LoadState::Loading;
        let api_client = self.api_client.clone();
        let country = self.selected_country.clone();

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            let result = fetch_yield_curve(api_client.as_ref(), &country).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        match result {
                            Ok(data) => {
                                view.yield_curve_shape = data.shape.clone();
                                view.yield_curve_spread = data.spread_2y10y;

                                let points: Vec<YieldCurvePoint> = data
                                    .curve
                                    .into_iter()
                                    .map(|p| YieldCurvePoint {
                                        maturity: p.tenor,
                                        yield_value: p.yield_pct,
                                        change: p.change,
                                    })
                                    .collect();
                                view.yield_curve = LoadState::Loaded(points);
                            }
                            Err(e) => view.yield_curve = LoadState::Error(e),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn load_recession(&mut self, cx: &mut Context<Self>) {
        self.recession = LoadState::Loading;
        let api_client = self.api_client.clone();
        let country = self.selected_country.clone();

        cx.spawn(async move |this, cx: &mut AsyncApp| {
            let result = fetch_recession_probability(api_client.as_ref(), &country).await;

            let _ = cx.update(|cx| {
                if let Some(entity) = this.upgrade() {
                    entity.update(cx, |view, cx| {
                        view.recession = match result {
                            Ok(data) => {
                                let factors: Vec<RecessionFactor> = data
                                    .factors
                                    .into_iter()
                                    .map(|f| RecessionFactor {
                                        name: f.factor,
                                        severity: f.severity,
                                        description: f.description,
                                        contribution: f.contribution,
                                    })
                                    .collect();

                                LoadState::Loaded(RecessionData {
                                    probability_12m: data.probability_12m,
                                    probability_6m: data.probability_6m,
                                    risk_level: data.risk_level,
                                    risk_score: data.risk_score,
                                    factors,
                                })
                            }
                            Err(e) => LoadState::Error(e),
                        };
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    fn select_country(&mut self, country: String, cx: &mut Context<Self>) {
        if self.selected_country != country {
            self.selected_country = country;
            self.show_country_selector = false;
            self.load_data(cx);
        }
    }

    fn toggle_country_selector(&mut self, cx: &mut Context<Self>) {
        self.show_country_selector = !self.show_country_selector;
        cx.notify();
    }
}

impl Render for MacroView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .size_full()
            .flex()
            .flex_col()
            .gap(px(20.0))
            .p(px(24.0))
            .bg(theme.background)
            // Top row: Regime badge + Country selector
            .child(self.render_top_bar(cx))
            // Main content: two columns
            .child(
                div()
                    .flex_grow()
                    .flex()
                    .gap(px(20.0))
                    // Left column: Economic indicators
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(20.0))
                            .child(self.render_indicators_card(cx)),
                    )
                    // Right column: Yield curve + Recession
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(20.0))
                            .child(self.render_yield_curve_card(cx))
                            .child(self.render_recession_card(cx)),
                    ),
            )
    }
}

impl MacroView {
    // =========================================================================
    // Top Bar
    // =========================================================================

    fn render_top_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let _theme = &self.theme;

        div()
            .flex()
            .items_center()
            .justify_between()
            .child(self.render_regime_badge(cx))
            .child(self.render_country_selector(cx))
    }

    fn render_regime_badge(&self, _cx: &mut Context<Self>) -> Div {
        let theme = &self.theme;

        match &self.regime {
            LoadState::Loading => div()
                .px(px(24.0))
                .py(px(16.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(theme.text_muted)
                        .child("Loading regime..."),
                ),
            LoadState::Error(e) => div()
                .px(px(24.0))
                .py(px(16.0))
                .rounded(px(12.0))
                .bg(theme.negative_subtle)
                .border_1()
                .border_color(theme.negative_muted)
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(theme.negative)
                        .child(format!("Error: {}", e)),
                ),
            LoadState::Loaded(regime) => {
                let color = regime.current_regime.color();
                let equity_color = self.get_positioning_color(&regime.positioning.equity, theme);
                let duration_color =
                    self.get_positioning_color(&regime.positioning.duration, theme);
                let credit_color = self.get_positioning_color(&regime.positioning.credit, theme);

                div()
                    .flex()
                    .items_center()
                    .gap(px(20.0))
                    // Main regime badge
                    .child(
                        div()
                            .px(px(32.0))
                            .py(px(16.0))
                            .rounded(px(12.0))
                            .bg(color.opacity(0.15))
                            .border_2()
                            .border_color(color.opacity(0.5))
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.text_muted)
                                    .child("MARKET REGIME"),
                            )
                            .child(
                                div()
                                    .text_size(px(24.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(color)
                                    .child(regime.current_regime.display_name()),
                            ),
                    )
                    // Confidence & Duration
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
                                            .text_size(px(11.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Confidence:"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text)
                                            .child(format!("{:.0}%", regime.confidence * 100.0)),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.0))
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Duration:"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(theme.text)
                                            .child(format!("{} days", regime.regime_duration_days)),
                                    ),
                            ),
                    )
                    // Positioning summary - inline chips
                    .child(
                        div()
                            .flex()
                            .gap(px(12.0))
                            // Equity chip
                            .child(
                                div()
                                    .px(px(10.0))
                                    .py(px(6.0))
                                    .rounded(px(6.0))
                                    .bg(theme.card_bg_elevated)
                                    .flex()
                                    .flex_col()
                                    .items_center()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(9.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Equity"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(equity_color)
                                            .child(regime.positioning.equity.to_uppercase()),
                                    ),
                            )
                            // Duration chip
                            .child(
                                div()
                                    .px(px(10.0))
                                    .py(px(6.0))
                                    .rounded(px(6.0))
                                    .bg(theme.card_bg_elevated)
                                    .flex()
                                    .flex_col()
                                    .items_center()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(9.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Duration"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(duration_color)
                                            .child(regime.positioning.duration.to_uppercase()),
                                    ),
                            )
                            // Credit chip
                            .child(
                                div()
                                    .px(px(10.0))
                                    .py(px(6.0))
                                    .rounded(px(6.0))
                                    .bg(theme.card_bg_elevated)
                                    .flex()
                                    .flex_col()
                                    .items_center()
                                    .gap(px(2.0))
                                    .child(
                                        div()
                                            .text_size(px(9.0))
                                            .text_color(theme.text_dimmed)
                                            .child("Credit"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(credit_color)
                                            .child(regime.positioning.credit.to_uppercase()),
                                    ),
                            ),
                    )
            }
            LoadState::NotLoaded => div()
                .px(px(24.0))
                .py(px(16.0))
                .rounded(px(12.0))
                .bg(theme.card_bg)
                .border_1()
                .border_color(theme.border)
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(theme.text_muted)
                        .child("Click to load regime data"),
                ),
        }
    }

    fn get_positioning_color(&self, value: &str, theme: &Theme) -> Hsla {
        match value.to_lowercase().as_str() {
            "overweight" | "long" | "buy" => theme.positive,
            "underweight" | "short" | "sell" => theme.negative,
            _ => theme.text_muted,
        }
    }

    fn render_country_selector(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;
        let selected = &self.selected_country;
        let country_name = COUNTRIES
            .iter()
            .find(|(code, _)| code == selected)
            .map(|(_, name)| *name)
            .unwrap_or("Unknown");

        div()
            .relative()
            .child(
                div()
                    .id("country-selector")
                    .px(px(16.0))
                    .py(px(10.0))
                    .rounded(px(8.0))
                    .bg(theme.card_bg)
                    .border_1()
                    .border_color(theme.border)
                    .cursor_pointer()
                    .hover(|s| s.bg(theme.hover_bg))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.toggle_country_selector(cx);
                    }))
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(format!("{} ({})", country_name, selected)),
                    )
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.text_dimmed)
                            .child(if self.show_country_selector { "^" } else { "v" }),
                    ),
            )
            .when(self.show_country_selector, |el| {
                el.child(self.render_country_dropdown(cx))
            })
    }

    fn render_country_dropdown(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .absolute()
            .top(px(44.0))
            .right(px(0.0))
            .w(px(200.0))
            .rounded(px(8.0))
            .bg(theme.card_bg_elevated)
            .border_1()
            .border_color(theme.border)
            .overflow_hidden()
            .children(COUNTRIES.iter().map(|(code, name)| {
                let code_owned = code.to_string();
                let is_selected = &self.selected_country == *code;

                div()
                    .id(SharedString::from(format!("country-{}", code)))
                    .px(px(12.0))
                    .py(px(10.0))
                    .cursor_pointer()
                    .bg(if is_selected {
                        theme.accent_subtle
                    } else {
                        transparent_black()
                    })
                    .hover(|s| s.bg(theme.hover_bg))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.select_country(code_owned.clone(), cx);
                    }))
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(if is_selected {
                                theme.accent
                            } else {
                                theme.text
                            })
                            .child(name.to_string()),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .child(code.to_string()),
                    )
            }))
    }

    // =========================================================================
    // Economic Indicators Card
    // =========================================================================

    fn render_indicators_card(&self, _cx: &mut Context<Self>) -> impl IntoElement {
        let _theme = &self.theme;

        self.card(
            "Economic Indicators",
            match &self.indicators {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(indicators) => self.render_indicators_table(indicators),
                LoadState::NotLoaded => self.loading_indicator(),
            },
        )
    }

    fn render_indicators_table(&self, indicators: &[EconomicIndicator]) -> Div {
        let theme = &self.theme;

        div()
            .flex()
            .flex_col()
            .gap(px(2.0))
            // Header
            .child(
                div()
                    .flex()
                    .items_center()
                    .py(px(10.0))
                    .px(px(8.0))
                    .border_b_1()
                    .border_color(theme.border)
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Indicator"),
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Value"),
                    )
                    .child(
                        div()
                            .w(px(80.0))
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text_muted)
                            .child("Trend"),
                    ),
            )
            // Rows
            .children(indicators.iter().map(|ind| {
                let trend_color = match ind.trend {
                    IndicatorTrend::Improving => theme.positive,
                    IndicatorTrend::Stable => theme.text_muted,
                    IndicatorTrend::Deteriorating => theme.negative,
                };
                let trend_icon = match ind.trend {
                    IndicatorTrend::Improving => "^",
                    IndicatorTrend::Stable => "-",
                    IndicatorTrend::Deteriorating => "v",
                };

                div()
                    .flex()
                    .items_center()
                    .py(px(12.0))
                    .px(px(8.0))
                    .border_b_1()
                    .border_color(theme.border_subtle)
                    .hover(|s| s.bg(theme.hover_bg))
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.text)
                                    .child(ind.name.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(theme.text_dimmed)
                                    .child(ind.code.clone()),
                            ),
                    )
                    .child(
                        div()
                            .w(px(100.0))
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(15.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .child(format!("{:.2}", ind.value)),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_muted)
                                    .child(ind.unit.clone()),
                            ),
                    )
                    .child(
                        div()
                            .w(px(80.0))
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .size(px(20.0))
                                    .rounded_full()
                                    .bg(trend_color.opacity(0.15))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(trend_color)
                                    .child(trend_icon),
                            )
                            .when(ind.change.is_some(), |el| {
                                let change = ind.change.unwrap_or(0.0);
                                el.child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(trend_color)
                                        .child(format!("{:+.2}", change)),
                                )
                            }),
                    )
            }))
    }

    // =========================================================================
    // Yield Curve Card
    // =========================================================================

    fn render_yield_curve_card(&self, _cx: &mut Context<Self>) -> impl IntoElement {
        let _theme = &self.theme;

        self.card(
            "Yield Curve",
            match &self.yield_curve {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(points) => self.render_yield_curve_content(points),
                LoadState::NotLoaded => self.loading_indicator(),
            },
        )
    }

    fn render_yield_curve_content(&self, points: &[YieldCurvePoint]) -> Div {
        let theme = &self.theme;

        // Find max yield for scaling
        let max_yield = points
            .iter()
            .map(|p| p.yield_value)
            .fold(0.0_f64, |a, b| a.max(b));
        let scale = if max_yield > 0.0 {
            200.0 / max_yield
        } else {
            1.0
        };

        // Determine curve shape color
        let shape_color = match self.yield_curve_shape.to_lowercase().as_str() {
            "normal" | "steep" => theme.positive,
            "flat" => theme.warning,
            "inverted" => theme.negative,
            _ => theme.text_muted,
        };

        div()
            .flex()
            .flex_col()
            .gap(px(16.0))
            // Shape indicator
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
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Shape:"),
                            )
                            .child(
                                div()
                                    .px(px(10.0))
                                    .py(px(4.0))
                                    .rounded(px(4.0))
                                    .bg(shape_color.opacity(0.15))
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(shape_color)
                                    .child(self.yield_curve_shape.to_uppercase()),
                            ),
                    )
                    .when(self.yield_curve_spread.is_some(), |el| {
                        let spread = self.yield_curve_spread.unwrap_or(0.0);
                        let spread_color = if spread >= 0.0 {
                            theme.positive
                        } else {
                            theme.negative
                        };
                        el.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.text_dimmed)
                                        .child("2Y-10Y Spread:"),
                                )
                                .child(
                                    div()
                                        .text_size(px(14.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(spread_color)
                                        .child(format!("{:+.2} bps", spread * 100.0)),
                                ),
                        )
                    }),
            )
            // Yield curve visualization (horizontal bars)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .children(points.iter().map(|point| {
                        let bar_width = (point.yield_value * scale).max(10.0);
                        let change_color = point
                            .change
                            .map(|c| {
                                if c >= 0.0 {
                                    theme.negative
                                } else {
                                    theme.positive
                                }
                            })
                            .unwrap_or(theme.text_muted);

                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            // Maturity label
                            .child(
                                div()
                                    .w(px(40.0))
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.text_secondary)
                                    .child(point.maturity.clone()),
                            )
                            // Bar
                            .child(
                                div()
                                    .flex_grow()
                                    .h(px(20.0))
                                    .rounded(px(4.0))
                                    .bg(theme.border_subtle)
                                    .child(
                                        div()
                                            .h_full()
                                            .w(px(bar_width as f32))
                                            .rounded(px(4.0))
                                            .bg(theme.accent),
                                    ),
                            )
                            // Yield value
                            .child(
                                div()
                                    .w(px(60.0))
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .child(format!("{:.3}%", point.yield_value)),
                            )
                            // Change
                            .when(point.change.is_some(), |el| {
                                el.child(
                                    div()
                                        .w(px(50.0))
                                        .text_size(px(10.0))
                                        .text_color(change_color)
                                        .child(format!("{:+.2}", point.change.unwrap_or(0.0))),
                                )
                            })
                    })),
            )
    }

    // =========================================================================
    // Recession Probability Card
    // =========================================================================

    fn render_recession_card(&self, _cx: &mut Context<Self>) -> impl IntoElement {
        let _theme = &self.theme;

        self.card(
            "Recession Probability",
            match &self.recession {
                LoadState::Loading => self.loading_indicator(),
                LoadState::Error(e) => self.error_message(e),
                LoadState::Loaded(data) => self.render_recession_content(data),
                LoadState::NotLoaded => self.loading_indicator(),
            },
        )
    }

    fn render_recession_content(&self, data: &RecessionData) -> Div {
        let theme = &self.theme;

        // Determine risk color
        let risk_color = match data.risk_level.to_lowercase().as_str() {
            "low" => theme.positive,
            "moderate" => theme.warning,
            "elevated" | "high" => theme.negative,
            _ => theme.text_muted,
        };

        div()
            .flex()
            .flex_col()
            .gap(px(16.0))
            // Probability gauges
            .child(
                div()
                    .flex()
                    .gap(px(20.0))
                    // 6-month probability
                    .child(self.probability_gauge("6 Month", data.probability_6m, theme))
                    // 12-month probability
                    .child(self.probability_gauge("12 Month", data.probability_12m, theme))
                    // Risk level badge
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.text_dimmed)
                                    .child("Risk Level"),
                            )
                            .child(
                                div()
                                    .px(px(16.0))
                                    .py(px(8.0))
                                    .rounded(px(6.0))
                                    .bg(risk_color.opacity(0.15))
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(risk_color)
                                    .child(data.risk_level.to_uppercase()),
                            ),
                    ),
            )
            // Risk factors
            .when(!data.factors.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text_muted)
                                .child("Risk Factors"),
                        )
                        .children(data.factors.iter().take(4).map(|factor| {
                            let severity_color = match factor.severity.to_lowercase().as_str() {
                                "high" => theme.negative,
                                "medium" => theme.warning,
                                "low" => theme.positive,
                                _ => theme.text_muted,
                            };

                            div()
                                .flex()
                                .items_center()
                                .gap(px(12.0))
                                .py(px(6.0))
                                .child(div().size(px(8.0)).rounded_full().bg(severity_color))
                                .child(
                                    div()
                                        .flex_grow()
                                        .text_size(px(12.0))
                                        .text_color(theme.text_secondary)
                                        .child(factor.name.clone()),
                                )
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(severity_color)
                                        .child(format!("{:.0}%", factor.contribution * 100.0)),
                                )
                        })),
                )
            })
    }

    fn probability_gauge(&self, label: &str, probability: f64, theme: &Theme) -> impl IntoElement {
        let percentage = probability * 100.0;
        let color = if percentage < 25.0 {
            theme.positive
        } else if percentage < 50.0 {
            theme.warning
        } else {
            theme.negative
        };

        // Create arc-like gauge using a progress bar
        let fill_height = (probability * 80.0).min(80.0);

        div()
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.text_dimmed)
                    .child(label.to_string()),
            )
            // Vertical gauge
            .child(
                div()
                    .w(px(60.0))
                    .h(px(80.0))
                    .rounded(px(8.0))
                    .bg(theme.border_subtle)
                    .relative()
                    .flex()
                    .flex_col()
                    .justify_end()
                    .child(
                        div()
                            .w_full()
                            .h(px(fill_height as f32))
                            .rounded_b(px(8.0))
                            .when(fill_height >= 80.0, |el| el.rounded_t(px(8.0)))
                            .bg(color),
                    ),
            )
            // Percentage text
            .child(
                div()
                    .text_size(px(18.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(color)
                    .child(format!("{:.1}%", percentage)),
            )
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    fn card(&self, title: &str, content: impl IntoElement) -> impl IntoElement {
        let theme = &self.theme;

        div()
            .flex_grow()
            .p(px(20.0))
            .rounded(px(12.0))
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
                    .text_color(theme.text)
                    .child(title.to_string()),
            )
            .child(content)
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
                    .child("Loading..."),
            )
    }

    fn error_message(&self, msg: &str) -> Div {
        let theme = &self.theme;

        div()
            .py(px(20.0))
            .px(px(16.0))
            .rounded(px(6.0))
            .bg(theme.negative_subtle)
            .text_size(px(12.0))
            .text_color(theme.negative)
            .child(msg.to_string())
    }
}
