"""
Persistence Data Models

Pydantic models for all persisted data types.
"""

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4


class AlertPriority(Enum):
    """Alert priority levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertTriggerType(Enum):
    """Types of alert triggers."""

    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    PRICE_CHANGE_PCT = "price_change_pct"
    VOLUME_SPIKE = "volume_spike"
    DARK_POOL_ACTIVITY = "dark_pool_activity"
    INSTITUTIONAL_CHANGE = "institutional_change"
    SECTOR_ROTATION = "sector_rotation"
    MONEY_FLOW_SIGNAL = "money_flow_signal"
    CUSTOM = "custom"


class TradeDirection(Enum):
    """Trade direction."""

    LONG = "long"
    SHORT = "short"


class TradeStatus(Enum):
    """Trade status."""

    OPEN = "open"
    CLOSED = "closed"
    PARTIAL = "partial"


class SyncStatus(Enum):
    """Sync status for remote synchronization."""

    PENDING = "pending"
    SYNCED = "synced"
    CONFLICT = "conflict"
    ERROR = "error"


@dataclass
class WatchlistItem:
    """A single item in a watchlist."""

    id: UUID = field(default_factory=uuid4)
    symbol: str = ""
    name: str = ""
    notes: str = ""
    added_at: datetime = field(default_factory=datetime.now)
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    tags: List[str] = field(default_factory=list)
    priority: int = 0  # 0=normal, 1=high, 2=urgent

    # Metadata for sync
    updated_at: datetime = field(default_factory=datetime.now)
    sync_status: SyncStatus = SyncStatus.PENDING

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "symbol": self.symbol,
            "name": self.name,
            "notes": self.notes,
            "added_at": self.added_at.isoformat(),
            "target_price": self.target_price,
            "stop_loss": self.stop_loss,
            "tags": self.tags,
            "priority": self.priority,
            "updated_at": self.updated_at.isoformat(),
            "sync_status": self.sync_status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WatchlistItem":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            symbol=data.get("symbol", ""),
            name=data.get("name", ""),
            notes=data.get("notes", ""),
            added_at=(
                datetime.fromisoformat(data["added_at"])
                if isinstance(data.get("added_at"), str)
                else data.get("added_at", datetime.now())
            ),
            target_price=data.get("target_price"),
            stop_loss=data.get("stop_loss"),
            tags=data.get("tags", []),
            priority=data.get("priority", 0),
            updated_at=(
                datetime.fromisoformat(data["updated_at"])
                if isinstance(data.get("updated_at"), str)
                else data.get("updated_at", datetime.now())
            ),
            sync_status=(
                SyncStatus(data["sync_status"])
                if isinstance(data.get("sync_status"), str)
                else data.get("sync_status", SyncStatus.PENDING)
            ),
        )


@dataclass
class Watchlist:
    """A watchlist containing multiple symbols."""

    id: UUID = field(default_factory=uuid4)
    name: str = "Default"
    description: str = ""
    items: List[WatchlistItem] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    is_default: bool = False
    color: str = "#3b82f6"  # Blue default
    icon: str = "star"

    # Sync metadata
    sync_status: SyncStatus = SyncStatus.PENDING
    remote_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "name": self.name,
            "description": self.description,
            "items": [item.to_dict() for item in self.items],
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "is_default": self.is_default,
            "color": self.color,
            "icon": self.icon,
            "sync_status": self.sync_status.value,
            "remote_id": self.remote_id,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Watchlist":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            name=data.get("name", "Default"),
            description=data.get("description", ""),
            items=[WatchlistItem.from_dict(item) for item in data.get("items", [])],
            created_at=(
                datetime.fromisoformat(data["created_at"])
                if isinstance(data.get("created_at"), str)
                else data.get("created_at", datetime.now())
            ),
            updated_at=(
                datetime.fromisoformat(data["updated_at"])
                if isinstance(data.get("updated_at"), str)
                else data.get("updated_at", datetime.now())
            ),
            is_default=data.get("is_default", False),
            color=data.get("color", "#3b82f6"),
            icon=data.get("icon", "star"),
            sync_status=(
                SyncStatus(data["sync_status"])
                if isinstance(data.get("sync_status"), str)
                else data.get("sync_status", SyncStatus.PENDING)
            ),
            remote_id=data.get("remote_id"),
        )


@dataclass
class UserSettings:
    """User preferences and settings."""

    id: UUID = field(default_factory=uuid4)

    # Display settings
    theme: str = "dark"
    default_view: str = "dashboard"
    chart_type: str = "candlestick"
    show_premarket: bool = True
    show_afterhours: bool = True

    # Data settings
    default_lookback_days: int = 63
    cache_duration_minutes: int = 5
    auto_refresh_enabled: bool = True
    refresh_interval_seconds: int = 30

    # Alert settings
    email_alerts_enabled: bool = False
    push_alerts_enabled: bool = True
    alert_sound_enabled: bool = True
    quiet_hours_start: Optional[str] = None  # HH:MM format
    quiet_hours_end: Optional[str] = None

    # API settings
    api_base_url: str = "http://localhost:8000"
    openbb_api_key: Optional[str] = None  # Encrypted

    # Portfolio settings
    base_currency: str = "USD"
    default_position_size_pct: float = 5.0
    risk_per_trade_pct: float = 1.0

    # UI preferences
    sidebar_collapsed: bool = False
    show_tooltips: bool = True
    compact_mode: bool = False

    # Timestamps
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    # Sync
    sync_status: SyncStatus = SyncStatus.PENDING

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "theme": self.theme,
            "default_view": self.default_view,
            "chart_type": self.chart_type,
            "show_premarket": self.show_premarket,
            "show_afterhours": self.show_afterhours,
            "default_lookback_days": self.default_lookback_days,
            "cache_duration_minutes": self.cache_duration_minutes,
            "auto_refresh_enabled": self.auto_refresh_enabled,
            "refresh_interval_seconds": self.refresh_interval_seconds,
            "email_alerts_enabled": self.email_alerts_enabled,
            "push_alerts_enabled": self.push_alerts_enabled,
            "alert_sound_enabled": self.alert_sound_enabled,
            "quiet_hours_start": self.quiet_hours_start,
            "quiet_hours_end": self.quiet_hours_end,
            "api_base_url": self.api_base_url,
            "openbb_api_key": self.openbb_api_key,
            "base_currency": self.base_currency,
            "default_position_size_pct": self.default_position_size_pct,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "sidebar_collapsed": self.sidebar_collapsed,
            "show_tooltips": self.show_tooltips,
            "compact_mode": self.compact_mode,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "sync_status": self.sync_status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UserSettings":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            theme=data.get("theme", "dark"),
            default_view=data.get("default_view", "dashboard"),
            chart_type=data.get("chart_type", "candlestick"),
            show_premarket=data.get("show_premarket", True),
            show_afterhours=data.get("show_afterhours", True),
            default_lookback_days=data.get("default_lookback_days", 63),
            cache_duration_minutes=data.get("cache_duration_minutes", 5),
            auto_refresh_enabled=data.get("auto_refresh_enabled", True),
            refresh_interval_seconds=data.get("refresh_interval_seconds", 30),
            email_alerts_enabled=data.get("email_alerts_enabled", False),
            push_alerts_enabled=data.get("push_alerts_enabled", True),
            alert_sound_enabled=data.get("alert_sound_enabled", True),
            quiet_hours_start=data.get("quiet_hours_start"),
            quiet_hours_end=data.get("quiet_hours_end"),
            api_base_url=data.get("api_base_url", "http://localhost:8000"),
            openbb_api_key=data.get("openbb_api_key"),
            base_currency=data.get("base_currency", "USD"),
            default_position_size_pct=data.get("default_position_size_pct", 5.0),
            risk_per_trade_pct=data.get("risk_per_trade_pct", 1.0),
            sidebar_collapsed=data.get("sidebar_collapsed", False),
            show_tooltips=data.get("show_tooltips", True),
            compact_mode=data.get("compact_mode", False),
            created_at=(
                datetime.fromisoformat(data["created_at"])
                if isinstance(data.get("created_at"), str)
                else data.get("created_at", datetime.now())
            ),
            updated_at=(
                datetime.fromisoformat(data["updated_at"])
                if isinstance(data.get("updated_at"), str)
                else data.get("updated_at", datetime.now())
            ),
            sync_status=(
                SyncStatus(data["sync_status"])
                if isinstance(data.get("sync_status"), str)
                else data.get("sync_status", SyncStatus.PENDING)
            ),
        )


@dataclass
class AlertConfiguration:
    """Configuration for a user-defined alert."""

    id: UUID = field(default_factory=uuid4)
    name: str = ""
    symbol: str = ""
    trigger_type: AlertTriggerType = AlertTriggerType.PRICE_ABOVE
    trigger_value: float = 0.0
    trigger_value_2: Optional[float] = None  # For range-based triggers
    priority: AlertPriority = AlertPriority.MEDIUM
    is_enabled: bool = True
    is_recurring: bool = False  # Re-trigger after reset

    # Notification settings
    notify_push: bool = True
    notify_email: bool = False
    notify_sound: bool = True

    # Custom message
    custom_message: str = ""

    # Expiration
    expires_at: Optional[datetime] = None

    # State
    last_triggered_at: Optional[datetime] = None
    trigger_count: int = 0

    # Timestamps
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    # Sync
    sync_status: SyncStatus = SyncStatus.PENDING

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "name": self.name,
            "symbol": self.symbol,
            "trigger_type": self.trigger_type.value,
            "trigger_value": self.trigger_value,
            "trigger_value_2": self.trigger_value_2,
            "priority": self.priority.value,
            "is_enabled": self.is_enabled,
            "is_recurring": self.is_recurring,
            "notify_push": self.notify_push,
            "notify_email": self.notify_email,
            "notify_sound": self.notify_sound,
            "custom_message": self.custom_message,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "last_triggered_at": (
                self.last_triggered_at.isoformat() if self.last_triggered_at else None
            ),
            "trigger_count": self.trigger_count,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "sync_status": self.sync_status.value,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AlertConfiguration":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            name=data.get("name", ""),
            symbol=data.get("symbol", ""),
            trigger_type=(
                AlertTriggerType(data["trigger_type"])
                if isinstance(data.get("trigger_type"), str)
                else data.get("trigger_type", AlertTriggerType.PRICE_ABOVE)
            ),
            trigger_value=data.get("trigger_value", 0.0),
            trigger_value_2=data.get("trigger_value_2"),
            priority=(
                AlertPriority(data["priority"])
                if isinstance(data.get("priority"), str)
                else data.get("priority", AlertPriority.MEDIUM)
            ),
            is_enabled=data.get("is_enabled", True),
            is_recurring=data.get("is_recurring", False),
            notify_push=data.get("notify_push", True),
            notify_email=data.get("notify_email", False),
            notify_sound=data.get("notify_sound", True),
            custom_message=data.get("custom_message", ""),
            expires_at=(
                datetime.fromisoformat(data["expires_at"])
                if data.get("expires_at")
                else None
            ),
            last_triggered_at=(
                datetime.fromisoformat(data["last_triggered_at"])
                if data.get("last_triggered_at")
                else None
            ),
            trigger_count=data.get("trigger_count", 0),
            created_at=(
                datetime.fromisoformat(data["created_at"])
                if isinstance(data.get("created_at"), str)
                else data.get("created_at", datetime.now())
            ),
            updated_at=(
                datetime.fromisoformat(data["updated_at"])
                if isinstance(data.get("updated_at"), str)
                else data.get("updated_at", datetime.now())
            ),
            sync_status=(
                SyncStatus(data["sync_status"])
                if isinstance(data.get("sync_status"), str)
                else data.get("sync_status", SyncStatus.PENDING)
            ),
        )


@dataclass
class Alert:
    """A triggered alert instance."""

    id: UUID = field(default_factory=uuid4)
    config_id: UUID = field(default_factory=uuid4)
    symbol: str = ""
    title: str = ""
    message: str = ""
    priority: AlertPriority = AlertPriority.MEDIUM

    # Trigger details
    trigger_type: AlertTriggerType = AlertTriggerType.PRICE_ABOVE
    trigger_value: float = 0.0
    actual_value: float = 0.0

    # State
    is_read: bool = False
    is_dismissed: bool = False
    triggered_at: datetime = field(default_factory=datetime.now)
    read_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None

    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "config_id": str(self.config_id),
            "symbol": self.symbol,
            "title": self.title,
            "message": self.message,
            "priority": self.priority.value,
            "trigger_type": self.trigger_type.value,
            "trigger_value": self.trigger_value,
            "actual_value": self.actual_value,
            "is_read": self.is_read,
            "is_dismissed": self.is_dismissed,
            "triggered_at": self.triggered_at.isoformat(),
            "read_at": self.read_at.isoformat() if self.read_at else None,
            "dismissed_at": (
                self.dismissed_at.isoformat() if self.dismissed_at else None
            ),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Alert":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            config_id=(
                UUID(data["config_id"])
                if isinstance(data.get("config_id"), str)
                else data.get("config_id", uuid4())
            ),
            symbol=data.get("symbol", ""),
            title=data.get("title", ""),
            message=data.get("message", ""),
            priority=(
                AlertPriority(data["priority"])
                if isinstance(data.get("priority"), str)
                else data.get("priority", AlertPriority.MEDIUM)
            ),
            trigger_type=(
                AlertTriggerType(data["trigger_type"])
                if isinstance(data.get("trigger_type"), str)
                else data.get("trigger_type", AlertTriggerType.PRICE_ABOVE)
            ),
            trigger_value=data.get("trigger_value", 0.0),
            actual_value=data.get("actual_value", 0.0),
            is_read=data.get("is_read", False),
            is_dismissed=data.get("is_dismissed", False),
            triggered_at=(
                datetime.fromisoformat(data["triggered_at"])
                if isinstance(data.get("triggered_at"), str)
                else data.get("triggered_at", datetime.now())
            ),
            read_at=(
                datetime.fromisoformat(data["read_at"]) if data.get("read_at") else None
            ),
            dismissed_at=(
                datetime.fromisoformat(data["dismissed_at"])
                if data.get("dismissed_at")
                else None
            ),
            metadata=data.get("metadata", {}),
        )


@dataclass
class CachedMarketData:
    """Cached market data entry."""

    id: UUID = field(default_factory=uuid4)
    symbol: str = ""
    data_type: str = ""  # "quote", "ohlcv", "institutional", "dark_pool", etc.
    data: Dict[str, Any] = field(default_factory=dict)
    fetched_at: datetime = field(default_factory=datetime.now)
    expires_at: datetime = field(default_factory=datetime.now)

    # Cache metadata
    source: str = "openbb"  # Data source identifier
    version: int = 1  # Schema version

    def is_expired(self) -> bool:
        """Check if cache entry is expired."""
        return datetime.now() > self.expires_at

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "symbol": self.symbol,
            "data_type": self.data_type,
            "data": self.data,
            "fetched_at": self.fetched_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "source": self.source,
            "version": self.version,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CachedMarketData":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            symbol=data.get("symbol", ""),
            data_type=data.get("data_type", ""),
            data=data.get("data", {}),
            fetched_at=(
                datetime.fromisoformat(data["fetched_at"])
                if isinstance(data.get("fetched_at"), str)
                else data.get("fetched_at", datetime.now())
            ),
            expires_at=(
                datetime.fromisoformat(data["expires_at"])
                if isinstance(data.get("expires_at"), str)
                else data.get("expires_at", datetime.now())
            ),
            source=data.get("source", "openbb"),
            version=data.get("version", 1),
        )


@dataclass
class AnalysisRecord:
    """Stored analysis result for historical reference."""

    id: UUID = field(default_factory=uuid4)
    symbol: str = ""
    analysis_type: str = ""  # "money_flow", "institutional", "valuation", etc.

    # Analysis data
    data: Dict[str, Any] = field(default_factory=dict)
    summary: str = ""

    # Scores and signals
    overall_score: Optional[float] = None  # -1 to 1
    signal: str = ""  # "bullish", "bearish", "neutral"
    confidence: float = 0.0

    # Timestamps
    analyzed_at: datetime = field(default_factory=datetime.now)
    valid_until: Optional[datetime] = None

    # User annotations
    notes: str = ""
    tags: List[str] = field(default_factory=list)
    is_bookmarked: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "symbol": self.symbol,
            "analysis_type": self.analysis_type,
            "data": self.data,
            "summary": self.summary,
            "overall_score": self.overall_score,
            "signal": self.signal,
            "confidence": self.confidence,
            "analyzed_at": self.analyzed_at.isoformat(),
            "valid_until": self.valid_until.isoformat() if self.valid_until else None,
            "notes": self.notes,
            "tags": self.tags,
            "is_bookmarked": self.is_bookmarked,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AnalysisRecord":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            symbol=data.get("symbol", ""),
            analysis_type=data.get("analysis_type", ""),
            data=data.get("data", {}),
            summary=data.get("summary", ""),
            overall_score=data.get("overall_score"),
            signal=data.get("signal", ""),
            confidence=data.get("confidence", 0.0),
            analyzed_at=(
                datetime.fromisoformat(data["analyzed_at"])
                if isinstance(data.get("analyzed_at"), str)
                else data.get("analyzed_at", datetime.now())
            ),
            valid_until=(
                datetime.fromisoformat(data["valid_until"])
                if data.get("valid_until")
                else None
            ),
            notes=data.get("notes", ""),
            tags=data.get("tags", []),
            is_bookmarked=data.get("is_bookmarked", False),
        )


@dataclass
class PortfolioHolding:
    """A portfolio holding/position."""

    id: UUID = field(default_factory=uuid4)
    symbol: str = ""
    name: str = ""

    # Position details
    shares: float = 0.0
    average_cost: float = 0.0
    current_price: float = 0.0
    direction: TradeDirection = TradeDirection.LONG

    # Dates
    opened_at: datetime = field(default_factory=datetime.now)
    last_updated: datetime = field(default_factory=datetime.now)

    # P&L tracking
    realized_pnl: float = 0.0
    dividends_received: float = 0.0

    # Notes and tags
    notes: str = ""
    tags: List[str] = field(default_factory=list)
    thesis_link: Optional[str] = None  # Link to notes vault

    # Sync
    sync_status: SyncStatus = SyncStatus.PENDING

    @property
    def market_value(self) -> float:
        """Calculate current market value."""
        return self.shares * self.current_price

    @property
    def cost_basis(self) -> float:
        """Calculate total cost basis."""
        return self.shares * self.average_cost

    @property
    def unrealized_pnl(self) -> float:
        """Calculate unrealized P&L."""
        if self.direction == TradeDirection.LONG:
            return self.market_value - self.cost_basis
        else:
            return self.cost_basis - self.market_value

    @property
    def unrealized_pnl_pct(self) -> float:
        """Calculate unrealized P&L percentage."""
        if self.cost_basis == 0:
            return 0.0
        return (self.unrealized_pnl / self.cost_basis) * 100

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "symbol": self.symbol,
            "name": self.name,
            "shares": self.shares,
            "average_cost": self.average_cost,
            "current_price": self.current_price,
            "direction": self.direction.value,
            "opened_at": self.opened_at.isoformat(),
            "last_updated": self.last_updated.isoformat(),
            "realized_pnl": self.realized_pnl,
            "dividends_received": self.dividends_received,
            "notes": self.notes,
            "tags": self.tags,
            "thesis_link": self.thesis_link,
            "sync_status": self.sync_status.value,
            # Computed fields
            "market_value": self.market_value,
            "cost_basis": self.cost_basis,
            "unrealized_pnl": self.unrealized_pnl,
            "unrealized_pnl_pct": self.unrealized_pnl_pct,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PortfolioHolding":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            symbol=data.get("symbol", ""),
            name=data.get("name", ""),
            shares=data.get("shares", 0.0),
            average_cost=data.get("average_cost", 0.0),
            current_price=data.get("current_price", 0.0),
            direction=(
                TradeDirection(data["direction"])
                if isinstance(data.get("direction"), str)
                else data.get("direction", TradeDirection.LONG)
            ),
            opened_at=(
                datetime.fromisoformat(data["opened_at"])
                if isinstance(data.get("opened_at"), str)
                else data.get("opened_at", datetime.now())
            ),
            last_updated=(
                datetime.fromisoformat(data["last_updated"])
                if isinstance(data.get("last_updated"), str)
                else data.get("last_updated", datetime.now())
            ),
            realized_pnl=data.get("realized_pnl", 0.0),
            dividends_received=data.get("dividends_received", 0.0),
            notes=data.get("notes", ""),
            tags=data.get("tags", []),
            thesis_link=data.get("thesis_link"),
            sync_status=(
                SyncStatus(data["sync_status"])
                if isinstance(data.get("sync_status"), str)
                else data.get("sync_status", SyncStatus.PENDING)
            ),
        )


@dataclass
class TradeEntry:
    """A trade journal entry."""

    id: UUID = field(default_factory=uuid4)
    symbol: str = ""
    direction: TradeDirection = TradeDirection.LONG
    status: TradeStatus = TradeStatus.OPEN

    # Entry details
    entry_date: datetime = field(default_factory=datetime.now)
    entry_price: float = 0.0
    entry_shares: float = 0.0
    entry_commission: float = 0.0

    # Exit details
    exit_date: Optional[datetime] = None
    exit_price: Optional[float] = None
    exit_shares: Optional[float] = None
    exit_commission: float = 0.0

    # Stop loss and target
    stop_loss: Optional[float] = None
    target_price: Optional[float] = None

    # Trade rationale
    entry_reason: str = ""
    exit_reason: str = ""
    thesis_link: Optional[str] = None

    # Trade review
    lessons_learned: str = ""
    emotional_state: str = ""  # "confident", "fearful", "fomo", etc.
    grade: str = ""  # A-F self-assessment

    # Tags and notes
    tags: List[str] = field(default_factory=list)
    notes: str = ""

    # Timestamps
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    # Sync
    sync_status: SyncStatus = SyncStatus.PENDING

    @property
    def total_cost(self) -> float:
        """Calculate total cost including commission."""
        return (self.entry_price * self.entry_shares) + self.entry_commission

    @property
    def pnl(self) -> Optional[float]:
        """Calculate P&L if trade is closed."""
        if self.exit_price is None or self.exit_shares is None:
            return None

        if self.direction == TradeDirection.LONG:
            gross_pnl = (self.exit_price - self.entry_price) * self.exit_shares
        else:
            gross_pnl = (self.entry_price - self.exit_price) * self.exit_shares

        return gross_pnl - self.entry_commission - self.exit_commission

    @property
    def pnl_pct(self) -> Optional[float]:
        """Calculate P&L percentage."""
        if self.pnl is None or self.total_cost == 0:
            return None
        return (self.pnl / self.total_cost) * 100

    @property
    def holding_period_days(self) -> Optional[int]:
        """Calculate holding period in days."""
        if self.exit_date is None:
            return (datetime.now() - self.entry_date).days
        return (self.exit_date - self.entry_date).days

    @property
    def risk_reward_ratio(self) -> Optional[float]:
        """Calculate risk/reward ratio."""
        if self.stop_loss is None or self.target_price is None:
            return None

        risk = abs(self.entry_price - self.stop_loss)
        reward = abs(self.target_price - self.entry_price)

        if risk == 0:
            return None
        return reward / risk

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": str(self.id),
            "symbol": self.symbol,
            "direction": self.direction.value,
            "status": self.status.value,
            "entry_date": self.entry_date.isoformat(),
            "entry_price": self.entry_price,
            "entry_shares": self.entry_shares,
            "entry_commission": self.entry_commission,
            "exit_date": self.exit_date.isoformat() if self.exit_date else None,
            "exit_price": self.exit_price,
            "exit_shares": self.exit_shares,
            "exit_commission": self.exit_commission,
            "stop_loss": self.stop_loss,
            "target_price": self.target_price,
            "entry_reason": self.entry_reason,
            "exit_reason": self.exit_reason,
            "thesis_link": self.thesis_link,
            "lessons_learned": self.lessons_learned,
            "emotional_state": self.emotional_state,
            "grade": self.grade,
            "tags": self.tags,
            "notes": self.notes,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "sync_status": self.sync_status.value,
            # Computed fields
            "total_cost": self.total_cost,
            "pnl": self.pnl,
            "pnl_pct": self.pnl_pct,
            "holding_period_days": self.holding_period_days,
            "risk_reward_ratio": self.risk_reward_ratio,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TradeEntry":
        """Create from dictionary."""
        return cls(
            id=(
                UUID(data["id"])
                if isinstance(data.get("id"), str)
                else data.get("id", uuid4())
            ),
            symbol=data.get("symbol", ""),
            direction=(
                TradeDirection(data["direction"])
                if isinstance(data.get("direction"), str)
                else data.get("direction", TradeDirection.LONG)
            ),
            status=(
                TradeStatus(data["status"])
                if isinstance(data.get("status"), str)
                else data.get("status", TradeStatus.OPEN)
            ),
            entry_date=(
                datetime.fromisoformat(data["entry_date"])
                if isinstance(data.get("entry_date"), str)
                else data.get("entry_date", datetime.now())
            ),
            entry_price=data.get("entry_price", 0.0),
            entry_shares=data.get("entry_shares", 0.0),
            entry_commission=data.get("entry_commission", 0.0),
            exit_date=(
                datetime.fromisoformat(data["exit_date"])
                if data.get("exit_date")
                else None
            ),
            exit_price=data.get("exit_price"),
            exit_shares=data.get("exit_shares"),
            exit_commission=data.get("exit_commission", 0.0),
            stop_loss=data.get("stop_loss"),
            target_price=data.get("target_price"),
            entry_reason=data.get("entry_reason", ""),
            exit_reason=data.get("exit_reason", ""),
            thesis_link=data.get("thesis_link"),
            lessons_learned=data.get("lessons_learned", ""),
            emotional_state=data.get("emotional_state", ""),
            grade=data.get("grade", ""),
            tags=data.get("tags", []),
            notes=data.get("notes", ""),
            created_at=(
                datetime.fromisoformat(data["created_at"])
                if isinstance(data.get("created_at"), str)
                else data.get("created_at", datetime.now())
            ),
            updated_at=(
                datetime.fromisoformat(data["updated_at"])
                if isinstance(data.get("updated_at"), str)
                else data.get("updated_at", datetime.now())
            ),
            sync_status=(
                SyncStatus(data["sync_status"])
                if isinstance(data.get("sync_status"), str)
                else data.get("sync_status", SyncStatus.PENDING)
            ),
        )
