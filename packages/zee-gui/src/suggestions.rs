//! Inline Suggestions for Stanley GUI
//!
//! Provides agent suggestions overlay on data views with:
//! - "Ask about this" buttons on charts/tables
//! - Quick insight tooltips from agent memory
//! - Contextual action suggestions

use crate::components::streaming::CatppuccinMocha;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =============================================================================
// Suggestion Types
// =============================================================================

/// Type of suggestion
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SuggestionType {
    /// Ask a question about specific data
    AskAbout,
    /// Analyze a metric or trend
    Analyze,
    /// Compare with other data
    Compare,
    /// Get historical context
    Historical,
    /// Execute an action
    Action,
    /// Quick insight from memory
    Insight,
}

impl SuggestionType {
    pub fn icon(&self) -> &'static str {
        match self {
            SuggestionType::AskAbout => "?",
            SuggestionType::Analyze => "A",
            SuggestionType::Compare => "C",
            SuggestionType::Historical => "H",
            SuggestionType::Action => ">",
            SuggestionType::Insight => "i",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            SuggestionType::AskAbout => "Ask about this",
            SuggestionType::Analyze => "Analyze",
            SuggestionType::Compare => "Compare",
            SuggestionType::Historical => "Historical",
            SuggestionType::Action => "Action",
            SuggestionType::Insight => "Insight",
        }
    }
}

/// Context for a suggestion (what data it relates to)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionContext {
    /// Type of data (chart, table, metric, etc.)
    pub data_type: String,
    /// Symbol if applicable
    pub symbol: Option<String>,
    /// Specific metric or field name
    pub metric: Option<String>,
    /// Current value
    pub value: Option<String>,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl SuggestionContext {
    pub fn new(data_type: &str) -> Self {
        Self {
            data_type: data_type.to_string(),
            symbol: None,
            metric: None,
            value: None,
            metadata: HashMap::new(),
        }
    }

    pub fn with_symbol(mut self, symbol: &str) -> Self {
        self.symbol = Some(symbol.to_string());
        self
    }

    pub fn with_metric(mut self, metric: &str) -> Self {
        self.metric = Some(metric.to_string());
        self
    }

    pub fn with_value(mut self, value: &str) -> Self {
        self.value = Some(value.to_string());
        self
    }

    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
}

/// A single suggestion item
#[derive(Debug, Clone)]
pub struct Suggestion {
    /// Unique identifier
    pub id: String,
    /// Type of suggestion
    pub suggestion_type: SuggestionType,
    /// Display text for the suggestion
    pub text: String,
    /// Prompt to send to agent when clicked
    pub prompt: String,
    /// Context about the data
    pub context: SuggestionContext,
    /// Priority (higher = more prominent)
    pub priority: u8,
    /// Whether this is a quick insight (shows tooltip)
    pub is_insight: bool,
    /// Cached insight content if available
    pub insight_content: Option<String>,
}

impl Suggestion {
    /// Create a new "Ask about this" suggestion
    pub fn ask_about(context: SuggestionContext) -> Self {
        let prompt = Self::generate_ask_prompt(&context);
        Self {
            id: generate_suggestion_id(),
            suggestion_type: SuggestionType::AskAbout,
            text: "Ask about this".to_string(),
            prompt,
            context,
            priority: 10,
            is_insight: false,
            insight_content: None,
        }
    }

    /// Create an analysis suggestion
    pub fn analyze(context: SuggestionContext, metric: &str) -> Self {
        let prompt = format!(
            "Analyze the {} for {} and provide insights on trends, anomalies, and implications.",
            metric,
            context.symbol.as_deref().unwrap_or("this data")
        );
        Self {
            id: generate_suggestion_id(),
            suggestion_type: SuggestionType::Analyze,
            text: format!("Analyze {}", metric),
            prompt,
            context,
            priority: 8,
            is_insight: false,
            insight_content: None,
        }
    }

