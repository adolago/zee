//! Agent Panel for Stanley GUI
//!
//! Provides an AI agent chat interface with:
//! - Chat interface with streaming responses
//! - Tool call visualization and status
//! - Markdown rendering for responses
//! - Real-time message streaming
//! - WebSocket sync with Stanley agent
//! - Rich widgets (charts, tables, citations, code blocks)
//! - Quick actions and drag-drop symbols
//! - Context management sidebar
//! - Undo/redo and offline queue
//! - Keyboard shortcuts (Cmd+K command palette)
//! - Voice input placeholder
//! - Threading support
//! - Message rating

// Allow dead code in this module - many items are placeholders for future features
// including: streaming methods, threading, voice input, command palette, message rating
#![allow(dead_code)]

use crate::agent_status::{
    render_status_compact, ActiveTool, AgentConnectionStatus, AgentStatusState,
};
// Agent chat now uses agent_core daemon instead of ZeeApiClient
// use crate::api::ZeeApiClient;
// Note: Agent-core types are used in app.rs for chat integration
#[allow(unused_imports)]
use crate::agent_core::{AgentCoreClient, Persona, StreamEvent};
use crate::components::modals::render_tooltip as render_tooltip_standard;
use crate::components::streaming::{
    parse_markdown, CatppuccinMocha, MarkdownLine, StreamingState, SyntaxHighlighter,
};
use crate::sync::{ConnectionStatus, SyncClientState, SyncEvent, SyncEventType};
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};

// =============================================================================
// Citation Types (inline to avoid agent_widgets compatibility issues)
// =============================================================================

/// Citation source type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CitationSource {
    SECFiling,
    EarningsCall,
    NewsArticle,
    ResearchReport,
    CompanyWebsite,
    DataProvider,
    Other,
}

impl CitationSource {
    pub fn label(&self) -> &'static str {
        match self {
            CitationSource::SECFiling => "SEC Filing",
            CitationSource::EarningsCall => "Earnings Call",
            CitationSource::NewsArticle => "News",
            CitationSource::ResearchReport => "Research",
            CitationSource::CompanyWebsite => "Company",
            CitationSource::DataProvider => "Data",
            CitationSource::Other => "Source",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            CitationSource::SECFiling => "📄",
            CitationSource::EarningsCall => "📞",
            CitationSource::NewsArticle => "📰",
            CitationSource::ResearchReport => "📊",
            CitationSource::CompanyWebsite => "🌐",
            CitationSource::DataProvider => "💾",
            CitationSource::Other => "🔗",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            CitationSource::SECFiling => CatppuccinMocha::blue(),
            CitationSource::EarningsCall => CatppuccinMocha::green(),
            CitationSource::NewsArticle => CatppuccinMocha::peach(),
            CitationSource::ResearchReport => CatppuccinMocha::mauve(),
            CitationSource::CompanyWebsite => CatppuccinMocha::teal(),
            CitationSource::DataProvider => CatppuccinMocha::yellow(),
            CitationSource::Other => CatppuccinMocha::overlay1(),
        }
    }
}

/// Citation reference
#[derive(Debug, Clone)]
pub struct Citation {
    pub id: String,
    pub source: CitationSource,
    pub title: String,
    pub url: Option<String>,
    pub date: Option<String>,
    pub snippet: Option<String>,
}

impl Citation {
    pub fn new(source: CitationSource, title: &str) -> Self {
        Self {
            id: format!("cite-{}", uuid_v4()),
            source,
            title: title.to_string(),
            url: None,
            date: None,
            snippet: None,
        }
    }

    pub fn with_url(mut self, url: &str) -> Self {
        self.url = Some(url.to_string());
        self
    }

    pub fn with_date(mut self, date: &str) -> Self {
        self.date = Some(date.to_string());
        self
    }
}

// =============================================================================
// Agent Types
// =============================================================================

/// Message role in conversation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

impl MessageRole {
    pub fn label(&self) -> &'static str {
        match self {
            MessageRole::User => "You",
            MessageRole::Assistant => "Stanley Agent",
            MessageRole::System => "System",
            MessageRole::Tool => "Tool",
        }
    }
}

/// Tool execution status
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolStatus {
    Pending,
    Running,
    Success,
    Error(String),
}

impl ToolStatus {
    pub fn label(&self) -> &'static str {
        match self {
            ToolStatus::Pending => "Pending",
            ToolStatus::Running => "Running...",
            ToolStatus::Success => "Completed",
            ToolStatus::Error(_) => "Error",
        }
    }
}

/// A tool call made by the agent
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    pub result: Option<String>,
    pub status: ToolStatus,
    pub expanded: bool,
}

impl ToolCall {
    pub fn new(id: String, name: String, arguments: String) -> Self {
        Self {
            id,
            name,
            arguments,
            result: None,
            status: ToolStatus::Pending,
            expanded: false,
        }
    }
}

/// A message in the conversation
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub timestamp: String,
    pub is_streaming: bool,
    /// Streaming state for progressive text reveal and cursor animation
    pub streaming_state: Option<StreamingState>,
    /// Citations referenced in this message
    pub citations: Vec<Citation>,
}

impl ChatMessage {
    pub fn new_user(content: String) -> Self {
        Self {
            id: uuid_v4(),
            role: MessageRole::User,
            content,
            tool_calls: Vec::new(),
            timestamp: format_now(),
            is_streaming: false,
            streaming_state: None,
            citations: Vec::new(),
        }
    }

    pub fn new_assistant(content: String) -> Self {
        Self {
            id: uuid_v4(),
            role: MessageRole::Assistant,
            content,
            tool_calls: Vec::new(),
            timestamp: format_now(),
            is_streaming: false,
            streaming_state: None,
            citations: Vec::new(),
        }
    }

    pub fn new_assistant_streaming() -> Self {
        let mut streaming_state = StreamingState::new();
        streaming_state.start();
        Self {
            id: uuid_v4(),
            role: MessageRole::Assistant,
            content: String::new(),
            tool_calls: Vec::new(),
            timestamp: format_now(),
            is_streaming: true,
            streaming_state: Some(streaming_state),
            citations: Vec::new(),
        }
    }

    /// Append content to a streaming message
    pub fn append_content(&mut self, text: &str) {
        self.content.push_str(text);
        if let Some(ref mut state) = self.streaming_state {
            state.append(text);
        }
    }

    /// Update the streaming animation (call in render loop)
    pub fn update_streaming_animation(&mut self) {
        if let Some(ref mut state) = self.streaming_state {
            state.update_animation();
        }
    }

    /// Finish streaming
    pub fn finish_streaming(&mut self) {
        self.is_streaming = false;
        if let Some(ref mut state) = self.streaming_state {
            state.finish();
        }
    }

    /// Get visible content for streaming messages
    pub fn visible_content(&self) -> &str {
        if let Some(ref state) = self.streaming_state {
            state.visible_content()
        } else {
            &self.content
        }
    }

    /// Check if cursor should be shown (for streaming messages)
    pub fn should_show_cursor(&self) -> bool {
        if let Some(ref state) = self.streaming_state {
            state.should_show_cursor()
        } else {
            false
        }
    }

    /// Skip the typing animation and show all content
    pub fn skip_animation(&mut self) {
        if let Some(ref mut state) = self.streaming_state {
            state.skip_animation();
        }
    }
}

/// Agent connection status
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum AgentStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Responding,
    Error(String),
}

impl AgentStatus {
    pub fn label(&self) -> &'static str {
        match self {
            AgentStatus::Disconnected => "Disconnected",
            AgentStatus::Connecting => "Connecting...",
            AgentStatus::Connected => "Ready",
            AgentStatus::Responding => "Thinking...",
            AgentStatus::Error(_) => "Error",
        }
    }

    pub fn is_busy(&self) -> bool {
        matches!(self, AgentStatus::Connecting | AgentStatus::Responding)
    }
}

// =============================================================================
// Agent State
// =============================================================================

/// State for the agent panel
pub struct AgentState {
    /// Current agent status
    pub status: AgentStatus,
    /// Conversation messages
    pub messages: Vec<ChatMessage>,
    /// Current input text
    pub input_text: String,
    /// Whether to show tool calls expanded
    pub show_tools: bool,
    /// System prompt / context
    pub system_prompt: String,
    /// Agent capabilities description
    pub capabilities: Vec<String>,
    /// Sync client state for WebSocket communication
    pub sync_state: SyncClientState,
    /// Recent sync events from agent
    pub sync_events: Vec<SyncEvent>,
    // =========================================================================
    // Agent Status Widget State
    // =========================================================================
    /// Agent status widget state (connection, model, tokens, tools)
    pub status_widget: AgentStatusState,
    /// Whether the status widget is expanded
    pub status_widget_expanded: bool,
    // =========================================================================
    // Deep Integration Features (Phase 4)
    // =========================================================================
    /// Whether command palette (Cmd+K) is open
    pub command_palette_open: bool,
    /// Command palette search text
    pub command_palette_search: String,
    /// Selected command index
    pub selected_command_index: usize,
    /// Voice input enabled
    pub voice_input_enabled: bool,
    /// Voice input active (recording)
    pub voice_input_active: bool,
    /// Threading enabled
    pub threading_enabled: bool,
    /// Active thread ID (parent message)
    pub active_thread_id: Option<String>,
    /// Thread replies count per message
    pub thread_reply_counts: std::collections::HashMap<String, usize>,
    /// Message ratings
    pub message_ratings: std::collections::HashMap<String, MessageRating>,
    /// Keyboard shortcuts enabled
    pub shortcuts_enabled: bool,
    /// Context sidebar visible
    pub context_sidebar_visible: bool,
    /// Action bar visible
    pub action_bar_visible: bool,
}

