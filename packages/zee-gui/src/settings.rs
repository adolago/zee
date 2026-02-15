//! Settings module for Stanley GUI
//!
//! Provides settings data structures, API client methods, and settings view rendering.

use crate::api::{ApiError, ApiResponse, ZeeApiClient};
use crate::theme::Theme;
use gpui::prelude::*;
use gpui::*;
use serde::{Deserialize, Serialize};

// =============================================================================
// Settings Data Structures
// =============================================================================

/// API connection configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApiConnectionSettings {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_timeout")]
    pub timeout: u32,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_verify_ssl")]
    pub verify_ssl: bool,
}

fn default_base_url() -> String { "http://localhost:8000".to_string() }
fn default_timeout() -> u32 { 30 }
fn default_max_retries() -> u32 { 3 }
fn default_verify_ssl() -> bool { true }

/// Data refresh interval configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DataRefreshSettings {
    #[serde(default = "default_market_data_seconds")]
    pub market_data_seconds: u32,
    #[serde(default = "default_money_flow_seconds")]
    pub money_flow_seconds: u32,
    #[serde(default = "default_institutional_seconds")]
    pub institutional_seconds: u32,
    #[serde(default = "default_dark_pool_seconds")]
    pub dark_pool_seconds: u32,
    #[serde(default = "default_options_flow_seconds")]
    pub options_flow_seconds: u32,
    #[serde(default = "default_auto_refresh")]
    pub auto_refresh: bool,
}

fn default_market_data_seconds() -> u32 { 60 }
fn default_money_flow_seconds() -> u32 { 300 }
fn default_institutional_seconds() -> u32 { 86400 }
fn default_dark_pool_seconds() -> u32 { 3600 }
fn default_options_flow_seconds() -> u32 { 300 }
fn default_auto_refresh() -> bool { true }

/// Watchlist configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistSettings {
    #[serde(default = "default_watchlist")]
    pub symbols: Vec<String>,
    #[serde(default = "default_max_symbols")]
    pub max_symbols: u32,
}

fn default_watchlist() -> Vec<String> {
    vec![
        "AAPL".to_string(), "MSFT".to_string(), "GOOGL".to_string(),
        "AMZN".to_string(), "NVDA".to_string(), "META".to_string(), "TSLA".to_string(),
    ]
}
fn default_max_symbols() -> u32 { 50 }

impl Default for WatchlistSettings {
    fn default() -> Self {
        Self {
            symbols: default_watchlist(),
            max_symbols: default_max_symbols(),
        }
    }
}

/// Theme settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ThemeSettings {
    #[serde(default = "default_theme_mode")]
    pub mode: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default)]
    pub compact_mode: bool,
    #[serde(default = "default_animations")]
    pub animations_enabled: bool,
    #[serde(default = "default_transparency")]
    pub transparency_enabled: bool,
}

fn default_theme_mode() -> String { "dark".to_string() }
fn default_accent_color() -> String { "#3B82F6".to_string() }
fn default_animations() -> bool { true }
fn default_transparency() -> bool { true }

/// Notification settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotificationSettings {
    #[serde(default = "default_notifications_enabled")]
    pub enabled: bool,
    #[serde(default = "default_notifications_enabled")]
    pub price_alerts: bool,
    #[serde(default = "default_notifications_enabled")]
    pub volume_alerts: bool,
    #[serde(default = "default_notifications_enabled")]
    pub institutional_alerts: bool,
    #[serde(default = "default_notifications_enabled")]
    pub dark_pool_alerts: bool,
    #[serde(default = "default_notifications_enabled")]
    pub options_alerts: bool,
    #[serde(default)]
    pub sound_enabled: bool,
    #[serde(default = "default_notifications_enabled")]
    pub desktop_notifications: bool,
    #[serde(default = "default_alert_threshold")]
    pub alert_threshold_percent: f64,
}

fn default_notifications_enabled() -> bool { true }
fn default_alert_threshold() -> f64 { 5.0 }

/// Display settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DisplaySettings {
    #[serde(default = "default_number_format")]
    pub number_format: String,
    #[serde(default = "default_date_format")]
    pub date_format: String,
    #[serde(default = "default_time_format")]
    pub time_format: String,
    #[serde(default = "default_currency_symbol")]
    pub currency_symbol: String,
    #[serde(default = "default_decimal_places")]
    pub decimal_places: u32,
    #[serde(default = "default_decimal_places")]
    pub percent_decimal_places: u32,
    #[serde(default = "default_thousands_separator")]
    pub thousands_separator: String,
    #[serde(default = "default_decimal_separator")]
    pub decimal_separator: String,
    #[serde(default = "default_negative_color")]
    pub negative_color: String,
    #[serde(default = "default_positive_color")]
    pub positive_color: String,
}

fn default_number_format() -> String { "compact".to_string() }
fn default_date_format() -> String { "YYYY-MM-DD".to_string() }
fn default_time_format() -> String { "24h".to_string() }
fn default_currency_symbol() -> String { "$".to_string() }
fn default_decimal_places() -> u32 { 2 }
fn default_thousands_separator() -> String { ",".to_string() }
fn default_decimal_separator() -> String { ".".to_string() }
fn default_negative_color() -> String { "#EF4444".to_string() }
fn default_positive_color() -> String { "#22C55E".to_string() }

/// Keyboard shortcut
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardShortcut {
    pub action: String,
    pub key: String,
    pub description: String,
    #[serde(default = "default_shortcut_enabled")]
    pub enabled: bool,
}

fn default_shortcut_enabled() -> bool { true }

/// Keyboard settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardSettings {
    #[serde(default = "default_shortcuts")]
    pub shortcuts: Vec<KeyboardShortcut>,
}

