//! Agent Status Widget for Stanley GUI
//!
//! Provides connection status indicator, current model display,
//! token usage meter, and active tools indicator.

use crate::components::streaming::CatppuccinMocha;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};

// =============================================================================
// Connection Status
// =============================================================================

/// Agent connection status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum AgentConnectionStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

impl AgentConnectionStatus {
    pub fn label(&self) -> &'static str {
        match self {
            AgentConnectionStatus::Disconnected => "Disconnected",
            AgentConnectionStatus::Connecting => "Connecting...",
            AgentConnectionStatus::Connected => "Connected",
            AgentConnectionStatus::Reconnecting => "Reconnecting...",
            AgentConnectionStatus::Error => "Error",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            AgentConnectionStatus::Disconnected => CatppuccinMocha::overlay0(),
            AgentConnectionStatus::Connecting => CatppuccinMocha::yellow(),
            AgentConnectionStatus::Connected => CatppuccinMocha::green(),
            AgentConnectionStatus::Reconnecting => CatppuccinMocha::peach(),
            AgentConnectionStatus::Error => CatppuccinMocha::red(),
        }
    }

    pub fn is_connected(&self) -> bool {
        matches!(self, AgentConnectionStatus::Connected)
    }

    pub fn is_busy(&self) -> bool {
        matches!(
            self,
            AgentConnectionStatus::Connecting | AgentConnectionStatus::Reconnecting
        )
    }
}

// =============================================================================
// Model Information
// =============================================================================

/// Available AI models
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    /// Model identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Provider (e.g., "anthropic", "openai")
    pub provider: String,
    /// Context window size
    pub context_window: u32,
    /// Max output tokens
    pub max_output_tokens: u32,
    /// Whether this is the current model
    pub is_current: bool,
}

impl ModelInfo {
    pub fn claude_opus() -> Self {
        Self {
            id: "claude-3-opus".to_string(),
            name: "Claude 3 Opus".to_string(),
            provider: "anthropic".to_string(),
            context_window: 200_000,
            max_output_tokens: 4096,
            is_current: true,
        }
    }

    pub fn claude_sonnet() -> Self {
        Self {
            id: "claude-3-5-sonnet".to_string(),
            name: "Claude 3.5 Sonnet".to_string(),
            provider: "anthropic".to_string(),
            context_window: 200_000,
            max_output_tokens: 8192,
            is_current: false,
        }
    }

    pub fn claude_haiku() -> Self {
        Self {
            id: "claude-3-haiku".to_string(),
            name: "Claude 3 Haiku".to_string(),
            provider: "anthropic".to_string(),
            context_window: 200_000,
            max_output_tokens: 4096,
            is_current: false,
        }
    }

    pub fn provider_color(&self) -> Hsla {
        match self.provider.as_str() {
            "anthropic" => CatppuccinMocha::peach(),
            "openai" => CatppuccinMocha::green(),
            "google" => CatppuccinMocha::blue(),
            _ => CatppuccinMocha::lavender(),
        }
    }
}

impl Default for ModelInfo {
    fn default() -> Self {
        Self::claude_opus()
    }
}

// =============================================================================
// Token Usage
// =============================================================================

/// Token usage tracking
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    /// Input tokens used in current session
    pub input_tokens: u64,
    /// Output tokens used in current session
    pub output_tokens: u64,
    /// Total tokens used in current session
    pub total_tokens: u64,
    /// Token limit for current session/context
    pub token_limit: u64,
    /// Estimated cost in USD
    pub estimated_cost: f64,
    /// Number of requests made
    pub request_count: u32,
}

impl TokenUsage {
    pub fn new(token_limit: u64) -> Self {
        Self {
            token_limit,
            ..Default::default()
        }
    }

    /// Add tokens from a request
    pub fn add_usage(&mut self, input: u64, output: u64, cost: f64) {
        self.input_tokens += input;
        self.output_tokens += output;
        self.total_tokens = self.input_tokens + self.output_tokens;
        self.estimated_cost += cost;
        self.request_count += 1;
    }

    /// Get usage percentage
    pub fn usage_percent(&self) -> f32 {
        if self.token_limit == 0 {
            0.0
        } else {
            (self.total_tokens as f32 / self.token_limit as f32 * 100.0).min(100.0)
        }
    }

