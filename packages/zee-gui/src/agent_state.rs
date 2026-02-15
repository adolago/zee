//! Agent State Management for Stanley GUI
//!
//! Provides shared state management with:
//! - Observable patterns for reactive updates
//! - Undo/redo functionality
//! - Offline queue for resilience
//! - State persistence

use crate::agent::{AgentState, AgentStatus, ChatMessage, MessageRole, ToolCall, ToolStatus};
use crate::agent_actions::{ActionBarState, ExportOptions, ShareOptions};
use crate::agent_context::{ContextState, ContextSource, SessionEntry};
use crate::components::streaming::CatppuccinMocha;
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

// =============================================================================
// Observable Pattern
// =============================================================================

/// Subscription ID for observers
pub type SubscriptionId = u64;

/// Observable state change event
#[derive(Debug, Clone)]
pub enum StateChange {
    /// Message added to conversation
    MessageAdded(String),
    /// Message content updated
    MessageUpdated(String),
    /// Streaming started
    StreamingStarted,
    /// Streaming completed
    StreamingCompleted,
    /// Tool call added
    ToolCallAdded(String, String),
    /// Tool call status changed
    ToolCallStatusChanged(String, ToolStatus),
    /// Agent status changed
    AgentStatusChanged(AgentStatus),
    /// Context source toggled
    ContextToggled(String, bool),
    /// Session changed
    SessionChanged(String),
    /// Input text changed
    InputChanged(String),
    /// View state changed (e.g., sidebar visibility)
    ViewStateChanged(String),
    /// Settings changed
    SettingsChanged(String),
    /// Custom state change
    Custom(String, String),
}

/// Observer callback type
pub type ObserverCallback = Box<dyn Fn(&StateChange) + Send + Sync>;

/// Observable wrapper for state
#[derive(Default)]
pub struct Observable<T> {
    value: T,
    observers: HashMap<SubscriptionId, ObserverCallback>,
    next_id: SubscriptionId,
}

impl<T> Observable<T> {
    pub fn new(value: T) -> Self {
        Self {
            value,
            observers: HashMap::new(),
            next_id: 1,
        }
    }

    /// Get reference to inner value
    pub fn get(&self) -> &T {
        &self.value
    }

    /// Get mutable reference to inner value (without notification)
    pub fn get_mut(&mut self) -> &mut T {
        &mut self.value
    }

    /// Set value and notify observers
    pub fn set(&mut self, value: T, change: StateChange) {
        self.value = value;
        self.notify(&change);
    }

    /// Subscribe to changes
    pub fn subscribe<F>(&mut self, callback: F) -> SubscriptionId
    where
        F: Fn(&StateChange) + Send + Sync + 'static,
    {
        let id = self.next_id;
        self.next_id += 1;
        self.observers.insert(id, Box::new(callback));
        id
    }

    /// Unsubscribe from changes
    pub fn unsubscribe(&mut self, id: SubscriptionId) {
        self.observers.remove(&id);
    }

    /// Notify all observers
    pub fn notify(&self, change: &StateChange) {
        for callback in self.observers.values() {
            callback(change);
        }
    }
}

// =============================================================================
// Undo/Redo System
// =============================================================================

/// An action that can be undone/redone
#[derive(Debug, Clone)]
pub enum UndoableAction {
    /// Added a message
    AddMessage(ChatMessage),
    /// Deleted a message
    DeleteMessage(String, ChatMessage),
    /// Updated message content
    UpdateMessage(String, String, String), // id, old_content, new_content
    /// Toggled context source
    ToggleContext(String, bool),
    /// Changed context priority
    ChangeContextPriority(String, u8, u8), // id, old_priority, new_priority
    /// Injected context
    InjectContext(ContextSource),
    /// Removed context
    RemoveContext(String, ContextSource),
    /// Changed input text
    ChangeInput(String, String), // old, new
    /// Cleared conversation
    ClearConversation(Vec<ChatMessage>),
}