    /// Create a comparison suggestion
    pub fn compare(context: SuggestionContext, compare_with: &str) -> Self {
        let symbol = context.symbol.clone().unwrap_or_else(|| "this".to_string());
        let prompt = format!(
            "Compare {} with {} across key metrics and highlight significant differences.",
            symbol, compare_with
        );
        Self {
            id: generate_suggestion_id(),
            suggestion_type: SuggestionType::Compare,
            text: format!("Compare with {}", compare_with),
            prompt,
            context,
            priority: 7,
            is_insight: false,
            insight_content: None,
        }
    }

    /// Create a historical context suggestion
    pub fn historical(context: SuggestionContext) -> Self {
        let symbol = context
            .symbol
            .clone()
            .unwrap_or_else(|| "this data".to_string());
        let prompt = format!(
            "Provide historical context for {} including past performance, major events, and how current levels compare to historical averages.",
            symbol
        );
        Self {
            id: generate_suggestion_id(),
            suggestion_type: SuggestionType::Historical,
            text: "Show historical context".to_string(),
            prompt,
            context,
            priority: 6,
            is_insight: false,
            insight_content: None,
        }
    }

    /// Create a quick insight suggestion
    pub fn insight(context: SuggestionContext, insight: &str) -> Self {
        Self {
            id: generate_suggestion_id(),
            suggestion_type: SuggestionType::Insight,
            text: "Quick insight".to_string(),
            prompt: String::new(),
            context,
            priority: 9,
            is_insight: true,
            insight_content: Some(insight.to_string()),
        }
    }

    fn generate_ask_prompt(context: &SuggestionContext) -> String {
        let mut parts = Vec::new();

        if let Some(symbol) = &context.symbol {
            parts.push(format!("symbol {}", symbol));
        }
        if let Some(metric) = &context.metric {
            parts.push(format!("metric {}", metric));
        }
        if let Some(value) = &context.value {
            parts.push(format!("current value {}", value));
        }

        if parts.is_empty() {
            format!("Tell me more about this {} data.", context.data_type)
        } else {
            format!(
                "Tell me about the {} for {}. What does this mean and what are the implications?",
                context.data_type,
                parts.join(" with ")
            )
        }
    }
}

// =============================================================================
// Suggestions State
// =============================================================================

/// State for managing suggestions
#[derive(Debug, Clone, Default)]
pub struct SuggestionsState {
    /// Active suggestions by element ID
    pub suggestions: HashMap<String, Vec<Suggestion>>,
    /// Currently hovered suggestion
    pub hovered_suggestion: Option<String>,
    /// Currently shown tooltip
    pub active_tooltip: Option<String>,
    /// Whether suggestions are enabled globally
    pub enabled: bool,
    /// Cached insights from agent memory
    pub cached_insights: HashMap<String, String>,
}

impl SuggestionsState {
    pub fn new() -> Self {
        Self {
            suggestions: HashMap::new(),
            hovered_suggestion: None,
            active_tooltip: None,
            enabled: true,
            cached_insights: HashMap::new(),
        }
    }

    /// Add suggestions for an element
    pub fn add_suggestions(&mut self, element_id: &str, suggestions: Vec<Suggestion>) {
        self.suggestions.insert(element_id.to_string(), suggestions);
    }

    /// Get suggestions for an element
    pub fn get_suggestions(&self, element_id: &str) -> Option<&Vec<Suggestion>> {
        self.suggestions.get(element_id)
    }

    /// Clear suggestions for an element
    pub fn clear_suggestions(&mut self, element_id: &str) {
        self.suggestions.remove(element_id);
    }

    /// Set hovered suggestion
    pub fn set_hover(&mut self, suggestion_id: Option<String>) {
        self.hovered_suggestion = suggestion_id;
    }

    /// Show tooltip for a suggestion
    pub fn show_tooltip(&mut self, suggestion_id: &str) {
        self.active_tooltip = Some(suggestion_id.to_string());
    }

