"""
Money Flow Alert System

Real-time alerts for dark pool activity, block trades, sector rotation,
unusual volume, and smart money movements.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any


class AlertSeverity(Enum):
    """Alert severity levels."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertType(Enum):
    """Types of money flow alerts."""

    DARK_POOL_SURGE = "dark_pool_surge"
    DARK_POOL_DECLINE = "dark_pool_decline"
    BLOCK_TRADE = "block_trade"
    UNUSUAL_VOLUME = "unusual_volume"
    SECTOR_ROTATION = "sector_rotation"
    SMART_MONEY_INFLOW = "smart_money_inflow"
    SMART_MONEY_OUTFLOW = "smart_money_outflow"
    FLOW_MOMENTUM_SHIFT = "flow_momentum_shift"
    INSTITUTIONAL_ACCUMULATION = "institutional_accumulation"
    INSTITUTIONAL_DISTRIBUTION = "institutional_distribution"


class BlockTradeSize(Enum):
    """Block trade size classifications."""

    SMALL = "small"  # 10K-50K shares or $200K-$1M
    MEDIUM = "medium"  # 50K-100K shares or $1M-$5M
    LARGE = "large"  # 100K-500K shares or $5M-$25M
    MEGA = "mega"  # 500K+ shares or $25M+


@dataclass
class AlertThresholds:
    """Configurable thresholds for alert generation."""

    # Dark pool thresholds
    dark_pool_surge_pct: float = 0.35  # 35%+ dark pool = surge
    dark_pool_decline_pct: float = 0.15  # <15% dark pool = decline
    dark_pool_change_threshold: float = 0.10  # 10% change from average

    # Block trade thresholds (in shares)
    block_trade_small_shares: int = 10_000
    block_trade_medium_shares: int = 50_000
    block_trade_large_shares: int = 100_000
    block_trade_mega_shares: int = 500_000

    # Block trade thresholds (in dollars)
    block_trade_small_value: float = 200_000
    block_trade_medium_value: float = 1_000_000
    block_trade_large_value: float = 5_000_000
    block_trade_mega_value: float = 25_000_000

    # Unusual volume thresholds
    volume_zscore_threshold: float = 2.0  # 2 std deviations
    volume_ratio_threshold: float = 2.5  # 2.5x average volume
    volume_lookback_days: int = 20  # Rolling window for average

    # Sector rotation thresholds
    sector_rotation_threshold: float = 0.05  # 5% relative strength change
    sector_momentum_lookback: int = 10  # Days for momentum calculation

    # Smart money thresholds
    smart_money_flow_threshold: float = 0.15  # 15% institutional flow change
    smart_money_concentration: float = 0.70  # 70%+ institutional ownership

    # Flow momentum thresholds
    flow_momentum_threshold: float = 0.20  # 20% momentum shift
    flow_acceleration_threshold: float = 0.10  # 10% acceleration