    /// Get color based on usage level
    pub fn usage_color(&self) -> Hsla {
        let percent = self.usage_percent();
        if percent < 50.0 {
            CatppuccinMocha::green()
        } else if percent < 75.0 {
            CatppuccinMocha::yellow()
        } else if percent < 90.0 {
            CatppuccinMocha::peach()
        } else {
            CatppuccinMocha::red()
        }
    }

    /// Format tokens for display
    pub fn format_tokens(tokens: u64) -> String {
        if tokens >= 1_000_000 {
            format!("{:.1}M", tokens as f64 / 1_000_000.0)
        } else if tokens >= 1_000 {
            format!("{:.1}K", tokens as f64 / 1_000.0)
        } else {
            format!("{}", tokens)
        }
    }

    /// Reset usage tracking
    pub fn reset(&mut self) {
        self.input_tokens = 0;
        self.output_tokens = 0;
        self.total_tokens = 0;
        self.estimated_cost = 0.0;
        self.request_count = 0;
    }
}

// =============================================================================
// Active Tools
// =============================================================================

/// Status of an active tool
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolExecutionStatus {
    Pending,
    Running,
    Success,
    Error,
}

impl ToolExecutionStatus {
    pub fn color(&self) -> Hsla {
        match self {
            ToolExecutionStatus::Pending => CatppuccinMocha::overlay1(),
            ToolExecutionStatus::Running => CatppuccinMocha::blue(),
            ToolExecutionStatus::Success => CatppuccinMocha::green(),
            ToolExecutionStatus::Error => CatppuccinMocha::red(),
        }
    }
}

/// Information about an active tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTool {
    /// Tool identifier
    pub id: String,
    /// Tool name
    pub name: String,
    /// Execution status
    pub status: ToolExecutionStatus,
    /// When the tool started
    pub started_at: Option<String>,
    /// Duration in milliseconds
    pub duration_ms: Option<u64>,
}

impl ActiveTool {
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            status: ToolExecutionStatus::Pending,
            started_at: None,
            duration_ms: None,
        }
    }

    pub fn start(&mut self) {
        self.status = ToolExecutionStatus::Running;
        self.started_at = Some(chrono_now());
    }

    pub fn complete(&mut self, success: bool, duration_ms: u64) {
        self.status = if success {
            ToolExecutionStatus::Success
        } else {
            ToolExecutionStatus::Error
        };
        self.duration_ms = Some(duration_ms);
    }
}

// =============================================================================
// Agent Status State
// =============================================================================

/// Complete agent status state
#[derive(Debug, Clone)]
pub struct AgentStatusState {
    /// Connection status
    pub connection: AgentConnectionStatus,
    /// Current model info
    pub model: ModelInfo,
    /// Available models
    pub available_models: Vec<ModelInfo>,
    /// Token usage tracking
    pub token_usage: TokenUsage,
    /// Currently active tools
    pub active_tools: Vec<ActiveTool>,
    /// Last error message
    pub last_error: Option<String>,
    /// Whether the status panel is expanded
    pub is_expanded: bool,
    /// Ping latency in ms
    pub latency_ms: Option<u32>,
}

impl Default for AgentStatusState {
    fn default() -> Self {
        Self {
            connection: AgentConnectionStatus::Disconnected,
            model: ModelInfo::claude_opus(),
            available_models: vec![
                ModelInfo::claude_opus(),
                ModelInfo::claude_sonnet(),
                ModelInfo::claude_haiku(),
            ],
            token_usage: TokenUsage::new(200_000),
            active_tools: Vec::new(),
            last_error: None,
            is_expanded: false,
            latency_ms: None,
        }
    }
}

