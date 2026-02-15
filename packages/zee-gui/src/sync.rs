//! Stanley Sync Client
//!
//! WebSocket client for real-time synchronization between the Rust GUI
//! and the Stanley agent. Handles bidirectional event communication,
//! reconnection logic, and message queuing.

// Allow large error types - SyncError contains WebSocketError which is 136 bytes
#![allow(clippy::result_large_err)]

use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::env;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{interval, timeout};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error as WsError, Message},
};
use url::Url;

// =============================================================================
// Sync Event Types
// =============================================================================

const ALLOW_REMOTE_ENV: &str = "STANLEY_ALLOW_REMOTE";

/// Types of sync events
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncEventType {
    // Portfolio events
    PortfolioUpdate,
    PortfolioHoldingAdded,
    PortfolioHoldingRemoved,

    // Note events
    NoteSaved,
    NoteDeleted,
    NoteUpdated,
    ThesisCreated,
    TradeOpened,
    TradeClosed,

    // Research events
    ResearchComplete,
    ResearchStarted,
    ResearchProgress,

    // Alert events
    AlertTriggered,
    AlertAcknowledged,
    PriceAlert,
    FlowAlert,

    // Market data events
    MarketDataUpdate,
    CommodityUpdate,

    // Real-time streaming events
    BarUpdate,
    OptionsFlowUpdate,
    DarkPoolActivity,

    // View events (GUI -> Agent)
    ViewOpened,
    ViewClosed,
    SymbolSelected,
    SymbolDeselected,

    // Agent events
    AgentQueryStart,
    AgentQueryComplete,
    AgentToolCall,
    AgentToolResult,
    AgentError,

    // Connection events
    ClientConnected,
    ClientDisconnected,
    SyncError,
}

impl SyncEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncEventType::PortfolioUpdate => "portfolio_update",
            SyncEventType::PortfolioHoldingAdded => "portfolio_holding_added",
            SyncEventType::PortfolioHoldingRemoved => "portfolio_holding_removed",
            SyncEventType::NoteSaved => "note_saved",
            SyncEventType::NoteDeleted => "note_deleted",
            SyncEventType::NoteUpdated => "note_updated",
            SyncEventType::ThesisCreated => "thesis_created",
            SyncEventType::TradeOpened => "trade_opened",
            SyncEventType::TradeClosed => "trade_closed",
            SyncEventType::ResearchComplete => "research_complete",
            SyncEventType::ResearchStarted => "research_started",
            SyncEventType::ResearchProgress => "research_progress",
            SyncEventType::AlertTriggered => "alert_triggered",
            SyncEventType::AlertAcknowledged => "alert_acknowledged",
            SyncEventType::PriceAlert => "price_alert",
            SyncEventType::FlowAlert => "flow_alert",
            SyncEventType::MarketDataUpdate => "market_data_update",
            SyncEventType::CommodityUpdate => "commodity_update",
            SyncEventType::BarUpdate => "bar_update",
            SyncEventType::OptionsFlowUpdate => "options_flow_update",
            SyncEventType::DarkPoolActivity => "dark_pool_activity",
            SyncEventType::ViewOpened => "view_opened",
            SyncEventType::ViewClosed => "view_closed",
            SyncEventType::SymbolSelected => "symbol_selected",
            SyncEventType::SymbolDeselected => "symbol_deselected",
            SyncEventType::AgentQueryStart => "agent_query_start",
            SyncEventType::AgentQueryComplete => "agent_query_complete",
            SyncEventType::AgentToolCall => "agent_tool_call",
            SyncEventType::AgentToolResult => "agent_tool_result",
            SyncEventType::AgentError => "agent_error",
            SyncEventType::ClientConnected => "client_connected",
            SyncEventType::ClientDisconnected => "client_disconnected",
            SyncEventType::SyncError => "sync_error",
        }
    }
}