impl UndoableAction {
    /// Get description of the action
    pub fn description(&self) -> String {
        match self {
            UndoableAction::AddMessage(_) => "Add message".to_string(),
            UndoableAction::DeleteMessage(_, _) => "Delete message".to_string(),
            UndoableAction::UpdateMessage(_, _, _) => "Update message".to_string(),
            UndoableAction::ToggleContext(id, enabled) => {
                format!("{} context {}", if *enabled { "Enable" } else { "Disable" }, id)
            }
            UndoableAction::ChangeContextPriority(id, _, _) => {
                format!("Change priority for {}", id)
            }
            UndoableAction::InjectContext(_) => "Inject context".to_string(),
            UndoableAction::RemoveContext(_, _) => "Remove context".to_string(),
            UndoableAction::ChangeInput(_, _) => "Change input".to_string(),
            UndoableAction::ClearConversation(_) => "Clear conversation".to_string(),
        }
    }
}

/// Undo/redo manager
#[derive(Debug, Default)]
pub struct UndoManager {
    /// Stack of actions that can be undone
    undo_stack: Vec<UndoableAction>,
    /// Stack of actions that can be redone
    redo_stack: Vec<UndoableAction>,
    /// Maximum history size
    max_history: usize,
    /// Whether to group related actions
    grouping_enabled: bool,
    /// Current group (for batching related actions)
    current_group: Option<Vec<UndoableAction>>,
}

impl UndoManager {
    pub fn new() -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_history: 100,
            grouping_enabled: false,
            current_group: None,
        }
    }

    /// Push an action onto the undo stack
    pub fn push(&mut self, action: UndoableAction) {
        // Clear redo stack when new action is performed
        self.redo_stack.clear();

        if let Some(ref mut group) = self.current_group {
            group.push(action);
        } else {
            self.undo_stack.push(action);
            // Trim to max size
            while self.undo_stack.len() > self.max_history {
                self.undo_stack.remove(0);
            }
        }
    }

    /// Check if undo is available
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    /// Check if redo is available
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Pop action from undo stack
    pub fn pop_undo(&mut self) -> Option<UndoableAction> {
        let action = self.undo_stack.pop()?;
        self.redo_stack.push(action.clone());
        Some(action)
    }

    /// Pop action from redo stack
    pub fn pop_redo(&mut self) -> Option<UndoableAction> {
        let action = self.redo_stack.pop()?;
        self.undo_stack.push(action.clone());
        Some(action)
    }

    /// Get undo stack description
    pub fn get_undo_description(&self) -> Option<String> {
        self.undo_stack.last().map(|a| a.description())
    }

    /// Get redo stack description
    pub fn get_redo_description(&self) -> Option<String> {
        self.redo_stack.last().map(|a| a.description())
    }

    /// Start grouping actions
    pub fn begin_group(&mut self) {
        self.current_group = Some(Vec::new());
    }

    /// End grouping and push as single undoable unit
    pub fn end_group(&mut self) {
        if let Some(group) = self.current_group.take() {
            if !group.is_empty() {
                // For simplicity, just push the first action
                // A more complex implementation would create a compound action
                for action in group {
                    self.undo_stack.push(action);
                }
            }
        }
    }

    /// Clear all history
    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.current_group = None;
    }

    /// Get undo stack size
    pub fn undo_count(&self) -> usize {
        self.undo_stack.len()
    }

    /// Get redo stack size
    pub fn redo_count(&self) -> usize {
        self.redo_stack.len()
    }
}

// =============================================================================
// Offline Queue
// =============================================================================

/// Status of a queued operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueuedOperationStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

/// A queued operation for offline support
#[derive(Debug, Clone)]
pub struct QueuedOperation {
    pub id: String,
    pub operation_type: OperationType,
    pub payload: String,
    pub status: QueuedOperationStatus,
    pub created_at: String,
    pub retry_count: u32,
    pub max_retries: u32,
    pub error: Option<String>,
}

/// Type of queued operation
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationType {
    SendMessage,
    ExecuteTool,
    SaveNote,
    ExportAnalysis,
    ShareAnalysis,
    SyncContext,
    Custom(String),
}

impl OperationType {
    pub fn label(&self) -> &str {
        match self {
            OperationType::SendMessage => "Send Message",
            OperationType::ExecuteTool => "Execute Tool",
            OperationType::SaveNote => "Save Note",
            OperationType::ExportAnalysis => "Export Analysis",
            OperationType::ShareAnalysis => "Share Analysis",
            OperationType::SyncContext => "Sync Context",
            OperationType::Custom(name) => name,
        }
    }
}