/// Rating for a message
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRating {
    Positive,
    Negative,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            status: AgentStatus::Connected,
            messages: vec![
                ChatMessage {
                    id: uuid_v4(),
                    role: MessageRole::Assistant,
                    content: "Hello! I'm the Stanley AI Agent. I can help you analyze investments, \
                        research companies, review portfolio performance, and execute analysis workflows. \
                        What would you like to explore today?".to_string(),
                    tool_calls: Vec::new(),
                    timestamp: format_now(),
                    is_streaming: false,
                    streaming_state: None,
                    citations: Vec::new(),
                },
            ],
            input_text: String::new(),
            show_tools: true,
            system_prompt: "You are Stanley, an AI assistant specialized in institutional \
                investment analysis, money flow tracking, and portfolio management.".to_string(),
            capabilities: vec![
                "Market Analysis".to_string(),
                "Portfolio Review".to_string(),
                "Money Flow Tracking".to_string(),
                "Institutional Holdings".to_string(),
                "Research Reports".to_string(),
                "SEC Filings".to_string(),
            ],
            sync_state: SyncClientState::default(),
            sync_events: Vec::new(),
            // Agent status widget state
            status_widget: AgentStatusState::default(),
            status_widget_expanded: false,
            // Phase 4 deep integration features
            command_palette_open: false,
            command_palette_search: String::new(),
            selected_command_index: 0,
            voice_input_enabled: false, // Placeholder - not implemented yet
            voice_input_active: false,
            threading_enabled: true,
            active_thread_id: None,
            thread_reply_counts: std::collections::HashMap::new(),
            message_ratings: std::collections::HashMap::new(),
            shortcuts_enabled: true,
            context_sidebar_visible: false,
            action_bar_visible: true,
        }
    }
}

impl AgentState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a user message
    pub fn add_user_message(&mut self, content: String) {
        self.messages.push(ChatMessage::new_user(content));
    }

    /// Add an assistant message
    pub fn add_assistant_message(&mut self, content: String) {
        self.messages.push(ChatMessage::new_assistant(content));
    }

    /// Start streaming an assistant response
    pub fn start_streaming(&mut self) {
        self.status = AgentStatus::Responding;
        self.messages.push(ChatMessage::new_assistant_streaming());
    }

    /// Append content to the current streaming message
    pub fn append_streaming(&mut self, content: &str) {
        if let Some(msg) = self.messages.last_mut() {
            if msg.is_streaming {
                msg.append_content(content);
            }
        }
    }

    /// Update streaming animation (call in render loop for smooth animation)
    pub fn update_streaming_animation(&mut self) {
        if let Some(msg) = self.messages.last_mut() {
            if msg.is_streaming {
                msg.update_streaming_animation();
            }
        }
    }

    /// Skip the current streaming animation
    pub fn skip_streaming_animation(&mut self) {
        if let Some(msg) = self.messages.last_mut() {
            if msg.is_streaming {
                msg.skip_animation();
            }
        }
    }

    /// Finish streaming
    pub fn finish_streaming(&mut self) {
        if let Some(msg) = self.messages.last_mut() {
            if msg.is_streaming {
                msg.finish_streaming();
            }
        }
        self.status = AgentStatus::Connected;
    }

    /// Cancel streaming (user-initiated)
    pub fn cancel_streaming(&mut self) {
        if let Some(msg) = self.messages.last_mut() {
            if msg.is_streaming {
                if let Some(ref mut state) = msg.streaming_state {
                    state.cancel();
                }
                msg.is_streaming = false;
            }
        }
        self.status = AgentStatus::Connected;
    }

    /// Get streaming progress for the current message (0.0 to 1.0)
    pub fn streaming_progress(&self) -> Option<f32> {
        if let Some(msg) = self.messages.last() {
            if msg.is_streaming {
                if let Some(ref state) = msg.streaming_state {
                    return Some(state.progress());
                }
            }
        }
        None
    }

    /// Get streaming stats for the current message
    pub fn streaming_stats(&self) -> Option<(usize, f32, std::time::Duration)> {
        if let Some(msg) = self.messages.last() {
            if let Some(ref state) = msg.streaming_state {
                return Some((state.token_count, state.tokens_per_second, state.duration()));
            }
        }
        None
    }

    /// Add a tool call to the current message
    pub fn add_tool_call(&mut self, tool_call: ToolCall) {
        if let Some(msg) = self.messages.last_mut() {
            msg.tool_calls.push(tool_call);
        }
    }

    /// Update tool call status
    pub fn update_tool_status(
        &mut self,
        tool_id: &str,
        status: ToolStatus,
        result: Option<String>,
    ) {
        for msg in self.messages.iter_mut().rev() {
            for tool in msg.tool_calls.iter_mut() {
                if tool.id == tool_id {
                    tool.status = status;
                    tool.result = result;
                    return;
                }
            }
        }
    }

    /// Clear conversation history
    pub fn clear_history(&mut self) {
        self.messages.clear();
        self.add_assistant_message("Conversation cleared. How can I help you?".to_string());
    }

    // =========================================================================
    // Sync Methods
    // =========================================================================

    /// Handle incoming sync event from WebSocket
    pub fn handle_sync_event(&mut self, event: SyncEvent) {
        // Add to recent events
        if self.sync_events.len() >= 50 {
            self.sync_events.remove(0);
        }
        self.sync_events.push(event.clone());

        // Handle specific event types
        match event.event_type {
            SyncEventType::AgentQueryComplete => {
                // Agent finished processing a query
                if let Some(data) = &event.data {
                    if let Some(content) = data.get("content").and_then(|v| v.as_str()) {
                        self.add_assistant_message(content.to_string());
                    }
                }
                self.finish_streaming();
            }
            SyncEventType::AgentToolCall => {
                // Agent is calling a tool
                if let Some(data) = &event.data {
                    let tool_name = data
                        .get("toolName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let tool_id = data
                        .get("toolId")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&event.id)
                        .to_string();
                    let arguments = data
                        .get("arguments")
                        .map(|v| v.to_string())
                        .unwrap_or_default();

                    // Add to message tool calls
                    self.add_tool_call(ToolCall::new(
                        tool_id.clone(),
                        tool_name.clone(),
                        arguments,
                    ));

                    // Also update status widget with active tool
                    self.add_active_tool_to_status(&tool_id, &tool_name);
                }
            }
            SyncEventType::AgentToolResult => {
                // Tool execution completed
                if let Some(data) = &event.data {
                    let tool_id = data
                        .get("toolId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let result = data.get("result").map(|v| v.to_string());
                    let success = data
                        .get("success")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    let duration_ms = data.get("durationMs").and_then(|v| v.as_u64()).unwrap_or(0);

                    let status = if success {
                        ToolStatus::Success
                    } else {
                        ToolStatus::Error(
                            data.get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Unknown error")
                                .to_string(),
                        )
                    };

                    // Update message tool status
                    self.update_tool_status(&tool_id, status, result);

                    // Also update status widget
                    self.update_tool_in_status(&tool_id, success, duration_ms);
                }
            }
            SyncEventType::ResearchComplete => {
                // Research query completed
                if let Some(data) = &event.data {
                    let symbol = data.get("symbol").and_then(|v| v.as_str()).unwrap_or("N/A");
                    let summary = data
                        .get("summary")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Research completed.");

                    self.add_assistant_message(format!(
                        "Research complete for {}:\n\n{}",
                        symbol, summary
                    ));
                }
            }
            SyncEventType::AlertTriggered => {
                // Alert was triggered
                if let Some(data) = &event.data {
                    let message = data
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Alert triggered");
                    let severity = data
                        .get("severity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("info");

                    self.add_assistant_message(format!(
                        "[{}] {}",
                        severity.to_uppercase(),
                        message
                    ));
                }
            }
            _ => {
                // Other events are stored but don't affect chat
            }
        }
    }

    /// Get sync connection status
    pub fn sync_status(&self) -> ConnectionStatus {
        self.sync_state.status
    }

    /// Update sync connection status
    pub fn set_sync_status(&mut self, status: ConnectionStatus) {
        self.sync_state.status = status;
    }

    /// Get recent sync events
    pub fn get_sync_events(&self) -> &[SyncEvent] {
        &self.sync_events
    }

    /// Get sync events by type
    pub fn get_sync_events_by_type(&self, event_type: SyncEventType) -> Vec<&SyncEvent> {
        self.sync_events
            .iter()
            .filter(|e| e.event_type == event_type)
            .collect()
    }

    /// Clear sync events
    pub fn clear_sync_events(&mut self) {
        self.sync_events.clear();
    }

    /// Create a view opened event for syncing
    pub fn create_view_opened_event(&self) -> SyncEvent {
        SyncEvent::view_opened("agent", "agent", None)
    }

    /// Create a symbol selected event for syncing
    pub fn create_symbol_selected_event(&self, symbol: &str, previous: Option<&str>) -> SyncEvent {
        SyncEvent::symbol_selected(symbol, "agent", previous)
    }

    // =========================================================================
    // Status Widget Methods
    // =========================================================================

    /// Update the status widget connection from sync status
    pub fn update_status_from_sync(&mut self, sync_status: ConnectionStatus) {
        let agent_status = match sync_status {
            ConnectionStatus::Disconnected => AgentConnectionStatus::Disconnected,
            ConnectionStatus::Connecting => AgentConnectionStatus::Connecting,
            ConnectionStatus::Connected => AgentConnectionStatus::Connected,
            ConnectionStatus::Reconnecting => AgentConnectionStatus::Reconnecting,
            ConnectionStatus::Error => AgentConnectionStatus::Error,
        };
        self.status_widget.set_connection(agent_status);

        // Also update the legacy status field for compatibility
        self.status = match sync_status {
            ConnectionStatus::Disconnected => AgentStatus::Disconnected,
            ConnectionStatus::Connecting => AgentStatus::Connecting,
            ConnectionStatus::Connected => AgentStatus::Connected,
            ConnectionStatus::Reconnecting => AgentStatus::Connecting,
            ConnectionStatus::Error => AgentStatus::Error("Connection error".to_string()),
        };
    }

    /// Update token usage from an agent response
    pub fn update_token_usage(&mut self, input_tokens: u64, output_tokens: u64, cost: f64) {
        self.status_widget
            .token_usage
            .add_usage(input_tokens, output_tokens, cost);
    }

    /// Reset token usage (e.g., at start of new session)
    pub fn reset_token_usage(&mut self) {
        self.status_widget.token_usage.reset();
    }

    /// Add an active tool to the status widget
    pub fn add_active_tool_to_status(&mut self, tool_id: &str, tool_name: &str) {
        let mut tool = ActiveTool::new(tool_id.to_string(), tool_name.to_string());
        tool.start();
        self.status_widget.add_active_tool(tool);
    }

    /// Update tool status in the widget
    pub fn update_tool_in_status(&mut self, tool_id: &str, success: bool, duration_ms: u64) {
        self.status_widget
            .update_tool(tool_id, success, duration_ms);
    }

    /// Clear completed tools from status widget
    pub fn clear_completed_tools_from_status(&mut self) {
        self.status_widget.clear_completed_tools();
    }

    /// Set the current model in the status widget
    pub fn set_model(&mut self, model_id: &str) {
        self.status_widget.set_model(model_id);
    }

    /// Toggle status widget expanded state
    pub fn toggle_status_widget(&mut self) {
        self.status_widget_expanded = !self.status_widget_expanded;
        self.status_widget.is_expanded = self.status_widget_expanded;
    }

    /// Set latency in status widget
    pub fn set_latency(&mut self, latency_ms: u32) {
        self.status_widget.set_latency(latency_ms);
    }

    /// Set error in status widget
    pub fn set_status_error(&mut self, error: String) {
        self.status_widget.set_error(error);
    }

    /// Clear error from status widget
    pub fn clear_status_error(&mut self) {
        self.status_widget.clear_error();
    }

    // =========================================================================
    // Phase 4: Deep Integration Features
    // =========================================================================

    /// Toggle command palette (Cmd+K)
    pub fn toggle_command_palette(&mut self) {
        self.command_palette_open = !self.command_palette_open;
        if !self.command_palette_open {
            self.command_palette_search.clear();
            self.selected_command_index = 0;
        }
    }

    /// Open command palette
    pub fn open_command_palette(&mut self) {
        self.command_palette_open = true;
        self.command_palette_search.clear();
        self.selected_command_index = 0;
    }

    /// Close command palette
    pub fn close_command_palette(&mut self) {
        self.command_palette_open = false;
        self.command_palette_search.clear();
        self.selected_command_index = 0;
    }

    /// Get available commands filtered by search
    pub fn get_filtered_commands(&self) -> Vec<AgentCommand> {
        let all_commands = AgentCommand::all();
        if self.command_palette_search.is_empty() {
            return all_commands;
        }
        let search = self.command_palette_search.to_lowercase();
        all_commands
            .into_iter()
            .filter(|cmd| {
                cmd.label.to_lowercase().contains(&search)
                    || cmd.description.to_lowercase().contains(&search)
                    || cmd
                        .shortcut
                        .as_ref()
                        .map(|s| s.to_lowercase().contains(&search))
                        .unwrap_or(false)
            })
            .collect()
    }

    /// Toggle voice input
    pub fn toggle_voice_input(&mut self) {
        if self.voice_input_enabled {
            self.voice_input_active = !self.voice_input_active;
        }
    }

    /// Start a thread from a message
    pub fn start_thread(&mut self, message_id: &str) {
        self.active_thread_id = Some(message_id.to_string());
    }

    /// End current thread
    pub fn end_thread(&mut self) {
        self.active_thread_id = None;
    }

    /// Add reply to thread
    pub fn add_thread_reply(&mut self, parent_id: &str) {
        let count = self
            .thread_reply_counts
            .entry(parent_id.to_string())
            .or_insert(0);
        *count += 1;
    }

    /// Get thread reply count
    pub fn get_thread_reply_count(&self, message_id: &str) -> usize {
        self.thread_reply_counts
            .get(message_id)
            .copied()
            .unwrap_or(0)
    }

    /// Rate a message
    pub fn rate_message(&mut self, message_id: &str, rating: MessageRating) {
        self.message_ratings.insert(message_id.to_string(), rating);
    }

    /// Get message rating
    pub fn get_message_rating(&self, message_id: &str) -> Option<MessageRating> {
        self.message_ratings.get(message_id).copied()
    }

    /// Clear message rating
    pub fn clear_message_rating(&mut self, message_id: &str) {
        self.message_ratings.remove(message_id);
    }

    /// Toggle context sidebar
    pub fn toggle_context_sidebar(&mut self) {
        self.context_sidebar_visible = !self.context_sidebar_visible;
    }

    /// Toggle action bar
    pub fn toggle_action_bar(&mut self) {
        self.action_bar_visible = !self.action_bar_visible;
    }
}

// =============================================================================
// Command Palette
// =============================================================================

/// Agent command for command palette
#[derive(Debug, Clone)]
pub struct AgentCommand {
    pub id: String,
    pub label: String,
    pub description: String,
    pub shortcut: Option<String>,
    pub category: CommandCategory,
    pub action: CommandAction,
}

/// Command category
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandCategory {
    Analysis,
    Navigation,
    Context,
    Export,
    Settings,
    Help,
}

impl CommandCategory {
    pub fn label(&self) -> &'static str {
        match self {
            CommandCategory::Analysis => "Analysis",
            CommandCategory::Navigation => "Navigation",
            CommandCategory::Context => "Context",
            CommandCategory::Export => "Export",
            CommandCategory::Settings => "Settings",
            CommandCategory::Help => "Help",
        }
    }

    pub fn color(&self) -> Hsla {
        match self {
            CommandCategory::Analysis => CatppuccinMocha::blue(),
            CommandCategory::Navigation => CatppuccinMocha::green(),
            CommandCategory::Context => CatppuccinMocha::mauve(),
            CommandCategory::Export => CatppuccinMocha::peach(),
            CommandCategory::Settings => CatppuccinMocha::teal(),
            CommandCategory::Help => CatppuccinMocha::yellow(),
        }
    }
}