fn default_shortcuts() -> Vec<KeyboardShortcut> {
    vec![
        KeyboardShortcut { action: "search".to_string(), key: "Ctrl+K".to_string(), description: "Quick search".to_string(), enabled: true },
        KeyboardShortcut { action: "refresh".to_string(), key: "F5".to_string(), description: "Refresh data".to_string(), enabled: true },
        KeyboardShortcut { action: "dashboard".to_string(), key: "Ctrl+1".to_string(), description: "Go to Dashboard".to_string(), enabled: true },
        KeyboardShortcut { action: "money_flow".to_string(), key: "Ctrl+2".to_string(), description: "Go to Money Flow".to_string(), enabled: true },
        KeyboardShortcut { action: "institutional".to_string(), key: "Ctrl+3".to_string(), description: "Go to Institutional".to_string(), enabled: true },
        KeyboardShortcut { action: "dark_pool".to_string(), key: "Ctrl+4".to_string(), description: "Go to Dark Pool".to_string(), enabled: true },
        KeyboardShortcut { action: "options".to_string(), key: "Ctrl+5".to_string(), description: "Go to Options Flow".to_string(), enabled: true },
        KeyboardShortcut { action: "research".to_string(), key: "Ctrl+6".to_string(), description: "Go to Research".to_string(), enabled: true },
        KeyboardShortcut { action: "settings".to_string(), key: "Ctrl+,".to_string(), description: "Open Settings".to_string(), enabled: true },
        KeyboardShortcut { action: "toggle_sidebar".to_string(), key: "Ctrl+B".to_string(), description: "Toggle Sidebar".to_string(), enabled: true },
        KeyboardShortcut { action: "toggle_theme".to_string(), key: "Ctrl+Shift+T".to_string(), description: "Toggle dark/light theme".to_string(), enabled: true },
    ]
}

impl Default for KeyboardSettings {
    fn default() -> Self {
        Self { shortcuts: default_shortcuts() }
    }
}

/// Data source configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSourceConfig {
    pub name: String,
    #[serde(default = "default_source_enabled")]
    pub enabled: bool,
    #[serde(default = "default_source_priority")]
    pub priority: u32,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub rate_limit: Option<u32>,
}

fn default_source_enabled() -> bool { true }
fn default_source_priority() -> u32 { 1 }

/// Data source settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSourceSettings {
    #[serde(default = "default_sources")]
    pub sources: Vec<DataSourceConfig>,
    #[serde(default = "default_cache_enabled")]
    pub cache_enabled: bool,
    #[serde(default = "default_cache_ttl")]
    pub cache_ttl_seconds: u32,
    #[serde(default = "default_fallback")]
    pub fallback_to_mock: bool,
}

fn default_sources() -> Vec<DataSourceConfig> {
    vec![
        DataSourceConfig { name: "openbb".to_string(), enabled: true, priority: 1, api_key: None, base_url: None, rate_limit: None },
        DataSourceConfig { name: "sec_edgar".to_string(), enabled: true, priority: 2, api_key: None, base_url: None, rate_limit: None },
        DataSourceConfig { name: "dbnomics".to_string(), enabled: true, priority: 3, api_key: None, base_url: None, rate_limit: None },
    ]
}
fn default_cache_enabled() -> bool { true }
fn default_cache_ttl() -> u32 { 300 }
fn default_fallback() -> bool { true }

impl Default for DataSourceSettings {
    fn default() -> Self {
        Self {
            sources: default_sources(),
            cache_enabled: default_cache_enabled(),
            cache_ttl_seconds: default_cache_ttl(),
            fallback_to_mock: default_fallback(),
        }
    }
}

/// Export settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExportSettings {
    #[serde(default = "default_export_format")]
    pub default_format: String,
    #[serde(default = "default_include_headers")]
    pub include_headers: bool,
    #[serde(default = "default_date_range")]
    pub date_range_default: String,
    pub export_directory: Option<String>,
    #[serde(default)]
    pub auto_open: bool,
}

fn default_export_format() -> String { "csv".to_string() }
fn default_include_headers() -> bool { true }
fn default_date_range() -> String { "1M".to_string() }

/// Risk settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RiskSettings {
    #[serde(default = "default_var_confidence")]
    pub var_confidence: f64,
    #[serde(default = "default_var_horizon")]
    pub var_time_horizon: u32,
    #[serde(default = "default_max_position")]
    pub max_position_size: f64,
    #[serde(default = "default_max_sector")]
    pub max_sector_exposure: f64,
}

fn default_var_confidence() -> f64 { 0.95 }
fn default_var_horizon() -> u32 { 1 }
fn default_max_position() -> f64 { 0.10 }
fn default_max_sector() -> f64 { 0.30 }

/// Complete user settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserSettings {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub api_connection: ApiConnectionSettings,
    #[serde(default)]
    pub data_refresh: DataRefreshSettings,
    #[serde(default)]
    pub watchlist: WatchlistSettings,
    #[serde(default)]
    pub theme: ThemeSettings,
    #[serde(default)]
    pub notifications: NotificationSettings,
    #[serde(default)]
    pub display: DisplaySettings,
    #[serde(default)]
    pub keyboard: KeyboardSettings,
    #[serde(default)]
    pub data_sources: DataSourceSettings,
    #[serde(default)]
    pub export: ExportSettings,
    #[serde(default)]
    pub risk: RiskSettings,
    pub last_modified: Option<String>,
}

// =============================================================================
// Settings Tab Enum
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SettingsTab {
    #[default]
    General,
    ApiConnection,
    DataRefresh,
    Theme,
    Notifications,
    Display,
    Keyboard,
    DataSources,
    Export,
    Risk,
}