impl AgentStatusState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set connection status
    pub fn set_connection(&mut self, status: AgentConnectionStatus) {
        self.connection = status;
        if status == AgentConnectionStatus::Error {
            self.latency_ms = None;
        }
    }

    /// Set current model
    pub fn set_model(&mut self, model_id: &str) {
        for m in &mut self.available_models {
            m.is_current = m.id == model_id;
        }
        if let Some(m) = self.available_models.iter().find(|m| m.id == model_id) {
            self.model = m.clone();
        }
    }

    /// Add a tool to active tools
    pub fn add_active_tool(&mut self, tool: ActiveTool) {
        self.active_tools.push(tool);
    }

    /// Update tool status
    pub fn update_tool(&mut self, tool_id: &str, success: bool, duration_ms: u64) {
        if let Some(tool) = self.active_tools.iter_mut().find(|t| t.id == tool_id) {
            tool.complete(success, duration_ms);
        }
    }

    /// Remove completed tools
    pub fn clear_completed_tools(&mut self) {
        self.active_tools.retain(|t| {
            !matches!(
                t.status,
                ToolExecutionStatus::Success | ToolExecutionStatus::Error
            )
        });
    }

    /// Set error message
    pub fn set_error(&mut self, error: String) {
        self.last_error = Some(error);
        self.connection = AgentConnectionStatus::Error;
    }

    /// Clear error
    pub fn clear_error(&mut self) {
        self.last_error = None;
    }

    /// Toggle expanded state
    pub fn toggle_expanded(&mut self) {
        self.is_expanded = !self.is_expanded;
    }

    /// Set latency
    pub fn set_latency(&mut self, ms: u32) {
        self.latency_ms = Some(ms);
    }

    /// Get number of running tools
    pub fn running_tools_count(&self) -> usize {
        self.active_tools
            .iter()
            .filter(|t| t.status == ToolExecutionStatus::Running)
            .count()
    }

    /// Get the first running tool (for display purposes)
    pub fn get_first_running_tool(&self) -> Option<ActiveTool> {
        self.active_tools
            .iter()
            .find(|t| t.status == ToolExecutionStatus::Running)
            .cloned()
    }

    /// Get all running tools
    pub fn get_running_tools(&self) -> Vec<&ActiveTool> {
        self.active_tools
            .iter()
            .filter(|t| t.status == ToolExecutionStatus::Running)
            .collect()
    }
}

// =============================================================================
// Rendering - Compact Widget
// =============================================================================

/// Render compact status indicator
pub fn render_status_compact(theme: &Theme, state: &AgentStatusState) -> impl IntoElement {
    let running_tools = state.running_tools_count();
    let first_running_tool = state.get_first_running_tool();

    div()
        .id("agent-status-compact")
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .cursor_pointer()
        // Connection indicator
        .child(render_connection_dot(&state.connection))
        // Model badge
        .child(render_model_badge_compact(theme, &state.model))
        // Token usage mini
        .child(render_token_usage_mini(theme, &state.token_usage))
        // Active tools indicator - show executing tool name if available
        .when_some(first_running_tool.clone(), |el, tool| {
            el.child(render_executing_tool_indicator(theme, &tool.name))
        })
        // Show count if multiple tools running but no first tool name available
        .when(running_tools > 1 && first_running_tool.is_some(), |el| {
            el.child(
                div()
                    .text_size(px(9.0))
                    .text_color(CatppuccinMocha::overlay0())
                    .child(format!("+{}", running_tools - 1)),
            )
        })
}

/// Render connection status dot
fn render_connection_dot(status: &AgentConnectionStatus) -> Div {
    let color = status.color();
    let is_animated = status.is_busy();

    div()
        .size(px(8.0))
        .rounded_full()
        .bg(color)
        // Pulse effect for busy states
        .when(is_animated, |el| {
            el.border_2().border_color(color.opacity(0.3))
        })
}

/// Render compact model badge
fn render_model_badge_compact(_theme: &Theme, model: &ModelInfo) -> Div {
    div()
        .px(px(6.0))
        .py(px(2.0))
        .rounded(px(4.0))
        .bg(model.provider_color().opacity(0.15))
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(model.provider_color())
                .child(model.name.clone()),
        )
}

/// Render mini token usage bar
fn render_token_usage_mini(_theme: &Theme, usage: &TokenUsage) -> Div {
    let percent = usage.usage_percent();
    let color = usage.usage_color();

    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        // Progress bar
        .child(
            div()
                .w(px(40.0))
                .h(px(4.0))
                .rounded_full()
                .bg(CatppuccinMocha::surface1())
                .child(
                    div().h_full().rounded_full().bg(color).w(px(percent * 0.4)), // Scale to 40px width
                ),
        )
        // Percentage text
        .child(
            div()
                .text_size(px(9.0))
                .text_color(CatppuccinMocha::overlay1())
                .child(format!("{}%", percent as u32)),
        )
}