/// Command action type
#[derive(Debug, Clone)]
pub enum CommandAction {
    AnalyzeSymbol(String),
    CompareSymbols,
    ResearchSymbol(String),
    ToggleContext,
    ClearConversation,
    ExportChat,
    CopyLastResponse,
    OpenSettings,
    ShowHelp,
    ToggleVoice,
    NewThread,
    Custom(String),
}

impl AgentCommand {
    /// Get all available commands
    pub fn all() -> Vec<AgentCommand> {
        vec![
            AgentCommand {
                id: "analyze".to_string(),
                label: "Analyze Symbol".to_string(),
                description: "Deep analysis of a stock or ETF".to_string(),
                shortcut: Some("Cmd+1".to_string()),
                category: CommandCategory::Analysis,
                action: CommandAction::AnalyzeSymbol(String::new()),
            },
            AgentCommand {
                id: "compare".to_string(),
                label: "Compare Symbols".to_string(),
                description: "Compare multiple stocks side by side".to_string(),
                shortcut: Some("Cmd+2".to_string()),
                category: CommandCategory::Analysis,
                action: CommandAction::CompareSymbols,
            },
            AgentCommand {
                id: "research".to_string(),
                label: "Research Report".to_string(),
                description: "Generate full research report".to_string(),
                shortcut: Some("Cmd+3".to_string()),
                category: CommandCategory::Analysis,
                action: CommandAction::ResearchSymbol(String::new()),
            },
            AgentCommand {
                id: "toggle-context".to_string(),
                label: "Toggle Context Sidebar".to_string(),
                description: "Show/hide context sources".to_string(),
                shortcut: Some("Cmd+Shift+C".to_string()),
                category: CommandCategory::Context,
                action: CommandAction::ToggleContext,
            },
            AgentCommand {
                id: "clear".to_string(),
                label: "Clear Conversation".to_string(),
                description: "Start a fresh conversation".to_string(),
                shortcut: Some("Cmd+Shift+X".to_string()),
                category: CommandCategory::Navigation,
                action: CommandAction::ClearConversation,
            },
            AgentCommand {
                id: "export".to_string(),
                label: "Export Conversation".to_string(),
                description: "Export chat as markdown or PDF".to_string(),
                shortcut: Some("Cmd+E".to_string()),
                category: CommandCategory::Export,
                action: CommandAction::ExportChat,
            },
            AgentCommand {
                id: "copy-last".to_string(),
                label: "Copy Last Response".to_string(),
                description: "Copy agent's last response".to_string(),
                shortcut: Some("Cmd+Shift+C".to_string()),
                category: CommandCategory::Export,
                action: CommandAction::CopyLastResponse,
            },
            AgentCommand {
                id: "settings".to_string(),
                label: "Agent Settings".to_string(),
                description: "Configure agent behavior".to_string(),
                shortcut: Some("Cmd+,".to_string()),
                category: CommandCategory::Settings,
                action: CommandAction::OpenSettings,
            },
            AgentCommand {
                id: "help".to_string(),
                label: "Show Help".to_string(),
                description: "View keyboard shortcuts and help".to_string(),
                shortcut: Some("?".to_string()),
                category: CommandCategory::Help,
                action: CommandAction::ShowHelp,
            },
            AgentCommand {
                id: "voice".to_string(),
                label: "Toggle Voice Input".to_string(),
                description: "Start/stop voice dictation".to_string(),
                shortcut: Some("Cmd+Shift+V".to_string()),
                category: CommandCategory::Settings,
                action: CommandAction::ToggleVoice,
            },
            AgentCommand {
                id: "new-thread".to_string(),
                label: "New Thread".to_string(),
                description: "Start a new conversation thread".to_string(),
                shortcut: Some("Cmd+T".to_string()),
                category: CommandCategory::Navigation,
                action: CommandAction::NewThread,
            },
        ]
    }
}

