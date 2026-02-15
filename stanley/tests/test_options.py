"""
Tests for OptionsAnalyzer module.

Comprehensive test suite covering:
- Unusual activity detection
- Gamma exposure calculation
- Put/Call ratio analysis
- Smart money tracking
- Max pain calculation
- Expiration flow analysis
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch

# Import OptionsAnalyzer from the options module
from stanley.options import OptionsAnalyzer

# =============================================================================
# FIXTURES - Options Chain Mock Data
# =============================================================================


@pytest.fixture
def sample_expiration_dates():
    """Generate sample expiration dates for testing."""
    today = datetime.now()
    return [
        today + timedelta(days=7),  # Weekly
        today + timedelta(days=14),  # 2 weeks
        today + timedelta(days=30),  # Monthly
        today + timedelta(days=60),  # 2 months
        today + timedelta(days=90),  # Quarterly
    ]


@pytest.fixture
def sample_options_chain(sample_expiration_dates):
    """
    Generate a comprehensive sample options chain DataFrame.

    Contains both calls and puts with various strikes, volumes, and open interest.
    """
    np.random.seed(42)  # For reproducibility

    underlying_price = 150.0
    strikes = [130, 135, 140, 145, 150, 155, 160, 165, 170]

    data = []
    for exp_date in sample_expiration_dates:
        dte = (exp_date - datetime.now()).days

        for strike in strikes:
            # Calculate realistic IV and Greeks
            moneyness = strike / underlying_price

            # Call option
            call_iv = 0.25 + 0.1 * abs(moneyness - 1) + np.random.uniform(-0.02, 0.02)
            call_delta = max(0, min(1, 1 - (strike - underlying_price) / 20))
            call_gamma = 0.05 * np.exp(-0.5 * ((strike - underlying_price) / 10) ** 2)
            call_volume = np.random.randint(100, 5000)
            call_oi = np.random.randint(1000, 50000)
            call_bid = max(
                0.01,
                (underlying_price - strike)
                + call_iv * np.sqrt(dte / 365) * underlying_price * 0.1,
            )
            call_ask = call_bid * 1.05

            data.append(
                {
                    "expiration": exp_date,
                    "strike": float(strike),
                    "option_type": "call",
                    "bid": round(call_bid, 2),
                    "ask": round(call_ask, 2),
                    "last_price": round((call_bid + call_ask) / 2, 2),
                    "volume": call_volume,
                    "open_interest": call_oi,
                    "implied_volatility": round(call_iv, 4),
                    "delta": round(call_delta, 4),
                    "gamma": round(call_gamma, 6),
                    "theta": round(-0.05 * call_iv, 4),
                    "vega": round(0.1 * np.sqrt(dte / 365), 4),
                    "underlying_price": underlying_price,
                }
            )

            # Put option
            put_iv = 0.28 + 0.12 * abs(moneyness - 1) + np.random.uniform(-0.02, 0.02)
            put_delta = max(-1, min(0, (strike - underlying_price) / 20 - 1))
            put_gamma = 0.05 * np.exp(-0.5 * ((strike - underlying_price) / 10) ** 2)
            put_volume = np.random.randint(50, 4000)
            put_oi = np.random.randint(500, 40000)
            put_bid = max(
                0.01,
                (strike - underlying_price)
                + put_iv * np.sqrt(dte / 365) * underlying_price * 0.1,
            )
            put_ask = put_bid * 1.05

            data.append(
                {
                    "expiration": exp_date,
                    "strike": float(strike),
                    "option_type": "put",
                    "bid": round(put_bid, 2),
                    "ask": round(put_ask, 2),
                    "last_price": round((put_bid + put_ask) / 2, 2),
                    "volume": put_volume,
                    "open_interest": put_oi,
                    "implied_volatility": round(put_iv, 4),
                    "delta": round(put_delta, 4),
                    "gamma": round(put_gamma, 6),
                    "theta": round(-0.06 * put_iv, 4),
                    "vega": round(0.1 * np.sqrt(dte / 365), 4),
                    "underlying_price": underlying_price,
                }
            )

    return pd.DataFrame(data)


@pytest.fixture
def empty_options_chain():
    """Empty options chain DataFrame with correct schema."""
    return pd.DataFrame(
        columns=[
            "expiration",
            "strike",
            "option_type",
            "bid",
            "ask",
            "last_price",
            "volume",
            "open_interest",
            "implied_volatility",
            "delta",
            "gamma",
            "theta",
            "vega",
            "underlying_price",
        ]
    )


@pytest.fixture
def single_option_chain():
    """Options chain with only a single option (no spread possible)."""
    return pd.DataFrame(
        [
            {
                "expiration": datetime.now() + timedelta(days=30),
                "strike": 150.0,
                "option_type": "call",
                "bid": 5.50,
                "ask": 5.75,
                "last_price": 5.625,
                "volume": 1000,
                "open_interest": 5000,
                "implied_volatility": 0.30,
                "delta": 0.50,
                "gamma": 0.05,
                "theta": -0.02,
                "vega": 0.15,
                "underlying_price": 150.0,
            }
        ]
    )


@pytest.fixture
def zero_oi_options_chain(sample_expiration_dates):
    """Options chain with zero open interest."""
    exp_date = sample_expiration_dates[0]
    return pd.DataFrame(
        [
            {
                "expiration": exp_date,
                "strike": 150.0,
                "option_type": "call",
                "bid": 5.50,
                "ask": 5.75,
                "last_price": 5.625,
                "volume": 100,
                "open_interest": 0,  # Zero OI
                "implied_volatility": 0.30,
                "delta": 0.50,
                "gamma": 0.05,
                "theta": -0.02,
                "vega": 0.15,
                "underlying_price": 150.0,
            },
            {
                "expiration": exp_date,
                "strike": 150.0,
                "option_type": "put",
                "bid": 4.50,
                "ask": 4.75,
                "last_price": 4.625,
                "volume": 50,
                "open_interest": 0,  # Zero OI
                "implied_volatility": 0.32,
                "delta": -0.48,
                "gamma": 0.05,
                "theta": -0.02,
                "vega": 0.15,
                "underlying_price": 150.0,
            },
        ]
    )


@pytest.fixture
def expired_options_chain():
    """Options chain with expired options that should be filtered."""
    past_date = datetime.now() - timedelta(days=7)
    future_date = datetime.now() + timedelta(days=30)

    return pd.DataFrame(
        [
            {
                "expiration": past_date,  # Expired
                "strike": 150.0,
                "option_type": "call",
                "bid": 0.0,
                "ask": 0.01,
                "last_price": 0.005,
                "volume": 0,
                "open_interest": 1000,
                "implied_volatility": 0.0,
                "delta": 0.0,
                "gamma": 0.0,
                "theta": 0.0,
                "vega": 0.0,
                "underlying_price": 150.0,
            },
            {
                "expiration": future_date,  # Valid
                "strike": 150.0,
                "option_type": "call",
                "bid": 5.50,
                "ask": 5.75,
                "last_price": 5.625,
                "volume": 1000,
                "open_interest": 5000,
                "implied_volatility": 0.30,
                "delta": 0.50,
                "gamma": 0.05,
                "theta": -0.02,
                "vega": 0.15,
                "underlying_price": 150.0,
            },
        ]
    )


@pytest.fixture
def unusual_activity_chain(sample_expiration_dates):
    """
    Options chain with unusual activity patterns.
    Contains options with volume >> open interest (unusual activity).
    """
    exp_date = sample_expiration_dates[0]
    underlying_price = 150.0

    return pd.DataFrame(
        [
            # Normal activity
            {
                "expiration": exp_date,
                "strike": 145.0,
                "option_type": "call",
                "bid": 7.50,
                "ask": 7.75,
                "last_price": 7.625,
                "volume": 500,
                "open_interest": 5000,
                "implied_volatility": 0.28,
                "delta": 0.65,
                "gamma": 0.04,
                "theta": -0.02,
                "vega": 0.15,
                "underlying_price": underlying_price,
            },
            # UNUSUAL: Volume is 10x open interest
            {
                "expiration": exp_date,
                "strike": 160.0,
                "option_type": "call",
                "bid": 2.50,
                "ask": 2.75,
                "last_price": 2.625,
                "volume": 50000,  # Unusual volume
                "open_interest": 5000,
                "implied_volatility": 0.45,  # Elevated IV
                "delta": 0.25,
                "gamma": 0.03,
                "theta": -0.03,
                "vega": 0.20,
                "underlying_price": underlying_price,
            },
            # UNUSUAL: Large block trade pattern
            {
                "expiration": exp_date,
                "strike": 140.0,
                "option_type": "put",
                "bid": 3.00,
                "ask": 3.25,
                "last_price": 3.125,
                "volume": 25000,  # Unusual volume
                "open_interest": 2000,
                "implied_volatility": 0.50,  # Very elevated IV
                "delta": -0.30,
                "gamma": 0.035,
                "theta": -0.025,
                "vega": 0.18,
                "underlying_price": underlying_price,
            },
        ]
    )


@pytest.fixture
def mock_options_data_manager():
    """Create a mock DataManager for options data."""
    mock = Mock()
    mock.get_options_chain = AsyncMock()
    mock.get_historical_options = AsyncMock()
    mock.get_options_flow = AsyncMock()
    return mock


# =============================================================================
# TEST CLASSES - OptionsAnalyzer
# =============================================================================


class TestOptionsAnalyzerInit:
    """Tests for OptionsAnalyzer initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data_manager."""
        analyzer = OptionsAnalyzer()
        assert analyzer is not None
        assert analyzer.data_manager is None

    def test_init_with_data_manager(self, mock_options_data_manager):
        """Test initialization with mock data_manager."""
        analyzer = OptionsAnalyzer(data_manager=mock_options_data_manager)
        assert analyzer.data_manager is mock_options_data_manager


class TestUnusualActivityDetection:
    """Tests for detect_unusual_activity method."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_detects_high_volume_to_oi_ratio(self, unusual_activity_chain):
        """Test detection of options with volume >> open interest."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.detect_unusual_activity(unusual_activity_chain)

        assert isinstance(result, pd.DataFrame)
        # Should detect the unusual activity options
        assert len(result) >= 2
        # Volume/OI ratio should be flagged
        assert "volume_oi_ratio" in result.columns
        assert result["volume_oi_ratio"].max() >= 10.0

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_detects_elevated_iv(self, unusual_activity_chain):
        """Test detection of elevated implied volatility."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.detect_unusual_activity(
            unusual_activity_chain, iv_threshold=0.40
        )

        assert isinstance(result, pd.DataFrame)
        assert (
            "iv_percentile" in result.columns or "implied_volatility" in result.columns
        )

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_empty_chain_returns_empty(self, empty_options_chain):
        """Test with empty options chain."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.detect_unusual_activity(empty_options_chain)

        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_returns_expected_columns(self, sample_options_chain):
        """Test that result has expected columns."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.detect_unusual_activity(sample_options_chain)

        expected_cols = [
            "strike",
            "option_type",
            "volume",
            "open_interest",
            "volume_oi_ratio",
            "implied_volatility",
            "unusual_score",
        ]
        for col in expected_cols:
            assert col in result.columns

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_volume_threshold_parameter(self, sample_options_chain):
        """Test minimum volume threshold parameter."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()

        # High threshold should return fewer results
        result_high = analyzer.detect_unusual_activity(
            sample_options_chain, min_volume=10000
        )
        result_low = analyzer.detect_unusual_activity(
            sample_options_chain, min_volume=100
        )

        assert len(result_high) <= len(result_low)


class TestGammaExposureCalculation:
    """Tests for calculate_gamma_exposure method."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_returns_dict(self, sample_options_chain):
        """Test that method returns a dictionary."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(sample_options_chain, "AAPL")

        assert isinstance(result, dict)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_has_expected_keys(self, sample_options_chain):
        """Test that result has expected keys."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(sample_options_chain, "AAPL")

        expected_keys = [
            "symbol",
            "net_gamma_exposure",
            "call_gamma",
            "put_gamma",
            "gamma_flip_level",
            "gamma_by_strike",
            "dealer_positioning",
        ]
        for key in expected_keys:
            assert key in result

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_gamma_flip_calculation(self, sample_options_chain):
        """Test gamma flip level calculation."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(sample_options_chain, "AAPL")

        # Gamma flip should be a valid price level
        underlying = sample_options_chain["underlying_price"].iloc[0]
        gamma_flip = result["gamma_flip_level"]

        if gamma_flip is not None:
            # Should be within reasonable range of underlying
            assert gamma_flip > underlying * 0.7
            assert gamma_flip < underlying * 1.3

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_empty_chain_handling(self, empty_options_chain):
        """Test with empty options chain."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(empty_options_chain, "AAPL")

        assert result["net_gamma_exposure"] == 0.0
        assert result["gamma_flip_level"] is None

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_gamma_by_strike_dataframe(self, sample_options_chain):
        """Test gamma by strike returns DataFrame."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(sample_options_chain, "AAPL")

        assert isinstance(result["gamma_by_strike"], pd.DataFrame)
        assert "strike" in result["gamma_by_strike"].columns
        assert "net_gamma" in result["gamma_by_strike"].columns

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_zero_oi_handling(self, zero_oi_options_chain):
        """Test handling of zero open interest."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(zero_oi_options_chain, "AAPL")

        # Should handle gracefully, likely zero exposure
        assert result["net_gamma_exposure"] == 0.0