impl SettingsTab {
    pub fn label(&self) -> &'static str {
        match self {
            Self::General => "General",
            Self::ApiConnection => "API Connection",
            Self::DataRefresh => "Data Refresh",
            Self::Theme => "Theme",
            Self::Notifications => "Notifications",
            Self::Display => "Display",
            Self::Keyboard => "Keyboard",
            Self::DataSources => "Data Sources",
            Self::Export => "Export",
            Self::Risk => "Risk",
        }
    }

    pub fn all() -> Vec<Self> {
        vec![
            Self::General,
            Self::ApiConnection,
            Self::DataRefresh,
            Self::Theme,
            Self::Notifications,
            Self::Display,
            Self::Keyboard,
            Self::DataSources,
            Self::Export,
            Self::Risk,
        ]
    }
}

// =============================================================================
// API Client Extensions
// =============================================================================

impl ZeeApiClient {
    /// Get all user settings
    pub async fn get_settings(&self) -> Result<ApiResponse<UserSettings>, ApiError> {
        let url = format!("{}/api/settings", self.base_url);
        let response = self.client.get(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Update user settings
    pub async fn update_settings(&self, settings: &UserSettings) -> Result<ApiResponse<UserSettings>, ApiError> {
        let url = format!("{}/api/settings", self.base_url);
        let response = self.client.put(&url)
            .json(settings)
            .send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Reset settings to defaults
    pub async fn reset_settings(&self) -> Result<ApiResponse<UserSettings>, ApiError> {
        let url = format!("{}/api/settings/reset", self.base_url);
        let response = self.client.post(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Get theme settings
    pub async fn get_theme_settings(&self) -> Result<ApiResponse<ThemeSettings>, ApiError> {
        let url = format!("{}/api/settings/theme", self.base_url);
        let response = self.client.get(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Update theme settings
    pub async fn update_theme_settings(&self, theme: &ThemeSettings) -> Result<ApiResponse<ThemeSettings>, ApiError> {
        let url = format!("{}/api/settings/theme", self.base_url);
        let response = self.client.put(&url)
            .json(theme)
            .send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Add symbol to watchlist
    pub async fn add_to_watchlist(&self, symbol: &str) -> Result<ApiResponse<WatchlistSettings>, ApiError> {
        let url = format!("{}/api/settings/watchlist/add/{}", self.base_url, symbol);
        let response = self.client.post(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }

    /// Remove symbol from watchlist
    pub async fn remove_from_watchlist(&self, symbol: &str) -> Result<ApiResponse<WatchlistSettings>, ApiError> {
        let url = format!("{}/api/settings/watchlist/remove/{}", self.base_url, symbol);
        let response = self.client.delete(&url).send().await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        response.json().await.map_err(|e| ApiError::Parse(e.to_string()))
    }
}

// =============================================================================
// Settings View Component
// =============================================================================

/// Settings view state
pub struct SettingsView {
    pub active_tab: SettingsTab,
    pub settings: Option<UserSettings>,
    pub loading: bool,
    pub error: Option<String>,
    pub unsaved_changes: bool,
}

impl SettingsView {
    /// Create a new SettingsView, loading settings from disk if available
    pub fn new() -> Self {
        Self::load()
    }

    /// Load settings from the config file, or return defaults if not available
    pub fn load() -> Self {
        let settings = Self::load_settings_from_disk();
        Self {
            active_tab: SettingsTab::General,
            settings: Some(settings),
            loading: false,
            error: None,
            unsaved_changes: false,
        }
    }

    /// Get the config file path (~/.config/stanley/settings.json)
    fn config_path() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|p| p.join("stanley").join("settings.json"))
    }

    /// Load settings from disk, returning defaults if file doesn't exist or is invalid
    fn load_settings_from_disk() -> UserSettings {
        if let Some(path) = Self::config_path() {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(settings) = serde_json::from_str::<UserSettings>(&json) {
                    return settings;
                }
            }
        }
        UserSettings::default()
    }

    /// Save current settings to the config file
    pub fn save(&self) -> Result<(), std::io::Error> {
        let Some(settings) = &self.settings else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "No settings to save",
            ));
        };

        let config_dir = dirs::config_dir()
            .ok_or_else(|| std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Could not determine config directory",
            ))?
            .join("stanley");

        std::fs::create_dir_all(&config_dir)?;

        let path = config_dir.join("settings.json");
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        std::fs::write(path, json)
    }

    /// Update settings and mark as having unsaved changes
    pub fn update_settings(&mut self, settings: UserSettings) {
        self.settings = Some(settings);
        self.unsaved_changes = true;
        self.error = None;
    }

    /// Save settings and clear the unsaved changes flag
    pub fn save_and_clear_unsaved(&mut self) -> Result<(), std::io::Error> {
        self.save()?;
        self.unsaved_changes = false;
        Ok(())
    }

    /// Reset settings to defaults
    pub fn reset_to_defaults(&mut self) {
        self.settings = Some(UserSettings::default());
        self.unsaved_changes = true;
    }

    pub fn set_tab(&mut self, tab: SettingsTab) {
        self.active_tab = tab;
    }

    pub fn set_settings(&mut self, settings: UserSettings) {
        self.settings = Some(settings);
        self.loading = false;
        self.error = None;
    }

    pub fn set_error(&mut self, error: String) {
        self.error = Some(error);
        self.loading = false;
    }
}

// =============================================================================
// Settings View Rendering Helpers
// =============================================================================

/// Render a settings section header
pub fn render_section_header(title: &str, description: &str, theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .mb(px(16.0))
        .child(
            div()
                .text_size(px(16.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child(title.to_string())
        )
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.text_muted)
                .child(description.to_string())
        )
}

/// Render a settings row with label and control
pub fn render_settings_row(label: &str, description: Option<&str>, theme: &Theme, control: impl IntoElement) -> Div {
    div()
        .flex()
        .items_center()
        .justify_between()
        .py(px(12.0))
        .px(px(16.0))
        .rounded(px(8.0))
        .bg(theme.card_bg_elevated)
        .mb(px(8.0))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.text)
                        .child(label.to_string())
                )
                .when_some(description, |el, desc| {
                    el.child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.text_dimmed)
                            .child(desc.to_string())
                    )
                })
        )
        .child(control)
}