    /// Hide tooltip
    pub fn hide_tooltip(&mut self) {
        self.active_tooltip = None;
    }

    /// Cache an insight
    pub fn cache_insight(&mut self, key: &str, insight: &str) {
        self.cached_insights
            .insert(key.to_string(), insight.to_string());
    }

    /// Get cached insight
    pub fn get_cached_insight(&self, key: &str) -> Option<&String> {
        self.cached_insights.get(key)
    }

    /// Toggle suggestions globally
    pub fn toggle(&mut self) {
        self.enabled = !self.enabled;
    }
}

// =============================================================================
// Suggestion Generation
// =============================================================================

/// Generate suggestions for chart data
pub fn generate_chart_suggestions(
    chart_type: &str,
    symbol: Option<&str>,
    metric: &str,
    current_value: Option<f64>,
) -> Vec<Suggestion> {
    let mut suggestions = Vec::new();
    let mut context = SuggestionContext::new(chart_type);

    if let Some(s) = symbol {
        context = context.with_symbol(s);
    }
    context = context.with_metric(metric);
    if let Some(v) = current_value {
        context = context.with_value(&format!("{:.2}", v));
    }

    // Primary suggestion
    suggestions.push(Suggestion::ask_about(context.clone()));

    // Analysis suggestion
    suggestions.push(Suggestion::analyze(context.clone(), metric));

    // Historical suggestion
    suggestions.push(Suggestion::historical(context.clone()));

    // Compare suggestions for equity data
    if let Some(_s) = symbol {
        if chart_type == "equity" || chart_type == "stock" {
            suggestions.push(Suggestion::compare(context.clone(), "sector peers"));
            suggestions.push(Suggestion::compare(context, "SPY"));
        }
    }

    suggestions
}

/// Generate suggestions for table data
pub fn generate_table_suggestions(
    table_type: &str,
    row_data: HashMap<String, String>,
) -> Vec<Suggestion> {
    let mut suggestions = Vec::new();
    let mut context = SuggestionContext::new(table_type);

    // Add row data to context
    if let Some(symbol) = row_data.get("symbol") {
        context = context.with_symbol(symbol);
    }
    for (key, value) in &row_data {
        context = context.with_metadata(key, value);
    }

    suggestions.push(Suggestion::ask_about(context.clone()));

    // Table-specific suggestions
    match table_type {
        "institutional" => {
            suggestions.push(Suggestion::analyze(
                context.clone(),
                "institutional holdings",
            ));
            if let Some(holder) = row_data.get("holder") {
                suggestions.push(Suggestion {
                    id: generate_suggestion_id(),
                    suggestion_type: SuggestionType::Action,
                    text: format!("View {} portfolio", holder),
                    prompt: format!("Show me the full portfolio holdings for {}.", holder),
                    context: context.clone(),
                    priority: 7,
                    is_insight: false,
                    insight_content: None,
                });
            }
        }
        "money_flow" => {
            suggestions.push(Suggestion::analyze(context.clone(), "money flow patterns"));
            suggestions.push(Suggestion::historical(context.clone()));
        }
        "portfolio" => {
            suggestions.push(Suggestion::analyze(context.clone(), "portfolio risk"));
            suggestions.push(Suggestion::compare(context, "benchmark"));
        }
        _ => {}
    }

    suggestions
}

