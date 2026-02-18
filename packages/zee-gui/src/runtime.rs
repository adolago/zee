//! Runtime configuration for Zee GUI transport and backend integration.

use std::env;

const DEFAULT_ZEE_HTTP_BASE: &str = "http://127.0.0.1:3210";
const DEFAULT_LEGACY_SYNC_WS_URL: &str = "ws://127.0.0.1:8765/ws";
const DEFAULT_GUI_WS_HOST: &str = "127.0.0.1";
const DEFAULT_GUI_WS_PORT: u16 = 18790;

/// Runtime transport mode for synchronization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeMode {
    /// Use current Zee stack endpoints.
    Zee,
    /// Use legacy Stanley WebSocket sync contract.
    LegacyStanleyWs,
    /// Prefer Zee stack, then fall back to legacy Stanley WS.
    Dual,
}

impl RuntimeMode {
    fn parse(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "legacy" | "legacy_stanley_ws" | "stanley" => RuntimeMode::LegacyStanleyWs,
            "dual" => RuntimeMode::Dual,
            _ => RuntimeMode::Zee,
        }
    }
}

/// Concrete runtime configuration resolved from environment variables.
#[derive(Debug, Clone)]
pub struct GuiRuntimeConfig {
    pub mode: RuntimeMode,
    pub zee_http_base: String,
    pub gui_ws_host: String,
    pub gui_ws_port: u16,
    pub legacy_sync_ws_url: String,
}

impl Default for GuiRuntimeConfig {
    fn default() -> Self {
        Self {
            mode: RuntimeMode::Zee,
            zee_http_base: DEFAULT_ZEE_HTTP_BASE.to_string(),
            gui_ws_host: DEFAULT_GUI_WS_HOST.to_string(),
            gui_ws_port: DEFAULT_GUI_WS_PORT,
            legacy_sync_ws_url: DEFAULT_LEGACY_SYNC_WS_URL.to_string(),
        }
    }
}

impl GuiRuntimeConfig {
    pub fn from_env() -> Self {
        let mut config = Self::default();

        if let Ok(value) = env::var("ZEE_GUI_RUNTIME_MODE") {
            config.mode = RuntimeMode::parse(&value);
        }

        if let Ok(value) = env::var("ZEE_SERVER_URL") {
            config.zee_http_base = value;
        }

        if let Ok(value) = env::var("ZEE_GUI_WS_HOST") {
            config.gui_ws_host = value;
        }

        if let Ok(value) = env::var("ZEE_GUI_WS_PORT") {
            if let Ok(port) = value.parse::<u16>() {
                config.gui_ws_port = port;
            }
        }

        if let Ok(value) = env::var("ZEE_GUI_LEGACY_SYNC_WS_URL") {
            config.legacy_sync_ws_url = value;
        }

        config
    }

    #[allow(dead_code)]
    pub fn zee_gui_ws_url(&self) -> String {
        format!("ws://{}:{}", self.gui_ws_host, self.gui_ws_port)
    }
}
