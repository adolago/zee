"""
Stanley Settings Router
========================

API endpoints for user preferences, alert configurations, and system settings.
Provides user-specific settings management with role-based access control.

Endpoints:
    GET  /api/settings           - Get current system settings (admin only)
    PUT  /api/settings           - Update system settings (admin only)
    GET  /api/settings/user      - Get user preferences
    PUT  /api/settings/user      - Update user preferences
    GET  /api/settings/watchlist - Get user watchlist
    PUT  /api/settings/watchlist - Update watchlist
    GET  /api/settings/alerts    - Get alert configurations
    PUT  /api/settings/alerts    - Update alerts
    POST /api/settings/alerts    - Create new alert
    DELETE /api/settings/alerts/{alert_id} - Delete alert
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from stanley.api.auth import (
    get_current_user,
    get_optional_user,
    require_admin,
    Role,
)
from stanley.api.auth.dependencies import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Settings"])


# =============================================================================
# Pydantic Models
# =============================================================================


class UserPreferences(BaseModel):
    """User preference settings."""

    theme: str = Field(
        default="dark", pattern="^(dark|light|system)$", description="UI theme mode"
    )
    default_benchmark: str = Field(
        default="SPY",
        max_length=10,
        description="Default benchmark symbol for comparisons",
    )
    watchlist: List[str] = Field(
        default_factory=lambda: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"],
        description="User's watchlist symbols",
    )
    alert_email: Optional[str] = Field(
        default=None, description="Email for alert notifications"
    )
    notifications_enabled: bool = Field(
        default=True, description="Enable notifications"
    )
    compact_view: bool = Field(default=False, description="Use compact UI layout")
    default_timeframe: str = Field(
        default="1M",
        pattern="^(1D|1W|1M|3M|6M|1Y|YTD|ALL)$",
        description="Default chart timeframe",
    )
    decimal_places: int = Field(
        default=2, ge=0, le=6, description="Decimal places for price display"
    )


class AlertConfig(BaseModel):
    """Individual alert configuration."""

    id: Optional[str] = Field(default=None, description="Unique alert identifier")
    symbol: str = Field(
        ..., min_length=1, max_length=10, description="Symbol to monitor"
    )
    alert_type: str = Field(
        ...,
        pattern="^(price|volume|signal|filing|institutional|options)$",
        description="Type of alert",
    )
    threshold: float = Field(..., description="Threshold value for alert")
    direction: str = Field(
        ..., pattern="^(above|below|change)$", description="Alert direction"
    )
    enabled: bool = Field(default=True, description="Whether alert is active")
    notify_email: bool = Field(default=False, description="Send email notification")
    notify_push: bool = Field(default=True, description="Send push notification")
    created_at: Optional[str] = Field(default=None, description="Creation timestamp")
    triggered_at: Optional[str] = Field(
        default=None, description="Last triggered timestamp"
    )


class AlertsUpdate(BaseModel):
    """Alert configuration update request."""

    alerts: List[AlertConfig] = Field(
        default_factory=list, description="List of alert configurations"
    )


class WatchlistUpdate(BaseModel):
    """Watchlist update request."""

    symbols: List[str] = Field(
        ..., min_length=0, max_length=100, description="Watchlist symbols"
    )


class SystemSettings(BaseModel):
    """System-wide settings (admin only)."""

    maintenance_mode: bool = Field(default=False, description="Enable maintenance mode")
    rate_limit_requests_per_minute: int = Field(
        default=60, ge=1, le=1000, description="Global rate limit"
    )
    max_watchlist_size: int = Field(
        default=100, ge=10, le=500, description="Maximum watchlist size per user"
    )
    max_alerts_per_user: int = Field(
        default=50, ge=5, le=200, description="Maximum alerts per user"
    )
    data_cache_ttl_seconds: int = Field(
        default=300, ge=60, le=3600, description="Data cache TTL in seconds"
    )
    enable_mock_data_fallback: bool = Field(
        default=True, description="Fall back to mock data on API errors"
    )
    sec_edgar_rate_limit: int = Field(
        default=10, ge=1, le=30, description="SEC EDGAR requests per second"
    )
    openbb_enabled: bool = Field(default=True, description="Enable OpenBB data source")
    dbnomics_enabled: bool = Field(
        default=True, description="Enable DBnomics data source"
    )


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool = Field(..., description="Whether the request succeeded")
    data: Optional[Any] = Field(None, description="Response data")
    error: Optional[str] = Field(None, description="Error message if failed")
    timestamp: str = Field(..., description="Response timestamp")


# =============================================================================
# In-Memory Storage (Development)
# =============================================================================

# User preferences storage (user_id -> UserPreferences)
_user_preferences: Dict[str, UserPreferences] = {}

# Alert configurations storage (user_id -> List[AlertConfig])
_user_alerts: Dict[str, List[AlertConfig]] = {}

# System settings (singleton)
_system_settings = SystemSettings()


def _get_user_preferences(user_id: str) -> UserPreferences:
    """Get or create user preferences."""
    if user_id not in _user_preferences:
        _user_preferences[user_id] = UserPreferences()
    return _user_preferences[user_id]


def _get_user_alerts(user_id: str) -> List[AlertConfig]:
    """Get or create user alerts list."""
    if user_id not in _user_alerts:
        _user_alerts[user_id] = []
    return _user_alerts[user_id]


def _get_timestamp() -> str:
    """Get current ISO timestamp."""
    return datetime.utcnow().isoformat() + "Z"


def _response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> ApiResponse:
    """Create standardized API response."""
    return ApiResponse(
        success=success and error is None,
        data=data,
        error=error,
        timestamp=_get_timestamp(),
    )


# =============================================================================
# System Settings Endpoints (Admin Only)
# =============================================================================


@router.get("", response_model=ApiResponse)
async def get_system_settings(
    user: User = Depends(require_admin),
) -> ApiResponse:
    """
    Get current system settings (admin only).

    Returns system-wide configuration options that affect all users.
    Requires admin privileges.

    Returns:
        ApiResponse containing SystemSettings
    """
    logger.info(f"Admin {user.id} retrieved system settings")
    return _response(data=_system_settings.model_dump())


@router.put("", response_model=ApiResponse)
async def update_system_settings(
    settings: SystemSettings,
    user: User = Depends(require_admin),
) -> ApiResponse:
    """
    Update system settings (admin only).

    Updates system-wide configuration. All fields are optional;
    only provided fields will be updated.

    Args:
        settings: New system settings

    Returns:
        ApiResponse containing updated SystemSettings
    """
    global _system_settings
    _system_settings = settings
    logger.info(f"Admin {user.id} updated system settings")
    return _response(data=_system_settings.model_dump())


# =============================================================================
# User Preferences Endpoints
# =============================================================================


@router.get("/user", response_model=ApiResponse)
async def get_user_preferences(
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Get current user's preferences.

    Returns the authenticated user's personal settings including
    theme, default benchmark, notification preferences, and display options.

    Returns:
        ApiResponse containing UserPreferences
    """
    prefs = _get_user_preferences(user.id)
    return _response(data=prefs.model_dump())