/// Render a toggle switch
pub fn render_toggle(enabled: bool, theme: &Theme) -> Div {
    let bg = if enabled { theme.accent } else { theme.border };
    let offset = if enabled { 18.0 } else { 2.0 };

    div()
        .w(px(40.0))
        .h(px(22.0))
        .rounded(px(11.0))
        .bg(bg)
        .cursor_pointer()
        .flex()
        .items_center()
        .child(
            div()
                .size(px(18.0))
                .rounded_full()
                .bg(hsla(0.0, 0.0, 1.0, 1.0))
                .ml(px(offset))
        )
}

/// Render a dropdown/select control
/// Note: options parameter reserved for future dropdown implementation
pub fn render_select(value: &str, _options: &[&str], theme: &Theme) -> Div {
    div()
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .cursor_pointer()
        .text_size(px(12.0))
        .text_color(theme.text_secondary)
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(value.to_string())
        .child(
            div()
                .text_size(px(8.0))
                .text_color(theme.text_dimmed)
                .child("v")
        )
}

/// Render a text input field
pub fn render_text_input(value: &str, placeholder: &str, theme: &Theme) -> Div {
    div()
        .w(px(200.0))
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .text_size(px(12.0))
        .text_color(if value.is_empty() { theme.text_dimmed } else { theme.text })
        .child(if value.is_empty() { placeholder.to_string() } else { value.to_string() })
}

/// Render a number input field
pub fn render_number_input(value: u32, suffix: Option<&str>, theme: &Theme) -> Div {
    let display = match suffix {
        Some(s) => format!("{}{}", value, s),
        None => value.to_string(),
    };

    div()
        .w(px(120.0))
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .text_size(px(12.0))
        .text_color(theme.text)
        .text_align(gpui::TextAlign::Right)
        .child(display)
}

/// Render a color picker swatch
pub fn render_color_swatch(color: &str, theme: &Theme) -> Div {
    // Parse hex color and convert to hsla for background
    let bg_color = parse_hex_to_hsla(color);

    div()
        .size(px(28.0))
        .rounded(px(6.0))
        .bg(bg_color)
        .border_1()
        .border_color(theme.border)
        .cursor_pointer()
}

/// Parse hex color to Hsla (gpui color type)
fn parse_hex_to_hsla(hex: &str) -> Hsla {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return hsla(0.0, 0.0, 0.0, 1.0);
    }

    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0) as f32 / 255.0;
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0) as f32 / 255.0;
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0) as f32 / 255.0;

    // Convert RGB to HSL
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;

    if max == min {
        return hsla(0.0, 0.0, l, 1.0); // achromatic
    }

    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };

    let h = if max == r {
        ((g - b) / d + (if g < b { 6.0 } else { 0.0 })) / 6.0
    } else if max == g {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };

    hsla(h, s, l, 1.0)
}

/// Render settings tab button
pub fn render_tab_button(tab: SettingsTab, active: bool, theme: &Theme) -> Div {
    div()
        .px(px(16.0))
        .py(px(10.0))
        .rounded(px(6.0))
        .cursor_pointer()
        .bg(if active { theme.accent_subtle } else { transparent_black() })
        .text_color(if active { theme.accent } else { theme.text_muted })
        .text_size(px(13.0))
        .font_weight(if active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
        .hover(|s| s.bg(theme.hover_bg))
        .child(tab.label().to_string())
}

/// Render keyboard shortcut row
pub fn render_shortcut_row(shortcut: &KeyboardShortcut, theme: &Theme) -> Div {
    div()
        .flex()
        .items_center()
        .justify_between()
        .py(px(10.0))
        .px(px(12.0))
        .rounded(px(6.0))
        .bg(theme.card_bg_elevated)
        .mb(px(4.0))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text)
                        .child(shortcut.description.clone())
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child(shortcut.action.clone())
                )
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(4.0))
                        .rounded(px(4.0))
                        .bg(theme.card_bg)
                        .border_1()
                        .border_color(theme.border)
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.text_secondary)
                        .child(shortcut.key.clone())
                )
                .child(render_toggle(shortcut.enabled, theme))
        )
}

/// Render data source row
pub fn render_data_source_row(source: &DataSourceConfig, theme: &Theme) -> Div {
    let priority_color = match source.priority {
        1 => theme.positive,
        2 => theme.accent,
        _ => theme.text_muted,
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .py(px(12.0))
        .px(px(12.0))
        .rounded(px(6.0))
        .bg(theme.card_bg_elevated)
        .mb(px(4.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .size(px(8.0))
                        .rounded_full()
                        .bg(if source.enabled { theme.positive } else { theme.text_dimmed })
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme.text)
                                .child(source.name.clone())
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.text_dimmed)
                                .child(format!("Priority: {}", source.priority))
                        )
                )
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .rounded(px(4.0))
                        .bg(priority_color.opacity(0.15))
                        .text_size(px(10.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(priority_color)
                        .child(format!("#{}", source.priority))
                )
                .child(render_toggle(source.enabled, theme))
        )
}

/// Render the settings action bar (save/reset buttons)
pub fn render_action_bar(has_changes: bool, theme: &Theme) -> Div {
    div()
        .flex()
        .items_center()
        .justify_end()
        .gap(px(12.0))
        .pt(px(16.0))
        .mt(px(16.0))
        .border_t_1()
        .border_color(theme.border_subtle)
        .child(
            div()
                .px(px(16.0))
                .py(px(8.0))
                .rounded(px(6.0))
                .bg(theme.card_bg_elevated)
                .border_1()
                .border_color(theme.border)
                .cursor_pointer()
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .hover(|s| s.bg(theme.hover_bg))
                .child("Reset to Defaults")
        )
        .child(
            div()
                .px(px(20.0))
                .py(px(8.0))
                .rounded(px(6.0))
                .bg(if has_changes { theme.accent } else { theme.accent_muted })
                .cursor(if has_changes { CursorStyle::PointingHand } else { CursorStyle::default() })
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                .child("Save Changes")
        )
}