impl QueuedOperation {
    pub fn new(operation_type: OperationType, payload: String) -> Self {
        Self {
            id: generate_operation_id(),
            operation_type,
            payload,
            status: QueuedOperationStatus::Pending,
            created_at: format_now(),
            retry_count: 0,
            max_retries: 3,
            error: None,
        }
    }

    /// Check if operation can be retried
    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries &&
        matches!(self.status, QueuedOperationStatus::Failed)
    }

    /// Increment retry count
    pub fn increment_retry(&mut self) {
        self.retry_count += 1;
    }

    /// Mark as in progress
    pub fn start(&mut self) {
        self.status = QueuedOperationStatus::InProgress;
    }

    /// Mark as completed
    pub fn complete(&mut self) {
        self.status = QueuedOperationStatus::Completed;
    }

    /// Mark as failed
    pub fn fail(&mut self, error: &str) {
        self.status = QueuedOperationStatus::Failed;
        self.error = Some(error.to_string());
    }

    /// Mark as cancelled
    pub fn cancel(&mut self) {
        self.status = QueuedOperationStatus::Cancelled;
    }
}

/// Offline operation queue
#[derive(Debug, Default)]
pub struct OfflineQueue {
    /// Queue of pending operations
    operations: VecDeque<QueuedOperation>,
    /// Maximum queue size
    max_size: usize,
    /// Whether currently online
    is_online: bool,
    /// Completed operations (for history)
    completed: Vec<QueuedOperation>,
    /// Maximum completed history
    max_completed: usize,
}

impl OfflineQueue {
    pub fn new() -> Self {
        Self {
            operations: VecDeque::new(),
            max_size: 100,
            is_online: true,
            completed: Vec::new(),
            max_completed: 50,
        }
    }

    /// Enqueue a new operation
    pub fn enqueue(&mut self, operation: QueuedOperation) -> bool {
        if self.operations.len() >= self.max_size {
            return false;
        }
        self.operations.push_back(operation);
        true
    }

    /// Get next pending operation
    pub fn peek(&self) -> Option<&QueuedOperation> {
        self.operations.front()
    }

    /// Dequeue an operation
    pub fn dequeue(&mut self) -> Option<QueuedOperation> {
        self.operations.pop_front()
    }

    /// Move completed operation to history
    pub fn mark_completed(&mut self, mut operation: QueuedOperation) {
        operation.complete();
        self.completed.push(operation);
        while self.completed.len() > self.max_completed {
            self.completed.remove(0);
        }
    }

    /// Requeue a failed operation for retry
    pub fn requeue(&mut self, mut operation: QueuedOperation) {
        operation.increment_retry();
        operation.status = QueuedOperationStatus::Pending;
        self.operations.push_front(operation);
    }

    /// Set online status
    pub fn set_online(&mut self, online: bool) {
        self.is_online = online;
    }

    /// Check if online
    pub fn is_online(&self) -> bool {
        self.is_online
    }

    /// Get pending count
    pub fn pending_count(&self) -> usize {
        self.operations.iter()
            .filter(|op| matches!(op.status, QueuedOperationStatus::Pending))
            .count()
    }

    /// Get all pending operations
    pub fn get_pending(&self) -> Vec<&QueuedOperation> {
        self.operations.iter()
            .filter(|op| matches!(op.status, QueuedOperationStatus::Pending))
            .collect()
    }

    /// Clear all pending operations
    pub fn clear_pending(&mut self) {
        self.operations.retain(|op| !matches!(op.status, QueuedOperationStatus::Pending));
    }

    /// Cancel operation by ID
    pub fn cancel(&mut self, id: &str) -> bool {
        if let Some(op) = self.operations.iter_mut().find(|op| op.id == id) {
            op.cancel();
            true
        } else {
            false
        }
    }
}

// =============================================================================
// Shared Agent State
// =============================================================================