/// Generate quick insights based on data patterns
pub fn generate_insights(
    _data_type: &str,
    _symbol: Option<&str>,
    metrics: HashMap<String, f64>,
) -> Vec<String> {
    let mut insights = Vec::new();

    // Analyze metrics for patterns
    if let Some(change) = metrics.get("change_percent") {
        if *change > 5.0 {
            insights.push(format!(
                "Significant positive movement (+{:.1}%) - consider reviewing catalysts",
                change
            ));
        } else if *change < -5.0 {
            insights.push(format!(
                "Notable decline ({:.1}%) - may warrant further investigation",
                change
            ));
        }
    }

    if let Some(volume) = metrics.get("volume_ratio") {
        if *volume > 2.0 {
            insights.push(format!(
                "Volume is {:.1}x average - unusual activity detected",
                volume
            ));
        }
    }

    if let Some(rsi) = metrics.get("rsi") {
        if *rsi > 70.0 {
            insights.push("RSI indicates overbought conditions".to_string());
        } else if *rsi < 30.0 {
            insights.push("RSI indicates oversold conditions".to_string());
        }
    }

    if let Some(flow) = metrics.get("money_flow_score") {
        if *flow > 0.7 {
            insights.push("Strong positive money flow detected".to_string());
        } else if *flow < 0.3 {
            insights.push("Negative money flow pressure observed".to_string());
        }
    }

    insights
}

// =============================================================================
// Rendering
// =============================================================================

/// Render an "Ask about this" button overlay
pub fn render_ask_about_button<F>(
    _theme: &Theme,
    context: SuggestionContext,
    on_click: F,
) -> impl IntoElement
where
    F: Fn(String) + 'static,
{
    let prompt = Suggestion::generate_ask_prompt(&context);

    div()
        .id("ask-about-btn")
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(CatppuccinMocha::surface1())
        .border_1()
        .border_color(CatppuccinMocha::surface2())
        .cursor_pointer()
        .hover(|s| {
            s.bg(CatppuccinMocha::surface2())
                .border_color(CatppuccinMocha::blue())
        })
        .on_click(move |_event, _window, _cx| {
            on_click(prompt.clone());
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .size(px(16.0))
                        .rounded_full()
                        .bg(CatppuccinMocha::blue().opacity(0.2))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(CatppuccinMocha::blue())
                                .child("?"),
                        ),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::subtext0())
                        .child("Ask about this"),
                ),
        )
}

/// Render a suggestion chip
pub fn render_suggestion_chip<F>(
    _theme: &Theme,
    suggestion: &Suggestion,
    on_click: F,
) -> impl IntoElement
where
    F: Fn(String) + 'static,
{
    let prompt = suggestion.prompt.clone();
    let type_color = match suggestion.suggestion_type {
        SuggestionType::AskAbout => CatppuccinMocha::blue(),
        SuggestionType::Analyze => CatppuccinMocha::green(),
        SuggestionType::Compare => CatppuccinMocha::mauve(),
        SuggestionType::Historical => CatppuccinMocha::peach(),
        SuggestionType::Action => CatppuccinMocha::teal(),
        SuggestionType::Insight => CatppuccinMocha::yellow(),
    };

    div()
        .id(suggestion.id.clone())
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
        .on_click(move |_event, _window, _cx| {
            on_click(prompt.clone());
        })
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
                        .child(suggestion.suggestion_type.icon()),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::text())
                        .child(suggestion.text.clone()),
                ),
        )
}

/// Render a suggestions overlay for a data element
pub fn render_suggestions_overlay<F>(theme: &Theme, suggestions: &[Suggestion], on_click: F) -> Div
where
    F: Fn(String) + Clone + 'static,
{
    div()
        .absolute()
        .top(px(8.0))
        .right(px(8.0))
        .flex()
        .flex_col()
        .gap(px(4.0))
        .p(px(8.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::mantle().opacity(0.95))
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .shadow_lg()
        .children(suggestions.iter().take(4).map(|suggestion| {
            let callback = on_click.clone();
            render_suggestion_chip(theme, suggestion, callback)
        }))
}

/// Render an insight tooltip
#[allow(dead_code)]
pub fn render_insight_tooltip(_theme: &Theme, insight: &str) -> Div {
    div()
        .absolute()
        .bottom(px(40.0))
        .left(px(0.0))
        .w(px(280.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::mantle())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .shadow_lg()
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
                        .gap(px(6.0))
                        .child(
                            div()
                                .size(px(16.0))
                                .rounded_full()
                                .bg(CatppuccinMocha::yellow().opacity(0.2))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(CatppuccinMocha::yellow())
                                        .child("i"),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(CatppuccinMocha::text())
                                .child("Quick Insight"),
                        ),
                )
                // Content
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(CatppuccinMocha::subtext1())
                        .child(insight.to_string()),
                ),
        )
}