// =============================================================================
// Complete Settings View Rendering
// =============================================================================

/// Render the complete settings view with sidebar navigation and content area
pub fn render_settings_view(
    view: &SettingsView,
    theme: &Theme,
) -> Div {
    let settings = view.settings.clone().unwrap_or_default();

    div()
        .size_full()
        .flex()
        .flex_row()
        // Left sidebar with tab navigation
        .child(render_settings_sidebar(view.active_tab, theme))
        // Right content area
        .child(render_settings_content(view, &settings, theme))
}

/// Render the settings sidebar with tab navigation
pub fn render_settings_sidebar(active_tab: SettingsTab, theme: &Theme) -> Div {
    div()
        .w(px(220.0))
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.sidebar_bg)
        .border_r_1()
        .border_color(theme.border_subtle)
        // Header
        .child(
            div()
                .px(px(20.0))
                .py(px(16.0))
                .border_b_1()
                .border_color(theme.border_subtle)
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("Settings")
                )
        )
        // Tab navigation
        .child(
            div()
                .flex_grow()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .p(px(12.0))
                .children(
                    SettingsTab::all().iter().map(|tab| {
                        let is_active = *tab == active_tab;
                        render_settings_tab_item(*tab, is_active, theme)
                    }).collect::<Vec<_>>()
                )
        )
        // Version info
        .child(
            div()
                .px(px(16.0))
                .py(px(12.0))
                .border_t_1()
                .border_color(theme.border_subtle)
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.text_dimmed)
                        .child("Stanley v1.0.0")
                )
        )
}

/// Render a settings tab navigation item
fn render_settings_tab_item(tab: SettingsTab, is_active: bool, theme: &Theme) -> Stateful<Div> {
    let icon = match tab {
        SettingsTab::General => "G",
        SettingsTab::ApiConnection => "A",
        SettingsTab::DataRefresh => "R",
        SettingsTab::Theme => "T",
        SettingsTab::Notifications => "N",
        SettingsTab::Display => "D",
        SettingsTab::Keyboard => "K",
        SettingsTab::DataSources => "S",
        SettingsTab::Export => "E",
        SettingsTab::Risk => "!",
    };

    div()
        .id(SharedString::from(format!("settings-tab-{:?}", tab)))
        .px(px(12.0))
        .py(px(10.0))
        .rounded(px(6.0))
        .cursor_pointer()
        .bg(if is_active { theme.accent_subtle } else { transparent_black() })
        .hover(|s| s.bg(if is_active { theme.accent_subtle } else { theme.hover_bg }))
        .flex()
        .items_center()
        .gap(px(10.0))
        // Icon
        .child(
            div()
                .size(px(20.0))
                .rounded(px(4.0))
                .bg(if is_active { theme.accent.opacity(0.2) } else { theme.card_bg_elevated })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .text_color(if is_active { theme.accent } else { theme.text_muted })
                .child(icon)
        )
        // Label
        .child(
            div()
                .text_size(px(13.0))
                .font_weight(if is_active { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
                .text_color(if is_active { theme.accent } else { theme.text_secondary })
                .child(tab.label())
        )
}

/// Render the settings content area based on active tab
fn render_settings_content(view: &SettingsView, settings: &UserSettings, theme: &Theme) -> Div {
    div()
        .flex_grow()
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.background)
        // Content header
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
                        .text_size(px(18.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(view.active_tab.label())
                )
                .when_some(view.error.as_ref(), |el, err| {
                    el.child(
                        div()
                            .px(px(12.0))
                            .py(px(6.0))
                            .rounded(px(6.0))
                            .bg(theme.negative_subtle)
                            .text_size(px(11.0))
                            .text_color(theme.negative)
                            .child(err.clone())
                    )
                })
        )
        // Scrollable content
        .child(
            div()
                .id("settings-content-scroll")
                .flex_grow()
                .overflow_y_scroll()
                .p(px(24.0))
                .child(match view.active_tab {
                    SettingsTab::General => render_general_settings(settings, theme),
                    SettingsTab::ApiConnection => render_api_settings(settings, theme),
                    SettingsTab::DataRefresh => render_refresh_settings(settings, theme),
                    SettingsTab::Theme => render_theme_settings(settings, theme),
                    SettingsTab::Notifications => render_notification_settings(settings, theme),
                    SettingsTab::Display => render_display_settings(settings, theme),
                    SettingsTab::Keyboard => render_keyboard_settings(settings, theme),
                    SettingsTab::DataSources => render_data_source_settings(settings, theme),
                    SettingsTab::Export => render_export_settings(settings, theme),
                    SettingsTab::Risk => render_risk_settings(settings, theme),
                })
        )
        // Action bar
        .child(
            div()
                .px(px(24.0))
                .child(render_action_bar(view.unsaved_changes, theme))
        )
}

// =============================================================================
// Individual Settings Section Renderers
// =============================================================================

/// Render General settings section
fn render_general_settings(settings: &UserSettings, theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Watchlist section
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(render_section_header("Watchlist", "Manage your default watchlist symbols", theme))
                .child(
                    div()
                        .p(px(16.0))
                        .rounded(px(8.0))
                        .bg(theme.card_bg)
                        .border_1()
                        .border_color(theme.border)
                        .flex()
                        .flex_col()
                        .gap(px(12.0))
                        // Current symbols
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(px(8.0))
                                .children(
                                    settings.watchlist.symbols.iter().map(|symbol| {
                                        render_symbol_tag(symbol, theme)
                                    }).collect::<Vec<_>>()
                                )
                        )
                        // Add symbol input
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .child(render_text_input("", "Add symbol...", theme))
                                .child(
                                    div()
                                        .px(px(12.0))
                                        .py(px(6.0))
                                        .rounded(px(6.0))
                                        .bg(theme.accent)
                                        .cursor_pointer()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(hsla(0.0, 0.0, 1.0, 1.0))
                                        .child("Add")
                                )
                        )
                )
        )
        // Default settings
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Defaults", "Default values for analysis", theme))
                .child(render_settings_row(
                    "Default Benchmark",
                    Some("Symbol used for benchmark comparison"),
                    theme,
                    render_text_input("SPY", "SPY", theme),
                ))
                .child(render_settings_row(
                    "Default Lookback Period",
                    Some("Days of historical data to analyze"),
                    theme,
                    render_select("63 days", &["21 days", "63 days", "126 days", "252 days"], theme),
                ))
                .child(render_settings_row(
                    "Maximum Watchlist Symbols",
                    Some("Maximum symbols allowed in watchlist"),
                    theme,
                    render_number_input(settings.watchlist.max_symbols, None, theme),
                ))
        )
}