/// Render executing tool indicator with spinner and tool name
fn render_executing_tool_indicator(_theme: &Theme, tool_name: &str) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(6.0))
        .bg(CatppuccinMocha::blue().opacity(0.15))
        .border_1()
        .border_color(CatppuccinMocha::blue().opacity(0.3))
        // Spinner indicator (three dots animation representation)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(2.0))
                .child(
                    div()
                        .size(px(4.0))
                        .rounded_full()
                        .bg(CatppuccinMocha::blue()),
                )
                .child(
                    div()
                        .size(px(4.0))
                        .rounded_full()
                        .bg(CatppuccinMocha::blue().opacity(0.6)),
                )
                .child(
                    div()
                        .size(px(4.0))
                        .rounded_full()
                        .bg(CatppuccinMocha::blue().opacity(0.3)),
                ),
        )
        // "Executing:" label
        .child(
            div()
                .text_size(px(10.0))
                .text_color(CatppuccinMocha::overlay1())
                .child("Executing:"),
        )
        // Tool name
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(CatppuccinMocha::blue())
                .child(truncate_tool_name(tool_name, 20)),
        )
}

/// Truncate tool name for display
fn truncate_tool_name(name: &str, max_len: usize) -> String {
    if name.len() <= max_len {
        name.to_string()
    } else {
        format!("{}...", &name[..max_len])
    }
}

// =============================================================================
// Rendering - Expanded Widget
// =============================================================================

/// Render expanded status panel
pub fn render_status_expanded(
    theme: &Theme,
    state: &AgentStatusState,
    on_model_change: impl Fn(&str) + Clone + 'static,
    on_close: impl Fn() + 'static,
) -> Div {
    div()
        .w(px(320.0))
        .flex()
        .flex_col()
        .bg(CatppuccinMocha::mantle())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .rounded(px(12.0))
        .shadow_lg()
        .overflow_hidden()
        // Header
        .child(render_expanded_header(theme, state, on_close))
        // Connection section
        .child(render_connection_section(theme, state))
        // Model section
        .child(render_model_section(theme, state, on_model_change))
        // Token usage section
        .child(render_token_section(theme, &state.token_usage))
        // Active tools section
        .when(!state.active_tools.is_empty(), |el| {
            el.child(render_tools_section(theme, &state.active_tools))
        })
        // Error section
        .when_some(state.last_error.clone(), |el, error| {
            el.child(render_error_section(theme, &error))
        })
}

/// Render expanded header
fn render_expanded_header(
    _theme: &Theme,
    state: &AgentStatusState,
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
                .child(render_connection_dot(&state.connection))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::text())
                        .child("Agent Status"),
                ),
        )
        .child(
            div()
                .id("close-status")
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
                ),
        )
}

/// Render connection section
fn render_connection_section(_theme: &Theme, state: &AgentStatusState) -> Div {
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
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay0())
                        .child("CONNECTION"),
                )
                .child(
                    div().flex().items_center().gap(px(6.0)).child(
                        div()
                            .text_size(px(13.0))
                            .text_color(state.connection.color())
                            .child(state.connection.label()),
                    ),
                ),
        )
        // Latency
        .when_some(state.latency_ms, |el, latency| {
            el.child(
                div().flex().items_center().gap(px(4.0)).child(
                    div()
                        .text_size(px(12.0))
                        .text_color(if latency < 100 {
                            CatppuccinMocha::green()
                        } else if latency < 300 {
                            CatppuccinMocha::yellow()
                        } else {
                            CatppuccinMocha::red()
                        })
                        .child(format!("{}ms", latency)),
                ),
            )
        })
}

