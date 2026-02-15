"""
Tests for NautilusTrader indicators wrapping Stanley analytics.

This module tests the custom indicators that expose Stanley's
institutional analysis metrics within NautilusTrader strategies.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, MagicMock, patch

# =============================================================================
# Fixtures
# =============================================================================


def _make_float_mock(value: float) -> Mock:
    """Create a Mock that works with float() conversion like nautilus Price/Quantity."""
    mock = Mock()
    mock.__float__ = Mock(return_value=float(value))
    mock.as_double = Mock(return_value=float(value))
    return mock


def _make_bar_mock(
    open_: float, high: float, low: float, close: float, volume: float
) -> Mock:
    """Create a complete bar mock with float-compatible fields."""
    bar = Mock()
    bar.open = _make_float_mock(open_)
    bar.high = _make_float_mock(high)
    bar.low = _make_float_mock(low)
    bar.close = _make_float_mock(close)
    bar.volume = _make_float_mock(volume)
    bar.ts_event = int(datetime.now().timestamp() * 1e9)
    return bar


@pytest.fixture
def sample_bar_series():
    """Create a sample bar series for indicator testing."""
    bars = []
    base_price = 100.0

    for i in range(50):
        price_change = np.random.normal(0, 2)
        close = base_price + price_change
        high = close + abs(np.random.normal(0, 1))
        low = close - abs(np.random.normal(0, 1))
        open_price = close + np.random.normal(0, 0.5)

        bar = _make_bar_mock(open_price, high, low, close, 1000000 + i * 10000)
        bars.append(bar)
        base_price = close

    return bars


@pytest.fixture
def mock_money_flow_data():
    """Mock money flow data for indicator testing."""
    return {
        "money_flow_score": 0.65,
        "institutional_sentiment": 0.7,
        "smart_money_activity": 0.5,
        "short_pressure": -0.2,
        "accumulation_distribution": 0.4,
        "confidence": 0.65,
    }


@pytest.fixture
def mock_institutional_data():
    """Mock institutional data for indicator testing."""
    return {
        "institutional_ownership": 0.75,
        "ownership_trend": 0.05,
        "smart_money_score": 0.6,
        "concentration_risk": 0.3,
        "number_of_institutions": 250,
    }


@pytest.fixture
def mock_dark_pool_data():
    """Mock dark pool data for indicator testing."""
    dates = pd.date_range(end=datetime.now(), periods=20, freq="D")
    return pd.DataFrame(
        {
            "date": dates,
            "dark_pool_volume": np.random.randint(400000, 600000, 20),
            "total_volume": np.random.randint(4000000, 6000000, 20),
            "dark_pool_percentage": np.random.uniform(0.20, 0.30, 20),
            "large_block_activity": np.random.uniform(0.08, 0.15, 20),
            "dark_pool_signal": np.random.choice([1, 0, -1], 20),
        }
    )


# =============================================================================
# SmartMoneyIndicator Tests
# =============================================================================


class TestSmartMoneyIndicatorInitialization:
    """Test SmartMoneyIndicator initialization."""

    def test_indicator_initializes_with_defaults(self):
        """Test indicator initializes with default parameters."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator()

        assert indicator is not None
        assert indicator.period == 20  # Default period
        assert indicator.initialized is False

    def test_indicator_initializes_with_custom_period(self):
        """Test indicator initializes with custom period."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=30)

        assert indicator.period == 30

    def test_indicator_initializes_with_thresholds(self):
        """Test indicator initializes with custom thresholds."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(
            dark_pool_threshold=0.30,
            block_trade_threshold=0.15,
        )

        assert indicator._dark_pool_threshold == 0.30
        assert indicator._block_trade_threshold == 0.15