/// Render a symbol tag (for watchlist)
fn render_symbol_tag(symbol: &str, theme: &Theme) -> Div {
    div()
        .px(px(10.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(theme.card_bg_elevated)
        .border_1()
        .border_color(theme.border)
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .text_size(px(12.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.text)
                .child(symbol.to_string())
        )
        .child(
            div()
                .size(px(14.0))
                .rounded(px(2.0))
                .cursor_pointer()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .text_color(theme.text_dimmed)
                .hover(|s| s.bg(theme.negative_subtle).text_color(theme.negative))
                .child("x")
        )
}

/// Render API Connection settings section
fn render_api_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let api = &settings.api_connection;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Connection settings
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("API Connection", "Configure backend API connection", theme))
                .child(render_settings_row(
                    "API Base URL",
                    Some("Stanley backend server URL"),
                    theme,
                    render_text_input(&api.base_url, "http://localhost:8000", theme),
                ))
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.text_muted)
                        .child(
                            "Remote URLs are blocked by default. Set STANLEY_ALLOW_REMOTE=1 and use https to allow.",
                        ),
                )
                .child(render_settings_row(
                    "Request Timeout",
                    Some("Maximum time to wait for API response"),
                    theme,
                    render_number_input(api.timeout, Some("s"), theme),
                ))
                .child(render_settings_row(
                    "Max Retries",
                    Some("Number of retry attempts on failure"),
                    theme,
                    render_number_input(api.max_retries, None, theme),
                ))
                .child(render_settings_row(
                    "Verify SSL",
                    Some("Validate SSL certificates"),
                    theme,
                    render_toggle(api.verify_ssl, theme),
                ))
        )
        // Connection test
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(render_section_header("Connection Status", "Test API connectivity", theme))
                .child(
                    div()
                        .p(px(16.0))
                        .rounded(px(8.0))
                        .bg(theme.card_bg)
                        .border_1()
                        .border_color(theme.border)
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
                                        .size(px(10.0))
                                        .rounded_full()
                                        .bg(theme.positive)
                                )
                                .child(
                                    div()
                                        .text_size(px(13.0))
                                        .text_color(theme.text)
                                        .child("Connected to API")
                                )
                        )
                        .child(
                            div()
                                .px(px(12.0))
                                .py(px(6.0))
                                .rounded(px(6.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border)
                                .cursor_pointer()
                                .text_size(px(12.0))
                                .text_color(theme.text_secondary)
                                .hover(|s| s.bg(theme.hover_bg))
                                .child("Test Connection")
                        )
                )
        )
}

/// Render Data Refresh settings section
fn render_refresh_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let refresh = &settings.data_refresh;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Auto-refresh toggle
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Auto Refresh", "Automatically refresh data at intervals", theme))
                .child(render_settings_row(
                    "Enable Auto Refresh",
                    Some("Automatically fetch new data periodically"),
                    theme,
                    render_toggle(refresh.auto_refresh, theme),
                ))
        )
        // Interval settings
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Refresh Intervals", "Configure refresh frequency for each data type", theme))
                .child(render_settings_row(
                    "Market Data",
                    Some("Price and volume data"),
                    theme,
                    render_number_input(refresh.market_data_seconds, Some("s"), theme),
                ))
                .child(render_settings_row(
                    "Money Flow Analysis",
                    Some("Flow and sentiment data"),
                    theme,
                    render_number_input(refresh.money_flow_seconds, Some("s"), theme),
                ))
                .child(render_settings_row(
                    "Institutional Holdings",
                    Some("13F filing data (daily updates)"),
                    theme,
                    render_number_input(refresh.institutional_seconds, Some("s"), theme),
                ))
                .child(render_settings_row(
                    "Dark Pool Activity",
                    Some("Dark pool volume data"),
                    theme,
                    render_number_input(refresh.dark_pool_seconds, Some("s"), theme),
                ))
                .child(render_settings_row(
                    "Options Flow",
                    Some("Options trading data"),
                    theme,
                    render_number_input(refresh.options_flow_seconds, Some("s"), theme),
                ))
        )
}