// =============================================================================
// Agent Panel Rendering
// =============================================================================

/// Render the agent panel view
pub fn render_agent_panel<V: 'static>(
    theme: &Theme,
    state: &AgentState,
    input_text: &str,
    on_clear_input: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    cx: &mut Context<V>,
) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.background)
        // Header
        .child(render_agent_header(theme, state))
        // Messages area
        .child(render_messages_area(theme, state, cx))
        // Input area
        .child(render_input_area(
            theme,
            input_text,
            state.status.is_busy(),
            on_clear_input,
        ))
}

/// Render the agent panel header
fn render_agent_header(theme: &Theme, state: &AgentState) -> impl IntoElement {
    let status_color = match &state.status {
        AgentStatus::Connected => theme.positive,
        AgentStatus::Responding => theme.warning,
        AgentStatus::Connecting => theme.accent,
        AgentStatus::Disconnected => theme.text_muted,
        AgentStatus::Error(_) => theme.negative,
    };

    div()
        .h(px(64.0))
        .px(px(24.0))
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(theme.border_subtle)
        .bg(theme.card_bg)
        // Left: Title and status
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                // Agent icon
                .child(
                    div()
                        .size(px(42.0))
                        .rounded(px(10.0))
                        .bg(theme.accent)
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
                                .child("A"),
                        ),
                )
                // Title and status
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
                                .child("Stanley Agent"),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.0))
                                .child(div().size(px(8.0)).rounded_full().bg(status_color))
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(theme.text_muted)
                                        .child(state.status.label()),
                                ),
                        ),
                ),
        )
        // Center: Status widget (compact view showing connection, model, tokens, tools)
        .child(render_status_compact(theme, &state.status_widget))
        // Right: Action buttons
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                // Capabilities indicator (show fewer when status widget present)
                .child(
                    div().flex().items_center().gap(px(4.0)).children(
                        state
                            .capabilities
                            .iter()
                            .take(2)
                            .map(|cap| {
                                div()
                                    .px(px(8.0))
                                    .py(px(4.0))
                                    .rounded(px(4.0))
                                    .bg(theme.accent_subtle)
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.accent)
                                    .child(cap.clone())
                            })
                            .collect::<Vec<_>>(),
                    ),
                )
                // Clear button
                .child(
                    div()
                        .relative()
                        .group("clear-chat-btn")
                        .child(
                            div()
                                .id("clear-chat")
                                .px(px(12.0))
                                .py(px(6.0))
                                .rounded(px(6.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border_subtle)
                                .text_size(px(12.0))
                                .text_color(theme.text_muted)
                                .cursor_pointer()
                                .hover(|s| s.bg(theme.hover_bg).text_color(theme.text))
                                .child("Clear"),
                        )
                        .child(
                            render_tooltip_standard(theme, "Clear conversation", "clear-chat-btn")
                                .absolute()
                                .top(px(35.0))
                                .right(px(0.0)),
                        ),
                ),
        )
}

/// Render the messages area
fn render_messages_area(
    theme: &Theme,
    state: &AgentState,
    _cx: &mut Context<impl Sized>,
) -> impl IntoElement {
    div()
        .id("agent-messages")
        .flex_grow()
        .overflow_y_scroll()
        .p(px(20.0))
        .flex()
        .flex_col()
        .gap(px(16.0))
        .children(
            state
                .messages
                .iter()
                .map(|msg| render_message(theme, msg, state.show_tools))
                .collect::<Vec<_>>(),
        )
        // Streaming indicator
        .when(state.status == AgentStatus::Responding, |el| {
            el.child(render_streaming_indicator(theme))
        })
}

/// Render a single message
fn render_message(theme: &Theme, message: &ChatMessage, show_tools: bool) -> Div {
    let is_user = message.role == MessageRole::User;
    let is_tool = message.role == MessageRole::Tool;

    let (bg, border, _align) = if is_user {
        (theme.accent_subtle, theme.accent_muted, "flex-end")
    } else if is_tool {
        (theme.warning_subtle, theme.warning, "flex-start")
    } else {
        (theme.card_bg, theme.border_subtle, "flex-start")
    };

    let max_width = if is_user { px(500.0) } else { px(700.0) };

    div()
        .w_full()
        .flex()
        .when(is_user, |el| el.justify_end())
        .child(
            div()
                .max_w(max_width)
                .flex()
                .flex_col()
                .gap(px(8.0))
                // Message header
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .when(is_user, |el| el.justify_end())
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(if is_user {
                                    theme.accent
                                } else {
                                    theme.text_muted
                                })
                                .child(message.role.label()),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child(message.timestamp.clone()),
                        ),
                )
                // Message content - use streaming renderer when streaming is active
                .child(
                    div()
                        .p(px(14.0))
                        .rounded(px(12.0))
                        .bg(bg)
                        .border_1()
                        .border_color(border)
                        .child(render_message_content_dispatch(theme, message)),
                )
                // Citations (if any) - rendered as inline badges
                .when(!message.citations.is_empty(), |el| {
                    el.child(
                        div().flex().flex_wrap().gap(px(6.0)).children(
                            message
                                .citations
                                .iter()
                                .map(render_citation_badge_inline)
                                .collect::<Vec<_>>(),
                        ),
                    )
                })
                // Tool calls (if any) - use enhanced tool call renderer
                .when(show_tools && !message.tool_calls.is_empty(), |el| {
                    el.child(
                        div().flex().flex_col().gap(px(8.0)).children(
                            message
                                .tool_calls
                                .iter()
                                .map(|tool| render_tool_call_enhanced(theme, tool))
                                .collect::<Vec<_>>(),
                        ),
                    )
                }),
        )
}

/// Render a citation badge inline
fn render_citation_badge_inline(citation: &Citation) -> Div {
    let color = citation.source.color();

    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .px(px(6.0))
        .py(px(2.0))
        .rounded(px(4.0))
        .bg(color.opacity(0.12))
        .border_1()
        .border_color(color.opacity(0.25))
        .cursor_pointer()
        .hover(|s| s.bg(color.opacity(0.2)))
        .child(
            div()
                .text_size(px(9.0))
                .font_weight(FontWeight::BOLD)
                .text_color(color)
                .child(citation.source.icon()),
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(CatppuccinMocha::subtext0())
                .child(truncate_text(&citation.title, 20)),
        )
}

/// Render an enhanced tool call with expandable details
fn render_tool_call_enhanced(_theme: &Theme, tool: &ToolCall) -> Div {
    let status_color = match &tool.status {
        ToolStatus::Pending => CatppuccinMocha::overlay1(),
        ToolStatus::Running => CatppuccinMocha::blue(),
        ToolStatus::Success => CatppuccinMocha::green(),
        ToolStatus::Error(_) => CatppuccinMocha::red(),
    };

    div()
        .w_full()
        .rounded(px(8.0))
        .bg(CatppuccinMocha::surface0())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .overflow_hidden()
        // Header (always visible)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .px(px(12.0))
                .py(px(10.0))
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface1()))
                // Left side: icon + name
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        // Status indicator
                        .child(
                            div()
                                .size(px(24.0))
                                .rounded(px(6.0))
                                .bg(status_color.opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(status_color)
                                        .child("T"),
                                ),
                        )
                        // Tool name
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(tool.name.clone()),
                        ),
                )
                // Right side: status badge + expand icon
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Status badge
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(3.0))
                                .rounded(px(4.0))
                                .bg(status_color.opacity(0.15))
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(status_color)
                                        .child(tool.status.label()),
                                ),
                        )
                        // Expand indicator
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(if tool.expanded { "v" } else { ">" }),
                        ),
                ),
        )
        // Expanded content - arguments
        .when(tool.expanded, |el| {
            el.child(
                div()
                    .px(px(12.0))
                    .py(px(10.0))
                    .border_t_1()
                    .border_color(CatppuccinMocha::surface1())
                    .flex()
                    .flex_col()
                    .gap(px(12.0))
                    // Arguments section
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child("Arguments"),
                            )
                            .child(
                                div()
                                    .p(px(8.0))
                                    .rounded(px(6.0))
                                    .bg(CatppuccinMocha::mantle())
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .font_family("monospace")
                                            .text_color(CatppuccinMocha::subtext1())
                                            .child(tool.arguments.clone()),
                                    ),
                            ),
                    ),
            )
        })
        // Result section (if available)
        .when_some(tool.result.clone(), |el, result| {
            el.when(tool.expanded, |el| {
                el.child(
                    div()
                        .px(px(12.0))
                        .pb(px(10.0))
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Result"),
                        )
                        .child(
                            div()
                                .p(px(8.0))
                                .rounded(px(6.0))
                                .bg(CatppuccinMocha::mantle())
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .font_family("monospace")
                                        .text_color(CatppuccinMocha::green())
                                        .child(truncate_text(&result, 500)),
                                ),
                        ),
                )
            })
        })
        // Error section (if error status)
        .when(
            matches!(&tool.status, ToolStatus::Error(_)) && tool.expanded,
            |el| {
                if let ToolStatus::Error(ref err) = tool.status {
                    el.child(
                        div()
                            .px(px(12.0))
                            .pb(px(10.0))
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(CatppuccinMocha::red())
                                    .child("Error"),
                            )
                            .child(
                                div()
                                    .p(px(8.0))
                                    .rounded(px(6.0))
                                    .bg(CatppuccinMocha::red().opacity(0.1))
                                    .border_1()
                                    .border_color(CatppuccinMocha::red().opacity(0.2))
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(CatppuccinMocha::red())
                                            .child(err.clone()),
                                    ),
                            ),
                    )
                } else {
                    el
                }
            },
        )
}