/// Render model section
fn render_model_section<F>(_theme: &Theme, state: &AgentStatusState, on_model_change: F) -> Div
where
    F: Fn(&str) + Clone + 'static,
{
    div()
        .px(px(16.0))
        .py(px(12.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        // Header
        .child(
            div()
                .text_size(px(10.0))
                .text_color(CatppuccinMocha::overlay0())
                .child("MODEL"),
        )
        // Current model
        .child(
            div().flex().items_center().justify_between().child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .size(px(24.0))
                            .rounded(px(6.0))
                            .bg(state.model.provider_color().opacity(0.2))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(state.model.provider_color())
                                    .child("A"), // Anthropic
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(CatppuccinMocha::text())
                                    .child(state.model.name.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::overlay1())
                                    .child(format!(
                                        "{}K context",
                                        state.model.context_window / 1000
                                    )),
                            ),
                    ),
            ),
        )
        // Model selector (simplified)
        .child(
            div()
                .flex()
                .gap(px(4.0))
                .children(state.available_models.iter().map(|model| {
                    let callback = on_model_change.clone();
                    let model_id = model.id.clone();
                    let is_current = model.is_current;

                    div()
                        .id(format!("model-{}", model.id))
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(if is_current {
                            model.provider_color().opacity(0.2)
                        } else {
                            CatppuccinMocha::surface0()
                        })
                        .border_1()
                        .border_color(if is_current {
                            model.provider_color().opacity(0.4)
                        } else {
                            CatppuccinMocha::surface1()
                        })
                        .cursor_pointer()
                        .hover(|s| s.bg(CatppuccinMocha::surface1()))
                        .on_click(move |_event, _window, _cx| {
                            callback(&model_id);
                        })
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(if is_current {
                                    CatppuccinMocha::text()
                                } else {
                                    CatppuccinMocha::subtext0()
                                })
                                .child(
                                    model
                                        .name
                                        .split_whitespace()
                                        .last()
                                        .unwrap_or(&model.name)
                                        .to_string(),
                                ),
                        )
                })),
        )
}

/// Render token usage section
fn render_token_section(_theme: &Theme, usage: &TokenUsage) -> Div {
    let percent = usage.usage_percent();
    let color = usage.usage_color();

    div()
        .px(px(16.0))
        .py(px(12.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay0())
                        .child("TOKEN USAGE"),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay1())
                        .child(format!(
                            "{} / {}",
                            TokenUsage::format_tokens(usage.total_tokens),
                            TokenUsage::format_tokens(usage.token_limit)
                        )),
                ),
        )
        // Progress bar
        .child(
            div()
                .w_full()
                .h(px(6.0))
                .rounded_full()
                .bg(CatppuccinMocha::surface1())
                .child(
                    div()
                        .h_full()
                        .rounded_full()
                        .bg(color)
                        .w(px(percent * 2.88)), // Scale to container width
                ),
        )
        // Details
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .flex()
                        .gap(px(12.0))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .text_size(px(9.0))
                                        .text_color(CatppuccinMocha::overlay0())
                                        .child("Input"),
                                )
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(CatppuccinMocha::subtext1())
                                        .child(TokenUsage::format_tokens(usage.input_tokens)),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .text_size(px(9.0))
                                        .text_color(CatppuccinMocha::overlay0())
                                        .child("Output"),
                                )
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(CatppuccinMocha::subtext1())
                                        .child(TokenUsage::format_tokens(usage.output_tokens)),
                                ),
                        ),
                )
                // Cost estimate
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_end()
                        .child(
                            div()
                                .text_size(px(9.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Est. Cost"),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(CatppuccinMocha::green())
                                .child(format!("${:.4}", usage.estimated_cost)),
                        ),
                ),
        )
}

/// Render active tools section
fn render_tools_section(theme: &Theme, tools: &[ActiveTool]) -> Div {
    div()
        .px(px(16.0))
        .py(px(12.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .border_b_1()
        .border_color(CatppuccinMocha::surface0())
        // Header
        .child(
            div()
                .text_size(px(10.0))
                .text_color(CatppuccinMocha::overlay0())
                .child("ACTIVE TOOLS"),
        )
        // Tools list
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .children(tools.iter().map(|tool| render_tool_item(theme, tool))),
        )
}

/// Render a single tool item
fn render_tool_item(_theme: &Theme, tool: &ActiveTool) -> Div {
    let color = tool.status.color();

    div()
        .flex()
        .items_center()
        .justify_between()
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .bg(CatppuccinMocha::surface0())
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                // Status indicator
                .child(div().size(px(6.0)).rounded_full().bg(color))
                // Tool name
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(CatppuccinMocha::subtext1())
                        .child(tool.name.clone()),
                ),
        )
        // Duration
        .when_some(tool.duration_ms, |el, duration| {
            el.child(
                div()
                    .text_size(px(10.0))
                    .text_color(CatppuccinMocha::overlay1())
                    .child(format!("{}ms", duration)),
            )
        })
}