/// Render Theme settings section
fn render_theme_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let theme_settings = &settings.theme;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Theme mode
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Appearance", "Customize the look and feel", theme))
                .child(render_settings_row(
                    "Theme Mode",
                    Some("Choose between dark and light themes"),
                    theme,
                    render_theme_selector(&theme_settings.mode, theme),
                ))
                .child(render_settings_row(
                    "Accent Color",
                    Some("Primary accent color for the interface"),
                    theme,
                    render_color_swatch(&theme_settings.accent_color, theme),
                ))
        )
        // Layout options
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Layout", "Interface layout preferences", theme))
                .child(render_settings_row(
                    "Compact Mode",
                    Some("Reduce spacing for more content density"),
                    theme,
                    render_toggle(theme_settings.compact_mode, theme),
                ))
                .child(render_settings_row(
                    "Collapse Sidebar",
                    Some("Start with sidebar collapsed"),
                    theme,
                    render_toggle(theme_settings.sidebar_collapsed, theme),
                ))
                .child(render_settings_row(
                    "Animations",
                    Some("Enable UI animations and transitions"),
                    theme,
                    render_toggle(theme_settings.animations_enabled, theme),
                ))
                .child(render_settings_row(
                    "Transparency Effects",
                    Some("Enable blur and transparency effects"),
                    theme,
                    render_toggle(theme_settings.transparency_enabled, theme),
                ))
        )
}

/// Render theme mode selector (Dark/Light/System)
fn render_theme_selector(current_mode: &str, theme: &Theme) -> Div {
    div()
        .flex()
        .gap(px(4.0))
        .children(
            ["dark", "light", "system"].iter().map(|mode| {
                let is_selected = current_mode == *mode;
                let label = match *mode {
                    "dark" => "Dark",
                    "light" => "Light",
                    "system" => "System",
                    _ => mode,
                };

                div()
                    .px(px(12.0))
                    .py(px(6.0))
                    .rounded(px(6.0))
                    .cursor_pointer()
                    .bg(if is_selected { theme.accent } else { theme.card_bg })
                    .border_1()
                    .border_color(if is_selected { theme.accent } else { theme.border })
                    .text_size(px(12.0))
                    .font_weight(if is_selected { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
                    .text_color(if is_selected { hsla(0.0, 0.0, 1.0, 1.0) } else { theme.text_secondary })
                    .hover(|s| if is_selected { s } else { s.bg(theme.hover_bg) })
                    .child(label.to_string())
            }).collect::<Vec<_>>()
        )
}

/// Render Notification settings section
fn render_notification_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let notif = &settings.notifications;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // General notifications
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Notifications", "Configure alert preferences", theme))
                .child(render_settings_row(
                    "Enable Notifications",
                    Some("Master toggle for all notifications"),
                    theme,
                    render_toggle(notif.enabled, theme),
                ))
                .child(render_settings_row(
                    "Desktop Notifications",
                    Some("Show system notifications"),
                    theme,
                    render_toggle(notif.desktop_notifications, theme),
                ))
                .child(render_settings_row(
                    "Sound Alerts",
                    Some("Play sound for important alerts"),
                    theme,
                    render_toggle(notif.sound_enabled, theme),
                ))
        )
        // Alert types
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Alert Types", "Choose which alerts to receive", theme))
                .child(render_settings_row(
                    "Price Alerts",
                    Some("Notify on significant price movements"),
                    theme,
                    render_toggle(notif.price_alerts, theme),
                ))
                .child(render_settings_row(
                    "Volume Alerts",
                    Some("Notify on unusual volume"),
                    theme,
                    render_toggle(notif.volume_alerts, theme),
                ))
                .child(render_settings_row(
                    "Institutional Activity",
                    Some("Notify on 13F filing changes"),
                    theme,
                    render_toggle(notif.institutional_alerts, theme),
                ))
                .child(render_settings_row(
                    "Dark Pool Activity",
                    Some("Notify on significant dark pool trades"),
                    theme,
                    render_toggle(notif.dark_pool_alerts, theme),
                ))
                .child(render_settings_row(
                    "Options Flow",
                    Some("Notify on unusual options activity"),
                    theme,
                    render_toggle(notif.options_alerts, theme),
                ))
        )
        // Threshold settings
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Thresholds", "Alert sensitivity settings", theme))
                .child(render_settings_row(
                    "Price Change Threshold",
                    Some("Minimum % change to trigger alert"),
                    theme,
                    render_percentage_input(notif.alert_threshold_percent, theme),
                ))
        )
}

/// Render percentage input
fn render_percentage_input(value: f64, theme: &Theme) -> Div {
    div()
        .w(px(100.0))
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(6.0))
        .bg(theme.card_bg)
        .border_1()
        .border_color(theme.border)
        .text_size(px(12.0))
        .text_color(theme.text)
        .text_align(gpui::TextAlign::Right)
        .child(format!("{:.1}%", value))
}

/// Render Display settings section
fn render_display_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let display = &settings.display;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Number formatting
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Number Formatting", "How numbers are displayed", theme))
                .child(render_settings_row(
                    "Number Format",
                    Some("Compact (1.2M) or full (1,200,000)"),
                    theme,
                    render_select(&display.number_format, &["compact", "full"], theme),
                ))
                .child(render_settings_row(
                    "Decimal Places",
                    Some("Precision for numeric values"),
                    theme,
                    render_number_input(display.decimal_places, None, theme),
                ))
                .child(render_settings_row(
                    "Percent Decimal Places",
                    Some("Precision for percentage values"),
                    theme,
                    render_number_input(display.percent_decimal_places, None, theme),
                ))
                .child(render_settings_row(
                    "Currency Symbol",
                    Some("Currency symbol to display"),
                    theme,
                    render_text_input(&display.currency_symbol, "$", theme),
                ))
                .child(render_settings_row(
                    "Thousands Separator",
                    None,
                    theme,
                    render_text_input(&display.thousands_separator, ",", theme),
                ))
                .child(render_settings_row(
                    "Decimal Separator",
                    None,
                    theme,
                    render_text_input(&display.decimal_separator, ".", theme),
                ))
        )
        // Date/Time formatting
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Date & Time", "Date and time display format", theme))
                .child(render_settings_row(
                    "Date Format",
                    None,
                    theme,
                    render_select(&display.date_format, &["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"], theme),
                ))
                .child(render_settings_row(
                    "Time Format",
                    None,
                    theme,
                    render_select(&display.time_format, &["24h", "12h"], theme),
                ))
        )
        // Color preferences
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Value Colors", "Colors for positive/negative values", theme))
                .child(render_settings_row(
                    "Positive Color",
                    Some("Color for gains and positive values"),
                    theme,
                    render_color_swatch(&display.positive_color, theme),
                ))
                .child(render_settings_row(
                    "Negative Color",
                    Some("Color for losses and negative values"),
                    theme,
                    render_color_swatch(&display.negative_color, theme),
                ))
        )
}