/// Dispatch to appropriate content renderer based on streaming state
/// Uses StreamingState for progressive text reveal and typing cursor animation
fn render_message_content_dispatch(_theme: &Theme, message: &ChatMessage) -> Div {
    // For streaming messages with active StreamingState, use streaming renderer
    if message.is_streaming {
        if let Some(ref streaming_state) = message.streaming_state {
            return render_streaming_message_content(streaming_state);
        }
    }

    // For completed messages, render the full content statically
    render_markdown_content_static(&message.content)
}

/// Render streaming message content with typing animation and cursor
/// Shows token-by-token text reveal with blinking cursor
fn render_streaming_message_content(state: &StreamingState) -> Div {
    let visible_content = state.visible_content();
    let lines = parse_markdown(visible_content);
    let show_cursor = state.should_show_cursor();
    let is_catching_up = state.is_catching_up();

    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .w_full()
        // Stats bar when catching up (animation behind actual content)
        .when(is_catching_up, |el| {
            el.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(8.0))
                    .py(px(4.0))
                    .rounded(px(4.0))
                    .bg(CatppuccinMocha::yellow().opacity(0.1))
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(CatppuccinMocha::yellow())
                            .child(format!(
                                "Streaming... {} chars pending",
                                state.pending_chars()
                            )),
                    ),
            )
        })
        // Render markdown lines with syntax highlighting for code blocks
        .children(
            lines
                .iter()
                .map(render_markdown_line_enhanced)
                .collect::<Vec<_>>(),
        )
        // Typing cursor with blink animation (blinking blue cursor)
        .when(show_cursor, |el| {
            el.child(
                div().flex().items_center().child(
                    div()
                        .w(px(2.0))
                        .h(px(18.0))
                        .bg(CatppuccinMocha::blue())
                        .rounded(px(1.0)),
                ),
            )
        })
        // Progress indicator bar
        .when(state.is_streaming && !state.animation_complete(), |el| {
            let progress = state.progress();
            let width_px = (progress * 300.0).max(2.0);
            el.child(
                div()
                    .w_full()
                    .h(px(2.0))
                    .mt(px(4.0))
                    .rounded_full()
                    .bg(CatppuccinMocha::surface1())
                    .child(
                        div()
                            .h_full()
                            .rounded_full()
                            .bg(CatppuccinMocha::blue())
                            .w(px(width_px)),
                    ),
            )
        })
        // Token stats during streaming
        .when(state.is_streaming, |el| {
            let duration_secs = state.duration().as_secs_f32();
            el.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .mt(px(4.0))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child("Tokens:"),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(CatppuccinMocha::text())
                                    .child(format!("{}", state.token_count)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child("Speed:"),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(CatppuccinMocha::green())
                                    .child(format!("{:.1} t/s", state.tokens_per_second)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(CatppuccinMocha::overlay0())
                                    .child("Time:"),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(CatppuccinMocha::text())
                                    .child(format!("{:.1}s", duration_secs)),
                            ),
                    ),
            )
        })
        // Cancelled indicator
        .when(state.is_cancelled, |el| {
            el.child(
                div()
                    .mt(px(8.0))
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .child(
                        div()
                            .size(px(6.0))
                            .rounded_full()
                            .bg(CatppuccinMocha::yellow()),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(CatppuccinMocha::overlay1())
                            .italic()
                            .child("Generation stopped"),
                    ),
            )
        })
        // Error display
        .when_some(state.error.clone(), |el, error| {
            el.child(
                div()
                    .mt(px(12.0))
                    .p(px(12.0))
                    .rounded(px(8.0))
                    .bg(CatppuccinMocha::red().opacity(0.15))
                    .border_1()
                    .border_color(CatppuccinMocha::red().opacity(0.3))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(CatppuccinMocha::red())
                                    .child("Error:"),
                            )
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(CatppuccinMocha::subtext0())
                                    .child(error),
                            ),
                    ),
            )
        })
}

/// Render an enhanced code block with line numbers and syntax highlighting
fn render_code_block_enhanced(language: &Option<String>, code_lines: &[String]) -> Div {
    let lang_label = language.as_deref().unwrap_or("text").to_uppercase();
    let _code_content = code_lines.join("\n"); // Reserved for future copy-to-clipboard

    div()
        .w_full()
        .rounded(px(8.0))
        .overflow_hidden()
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        // Header with language label and copy button
        .child(
            div()
                .w_full()
                .px(px(12.0))
                .py(px(6.0))
                .bg(CatppuccinMocha::surface0())
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::subtext0())
                        .child(lang_label),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay0())
                        .cursor_pointer()
                        .hover(|s| s.text_color(CatppuccinMocha::text()))
                        .child("Copy"),
                ),
        )
        // Code content with line numbers
        .child(
            div()
                .w_full()
                .bg(CatppuccinMocha::mantle())
                .flex()
                // Line numbers column
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .py(px(8.0))
                        .px(px(8.0))
                        .border_r_1()
                        .border_color(CatppuccinMocha::surface0())
                        .children(
                            (1..=code_lines.len())
                                .map(|n| {
                                    div()
                                        .text_size(px(11.0))
                                        .font_family("monospace")
                                        .text_color(CatppuccinMocha::overlay0())
                                        .text_align(gpui::TextAlign::Right)
                                        .min_w(px(24.0))
                                        .child(format!("{}", n))
                                })
                                .collect::<Vec<_>>(),
                        ),
                )
                // Code content (with scrollable container)
                .child(
                    div()
                        .id(ElementId::Name("code-block-content".into()))
                        .flex_1()
                        .py(px(8.0))
                        .px(px(12.0))
                        .overflow_x_scroll()
                        .child(
                            div().flex().flex_col().children(
                                code_lines
                                    .iter()
                                    .map(|line| {
                                        let highlighted = SyntaxHighlighter::highlight_line(
                                            line,
                                            language.as_deref(),
                                        );
                                        div()
                                            .flex()
                                            .text_size(px(11.0))
                                            .font_family("monospace")
                                            .line_height(px(18.0))
                                            .children(
                                                highlighted
                                                    .iter()
                                                    .map(|token| {
                                                        div()
                                                            .text_color(token.token_type.color())
                                                            .child(token.text.clone())
                                                    })
                                                    .collect::<Vec<_>>(),
                                            )
                                    })
                                    .collect::<Vec<_>>(),
                            ),
                        ),
                ),
        )
}

/// Render static markdown content (for completed messages)
/// Uses CodeBlock widget for complete code blocks
fn render_markdown_content_static(content: &str) -> Div {
    let lines = parse_markdown(content);

    // Collect code blocks for richer rendering
    let mut elements: Vec<Div> = Vec::new();
    let mut current_code_block: Option<(Option<String>, Vec<String>)> = None;

    for line in &lines {
        match line {
            MarkdownLine::CodeBlockStart(lang) => {
                current_code_block = Some((lang.clone(), Vec::new()));
            }
            MarkdownLine::CodeBlockContent(code) => {
                if let Some((_, ref mut lines)) = current_code_block {
                    lines.push(code.clone());
                }
            }
            MarkdownLine::CodeBlockEnd => {
                if let Some((lang, code_lines)) = current_code_block.take() {
                    // Render code block with enhanced styling
                    elements.push(render_code_block_enhanced(&lang, &code_lines));
                }
            }
            _ => {
                // Regular line - render normally
                elements.push(render_markdown_line_enhanced(line));
            }
        }
    }

    div().flex().flex_col().gap(px(8.0)).children(elements)
}