@dataclass
class MoneyFlowAlert:
    """Individual money flow alert."""

    alert_id: str
    alert_type: AlertType
    severity: AlertSeverity
    symbol: str
    timestamp: datetime

    # Alert details
    title: str
    description: str

    # Metrics
    current_value: float
    threshold_value: float
    change_pct: float

    # Additional context
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Alert state
    acknowledged: bool = False
    expired: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert alert to dictionary."""
        return {
            "alert_id": self.alert_id,
            "alert_type": self.alert_type.value,
            "severity": self.severity.value,
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "title": self.title,
            "description": self.description,
            "current_value": self.current_value,
            "threshold_value": self.threshold_value,
            "change_pct": self.change_pct,
            "metadata": self.metadata,
            "acknowledged": self.acknowledged,
            "expired": self.expired,
        }


@dataclass
class BlockTradeEvent:
    """Block trade event detection."""

    symbol: str
    timestamp: datetime
    shares: int
    price: float
    notional_value: float
    size_classification: BlockTradeSize

    # Trade direction inference
    is_buy: Optional[bool] = None  # None = unknown

    # Dark pool indicator
    is_dark_pool: bool = False

    # Additional context
    venue: str = "unknown"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "shares": self.shares,
            "price": self.price,
            "notional_value": self.notional_value,
            "size_classification": self.size_classification.value,
            "is_buy": self.is_buy,
            "is_dark_pool": self.is_dark_pool,
            "venue": self.venue,
        }


@dataclass
class SectorRotationSignal:
    """Sector rotation signal."""

    timestamp: datetime

    # Sector rankings
    leaders: List[str]  # Top performing sectors
    laggards: List[str]  # Bottom performing sectors

    # Rotation direction
    rotating_into: List[str]  # Sectors gaining relative strength
    rotating_out_of: List[str]  # Sectors losing relative strength

    # Metrics
    sector_scores: Dict[str, float]  # Relative strength scores
    momentum_scores: Dict[str, float]  # Momentum scores

    # Signal strength
    confidence: float  # 0-1 confidence score

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "leaders": self.leaders,
            "laggards": self.laggards,
            "rotating_into": self.rotating_into,
            "rotating_out_of": self.rotating_out_of,
            "sector_scores": self.sector_scores,
            "momentum_scores": self.momentum_scores,
            "confidence": self.confidence,
        }


@dataclass
class SmartMoneyMetrics:
    """Smart money tracking metrics."""

    symbol: str
    timestamp: datetime

    # Institutional flow metrics
    institutional_net_flow: float
    institutional_flow_direction: str  # "inflow", "outflow", "neutral"

    # Ownership metrics
    institutional_ownership_pct: float
    ownership_change_pct: float

    # Smart money indicators
    smart_money_score: float  # -1 to 1
    smart_money_trend: str  # "accumulating", "distributing", "neutral"

    # Top movers
    top_buyers: List[Dict[str, Any]] = field(default_factory=list)
    top_sellers: List[Dict[str, Any]] = field(default_factory=list)

    # Confidence
    confidence: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "institutional_net_flow": self.institutional_net_flow,
            "institutional_flow_direction": self.institutional_flow_direction,
            "institutional_ownership_pct": self.institutional_ownership_pct,
            "ownership_change_pct": self.ownership_change_pct,
            "smart_money_score": self.smart_money_score,
            "smart_money_trend": self.smart_money_trend,
            "top_buyers": self.top_buyers,
            "top_sellers": self.top_sellers,
            "confidence": self.confidence,
        }


@dataclass
class FlowMomentumIndicator:
    """Flow momentum indicator."""

    symbol: str
    timestamp: datetime

    # Momentum values
    flow_momentum: float  # Current momentum
    flow_acceleration: float  # Rate of change of momentum

    # Trend analysis
    trend_direction: str  # "bullish", "bearish", "neutral"
    trend_strength: float  # 0-1 strength score

    # Moving averages
    flow_ma_5: float  # 5-day moving average
    flow_ma_10: float  # 10-day moving average
    flow_ma_20: float  # 20-day moving average

    # Signals
    ma_crossover_signal: int  # 1=bullish, -1=bearish, 0=neutral
    momentum_divergence: bool = False  # Price/flow divergence

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "flow_momentum": self.flow_momentum,
            "flow_acceleration": self.flow_acceleration,
            "trend_direction": self.trend_direction,
            "trend_strength": self.trend_strength,
            "flow_ma_5": self.flow_ma_5,
            "flow_ma_10": self.flow_ma_10,
            "flow_ma_20": self.flow_ma_20,
            "ma_crossover_signal": self.ma_crossover_signal,
            "momentum_divergence": self.momentum_divergence,
        }


@dataclass
class UnusualVolumeSignal:
    """Unusual volume detection signal."""

    symbol: str
    timestamp: datetime

    # Volume metrics
    current_volume: int
    average_volume: int
    volume_ratio: float  # current / average

    # Statistical significance
    zscore: float
    percentile: float  # Historical percentile rank

    # Classification
    is_unusual: bool
    unusualness_score: float  # 0-1 how unusual

    # Direction inference
    likely_direction: str  # "accumulation", "distribution", "unknown"
    price_volume_correlation: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "current_volume": self.current_volume,
            "average_volume": self.average_volume,
            "volume_ratio": self.volume_ratio,
            "zscore": self.zscore,
            "percentile": self.percentile,
            "is_unusual": self.is_unusual,
            "unusualness_score": self.unusualness_score,
            "likely_direction": self.likely_direction,
            "price_volume_correlation": self.price_volume_correlation,
        }


class AlertAggregator:
    """Aggregates and manages money flow alerts."""

    def __init__(self, thresholds: Optional[AlertThresholds] = None):
        """Initialize alert aggregator."""
        self.thresholds = thresholds or AlertThresholds()
        self.alerts: List[MoneyFlowAlert] = []
        self._alert_counter = 0

    def _generate_alert_id(self) -> str:
        """Generate unique alert ID."""
        self._alert_counter += 1
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        return f"MFA-{timestamp}-{self._alert_counter:04d}"

    def create_alert(
        self,
        alert_type: AlertType,
        symbol: str,
        current_value: float,
        threshold_value: float,
        title: str,
        description: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> MoneyFlowAlert:
        """Create and register a new alert."""

        # Calculate severity based on deviation from threshold
        change_pct = (
            (current_value - threshold_value) / abs(threshold_value)
            if threshold_value != 0
            else 0
        )
        severity = self._calculate_severity(alert_type, abs(change_pct))

        alert = MoneyFlowAlert(
            alert_id=self._generate_alert_id(),
            alert_type=alert_type,
            severity=severity,
            symbol=symbol,
            timestamp=datetime.now(),
            title=title,
            description=description,
            current_value=current_value,
            threshold_value=threshold_value,
            change_pct=change_pct,
            metadata=metadata or {},
        )

        self.alerts.append(alert)
        return alert

    def _calculate_severity(
        self, alert_type: AlertType, deviation: float
    ) -> AlertSeverity:
        """Calculate alert severity based on type and deviation."""

        # Different thresholds for different alert types
        if alert_type in (AlertType.DARK_POOL_SURGE, AlertType.UNUSUAL_VOLUME):
            if deviation > 0.5:
                return AlertSeverity.CRITICAL
            elif deviation > 0.3:
                return AlertSeverity.HIGH
            elif deviation > 0.15:
                return AlertSeverity.MEDIUM
            return AlertSeverity.LOW

        elif alert_type == AlertType.BLOCK_TRADE:
            if deviation > 1.0:  # Mega block
                return AlertSeverity.CRITICAL
            elif deviation > 0.5:  # Large block
                return AlertSeverity.HIGH
            elif deviation > 0.2:  # Medium block
                return AlertSeverity.MEDIUM
            return AlertSeverity.LOW

        else:
            # Default severity calculation
            if deviation > 0.4:
                return AlertSeverity.CRITICAL
            elif deviation > 0.25:
                return AlertSeverity.HIGH
            elif deviation > 0.1:
                return AlertSeverity.MEDIUM
            return AlertSeverity.LOW

    def get_active_alerts(
        self,
        symbol: Optional[str] = None,
        alert_type: Optional[AlertType] = None,
        min_severity: Optional[AlertSeverity] = None,
    ) -> List[MoneyFlowAlert]:
        """Get active (non-expired, non-acknowledged) alerts."""

        severity_order = {
            AlertSeverity.LOW: 0,
            AlertSeverity.MEDIUM: 1,
            AlertSeverity.HIGH: 2,
            AlertSeverity.CRITICAL: 3,
        }

        filtered = [a for a in self.alerts if not a.expired and not a.acknowledged]

        if symbol:
            filtered = [a for a in filtered if a.symbol == symbol]

        if alert_type:
            filtered = [a for a in filtered if a.alert_type == alert_type]

        if min_severity:
            min_level = severity_order[min_severity]
            filtered = [a for a in filtered if severity_order[a.severity] >= min_level]

        # Sort by severity (highest first), then timestamp (newest first)
        return sorted(
            filtered,
            key=lambda a: (-severity_order[a.severity], -a.timestamp.timestamp()),
        )

    def acknowledge_alert(self, alert_id: str) -> bool:
        """Acknowledge an alert."""
        for alert in self.alerts:
            if alert.alert_id == alert_id:
                alert.acknowledged = True
                return True
        return False

    def expire_old_alerts(self, max_age_hours: int = 24) -> int:
        """Expire alerts older than max_age_hours."""
        now = datetime.now()
        expired_count = 0

        for alert in self.alerts:
            age_hours = (now - alert.timestamp).total_seconds() / 3600
            if age_hours > max_age_hours and not alert.expired:
                alert.expired = True
                expired_count += 1

        return expired_count

    def get_alert_summary(self) -> Dict[str, Any]:
        """Get summary of current alerts."""
        active = self.get_active_alerts()

        by_type = {}
        by_severity = {}
        by_symbol = {}

        for alert in active:
            # Count by type
            type_key = alert.alert_type.value
            by_type[type_key] = by_type.get(type_key, 0) + 1

            # Count by severity
            sev_key = alert.severity.value
            by_severity[sev_key] = by_severity.get(sev_key, 0) + 1

            # Count by symbol
            by_symbol[alert.symbol] = by_symbol.get(alert.symbol, 0) + 1

        return {
            "total_active": len(active),
            "by_type": by_type,
            "by_severity": by_severity,
            "by_symbol": by_symbol,
            "timestamp": datetime.now().isoformat(),
        }

    def clear_alerts(self) -> int:
        """Clear all alerts and return count cleared."""
        count = len(self.alerts)
        self.alerts = []
        return count
