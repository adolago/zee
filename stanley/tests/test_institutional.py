"""
Tests for InstitutionalAnalyzer module.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime

from stanley.analytics.institutional import InstitutionalAnalyzer


class TestInstitutionalAnalyzerInit:
    """Tests for InstitutionalAnalyzer initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data_manager."""
        analyzer = InstitutionalAnalyzer()
        assert analyzer is not None
        assert analyzer.data_manager is None

    def test_init_with_data_manager(self, mock_data_manager):
        """Test initialization with mock data_manager."""
        analyzer = InstitutionalAnalyzer(data_manager=mock_data_manager)
        assert analyzer.data_manager is mock_data_manager


class TestGetHoldings:
    """Tests for get_holdings method."""

    def test_returns_dict(self):
        """Test that method returns a dictionary."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("AAPL")
        assert isinstance(result, dict)

    def test_has_expected_keys(self):
        """Test that result has expected keys."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("AAPL")
        expected_keys = [
            "symbol",
            "institutional_ownership",
            "number_of_institutions",
            "top_holders",
            "recent_changes",
            "ownership_trend",
            "concentration_risk",
            "smart_money_score",
        ]
        for key in expected_keys:
            assert key in result

    def test_symbol_echoed(self):
        """Test that input symbol appears in result."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("MSFT")
        assert result["symbol"] == "MSFT"

    def test_ownership_bounded(self):
        """Test that institutional_ownership is in [0, 1] range."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("AAPL")
        assert 0 <= result["institutional_ownership"] <= 1

    def test_concentration_risk_bounded(self):
        """Test that concentration_risk is in [0, 1] range."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("AAPL")
        assert 0 <= result["concentration_risk"] <= 1

    def test_smart_money_score_bounded(self):
        """Test that smart_money_score is in [-1, 1] range."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("AAPL")
        assert -1 <= result["smart_money_score"] <= 1

    def test_ownership_trend_bounded(self):
        """Test that ownership_trend is in [-1, 1] range."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_holdings("AAPL")
        assert -1 <= result["ownership_trend"] <= 1


class TestAnalyze13FChanges:
    """Tests for analyze_13f_changes method."""

    def test_returns_dataframe(self):
        """Test that method returns a DataFrame."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.analyze_13f_changes("0000102909")
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self):
        """Test that DataFrame has expected columns."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.analyze_13f_changes("0000102909")
        expected_cols = [
            "symbol",
            "shares_change",
            "value_change",
            "change_percentage",
            "change_type",
        ]
        for col in expected_cols:
            assert col in result.columns

    def test_sorted_by_change_percentage(self):
        """Test that result is sorted by change_percentage descending."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.analyze_13f_changes("0000102909")
        if len(result) > 1:
            # Verify descending order
            for i in range(len(result) - 1):
                assert (
                    result["change_percentage"].iloc[i]
                    >= result["change_percentage"].iloc[i + 1]
                )


class TestGetInstitutionalSentiment:
    """Tests for get_institutional_sentiment method."""

    def test_returns_dict(self):
        """Test that method returns a dictionary."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment(["AAPL", "MSFT"])
        assert isinstance(result, dict)

    def test_empty_universe(self):
        """Test with empty universe."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment([])
        assert result["universe_size"] == 0
        assert result["institutional_sentiment"] == "neutral"

    def test_has_expected_keys(self):
        """Test that result has expected keys."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment(["AAPL"])
        expected_keys = [
            "universe_size",
            "average_institutional_ownership",
            "percentage_trending_up",
            "average_smart_money_score",
            "institutional_sentiment",
            "details",
        ]
        for key in expected_keys:
            assert key in result

    def test_universe_size_matches(self):
        """Test that universe_size matches input length."""
        analyzer = InstitutionalAnalyzer()
        universe = ["AAPL", "MSFT", "GOOGL"]
        result = analyzer.get_institutional_sentiment(universe)
        assert result["universe_size"] == len(universe)

    def test_percentage_trending_up_bounded(self):
        """Test that percentage_trending_up is in [0, 1] range."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment(["AAPL", "MSFT"])
        assert 0 <= result["percentage_trending_up"] <= 1

    def test_sentiment_values(self):
        """Test that sentiment is one of expected values."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment(["AAPL"])
        assert result["institutional_sentiment"] in ["bullish", "bearish", "neutral"]

    def test_details_is_dataframe(self):
        """Test that details is a DataFrame."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment(["AAPL", "MSFT"])
        assert isinstance(result["details"], pd.DataFrame)


class TestTrackSmartMoney:
    """Tests for track_smart_money method."""

    def test_returns_dataframe(self):
        """Test that method returns a DataFrame."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.track_smart_money()
        assert isinstance(result, pd.DataFrame)

    def test_minimum_aum_parameter(self):
        """Test that minimum_aum parameter is accepted."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.track_smart_money(minimum_aum=10e9)
        assert isinstance(result, pd.DataFrame)


class TestCalculateInstitutionalMetrics:
    """Tests for _calculate_institutional_metrics private method."""

    def test_normal_data(self, sample_holdings_df, sample_changes_df):
        """Test with normal holdings and changes data."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_institutional_metrics(
            sample_holdings_df, sample_changes_df
        )
        assert "ownership_percentage" in result
        assert "concentration_risk" in result
        assert "smart_money_score" in result

    def test_empty_holdings(self, sample_changes_df):
        """Test with empty holdings DataFrame."""
        analyzer = InstitutionalAnalyzer()
        empty_holdings = pd.DataFrame(
            columns=[
                "manager_name",
                "manager_cik",
                "shares_held",
                "value_held",
                "ownership_percentage",
            ]
        )
        result = analyzer._calculate_institutional_metrics(
            empty_holdings, sample_changes_df
        )
        assert result["concentration_risk"] == 0.0

    def test_single_institution(self, sample_changes_df):
        """Test with single institution holding."""
        analyzer = InstitutionalAnalyzer()
        single_holding = pd.DataFrame(
            {
                "manager_name": ["Vanguard"],
                "manager_cik": ["0000102909"],
                "shares_held": [100000000],
                "value_held": [10000000000],
                "ownership_percentage": [0.50],
            }
        )
        result = analyzer._calculate_institutional_metrics(
            single_holding, sample_changes_df
        )
        # Single institution = maximum concentration
        assert result["concentration_risk"] == 1.0

    def test_equal_ownership(self, sample_changes_df):
        """Test with equal ownership across institutions."""
        analyzer = InstitutionalAnalyzer()
        equal_holdings = pd.DataFrame(
            {
                "manager_name": ["A", "B", "C", "D"],
                "manager_cik": ["1", "2", "3", "4"],
                "shares_held": [100, 100, 100, 100],
                "value_held": [1000, 1000, 1000, 1000],
                "ownership_percentage": [0.25, 0.25, 0.25, 0.25],
            }
        )
        result = analyzer._calculate_institutional_metrics(
            equal_holdings, sample_changes_df
        )
        # Equal ownership = minimum concentration (should be close to 0)
        assert result["concentration_risk"] < 0.1