/// Render error section
fn render_error_section(_theme: &Theme, error: &str) -> Div {
    div()
        .px(px(16.0))
        .py(px(12.0))
        .bg(CatppuccinMocha::red().opacity(0.1))
        .child(
            div()
                .flex()
                .items_start()
                .gap(px(8.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(CatppuccinMocha::red())
                        .child("!"),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(CatppuccinMocha::red())
                                .child("Error"),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(CatppuccinMocha::subtext0())
                                .child(error.to_string()),
                        ),
                ),
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

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_status() {
        let status = AgentConnectionStatus::Connected;
        assert!(status.is_connected());
        assert!(!status.is_busy());

        let status = AgentConnectionStatus::Connecting;
        assert!(!status.is_connected());
        assert!(status.is_busy());
    }

    #[test]
    fn test_token_usage() {
        let mut usage = TokenUsage::new(100_000);
        usage.add_usage(1000, 500, 0.01);

        assert_eq!(usage.total_tokens, 1500);
        assert_eq!(usage.request_count, 1);
        assert!(usage.usage_percent() < 2.0);
    }

    #[test]
    fn test_model_info() {
        let model = ModelInfo::claude_opus();
        assert_eq!(model.provider, "anthropic");
        assert!(model.is_current);
    }

    #[test]
    fn test_agent_status_state() {
        let mut state = AgentStatusState::new();
        assert_eq!(state.connection, AgentConnectionStatus::Disconnected);

        state.set_connection(AgentConnectionStatus::Connected);
        assert!(state.connection.is_connected());

        state.add_active_tool(ActiveTool::new("t1".to_string(), "test_tool".to_string()));
        assert_eq!(state.active_tools.len(), 1);
    }

    #[test]
    fn test_format_tokens() {
        assert_eq!(TokenUsage::format_tokens(500), "500");
        assert_eq!(TokenUsage::format_tokens(1500), "1.5K");
        assert_eq!(TokenUsage::format_tokens(1_500_000), "1.5M");
    }

    #[test]
    fn test_get_first_running_tool() {
        let mut state = AgentStatusState::new();

        // No running tools initially
        assert!(state.get_first_running_tool().is_none());

        // Add a pending tool
        let tool1 = ActiveTool::new("t1".to_string(), "pending_tool".to_string());
        state.add_active_tool(tool1);
        assert!(state.get_first_running_tool().is_none());

        // Add a running tool
        let mut tool2 = ActiveTool::new("t2".to_string(), "running_tool".to_string());
        tool2.start();
        state.add_active_tool(tool2);

        let first = state.get_first_running_tool();
        assert!(first.is_some());
        assert_eq!(first.unwrap().name, "running_tool");
    }

    #[test]
    fn test_get_running_tools() {
        let mut state = AgentStatusState::new();

        // Add mixed status tools
        let tool1 = ActiveTool::new("t1".to_string(), "pending".to_string());
        state.add_active_tool(tool1);

        let mut tool2 = ActiveTool::new("t2".to_string(), "running1".to_string());
        tool2.start();
        state.add_active_tool(tool2);

        let mut tool3 = ActiveTool::new("t3".to_string(), "running2".to_string());
        tool3.start();
        state.add_active_tool(tool3);

        let running = state.get_running_tools();
        assert_eq!(running.len(), 2);
    }

    #[test]
    fn test_truncate_tool_name() {
        assert_eq!(truncate_tool_name("short", 10), "short");
        assert_eq!(
            truncate_tool_name("very_long_tool_name", 10),
            "very_long_..."
        );
        assert_eq!(truncate_tool_name("exact_size", 10), "exact_size");
    }
}