/// Render a single markdown line with enhanced styling
fn render_markdown_line_enhanced(line: &MarkdownLine) -> Div {
    match line {
        MarkdownLine::Heading(level, text) => {
            let size = match level {
                1 => px(20.0),
                2 => px(18.0),
                3 => px(16.0),
                _ => px(14.0),
            };
            div()
                .text_size(size)
                .font_weight(FontWeight::BOLD)
                .text_color(CatppuccinMocha::text())
                .pb(px(4.0))
                .child(text.clone())
        }
        MarkdownLine::Paragraph(text) => div()
            .text_size(px(13.0))
            .text_color(CatppuccinMocha::subtext1())
            .line_height(px(20.0))
            .child(text.clone()),
        MarkdownLine::UnorderedListItem(text) => div()
            .flex()
            .items_start()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(13.0))
                    .text_color(CatppuccinMocha::blue())
                    .child("*"),
            )
            .child(
                div()
                    .text_size(px(13.0))
                    .text_color(CatppuccinMocha::subtext1())
                    .line_height(px(20.0))
                    .child(text.clone()),
            ),
        MarkdownLine::OrderedListItem(number, text) => div()
            .flex()
            .items_start()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(13.0))
                    .text_color(CatppuccinMocha::blue())
                    .child(format!("{}.", number)),
            )
            .child(
                div()
                    .text_size(px(13.0))
                    .text_color(CatppuccinMocha::subtext1())
                    .line_height(px(20.0))
                    .child(text.clone()),
            ),
        MarkdownLine::Blockquote(text) => div()
            .pl(px(12.0))
            .border_l_2()
            .border_color(CatppuccinMocha::blue())
            .text_size(px(13.0))
            .text_color(CatppuccinMocha::overlay1())
            .italic()
            .child(text.clone()),
        MarkdownLine::CodeBlockStart(language) => {
            let lang = language.as_deref().unwrap_or("text");
            div()
                .w_full()
                .rounded_t(px(8.0))
                .bg(CatppuccinMocha::surface0())
                .px(px(12.0))
                .py(px(6.0))
                .flex()
                .items_center()
                .justify_between()
                .border_1()
                .border_color(CatppuccinMocha::surface0())
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::subtext0())
                        .child(lang.to_uppercase()),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(CatppuccinMocha::overlay0())
                        .cursor_pointer()
                        .hover(|s| s.text_color(CatppuccinMocha::text()))
                        .child("Copy"),
                )
        }
        MarkdownLine::CodeBlockContent(code) => {
            let highlighted = SyntaxHighlighter::highlight_line(code, None);
            div()
                .w_full()
                .px(px(12.0))
                .py(px(2.0))
                .bg(CatppuccinMocha::mantle())
                .border_l_1()
                .border_r_1()
                .border_color(CatppuccinMocha::surface0())
                .flex()
                .font_family("monospace")
                .text_size(px(12.0))
                .children(highlighted.iter().map(|token| {
                    div()
                        .text_color(token.token_type.color())
                        .child(token.text.clone())
                }))
        }
        MarkdownLine::CodeBlockEnd => div()
            .w_full()
            .h(px(8.0))
            .rounded_b(px(8.0))
            .bg(CatppuccinMocha::mantle())
            .border_l_1()
            .border_r_1()
            .border_b_1()
            .border_color(CatppuccinMocha::surface0()),
        MarkdownLine::InlineCode(code) => div()
            .px(px(6.0))
            .py(px(2.0))
            .rounded(px(4.0))
            .bg(CatppuccinMocha::surface0())
            .font_family("monospace")
            .text_size(px(12.0))
            .text_color(CatppuccinMocha::pink())
            .child(code.clone()),
        MarkdownLine::HorizontalRule => div()
            .w_full()
            .h(px(1.0))
            .my(px(8.0))
            .bg(CatppuccinMocha::surface1()),
        MarkdownLine::Empty => div().h(px(8.0)),
        MarkdownLine::Bold(text) => div()
            .text_size(px(13.0))
            .font_weight(FontWeight::BOLD)
            .text_color(CatppuccinMocha::text())
            .child(text.clone()),
        MarkdownLine::Italic(text) => div()
            .text_size(px(13.0))
            .italic()
            .text_color(CatppuccinMocha::subtext1())
            .child(text.clone()),
        MarkdownLine::Link(text, url) => div()
            .text_size(px(13.0))
            .text_color(CatppuccinMocha::blue())
            .cursor_pointer()
            .hover(|s| s.text_color(CatppuccinMocha::sky()))
            .child(format!("{} [{}]", text, url)),
    }
}

/// Render streaming message content with full animation support
/// Public API for external callers who want to render a message with streaming UI
pub fn render_streaming_message(_theme: &Theme, message: &ChatMessage, show_stats: bool) -> Div {
    let mut container = div().flex().flex_col().gap(px(8.0)).w_full();

    // If message is streaming with active state, use streaming renderer
    if message.is_streaming {
        if let Some(ref state) = message.streaming_state {
            // Stats bar for streaming messages (when requested)
            if show_stats && state.is_streaming {
                container = container.child(render_streaming_stats_bar(state));
            }

            // Use the streaming message content renderer
            container = container.child(render_streaming_message_content(state));

            return container;
        }
    }

    // For non-streaming messages, render static content
    container = container.child(render_markdown_content_static(&message.content));
    container
}

/// Render streaming statistics bar
fn render_streaming_stats_bar(state: &StreamingState) -> Div {
    let duration = state.duration();
    let duration_secs = duration.as_secs_f32();

    div()
        .w_full()
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .bg(CatppuccinMocha::surface0())
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(16.0))
                // Tokens count
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Tokens:"),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(format!("{}", state.token_count)),
                        ),
                )
                // Speed
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Speed:"),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::green())
                                .child(format!("{:.1} t/s", state.tokens_per_second)),
                        ),
                )
                // Duration
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(CatppuccinMocha::overlay0())
                                .child("Time:"),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(CatppuccinMocha::text())
                                .child(format!("{:.1}s", duration_secs)),
                        ),
                ),
        )
}

/// Render streaming progress bar
fn render_streaming_progress_bar(state: &StreamingState) -> Div {
    let progress = state.progress();
    // Use relative width based on progress percentage
    let width_px = (progress * 300.0).max(2.0);

    div()
        .w_full()
        .h(px(2.0))
        .mt(px(4.0))
        .rounded_full()
        .bg(CatppuccinMocha::surface1())
        .child(
            div()
                .h_full()
                .rounded_full()
                .bg(CatppuccinMocha::blue())
                .w(px(width_px)),
        )
}

/// Render a tool call
fn render_tool_call(theme: &Theme, tool: &ToolCall) -> Div {
    let status_color = match &tool.status {
        ToolStatus::Pending => theme.text_muted,
        ToolStatus::Running => theme.warning,
        ToolStatus::Success => theme.positive,
        ToolStatus::Error(_) => theme.negative,
    };

    div()
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .border_1()
        .border_color(theme.border_subtle)
        .overflow_hidden()
        // Header
        .child(
            div()
                .px(px(12.0))
                .py(px(10.0))
                .flex()
                .items_center()
                .justify_between()
                .bg(theme.card_bg)
                .border_b_1()
                .border_color(theme.border_subtle)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        // Tool icon
                        .child(
                            div()
                                .size(px(20.0))
                                .rounded(px(4.0))
                                .bg(status_color.opacity(0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(10.0))
                                .text_color(status_color)
                                .child("T"),
                        )
                        // Tool name
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.text)
                                .child(tool.name.clone()),
                        ),
                )
                // Status badge
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(3.0))
                        .rounded(px(4.0))
                        .bg(status_color.opacity(0.15))
                        .text_size(px(10.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(status_color)
                        .child(tool.status.label()),
                ),
        )
        // Arguments (collapsed by default)
        .when(tool.expanded || !tool.arguments.is_empty(), |el| {
            el.child(
                div()
                    .px(px(12.0))
                    .py(px(8.0))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .mb(px(4.0))
                            .child("Arguments:"),
                    )
                    .child(
                        div()
                            .p(px(8.0))
                            .rounded(px(4.0))
                            .bg(theme.background)
                            .text_size(px(11.0))
                            .font_family("monospace")
                            .text_color(theme.text_muted)
                            .child(truncate_text(&tool.arguments, 200)),
                    ),
            )
        })
        // Result (if available)
        .when_some(tool.result.clone(), |el, result| {
            el.child(
                div()
                    .px(px(12.0))
                    .py(px(8.0))
                    .border_t_1()
                    .border_color(theme.border_subtle)
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .mb(px(4.0))
                            .child("Result:"),
                    )
                    .child(
                        div()
                            .p(px(8.0))
                            .rounded(px(4.0))
                            .bg(theme.background)
                            .text_size(px(11.0))
                            .font_family("monospace")
                            .text_color(theme.positive)
                            .child(truncate_text(&result, 300)),
                    ),
            )
        })
}

/// Helper to render a tooltip
fn render_tooltip(
    text: impl Into<SharedString>,
    group_id: impl Into<SharedString>,
    bg_color: Option<Hsla>,
    border_color: Option<Hsla>,
    text_color: Option<Hsla>,
) -> Div {
    let group_id = group_id.into();
    div()
        .absolute()
        .bottom(px(40.0)) // Default position, override via style if needed (but GPUI style overrides are tricky on children)
        // Ideally we would pass position as argument but for now we stick to bottom-centerish
        .left(px(0.0)) // This might need adjustment per use case, but let's try to center it relative to parent if possible or just left aligned
        .px(px(6.0))
        .py(px(3.0))
        .rounded(px(4.0))
        .bg(bg_color.unwrap_or_else(CatppuccinMocha::surface2))
        .border_1()
        .border_color(border_color.unwrap_or_else(CatppuccinMocha::surface0))
        .shadow_sm()
        .opacity(0.0)
        .group_hover(group_id, |s| s.opacity(1.0))
        .child(
            div()
                .text_size(px(10.0))
                .text_color(text_color.unwrap_or_else(CatppuccinMocha::text))
                .whitespace_nowrap()
                .child(text.into()),
        )
}

/// Render streaming indicator
fn render_streaming_indicator(theme: &Theme) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .py(px(8.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                // Animated dots
                .child(div().size(px(6.0)).rounded_full().bg(theme.accent))
                .child(
                    div()
                        .size(px(6.0))
                        .rounded_full()
                        .bg(theme.accent.opacity(0.7)),
                )
                .child(
                    div()
                        .size(px(6.0))
                        .rounded_full()
                        .bg(theme.accent.opacity(0.4)),
                ),
        )
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child("Agent is thinking..."),
        )
}