fn allow_remote_env() -> bool {
    match env::var(ALLOW_REMOTE_ENV) {
        Ok(value) => matches!(
            value.to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

fn is_localhost_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

fn ensure_safe_ws_url(server_url: &str) -> Result<(), SyncError> {
    let url = Url::parse(server_url)?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err(SyncError::UnsafeUrl(
            "WebSocket URL must not include credentials".to_string(),
        ));
    }

    let scheme = url.scheme();
    if scheme != "ws" && scheme != "wss" {
        return Err(SyncError::UnsafeUrl(
            "WebSocket URL must use ws or wss".to_string(),
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| SyncError::UnsafeUrl("WebSocket URL must include a host".to_string()))?;

    if is_localhost_host(host) {
        return Ok(());
    }

    if !allow_remote_env() {
        return Err(SyncError::UnsafeUrl(
            "Remote WebSocket URL blocked. Set STANLEY_ALLOW_REMOTE=1 to allow".to_string(),
        ));
    }

    if scheme != "wss" {
        return Err(SyncError::UnsafeUrl(
            "Remote WebSocket URL requires wss".to_string(),
        ));
    }

    Ok(())
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WsMessageType {
    Ping,
    Pong,
    Subscribe,
    Unsubscribe,
    Ack,
    Error,
    Event,
    Batch,
    StateSync,
    StateRequest,
}

/// WebSocket message structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessage {
    #[serde(rename = "type")]
    pub msg_type: WsMessageType,
    pub id: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

impl WsMessage {
    pub fn new(msg_type: WsMessageType, payload: Option<serde_json::Value>) -> Self {
        Self {
            msg_type,
            id: generate_message_id(),
            timestamp: chrono_now(),
            payload,
        }
    }

    pub fn ping() -> Self {
        Self::new(WsMessageType::Ping, None)
    }

    pub fn pong() -> Self {
        Self::new(WsMessageType::Pong, None)
    }

    pub fn subscribe(event_types: Vec<SyncEventType>) -> Self {
        Self::new(
            WsMessageType::Subscribe,
            Some(serde_json::json!({
                "eventTypes": event_types.iter().map(|e| e.as_str()).collect::<Vec<_>>()
            })),
        )
    }

    pub fn event(event: SyncEvent) -> Self {
        Self::new(
            WsMessageType::Event,
            Some(serde_json::to_value(event).unwrap_or_default()),
        )
    }

    pub fn state_request() -> Self {
        Self::new(WsMessageType::StateRequest, None)
    }
}

// =============================================================================
// Sync Events
// =============================================================================

/// Base sync event structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: SyncEventType,
    pub timestamp: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl SyncEvent {
    pub fn new(event_type: SyncEventType, data: Option<serde_json::Value>) -> Self {
        Self {
            id: generate_event_id(),
            event_type,
            timestamp: chrono_now(),
            source: "gui".to_string(),
            correlation_id: None,
            data,
        }
    }

    /// Create a view opened event
    pub fn view_opened(view_name: &str, view_type: &str, symbol: Option<&str>) -> Self {
        Self::new(
            SyncEventType::ViewOpened,
            Some(serde_json::json!({
                "viewName": view_name,
                "viewType": view_type,
                "context": {
                    "selectedSymbol": symbol
                }
            })),
        )
    }

    /// Create a view closed event
    #[allow(dead_code)]
    pub fn view_closed(view_name: &str) -> Self {
        Self::new(
            SyncEventType::ViewClosed,
            Some(serde_json::json!({
                "viewName": view_name
            })),
        )
    }

    /// Create a symbol selected event
    pub fn symbol_selected(symbol: &str, context: &str, previous: Option<&str>) -> Self {
        Self::new(
            SyncEventType::SymbolSelected,
            Some(serde_json::json!({
                "symbol": symbol,
                "viewContext": context,
                "previousSymbol": previous
            })),
        )
    }
}

// =============================================================================
// Connection State
// =============================================================================

/// WebSocket connection status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConnectionStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

impl ConnectionStatus {
    #[allow(dead_code)]
    pub fn label(&self) -> &'static str {
        match self {
            ConnectionStatus::Disconnected => "Disconnected",
            ConnectionStatus::Connecting => "Connecting...",
            ConnectionStatus::Connected => "Connected",
            ConnectionStatus::Reconnecting => "Reconnecting...",
            ConnectionStatus::Error => "Error",
        }
    }

    #[allow(dead_code)]
    pub fn is_connected(&self) -> bool {
        matches!(self, ConnectionStatus::Connected)
    }
}

// =============================================================================
// Message Queue
// =============================================================================

/// Queue for messages during offline periods
#[derive(Debug)]
pub struct MessageQueue {
    queue: VecDeque<WsMessage>,
    max_size: usize,
}

impl MessageQueue {
    pub fn new(max_size: usize) -> Self {
        Self {
            queue: VecDeque::with_capacity(max_size),
            max_size,
        }
    }

    pub fn enqueue(&mut self, message: WsMessage) {
        if self.queue.len() >= self.max_size {
            self.queue.pop_front();
        }
        self.queue.push_back(message);
    }

    pub fn drain(&mut self) -> Vec<WsMessage> {
        self.queue.drain(..).collect()
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.queue.clear();
    }
}

impl Default for MessageQueue {
    fn default() -> Self {
        Self::new(100)
    }
}

// =============================================================================
// Sync Client State
// =============================================================================

/// State for the sync client
pub struct SyncClientState {
    /// Current connection status
    pub status: ConnectionStatus,
    /// WebSocket server URL
    pub server_url: String,
    /// Message queue for offline periods
    pub message_queue: MessageQueue,
    /// Subscribed event types
    pub subscriptions: Vec<SyncEventType>,
    /// Last ping timestamp
    pub last_ping: Option<String>,
    /// Last received event
    pub last_event: Option<SyncEvent>,
    /// Recent events cache
    pub event_history: VecDeque<SyncEvent>,
    /// Max event history size
    pub max_history: usize,
    /// Reconnection attempts
    pub reconnect_attempts: u32,
    /// Max reconnection attempts
    pub max_reconnect_attempts: u32,
    /// Reconnection delay (ms)
    pub reconnect_delay_ms: u64,
}

impl Default for SyncClientState {
    fn default() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            server_url: "ws://127.0.0.1:8765/ws".to_string(),
            message_queue: MessageQueue::default(),
            subscriptions: vec![
                SyncEventType::PortfolioUpdate,
                SyncEventType::NoteSaved,
                SyncEventType::ResearchComplete,
                SyncEventType::AlertTriggered,
                SyncEventType::AgentQueryComplete,
                SyncEventType::AgentToolCall,
                // Real-time streaming
                SyncEventType::BarUpdate,
                SyncEventType::OptionsFlowUpdate,
                SyncEventType::DarkPoolActivity,
            ],
            last_ping: None,
            last_event: None,
            event_history: VecDeque::with_capacity(50),
            max_history: 50,
            reconnect_attempts: 0,
            max_reconnect_attempts: 5,
            reconnect_delay_ms: 1000,
        }
    }
}

impl SyncClientState {
    pub fn new(server_url: &str) -> Self {
        Self {
            server_url: server_url.to_string(),
            ..Default::default()
        }
    }

    /// Add event to history
    pub fn add_event(&mut self, event: SyncEvent) {
        if self.event_history.len() >= self.max_history {
            self.event_history.pop_front();
        }
        self.last_event = Some(event.clone());
        self.event_history.push_back(event);
    }

    /// Get events by type
    #[allow(dead_code)]
    pub fn get_events_by_type(&self, event_type: SyncEventType) -> Vec<&SyncEvent> {
        self.event_history
            .iter()
            .filter(|e| e.event_type == event_type)
            .collect()
    }

    /// Queue message for sending
    pub fn queue_message(&mut self, message: WsMessage) {
        self.message_queue.enqueue(message);
    }

    /// Queue event for sending
    #[allow(dead_code)]
    pub fn queue_event(&mut self, event: SyncEvent) {
        self.queue_message(WsMessage::event(event));
    }

    /// Reset reconnection state
    pub fn reset_reconnect(&mut self) {
        self.reconnect_attempts = 0;
    }

    /// Increment reconnection attempts
    pub fn increment_reconnect(&mut self) -> bool {
        self.reconnect_attempts += 1;
        self.reconnect_attempts <= self.max_reconnect_attempts
    }

    /// Get reconnection delay with exponential backoff
    pub fn get_reconnect_delay(&self) -> u64 {
        let base = self.reconnect_delay_ms;
        let factor = 2u64.pow(self.reconnect_attempts.min(5));
        base * factor
    }
}

// =============================================================================
// Sync Client
// =============================================================================

/// Channel messages for sync client
#[derive(Debug)]
#[allow(dead_code)]
pub enum SyncCommand {
    Connect,
    Disconnect,
    Send(WsMessage),
    Subscribe(Vec<SyncEventType>),
    Unsubscribe(Vec<SyncEventType>),
}

/// Sync client for managing WebSocket connection
pub struct SyncClient {
    state: Arc<tokio::sync::RwLock<SyncClientState>>,
    command_tx: Option<mpsc::Sender<SyncCommand>>,
    #[allow(dead_code)]
    event_rx: Option<mpsc::Receiver<SyncEvent>>,
}

impl SyncClient {
    pub fn new(server_url: &str) -> Self {
        Self {
            state: Arc::new(tokio::sync::RwLock::new(SyncClientState::new(server_url))),
            command_tx: None,
            event_rx: None,
        }
    }

    /// Get current connection status
    #[allow(dead_code)]
    pub async fn status(&self) -> ConnectionStatus {
        self.state.read().await.status
    }

    /// Check if connected
    #[allow(dead_code)]
    pub async fn is_connected(&self) -> bool {
        self.state.read().await.status.is_connected()
    }

    /// Send a message (queues if not connected)
    #[allow(dead_code)]
    pub async fn send(&self, message: WsMessage) {
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SyncCommand::Send(message)).await;
        } else {
            // Queue for later if no connection
            self.state.write().await.queue_message(message);
        }
    }

    /// Send a sync event
    #[allow(dead_code)]
    pub async fn send_event(&self, event: SyncEvent) {
        self.send(WsMessage::event(event)).await;
    }

    /// Emit view opened event
    #[allow(dead_code)]
    pub async fn emit_view_opened(&self, view_name: &str, view_type: &str, symbol: Option<&str>) {
        self.send_event(SyncEvent::view_opened(view_name, view_type, symbol))
            .await;
    }

    /// Emit view closed event
    #[allow(dead_code)]
    pub async fn emit_view_closed(&self, view_name: &str) {
        self.send_event(SyncEvent::view_closed(view_name)).await;
    }

    /// Emit symbol selected event
    #[allow(dead_code)]
    pub async fn emit_symbol_selected(&self, symbol: &str, context: &str, previous: Option<&str>) {
        self.send_event(SyncEvent::symbol_selected(symbol, context, previous))
            .await;
    }

    /// Subscribe to event types
    #[allow(dead_code)]
    pub async fn subscribe(&self, event_types: Vec<SyncEventType>) {
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SyncCommand::Subscribe(event_types)).await;
        }
    }

    /// Get recent events
    #[allow(dead_code)]
    pub async fn get_recent_events(&self, limit: usize) -> Vec<SyncEvent> {
        let state = self.state.read().await;
        state
            .event_history
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get events by type
    #[allow(dead_code)]
    pub async fn get_events_by_type(
        &self,
        event_type: SyncEventType,
        limit: usize,
    ) -> Vec<SyncEvent> {
        let state = self.state.read().await;
        state
            .event_history
            .iter()
            .filter(|e| e.event_type == event_type)
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get last event
    #[allow(dead_code)]
    pub async fn get_last_event(&self) -> Option<SyncEvent> {
        self.state.read().await.last_event.clone()
    }

    /// Connect to the WebSocket server
    /// Returns a receiver for incoming events
    pub async fn connect(&mut self) -> Result<mpsc::Receiver<SyncEvent>, SyncError> {
        let server_url = self.state.read().await.server_url.clone();
        ensure_safe_ws_url(&server_url)?;
        info!("Connecting to WebSocket server at {}", server_url);

        // Set status to connecting
        self.state.write().await.status = ConnectionStatus::Connecting;

        // Create channels
        let (command_tx, command_rx) = mpsc::channel::<SyncCommand>(100);
        let (event_tx, event_rx) = mpsc::channel::<SyncEvent>(100);

        self.command_tx = Some(command_tx.clone());

        // Clone state for the connection task
        let state = Arc::clone(&self.state);

        // Spawn the connection manager task
        tokio::spawn(async move {
            connection_loop(state, server_url, command_rx, event_tx).await;
        });

        // Send connect command
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SyncCommand::Connect).await;
        }

        Ok(event_rx)
    }

    /// Disconnect from the WebSocket server
    #[allow(dead_code)]
    pub async fn disconnect(&self) {
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SyncCommand::Disconnect).await;
        }
    }

    /// Get a clone of the command sender for external use
    pub fn command_sender(&self) -> Option<mpsc::Sender<SyncCommand>> {
        self.command_tx.clone()
    }
}