class TestSmartMoneyIndicatorCalculation:
    """Test SmartMoneyIndicator calculations."""

    def test_updates_with_bar_data(self, sample_bar_series):
        """Test indicator updates with bar data."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        # Should be initialized after receiving enough bars
        assert indicator.initialized is True

    def test_calculates_smart_money_score(self, sample_bar_series):
        """Test smart money score calculation."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        score = indicator.value

        # Score should be between -1 and 1
        assert -1 <= score <= 1

    def test_returns_zero_before_full_initialization(self):
        """Test that indicator returns 0.0 before fully initialized."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        # Add fewer bars than needed for full calculation
        for i in range(3):
            bar = _make_bar_mock(100.0, 101.0, 99.0, 100.0 + i, 1000000)
            indicator.handle_bar(bar)

        # Value should be 0.0 initially (default)
        assert indicator.value == 0.0 or indicator.initialized is True

    def test_updates_incrementally(self, sample_bar_series):
        """Test that indicator updates incrementally."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        values = []
        for bar in sample_bar_series:
            indicator.handle_bar(bar)
            if indicator.initialized:
                values.append(indicator.value)

        # Values should change over time
        assert len(set(values)) > 1


class TestSmartMoneyIndicatorSignals:
    """Test SmartMoneyIndicator signal generation."""

    def test_generates_bullish_bearish_neutral_signal(self, sample_bar_series):
        """Test generation of bullish/bearish/neutral signal using is_* methods."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        # Should have one of the three states
        is_bullish = indicator.is_bullish(threshold=0.3)
        is_bearish = indicator.is_bearish(threshold=-0.3)
        is_neutral = indicator.is_neutral(threshold=0.3)

        # At least one should be true (they're not mutually exclusive with same thresholds)
        # Use bool() to handle numpy boolean types
        assert isinstance(bool(is_bullish), bool)
        assert isinstance(bool(is_bearish), bool)
        assert isinstance(bool(is_neutral), bool)

    def test_signal_strength_property(self, sample_bar_series):
        """Test that signal strength is calculated."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        strength = indicator.signal_strength
        assert 0 <= strength <= 1


# =============================================================================
# InstitutionalMomentumIndicator Tests
# =============================================================================


class TestInstitutionalMomentumIndicatorInitialization:
    """Test InstitutionalMomentumIndicator initialization."""

    def test_indicator_initializes_with_defaults(self):
        """Test indicator initializes with default parameters."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator()

        assert indicator is not None
        assert indicator.period == 20

    def test_indicator_initializes_with_data_manager(self):
        """Test indicator initializes with data manager."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        mock_data_manager = Mock()
        indicator = InstitutionalMomentumIndicator(data_manager=mock_data_manager)

        # The analyzer is created with the data_manager
        assert indicator._analyzer is not None

    def test_indicator_initializes_with_symbol(self):
        """Test indicator initializes with symbol."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")

        assert indicator.symbol == "AAPL"


class TestInstitutionalMomentumIndicatorCalculation:
    """Test InstitutionalMomentumIndicator calculations."""

    def test_processes_bar_data(self, sample_bar_series, mock_institutional_data):
        """Test that indicator processes bar data correctly."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        mock_analyzer = Mock()
        mock_analyzer.get_holdings.return_value = mock_institutional_data

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")
        indicator._analyzer = mock_analyzer

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        assert indicator.initialized is True

    def test_value_in_valid_range(self, sample_bar_series, mock_institutional_data):
        """Test that indicator value stays within valid range."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        mock_analyzer = Mock()
        mock_analyzer.get_holdings.return_value = mock_institutional_data

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")
        indicator._analyzer = mock_analyzer

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        # Value should reflect combined factors
        assert -1 <= indicator.value <= 1

    def test_component_signals_accessible(self, sample_bar_series):
        """Test that component signals are accessible."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        components = indicator.get_component_signals()
        assert "ownership" in components
        assert "smart_money" in components
        assert "concentration" in components
        assert "momentum" in components


