"""
Tests for OptionsFlowAnalyzer module.

Tests options flow analysis, unusual activity detection,
put/call ratio calculation, and options sentiment aggregation.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock

from stanley.analytics.options_flow import OptionsFlowAnalyzer

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_data_manager():
    """Mock DataManager for options flow."""
    mock = Mock()
    mock.get_options_flow = AsyncMock(return_value=pd.DataFrame())
    mock.get_stock_data = AsyncMock(return_value=pd.DataFrame())
    return mock


@pytest.fixture
def sample_options_flow_data():
    """Sample options flow data matching the analyzer's expected format."""
    np.random.seed(42)
    base_price = 150.0
    strikes = [base_price * (0.9 + i * 0.05) for i in range(5)]

    data = []
    for _ in range(50):
        strike = np.random.choice(strikes)
        option_type = np.random.choice(["call", "put"])
        exp_date = datetime.now() + timedelta(days=np.random.randint(7, 120))

        data.append(
            {
                "contract_symbol": f"AAPL{exp_date.strftime('%y%m%d')}{option_type[0].upper()}{int(strike*1000):08d}",
                "option_type": option_type,
                "strike": strike,
                "expiration": exp_date,
                "volume": np.random.randint(100, 5000),
                "open_interest": np.random.randint(1000, 50000),
                "premium": np.random.uniform(10000, 500000),
                "days_to_expiry": (exp_date - datetime.now()).days,
                "trade_type": np.random.choice(["buy", "sell"]),
                "num_exchanges": np.random.randint(1, 5),
                "timestamp": datetime.now() - timedelta(hours=np.random.randint(0, 72)),
            }
        )

    return pd.DataFrame(data)


# =============================================================================
# Initialization Tests
# =============================================================================


class TestOptionsFlowAnalyzerInit:
    """Tests for OptionsFlowAnalyzer initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data_manager."""
        analyzer = OptionsFlowAnalyzer()
        assert analyzer is not None
        assert analyzer.data_manager is None

    def test_init_with_data_manager(self, mock_data_manager):
        """Test initialization with mock data_manager."""
        analyzer = OptionsFlowAnalyzer(data_manager=mock_data_manager)
        assert analyzer.data_manager is mock_data_manager


# =============================================================================
# Unusual Activity Detection Tests
# =============================================================================


class TestUnusualActivityDetection:
    """Tests for unusual activity detection."""

    @pytest.mark.asyncio
    async def test_get_unusual_activity_returns_dict(self):
        """Test that get_unusual_activity returns a TypedDict with expected keys."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_unusual_activity("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "date" in result
        assert "volume_ratio" in result
        assert "avg_volume_20d" in result
        assert "current_volume" in result
        assert "call_volume" in result
        assert "put_volume" in result
        assert "unusual_contracts" in result
        assert "signal" in result
        assert "confidence" in result

    @pytest.mark.asyncio
    async def test_unusual_activity_symbol_matches(self):
        """Test that returned symbol matches input."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_unusual_activity("AAPL")
        assert result["symbol"] == "AAPL"

    @pytest.mark.asyncio
    async def test_unusual_activity_signal_valid(self):
        """Test that signal is one of valid values."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_unusual_activity("AAPL")
        valid_signals = ["bullish", "bearish", "neutral"]
        assert result["signal"] in valid_signals

    @pytest.mark.asyncio
    async def test_unusual_activity_confidence_bounded(self):
        """Test that confidence is in [0, 1] range."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_unusual_activity("AAPL")
        assert 0.0 <= result["confidence"] <= 1.0

    @pytest.mark.asyncio
    async def test_unusual_activity_volumes_non_negative(self):
        """Test that volumes are non-negative."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_unusual_activity("AAPL")
        assert result["call_volume"] >= 0
        assert result["put_volume"] >= 0
        assert result["current_volume"] >= 0

    @pytest.mark.asyncio
    async def test_unusual_activity_lookback_parameter(self):
        """Test lookback_days parameter works."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_unusual_activity("AAPL", lookback_days=10)
        assert isinstance(result, dict)


# =============================================================================
# Put/Call Ratio Tests
# =============================================================================