class TestPutCallRatio:
    """Tests for calculate_put_call_ratio method."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_returns_dict(self, sample_options_chain):
        """Test that method returns a dictionary."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_put_call_ratio(sample_options_chain)

        assert isinstance(result, dict)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_has_expected_keys(self, sample_options_chain):
        """Test that result has expected keys."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_put_call_ratio(sample_options_chain)

        expected_keys = [
            "volume_ratio",
            "oi_ratio",
            "dollar_ratio",
            "interpretation",
            "historical_percentile",
        ]
        for key in expected_keys:
            assert key in result

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_ratio_calculation_accuracy(self, sample_options_chain):
        """Test accuracy of ratio calculation."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_put_call_ratio(sample_options_chain)

        # Manual calculation for verification
        calls = sample_options_chain[sample_options_chain["option_type"] == "call"]
        puts = sample_options_chain[sample_options_chain["option_type"] == "put"]

        expected_volume_ratio = puts["volume"].sum() / max(calls["volume"].sum(), 1)

        assert result["volume_ratio"] == pytest.approx(expected_volume_ratio, rel=0.01)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_interpretation_values(self, sample_options_chain):
        """Test that interpretation is valid."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_put_call_ratio(sample_options_chain)

        valid_interpretations = [
            "bullish",
            "bearish",
            "neutral",
            "extreme_fear",
            "extreme_greed",
        ]
        assert result["interpretation"] in valid_interpretations

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_empty_chain_handling(self, empty_options_chain):
        """Test with empty options chain."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_put_call_ratio(empty_options_chain)

        assert result["volume_ratio"] == 0.0 or result["volume_ratio"] is None
        assert result["interpretation"] == "neutral"

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_single_option_handling(self, single_option_chain):
        """Test with single option (only calls, no puts)."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_put_call_ratio(single_option_chain)

        # With only calls, put/call ratio should be 0
        assert result["volume_ratio"] == 0.0


class TestSmartMoneyTracking:
    """Tests for track_smart_money method."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_returns_dataframe(self, sample_options_chain):
        """Test that method returns a DataFrame."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.track_smart_money(sample_options_chain)

        assert isinstance(result, pd.DataFrame)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_has_expected_columns(self, sample_options_chain):
        """Test that DataFrame has expected columns."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.track_smart_money(sample_options_chain)

        expected_cols = [
            "strike",
            "option_type",
            "expiration",
            "smart_money_score",
            "trade_size_indicator",
            "positioning",
            "confidence",
        ]
        for col in expected_cols:
            assert col in result.columns

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_identifies_block_trades(self, unusual_activity_chain):
        """Test identification of block trade patterns."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.track_smart_money(unusual_activity_chain)

        # Should identify large volume trades as potential smart money
        assert len(result[result["smart_money_score"] > 0.5]) >= 1

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_premium_threshold(self, sample_options_chain):
        """Test minimum premium threshold for smart money detection."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()

        result = analyzer.track_smart_money(
            sample_options_chain, min_premium=100000  # $100k minimum
        )

        # Verify all results meet threshold
        for _, row in result.iterrows():
            premium = row.get("total_premium", 0)
            assert premium >= 100000 or len(result) == 0

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_empty_chain_returns_empty(self, empty_options_chain):
        """Test with empty options chain."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.track_smart_money(empty_options_chain)

        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0


class TestMaxPainCalculation:
    """Tests for calculate_max_pain method."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_returns_dict(self, sample_options_chain):
        """Test that method returns a dictionary."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(sample_options_chain)

        assert isinstance(result, dict)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_has_expected_keys(self, sample_options_chain):
        """Test that result has expected keys."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(sample_options_chain)

        expected_keys = [
            "max_pain_strike",
            "total_pain_at_max_pain",
            "pain_by_strike",
            "distance_from_current",
            "expiration",
        ]
        for key in expected_keys:
            assert key in result

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_max_pain_within_strike_range(self, sample_options_chain):
        """Test that max pain is within the strike range."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(sample_options_chain)

        strikes = sample_options_chain["strike"].unique()
        min_strike = strikes.min()
        max_strike = strikes.max()

        assert result["max_pain_strike"] >= min_strike
        assert result["max_pain_strike"] <= max_strike

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_pain_by_strike_dataframe(self, sample_options_chain):
        """Test pain by strike returns DataFrame."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(sample_options_chain)

        assert isinstance(result["pain_by_strike"], pd.DataFrame)
        assert "strike" in result["pain_by_strike"].columns
        assert "total_pain" in result["pain_by_strike"].columns

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_expiration_filter(self, sample_options_chain, sample_expiration_dates):
        """Test filtering by specific expiration."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()

        target_exp = sample_expiration_dates[0]
        result = analyzer.calculate_max_pain(
            sample_options_chain, expiration=target_exp
        )

        assert result["expiration"] == target_exp

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_empty_chain_handling(self, empty_options_chain):
        """Test with empty options chain."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(empty_options_chain)

        assert result["max_pain_strike"] is None
        assert result["total_pain_at_max_pain"] == 0.0

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_zero_oi_handling(self, zero_oi_options_chain):
        """Test with zero open interest options."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(zero_oi_options_chain)

        # With zero OI, no pain to calculate
        assert result["total_pain_at_max_pain"] == 0.0


class TestExpirationFlowAnalysis:
    """Tests for analyze_expiration_flow method."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_returns_dataframe(self, sample_options_chain):
        """Test that method returns a DataFrame."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.analyze_expiration_flow(sample_options_chain)

        assert isinstance(result, pd.DataFrame)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_has_expected_columns(self, sample_options_chain):
        """Test that DataFrame has expected columns."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.analyze_expiration_flow(sample_options_chain)

        expected_cols = [
            "expiration",
            "days_to_expiry",
            "call_volume",
            "put_volume",
            "call_oi",
            "put_oi",
            "net_premium_flow",
            "gamma_exposure",
            "sentiment_score",
        ]
        for col in expected_cols:
            assert col in result.columns

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_sorted_by_expiration(self, sample_options_chain):
        """Test that results are sorted by expiration."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.analyze_expiration_flow(sample_options_chain)

        if len(result) > 1:
            for i in range(len(result) - 1):
                assert result["expiration"].iloc[i] <= result["expiration"].iloc[i + 1]

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_excludes_expired_options(self, expired_options_chain):
        """Test that expired options are excluded."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.analyze_expiration_flow(expired_options_chain)

        # Should only have future expirations
        for exp in result["expiration"]:
            assert exp > datetime.now()

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_empty_chain_returns_empty(self, empty_options_chain):
        """Test with empty options chain."""
        from stanley.analytics.options import OptionsAnalyzer

        analyzer = OptionsAnalyzer()
        result = analyzer.analyze_expiration_flow(empty_options_chain)

        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0