/// Shared state for the agent panel with all features integrated
pub struct SharedAgentState {
    /// Core agent state
    pub agent: AgentState,
    /// Action bar state
    pub actions: ActionBarState,
    /// Context management state
    pub context: ContextState,
    /// Undo manager
    pub undo_manager: UndoManager,
    /// Offline queue
    pub offline_queue: OfflineQueue,
    /// State observers
    observers: HashMap<SubscriptionId, Box<dyn Fn(&StateChange) + Send + Sync>>,
    /// Next observer ID
    next_observer_id: SubscriptionId,
    /// Keyboard shortcuts enabled
    pub shortcuts_enabled: bool,
    /// Voice input available
    pub voice_available: bool,
    /// Voice input active
    pub voice_active: bool,
    /// Thread mode enabled
    pub threading_enabled: bool,
    /// Active thread ID
    pub active_thread_id: Option<String>,
    /// Message ratings
    pub message_ratings: HashMap<String, MessageRating>,
    /// Pending rating
    pub pending_rating: Option<String>,
}

/// Rating for a message
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRating {
    Positive,
    Negative,
}

impl Default for SharedAgentState {
    fn default() -> Self {
        Self {
            agent: AgentState::default(),
            actions: ActionBarState::default(),
            context: ContextState::default(),
            undo_manager: UndoManager::new(),
            offline_queue: OfflineQueue::new(),
            observers: HashMap::new(),
            next_observer_id: 1,
            shortcuts_enabled: true,
            voice_available: false,
            voice_active: false,
            threading_enabled: false,
            active_thread_id: None,
            message_ratings: HashMap::new(),
            pending_rating: None,
        }
    }
}

impl SharedAgentState {
    pub fn new() -> Self {
        Self::default()
    }

    // =========================================================================
    // Observer Pattern
    // =========================================================================

    /// Subscribe to state changes
    pub fn subscribe<F>(&mut self, callback: F) -> SubscriptionId
    where
        F: Fn(&StateChange) + Send + Sync + 'static,
    {
        let id = self.next_observer_id;
        self.next_observer_id += 1;
        self.observers.insert(id, Box::new(callback));
        id
    }

    /// Unsubscribe from state changes
    pub fn unsubscribe(&mut self, id: SubscriptionId) {
        self.observers.remove(&id);
    }

    /// Notify observers of a change
    pub fn notify(&self, change: &StateChange) {
        for callback in self.observers.values() {
            callback(change);
        }
    }

    // =========================================================================
    // Message Operations (with undo support)
    // =========================================================================

    /// Add user message with undo support
    pub fn add_user_message(&mut self, content: String) {
        let message = ChatMessage::new_user(content);
        self.undo_manager.push(UndoableAction::AddMessage(message.clone()));
        self.agent.messages.push(message.clone());
        self.notify(&StateChange::MessageAdded(message.id));
    }

    /// Delete message with undo support
    pub fn delete_message(&mut self, id: &str) {
        if let Some(pos) = self.agent.messages.iter().position(|m| m.id == id) {
            let message = self.agent.messages.remove(pos);
            self.undo_manager.push(UndoableAction::DeleteMessage(id.to_string(), message));
            self.notify(&StateChange::MessageUpdated(id.to_string()));
        }
    }

    /// Clear conversation with undo support
    pub fn clear_conversation(&mut self) {
        let messages = self.agent.messages.clone();
        self.undo_manager.push(UndoableAction::ClearConversation(messages));
        self.agent.clear_history();
        self.notify(&StateChange::ViewStateChanged("conversation_cleared".to_string()));
    }

    // =========================================================================
    // Undo/Redo Operations
    // =========================================================================

    /// Perform undo
    pub fn undo(&mut self) -> bool {
        if let Some(action) = self.undo_manager.pop_undo() {
            self.apply_undo(&action);
            true
        } else {
            false
        }
    }

    /// Perform redo
    pub fn redo(&mut self) -> bool {
        if let Some(action) = self.undo_manager.pop_redo() {
            self.apply_redo(&action);
            true
        } else {
            false
        }
    }