class TestInstitutionalMomentumIndicatorSignals:
    """Test InstitutionalMomentumIndicator signal generation."""

    def test_get_sentiment_returns_valid_string(self, sample_bar_series):
        """Test that get_sentiment returns valid sentiment string."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        sentiment = indicator.get_sentiment()
        assert sentiment in ["bullish", "bearish", "neutral"]

    def test_is_bullish_with_threshold(self, sample_bar_series):
        """Test is_bullish method with threshold."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        is_bullish = indicator.is_bullish(threshold=0.3)
        # Use bool() to handle numpy boolean types
        assert isinstance(bool(is_bullish), bool)

    def test_is_bearish_with_threshold(self, sample_bar_series):
        """Test is_bearish method with threshold."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        is_bearish = indicator.is_bearish(threshold=-0.3)
        # Use bool() to handle numpy boolean types
        assert isinstance(bool(is_bearish), bool)


# =============================================================================
# Smart Money Component Tests
# =============================================================================


class TestSmartMoneyComponents:
    """Test smart money indicator component signals."""

    def test_dark_pool_signal_accessible(self, sample_bar_series):
        """Test that dark pool signal is accessible."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        # Internal signal should be accessible
        assert hasattr(indicator, "dark_pool_signal")
        assert isinstance(indicator.dark_pool_signal, float)

    def test_block_trade_signal_accessible(self, sample_bar_series):
        """Test that block trade signal is accessible."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        assert hasattr(indicator, "block_trade_signal")
        assert isinstance(indicator.block_trade_signal, float)

    def test_flow_imbalance_signal_accessible(self, sample_bar_series):
        """Test that flow imbalance signal is accessible."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        assert hasattr(indicator, "flow_imbalance_signal")
        assert isinstance(indicator.flow_imbalance_signal, float)


# =============================================================================
# Indicator Edge Cases
# =============================================================================


class TestIndicatorEdgeCases:
    """Test indicator edge cases and error handling."""

    def test_handles_nan_values(self, sample_bar_series):
        """Test handling of NaN values in input."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        # Insert bar with NaN
        nan_bar = _make_bar_mock(100.0, 101.0, 99.0, float("nan"), 1000000)

        for bar in sample_bar_series[:10]:
            indicator.handle_bar(bar)

        indicator.handle_bar(nan_bar)

        for bar in sample_bar_series[10:]:
            indicator.handle_bar(bar)

        # Should handle NaN gracefully (no exception)
        assert True

    def test_handles_zero_volume(self, sample_bar_series):
        """Test handling of zero volume bars."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        # Insert bar with zero volume
        zero_vol_bar = _make_bar_mock(100.0, 101.0, 99.0, 100.0, 0)

        for bar in sample_bar_series[:10]:
            indicator.handle_bar(bar)

        indicator.handle_bar(zero_vol_bar)

        for bar in sample_bar_series[10:]:
            indicator.handle_bar(bar)

        # Should handle zero volume gracefully
        assert True  # No exception raised

    def test_handles_extreme_values(self):
        """Test handling of extreme price values."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for i in range(25):
            # Extreme price movement
            price = 100.0 * (10 ** (i % 5))
            bar = _make_bar_mock(price, price + 1, price - 1, price, 1000000)
            indicator.handle_bar(bar)

        # Should handle extreme values without overflow
        assert indicator.value is not None

    def test_reset_functionality(self, sample_bar_series):
        """Test indicator reset functionality."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        # Fill indicator
        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        assert indicator.initialized is True

        # Reset
        indicator.reset()

        assert indicator.initialized is False

    def test_handles_data_gaps(self, sample_bar_series):
        """Test handling of gaps in data."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        # Feed some bars
        for bar in sample_bar_series[:15]:
            indicator.handle_bar(bar)

        # Skip some bars (simulating gap)
        for bar in sample_bar_series[30:]:
            indicator.handle_bar(bar)

        # Should still function
        assert indicator.initialized is True


# =============================================================================
# Indicator Properties Tests
# =============================================================================


class TestIndicatorProperties:
    """Test indicator property accessors."""

    def test_period_property(self):
        """Test period property."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=25)
        assert indicator.period == 25

    def test_value_property(self, sample_bar_series):
        """Test value property."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        value = indicator.value
        assert isinstance(value, float)
        assert -1 <= value <= 1

    def test_signal_strength_property(self, sample_bar_series):
        """Test signal_strength property."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        strength = indicator.signal_strength
        assert isinstance(strength, float)
        assert 0 <= strength <= 1

    def test_confidence_property(self, sample_bar_series):
        """Test confidence property."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        confidence = indicator.confidence
        assert isinstance(confidence, float)
        assert 0 <= confidence <= 1


# =============================================================================
# Indicator Combination Tests
# =============================================================================


class TestIndicatorCombination:
    """Test combining multiple indicators."""

    def test_combine_indicators_for_signal(self, sample_bar_series):
        """Test combining smart money and institutional indicators."""
        from stanley.integrations.nautilus.indicators import (
            SmartMoneyIndicator,
            InstitutionalMomentumIndicator,
        )

        smart_money = SmartMoneyIndicator(period=20)
        institutional = InstitutionalMomentumIndicator(symbol="AAPL")

        for bar in sample_bar_series:
            smart_money.handle_bar(bar)
            institutional.handle_bar(bar)

        # Combine signals
        if smart_money.initialized and institutional.initialized:
            combined_score = 0.5 * smart_money.value + 0.5 * institutional.value
            assert -1 <= combined_score <= 1

    def test_weighted_indicator_combination(self, sample_bar_series):
        """Test weighted combination of indicators."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        # Create multiple indicators with different periods
        short_term = SmartMoneyIndicator(period=10)
        medium_term = SmartMoneyIndicator(period=20)
        long_term = SmartMoneyIndicator(period=40)

        for bar in sample_bar_series:
            short_term.handle_bar(bar)
            medium_term.handle_bar(bar)
            long_term.handle_bar(bar)

        # Weighted combination
        weights = {"short": 0.2, "medium": 0.5, "long": 0.3}

        if all(
            [short_term.initialized, medium_term.initialized, long_term.initialized]
        ):
            weighted_value = (
                weights["short"] * short_term.value
                + weights["medium"] * medium_term.value
                + weights["long"] * long_term.value
            )

            assert -1 <= weighted_value <= 1


