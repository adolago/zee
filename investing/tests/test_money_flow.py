"""
Tests for MoneyFlowAnalyzer module.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

from investing.analytics.money_flow import MoneyFlowAnalyzer


class TestMoneyFlowAnalyzerInit:
    """Tests for MoneyFlowAnalyzer initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data_manager."""
        analyzer = MoneyFlowAnalyzer()
        assert analyzer is not None
        assert analyzer.data_manager is None

    def test_init_with_data_manager(self, mock_data_manager):
        """Test initialization with mock data_manager."""
        analyzer = MoneyFlowAnalyzer(data_manager=mock_data_manager)
        assert analyzer.data_manager is mock_data_manager


class TestAnalyzeSectorFlow:
    """Tests for analyze_sector_flow method (async)."""

    @pytest.mark.asyncio
    async def test_returns_dataframe(self):
        """Test that method returns a DataFrame."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK", "XLF"])
        assert isinstance(result, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_empty_sectors_list(self):
        """Test with empty sectors list."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow([])
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_single_sector(self):
        """Test with single sector."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK"])
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_dataframe_has_expected_columns(self):
        """Test that DataFrame has expected columns."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK"])
        expected_cols = [
            "net_flow_1m",
            "net_flow_3m",
            "institutional_change",
            "smart_money_sentiment",
            "flow_acceleration",
            "confidence_score",
        ]
        for col in expected_cols:
            assert col in result.columns

    @pytest.mark.asyncio
    async def test_index_is_sector(self):
        """Test that index is sector symbol."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK", "XLF"])
        assert result.index.name == "sector"

    @pytest.mark.asyncio
    async def test_confidence_score_bounded(self):
        """Test that confidence_score is in [-1, 1] range."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK", "XLF", "XLE"])
        for score in result["confidence_score"]:
            assert -1 <= score <= 1

    @pytest.mark.asyncio
    async def test_lookback_days_parameter(self):
        """Test lookback_days parameter."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK"], lookback_days=30)
        assert isinstance(result, pd.DataFrame)