/// Render command palette (Cmd+K)
pub fn render_command_palette(_theme: &Theme, state: &AgentState) -> impl IntoElement {
    let commands = state.get_filtered_commands();

    div()
        .id("command-palette")
        .absolute()
        .inset_0()
        .flex()
        .items_start()
        .justify_center()
        .pt(px(100.0))
        .bg(CatppuccinMocha::crust().opacity(0.8))
        .child(
            div()
                .w(px(500.0))
                .max_h(px(400.0))
                .rounded(px(12.0))
                .bg(CatppuccinMocha::base())
                .border_1()
                .border_color(CatppuccinMocha::surface1())
                .shadow_lg()
                .overflow_hidden()
                .flex()
                .flex_col()
                // Search input
                .child(
                    div()
                        .px(px(16.0))
                        .py(px(12.0))
                        .border_b_1()
                        .border_color(CatppuccinMocha::surface0())
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        // Search icon
                        .child(
                            div()
                                .text_size(px(14.0))
                                .text_color(CatppuccinMocha::overlay1())
                                .child(">"),
                        )
                        // Input
                        .child(
                            div()
                                .flex_grow()
                                .text_size(px(14.0))
                                .text_color(if state.command_palette_search.is_empty() {
                                    CatppuccinMocha::overlay0()
                                } else {
                                    CatppuccinMocha::text()
                                })
                                .child(if state.command_palette_search.is_empty() {
                                    "Type a command or search...".to_string()
                                } else {
                                    state.command_palette_search.clone()
                                }),
                        )
                        // Shortcut hint
                        .child(
                            div()
                                .px(px(6.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .bg(CatppuccinMocha::surface0())
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .text_color(CatppuccinMocha::overlay0())
                                        .child("Esc to close"),
                                ),
                        ),
                )
                // Command list
                .child(
                    div()
                        .id("command-list")
                        .flex_grow()
                        .overflow_y_scroll()
                        .py(px(8.0))
                        .children(commands.iter().enumerate().map(|(idx, cmd)| {
                            let is_selected = idx == state.selected_command_index;
                            let color = cmd.category.color();

                            div()
                                .id(cmd.id.clone())
                                .px(px(12.0))
                                .py(px(8.0))
                                .mx(px(8.0))
                                .rounded(px(6.0))
                                .bg(if is_selected {
                                    CatppuccinMocha::surface1()
                                } else {
                                    CatppuccinMocha::base()
                                })
                                .cursor_pointer()
                                .hover(|s| s.bg(CatppuccinMocha::surface0()))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .justify_between()
                                        // Left: category + label
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(10.0))
                                                // Category badge
                                                .child(
                                                    div()
                                                        .px(px(6.0))
                                                        .py(px(2.0))
                                                        .rounded(px(4.0))
                                                        .bg(color.opacity(0.15))
                                                        .child(
                                                            div()
                                                                .text_size(px(9.0))
                                                                .font_weight(FontWeight::SEMIBOLD)
                                                                .text_color(color)
                                                                .child(cmd.category.label()),
                                                        ),
                                                )
                                                // Label and description
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .gap(px(1.0))
                                                        .child(
                                                            div()
                                                                .text_size(px(13.0))
                                                                .font_weight(FontWeight::MEDIUM)
                                                                .text_color(CatppuccinMocha::text())
                                                                .child(cmd.label.clone()),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_size(px(11.0))
                                                                .text_color(
                                                                    CatppuccinMocha::overlay1(),
                                                                )
                                                                .child(cmd.description.clone()),
                                                        ),
                                                ),
                                        )
                                        // Right: shortcut
                                        .when_some(cmd.shortcut.clone(), |el, shortcut| {
                                            el.child(
                                                div()
                                                    .px(px(8.0))
                                                    .py(px(3.0))
                                                    .rounded(px(4.0))
                                                    .bg(CatppuccinMocha::surface0())
                                                    .child(
                                                        div()
                                                            .text_size(px(10.0))
                                                            .font_family("monospace")
                                                            .text_color(CatppuccinMocha::subtext0())
                                                            .child(shortcut),
                                                    ),
                                            )
                                        }),
                                )
                        })),
                ),
        )
}

/// Render voice input button
pub fn render_voice_input_button(_theme: &Theme, enabled: bool, active: bool) -> impl IntoElement {
    let color = if active {
        CatppuccinMocha::red()
    } else if enabled {
        CatppuccinMocha::green()
    } else {
        CatppuccinMocha::overlay0()
    };

    div()
        .relative()
        .group("voice-input-group")
        .child(
            div()
                .id("voice-input-btn")
                .size(px(36.0))
                .rounded(px(8.0))
                .bg(color.opacity(if active { 0.2 } else { 0.1 }))
                .border_1()
                .border_color(color.opacity(0.3))
                .when(enabled, |el| {
                    el.cursor_pointer().hover(|s| s.bg(color.opacity(0.2)))
                })
                .when(!enabled, |el| el.cursor_not_allowed().opacity(0.5))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(14.0))
                        .text_color(color)
                        .child(if active { "⏹" } else { "🎤" }),
                ),
        )
        // Tooltip
        .child(
            render_tooltip(
                if active {
                    "Stop Voice Input"
                } else if enabled {
                    "Start Voice Input"
                } else {
                    "Voice Input Disabled"
                },
                "voice-input-group",
                None,
                None,
                None,
            )
            // Override position for this specific button
            .right(px(0.0))
            .left(Length::Auto),
        )
}

/// Render thread indicator for a message
pub fn render_thread_indicator(
    _theme: &Theme,
    message_id: &str,
    reply_count: usize,
    is_active: bool,
) -> impl IntoElement {
    div()
        .id(format!("thread-{}", message_id))
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(8.0))
        .py(px(4.0))
        .rounded(px(4.0))
        .bg(if is_active {
            CatppuccinMocha::blue().opacity(0.15)
        } else {
            CatppuccinMocha::surface0()
        })
        .cursor_pointer()
        .hover(|s| s.bg(CatppuccinMocha::surface1()))
        // Thread icon
        .child(
            div()
                .text_size(px(10.0))
                .text_color(if is_active {
                    CatppuccinMocha::blue()
                } else {
                    CatppuccinMocha::overlay1()
                })
                .child("_/"),
        )
        // Reply count
        .when(reply_count > 0, |el| {
            el.child(
                div()
                    .text_size(px(10.0))
                    .text_color(CatppuccinMocha::subtext0())
                    .child(format!("{} replies", reply_count)),
            )
        })
        .when(reply_count == 0, |el| {
            el.child(
                div()
                    .text_size(px(10.0))
                    .text_color(CatppuccinMocha::overlay0())
                    .child("Start thread"),
            )
        })
}

/// Render message rating buttons
pub fn render_message_rating_buttons(
    _theme: &Theme,
    message_id: &str,
    current_rating: Option<MessageRating>,
) -> impl IntoElement {
    div()
        .id(format!("rating-{}", message_id))
        .flex()
        .items_center()
        .gap(px(4.0))
        // Thumbs up
        .child({
            let is_selected = current_rating == Some(MessageRating::Positive);
            let group_id = format!("rate-up-group-{}", message_id);
            div()
                .relative()
                .group(group_id.clone())
                .child(
                    div()
                        .id(format!("rate-up-{}", message_id))
                        .size(px(24.0))
                        .rounded(px(4.0))
                        .bg(if is_selected {
                            CatppuccinMocha::green().opacity(0.2)
                        } else {
                            CatppuccinMocha::surface0()
                        })
                        .cursor_pointer()
                        .hover(|s| s.bg(CatppuccinMocha::green().opacity(0.15)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(if is_selected {
                                    CatppuccinMocha::green()
                                } else {
                                    CatppuccinMocha::overlay1()
                                })
                                .child("👍"),
                        ),
                )
                // Tooltip
                .child(
                    render_tooltip("Helpful", &group_id, None, None, None)
                        .bottom(px(30.0))
                        .left(px(-10.0)),
                )
        })
        // Thumbs down
        .child({
            let is_selected = current_rating == Some(MessageRating::Negative);
            let group_id = format!("rate-down-group-{}", message_id);
            div()
                .relative()
                .group(group_id.clone())
                .child(
                    div()
                        .id(format!("rate-down-{}", message_id))
                        .size(px(24.0))
                        .rounded(px(4.0))
                        .bg(if is_selected {
                            CatppuccinMocha::red().opacity(0.2)
                        } else {
                            CatppuccinMocha::surface0()
                        })
                        .cursor_pointer()
                        .hover(|s| s.bg(CatppuccinMocha::red().opacity(0.15)))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(if is_selected {
                                    CatppuccinMocha::red()
                                } else {
                                    CatppuccinMocha::overlay1()
                                })
                                .child("👎"),
                        ),
                )
                // Tooltip
                .child(
                    render_tooltip("Not Helpful", &group_id, None, None, None)
                        .bottom(px(30.0))
                        .left(px(-10.0)),
                )
        })
}