class TestCalculate13FChanges:
    """Tests for _calculate_13f_changes private method."""

    def test_new_positions_detected(self):
        """Test that new positions are detected."""
        analyzer = InstitutionalAnalyzer()
        current = pd.DataFrame(
            {
                "symbol": ["AAPL", "MSFT", "NEW_STOCK"],
                "shares": [100, 200, 50],
                "value": [1000, 2000, 500],
                "weight": [0.3, 0.4, 0.1],
            }
        )
        previous = pd.DataFrame(
            {
                "symbol": ["AAPL", "MSFT"],
                "shares": [100, 200],
                "value": [1000, 2000],
                "weight": [0.3, 0.4],
            }
        )
        result = analyzer._calculate_13f_changes(current, previous)
        new_positions = result[result["change_type"] == "new"]
        assert len(new_positions) == 1
        assert "NEW_STOCK" in new_positions["symbol"].values

    def test_closed_positions_detected(self):
        """Test that closed positions are detected."""
        analyzer = InstitutionalAnalyzer()
        current = pd.DataFrame(
            {"symbol": ["AAPL"], "shares": [100], "value": [1000], "weight": [0.5]}
        )
        previous = pd.DataFrame(
            {
                "symbol": ["AAPL", "SOLD_STOCK"],
                "shares": [100, 200],
                "value": [1000, 2000],
                "weight": [0.3, 0.4],
            }
        )
        result = analyzer._calculate_13f_changes(current, previous)
        closed_positions = result[result["change_type"] == "closed"]
        assert len(closed_positions) == 1
        assert "SOLD_STOCK" in closed_positions["symbol"].values

    def test_shares_change_calculated(self):
        """Test that shares_change is calculated correctly."""
        analyzer = InstitutionalAnalyzer()
        current = pd.DataFrame(
            {"symbol": ["AAPL"], "shares": [150], "value": [1500], "weight": [0.5]}
        )
        previous = pd.DataFrame(
            {"symbol": ["AAPL"], "shares": [100], "value": [1000], "weight": [0.5]}
        )
        result = analyzer._calculate_13f_changes(current, previous)
        aapl_row = result[result["symbol"] == "AAPL"].iloc[0]
        assert aapl_row["shares_change"] == 50


class TestHealthCheck:
    """Tests for health_check method."""

    def test_returns_true(self):
        """Test that health_check returns True."""
        analyzer = InstitutionalAnalyzer()
        assert analyzer.health_check() is True


class TestEdgeCases:
    """Edge case tests for InstitutionalAnalyzer."""

    def test_large_universe(self):
        """Test sentiment analysis with large universe."""
        analyzer = InstitutionalAnalyzer()
        # Generate 50 fake symbols
        universe = [f"STOCK{i}" for i in range(50)]
        result = analyzer.get_institutional_sentiment(universe)
        assert result["universe_size"] == 50

    def test_very_high_aum_filter(self):
        """Test smart money tracking with very high AUM filter."""
        analyzer = InstitutionalAnalyzer()
        # Filter that would exclude most managers
        result = analyzer.track_smart_money(minimum_aum=100e12)  # $100 trillion
        assert isinstance(result, pd.DataFrame)

    def test_zero_ownership_percentage(self, sample_changes_df):
        """Test metrics with zero ownership percentages."""
        analyzer = InstitutionalAnalyzer()
        zero_holdings = pd.DataFrame(
            {
                "manager_name": ["A", "B"],
                "manager_cik": ["1", "2"],
                "shares_held": [0, 0],
                "value_held": [0, 0],
                "ownership_percentage": [0.0, 0.0],
            }
        )
        result = analyzer._calculate_institutional_metrics(
            zero_holdings, sample_changes_df
        )
        # Should not produce NaN or errors
        assert not np.isnan(result["concentration_risk"])