class TestAnalyzeEquityFlow:
    """Tests for analyze_equity_flow method."""

    def test_returns_dict(self):
        """Test that method returns a dictionary."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.analyze_equity_flow("AAPL")
        assert isinstance(result, dict)

    def test_has_expected_keys(self):
        """Test that result has expected keys."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.analyze_equity_flow("AAPL")
        expected_keys = [
            "symbol",
            "money_flow_score",
            "institutional_sentiment",
            "smart_money_activity",
            "short_pressure",
            "accumulation_distribution",
            "confidence",
        ]
        for key in expected_keys:
            assert key in result

    def test_symbol_echoed(self):
        """Test that input symbol appears in result."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.analyze_equity_flow("MSFT")
        assert result["symbol"] == "MSFT"

    def test_flow_score_bounded(self):
        """Test that flow_score is in [-1, 1] range."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.analyze_equity_flow("AAPL")
        assert -1 <= result["money_flow_score"] <= 1

    def test_confidence_non_negative(self):
        """Test that confidence is non-negative."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.analyze_equity_flow("AAPL")
        assert result["confidence"] >= 0


class TestGetDarkPoolActivity:
    """Tests for get_dark_pool_activity method."""

    def test_returns_dataframe(self):
        """Test that method returns a DataFrame."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.get_dark_pool_activity("AAPL")
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self):
        """Test that DataFrame has expected columns."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.get_dark_pool_activity("AAPL")
        expected_cols = [
            "date",
            "dark_pool_volume",
            "total_volume",
            "dark_pool_percentage",
            "large_block_activity",
            "dark_pool_signal",
        ]
        for col in expected_cols:
            assert col in result.columns

    def test_lookback_days_determines_rows(self):
        """Test that lookback_days determines number of rows."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.get_dark_pool_activity("AAPL", lookback_days=10)
        assert len(result) == 10

    def test_dark_pool_signal_values(self):
        """Test that dark_pool_signal contains only -1, 0, or 1."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.get_dark_pool_activity("AAPL")
        assert all(signal in [-1, 0, 1] for signal in result["dark_pool_signal"])


class TestCalculateFlowMetrics:
    """Tests for _calculate_flow_metrics private method."""

    def test_empty_flow_data(self, empty_flow_data, sample_institutional_data):
        """Test with empty flow data returns zeros."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer._calculate_flow_metrics(
            empty_flow_data, sample_institutional_data
        )
        assert result["net_flow_1m"] == 0.0
        assert result["net_flow_3m"] == 0.0
        assert result["confidence_score"] == 0.0

    def test_missing_net_flow_column(self, sample_institutional_data):
        """Test with DataFrame missing net_flow column."""
        analyzer = MoneyFlowAnalyzer()
        df = pd.DataFrame({"date": [datetime.now()], "other": [1.0]})
        result = analyzer._calculate_flow_metrics(df, sample_institutional_data)
        assert result["confidence_score"] == 0.0

    def test_normal_flow_data(self, sample_flow_data, sample_institutional_data):
        """Test with normal flow data."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer._calculate_flow_metrics(
            sample_flow_data, sample_institutional_data
        )
        assert "net_flow_1m" in result
        assert "confidence_score" in result
        assert -1 <= result["confidence_score"] <= 1

    def test_zero_std_flow_data(self, sample_institutional_data):
        """Test with zero standard deviation in flow data."""
        analyzer = MoneyFlowAnalyzer()
        dates = pd.date_range(end=datetime.now(), periods=10, freq="D")
        df = pd.DataFrame(
            {"date": dates, "net_flow": [1000000] * 10}  # Constant values = zero std
        )
        result = analyzer._calculate_flow_metrics(df, sample_institutional_data)
        # Should not produce Inf or NaN
        assert not np.isinf(result["smart_money_sentiment"])
        assert not np.isnan(result["smart_money_sentiment"])


class TestCalculateDarkPoolSignal:
    """Tests for _calculate_dark_pool_signal private method."""

    def test_bullish_signal(self):
        """Test bullish signal when dark pool % > 25% and block activity > 10%."""
        analyzer = MoneyFlowAnalyzer()
        df = pd.DataFrame(
            {"dark_pool_percentage": [0.30], "large_block_activity": [0.15]}
        )
        result = analyzer._calculate_dark_pool_signal(df)
        assert result.iloc[0] == 1

    def test_bearish_signal(self):
        """Test bearish signal when dark pool % < 15% and block activity < 5%."""
        analyzer = MoneyFlowAnalyzer()
        df = pd.DataFrame(
            {"dark_pool_percentage": [0.10], "large_block_activity": [0.03]}
        )
        result = analyzer._calculate_dark_pool_signal(df)
        assert result.iloc[0] == -1

    def test_neutral_signal(self):
        """Test neutral signal for middle values."""
        analyzer = MoneyFlowAnalyzer()
        df = pd.DataFrame(
            {"dark_pool_percentage": [0.20], "large_block_activity": [0.08]}
        )
        result = analyzer._calculate_dark_pool_signal(df)
        assert result.iloc[0] == 0


class TestHealthCheck:
    """Tests for health_check method."""

    def test_returns_true(self):
        """Test that health_check returns True."""
        analyzer = MoneyFlowAnalyzer()
        assert analyzer.health_check() is True


class TestEdgeCases:
    """Edge case tests for MoneyFlowAnalyzer."""

    @pytest.mark.asyncio
    async def test_very_large_lookback_days(self):
        """Test with very large lookback_days value."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK"], lookback_days=1000)
        assert isinstance(result, pd.DataFrame)

    def test_lookback_days_one(self):
        """Test with lookback_days = 1."""
        analyzer = MoneyFlowAnalyzer()
        result = analyzer.get_dark_pool_activity("AAPL", lookback_days=1)
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_duplicate_sectors(self):
        """Test with duplicate sectors in list."""
        analyzer = MoneyFlowAnalyzer()
        result = await analyzer.analyze_sector_flow(["XLK", "XLK", "XLK"])
        # Should handle duplicates (may have 3 rows or dedupe to 1)
        assert isinstance(result, pd.DataFrame)

    def test_all_positive_flows(self):
        """Test metrics with all positive flows."""
        analyzer = MoneyFlowAnalyzer()
        dates = pd.date_range(end=datetime.now(), periods=30, freq="D")
        df = pd.DataFrame(
            {
                "date": dates,
                "net_flow": [abs(np.random.normal(1000000, 100000)) for _ in range(30)],
            }
        )
        inst_data = {"net_buyer_count": 50, "total_institutions": 200}
        result = analyzer._calculate_flow_metrics(df, inst_data)
        assert result["net_flow_1m"] > 0
        assert result["net_flow_3m"] > 0

    def test_all_negative_flows(self):
        """Test metrics with all negative flows."""
        analyzer = MoneyFlowAnalyzer()
        dates = pd.date_range(end=datetime.now(), periods=30, freq="D")
        df = pd.DataFrame(
            {
                "date": dates,
                "net_flow": [
                    -abs(np.random.normal(1000000, 100000)) for _ in range(30)
                ],
            }
        )
        inst_data = {"net_buyer_count": 50, "total_institutions": 200}
        result = analyzer._calculate_flow_metrics(df, inst_data)
        assert result["net_flow_1m"] < 0
        assert result["net_flow_3m"] < 0