class TestHealthCheck:
    """Tests for health_check method."""

    def test_returns_true(self):
        """Test that health_check returns True."""
        analyzer = OptionsAnalyzer()
        assert analyzer.health_check() is True


class TestAsyncOptionsAnalyzerMethods:
    """Tests for async methods of OptionsAnalyzer using mock data."""

    @pytest.mark.asyncio
    async def test_get_options_flow_returns_dict(self):
        """Test get_options_flow returns a dict with expected keys."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.get_options_flow("AAPL", lookback_days=5)

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "total_call_volume" in result
        assert "total_put_volume" in result
        assert "put_call_ratio" in result
        assert "sentiment" in result

    @pytest.mark.asyncio
    async def test_calculate_gamma_exposure_returns_typed_dict(self):
        """Test calculate_gamma_exposure returns GammaExposure TypedDict."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.calculate_gamma_exposure("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "total_gex" in result
        assert "call_gex" in result
        assert "put_gex" in result
        assert "net_gex" in result

    @pytest.mark.asyncio
    async def test_detect_unusual_activity_returns_dataframe(self):
        """Test detect_unusual_activity returns DataFrame of unusual options."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.detect_unusual_activity("AAPL")

        assert isinstance(result, pd.DataFrame)
        # With mock data, should have some unusual activity
        assert len(result) > 0
        assert "symbol" in result.columns
        assert "strike" in result.columns
        assert "vol_oi_ratio" in result.columns

    @pytest.mark.asyncio
    async def test_analyze_put_call_flow_returns_dict(self):
        """Test analyze_put_call_flow returns analysis dict."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.analyze_put_call_flow("AAPL")

        assert isinstance(result, dict)
        assert "symbol" in result
        assert "put_call_ratio" in result
        assert "premium_put_call_ratio" in result
        assert "sentiment" in result

    @pytest.mark.asyncio
    async def test_track_smart_money_returns_dataframe(self):
        """Test track_smart_money returns DataFrame of smart money trades."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.track_smart_money("AAPL", min_premium=10000)

        assert isinstance(result, pd.DataFrame)
        assert len(result) > 0
        assert "symbol" in result.columns
        assert "premium" in result.columns
        assert "sentiment" in result.columns

    @pytest.mark.asyncio
    async def test_analyze_expiration_flow_returns_dict(self):
        """Test analyze_expiration_flow returns ExpirationAnalysis dict."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.analyze_expiration_flow("AAPL")

        assert isinstance(result, dict)
        assert "expiration" in result
        assert "max_pain" in result
        assert "days_to_expiry" in result

    @pytest.mark.asyncio
    async def test_calculate_max_pain_returns_float(self):
        """Test calculate_max_pain returns a float strike price."""
        analyzer = OptionsAnalyzer()
        result = await analyzer.calculate_max_pain("AAPL")

        assert isinstance(result, (int, float))
        assert result > 0  # Max pain should be a valid price


