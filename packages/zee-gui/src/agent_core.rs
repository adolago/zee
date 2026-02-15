//! Agent-Core Daemon Client
//!
//! HTTP/SSE client for communicating with the agent-core daemon.
//! Replaces direct Python backend agent calls with unified daemon API.
//!
//! Endpoints:
//!   POST /session - Create session
//!   POST /session/:id/message - Send prompt with persona routing
//!   GET /session/:id/events - SSE stream for real-time updates
//!   GET /session/:id/messages - Get message history

// Allow unused code - these are complete API methods for future use
#![allow(dead_code)]

use log::{debug, info};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_DAEMON_URL: &str = "http://127.0.0.1:3210";
const DAEMON_URL_ENV: &str = "ZEE_SERVER_URL";
const LEGACY_DAEMON_URL_ENV: &str = "AGENT_CORE_URL";
const REQUEST_TIMEOUT_SECS: u64 = 120;

/// Get the daemon URL from environment or default
pub fn daemon_url() -> String {
    env::var(DAEMON_URL_ENV)
        .or_else(|_| env::var(LEGACY_DAEMON_URL_ENV))
        .unwrap_or_else(|_| DEFAULT_DAEMON_URL.to_string())
}

// =============================================================================
// Types - Session
// =============================================================================

/// Session creation request
#[derive(Debug, Clone, Serialize)]
pub struct CreateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Session info returned from daemon
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub time: Option<SessionTime>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTime {
    pub created: u64,
    #[serde(default)]
    pub updated: Option<u64>,
}

// =============================================================================
// Types - Messages
// =============================================================================

/// Persona/agent identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Persona {
    Stanley,
    #[default]
    Zee,
    Johny,
}

impl Persona {
    pub fn as_str(&self) -> &'static str {
        match self {
            Persona::Stanley => "stanley",
            Persona::Zee => "zee",
            Persona::Johny => "johny",
        }
    }
}

impl std::fmt::Display for Persona {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Message part types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessagePart {
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: serde_json::Value,
    },
}

impl MessagePart {
    /// Create a text message part
    pub fn text(text: impl Into<String>) -> Self {
        Self::Text {
            text: text.into(),
            id: None,
        }
    }
}

/// Prompt request to send a message
#[derive(Debug, Clone, Serialize)]
pub struct PromptRequest {
    /// Persona to route the message to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,

    /// Message parts
    pub parts: Vec<MessagePart>,

    /// Optional model override
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<ModelSpec>,

    /// Don't generate a reply (just store the message)
    #[serde(rename = "noReply", skip_serializing_if = "Option::is_none")]
    pub no_reply: Option<bool>,
}

/// Model specification
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub provider_id: String,
    pub model_id: String,
}

/// Message info from daemon
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInfo {
    pub id: String,
    pub role: String,
    pub session_id: String,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub time: Option<MessageTime>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTime {
    pub created: u64,
    #[serde(default)]
    pub completed: Option<u64>,
}

/// Full message with parts
#[derive(Debug, Clone, Deserialize)]
pub struct Message {
    pub info: MessageInfo,
    pub parts: Vec<serde_json::Value>,
}

// =============================================================================
// Types - Streaming
// =============================================================================

/// Event types from SSE stream
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// Text chunk being generated
    Text { text: String },

    /// Tool being called
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },

    /// Tool result received
    ToolResult {
        #[serde(rename = "toolUseId")]
        tool_use_id: String,
        content: serde_json::Value,
    },

    /// Message completed
    Done { message: Message },

    /// Error occurred
    Error { message: String },

    /// Heartbeat
    Ping,
}

