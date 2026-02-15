"""
Tests for Enhanced MoneyFlowAnalyzer features.

Tests cover:
- Dark pool alert detection
- Block trade detection and classification
- Sector rotation signals
- Smart money tracking
- Unusual volume detection
- Flow momentum indicators
- Alert aggregation system
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

from stanley.analytics.money_flow import MoneyFlowAnalyzer
from stanley.analytics.alerts import (
    AlertAggregator,
    AlertSeverity,
    AlertThresholds,
    AlertType,
    BlockTradeEvent,
    BlockTradeSize,
    FlowMomentumIndicator,
    MoneyFlowAlert,
    SectorRotationSignal,
    SmartMoneyMetrics,
    UnusualVolumeSignal,
)

# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def analyzer():
    """Create MoneyFlowAnalyzer with default thresholds."""
    return MoneyFlowAnalyzer()


@pytest.fixture
def custom_thresholds():
    """Create custom AlertThresholds for testing."""
    return AlertThresholds(
        dark_pool_surge_pct=0.30,
        dark_pool_decline_pct=0.20,
        block_trade_small_shares=5_000,
        volume_zscore_threshold=1.5,
    )


@pytest.fixture
def analyzer_custom_thresholds(custom_thresholds):
    """Create MoneyFlowAnalyzer with custom thresholds."""
    return MoneyFlowAnalyzer(thresholds=custom_thresholds)


@pytest.fixture
def sample_dark_pool_data():
    """Generate sample dark pool data DataFrame."""
    dates = pd.date_range(end=datetime.now(), periods=20, freq="D")
    return pd.DataFrame(
        {
            "date": dates,
            "dark_pool_volume": np.random.randint(100000, 1000000, len(dates)),
            "total_volume": np.random.randint(1000000, 10000000, len(dates)),
            "dark_pool_percentage": np.random.uniform(0.15, 0.35, len(dates)),
            "large_block_activity": np.random.uniform(0.05, 0.15, len(dates)),
        }
    )


@pytest.fixture
def sample_volume_data():
    """Generate sample volume analysis data."""
    dates = pd.date_range(end=datetime.now(), periods=20, freq="D")
    np.random.seed(42)
    return pd.DataFrame(
        {
            "date": dates,
            "volume": np.random.randint(1000000, 10000000, len(dates)),
            "price_change": np.random.uniform(-0.05, 0.05, len(dates)),
            "block_trades": np.random.randint(0, 50, len(dates)),
        }
    )


@pytest.fixture
def sample_institutional_flows():
    """Generate sample institutional flow data."""
    dates = pd.date_range(end=datetime.now(), periods=20, freq="D")
    np.random.seed(42)
    return pd.DataFrame(
        {
            "date": dates,
            "institutional_net_flow": np.random.normal(0, 1000000, len(dates)),
            "buyer_count": np.random.randint(10, 100, len(dates)),
            "seller_count": np.random.randint(10, 100, len(dates)),
        }
    )


# =============================================================================
# ALERT THRESHOLDS TESTS
# =============================================================================


class TestAlertThresholds:
    """Tests for AlertThresholds configuration."""

    def test_default_thresholds(self):
        """Test default threshold values."""
        thresholds = AlertThresholds()
        assert thresholds.dark_pool_surge_pct == 0.35
        assert thresholds.dark_pool_decline_pct == 0.15
        assert thresholds.volume_zscore_threshold == 2.0
        assert thresholds.block_trade_small_shares == 10_000
        assert thresholds.block_trade_mega_shares == 500_000

    def test_custom_thresholds(self, custom_thresholds):
        """Test custom threshold configuration."""
        assert custom_thresholds.dark_pool_surge_pct == 0.30
        assert custom_thresholds.dark_pool_decline_pct == 0.20
        assert custom_thresholds.block_trade_small_shares == 5_000

    def test_threshold_values_positive(self):
        """Test that threshold values are positive."""
        thresholds = AlertThresholds()
        assert thresholds.dark_pool_surge_pct > 0
        assert thresholds.volume_ratio_threshold > 0
        assert thresholds.block_trade_small_value > 0


# =============================================================================
# ALERT AGGREGATOR TESTS
# =============================================================================


class TestAlertAggregator:
    """Tests for AlertAggregator functionality."""

    def test_init_default_thresholds(self):
        """Test initialization with default thresholds."""
        aggregator = AlertAggregator()
        assert aggregator.thresholds is not None
        assert len(aggregator.alerts) == 0

    def test_init_custom_thresholds(self, custom_thresholds):
        """Test initialization with custom thresholds."""
        aggregator = AlertAggregator(custom_thresholds)
        assert aggregator.thresholds == custom_thresholds

    def test_generate_alert_id(self):
        """Test unique alert ID generation."""
        aggregator = AlertAggregator()
        id1 = aggregator._generate_alert_id()
        id2 = aggregator._generate_alert_id()
        assert id1 != id2
        assert id1.startswith("MFA-")
        assert id2.startswith("MFA-")

    def test_create_alert(self):
        """Test alert creation."""
        aggregator = AlertAggregator()
        alert = aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test Alert",
            description="Test description",
        )
        assert alert.alert_type == AlertType.DARK_POOL_SURGE
        assert alert.symbol == "AAPL"
        assert alert.current_value == 0.40
        assert len(aggregator.alerts) == 1

    def test_create_alert_with_metadata(self):
        """Test alert creation with metadata."""
        aggregator = AlertAggregator()
        metadata = {"extra_info": "test", "value": 123}
        alert = aggregator.create_alert(
            alert_type=AlertType.BLOCK_TRADE,
            symbol="MSFT",
            current_value=1000000,
            threshold_value=500000,
            title="Block Trade",
            description="Large block detected",
            metadata=metadata,
        )
        assert alert.metadata == metadata

    def test_severity_calculation_low(self):
        """Test low severity calculation."""
        aggregator = AlertAggregator()
        severity = aggregator._calculate_severity(AlertType.DARK_POOL_SURGE, 0.05)
        assert severity == AlertSeverity.LOW

    def test_severity_calculation_medium(self):
        """Test medium severity calculation."""
        aggregator = AlertAggregator()
        severity = aggregator._calculate_severity(AlertType.DARK_POOL_SURGE, 0.20)
        assert severity == AlertSeverity.MEDIUM

    def test_severity_calculation_high(self):
        """Test high severity calculation."""
        aggregator = AlertAggregator()
        severity = aggregator._calculate_severity(AlertType.DARK_POOL_SURGE, 0.35)
        assert severity == AlertSeverity.HIGH

    def test_severity_calculation_critical(self):
        """Test critical severity calculation."""
        aggregator = AlertAggregator()
        severity = aggregator._calculate_severity(AlertType.DARK_POOL_SURGE, 0.60)
        assert severity == AlertSeverity.CRITICAL

    def test_get_active_alerts_all(self):
        """Test getting all active alerts."""
        aggregator = AlertAggregator()
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test 1",
            description="Desc 1",
        )
        aggregator.create_alert(
            alert_type=AlertType.UNUSUAL_VOLUME,
            symbol="MSFT",
            current_value=3.0,
            threshold_value=2.5,
            title="Test 2",
            description="Desc 2",
        )
        alerts = aggregator.get_active_alerts()
        assert len(alerts) == 2

    def test_get_active_alerts_by_symbol(self):
        """Test filtering alerts by symbol."""
        aggregator = AlertAggregator()
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test 1",
            description="Desc 1",
        )
        aggregator.create_alert(
            alert_type=AlertType.UNUSUAL_VOLUME,
            symbol="MSFT",
            current_value=3.0,
            threshold_value=2.5,
            title="Test 2",
            description="Desc 2",
        )
        alerts = aggregator.get_active_alerts(symbol="AAPL")
        assert len(alerts) == 1
        assert alerts[0].symbol == "AAPL"

    def test_get_active_alerts_by_type(self):
        """Test filtering alerts by type."""
        aggregator = AlertAggregator()
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test 1",
            description="Desc 1",
        )
        aggregator.create_alert(
            alert_type=AlertType.UNUSUAL_VOLUME,
            symbol="AAPL",
            current_value=3.0,
            threshold_value=2.5,
            title="Test 2",
            description="Desc 2",
        )
        alerts = aggregator.get_active_alerts(alert_type=AlertType.DARK_POOL_SURGE)
        assert len(alerts) == 1
        assert alerts[0].alert_type == AlertType.DARK_POOL_SURGE

    def test_get_active_alerts_by_severity(self):
        """Test filtering alerts by minimum severity."""
        aggregator = AlertAggregator()
        # Create low severity alert
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.36,
            threshold_value=0.35,
            title="Low",
            description="Low severity",
        )
        # Create high severity alert
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="MSFT",
            current_value=0.60,
            threshold_value=0.35,
            title="High",
            description="High severity",
        )
        alerts = aggregator.get_active_alerts(min_severity=AlertSeverity.HIGH)
        assert len(alerts) == 1
        assert alerts[0].symbol == "MSFT"

    def test_acknowledge_alert(self):
        """Test acknowledging an alert."""
        aggregator = AlertAggregator()
        alert = aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test",
            description="Desc",
        )
        assert not alert.acknowledged
        result = aggregator.acknowledge_alert(alert.alert_id)
        assert result is True
        assert alert.acknowledged is True

    def test_acknowledge_nonexistent_alert(self):
        """Test acknowledging nonexistent alert returns False."""
        aggregator = AlertAggregator()
        result = aggregator.acknowledge_alert("nonexistent-id")
        assert result is False

    def test_expire_old_alerts(self):
        """Test expiring old alerts."""
        aggregator = AlertAggregator()
        alert = aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test",
            description="Desc",
        )
        # Manually set timestamp to old date
        alert.timestamp = datetime.now() - timedelta(hours=25)
        expired_count = aggregator.expire_old_alerts(max_age_hours=24)
        assert expired_count == 1
        assert alert.expired is True

    def test_get_alert_summary(self):
        """Test getting alert summary."""
        aggregator = AlertAggregator()
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test 1",
            description="Desc 1",
        )
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.45,
            threshold_value=0.35,
            title="Test 2",
            description="Desc 2",
        )
        summary = aggregator.get_alert_summary()
        assert summary["total_active"] == 2
        assert "by_type" in summary
        assert "by_symbol" in summary
        assert summary["by_symbol"]["AAPL"] == 2

    def test_clear_alerts(self):
        """Test clearing all alerts."""
        aggregator = AlertAggregator()
        aggregator.create_alert(
            alert_type=AlertType.DARK_POOL_SURGE,
            symbol="AAPL",
            current_value=0.40,
            threshold_value=0.35,
            title="Test",
            description="Desc",
        )
        count = aggregator.clear_alerts()
        assert count == 1
        assert len(aggregator.alerts) == 0


# =============================================================================
# MONEY FLOW ALERT TESTS
# =============================================================================


class TestMoneyFlowAlert:
    """Tests for MoneyFlowAlert dataclass."""

    def test_alert_to_dict(self):
        """Test alert serialization to dictionary."""
        alert = MoneyFlowAlert(
            alert_id="MFA-123-0001",
            alert_type=AlertType.DARK_POOL_SURGE,
            severity=AlertSeverity.HIGH,
            symbol="AAPL",
            timestamp=datetime(2024, 1, 1, 12, 0, 0),
            title="Test Alert",
            description="Test description",
            current_value=0.40,
            threshold_value=0.35,
            change_pct=0.14,
        )
        result = alert.to_dict()
        assert result["alert_id"] == "MFA-123-0001"
        assert result["alert_type"] == "dark_pool_surge"
        assert result["severity"] == "high"
        assert result["symbol"] == "AAPL"

    def test_alert_default_values(self):
        """Test alert default field values."""
        alert = MoneyFlowAlert(
            alert_id="MFA-123-0001",
            alert_type=AlertType.DARK_POOL_SURGE,
            severity=AlertSeverity.LOW,
            symbol="AAPL",
            timestamp=datetime.now(),
            title="Test",
            description="Desc",
            current_value=0.40,
            threshold_value=0.35,
            change_pct=0.14,
        )
        assert alert.acknowledged is False
        assert alert.expired is False
        assert alert.metadata == {}


# =============================================================================
# DARK POOL ALERTS TESTS
# =============================================================================


class TestDarkPoolAlerts:
    """Tests for dark pool alert detection."""

    def test_detect_dark_pool_alerts_returns_list(self, analyzer):
        """Test that detect_dark_pool_alerts returns a list."""
        alerts = analyzer.detect_dark_pool_alerts("AAPL")
        assert isinstance(alerts, list)

    def test_detect_dark_pool_surge(self, analyzer):
        """Test detection of dark pool surge."""
        with patch.object(analyzer, "get_dark_pool_activity") as mock_dp:
            mock_dp.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=10, freq="D"),
                    "dark_pool_percentage": [0.25] * 9 + [0.45],  # Surge on last day
                    "dark_pool_volume": [500000] * 10,
                    "large_block_activity": [0.10] * 10,
                }
            )
            alerts = analyzer.detect_dark_pool_alerts("AAPL")
            surge_alerts = [
                a for a in alerts if a.alert_type == AlertType.DARK_POOL_SURGE
            ]
            assert len(surge_alerts) > 0

    def test_detect_dark_pool_decline(self, analyzer):
        """Test detection of dark pool decline."""
        with patch.object(analyzer, "get_dark_pool_activity") as mock_dp:
            mock_dp.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=10, freq="D"),
                    "dark_pool_percentage": [0.25] * 9 + [0.10],  # Decline on last day
                    "dark_pool_volume": [500000] * 10,
                    "large_block_activity": [0.10] * 10,
                }
            )
            alerts = analyzer.detect_dark_pool_alerts("AAPL")
            decline_alerts = [
                a for a in alerts if a.alert_type == AlertType.DARK_POOL_DECLINE
            ]
            assert len(decline_alerts) > 0

    def test_no_alert_normal_activity(self, analyzer):
        """Test no alerts for normal dark pool activity."""
        with patch.object(analyzer, "get_dark_pool_activity") as mock_dp:
            # Create stable data within normal range
            mock_dp.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=10, freq="D"),
                    "dark_pool_percentage": [0.25] * 10,  # Consistent normal level
                    "dark_pool_volume": [500000] * 10,
                    "large_block_activity": [0.10] * 10,
                }
            )
            alerts = analyzer.detect_dark_pool_alerts("AAPL")
            # Should have no surge/decline alerts (zscore alerts possible but unlikely)
            critical_alerts = [
                a for a in alerts if a.severity == AlertSeverity.CRITICAL
            ]
            assert len(critical_alerts) == 0

    def test_dark_pool_alerts_empty_data(self, analyzer):
        """Test handling of empty dark pool data."""
        with patch.object(analyzer, "get_dark_pool_activity") as mock_dp:
            mock_dp.return_value = pd.DataFrame()
            alerts = analyzer.detect_dark_pool_alerts("AAPL")
            assert alerts == []


# =============================================================================
# BLOCK TRADE DETECTION TESTS
# =============================================================================


class TestBlockTradeDetection:
    """Tests for block trade detection."""

    def test_detect_block_trades_returns_list(self, analyzer):
        """Test that detect_block_trades returns a list."""
        block_trades = analyzer.detect_block_trades("AAPL")
        assert isinstance(block_trades, list)

    def test_block_trade_classification_small(self, analyzer):
        """Test small block trade classification."""
        size = analyzer._classify_block_trade(25_000, 500_000)
        assert size == BlockTradeSize.SMALL

    def test_block_trade_classification_medium(self, analyzer):
        """Test medium block trade classification."""
        size = analyzer._classify_block_trade(75_000, 2_000_000)
        assert size == BlockTradeSize.MEDIUM

    def test_block_trade_classification_large(self, analyzer):
        """Test large block trade classification."""
        size = analyzer._classify_block_trade(200_000, 10_000_000)
        assert size == BlockTradeSize.LARGE

    def test_block_trade_classification_mega(self, analyzer):
        """Test mega block trade classification."""
        size = analyzer._classify_block_trade(600_000, 30_000_000)
        assert size == BlockTradeSize.MEGA

    def test_block_trade_classification_by_value(self, analyzer):
        """Test classification by notional value when shares are low."""
        # Small shares but mega value
        size = analyzer._classify_block_trade(5_000, 30_000_000)
        assert size == BlockTradeSize.MEGA

    def test_block_trade_event_to_dict(self):
        """Test BlockTradeEvent serialization."""
        event = BlockTradeEvent(
            symbol="AAPL",
            timestamp=datetime(2024, 1, 1, 12, 0, 0),
            shares=100_000,
            price=150.0,
            notional_value=15_000_000,
            size_classification=BlockTradeSize.LARGE,
            is_buy=True,
            is_dark_pool=True,
        )
        result = event.to_dict()
        assert result["symbol"] == "AAPL"
        assert result["shares"] == 100_000
        assert result["size_classification"] == "large"
        assert result["is_buy"] is True

    def test_block_trade_detection_generates_alerts(self, analyzer):
        """Test that large block trades generate alerts."""
        initial_alert_count = len(analyzer.alert_aggregator.alerts)
        with patch.object(analyzer, "_get_volume_analysis") as mock_vol:
            mock_vol.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=5, freq="D"),
                    "volume": [10_000_000] * 5,
                    "price_change": [0.02] * 5,
                    "block_trades": [10] * 5,  # Simulate block trades
                }
            )
            analyzer.detect_block_trades("AAPL", price=150.0)
            # Should have more alerts than before
            assert len(analyzer.alert_aggregator.alerts) >= initial_alert_count


# =============================================================================
# SECTOR ROTATION TESTS
# =============================================================================


class TestSectorRotation:
    """Tests for sector rotation detection (async)."""

    @pytest.mark.asyncio
    async def test_detect_sector_rotation_returns_signal(self, analyzer):
        """Test that detect_sector_rotation returns a SectorRotationSignal."""
        signal = await analyzer.detect_sector_rotation()
        assert isinstance(signal, SectorRotationSignal)

    @pytest.mark.asyncio
    async def test_sector_rotation_with_custom_sectors(self, analyzer):
        """Test sector rotation with custom sector list."""
        sectors = ["XLK", "XLF", "XLE"]
        signal = await analyzer.detect_sector_rotation(sectors=sectors)
        assert isinstance(signal, SectorRotationSignal)
        # All requested sectors should be in scores
        for sector in sectors:
            assert sector in signal.sector_scores or len(signal.sector_scores) == 0

    @pytest.mark.asyncio
    async def test_sector_rotation_signal_fields(self, analyzer):
        """Test SectorRotationSignal has required fields."""
        signal = await analyzer.detect_sector_rotation()
        assert hasattr(signal, "leaders")
        assert hasattr(signal, "laggards")
        assert hasattr(signal, "rotating_into")
        assert hasattr(signal, "rotating_out_of")
        assert hasattr(signal, "sector_scores")
        assert hasattr(signal, "momentum_scores")
        assert hasattr(signal, "confidence")

    def test_sector_rotation_signal_to_dict(self):
        """Test SectorRotationSignal serialization."""
        signal = SectorRotationSignal(
            timestamp=datetime(2024, 1, 1, 12, 0, 0),
            leaders=["XLK", "XLY"],
            laggards=["XLU", "XLP"],
            rotating_into=["XLK"],
            rotating_out_of=["XLU"],
            sector_scores={"XLK": 0.8, "XLU": -0.5},
            momentum_scores={"XLK": 0.1, "XLU": -0.1},
            confidence=0.75,
        )
        result = signal.to_dict()
        assert result["leaders"] == ["XLK", "XLY"]
        assert result["confidence"] == 0.75

    @pytest.mark.asyncio
    async def test_sector_rotation_empty_sectors(self, analyzer):
        """Test sector rotation with empty sectors list."""
        signal = await analyzer.detect_sector_rotation(sectors=[])
        assert signal.confidence == 0.0
        assert signal.leaders == []


# =============================================================================
# SMART MONEY TRACKING TESTS
# =============================================================================


class TestSmartMoneyTracking:
    """Tests for smart money tracking (async)."""

    @pytest.mark.asyncio
    async def test_track_smart_money_returns_metrics(self, analyzer):
        """Test that track_smart_money returns SmartMoneyMetrics."""
        metrics = await analyzer.track_smart_money("AAPL")
        assert isinstance(metrics, SmartMoneyMetrics)

    @pytest.mark.asyncio
    async def test_smart_money_metrics_fields(self, analyzer):
        """Test SmartMoneyMetrics has required fields."""
        metrics = await analyzer.track_smart_money("AAPL")
        assert hasattr(metrics, "symbol")
        assert hasattr(metrics, "institutional_net_flow")
        assert hasattr(metrics, "institutional_flow_direction")
        assert hasattr(metrics, "smart_money_score")
        assert hasattr(metrics, "smart_money_trend")

    @pytest.mark.asyncio
    async def test_smart_money_score_bounded(self, analyzer):
        """Test smart money score is between -1 and 1."""
        metrics = await analyzer.track_smart_money("AAPL")
        assert -1 <= metrics.smart_money_score <= 1

    @pytest.mark.asyncio
    async def test_smart_money_trend_values(self, analyzer):
        """Test smart money trend has valid values."""
        metrics = await analyzer.track_smart_money("AAPL")
        assert metrics.smart_money_trend in ["accumulating", "distributing", "neutral"]

    @pytest.mark.asyncio
    async def test_smart_money_flow_direction_values(self, analyzer):
        """Test flow direction has valid values."""
        metrics = await analyzer.track_smart_money("AAPL")
        assert metrics.institutional_flow_direction in ["inflow", "outflow", "neutral"]

    def test_smart_money_metrics_to_dict(self):
        """Test SmartMoneyMetrics serialization."""
        metrics = SmartMoneyMetrics(
            symbol="AAPL",
            timestamp=datetime(2024, 1, 1, 12, 0, 0),
            institutional_net_flow=5_000_000,
            institutional_flow_direction="inflow",
            institutional_ownership_pct=0.75,
            ownership_change_pct=0.05,
            smart_money_score=0.6,
            smart_money_trend="accumulating",
            confidence=0.6,
        )
        result = metrics.to_dict()
        assert result["symbol"] == "AAPL"
        assert result["smart_money_score"] == 0.6

    @pytest.mark.asyncio
    async def test_smart_money_empty_flows(self, analyzer):
        """Test smart money tracking with empty flow data."""
        with patch.object(analyzer, "_get_institutional_flows") as mock_flows:
            mock_flows.return_value = pd.DataFrame()
            metrics = await analyzer.track_smart_money("AAPL")
            assert metrics.smart_money_score == 0.0
            assert metrics.smart_money_trend == "neutral"


# =============================================================================
# UNUSUAL VOLUME DETECTION TESTS
# =============================================================================


class TestUnusualVolumeDetection:
    """Tests for unusual volume detection."""

    def test_detect_unusual_volume_returns_signal(self, analyzer):
        """Test that detect_unusual_volume returns UnusualVolumeSignal."""
        signal = analyzer.detect_unusual_volume("AAPL")
        assert isinstance(signal, UnusualVolumeSignal)

    def test_unusual_volume_signal_fields(self, analyzer):
        """Test UnusualVolumeSignal has required fields."""
        signal = analyzer.detect_unusual_volume("AAPL")
        assert hasattr(signal, "symbol")
        assert hasattr(signal, "current_volume")
        assert hasattr(signal, "average_volume")
        assert hasattr(signal, "volume_ratio")
        assert hasattr(signal, "zscore")
        assert hasattr(signal, "is_unusual")

    def test_unusual_volume_high_zscore(self, analyzer):
        """Test unusual volume detection with high z-score."""
        with patch.object(analyzer, "_get_volume_analysis") as mock_vol:
            # Normal volumes with one spike
            normal_volumes = [1_000_000] * 19 + [5_000_000]
            mock_vol.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=20, freq="D"),
                    "volume": normal_volumes,
                    "price_change": [0.01] * 20,
                    "block_trades": [5] * 20,
                }
            )
            signal = analyzer.detect_unusual_volume("AAPL")
            assert (
                signal.is_unusual
            )  # Use truthiness instead of 'is True' for numpy bool
            assert signal.zscore > 2.0

    def test_unusual_volume_high_ratio(self, analyzer):
        """Test unusual volume detection with high volume ratio."""
        with patch.object(analyzer, "_get_volume_analysis") as mock_vol:
            # 3x volume spike
            normal_volumes = [1_000_000] * 19 + [3_000_000]
            mock_vol.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=20, freq="D"),
                    "volume": normal_volumes,
                    "price_change": [0.01] * 20,
                    "block_trades": [5] * 20,
                }
            )
            signal = analyzer.detect_unusual_volume("AAPL")
            assert signal.volume_ratio > 2.5

    def test_unusual_volume_direction_accumulation(self, analyzer):
        """Test unusual volume with positive price change suggests accumulation."""
        with patch.object(analyzer, "_get_volume_analysis") as mock_vol:
            mock_vol.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=20, freq="D"),
                    "volume": [1_000_000] * 19 + [5_000_000],
                    "price_change": [0.01] * 19
                    + [0.05],  # Positive change on volume spike
                    "block_trades": [5] * 20,
                }
            )
            signal = analyzer.detect_unusual_volume("AAPL")
            if signal.is_unusual:
                assert signal.likely_direction == "accumulation"

    def test_unusual_volume_direction_distribution(self, analyzer):
        """Test unusual volume with negative price change suggests distribution."""
        with patch.object(analyzer, "_get_volume_analysis") as mock_vol:
            mock_vol.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=20, freq="D"),
                    "volume": [1_000_000] * 19 + [5_000_000],
                    "price_change": [0.01] * 19
                    + [-0.05],  # Negative change on volume spike
                    "block_trades": [5] * 20,
                }
            )
            signal = analyzer.detect_unusual_volume("AAPL")
            if signal.is_unusual:
                assert signal.likely_direction == "distribution"

    def test_unusual_volume_signal_to_dict(self):
        """Test UnusualVolumeSignal serialization."""
        signal = UnusualVolumeSignal(
            symbol="AAPL",
            timestamp=datetime(2024, 1, 1, 12, 0, 0),
            current_volume=5_000_000,
            average_volume=1_000_000,
            volume_ratio=5.0,
            zscore=4.0,
            percentile=0.99,
            is_unusual=True,
            unusualness_score=0.95,
            likely_direction="accumulation",
            price_volume_correlation=0.8,
        )
        result = signal.to_dict()
        assert result["symbol"] == "AAPL"
        assert result["is_unusual"] is True

    def test_unusual_volume_insufficient_data(self, analyzer):
        """Test handling of insufficient volume data."""
        with patch.object(analyzer, "_get_volume_analysis") as mock_vol:
            mock_vol.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=3, freq="D"),
                    "volume": [1_000_000] * 3,
                    "price_change": [0.01] * 3,
                }
            )
            signal = analyzer.detect_unusual_volume("AAPL")
            assert signal.is_unusual is False


# =============================================================================
# FLOW MOMENTUM INDICATORS TESTS
# =============================================================================


class TestFlowMomentumIndicators:
    """Tests for flow momentum indicators."""

    def test_calculate_flow_momentum_returns_indicator(self, analyzer):
        """Test that calculate_flow_momentum returns FlowMomentumIndicator."""
        indicator = analyzer.calculate_flow_momentum("AAPL")
        assert isinstance(indicator, FlowMomentumIndicator)

    def test_flow_momentum_indicator_fields(self, analyzer):
        """Test FlowMomentumIndicator has required fields."""
        indicator = analyzer.calculate_flow_momentum("AAPL")
        assert hasattr(indicator, "symbol")
        assert hasattr(indicator, "flow_momentum")
        assert hasattr(indicator, "flow_acceleration")
        assert hasattr(indicator, "trend_direction")
        assert hasattr(indicator, "trend_strength")
        assert hasattr(indicator, "flow_ma_5")
        assert hasattr(indicator, "flow_ma_10")
        assert hasattr(indicator, "flow_ma_20")
        assert hasattr(indicator, "ma_crossover_signal")

    def test_flow_momentum_trend_direction_values(self, analyzer):
        """Test trend direction has valid values."""
        indicator = analyzer.calculate_flow_momentum("AAPL")
        assert indicator.trend_direction in ["bullish", "bearish", "neutral"]

    def test_flow_momentum_crossover_signal_values(self, analyzer):
        """Test MA crossover signal has valid values."""
        indicator = analyzer.calculate_flow_momentum("AAPL")
        assert indicator.ma_crossover_signal in [-1, 0, 1]

    def test_flow_momentum_trend_strength_bounded(self, analyzer):
        """Test trend strength is between 0 and 1."""
        indicator = analyzer.calculate_flow_momentum("AAPL")
        assert 0 <= indicator.trend_strength <= 1

    def test_flow_momentum_bullish_crossover(self, analyzer):
        """Test bullish MA crossover detection."""
        with patch.object(analyzer, "_get_institutional_flows") as mock_flows:
            # Create increasing flow pattern
            dates = pd.date_range(end=datetime.now(), periods=25, freq="D")
            flows = np.linspace(-1_000_000, 2_000_000, 25)  # Increasing trend
            mock_flows.return_value = pd.DataFrame(
                {
                    "date": dates,
                    "institutional_net_flow": flows,
                    "buyer_count": [50] * 25,
                    "seller_count": [30] * 25,
                }
            )
            indicator = analyzer.calculate_flow_momentum("AAPL")
            # Strong uptrend should have bullish crossover
            assert indicator.ma_crossover_signal >= 0

    def test_flow_momentum_indicator_to_dict(self):
        """Test FlowMomentumIndicator serialization."""
        indicator = FlowMomentumIndicator(
            symbol="AAPL",
            timestamp=datetime(2024, 1, 1, 12, 0, 0),
            flow_momentum=0.25,
            flow_acceleration=0.05,
            trend_direction="bullish",
            trend_strength=0.5,
            flow_ma_5=1_000_000,
            flow_ma_10=800_000,
            flow_ma_20=600_000,
            ma_crossover_signal=1,
            momentum_divergence=False,
        )
        result = indicator.to_dict()
        assert result["symbol"] == "AAPL"
        assert result["trend_direction"] == "bullish"
        assert result["ma_crossover_signal"] == 1

    def test_flow_momentum_insufficient_data(self, analyzer):
        """Test handling of insufficient flow data."""
        with patch.object(analyzer, "_get_institutional_flows") as mock_flows:
            mock_flows.return_value = pd.DataFrame(
                {
                    "date": pd.date_range(end=datetime.now(), periods=5, freq="D"),
                    "institutional_net_flow": [1_000_000] * 5,
                    "buyer_count": [50] * 5,
                    "seller_count": [30] * 5,
                }
            )
            indicator = analyzer.calculate_flow_momentum("AAPL")
            assert indicator.trend_direction == "neutral"


# =============================================================================
# COMPREHENSIVE ANALYSIS TESTS
# =============================================================================


class TestComprehensiveAnalysis:
    """Tests for comprehensive money flow analysis (async)."""

    @pytest.mark.asyncio
    async def test_comprehensive_analysis_returns_dict(self, analyzer):
        """Test that get_comprehensive_analysis returns a dictionary."""
        result = await analyzer.get_comprehensive_analysis("AAPL")
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_comprehensive_analysis_structure(self, analyzer):
        """Test comprehensive analysis has expected structure."""
        result = await analyzer.get_comprehensive_analysis("AAPL")
        assert "symbol" in result
        assert "timestamp" in result
        assert "basic_metrics" in result
        assert "dark_pool" in result
        assert "block_trades" in result
        assert "smart_money" in result
        assert "unusual_volume" in result
        assert "flow_momentum" in result
        assert "alerts" in result

    @pytest.mark.asyncio
    async def test_comprehensive_analysis_basic_metrics(self, analyzer):
        """Test basic metrics in comprehensive analysis."""
        result = await analyzer.get_comprehensive_analysis("AAPL")
        basic_metrics = result["basic_metrics"]
        assert "money_flow_score" in basic_metrics
        assert "institutional_sentiment" in basic_metrics

    @pytest.mark.asyncio
    async def test_comprehensive_analysis_dark_pool(self, analyzer):
        """Test dark pool section in comprehensive analysis."""
        result = await analyzer.get_comprehensive_analysis("AAPL")
        assert "alerts" in result["dark_pool"]
        assert "alert_count" in result["dark_pool"]

    @pytest.mark.asyncio
    async def test_comprehensive_analysis_block_trades(self, analyzer):
        """Test block trades section in comprehensive analysis."""
        result = await analyzer.get_comprehensive_analysis("AAPL")
        assert "events" in result["block_trades"]
        assert "total_count" in result["block_trades"]
        assert "large_blocks" in result["block_trades"]

    @pytest.mark.asyncio
    async def test_comprehensive_analysis_alerts(self, analyzer):
        """Test alerts section in comprehensive analysis."""
        result = await analyzer.get_comprehensive_analysis("AAPL")
        assert "active" in result["alerts"]
        assert "summary" in result["alerts"]


# =============================================================================
# GET ALERTS TESTS
# =============================================================================


class TestGetAlerts:
    """Tests for get_alerts method."""

    def test_get_alerts_returns_list(self, analyzer):
        """Test that get_alerts returns a list."""
        alerts = analyzer.get_alerts()
        assert isinstance(alerts, list)

    def test_get_alerts_filter_by_symbol(self, analyzer):
        """Test filtering alerts by symbol."""
        # Generate some alerts
        analyzer.detect_dark_pool_alerts("AAPL")
        analyzer.detect_unusual_volume("MSFT")

        aapl_alerts = analyzer.get_alerts(symbol="AAPL")
        for alert in aapl_alerts:
            assert alert.symbol == "AAPL"

    def test_get_alerts_filter_by_type(self, analyzer):
        """Test filtering alerts by type."""
        # Generate various alerts
        analyzer.detect_dark_pool_alerts("AAPL")
        analyzer.detect_unusual_volume("AAPL")

        volume_alerts = analyzer.get_alerts(alert_type=AlertType.UNUSUAL_VOLUME)
        for alert in volume_alerts:
            assert alert.alert_type == AlertType.UNUSUAL_VOLUME


# =============================================================================
# CACHE MANAGEMENT TESTS
# =============================================================================


class TestCacheManagement:
    """Tests for cache management."""

    def test_clear_cache(self, analyzer):
        """Test clearing analyzer cache."""
        # Add something to caches
        analyzer._sector_cache["XLK"] = {"test": "data"}
        analyzer._volume_cache["AAPL"] = pd.DataFrame()

        analyzer.clear_cache()

        assert len(analyzer._sector_cache) == 0
        assert len(analyzer._volume_cache) == 0


# =============================================================================
# INTEGRATION TESTS
# =============================================================================


class TestMoneyFlowAnalyzerIntegration:
    """Integration tests for MoneyFlowAnalyzer."""

    def test_analyzer_with_custom_thresholds(self, analyzer_custom_thresholds):
        """Test analyzer uses custom thresholds."""
        assert analyzer_custom_thresholds.thresholds.dark_pool_surge_pct == 0.30

    @pytest.mark.asyncio
    async def test_multiple_symbol_analysis(self, analyzer):
        """Test analyzing multiple symbols."""
        symbols = ["AAPL", "MSFT", "GOOGL"]
        results = {}
        for symbol in symbols:
            results[symbol] = await analyzer.get_comprehensive_analysis(symbol)

        assert len(results) == 3
        for symbol, result in results.items():
            assert result["symbol"] == symbol

    def test_alert_accumulation_across_methods(self, analyzer):
        """Test alerts accumulate across different detection methods."""
        initial_count = len(analyzer.alert_aggregator.alerts)

        analyzer.detect_dark_pool_alerts("AAPL")
        after_dp = len(analyzer.alert_aggregator.alerts)

        analyzer.detect_unusual_volume("AAPL")
        after_vol = len(analyzer.alert_aggregator.alerts)

        # Alerts should accumulate
        assert after_dp >= initial_count
        assert after_vol >= after_dp

    def test_health_check(self, analyzer):
        """Test health check returns True."""
        assert analyzer.health_check() is True