@router.put("/user", response_model=ApiResponse)
async def update_user_preferences(
    prefs: UserPreferences,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Update current user's preferences.

    Updates the authenticated user's personal settings.
    All fields in UserPreferences can be updated.

    Args:
        prefs: New user preferences

    Returns:
        ApiResponse containing updated UserPreferences
    """
    _user_preferences[user.id] = prefs
    logger.info(f"User {user.id} updated preferences")
    return _response(data=prefs.model_dump())


# =============================================================================
# Watchlist Endpoints
# =============================================================================


@router.get("/watchlist", response_model=ApiResponse)
async def get_user_watchlist(
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Get current user's watchlist.

    Returns the list of symbols the user is monitoring.

    Returns:
        ApiResponse containing watchlist data
    """
    prefs = _get_user_preferences(user.id)
    return _response(
        data={
            "symbols": prefs.watchlist,
            "count": len(prefs.watchlist),
            "max_size": _system_settings.max_watchlist_size,
        }
    )


@router.put("/watchlist", response_model=ApiResponse)
async def update_user_watchlist(
    watchlist: WatchlistUpdate,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Update current user's watchlist.

    Replaces the entire watchlist with the provided symbols.
    Symbols are automatically converted to uppercase.

    Args:
        watchlist: New watchlist symbols

    Returns:
        ApiResponse containing updated watchlist
    """
    # Validate watchlist size
    if len(watchlist.symbols) > _system_settings.max_watchlist_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Watchlist exceeds maximum size of {_system_settings.max_watchlist_size}",
        )

    prefs = _get_user_preferences(user.id)
    # Normalize symbols to uppercase and remove duplicates
    prefs.watchlist = list(dict.fromkeys(s.upper() for s in watchlist.symbols))
    _user_preferences[user.id] = prefs

    logger.info(f"User {user.id} updated watchlist: {len(prefs.watchlist)} symbols")

    return _response(
        data={
            "symbols": prefs.watchlist,
            "count": len(prefs.watchlist),
            "max_size": _system_settings.max_watchlist_size,
        }
    )


@router.post("/watchlist/{symbol}", response_model=ApiResponse)
async def add_to_watchlist(
    symbol: str,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Add a symbol to the user's watchlist.

    Args:
        symbol: Stock ticker symbol to add

    Returns:
        ApiResponse containing updated watchlist
    """
    prefs = _get_user_preferences(user.id)
    symbol = symbol.upper()

    if len(prefs.watchlist) >= _system_settings.max_watchlist_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Watchlist is at maximum size ({_system_settings.max_watchlist_size})",
        )

    if symbol not in prefs.watchlist:
        prefs.watchlist.append(symbol)
        _user_preferences[user.id] = prefs
        logger.info(f"User {user.id} added {symbol} to watchlist")

    return _response(
        data={
            "symbols": prefs.watchlist,
            "count": len(prefs.watchlist),
            "added": symbol,
        }
    )


@router.delete("/watchlist/{symbol}", response_model=ApiResponse)
async def remove_from_watchlist(
    symbol: str,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Remove a symbol from the user's watchlist.

    Args:
        symbol: Stock ticker symbol to remove

    Returns:
        ApiResponse containing updated watchlist
    """
    prefs = _get_user_preferences(user.id)
    symbol = symbol.upper()

    if symbol in prefs.watchlist:
        prefs.watchlist.remove(symbol)
        _user_preferences[user.id] = prefs
        logger.info(f"User {user.id} removed {symbol} from watchlist")

    return _response(
        data={
            "symbols": prefs.watchlist,
            "count": len(prefs.watchlist),
            "removed": symbol,
        }
    )


# =============================================================================
# Alert Configuration Endpoints
# =============================================================================


@router.get("/alerts", response_model=ApiResponse)
async def get_user_alerts(
    enabled_only: bool = False,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Get current user's alert configurations.

    Args:
        enabled_only: If true, only return enabled alerts

    Returns:
        ApiResponse containing list of AlertConfig
    """
    alerts = _get_user_alerts(user.id)

    if enabled_only:
        alerts = [a for a in alerts if a.enabled]

    return _response(
        data={
            "alerts": [a.model_dump() for a in alerts],
            "count": len(alerts),
            "max_alerts": _system_settings.max_alerts_per_user,
        }
    )


@router.put("/alerts", response_model=ApiResponse)
async def update_user_alerts(
    alerts_update: AlertsUpdate,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Replace all user's alert configurations.

    This replaces the entire alerts list. Use POST /alerts to add
    a single alert or DELETE /alerts/{id} to remove one.

    Args:
        alerts_update: New alert configurations

    Returns:
        ApiResponse containing updated alerts
    """
    if len(alerts_update.alerts) > _system_settings.max_alerts_per_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exceeds maximum alerts limit ({_system_settings.max_alerts_per_user})",
        )

    # Ensure all alerts have IDs and timestamps
    now = _get_timestamp()
    processed_alerts = []
    for alert in alerts_update.alerts:
        if not alert.id:
            alert.id = str(uuid.uuid4())
        if not alert.created_at:
            alert.created_at = now
        alert.symbol = alert.symbol.upper()
        processed_alerts.append(alert)

    _user_alerts[user.id] = processed_alerts
    logger.info(f"User {user.id} updated alerts: {len(processed_alerts)} alerts")

    return _response(
        data={
            "alerts": [a.model_dump() for a in processed_alerts],
            "count": len(processed_alerts),
            "max_alerts": _system_settings.max_alerts_per_user,
        }
    )


@router.post("/alerts", response_model=ApiResponse)
async def create_alert(
    alert: AlertConfig,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Create a new alert configuration.

    Args:
        alert: New alert configuration

    Returns:
        ApiResponse containing created alert
    """
    alerts = _get_user_alerts(user.id)

    if len(alerts) >= _system_settings.max_alerts_per_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum alerts limit reached ({_system_settings.max_alerts_per_user})",
        )

    # Assign ID and timestamp
    alert.id = str(uuid.uuid4())
    alert.created_at = _get_timestamp()
    alert.symbol = alert.symbol.upper()

    alerts.append(alert)
    _user_alerts[user.id] = alerts

    logger.info(f"User {user.id} created alert {alert.id} for {alert.symbol}")

    return _response(data=alert.model_dump())


@router.get("/alerts/{alert_id}", response_model=ApiResponse)
async def get_alert(
    alert_id: str,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Get a specific alert by ID.

    Args:
        alert_id: Alert identifier

    Returns:
        ApiResponse containing alert configuration
    """
    alerts = _get_user_alerts(user.id)
    alert = next((a for a in alerts if a.id == alert_id), None)

    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert not found: {alert_id}",
        )

    return _response(data=alert.model_dump())


@router.put("/alerts/{alert_id}", response_model=ApiResponse)
async def update_alert(
    alert_id: str,
    alert_update: AlertConfig,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Update a specific alert configuration.

    Args:
        alert_id: Alert identifier
        alert_update: Updated alert configuration

    Returns:
        ApiResponse containing updated alert
    """
    alerts = _get_user_alerts(user.id)
    alert_idx = next((i for i, a in enumerate(alerts) if a.id == alert_id), None)

    if alert_idx is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert not found: {alert_id}",
        )

    # Preserve ID and created_at, update everything else
    alert_update.id = alert_id
    alert_update.created_at = alerts[alert_idx].created_at
    alert_update.symbol = alert_update.symbol.upper()

    alerts[alert_idx] = alert_update
    _user_alerts[user.id] = alerts

    logger.info(f"User {user.id} updated alert {alert_id}")

    return _response(data=alert_update.model_dump())


@router.delete("/alerts/{alert_id}", response_model=ApiResponse)
async def delete_alert(
    alert_id: str,
    user: User = Depends(get_current_user),
) -> ApiResponse:
    """
    Delete an alert configuration.

    Args:
        alert_id: Alert identifier

    Returns:
        ApiResponse confirming deletion
    """
    alerts = _get_user_alerts(user.id)
    original_count = len(alerts)
    alerts = [a for a in alerts if a.id != alert_id]

    if len(alerts) == original_count:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert not found: {alert_id}",
        )

    _user_alerts[user.id] = alerts
    logger.info(f"User {user.id} deleted alert {alert_id}")

    return _response(data={"deleted": alert_id, "remaining": len(alerts)})


# =============================================================================
# Admin Alert Management
# =============================================================================


@router.get("/admin/alerts", response_model=ApiResponse)
async def get_all_alerts(
    user: User = Depends(require_admin),
) -> ApiResponse:
    """
    Get all users' alert configurations (admin only).

    Returns summary of all alerts across all users for monitoring.

    Returns:
        ApiResponse containing alert statistics
    """
    total_alerts = sum(len(alerts) for alerts in _user_alerts.values())
    enabled_alerts = sum(
        sum(1 for a in alerts if a.enabled) for alerts in _user_alerts.values()
    )

    alerts_by_type: Dict[str, int] = {}
    for alerts in _user_alerts.values():
        for alert in alerts:
            alerts_by_type[alert.alert_type] = (
                alerts_by_type.get(alert.alert_type, 0) + 1
            )

    return _response(
        data={
            "total_users_with_alerts": len(_user_alerts),
            "total_alerts": total_alerts,
            "enabled_alerts": enabled_alerts,
            "disabled_alerts": total_alerts - enabled_alerts,
            "alerts_by_type": alerts_by_type,
        }
    )


# =============================================================================
# Public Settings Info
# =============================================================================


@router.get("/info", response_model=ApiResponse)
async def get_settings_info(
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Get public settings information.

    Returns non-sensitive configuration info that can be used by
    unauthenticated clients to configure their behavior.

    Returns:
        ApiResponse containing public settings info
    """
    return _response(
        data={
            "max_watchlist_size": _system_settings.max_watchlist_size,
            "max_alerts_per_user": _system_settings.max_alerts_per_user,
            "supported_themes": ["dark", "light", "system"],
            "supported_timeframes": ["1D", "1W", "1M", "3M", "6M", "1Y", "YTD", "ALL"],
            "supported_alert_types": [
                "price",
                "volume",
                "signal",
                "filing",
                "institutional",
                "options",
            ],
            "maintenance_mode": _system_settings.maintenance_mode,
        }
    )