class TestPutCallRatio:
    """Tests for put/call ratio analysis."""

    @pytest.mark.asyncio
    async def test_analyze_put_call_ratio_returns_dict(self):
        """Test that analyze_put_call_ratio returns a TypedDict."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_put_call_ratio("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "volume_pc_ratio" in result
        assert "oi_pc_ratio" in result
        assert "interpretation" in result
        assert "historical_percentile" in result
        assert "signal" in result

    @pytest.mark.asyncio
    async def test_put_call_ratio_symbol_matches(self):
        """Test that returned symbol matches input."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_put_call_ratio("MSFT")
        assert result["symbol"] == "MSFT"

    @pytest.mark.asyncio
    async def test_put_call_ratio_non_negative(self):
        """Test that ratios are non-negative."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_put_call_ratio("AAPL")
        assert result["volume_pc_ratio"] >= 0
        assert result["oi_pc_ratio"] >= 0

    @pytest.mark.asyncio
    async def test_historical_percentile_bounded(self):
        """Test that historical_percentile is in valid range."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_put_call_ratio("AAPL")
        assert 0 <= result["historical_percentile"] <= 100

    @pytest.mark.asyncio
    async def test_put_call_signal_valid(self):
        """Test that signal is one of valid values."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_put_call_ratio("AAPL")
        valid_signals = [
            "bullish",
            "bearish",
            "neutral",
            "moderately_bullish",
            "moderately_bearish",
        ]
        assert result["signal"] in valid_signals


# =============================================================================
# Large Trades Tests
# =============================================================================


class TestLargeTrades:
    """Tests for large trades detection."""

    @pytest.mark.asyncio
    async def test_get_large_trades_returns_dict(self):
        """Test that get_large_trades returns a TypedDict."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_large_trades("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "large_trades" in result
        assert "total_call_premium" in result
        assert "total_put_premium" in result
        assert "largest_trade" in result
        assert "smart_money_direction" in result

    @pytest.mark.asyncio
    async def test_large_trades_symbol_matches(self):
        """Test that returned symbol matches input."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_large_trades("GOOGL")
        assert result["symbol"] == "GOOGL"

    @pytest.mark.asyncio
    async def test_large_trades_premiums_non_negative(self):
        """Test that premiums are non-negative."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_large_trades("AAPL")
        assert result["total_call_premium"] >= 0
        assert result["total_put_premium"] >= 0

    @pytest.mark.asyncio
    async def test_smart_money_direction_valid(self):
        """Test that smart_money_direction is valid."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_large_trades("AAPL")
        valid_directions = ["bullish", "bearish", "mixed", "neutral"]
        assert result["smart_money_direction"] in valid_directions

    @pytest.mark.asyncio
    async def test_large_trades_min_premium_parameter(self):
        """Test min_premium parameter works."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_large_trades("AAPL", min_premium=500000)
        assert isinstance(result, dict)


# =============================================================================
# Sweep Orders Tests
# =============================================================================


class TestSweepOrders:
    """Tests for sweep order detection."""

    @pytest.mark.asyncio
    async def test_detect_sweep_orders_returns_dict(self):
        """Test that detect_sweep_orders returns a TypedDict."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_sweep_orders("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "sweeps" in result
        assert "bullish_sweep_count" in result
        assert "bearish_sweep_count" in result
        assert "total_bullish_premium" in result
        assert "total_bearish_premium" in result
        assert "net_sweep_sentiment" in result

    @pytest.mark.asyncio
    async def test_sweep_counts_non_negative(self):
        """Test that sweep counts are non-negative."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_sweep_orders("AAPL")
        assert result["bullish_sweep_count"] >= 0
        assert result["bearish_sweep_count"] >= 0

    @pytest.mark.asyncio
    async def test_net_sweep_sentiment_valid(self):
        """Test that net_sweep_sentiment is valid."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_sweep_orders("AAPL")
        valid_sentiments = ["bullish", "bearish", "neutral"]
        assert result["net_sweep_sentiment"] in valid_sentiments


# =============================================================================
# Gamma Exposure Tests
# =============================================================================


class TestGammaExposure:
    """Tests for gamma exposure analysis."""

    @pytest.mark.asyncio
    async def test_analyze_gamma_exposure_returns_dict(self):
        """Test that analyze_gamma_exposure returns a TypedDict."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_gamma_exposure("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "net_gamma" in result
        assert "call_gamma" in result
        assert "put_gamma" in result
        assert "gamma_flip_price" in result
        assert "max_pain" in result
        assert "gamma_exposure_by_strike" in result

    @pytest.mark.asyncio
    async def test_gamma_exposure_symbol_matches(self):
        """Test that returned symbol matches input."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_gamma_exposure("NVDA")
        assert result["symbol"] == "NVDA"

    @pytest.mark.asyncio
    async def test_gamma_exposure_dataframe_in_result(self):
        """Test that gamma_exposure_by_strike is a DataFrame."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.analyze_gamma_exposure("AAPL")
        assert isinstance(result["gamma_exposure_by_strike"], pd.DataFrame)


# =============================================================================
# Options Sentiment Tests
# =============================================================================