    /// Apply an undo action
    fn apply_undo(&mut self, action: &UndoableAction) {
        match action {
            UndoableAction::AddMessage(msg) => {
                self.agent.messages.retain(|m| m.id != msg.id);
            }
            UndoableAction::DeleteMessage(_, msg) => {
                self.agent.messages.push(msg.clone());
            }
            UndoableAction::UpdateMessage(id, old_content, _) => {
                if let Some(msg) = self.agent.messages.iter_mut().find(|m| m.id == *id) {
                    msg.content = old_content.clone();
                }
            }
            UndoableAction::ToggleContext(id, was_enabled) => {
                if let Some(source) = self.context.sources.iter_mut().find(|s| s.id == *id) {
                    source.enabled = *was_enabled;
                }
            }
            UndoableAction::ChangeContextPriority(id, old_priority, _) => {
                self.context.set_source_priority(id, priority_from_u8(*old_priority));
            }
            UndoableAction::InjectContext(source) => {
                self.context.remove_source(&source.id);
            }
            UndoableAction::RemoveContext(_, source) => {
                self.context.add_source(source.clone());
            }
            UndoableAction::ChangeInput(old, _) => {
                self.agent.input_text = old.clone();
            }
            UndoableAction::ClearConversation(messages) => {
                self.agent.messages = messages.clone();
            }
        }
    }

    /// Apply a redo action
    fn apply_redo(&mut self, action: &UndoableAction) {
        match action {
            UndoableAction::AddMessage(msg) => {
                self.agent.messages.push(msg.clone());
            }
            UndoableAction::DeleteMessage(id, _) => {
                self.agent.messages.retain(|m| m.id != *id);
            }
            UndoableAction::UpdateMessage(id, _, new_content) => {
                if let Some(msg) = self.agent.messages.iter_mut().find(|m| m.id == *id) {
                    msg.content = new_content.clone();
                }
            }
            UndoableAction::ToggleContext(id, was_enabled) => {
                if let Some(source) = self.context.sources.iter_mut().find(|s| s.id == *id) {
                    source.enabled = !*was_enabled;
                }
            }
            UndoableAction::ChangeContextPriority(id, _, new_priority) => {
                self.context.set_source_priority(id, priority_from_u8(*new_priority));
            }
            UndoableAction::InjectContext(source) => {
                self.context.add_source(source.clone());
            }
            UndoableAction::RemoveContext(id, _) => {
                self.context.remove_source(id);
            }
            UndoableAction::ChangeInput(_, new) => {
                self.agent.input_text = new.clone();
            }
            UndoableAction::ClearConversation(_) => {
                self.agent.clear_history();
            }
        }
    }

    // =========================================================================
    // Offline Queue Operations
    // =========================================================================

    /// Queue a message to be sent when online
    pub fn queue_message(&mut self, content: String) -> bool {
        let operation = QueuedOperation::new(
            OperationType::SendMessage,
            content,
        );
        self.offline_queue.enqueue(operation)
    }

    /// Process queued operations
    pub fn process_queue(&mut self) -> Vec<QueuedOperation> {
        let mut processed = Vec::new();
        while let Some(op) = self.offline_queue.dequeue() {
            if matches!(op.status, QueuedOperationStatus::Pending) {
                processed.push(op);
            }
        }
        processed
    }

    /// Check if online
    pub fn is_online(&self) -> bool {
        self.offline_queue.is_online()
    }

    /// Set online status
    pub fn set_online(&mut self, online: bool) {
        self.offline_queue.set_online(online);
        if online {
            self.notify(&StateChange::ViewStateChanged("online".to_string()));
        } else {
            self.notify(&StateChange::ViewStateChanged("offline".to_string()));
        }
    }

    // =========================================================================
    // Message Rating
    // =========================================================================

    /// Rate a message
    pub fn rate_message(&mut self, message_id: &str, rating: MessageRating) {
        self.message_ratings.insert(message_id.to_string(), rating);
        self.notify(&StateChange::MessageUpdated(message_id.to_string()));
    }

    /// Get message rating
    pub fn get_rating(&self, message_id: &str) -> Option<MessageRating> {
        self.message_ratings.get(message_id).copied()
    }

    /// Clear message rating
    pub fn clear_rating(&mut self, message_id: &str) {
        self.message_ratings.remove(message_id);
    }

    // =========================================================================
    // Threading
    // =========================================================================

    /// Start a new thread from a message
    pub fn start_thread(&mut self, message_id: &str) {
        self.active_thread_id = Some(message_id.to_string());
        self.threading_enabled = true;
        self.notify(&StateChange::ViewStateChanged("thread_started".to_string()));
    }

    /// End current thread
    pub fn end_thread(&mut self) {
        self.active_thread_id = None;
        self.threading_enabled = false;
        self.notify(&StateChange::ViewStateChanged("thread_ended".to_string()));
    }