/// Render Keyboard settings section
fn render_keyboard_settings(settings: &UserSettings, theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Keyboard shortcuts
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(render_section_header("Keyboard Shortcuts", "Customize keyboard bindings", theme))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .children(
                            settings.keyboard.shortcuts.iter().map(|shortcut| {
                                render_shortcut_row(shortcut, theme)
                            }).collect::<Vec<_>>()
                        )
                )
        )
        // Reset shortcuts
        .child(
            div()
                .flex()
                .justify_end()
                .child(
                    div()
                        .px(px(12.0))
                        .py(px(6.0))
                        .rounded(px(6.0))
                        .bg(theme.card_bg_elevated)
                        .border_1()
                        .border_color(theme.border)
                        .cursor_pointer()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .hover(|s| s.bg(theme.hover_bg))
                        .child("Reset to Defaults")
                )
        )
}

/// Render Data Sources settings section
fn render_data_source_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let sources = &settings.data_sources;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Data sources list
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .child(render_section_header("Data Sources", "Configure data provider priority and settings", theme))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .children(
                            sources.sources.iter().map(|source| {
                                render_data_source_row(source, theme)
                            }).collect::<Vec<_>>()
                        )
                )
        )
        // Cache settings
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Caching", "Data caching preferences", theme))
                .child(render_settings_row(
                    "Enable Cache",
                    Some("Cache API responses for faster loading"),
                    theme,
                    render_toggle(sources.cache_enabled, theme),
                ))
                .child(render_settings_row(
                    "Cache TTL",
                    Some("Time before cached data expires"),
                    theme,
                    render_number_input(sources.cache_ttl_seconds, Some("s"), theme),
                ))
                .child(render_settings_row(
                    "Fallback to Mock Data",
                    Some("Use mock data when API unavailable"),
                    theme,
                    render_toggle(sources.fallback_to_mock, theme),
                ))
        )
}

/// Render Export settings section
fn render_export_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let export = &settings.export;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // Export format
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Export Settings", "Default export preferences", theme))
                .child(render_settings_row(
                    "Default Format",
                    Some("Default file format for exports"),
                    theme,
                    render_select(&export.default_format, &["csv", "json", "xlsx", "pdf"], theme),
                ))
                .child(render_settings_row(
                    "Include Headers",
                    Some("Include column headers in exports"),
                    theme,
                    render_toggle(export.include_headers, theme),
                ))
                .child(render_settings_row(
                    "Default Date Range",
                    Some("Default time period for data exports"),
                    theme,
                    render_select(&export.date_range_default, &["1W", "1M", "3M", "1Y", "All"], theme),
                ))
                .child(render_settings_row(
                    "Auto-Open Files",
                    Some("Automatically open exported files"),
                    theme,
                    render_toggle(export.auto_open, theme),
                ))
        )
        // Export directory
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Export Location", "Where to save exported files", theme))
                .child(
                    div()
                        .p(px(16.0))
                        .rounded(px(8.0))
                        .bg(theme.card_bg)
                        .border_1()
                        .border_color(theme.border)
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_secondary)
                                .child(export.export_directory.clone().unwrap_or_else(|| "~/Downloads".to_string()))
                        )
                        .child(
                            div()
                                .px(px(12.0))
                                .py(px(6.0))
                                .rounded(px(6.0))
                                .bg(theme.card_bg_elevated)
                                .border_1()
                                .border_color(theme.border)
                                .cursor_pointer()
                                .text_size(px(12.0))
                                .text_color(theme.text_secondary)
                                .hover(|s| s.bg(theme.hover_bg))
                                .child("Browse...")
                        )
                )
        )
}

/// Render Risk settings section
fn render_risk_settings(settings: &UserSettings, theme: &Theme) -> Div {
    let risk = &settings.risk;

    div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        // VaR settings
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Value at Risk (VaR)", "VaR calculation parameters", theme))
                .child(render_settings_row(
                    "Confidence Level",
                    Some("Statistical confidence for VaR"),
                    theme,
                    render_percentage_input(risk.var_confidence * 100.0, theme),
                ))
                .child(render_settings_row(
                    "Time Horizon",
                    Some("VaR calculation period in days"),
                    theme,
                    render_number_input(risk.var_time_horizon, Some(" day"), theme),
                ))
        )
        // Position limits
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(render_section_header("Position Limits", "Maximum exposure settings", theme))
                .child(render_settings_row(
                    "Max Position Size",
                    Some("Maximum single position as % of portfolio"),
                    theme,
                    render_percentage_input(risk.max_position_size * 100.0, theme),
                ))
                .child(render_settings_row(
                    "Max Sector Exposure",
                    Some("Maximum sector concentration as % of portfolio"),
                    theme,
                    render_percentage_input(risk.max_sector_exposure * 100.0, theme),
                ))
        )
        // Risk warnings
        .child(
            div()
                .p(px(16.0))
                .rounded(px(8.0))
                .bg(theme.warning_subtle)
                .flex()
                .items_start()
                .gap(px(12.0))
                .child(
                    div()
                        .text_size(px(16.0))
                        .text_color(theme.warning)
                        .child("!")
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.warning)
                                .child("Risk Disclaimer")
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.text_secondary)
                                .child("These settings are for display purposes only. Always consult with a financial advisor before making investment decisions.")
                        )
                )
        )
}