// =============================================================================
// Sync Error Type
// =============================================================================

/// Errors that can occur during sync operations
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum SyncError {
    #[error("WebSocket connection error: {0}")]
    ConnectionError(String),

    #[error("WebSocket error: {0}")]
    WebSocketError(#[from] WsError),

    #[error("URL parse error: {0}")]
    UrlError(#[from] url::ParseError),

    #[error("JSON serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Unsafe URL: {0}")]
    UnsafeUrl(String),

    #[error("Channel send error")]
    ChannelError,

    #[error("Connection timeout")]
    Timeout,

    #[error("Max reconnection attempts exceeded")]
    MaxReconnectAttemptsExceeded,
}

// =============================================================================
// Connection Loop Implementation
// =============================================================================

/// Configuration for the connection loop
const PING_INTERVAL_SECS: u64 = 30;
#[allow(dead_code)]
const PONG_TIMEOUT_SECS: u64 = 10;
const CONNECTION_TIMEOUT_SECS: u64 = 10;

/// Main connection loop that manages the WebSocket lifecycle
async fn connection_loop(
    state: Arc<tokio::sync::RwLock<SyncClientState>>,
    server_url: String,
    mut command_rx: mpsc::Receiver<SyncCommand>,
    event_tx: mpsc::Sender<SyncEvent>,
) {
    let mut should_reconnect = true;

    while should_reconnect {
        // Attempt to connect
        match establish_connection(&state, &server_url).await {
            Ok((ws_stream, _response)) => {
                info!("WebSocket connection established to {}", server_url);

                // Reset reconnection attempts on successful connection
                {
                    let mut state_guard = state.write().await;
                    state_guard.status = ConnectionStatus::Connected;
                    state_guard.reset_reconnect();
                }

                // Split the WebSocket stream
                let (write, read) = ws_stream.split();

                // Create internal channels for coordinating read/write tasks
                let (ws_tx, ws_rx) = mpsc::channel::<Message>(100);

                // Spawn write task
                let write_handle = tokio::spawn(write_loop(write, ws_rx));

                // Spawn read task
                let read_handle = tokio::spawn(read_loop(
                    read,
                    event_tx.clone(),
                    ws_tx.clone(),
                    Arc::clone(&state),
                ));

                // Spawn ping task
                let ping_tx = ws_tx.clone();
                let ping_state = Arc::clone(&state);
                let ping_handle = tokio::spawn(ping_loop(ping_tx, ping_state));

                // Send queued messages
                flush_message_queue(&state, &ws_tx).await;

                // Send initial subscriptions
                send_subscriptions(&state, &ws_tx).await;

                // Process commands until disconnection
                should_reconnect =
                    process_commands(&state, &mut command_rx, &ws_tx, &event_tx).await;

                // Abort spawned tasks
                write_handle.abort();
                read_handle.abort();
                ping_handle.abort();

                // Update status
                {
                    let mut state_guard = state.write().await;
                    if should_reconnect {
                        state_guard.status = ConnectionStatus::Reconnecting;
                    } else {
                        state_guard.status = ConnectionStatus::Disconnected;
                    }
                }
            }
            Err(e) => {
                error!("Failed to establish WebSocket connection: {}", e);

                let mut state_guard = state.write().await;
                state_guard.status = ConnectionStatus::Error;

                // Check if we should retry
                if !state_guard.increment_reconnect() {
                    error!("Max reconnection attempts exceeded");
                    should_reconnect = false;

                    // Send error event
                    let error_event = SyncEvent::new(
                        SyncEventType::SyncError,
                        Some(serde_json::json!({
                            "error": "Max reconnection attempts exceeded",
                            "lastError": e.to_string()
                        })),
                    );
                    let _ = event_tx.send(error_event).await;
                } else {
                    let delay = state_guard.get_reconnect_delay();
                    state_guard.status = ConnectionStatus::Reconnecting;
                    drop(state_guard);

                    warn!(
                        "Reconnecting in {}ms (attempt {})",
                        delay,
                        state.read().await.reconnect_attempts
                    );
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }
        }
    }

    info!("Connection loop terminated");
}

/// Establish the initial WebSocket connection
async fn establish_connection(
    state: &Arc<tokio::sync::RwLock<SyncClientState>>,
    server_url: &str,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
    ),
    SyncError,
> {
    let url = url::Url::parse(server_url)?;

    // Set status to connecting
    state.write().await.status = ConnectionStatus::Connecting;

    // Attempt connection with timeout
    match timeout(
        Duration::from_secs(CONNECTION_TIMEOUT_SECS),
        connect_async(url.to_string()),
    )
    .await
    {
        Ok(result) => result.map_err(SyncError::WebSocketError),
        Err(_) => Err(SyncError::Timeout),
    }
}

/// Write loop - sends messages from the channel to the WebSocket
async fn write_loop(
    mut write: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    mut rx: mpsc::Receiver<Message>,
) {
    while let Some(msg) = rx.recv().await {
        if let Err(e) = write.send(msg).await {
            error!("Failed to send WebSocket message: {}", e);
            break;
        }
    }
    debug!("Write loop terminated");
}

/// Read loop - reads messages from WebSocket and dispatches them
async fn read_loop(
    mut read: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
    event_tx: mpsc::Sender<SyncEvent>,
    ws_tx: mpsc::Sender<Message>,
    state: Arc<tokio::sync::RwLock<SyncClientState>>,
) {
    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(msg) => {
                if !handle_incoming_message(msg, &event_tx, &ws_tx, &state).await {
                    break;
                }
            }
            Err(e) => {
                error!("WebSocket read error: {}", e);
                break;
            }
        }
    }
    debug!("Read loop terminated");
}

/// Handle an incoming WebSocket message
async fn handle_incoming_message(
    msg: Message,
    event_tx: &mpsc::Sender<SyncEvent>,
    ws_tx: &mpsc::Sender<Message>,
    state: &Arc<tokio::sync::RwLock<SyncClientState>>,
) -> bool {
    match msg {
        Message::Text(text) => {
            debug!("Received text message: {}", text);

            // Try to parse as WsMessage
            match serde_json::from_str::<WsMessage>(&text) {
                Ok(ws_msg) => {
                    handle_ws_message(ws_msg, event_tx, ws_tx, state).await;
                }
                Err(e) => {
                    warn!("Failed to parse WebSocket message: {}", e);
                }
            }
            true
        }
        Message::Binary(data) => {
            debug!("Received binary message ({} bytes)", data.len());
            // Try to parse binary as JSON
            if let Ok(text) = String::from_utf8(data.to_vec()) {
                if let Ok(ws_msg) = serde_json::from_str::<WsMessage>(&text) {
                    handle_ws_message(ws_msg, event_tx, ws_tx, state).await;
                }
            }
            true
        }
        Message::Ping(data) => {
            debug!("Received ping, sending pong");
            let _ = ws_tx.send(Message::Pong(data)).await;
            true
        }
        Message::Pong(_) => {
            debug!("Received pong");
            state.write().await.last_ping = Some(chrono_now());
            true
        }
        Message::Close(frame) => {
            info!("Received close frame: {:?}", frame);
            false
        }
        Message::Frame(_) => true,
    }
}

/// Handle a parsed WsMessage
async fn handle_ws_message(
    ws_msg: WsMessage,
    event_tx: &mpsc::Sender<SyncEvent>,
    ws_tx: &mpsc::Sender<Message>,
    state: &Arc<tokio::sync::RwLock<SyncClientState>>,
) {
    match ws_msg.msg_type {
        WsMessageType::Ping => {
            // Respond with pong
            let pong = WsMessage::pong();
            if let Ok(json) = serde_json::to_string(&pong) {
                let _ = ws_tx.send(Message::Text(json.into())).await;
            }
        }
        WsMessageType::Pong => {
            state.write().await.last_ping = Some(chrono_now());
        }
        WsMessageType::Event => {
            // Parse and forward the event
            if let Some(payload) = ws_msg.payload {
                match serde_json::from_value::<SyncEvent>(payload) {
                    Ok(event) => {
                        // Store in history
                        state.write().await.add_event(event.clone());
                        // Forward to application
                        let _ = event_tx.send(event).await;
                    }
                    Err(e) => {
                        warn!("Failed to parse event payload: {}", e);
                    }
                }
            }
        }
        WsMessageType::Batch => {
            // Handle batch of events
            if let Some(payload) = ws_msg.payload {
                if let Some(events) = payload.get("events").and_then(|e| e.as_array()) {
                    for event_value in events {
                        if let Ok(event) = serde_json::from_value::<SyncEvent>(event_value.clone())
                        {
                            state.write().await.add_event(event.clone());
                            let _ = event_tx.send(event).await;
                        }
                    }
                }
            }
        }
        WsMessageType::StateSync => {
            // Handle full state sync
            if let Some(payload) = ws_msg.payload {
                let state_event = SyncEvent::new(SyncEventType::ClientConnected, Some(payload));
                let _ = event_tx.send(state_event).await;
            }
        }
        WsMessageType::Error => {
            // Handle error from server
            let error_event = SyncEvent::new(SyncEventType::SyncError, ws_msg.payload);
            let _ = event_tx.send(error_event).await;
        }
        WsMessageType::Ack | WsMessageType::Subscribe | WsMessageType::Unsubscribe => {
            // These are typically responses, log them
            debug!("Received {:?} message", ws_msg.msg_type);
        }
        WsMessageType::StateRequest => {
            // Server requesting state - not typical
            debug!("Received state request from server");
        }
    }
}

/// Ping loop - sends periodic pings to keep the connection alive
async fn ping_loop(ws_tx: mpsc::Sender<Message>, state: Arc<tokio::sync::RwLock<SyncClientState>>) {
    let mut ping_interval = interval(Duration::from_secs(PING_INTERVAL_SECS));

    loop {
        ping_interval.tick().await;

        // Check if we're still connected
        if state.read().await.status != ConnectionStatus::Connected {
            break;
        }

        // Send application-level ping
        let ping_msg = WsMessage::ping();
        if let Ok(json) = serde_json::to_string(&ping_msg) {
            debug!("Sending ping");
            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }

        // Also send WebSocket-level ping
        if ws_tx.send(Message::Ping(vec![].into())).await.is_err() {
            break;
        }

        // Check for pong timeout
        let last_ping = state.read().await.last_ping.clone();
        if let Some(last_ping_time) = last_ping {
            // Simple timeout check - in production, parse the timestamp
            debug!("Last pong received at: {}", last_ping_time);
        }
    }
    debug!("Ping loop terminated");
}

/// Flush queued messages after connection
async fn flush_message_queue(
    state: &Arc<tokio::sync::RwLock<SyncClientState>>,
    ws_tx: &mpsc::Sender<Message>,
) {
    let queued = {
        let mut state_guard = state.write().await;
        state_guard.message_queue.drain()
    };

    if !queued.is_empty() {
        info!("Flushing {} queued messages", queued.len());
        for msg in queued {
            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    }
}

/// Send initial subscriptions
async fn send_subscriptions(
    state: &Arc<tokio::sync::RwLock<SyncClientState>>,
    ws_tx: &mpsc::Sender<Message>,
) {
    let subscriptions = state.read().await.subscriptions.clone();

    if !subscriptions.is_empty() {
        let sub_msg = WsMessage::subscribe(subscriptions);
        if let Ok(json) = serde_json::to_string(&sub_msg) {
            info!("Sending subscription message");
            let _ = ws_tx.send(Message::Text(json.into())).await;
        }
    }

    // Also request full state sync
    let state_req = WsMessage::state_request();
    if let Ok(json) = serde_json::to_string(&state_req) {
        debug!("Requesting state sync");
        let _ = ws_tx.send(Message::Text(json.into())).await;
    }
}

/// Process commands from the application
/// Returns true if reconnection should be attempted, false to terminate
async fn process_commands(
    state: &Arc<tokio::sync::RwLock<SyncClientState>>,
    command_rx: &mut mpsc::Receiver<SyncCommand>,
    ws_tx: &mpsc::Sender<Message>,
    event_tx: &mpsc::Sender<SyncEvent>,
) -> bool {
    loop {
        tokio::select! {
            Some(cmd) = command_rx.recv() => {
                match cmd {
                    SyncCommand::Connect => {
                        // Already connected, ignore
                        debug!("Received Connect command while already connected");
                    }
                    SyncCommand::Disconnect => {
                        info!("Disconnect command received");
                        // Send close frame
                        let _ = ws_tx.send(Message::Close(None)).await;

                        // Send disconnected event
                        let event = SyncEvent::new(SyncEventType::ClientDisconnected, None);
                        let _ = event_tx.send(event).await;

                        return false; // Don't reconnect
                    }
                    SyncCommand::Send(msg) => {
                        if let Ok(json) = serde_json::to_string(&msg) {
                            debug!("Sending message: {:?}", msg.msg_type);
                            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                                // Connection lost, queue the message
                                state.write().await.queue_message(msg);
                                return true; // Attempt reconnect
                            }
                        }
                    }
                    SyncCommand::Subscribe(event_types) => {
                        let sub_msg = WsMessage::subscribe(event_types.clone());
                        if let Ok(json) = serde_json::to_string(&sub_msg) {
                            if ws_tx.send(Message::Text(json.into())).await.is_ok() {
                                // Update subscriptions in state
                                let mut state_guard = state.write().await;
                                for et in event_types {
                                    if !state_guard.subscriptions.contains(&et) {
                                        state_guard.subscriptions.push(et);
                                    }
                                }
                            }
                        }
                    }
                    SyncCommand::Unsubscribe(event_types) => {
                        let unsub_msg = WsMessage::new(
                            WsMessageType::Unsubscribe,
                            Some(serde_json::json!({
                                "eventTypes": event_types.iter().map(|e| e.as_str()).collect::<Vec<_>>()
                            })),
                        );
                        if let Ok(json) = serde_json::to_string(&unsub_msg) {
                            if ws_tx.send(Message::Text(json.into())).await.is_ok() {
                                // Update subscriptions in state
                                let mut state_guard = state.write().await;
                                state_guard.subscriptions.retain(|e| !event_types.contains(e));
                            }
                        }
                    }
                }
            }
            else => {
                // Command channel closed, terminate
                info!("Command channel closed");
                return false;
            }
        }
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Generate unique message ID
fn generate_message_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("msg-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

/// Generate unique event ID
fn generate_event_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("gui-{:x}-{:x}", now.as_secs(), now.subsec_nanos())
}

/// Get current ISO timestamp
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    // Simple ISO format approximation
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    format!("{}Z", format_timestamp(secs, millis))
}

/// Format timestamp as ISO 8601
fn format_timestamp(secs: u64, millis: u32) -> String {
    // Approximate date calculation
    let days_since_epoch = secs / 86400;
    let remaining_secs = secs % 86400;
    let hours = remaining_secs / 3600;
    let minutes = (remaining_secs % 3600) / 60;
    let seconds = remaining_secs % 60;

    // Very simplified year/month/day calculation
    let years_since_1970 = days_since_epoch / 365;
    let year = 1970 + years_since_1970;
    let day_of_year = days_since_epoch % 365;
    let month = (day_of_year / 30).min(11) + 1;
    let day = (day_of_year % 30) + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}",
        year, month, day, hours, minutes, seconds, millis
    )
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_event_creation() {
        let event = SyncEvent::view_opened("dashboard", "dashboard", Some("AAPL"));
        assert_eq!(event.event_type, SyncEventType::ViewOpened);
        assert_eq!(event.source, "gui");
        assert!(event.data.is_some());
    }

    #[test]
    fn test_message_queue() {
        let mut queue = MessageQueue::new(3);
        queue.enqueue(WsMessage::ping());
        queue.enqueue(WsMessage::ping());
        queue.enqueue(WsMessage::ping());
        queue.enqueue(WsMessage::ping()); // Should evict first

        assert_eq!(queue.len(), 3);

        let drained = queue.drain();
        assert_eq!(drained.len(), 3);
        assert!(queue.is_empty());
    }

    #[test]
    fn test_sync_client_state() {
        let mut state = SyncClientState::default();
        assert_eq!(state.status, ConnectionStatus::Disconnected);

        let event = SyncEvent::new(SyncEventType::PortfolioUpdate, None);
        state.add_event(event);

        assert!(state.last_event.is_some());
        assert_eq!(state.event_history.len(), 1);
    }

    #[test]
    fn test_reconnect_delay() {
        let mut state = SyncClientState::default();

        assert_eq!(state.get_reconnect_delay(), 1000); // Base delay

        state.increment_reconnect();
        assert_eq!(state.get_reconnect_delay(), 2000); // 1000 * 2^1

        state.increment_reconnect();
        assert_eq!(state.get_reconnect_delay(), 4000); // 1000 * 2^2
    }

    #[test]
    fn test_ws_message_creation() {
        let ping = WsMessage::ping();
        assert!(matches!(ping.msg_type, WsMessageType::Ping));

        let sub = WsMessage::subscribe(vec![SyncEventType::PortfolioUpdate]);
        assert!(matches!(sub.msg_type, WsMessageType::Subscribe));
        assert!(sub.payload.is_some());
    }

    #[test]
    fn test_sync_error_display() {
        let err = SyncError::ConnectionError("test error".to_string());
        assert!(err.to_string().contains("test error"));

        let err = SyncError::Timeout;
        assert_eq!(err.to_string(), "Connection timeout");

        let err = SyncError::MaxReconnectAttemptsExceeded;
        assert!(err.to_string().contains("Max reconnection"));
    }

    #[test]
    fn test_connection_status_labels() {
        assert_eq!(ConnectionStatus::Disconnected.label(), "Disconnected");
        assert_eq!(ConnectionStatus::Connecting.label(), "Connecting...");
        assert_eq!(ConnectionStatus::Connected.label(), "Connected");
        assert_eq!(ConnectionStatus::Reconnecting.label(), "Reconnecting...");
        assert_eq!(ConnectionStatus::Error.label(), "Error");
    }

    #[test]
    fn test_connection_status_is_connected() {
        assert!(!ConnectionStatus::Disconnected.is_connected());
        assert!(!ConnectionStatus::Connecting.is_connected());
        assert!(ConnectionStatus::Connected.is_connected());
        assert!(!ConnectionStatus::Reconnecting.is_connected());
        assert!(!ConnectionStatus::Error.is_connected());
    }

    #[test]
    fn test_sync_client_state_custom_url() {
        let state = SyncClientState::new("ws://custom:9999/ws");
        assert_eq!(state.server_url, "ws://custom:9999/ws");
        assert_eq!(state.status, ConnectionStatus::Disconnected);
    }

    #[test]
    fn test_sync_event_symbol_selected() {
        let event = SyncEvent::symbol_selected("AAPL", "watchlist", Some("MSFT"));
        assert_eq!(event.event_type, SyncEventType::SymbolSelected);
        assert!(event.data.is_some());

        let data = event.data.unwrap();
        assert_eq!(data["symbol"], "AAPL");
        assert_eq!(data["viewContext"], "watchlist");
        assert_eq!(data["previousSymbol"], "MSFT");
    }

    #[test]
    fn test_ws_message_event() {
        let sync_event = SyncEvent::new(SyncEventType::PortfolioUpdate, None);
        let msg = WsMessage::event(sync_event);
        assert!(matches!(msg.msg_type, WsMessageType::Event));
        assert!(msg.payload.is_some());
    }

    #[test]
    fn test_ws_message_state_request() {
        let msg = WsMessage::state_request();
        assert!(matches!(msg.msg_type, WsMessageType::StateRequest));
        assert!(msg.payload.is_none());
    }

    #[test]
    fn test_events_by_type_filter() {
        let mut state = SyncClientState::default();

        // Add mixed events
        state.add_event(SyncEvent::new(SyncEventType::PortfolioUpdate, None));
        state.add_event(SyncEvent::new(SyncEventType::NoteSaved, None));
        state.add_event(SyncEvent::new(SyncEventType::PortfolioUpdate, None));

        let portfolio_events = state.get_events_by_type(SyncEventType::PortfolioUpdate);
        assert_eq!(portfolio_events.len(), 2);

        let note_events = state.get_events_by_type(SyncEventType::NoteSaved);
        assert_eq!(note_events.len(), 1);
    }

    #[test]
    fn test_max_reconnect_attempts() {
        let mut state = SyncClientState::default();
        state.max_reconnect_attempts = 3;

        assert!(state.increment_reconnect()); // 1
        assert!(state.increment_reconnect()); // 2
        assert!(state.increment_reconnect()); // 3
        assert!(!state.increment_reconnect()); // 4 - exceeds max

        state.reset_reconnect();
        assert_eq!(state.reconnect_attempts, 0);
    }

    #[tokio::test]
    async fn test_sync_client_creation() {
        let client = SyncClient::new("ws://localhost:8765/ws");
        assert_eq!(client.status().await, ConnectionStatus::Disconnected);
        assert!(!client.is_connected().await);
    }

    #[tokio::test]
    async fn test_sync_client_message_queueing() {
        let client = SyncClient::new("ws://localhost:8765/ws");

        // Send a message while disconnected - should be queued
        client.send(WsMessage::ping()).await;

        // Verify the message was queued
        let state = client.state.read().await;
        assert_eq!(state.message_queue.len(), 1);
    }
}
