"""
Stanley Settings API

REST API endpoints for application settings and configuration management.
Provides persistence for user preferences, display settings, and connection configuration.
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .utils import sanitize_error

logger = logging.getLogger(__name__)

# =============================================================================
# Settings Directory
# =============================================================================

SETTINGS_DIR = Path.home() / ".stanley"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
CONFIG_FILE = Path(__file__).parent.parent.parent / "config" / "stanley.yaml"

MASKED_VALUE = "********"

# =============================================================================
# Pydantic Models - Settings Types
# =============================================================================


class ApiConnectionSettings(BaseModel):
    """API connection configuration."""

    base_url: str = Field(
        default=os.environ.get("STANLEY_API_URL", "http://localhost:8000"),
        description="API base URL",
    )
    timeout: int = Field(
        default=30, ge=5, le=300, description="Request timeout in seconds"
    )
    max_retries: int = Field(
        default=3, ge=0, le=10, description="Maximum retry attempts"
    )
    verify_ssl: bool = Field(default=True, description="Verify SSL certificates")


class DataRefreshSettings(BaseModel):
    """Data refresh interval configuration."""

    market_data_seconds: int = Field(
        default=60, ge=10, le=3600, description="Market data refresh interval"
    )
    money_flow_seconds: int = Field(
        default=300, ge=60, le=3600, description="Money flow refresh interval"
    )
    institutional_seconds: int = Field(
        default=86400, ge=3600, le=604800, description="Institutional data refresh"
    )
    dark_pool_seconds: int = Field(
        default=3600, ge=300, le=86400, description="Dark pool refresh interval"
    )
    options_flow_seconds: int = Field(
        default=300, ge=60, le=3600, description="Options flow refresh interval"
    )
    auto_refresh: bool = Field(
        default=True, description="Enable automatic data refresh"
    )


class WatchlistSettings(BaseModel):
    """Default watchlist configuration."""

    symbols: List[str] = Field(
        default=["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],
        description="Default watchlist symbols",
    )
    max_symbols: int = Field(
        default=50, ge=5, le=200, description="Maximum watchlist size"
    )


class ThemeSettings(BaseModel):
    """Theme and appearance settings."""

    mode: str = Field(
        default="dark", pattern="^(dark|light|system)$", description="Theme mode"
    )
    accent_color: str = Field(
        default="#3B82F6", pattern="^#[0-9A-Fa-f]{6}$", description="Accent color hex"
    )
    sidebar_collapsed: bool = Field(
        default=False, description="Sidebar collapsed state"
    )
    compact_mode: bool = Field(default=False, description="Use compact UI layout")
    animations_enabled: bool = Field(default=True, description="Enable UI animations")
    transparency_enabled: bool = Field(
        default=True, description="Enable transparency effects"
    )


class NotificationSettings(BaseModel):
    """Notification preferences."""

    enabled: bool = Field(default=True, description="Enable notifications")
    price_alerts: bool = Field(
        default=True, description="Enable price alert notifications"
    )
    volume_alerts: bool = Field(
        default=True, description="Enable unusual volume alerts"
    )
    institutional_alerts: bool = Field(
        default=True, description="Enable institutional activity alerts"
    )
    dark_pool_alerts: bool = Field(default=True, description="Enable dark pool alerts")
    options_alerts: bool = Field(
        default=True, description="Enable unusual options activity alerts"
    )
    sound_enabled: bool = Field(default=False, description="Enable notification sounds")
    desktop_notifications: bool = Field(
        default=True, description="Show desktop notifications"
    )
    alert_threshold_percent: float = Field(
        default=5.0, ge=0.1, le=100.0, description="Minimum % change for alerts"
    )


class DisplaySettings(BaseModel):
    """Display and formatting preferences."""

    number_format: str = Field(
        default="compact",
        pattern="^(compact|full|scientific)$",
        description="Number display format",
    )
    date_format: str = Field(
        default="YYYY-MM-DD",
        pattern="^(YYYY-MM-DD|MM/DD/YYYY|DD/MM/YYYY|relative)$",
        description="Date display format",
    )
    time_format: str = Field(
        default="24h", pattern="^(12h|24h)$", description="Time display format"
    )
    currency_symbol: str = Field(
        default="$", max_length=5, description="Currency symbol"
    )
    decimal_places: int = Field(
        default=2, ge=0, le=6, description="Decimal places for prices"
    )
    percent_decimal_places: int = Field(
        default=2, ge=0, le=4, description="Decimal places for percentages"
    )
    thousands_separator: str = Field(
        default=",", max_length=1, description="Thousands separator"
    )
    decimal_separator: str = Field(
        default=".", max_length=1, description="Decimal separator"
    )
    negative_color: str = Field(
        default="#EF4444",
        pattern="^#[0-9A-Fa-f]{6}$",
        description="Negative value color",
    )
    positive_color: str = Field(
        default="#22C55E",
        pattern="^#[0-9A-Fa-f]{6}$",
        description="Positive value color",
    )


class KeyboardShortcut(BaseModel):
    """Individual keyboard shortcut."""

    action: str = Field(..., description="Action identifier")
    key: str = Field(..., description="Key combination (e.g., 'Ctrl+S')")
    description: str = Field(..., description="Human-readable description")
    enabled: bool = Field(default=True, description="Shortcut enabled")


class KeyboardSettings(BaseModel):
    """Keyboard shortcut configuration."""

    shortcuts: List[KeyboardShortcut] = Field(
        default=[
            KeyboardShortcut(
                action="search", key="Ctrl+K", description="Quick search", enabled=True
            ),
            KeyboardShortcut(
                action="refresh", key="F5", description="Refresh data", enabled=True
            ),
            KeyboardShortcut(
                action="dashboard",
                key="Ctrl+1",
                description="Go to Dashboard",
                enabled=True,
            ),
            KeyboardShortcut(
                action="money_flow",
                key="Ctrl+2",
                description="Go to Money Flow",
                enabled=True,
            ),
            KeyboardShortcut(
                action="institutional",
                key="Ctrl+3",
                description="Go to Institutional",
                enabled=True,
            ),
            KeyboardShortcut(
                action="dark_pool",
                key="Ctrl+4",
                description="Go to Dark Pool",
                enabled=True,
            ),
            KeyboardShortcut(
                action="options",
                key="Ctrl+5",
                description="Go to Options Flow",
                enabled=True,
            ),
            KeyboardShortcut(
                action="research",
                key="Ctrl+6",
                description="Go to Research",
                enabled=True,
            ),
            KeyboardShortcut(
                action="settings",
                key="Ctrl+,",
                description="Open Settings",
                enabled=True,
            ),
            KeyboardShortcut(
                action="toggle_sidebar",
                key="Ctrl+B",
                description="Toggle Sidebar",
                enabled=True,
            ),
            KeyboardShortcut(
                action="next_symbol",
                key="Alt+Down",
                description="Next symbol in watchlist",
                enabled=True,
            ),
            KeyboardShortcut(
                action="prev_symbol",
                key="Alt+Up",
                description="Previous symbol in watchlist",
                enabled=True,
            ),
            KeyboardShortcut(
                action="toggle_theme",
                key="Ctrl+Shift+T",
                description="Toggle dark/light theme",
                enabled=True,
            ),
        ],
        description="Keyboard shortcuts",
    )


class DataSourceConfig(BaseModel):
    """Individual data source configuration."""

    name: str = Field(..., description="Data source name")
    enabled: bool = Field(default=True, description="Source enabled")
    priority: int = Field(default=1, ge=1, le=10, description="Priority (1=highest)")
    api_key: Optional[str] = Field(default=None, description="API key (if required)")
    base_url: Optional[str] = Field(default=None, description="Custom base URL")
    rate_limit: Optional[int] = Field(
        default=None, ge=1, le=100, description="Requests per second"
    )


class DataSourceSettings(BaseModel):
    """Data source configuration."""

    sources: List[DataSourceConfig] = Field(
        default=[
            DataSourceConfig(name="openbb", enabled=True, priority=1),
            DataSourceConfig(name="sec_edgar", enabled=True, priority=2),
            DataSourceConfig(name="dbnomics", enabled=True, priority=3),
        ],
        description="Data source configurations",
    )
    cache_enabled: bool = Field(default=True, description="Enable data caching")
    cache_ttl_seconds: int = Field(
        default=300, ge=60, le=86400, description="Cache TTL in seconds"
    )
    fallback_to_mock: bool = Field(
        default=True, description="Use mock data if sources fail"
    )


class ExportSettings(BaseModel):
    """Export configuration."""

    default_format: str = Field(
        default="csv",
        pattern="^(csv|json|xlsx|pdf)$",
        description="Default export format",
    )
    include_headers: bool = Field(
        default=True, description="Include headers in exports"
    )
    date_range_default: str = Field(
        default="1M",
        pattern="^(1D|1W|1M|3M|6M|1Y|YTD|ALL)$",
        description="Default date range for exports",
    )
    export_directory: Optional[str] = Field(
        default=None, description="Default export directory (None = user's Downloads)"
    )
    auto_open: bool = Field(default=False, description="Auto-open exported files")


class RiskSettings(BaseModel):
    """Risk management settings."""

    var_confidence: float = Field(
        default=0.95, ge=0.90, le=0.99, description="VaR confidence level"
    )
    var_time_horizon: int = Field(
        default=1, ge=1, le=30, description="VaR time horizon (days)"
    )
    max_position_size: float = Field(
        default=0.10, ge=0.01, le=1.0, description="Max single position size"
    )
    max_sector_exposure: float = Field(
        default=0.30, ge=0.05, le=1.0, description="Max sector exposure"
    )


class UserSettings(BaseModel):
    """Complete user settings."""

    version: str = Field(default="1.0.0", description="Settings schema version")
    api_connection: ApiConnectionSettings = Field(default_factory=ApiConnectionSettings)
    data_refresh: DataRefreshSettings = Field(default_factory=DataRefreshSettings)
    watchlist: WatchlistSettings = Field(default_factory=WatchlistSettings)
    theme: ThemeSettings = Field(default_factory=ThemeSettings)
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    display: DisplaySettings = Field(default_factory=DisplaySettings)
    keyboard: KeyboardSettings = Field(default_factory=KeyboardSettings)
    data_sources: DataSourceSettings = Field(default_factory=DataSourceSettings)
    export: ExportSettings = Field(default_factory=ExportSettings)
    risk: RiskSettings = Field(default_factory=RiskSettings)
    last_modified: Optional[str] = Field(
        default=None, description="Last modification timestamp"
    )


class SettingsUpdateRequest(BaseModel):
    """Partial settings update request."""

    api_connection: Optional[ApiConnectionSettings] = None
    data_refresh: Optional[DataRefreshSettings] = None
    watchlist: Optional[WatchlistSettings] = None
    theme: Optional[ThemeSettings] = None
    notifications: Optional[NotificationSettings] = None
    display: Optional[DisplaySettings] = None
    keyboard: Optional[KeyboardSettings] = None
    data_sources: Optional[DataSourceSettings] = None
    export: Optional[ExportSettings] = None
    risk: Optional[RiskSettings] = None


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Settings Manager
# =============================================================================


class SettingsManager:
    """Manages user settings persistence and retrieval."""

    def __init__(self):
        self._ensure_settings_dir()
        self._settings: Optional[UserSettings] = None

    def _ensure_settings_dir(self):
        """Ensure settings directory exists."""
        SETTINGS_DIR.mkdir(parents=True, exist_ok=True)

    def load(self) -> UserSettings:
        """Load settings from file or create defaults."""
        if self._settings is not None:
            return self._settings

        if SETTINGS_FILE.exists():
            try:
                with open(SETTINGS_FILE, "r") as f:
                    data = json.load(f)
                    self._settings = UserSettings(**data)
                    logger.info("Loaded user settings from %s", SETTINGS_FILE)
            except Exception as e:
                logger.warning("Failed to load settings: %s. Using defaults.", e)
                self._settings = UserSettings()
        else:
            self._settings = UserSettings()
            self.save(self._settings)
            logger.info("Created default settings at %s", SETTINGS_FILE)

        return self._settings

    def save(self, settings: UserSettings) -> None:
        """Save settings to file."""
        settings.last_modified = datetime.utcnow().isoformat() + "Z"
        self._settings = settings

        try:
            with open(SETTINGS_FILE, "w") as f:
                json.dump(settings.model_dump(), f, indent=2)
            logger.info("Saved user settings to %s", SETTINGS_FILE)
        except Exception as e:
            logger.error("Failed to save settings: %s", e)
            raise HTTPException(status_code=500, detail=sanitize_error(e))

    def update(self, updates: SettingsUpdateRequest) -> UserSettings:
        """Update settings with partial data."""
        current = self.load()
        update_dict = updates.model_dump(exclude_none=True)

        for key, value in update_dict.items():
            if hasattr(current, key):
                setattr(current, key, value)

        self.save(current)
        return current

    def reset(self) -> UserSettings:
        """Reset settings to defaults."""
        self._settings = UserSettings()
        self.save(self._settings)
        return self._settings

    def export_settings(self) -> Dict[str, Any]:
        """Export settings as a dictionary."""
        return self.load().model_dump()

    def import_settings(self, data: Dict[str, Any]) -> UserSettings:
        """Import settings from a dictionary."""
        settings = UserSettings(**data)
        self.save(settings)
        return settings

    def get_server_config(self) -> Dict[str, Any]:
        """Get server configuration from stanley.yaml."""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r") as f:
                    return yaml.safe_load(f)
            except Exception as e:
                logger.warning("Failed to load server config: %s", e)
        return {}


# Global settings manager instance
settings_manager = SettingsManager()


def _mask_data_sources(data: Dict[str, Any]) -> None:
    """Mask sensitive API keys in settings dictionary."""
    # Handle full settings object
    if "data_sources" in data and "sources" in data["data_sources"]:
        for source in data["data_sources"]["sources"]:
            if source.get("api_key"):
                source["api_key"] = MASKED_VALUE

    # Handle just data_sources object (if called from get_data_source_settings)
    if "sources" in data:
        for source in data["sources"]:
            if source.get("api_key"):
                source["api_key"] = MASKED_VALUE


def _restore_api_keys(
    new_sources: List[DataSourceConfig], old_sources: List[DataSourceConfig]
) -> None:
    """Restore masked API keys from existing configuration."""
    for source in new_sources:
        if source.api_key == MASKED_VALUE:
            # Find matching source in old config
            for old_source in old_sources:
                if old_source.name == source.name:
                    source.api_key = old_source.api_key
                    break


# =============================================================================
# API Router
# =============================================================================

router = APIRouter(prefix="/api/settings", tags=["Settings"])


def _response(data: Any = None, error: Optional[str] = None) -> ApiResponse:
    """Create standardized API response."""
    return ApiResponse(
        success=error is None,
        data=data,
        error=error,
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


@router.get("", response_model=ApiResponse)
async def get_settings():
    """Get all user settings."""
    try:
        settings = settings_manager.load()
        data = settings.model_dump()
        _mask_data_sources(data)
        return _response(data)
    except Exception as e:
        logger.error("Failed to get settings: %s", e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.put("", response_model=ApiResponse)
async def update_settings(updates: SettingsUpdateRequest):
    """Update user settings (partial update)."""
    try:
        # Handle API key preservation if data sources are being updated
        if updates.data_sources:
            current = settings_manager.load()
            _restore_api_keys(
                updates.data_sources.sources, current.data_sources.sources
            )

        settings = settings_manager.update(updates)
        data = settings.model_dump()
        _mask_data_sources(data)
        return _response(data)
    except Exception as e:
        logger.error("Failed to update settings: %s", e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.post("/reset", response_model=ApiResponse)
async def reset_settings():
    """Reset all settings to defaults."""
    try:
        settings = settings_manager.reset()
        return _response(settings.model_dump())
    except Exception as e:
        logger.error("Failed to reset settings: %s", e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/export", response_model=ApiResponse)
async def export_settings():
    """Export settings for backup."""
    try:
        data = settings_manager.export_settings()
        _mask_data_sources(data)
        return _response(data)
    except Exception as e:
        logger.error("Failed to export settings: %s", e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.post("/import", response_model=ApiResponse)
async def import_settings(data: Dict[str, Any]):
    """Import settings from backup."""
    try:
        settings = settings_manager.import_settings(data)
        return _response(settings.model_dump())
    except Exception as e:
        logger.error("Failed to import settings: %s", e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


# Individual section endpoints for convenience


@router.get("/api-connection", response_model=ApiResponse)
async def get_api_connection_settings():
    """Get API connection settings."""
    settings = settings_manager.load()
    return _response(settings.api_connection.model_dump())


@router.put("/api-connection", response_model=ApiResponse)
async def update_api_connection_settings(config: ApiConnectionSettings):
    """Update API connection settings."""
    settings = settings_manager.load()
    settings.api_connection = config
    settings_manager.save(settings)
    return _response(settings.api_connection.model_dump())


@router.get("/data-refresh", response_model=ApiResponse)
async def get_data_refresh_settings():
    """Get data refresh interval settings."""
    settings = settings_manager.load()
    return _response(settings.data_refresh.model_dump())


@router.put("/data-refresh", response_model=ApiResponse)
async def update_data_refresh_settings(config: DataRefreshSettings):
    """Update data refresh interval settings."""
    settings = settings_manager.load()
    settings.data_refresh = config
    settings_manager.save(settings)
    return _response(settings.data_refresh.model_dump())


@router.get("/watchlist", response_model=ApiResponse)
async def get_watchlist_settings():
    """Get watchlist settings."""
    settings = settings_manager.load()
    return _response(settings.watchlist.model_dump())


@router.put("/watchlist", response_model=ApiResponse)
async def update_watchlist_settings(config: WatchlistSettings):
    """Update watchlist settings."""
    settings = settings_manager.load()
    settings.watchlist = config
    settings_manager.save(settings)
    return _response(settings.watchlist.model_dump())


@router.post("/watchlist/add/{symbol}", response_model=ApiResponse)
async def add_to_watchlist(symbol: str):
    """Add symbol to watchlist."""
    settings = settings_manager.load()
    symbol = symbol.upper()
    if symbol not in settings.watchlist.symbols:
        if len(settings.watchlist.symbols) >= settings.watchlist.max_symbols:
            raise HTTPException(
                status_code=400, detail="Watchlist is at maximum capacity"
            )
        settings.watchlist.symbols.append(symbol)
        settings_manager.save(settings)
    return _response(settings.watchlist.model_dump())


@router.delete("/watchlist/remove/{symbol}", response_model=ApiResponse)
async def remove_from_watchlist(symbol: str):
    """Remove symbol from watchlist."""
    settings = settings_manager.load()
    symbol = symbol.upper()
    if symbol in settings.watchlist.symbols:
        settings.watchlist.symbols.remove(symbol)
        settings_manager.save(settings)
    return _response(settings.watchlist.model_dump())


@router.get("/theme", response_model=ApiResponse)
async def get_theme_settings():
    """Get theme settings."""
    settings = settings_manager.load()
    return _response(settings.theme.model_dump())


@router.put("/theme", response_model=ApiResponse)
async def update_theme_settings(config: ThemeSettings):
    """Update theme settings."""
    settings = settings_manager.load()
    settings.theme = config
    settings_manager.save(settings)
    return _response(settings.theme.model_dump())


@router.get("/notifications", response_model=ApiResponse)
async def get_notification_settings():
    """Get notification settings."""
    settings = settings_manager.load()
    return _response(settings.notifications.model_dump())


@router.put("/notifications", response_model=ApiResponse)
async def update_notification_settings(config: NotificationSettings):
    """Update notification settings."""
    settings = settings_manager.load()
    settings.notifications = config
    settings_manager.save(settings)
    return _response(settings.notifications.model_dump())


@router.get("/display", response_model=ApiResponse)
async def get_display_settings():
    """Get display settings."""
    settings = settings_manager.load()
    return _response(settings.display.model_dump())


@router.put("/display", response_model=ApiResponse)
async def update_display_settings(config: DisplaySettings):
    """Update display settings."""
    settings = settings_manager.load()
    settings.display = config
    settings_manager.save(settings)
    return _response(settings.display.model_dump())


@router.get("/keyboard", response_model=ApiResponse)
async def get_keyboard_settings():
    """Get keyboard shortcut settings."""
    settings = settings_manager.load()
    return _response(settings.keyboard.model_dump())


@router.put("/keyboard", response_model=ApiResponse)
async def update_keyboard_settings(config: KeyboardSettings):
    """Update keyboard shortcut settings."""
    settings = settings_manager.load()
    settings.keyboard = config
    settings_manager.save(settings)
    return _response(settings.keyboard.model_dump())


@router.get("/data-sources", response_model=ApiResponse)
async def get_data_source_settings():
    """Get data source settings."""
    settings = settings_manager.load()
    data = settings.data_sources.model_dump()
    _mask_data_sources(data)
    return _response(data)


@router.put("/data-sources", response_model=ApiResponse)
async def update_data_source_settings(config: DataSourceSettings):
    """Update data source settings."""
    settings = settings_manager.load()
    _restore_api_keys(config.sources, settings.data_sources.sources)
    settings.data_sources = config
    settings_manager.save(settings)
    data = settings.data_sources.model_dump()
    _mask_data_sources(data)
    return _response(data)


@router.get("/export-config", response_model=ApiResponse)
async def get_export_settings():
    """Get export settings."""
    settings = settings_manager.load()
    return _response(settings.export.model_dump())


@router.put("/export-config", response_model=ApiResponse)
async def update_export_settings(config: ExportSettings):
    """Update export settings."""
    settings = settings_manager.load()
    settings.export = config
    settings_manager.save(settings)
    return _response(settings.export.model_dump())


@router.get("/risk", response_model=ApiResponse)
async def get_risk_settings():
    """Get risk management settings."""
    settings = settings_manager.load()
    return _response(settings.risk.model_dump())


@router.put("/risk", response_model=ApiResponse)
async def update_risk_settings(config: RiskSettings):
    """Update risk management settings."""
    settings = settings_manager.load()
    settings.risk = config
    settings_manager.save(settings)
    return _response(settings.risk.model_dump())


@router.get("/server-config", response_model=ApiResponse)
async def get_server_config():
    """Get read-only server configuration."""
    try:
        config = settings_manager.get_server_config()
        # Remove sensitive fields
        if "openbb" in config and "api_key" in config["openbb"]:
            config["openbb"]["api_key"] = "***"
        if "database" in config:
            for db in ["postgresql", "redis"]:
                if db in config["database"] and "password" in config["database"][db]:
                    config["database"][db]["password"] = "***"
        return _response(config)
    except Exception as e:
        logger.error("Failed to get server config: %s", e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))