    // =========================================================================
    // Voice Input
    // =========================================================================

    /// Toggle voice input
    pub fn toggle_voice(&mut self) {
        if self.voice_available {
            self.voice_active = !self.voice_active;
            self.notify(&StateChange::ViewStateChanged(
                if self.voice_active { "voice_started".to_string() }
                else { "voice_stopped".to_string() }
            ));
        }
    }

    /// Set voice availability
    pub fn set_voice_available(&mut self, available: bool) {
        self.voice_available = available;
    }

    // =========================================================================
    // Context Integration
    // =========================================================================

    /// Toggle context source with undo support
    pub fn toggle_context_source(&mut self, id: &str) {
        if let Some(source) = self.context.sources.iter().find(|s| s.id == id) {
            let was_enabled = source.enabled;
            self.undo_manager.push(UndoableAction::ToggleContext(id.to_string(), was_enabled));
        }
        self.context.toggle_source(id);
        self.notify(&StateChange::ContextToggled(id.to_string(), true));
    }

    /// Build context for agent query
    pub fn build_context(&self) -> String {
        self.context.build_context_string()
    }

    // =========================================================================
    // Persistence
    // =========================================================================

    /// Serialize state to JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        let serializable = SerializableState {
            messages: self.agent.messages.iter().map(|m| SerializableMessage {
                id: m.id.clone(),
                role: format!("{:?}", m.role),
                content: m.content.clone(),
                timestamp: m.timestamp.clone(),
            }).collect(),
            input_text: self.agent.input_text.clone(),
            ratings: self.message_ratings.iter().map(|(k, v)| {
                (k.clone(), match v {
                    MessageRating::Positive => "positive".to_string(),
                    MessageRating::Negative => "negative".to_string(),
                })
            }).collect(),
            context_enabled: self.context.sources.iter()
                .filter(|s| s.enabled)
                .map(|s| s.id.clone())
                .collect(),
        };
        serde_json::to_string_pretty(&serializable)
    }

    /// Get state summary for debugging
    pub fn get_summary(&self) -> StateSummary {
        StateSummary {
            message_count: self.agent.messages.len(),
            pending_operations: self.offline_queue.pending_count(),
            undo_available: self.undo_manager.can_undo(),
            redo_available: self.undo_manager.can_redo(),
            context_sources: self.context.sources.len(),
            enabled_sources: self.context.sources.iter().filter(|s| s.enabled).count(),
            total_tokens: self.context.get_total_tokens(),
            is_online: self.offline_queue.is_online(),
            active_thread: self.active_thread_id.is_some(),
        }
    }
}

/// Serializable version of state
#[derive(Serialize, Deserialize)]
struct SerializableState {
    messages: Vec<SerializableMessage>,
    input_text: String,
    ratings: HashMap<String, String>,
    context_enabled: Vec<String>,
}

/// Serializable message
#[derive(Serialize, Deserialize)]
struct SerializableMessage {
    id: String,
    role: String,
    content: String,
    timestamp: String,
}

/// Summary of current state
#[derive(Debug, Clone)]
pub struct StateSummary {
    pub message_count: usize,
    pub pending_operations: usize,
    pub undo_available: bool,
    pub redo_available: bool,
    pub context_sources: usize,
    pub enabled_sources: usize,
    pub total_tokens: usize,
    pub is_online: bool,
    pub active_thread: bool,
}

// =============================================================================
// Rendering
// =============================================================================

/// Render undo/redo buttons
pub fn render_undo_redo_buttons<F, G>(
    theme: &Theme,
    state: &SharedAgentState,
    on_undo: F,
    on_redo: G,
) -> Div
where
    F: Fn() + Clone + 'static,
    G: Fn() + Clone + 'static,
{
    div()
        .id("undo-redo-buttons")
        .flex()
        .items_center()
        .gap(px(4.0))
        // Undo button
        .child({
            let callback = on_undo;
            let can_undo = state.undo_manager.can_undo();
            render_action_button(
                theme,
                "undo",
                "<-",
                "Undo",
                can_undo,
                move || callback(),
            )
        })
        // Redo button
        .child({
            let callback = on_redo;
            let can_redo = state.undo_manager.can_redo();
            render_action_button(
                theme,
                "redo",
                "->",
                "Redo",
                can_redo,
                move || callback(),
            )
        })
}