class TestOptionsSentiment:
    """Tests for options sentiment aggregation."""

    @pytest.mark.asyncio
    async def test_get_options_sentiment_returns_dict(self):
        """Test that get_options_sentiment returns a TypedDict."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_options_sentiment("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "overall_sentiment" in result
        assert "sentiment_score" in result
        assert "components" in result
        assert "confidence" in result

    @pytest.mark.asyncio
    async def test_overall_sentiment_valid(self):
        """Test that overall_sentiment is valid."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_options_sentiment("AAPL")
        valid_sentiments = ["bullish", "bearish", "neutral"]
        assert result["overall_sentiment"] in valid_sentiments

    @pytest.mark.asyncio
    async def test_sentiment_score_bounded(self):
        """Test that sentiment_score is bounded."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_options_sentiment("AAPL")
        # Sentiment score should be between -1 and 1
        assert -1 <= result["sentiment_score"] <= 1

    @pytest.mark.asyncio
    async def test_sentiment_confidence_bounded(self):
        """Test that confidence is in [0, 1] range."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_options_sentiment("AAPL")
        assert 0.0 <= result["confidence"] <= 1.0

    @pytest.mark.asyncio
    async def test_components_is_dict(self):
        """Test that components is a dictionary."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.get_options_sentiment("AAPL")
        assert isinstance(result["components"], dict)


# =============================================================================
# Smart Money Detection Tests
# =============================================================================


class TestSmartMoneyDetection:
    """Tests for smart money detection."""

    @pytest.mark.asyncio
    async def test_detect_smart_money_options_returns_dict(self):
        """Test that detect_smart_money_options returns a TypedDict."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_smart_money_options("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "smart_money_signals" in result
        assert "institutional_bias" in result
        assert "conviction_score" in result
        assert "key_levels" in result

    @pytest.mark.asyncio
    async def test_institutional_bias_valid(self):
        """Test that institutional_bias is valid."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_smart_money_options("AAPL")
        valid_biases = ["bullish", "bearish", "neutral"]
        assert result["institutional_bias"] in valid_biases

    @pytest.mark.asyncio
    async def test_conviction_score_bounded(self):
        """Test that conviction_score is in [0, 1] range."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_smart_money_options("AAPL")
        assert 0.0 <= result["conviction_score"] <= 1.0

    @pytest.mark.asyncio
    async def test_key_levels_is_list(self):
        """Test that key_levels is a list."""
        analyzer = OptionsFlowAnalyzer()
        result = await analyzer.detect_smart_money_options("AAPL")
        assert isinstance(result["key_levels"], list)


# =============================================================================
# Health Check Tests
# =============================================================================


class TestOptionsFlowHealthCheck:
    """Tests for health_check method."""

    def test_health_check_returns_true(self):
        """Test that health_check returns True."""
        analyzer = OptionsFlowAnalyzer()
        assert analyzer.health_check() is True


# =============================================================================
# Edge Cases Tests
# =============================================================================


class TestOptionsFlowEdgeCases:
    """Edge case tests for OptionsFlowAnalyzer."""

    @pytest.mark.asyncio
    async def test_handles_various_symbols(self):
        """Test with various symbol formats."""
        analyzer = OptionsFlowAnalyzer()

        # Test various symbols
        for symbol in ["AAPL", "MSFT", "GOOGL", "TSLA", "SPY"]:
            result = await analyzer.get_unusual_activity(symbol)
            assert result["symbol"] == symbol

    @pytest.mark.asyncio
    async def test_concurrent_calls(self):
        """Test multiple concurrent calls."""
        import asyncio

        analyzer = OptionsFlowAnalyzer()

        tasks = [
            analyzer.get_unusual_activity("AAPL"),
            analyzer.analyze_put_call_ratio("AAPL"),
            analyzer.get_large_trades("AAPL"),
        ]

        results = await asyncio.gather(*tasks)
        assert len(results) == 3
        assert all(isinstance(r, dict) for r in results)

    @pytest.mark.asyncio
    async def test_empty_data_handling(self, mock_data_manager):
        """Test handling of empty data from data_manager."""
        mock_data_manager.get_options_flow.return_value = pd.DataFrame()

        analyzer = OptionsFlowAnalyzer(data_manager=mock_data_manager)
        result = await analyzer.get_unusual_activity("AAPL")

        # Should return valid result even with empty data
        assert isinstance(result, dict)
        assert result["signal"] == "neutral"

    @pytest.mark.asyncio
    async def test_data_manager_exception_handling(self, mock_data_manager):
        """Test handling of data_manager exceptions."""
        mock_data_manager.get_options_flow.side_effect = Exception("API Error")

        analyzer = OptionsFlowAnalyzer(data_manager=mock_data_manager)

        # Should fall back to mock data and not raise
        result = await analyzer.get_unusual_activity("AAPL")
        assert isinstance(result, dict)