// =============================================================================
// Error Types
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum AgentCoreError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),

    #[error("Daemon not available at {0}")]
    DaemonNotAvailable(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Streaming error: {0}")]
    StreamError(String),

    #[error("JSON parse error: {0}")]
    JsonError(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, AgentCoreError>;

// =============================================================================
// Client
// =============================================================================

/// Agent-core daemon client
#[derive(Clone)]
pub struct AgentCoreClient {
    client: Client,
    base_url: String,
    default_persona: Persona,
}

impl Default for AgentCoreClient {
    fn default() -> Self {
        Self::new(None, Persona::Stanley)
    }
}

impl AgentCoreClient {
    /// Create a new client
    pub fn new(base_url: Option<String>, default_persona: Persona) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.unwrap_or_else(daemon_url),
            default_persona,
        }
    }

    /// Check if daemon is available
    pub async fn is_available(&self) -> bool {
        let url = format!("{}/global/health", self.base_url);
        match self.client.get(&url).send().await {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// Create a new session
    pub async fn create_session(&self, title: Option<String>) -> Result<SessionInfo> {
        let url = format!("{}/session", self.base_url);
        debug!("Creating session at {}", url);

        let resp = self
            .client
            .post(&url)
            .json(&CreateSessionRequest { title })
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    AgentCoreError::DaemonNotAvailable(self.base_url.clone())
                } else {
                    AgentCoreError::RequestFailed(e)
                }
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AgentCoreError::InvalidResponse(format!(
                "Failed to create session: {} - {}",
                status, text
            )));
        }

        let session: SessionInfo = resp.json().await?;
        info!("Created session: {}", session.id);
        Ok(session)
    }

    /// List sessions
    pub async fn list_sessions(&self) -> Result<Vec<SessionInfo>> {
        let url = format!("{}/session", self.base_url);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(AgentCoreError::InvalidResponse(format!(
                "Failed to list sessions: {}",
                resp.status()
            )));
        }

        let sessions: Vec<SessionInfo> = resp.json().await?;
        Ok(sessions)
    }

    /// Get session by ID
    pub async fn get_session(&self, session_id: &str) -> Result<SessionInfo> {
        let url = format!("{}/session/{}", self.base_url, session_id);
        let resp = self.client.get(&url).send().await?;

        if resp.status().as_u16() == 404 {
            return Err(AgentCoreError::SessionNotFound(session_id.to_string()));
        }

        if !resp.status().is_success() {
            return Err(AgentCoreError::InvalidResponse(format!(
                "Failed to get session: {}",
                resp.status()
            )));
        }

        let session: SessionInfo = resp.json().await?;
        Ok(session)
    }

    /// Send a prompt and get response (blocking)
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
        persona: Option<Persona>,
    ) -> Result<Message> {
        let url = format!("{}/session/{}/message", self.base_url, session_id);
        let persona = persona.unwrap_or(self.default_persona);

        debug!("Sending prompt to {} via {}", session_id, persona);

        let request = PromptRequest {
            agent: Some(persona.as_str().to_string()),
            parts: vec![MessagePart::text(text)],
            model: None,
            no_reply: None,
        };

        let resp = self.client.post(&url).json(&request).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AgentCoreError::InvalidResponse(format!(
                "Failed to send prompt: {} - {}",
                status, text
            )));
        }

        let message: Message = resp.json().await?;
        Ok(message)
    }

    /// Send a prompt with streaming response
    pub async fn prompt_stream(
        &self,
        session_id: &str,
        text: &str,
        persona: Option<Persona>,
    ) -> Result<mpsc::Receiver<StreamEvent>> {
        let (tx, rx) = mpsc::channel(100);

        let url = format!("{}/session/{}/message", self.base_url, session_id);
        let persona = persona.unwrap_or(self.default_persona);

        let request = PromptRequest {
            agent: Some(persona.as_str().to_string()),
            parts: vec![MessagePart::text(text)],
            model: None,
            no_reply: None,
        };

        let client = self.client.clone();

        tokio::spawn(async move {
            match client.post(&url).json(&request).send().await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        let _ = tx
                            .send(StreamEvent::Error {
                                message: format!("HTTP {}", resp.status()),
                            })
                            .await;
                        return;
                    }

                    // For now, just send the final response as done
                    // TODO: Implement proper SSE streaming when daemon supports it
                    match resp.json::<Message>().await {
                        Ok(msg) => {
                            let _ = tx.send(StreamEvent::Done { message: msg }).await;
                        }
                        Err(e) => {
                            let _ = tx
                                .send(StreamEvent::Error {
                                    message: e.to_string(),
                                })
                                .await;
                        }
                    }
                }
                Err(e) => {
                    let _ = tx
                        .send(StreamEvent::Error {
                            message: e.to_string(),
                        })
                        .await;
                }
            }
        });

        Ok(rx)
    }

    /// Get messages for a session
    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let url = format!("{}/session/{}/messages", self.base_url, session_id);
        let resp = self.client.get(&url).send().await?;

        if !resp.status().is_success() {
            return Err(AgentCoreError::InvalidResponse(format!(
                "Failed to get messages: {}",
                resp.status()
            )));
        }

        let messages: Vec<Message> = resp.json().await?;
        Ok(messages)
    }
}

// =============================================================================
// Shared Client Instance
// =============================================================================

use std::sync::OnceLock;
use tokio::sync::RwLock;

static SHARED_CLIENT: OnceLock<Arc<RwLock<Option<AgentCoreClient>>>> = OnceLock::new();

/// Get or create the shared client instance
pub fn shared_client() -> Arc<RwLock<Option<AgentCoreClient>>> {
    SHARED_CLIENT
        .get_or_init(|| Arc::new(RwLock::new(None)))
        .clone()
}

/// Initialize the shared client
pub async fn init_shared_client(base_url: Option<String>, persona: Persona) {
    let client = AgentCoreClient::new(base_url, persona);
    let shared = shared_client();
    let mut guard = shared.write().await;
    *guard = Some(client);
}

/// Get the shared client, initializing if needed
pub async fn get_client() -> AgentCoreClient {
    let shared = shared_client();

    {
        let guard = shared.read().await;
        if let Some(client) = guard.as_ref() {
            return client.clone();
        }
    }

    // Initialize with defaults
    let client = AgentCoreClient::default();
    let mut guard = shared.write().await;
    *guard = Some(client.clone());
    client
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_persona_serialization() {
        assert_eq!(Persona::Stanley.as_str(), "stanley");
        assert_eq!(Persona::Zee.as_str(), "zee");
        assert_eq!(Persona::Johny.as_str(), "johny");
    }

    #[test]
    fn test_message_part_text() {
        let part = MessagePart::text("Hello, Stanley!");
        match part {
            MessagePart::Text { text, id } => {
                assert_eq!(text, "Hello, Stanley!");
                assert!(id.is_none());
            }
            _ => panic!("Expected Text part"),
        }
    }

    #[test]
    fn test_daemon_url_default() {
        // Clear env var for test
        env::remove_var(DAEMON_URL_ENV);
        assert_eq!(daemon_url(), DEFAULT_DAEMON_URL);
    }

    #[test]
    fn test_client_creation() {
        let client = AgentCoreClient::new(None, Persona::Stanley);
        assert_eq!(client.base_url, DEFAULT_DAEMON_URL);
    }
}