/// Render offline indicator
pub fn render_offline_indicator(theme: &Theme, state: &SharedAgentState) -> Div {
    let pending = state.offline_queue.pending_count();
    let is_online = state.offline_queue.is_online();

    div()
        .id("offline-indicator")
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(if is_online {
            CatppuccinMocha::green().opacity(0.1)
        } else {
            CatppuccinMocha::yellow().opacity(0.1)
        })
        .border_1()
        .border_color(if is_online {
            CatppuccinMocha::green().opacity(0.3)
        } else {
            CatppuccinMocha::yellow().opacity(0.3)
        })
        // Status dot
        .child(
            div()
                .size(px(8.0))
                .rounded_full()
                .bg(if is_online {
                    CatppuccinMocha::green()
                } else {
                    CatppuccinMocha::yellow()
                })
        )
        // Status text
        .child(
            div()
                .text_size(px(11.0))
                .text_color(if is_online {
                    CatppuccinMocha::green()
                } else {
                    CatppuccinMocha::yellow()
                })
                .child(if is_online { "Online" } else { "Offline" })
        )
        // Pending count
        .when(pending > 0, |el| {
            el.child(
                div()
                    .px(px(6.0))
                    .py(px(2.0))
                    .rounded(px(4.0))
                    .bg(CatppuccinMocha::surface1())
                    .child(
                        div()
                            .text_size(px(10.0))
                            .text_color(CatppuccinMocha::subtext0())
                            .child(format!("{} queued", pending))
                    )
            )
        })
}

/// Render message rating buttons
pub fn render_rating_buttons<F>(
    theme: &Theme,
    message_id: &str,
    current_rating: Option<MessageRating>,
    on_rate: F,
) -> Div
where
    F: Fn(MessageRating) + Clone + 'static,
{
    let message_id_owned = message_id.to_string();
    let on_rate_positive = on_rate.clone();
    let on_rate_negative = on_rate;

    div()
        .id(format!("rating-{}", message_id))
        .flex()
        .items_center()
        .gap(px(4.0))
        // Thumbs up
        .child({
            let is_selected = current_rating == Some(MessageRating::Positive);
            div()
                .id(format!("rate-pos-{}", message_id_owned))
                .size(px(24.0))
                .rounded(px(4.0))
                .bg(if is_selected {
                    CatppuccinMocha::green().opacity(0.2)
                } else {
                    CatppuccinMocha::surface0()
                })
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::green().opacity(0.15)))
                .on_click(move |_event, _window, _cx| {
                    on_rate_positive(MessageRating::Positive);
                })
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
                        .child("+")
                )
        })
        // Thumbs down
        .child({
            let is_selected = current_rating == Some(MessageRating::Negative);
            div()
                .id(format!("rate-neg-{}", message_id_owned))
                .size(px(24.0))
                .rounded(px(4.0))
                .bg(if is_selected {
                    CatppuccinMocha::red().opacity(0.2)
                } else {
                    CatppuccinMocha::surface0()
                })
                .cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::red().opacity(0.15)))
                .on_click(move |_event, _window, _cx| {
                    on_rate_negative(MessageRating::Negative);
                })
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
                        .child("-")
                )
        })
}