/// Render a contextual action bar for selected data
pub fn render_contextual_actions<F>(theme: &Theme, context: &SuggestionContext, on_action: F) -> Div
where
    F: Fn(&str, String) + Clone + 'static,
{
    let symbol = context.symbol.clone().unwrap_or_else(|| "data".to_string());

    div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .p(px(8.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        // Ask button
        .child({
            let callback = on_action.clone();
            let sym = symbol.clone();
            render_action_button(theme, "Ask", "?", CatppuccinMocha::blue(), move || {
                callback("ask", format!("Tell me about {}", sym));
            })
        })
        // Analyze button
        .child({
            let callback = on_action.clone();
            let sym = symbol.clone();
            render_action_button(theme, "Analyze", "A", CatppuccinMocha::green(), move || {
                callback("analyze", format!("Analyze {} in detail", sym));
            })
        })
        // Compare button
        .child({
            let callback = on_action.clone();
            let sym = symbol.clone();
            render_action_button(theme, "Compare", "C", CatppuccinMocha::mauve(), move || {
                callback("compare", format!("Compare {} with peers", sym));
            })
        })
        // Research button
        .child({
            let callback = on_action;
            let sym = symbol;
            render_action_button(
                theme,
                "Research",
                "R",
                CatppuccinMocha::peach(),
                move || {
                    callback(
                        "research",
                        format!("Give me a full research report on {}", sym),
                    );
                },
            )
        })
}

/// Helper to render an action button
fn render_action_button<F>(
    _theme: &Theme,
    label: &str,
    icon: &str,
    color: Hsla,
    on_click: F,
) -> impl IntoElement
where
    F: Fn() + 'static,
{
    let label_owned = label.to_string();
    let icon_owned = icon.to_string();

    div()
        .id(format!("action-{}", label.to_lowercase()))
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
                .gap(px(5.0))
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(color)
                        .child(icon_owned.clone()),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::text())
                        .child(label_owned.clone()),
                ),
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate unique suggestion ID
fn generate_suggestion_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("sug-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_suggestion_context() {
        let context = SuggestionContext::new("chart")
            .with_symbol("AAPL")
            .with_metric("price")
            .with_value("150.00");

        assert_eq!(context.data_type, "chart");
        assert_eq!(context.symbol, Some("AAPL".to_string()));
        assert_eq!(context.metric, Some("price".to_string()));
    }

    #[test]
    fn test_generate_chart_suggestions() {
        let suggestions = generate_chart_suggestions("equity", Some("AAPL"), "price", Some(150.0));

        assert!(!suggestions.is_empty());
        assert!(suggestions
            .iter()
            .any(|s| s.suggestion_type == SuggestionType::AskAbout));
    }

    #[test]
    fn test_generate_insights() {
        let mut metrics = HashMap::new();
        metrics.insert("change_percent".to_string(), 7.5);
        metrics.insert("volume_ratio".to_string(), 2.5);

        let insights = generate_insights("stock", Some("AAPL"), metrics);

        assert!(!insights.is_empty());
        assert!(insights.iter().any(|i| i.contains("positive movement")));
    }

    #[test]
    fn test_suggestions_state() {
        let mut state = SuggestionsState::new();
        assert!(state.enabled);

        let suggestions = vec![Suggestion::ask_about(SuggestionContext::new("test"))];
        state.add_suggestions("element-1", suggestions);

        assert!(state.get_suggestions("element-1").is_some());
        assert!(state.get_suggestions("element-2").is_none());
    }
}