/// Render keyboard shortcuts help panel
pub fn render_shortcuts_help(_theme: &Theme) -> impl IntoElement {
    let shortcuts = vec![
        ("Cmd+K", "Open command palette"),
        ("Cmd+1", "Analyze symbol"),
        ("Cmd+2", "Compare symbols"),
        ("Cmd+3", "Research report"),
        ("Cmd+E", "Export conversation"),
        ("Cmd+Shift+C", "Toggle context sidebar"),
        ("Cmd+Shift+V", "Toggle voice input"),
        ("Cmd+T", "New thread"),
        ("Cmd+Z", "Undo"),
        ("Cmd+Shift+Z", "Redo"),
        ("Esc", "Close palette/dialog"),
        ("Enter", "Send message"),
        ("Shift+Enter", "New line"),
    ];

    div()
        .id("shortcuts-help")
        .w(px(320.0))
        .rounded(px(12.0))
        .bg(CatppuccinMocha::base())
        .border_1()
        .border_color(CatppuccinMocha::surface1())
        .shadow_lg()
        .overflow_hidden()
        // Header
        .child(
            div()
                .px(px(16.0))
                .py(px(12.0))
                .border_b_1()
                .border_color(CatppuccinMocha::surface0())
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(CatppuccinMocha::text())
                        .child("Keyboard Shortcuts"),
                ),
        )
        // Shortcuts list
        .child(
            div()
                .p(px(12.0))
                .flex()
                .flex_col()
                .gap(px(8.0))
                .children(shortcuts.iter().map(|(key, desc)| {
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(CatppuccinMocha::subtext0())
                                .child(desc.to_string()),
                        )
                        .child(
                            div()
                                .px(px(8.0))
                                .py(px(3.0))
                                .rounded(px(4.0))
                                .bg(CatppuccinMocha::surface0())
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_family("monospace")
                                        .text_color(CatppuccinMocha::overlay1())
                                        .child(key.to_string()),
                                ),
                        )
                })),
        )
}

/// Render the input area
fn render_input_area(
    theme: &Theme,
    input_text: &str,
    is_busy: bool,
    on_clear: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Div {
    let is_disabled = is_busy || input_text.trim().is_empty();

    div()
        .px(px(20.0))
        .py(px(16.0))
        .border_t_1()
        .border_color(theme.border_subtle)
        .bg(theme.card_bg)
        .flex()
        .flex_col()
        .gap(px(12.0))
        // Input row
        .child(
            div()
                .flex()
                .items_end()
                .gap(px(12.0))
                // Text input (using a styled div since GPUI doesn't have native input)
                .child(
                    div()
                        .id("agent-input")
                        .flex_grow()
                        .min_h(px(44.0))
                        .max_h(px(120.0))
                        .px(px(16.0))
                        .py(px(12.0))
                        .rounded(px(10.0))
                        .bg(theme.background)
                        .border_1()
                        .border_color(theme.border)
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .flex_grow()
                                .text_size(px(14.0))
                                .text_color(if input_text.is_empty() {
                                    theme.text_muted
                                } else {
                                    theme.text
                                })
                                .child(if input_text.is_empty() {
                                    "Ask Stanley anything about investments...".to_string()
                                } else {
                                    input_text.to_string()
                                }),
                        )
                        // Clear button (only show when there is text)
                        .when(!input_text.is_empty(), |el| {
                            el.child(
                                div()
                                    .relative()
                                    .group("clear-input-group")
                                    .child(
                                        div()
                                            .id("clear-input")
                                            .px(px(6.0))
                                            .py(px(4.0))
                                            .rounded(px(4.0))
                                            .cursor_pointer()
                                            .hover(|s| s.bg(theme.hover_bg))
                                            .on_click(on_clear)
                                            .child(
                                                div()
                                                    .text_size(px(12.0))
                                                    .text_color(theme.text_dimmed)
                                                    .child("✕"), // Unicode heavy multiplication x
                                            ),
                                    )
                                    // Tooltip
                                    .child(
                                        render_tooltip(
                                            "Clear Input",
                                            "clear-input-group",
                                            Some(theme.card_bg_elevated),
                                            Some(theme.border),
                                            Some(theme.text),
                                        )
                                        .bottom(px(30.0))
                                        .right(px(0.0))
                                        .left(Length::Auto),
                                    ),
                            )
                        }),
                )
                // Send button
                .child(
                    div()
                        .relative()
                        .group("send-btn-group")
                        .child(
                            div()
                                .id("send-message")
                                .size(px(44.0))
                                .rounded(px(10.0))
                                .bg(if is_disabled {
                                    theme.text_muted
                                } else {
                                    theme.accent
                                })
                                .flex()
                                .items_center()
                                .justify_center()
                                .when(is_disabled, |el| el.cursor_not_allowed())
                                .when(!is_disabled, |el| {
                                    el.cursor_pointer().hover(|s| s.bg(theme.accent_hover))
                                })
                                .child(
                                    div()
                                        .text_size(px(18.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(hsla(0.0, 0.0, 1.0, 0.95))
                                        .child(if is_busy { "..." } else { "➤" }),
                                ),
                        )
                        // Tooltip
                        .child(
                            div()
                                .absolute()
                                .bottom(px(50.0))
                                .right(px(0.0))
                                .px(px(8.0))
                                .py(px(4.0))
                                .rounded(px(4.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border)
                                .shadow_sm()
                                .opacity(0.0)
                                .group_hover("send-btn-group", |s| s.opacity(1.0))
                                .child(
                                    div()
                                        .text_size(px(12.0))
                                        .text_color(theme.text)
                                        .whitespace_nowrap()
                                        .child("Send Message (Enter)"),
                                ),
                        ),
                ),
        )
        // Help text
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.text_dimmed)
                        .child("Press Enter to send, Shift+Enter for new line"),
                )
                .child(
                    div().flex().items_center().gap(px(12.0)).child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .child("Powered by Claude"),
                    ),
                ),
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate a simple UUID v4-like string
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("msg-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

/// Format current time as string
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

/// Truncate text with ellipsis
fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len])
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_state_default() {
        let state = AgentState::default();
        assert_eq!(state.status, AgentStatus::Connected);
        assert!(!state.messages.is_empty());
    }

    #[test]
    fn test_add_user_message() {
        let mut state = AgentState::new();
        let initial_count = state.messages.len();
        state.add_user_message("Test message".to_string());
        assert_eq!(state.messages.len(), initial_count + 1);
        assert_eq!(state.messages.last().unwrap().role, MessageRole::User);
    }

    #[test]
    fn test_streaming_workflow() {
        let mut state = AgentState::new();
        state.start_streaming();
        assert!(state.status.is_busy());
        assert!(state.messages.last().unwrap().is_streaming);

        state.append_streaming("Hello");
        state.append_streaming(" World");
        assert_eq!(state.messages.last().unwrap().content, "Hello World");

        state.finish_streaming();
        assert!(!state.status.is_busy());
        assert!(!state.messages.last().unwrap().is_streaming);
    }

    #[test]
    fn test_tool_call_status() {
        let tool = ToolCall::new(
            "tool-1".to_string(),
            "get_market_data".to_string(),
            r#"{"symbol": "AAPL"}"#.to_string(),
        );
        assert_eq!(tool.status, ToolStatus::Pending);
        assert!(tool.result.is_none());
    }

    #[test]
    fn test_truncate_text() {
        assert_eq!(truncate_text("short", 10), "short");
        assert_eq!(truncate_text("this is a long text", 10), "this is a ...");
    }

    // =========================================================================
    // Phase 4 Deep Integration Tests
    // =========================================================================

    #[test]
    fn test_command_palette_toggle() {
        let mut state = AgentState::new();
        assert!(!state.command_palette_open);

        state.toggle_command_palette();
        assert!(state.command_palette_open);

        state.toggle_command_palette();
        assert!(!state.command_palette_open);
    }

    #[test]
    fn test_command_palette_search() {
        let mut state = AgentState::new();
        state.command_palette_search = "analyze".to_string();
        let commands = state.get_filtered_commands();
        assert!(commands.iter().any(|c| c.id == "analyze"));
    }

    #[test]
    fn test_threading() {
        let mut state = AgentState::new();
        assert!(state.active_thread_id.is_none());

        state.start_thread("msg-123");
        assert_eq!(state.active_thread_id, Some("msg-123".to_string()));

        state.add_thread_reply("msg-123");
        assert_eq!(state.get_thread_reply_count("msg-123"), 1);

        state.add_thread_reply("msg-123");
        assert_eq!(state.get_thread_reply_count("msg-123"), 2);

        state.end_thread();
        assert!(state.active_thread_id.is_none());
    }

    #[test]
    fn test_message_rating() {
        let mut state = AgentState::new();
        let msg_id = "msg-test";

        assert!(state.get_message_rating(msg_id).is_none());

        state.rate_message(msg_id, MessageRating::Positive);
        assert_eq!(
            state.get_message_rating(msg_id),
            Some(MessageRating::Positive)
        );

        state.rate_message(msg_id, MessageRating::Negative);
        assert_eq!(
            state.get_message_rating(msg_id),
            Some(MessageRating::Negative)
        );

        state.clear_message_rating(msg_id);
        assert!(state.get_message_rating(msg_id).is_none());
    }

    #[test]
    fn test_context_sidebar_toggle() {
        let mut state = AgentState::new();
        assert!(!state.context_sidebar_visible);

        state.toggle_context_sidebar();
        assert!(state.context_sidebar_visible);

        state.toggle_context_sidebar();
        assert!(!state.context_sidebar_visible);
    }

    #[test]
    fn test_voice_input() {
        let mut state = AgentState::new();
        // Voice not enabled by default
        assert!(!state.voice_input_enabled);
        assert!(!state.voice_input_active);

        // Toggle should not activate when not enabled
        state.toggle_voice_input();
        assert!(!state.voice_input_active);

        // Enable and toggle
        state.voice_input_enabled = true;
        state.toggle_voice_input();
        assert!(state.voice_input_active);
    }

    #[test]
    fn test_agent_commands() {
        let commands = AgentCommand::all();
        assert!(!commands.is_empty());

        // Check that all categories are represented
        let categories: Vec<_> = commands.iter().map(|c| c.category).collect();
        assert!(categories.contains(&CommandCategory::Analysis));
        assert!(categories.contains(&CommandCategory::Navigation));
        assert!(categories.contains(&CommandCategory::Export));
    }
}