/// Render a generic action button
fn render_action_button<F>(
    theme: &Theme,
    id: &str,
    icon: &str,
    label: &str,
    enabled: bool,
    on_click: F,
) -> Div
where
    F: Fn() + 'static,
{
    div()
        .id(id.to_string())
        .px(px(8.0))
        .py(px(6.0))
        .rounded(px(4.0))
        .bg(if enabled {
            CatppuccinMocha::surface0()
        } else {
            CatppuccinMocha::mantle()
        })
        .border_1()
        .border_color(if enabled {
            CatppuccinMocha::surface1()
        } else {
            CatppuccinMocha::surface0()
        })
        .when(enabled, |el| {
            el.cursor_pointer()
                .hover(|s| s.bg(CatppuccinMocha::surface1()))
                .on_click(move |_event, _window, _cx| {
                    on_click();
                })
        })
        .flex()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(11.0))
                .text_color(if enabled {
                    CatppuccinMocha::text()
                } else {
                    CatppuccinMocha::overlay0()
                })
                .child(icon.to_string())
        )
        .child(
            div()
                .text_size(px(10.0))
                .text_color(if enabled {
                    CatppuccinMocha::subtext0()
                } else {
                    CatppuccinMocha::overlay0()
                })
                .child(label.to_string())
        )
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate operation ID
fn generate_operation_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("op-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
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

/// Convert priority from u8
fn priority_from_u8(value: u8) -> crate::agent_context::ContextPriority {
    match value {
        1 => crate::agent_context::ContextPriority::Low,
        2 => crate::agent_context::ContextPriority::Medium,
        3 => crate::agent_context::ContextPriority::High,
        4 => crate::agent_context::ContextPriority::Critical,
        _ => crate::agent_context::ContextPriority::Medium,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_undo_manager() {
        let mut manager = UndoManager::new();
        assert!(!manager.can_undo());
        assert!(!manager.can_redo());

        let message = ChatMessage::new_user("Test".to_string());
        manager.push(UndoableAction::AddMessage(message));
        assert!(manager.can_undo());
        assert!(!manager.can_redo());

        manager.pop_undo();
        assert!(!manager.can_undo());
        assert!(manager.can_redo());

        manager.pop_redo();
        assert!(manager.can_undo());
        assert!(!manager.can_redo());
    }

    #[test]
    fn test_offline_queue() {
        let mut queue = OfflineQueue::new();
        assert!(queue.is_online());
        assert_eq!(queue.pending_count(), 0);

        let op = QueuedOperation::new(OperationType::SendMessage, "test".to_string());
        assert!(queue.enqueue(op));
        assert_eq!(queue.pending_count(), 1);

        queue.set_online(false);
        assert!(!queue.is_online());

        let dequeued = queue.dequeue();
        assert!(dequeued.is_some());
        assert_eq!(queue.pending_count(), 0);
    }

    #[test]
    fn test_queued_operation() {
        let mut op = QueuedOperation::new(OperationType::SendMessage, "test".to_string());
        assert_eq!(op.status, QueuedOperationStatus::Pending);
        assert!(op.can_retry());

        op.start();
        assert_eq!(op.status, QueuedOperationStatus::InProgress);

        op.fail("Test error");
        assert_eq!(op.status, QueuedOperationStatus::Failed);
        assert!(op.error.is_some());
        assert!(op.can_retry());

        for _ in 0..3 {
            op.increment_retry();
        }
        assert!(!op.can_retry());
    }

    #[test]
    fn test_shared_state() {
        let mut state = SharedAgentState::new();
        let initial_count = state.agent.messages.len();

        state.add_user_message("Test".to_string());
        assert_eq!(state.agent.messages.len(), initial_count + 1);
        assert!(state.undo_manager.can_undo());

        state.undo();
        assert_eq!(state.agent.messages.len(), initial_count);
        assert!(state.undo_manager.can_redo());

        state.redo();
        assert_eq!(state.agent.messages.len(), initial_count + 1);
    }

    #[test]
    fn test_message_rating() {
        let mut state = SharedAgentState::new();
        let msg_id = "test-msg";

        assert!(state.get_rating(msg_id).is_none());

        state.rate_message(msg_id, MessageRating::Positive);
        assert_eq!(state.get_rating(msg_id), Some(MessageRating::Positive));

        state.rate_message(msg_id, MessageRating::Negative);
        assert_eq!(state.get_rating(msg_id), Some(MessageRating::Negative));

        state.clear_rating(msg_id);
        assert!(state.get_rating(msg_id).is_none());
    }

    #[test]
    fn test_state_summary() {
        let state = SharedAgentState::new();
        let summary = state.get_summary();

        assert!(summary.message_count > 0);
        assert_eq!(summary.pending_operations, 0);
        assert!(!summary.undo_available);
        assert!(!summary.redo_available);
        assert!(summary.is_online);
    }

    #[test]
    fn test_observable() {
        let mut observable = Observable::new(0);
        assert_eq!(*observable.get(), 0);

        observable.set(42, StateChange::Custom("test".to_string(), "value".to_string()));
        assert_eq!(*observable.get(), 42);
    }
}