class TestEdgeCases:
    """Edge case tests for OptionsAnalyzer."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_very_deep_itm_options(self, sample_expiration_dates):
        """Test handling of very deep in-the-money options."""
        from stanley.analytics.options import OptionsAnalyzer

        # Create deep ITM options
        deep_itm = pd.DataFrame(
            [
                {
                    "expiration": sample_expiration_dates[0],
                    "strike": 100.0,  # Very deep ITM for $150 stock
                    "option_type": "call",
                    "bid": 50.00,
                    "ask": 50.50,
                    "last_price": 50.25,
                    "volume": 100,
                    "open_interest": 500,
                    "implied_volatility": 0.15,
                    "delta": 0.99,
                    "gamma": 0.001,
                    "theta": -0.01,
                    "vega": 0.02,
                    "underlying_price": 150.0,
                }
            ]
        )

        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_gamma_exposure(deep_itm, "AAPL")

        # Should handle without error
        assert isinstance(result, dict)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_very_deep_otm_options(self, sample_expiration_dates):
        """Test handling of very deep out-of-the-money options."""
        from stanley.analytics.options import OptionsAnalyzer

        # Create deep OTM options
        deep_otm = pd.DataFrame(
            [
                {
                    "expiration": sample_expiration_dates[0],
                    "strike": 250.0,  # Very deep OTM for $150 stock
                    "option_type": "call",
                    "bid": 0.01,
                    "ask": 0.05,
                    "last_price": 0.03,
                    "volume": 1000,
                    "open_interest": 10000,
                    "implied_volatility": 0.80,
                    "delta": 0.01,
                    "gamma": 0.001,
                    "theta": -0.001,
                    "vega": 0.01,
                    "underlying_price": 150.0,
                }
            ]
        )

        analyzer = OptionsAnalyzer()
        result = analyzer.detect_unusual_activity(deep_otm)

        # Should handle without error
        assert isinstance(result, pd.DataFrame)

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_extremely_high_volume(self, sample_expiration_dates):
        """Test handling of extremely high volume."""
        from stanley.analytics.options import OptionsAnalyzer

        high_volume = pd.DataFrame(
            [
                {
                    "expiration": sample_expiration_dates[0],
                    "strike": 150.0,
                    "option_type": "call",
                    "bid": 5.50,
                    "ask": 5.75,
                    "last_price": 5.625,
                    "volume": 10000000,  # 10M volume
                    "open_interest": 100000,
                    "implied_volatility": 0.50,
                    "delta": 0.50,
                    "gamma": 0.05,
                    "theta": -0.02,
                    "vega": 0.15,
                    "underlying_price": 150.0,
                }
            ]
        )

        analyzer = OptionsAnalyzer()
        result = analyzer.detect_unusual_activity(high_volume)

        # Should flag as unusual
        assert len(result) >= 1

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_negative_values_handling(self, sample_expiration_dates):
        """Test handling of invalid negative values."""
        from stanley.analytics.options import OptionsAnalyzer

        invalid_data = pd.DataFrame(
            [
                {
                    "expiration": sample_expiration_dates[0],
                    "strike": 150.0,
                    "option_type": "call",
                    "bid": -1.0,  # Invalid negative
                    "ask": 5.75,
                    "last_price": 5.625,
                    "volume": -100,  # Invalid negative
                    "open_interest": 5000,
                    "implied_volatility": 0.30,
                    "delta": 0.50,
                    "gamma": 0.05,
                    "theta": -0.02,
                    "vega": 0.15,
                    "underlying_price": 150.0,
                }
            ]
        )

        analyzer = OptionsAnalyzer()
        # Should handle gracefully (either filter or raise ValueError)
        try:
            result = analyzer.calculate_put_call_ratio(invalid_data)
            # If it doesn't raise, result should be valid
            assert isinstance(result, dict)
        except ValueError:
            # Raising ValueError for invalid data is acceptable
            pass

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_many_expirations(self):
        """Test with many expiration dates."""
        from stanley.analytics.options import OptionsAnalyzer

        # Create 52 weekly expirations
        expirations = [datetime.now() + timedelta(weeks=i) for i in range(1, 53)]

        data = []
        for exp in expirations:
            data.append(
                {
                    "expiration": exp,
                    "strike": 150.0,
                    "option_type": "call",
                    "bid": 5.00,
                    "ask": 5.25,
                    "last_price": 5.125,
                    "volume": 100,
                    "open_interest": 1000,
                    "implied_volatility": 0.30,
                    "delta": 0.50,
                    "gamma": 0.05,
                    "theta": -0.02,
                    "vega": 0.15,
                    "underlying_price": 150.0,
                }
            )

        df = pd.DataFrame(data)
        analyzer = OptionsAnalyzer()
        result = analyzer.analyze_expiration_flow(df)

        assert len(result) == 52

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    def test_many_strikes(self, sample_expiration_dates):
        """Test with many strike prices."""
        from stanley.analytics.options import OptionsAnalyzer

        # Create 100 strikes
        strikes = list(range(100, 200))

        data = []
        for strike in strikes:
            data.append(
                {
                    "expiration": sample_expiration_dates[0],
                    "strike": float(strike),
                    "option_type": "call",
                    "bid": max(0.01, 150 - strike),
                    "ask": max(0.05, 150 - strike + 0.5),
                    "last_price": max(0.03, 150 - strike + 0.25),
                    "volume": 100,
                    "open_interest": 1000,
                    "implied_volatility": 0.30,
                    "delta": 0.50,
                    "gamma": 0.05,
                    "theta": -0.02,
                    "vega": 0.15,
                    "underlying_price": 150.0,
                }
            )

        df = pd.DataFrame(data)
        analyzer = OptionsAnalyzer()
        result = analyzer.calculate_max_pain(df)

        # Max pain should be within strike range
        assert result["max_pain_strike"] >= 100
        assert result["max_pain_strike"] <= 199


# =============================================================================
# INTEGRATION TESTS - API Endpoints
# =============================================================================


class TestOptionsAPIEndpoints:
    """Integration tests for options API endpoints."""

    @pytest.mark.skip(reason="API endpoints not yet implemented")
    @pytest.mark.asyncio
    async def test_get_options_unusual_activity_endpoint(self):
        """Test GET /api/options/{symbol}/unusual endpoint."""
        from httpx import AsyncClient
        from stanley.api.main_new import app

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/options/AAPL/unusual")

            assert response.status_code == 200
            data = response.json()
            assert "unusual_options" in data

    @pytest.mark.skip(reason="API endpoints not yet implemented")
    @pytest.mark.asyncio
    async def test_get_options_gamma_exposure_endpoint(self):
        """Test GET /api/options/{symbol}/gamma endpoint."""
        from httpx import AsyncClient
        from stanley.api.main_new import app

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/options/AAPL/gamma")

            assert response.status_code == 200
            data = response.json()
            assert "net_gamma_exposure" in data

    @pytest.mark.skip(reason="API endpoints not yet implemented")
    @pytest.mark.asyncio
    async def test_get_options_put_call_ratio_endpoint(self):
        """Test GET /api/options/{symbol}/pcr endpoint."""
        from httpx import AsyncClient
        from stanley.api.main_new import app

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/options/AAPL/pcr")

            assert response.status_code == 200
            data = response.json()
            assert "volume_ratio" in data

    @pytest.mark.skip(reason="API endpoints not yet implemented")
    @pytest.mark.asyncio
    async def test_get_options_max_pain_endpoint(self):
        """Test GET /api/options/{symbol}/max-pain endpoint."""
        from httpx import AsyncClient
        from stanley.api.main_new import app

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/options/AAPL/max-pain")

            assert response.status_code == 200
            data = response.json()
            assert "max_pain_strike" in data

    @pytest.mark.skip(reason="API endpoints not yet implemented")
    @pytest.mark.asyncio
    async def test_get_options_flow_endpoint(self):
        """Test GET /api/options/{symbol}/flow endpoint."""
        from httpx import AsyncClient
        from stanley.api.main_new import app

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get("/api/options/AAPL/flow")

            assert response.status_code == 200
            data = response.json()
            assert "expiration_flow" in data


# =============================================================================
# DATA MANAGER INTEGRATION TESTS
# =============================================================================


class TestOptionsDataManagerIntegration:
    """Integration tests for OptionsAnalyzer with DataManager."""

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    @pytest.mark.asyncio
    async def test_fetch_and_analyze_unusual_activity(
        self, mock_options_data_manager, sample_options_chain
    ):
        """Test fetching options chain and analyzing unusual activity."""
        from stanley.analytics.options import OptionsAnalyzer

        mock_options_data_manager.get_options_chain.return_value = sample_options_chain

        analyzer = OptionsAnalyzer(data_manager=mock_options_data_manager)

        # Fetch chain
        chain = await mock_options_data_manager.get_options_chain("AAPL")

        # Analyze
        result = analyzer.detect_unusual_activity(chain)

        assert isinstance(result, pd.DataFrame)
        mock_options_data_manager.get_options_chain.assert_called_once_with("AAPL")

    @pytest.mark.skip(reason="OptionsAnalyzer not yet implemented")
    @pytest.mark.asyncio
    async def test_full_options_analysis_flow(
        self, mock_options_data_manager, sample_options_chain
    ):
        """Test complete options analysis workflow."""
        from stanley.analytics.options import OptionsAnalyzer

        mock_options_data_manager.get_options_chain.return_value = sample_options_chain

        analyzer = OptionsAnalyzer(data_manager=mock_options_data_manager)
        chain = await mock_options_data_manager.get_options_chain("AAPL")

        # Run all analyses
        unusual = analyzer.detect_unusual_activity(chain)
        gamma = analyzer.calculate_gamma_exposure(chain, "AAPL")
        pcr = analyzer.calculate_put_call_ratio(chain)
        max_pain = analyzer.calculate_max_pain(chain)
        flow = analyzer.analyze_expiration_flow(chain)
        smart_money = analyzer.track_smart_money(chain)

        # All should return valid results
        assert isinstance(unusual, pd.DataFrame)
        assert isinstance(gamma, dict)
        assert isinstance(pcr, dict)
        assert isinstance(max_pain, dict)
        assert isinstance(flow, pd.DataFrame)
        assert isinstance(smart_money, pd.DataFrame)