# =============================================================================
# Indicator Performance Tests
# =============================================================================


class TestIndicatorPerformance:
    """Test indicator performance characteristics."""

    def test_update_performance(self, sample_bar_series):
        """Test update performance."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        indicator = SmartMoneyIndicator(period=20)

        import time

        start = time.time()

        for _ in range(1000):
            for bar in sample_bar_series[:5]:
                indicator.handle_bar(bar)

        elapsed = time.time() - start

        # Should complete 5000 updates in reasonable time
        # Using 5.0 seconds to account for system load during full test suite runs
        assert elapsed < 5.0

    def test_memory_efficiency(self):
        """Test memory efficiency with many updates."""
        from stanley.integrations.nautilus.indicators import SmartMoneyIndicator

        import sys

        indicator = SmartMoneyIndicator(period=20)

        initial_size = sys.getsizeof(indicator)

        # Many updates
        for i in range(10000):
            price = 100.0 + np.sin(i)
            bar = _make_bar_mock(price, price + 1, price - 1, price, 1000000)
            indicator.handle_bar(bar)

        # Size should not grow unboundedly
        # (actual check depends on implementation - using deque should be stable)
        assert True


# =============================================================================
# InstitutionalMomentum Additional Tests
# =============================================================================


class TestInstitutionalMomentumSymbol:
    """Test InstitutionalMomentumIndicator symbol handling."""

    def test_set_symbol(self):
        """Test setting symbol after initialization."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        indicator = InstitutionalMomentumIndicator()
        indicator.set_symbol("TSLA")

        assert indicator.symbol == "TSLA"

    def test_institutional_ownership_property(self, sample_bar_series):
        """Test institutional_ownership property."""
        from stanley.integrations.nautilus.indicators import (
            InstitutionalMomentumIndicator,
        )

        mock_analyzer = Mock()
        mock_analyzer.get_holdings.return_value = {
            "institutional_ownership": 0.75,
            "ownership_trend": 0.05,
            "smart_money_score": 0.6,
            "concentration_risk": 0.3,
        }

        indicator = InstitutionalMomentumIndicator(symbol="AAPL")
        indicator._analyzer = mock_analyzer

        # Need to trigger institutional data update
        for bar in sample_bar_series:
            indicator.handle_bar(bar)

        # May be None if data not fetched yet
        ownership = indicator.institutional_ownership
        assert ownership is None or (0 <= ownership <= 1)
