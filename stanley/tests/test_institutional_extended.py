"""
Extended Tests for InstitutionalAnalyzer module.

Tests for async methods, helper functions, Bloomberg-beating features,
and additional functionality not covered in existing test files.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from stanley.analytics.institutional import (
    InstitutionalAnalyzer,
    QUARTER_END_DATES,
    FILING_DEADLINE_DAYS,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def analyzer():
    """Create InstitutionalAnalyzer without data manager."""
    return InstitutionalAnalyzer()


@pytest.fixture
def sample_holdings():
    """Sample holdings DataFrame."""
    return pd.DataFrame(
        {
            "manager_name": [
                "Vanguard",
                "BlackRock",
                "State Street",
                "Fidelity",
                "T. Rowe Price",
            ],
            "manager_cik": [
                "0000102909",
                "0001390777",
                "0000093751",
                "0000315066",
                "0000080227",
            ],
            "shares_held": [100000000, 80000000, 60000000, 40000000, 30000000],
            "value_held": [10000000000, 8000000000, 6000000000, 4000000000, 3000000000],
            "ownership_percentage": [0.05, 0.04, 0.03, 0.02, 0.015],
        }
    )


@pytest.fixture
def sample_13f_filing():
    """Sample 13F filing DataFrame."""
    return pd.DataFrame(
        {
            "symbol": ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA"],
            "shares": [10000000, 8000000, 6000000, 5000000, 4000000],
            "value": [1500000000, 1200000000, 900000000, 750000000, 600000000],
            "weight": [0.25, 0.20, 0.15, 0.12, 0.10],
        }
    )


# =============================================================================
# Test Module Constants
# =============================================================================


class TestModuleConstants:
    """Test module-level constants."""

    def test_quarter_end_dates_all_quarters(self):
        """Test all quarters have end dates defined."""
        assert 1 in QUARTER_END_DATES
        assert 2 in QUARTER_END_DATES
        assert 3 in QUARTER_END_DATES
        assert 4 in QUARTER_END_DATES

    def test_quarter_end_dates_values(self):
        """Test quarter end date values are correct."""
        assert QUARTER_END_DATES[1] == (3, 31)  # Q1 - March 31
        assert QUARTER_END_DATES[2] == (6, 30)  # Q2 - June 30
        assert QUARTER_END_DATES[3] == (9, 30)  # Q3 - September 30
        assert QUARTER_END_DATES[4] == (12, 31)  # Q4 - December 31

    def test_filing_deadline_days(self):
        """Test 13F filing deadline is 45 days."""
        assert FILING_DEADLINE_DAYS == 45


# =============================================================================
# Test Helper Methods - Sharpe Ratio & Max Drawdown
# =============================================================================


class TestCalculateSharpeRatio:
    """Test _calculate_sharpe_ratio method."""

    def test_sharpe_empty_returns(self, analyzer):
        """Test Sharpe ratio with empty returns."""
        returns = np.array([])
        sharpe = analyzer._calculate_sharpe_ratio(returns)
        assert sharpe == 0.0

    def test_sharpe_single_return(self, analyzer):
        """Test Sharpe ratio with single return."""
        returns = np.array([0.05])
        sharpe = analyzer._calculate_sharpe_ratio(returns)
        assert sharpe == 0.0

    def test_sharpe_positive_returns(self, analyzer):
        """Test Sharpe ratio with positive returns."""
        returns = np.array([0.05, 0.06, 0.04, 0.07, 0.05, 0.03, 0.08])
        sharpe = analyzer._calculate_sharpe_ratio(returns)
        assert isinstance(sharpe, float)
        assert sharpe > 0

    def test_sharpe_zero_volatility(self, analyzer):
        """Test Sharpe ratio with zero volatility."""
        returns = np.array([0.05, 0.05, 0.05, 0.05])
        sharpe = analyzer._calculate_sharpe_ratio(returns)
        assert sharpe == 0.0

    def test_sharpe_mixed_returns(self, analyzer):
        """Test Sharpe ratio with mixed positive and negative returns."""
        returns = np.array([0.05, -0.02, 0.03, -0.01, 0.04])
        sharpe = analyzer._calculate_sharpe_ratio(returns)
        assert isinstance(sharpe, float)

    def test_sharpe_all_negative(self, analyzer):
        """Test Sharpe ratio with all negative returns."""
        returns = np.array([-0.02, -0.03, -0.01, -0.02])
        sharpe = analyzer._calculate_sharpe_ratio(returns)
        assert isinstance(sharpe, float)
        assert sharpe < 0


class TestCalculateMaxDrawdown:
    """Test _calculate_max_drawdown method."""

    def test_drawdown_empty_returns(self, analyzer):
        """Test max drawdown with empty returns."""
        returns = np.array([])
        drawdown = analyzer._calculate_max_drawdown(returns)
        assert drawdown == 0.0

    def test_drawdown_all_positive(self, analyzer):
        """Test max drawdown with all positive returns."""
        returns = np.array([0.05, 0.05, 0.05, 0.05])
        drawdown = analyzer._calculate_max_drawdown(returns)
        assert drawdown == 0.0

    def test_drawdown_single_loss(self, analyzer):
        """Test max drawdown with a single loss."""
        returns = np.array([0.10, -0.20, 0.05])
        drawdown = analyzer._calculate_max_drawdown(returns)
        assert drawdown < 0

    def test_drawdown_multiple_losses(self, analyzer):
        """Test max drawdown with multiple loss periods."""
        returns = np.array([0.10, -0.05, -0.10, 0.15, -0.03, -0.02])
        drawdown = analyzer._calculate_max_drawdown(returns)
        assert drawdown < 0

    def test_drawdown_bounded(self, analyzer):
        """Test max drawdown is bounded between -1 and 0."""
        returns = np.array([0.10, -0.50, 0.20, -0.30, 0.05])
        drawdown = analyzer._calculate_max_drawdown(returns)
        assert -1.0 <= drawdown <= 0.0


# =============================================================================
# Test 13F Filing Calendar
# =============================================================================


class TestGet13FFilingCalendar:
    """Test get_13f_filing_calendar method."""

    def test_calendar_returns_dataframe(self, analyzer):
        """Test calendar returns DataFrame."""
        calendar = analyzer.get_13f_filing_calendar()
        assert isinstance(calendar, pd.DataFrame)

    def test_calendar_default_quarters(self, analyzer):
        """Test calendar returns 4 quarters by default."""
        calendar = analyzer.get_13f_filing_calendar()
        assert len(calendar) == 4

    def test_calendar_custom_quarters(self, analyzer):
        """Test calendar with custom number of quarters."""
        calendar = analyzer.get_13f_filing_calendar(quarters_ahead=8)
        assert len(calendar) == 8

    def test_calendar_single_quarter(self, analyzer):
        """Test calendar with single quarter."""
        calendar = analyzer.get_13f_filing_calendar(quarters_ahead=1)
        assert len(calendar) == 1

    def test_calendar_columns(self, analyzer):
        """Test calendar has expected columns."""
        calendar = analyzer.get_13f_filing_calendar()
        expected_cols = [
            "quarter",
            "quarter_end",
            "filing_deadline",
            "status",
            "days_until_deadline",
        ]
        for col in expected_cols:
            assert col in calendar.columns

    def test_calendar_deadline_after_quarter_end(self, analyzer):
        """Test filing deadline is after quarter end."""
        calendar = analyzer.get_13f_filing_calendar()
        for _, row in calendar.iterrows():
            assert row["filing_deadline"] > row["quarter_end"]

    def test_calendar_deadline_45_days(self, analyzer):
        """Test filing deadline is 45 days after quarter end."""
        calendar = analyzer.get_13f_filing_calendar()
        for _, row in calendar.iterrows():
            diff = (row["filing_deadline"] - row["quarter_end"]).days
            assert diff == 45

    def test_calendar_status_values(self, analyzer):
        """Test status values are valid."""
        calendar = analyzer.get_13f_filing_calendar()
        valid_statuses = ["upcoming", "in_progress", "filing_window", "complete"]
        for status in calendar["status"]:
            assert status in valid_statuses


# =============================================================================
# Test Async Get Holdings
# =============================================================================


class TestAsyncGetHoldings:
    """Test async_get_holdings method."""

    @pytest.mark.asyncio
    async def test_get_holdings_basic(self, analyzer):
        """Test basic holdings retrieval."""
        holdings = await analyzer.async_get_holdings("AAPL")

        assert "symbol" in holdings
        assert holdings["symbol"] == "AAPL"
        assert "institutional_ownership" in holdings
        assert "number_of_institutions" in holdings
        assert "top_holders" in holdings

    @pytest.mark.asyncio
    async def test_get_holdings_ownership_bounded(self, analyzer):
        """Test ownership is bounded [0, 1]."""
        holdings = await analyzer.async_get_holdings("AAPL")
        assert 0 <= holdings["institutional_ownership"] <= 1

    @pytest.mark.asyncio
    async def test_get_holdings_with_changes(self, analyzer):
        """Test holdings with changes flag."""
        holdings = await analyzer.async_get_holdings("AAPL", include_changes=True)
        assert "holder_changes" in holdings

    @pytest.mark.asyncio
    async def test_get_holdings_with_performance(self, analyzer):
        """Test holdings with performance flag."""
        holdings = await analyzer.async_get_holdings("AAPL", include_performance=True)
        assert "manager_performance" in holdings

    @pytest.mark.asyncio
    async def test_get_holdings_all_options(self, analyzer):
        """Test holdings with all options enabled."""
        holdings = await analyzer.async_get_holdings(
            "AAPL", include_changes=True, include_performance=True
        )
        assert "holder_changes" in holdings
        assert "manager_performance" in holdings


# =============================================================================
# Test Async Analyze 13F Changes
# =============================================================================


class TestAsyncAnalyze13FChanges:
    """Test async_analyze_13f_changes method."""

    @pytest.mark.asyncio
    async def test_analyze_changes_returns_dataframe(self, analyzer):
        """Test 13F changes returns DataFrame."""
        changes = await analyzer.async_analyze_13f_changes("0000102909")
        assert isinstance(changes, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_analyze_changes_columns(self, analyzer):
        """Test 13F changes has expected columns."""
        changes = await analyzer.async_analyze_13f_changes("0000102909")
        expected_cols = [
            "symbol",
            "shares_change",
            "value_change",
            "change_percentage",
            "change_type",
        ]
        for col in expected_cols:
            assert col in changes.columns


# =============================================================================
# Test Async Get Institutional Sentiment
# =============================================================================


class TestAsyncGetInstitutionalSentiment:
    """Test async_get_institutional_sentiment method."""

    @pytest.mark.asyncio
    async def test_sentiment_empty_universe(self, analyzer):
        """Test sentiment with empty universe."""
        sentiment = await analyzer.async_get_institutional_sentiment([])
        assert sentiment["universe_size"] == 0
        assert sentiment["institutional_sentiment"] == "neutral"

    @pytest.mark.asyncio
    async def test_sentiment_with_universe(self, analyzer):
        """Test sentiment with stock universe."""
        sentiment = await analyzer.async_get_institutional_sentiment(["AAPL", "MSFT"])
        assert sentiment["universe_size"] == 2
        assert "average_institutional_ownership" in sentiment
        assert "percentage_trending_up" in sentiment
        assert "institutional_sentiment" in sentiment
        assert sentiment["institutional_sentiment"] in ["bullish", "bearish", "neutral"]

    @pytest.mark.asyncio
    async def test_sentiment_details_dataframe(self, analyzer):
        """Test sentiment returns details as DataFrame."""
        sentiment = await analyzer.async_get_institutional_sentiment(
            ["AAPL", "MSFT", "GOOGL"]
        )
        assert "details" in sentiment
        assert isinstance(sentiment["details"], pd.DataFrame)


# =============================================================================
# Test Async Track Smart Money
# =============================================================================


class TestAsyncTrackSmartMoney:
    """Test async_track_smart_money method."""

    @pytest.mark.asyncio
    async def test_track_smart_money_returns_dataframe(self, analyzer):
        """Test smart money tracking returns DataFrame."""
        smart_money = await analyzer.async_track_smart_money()
        assert isinstance(smart_money, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_track_smart_money_with_min_aum(self, analyzer):
        """Test smart money tracking with minimum AUM filter."""
        smart_money = await analyzer.async_track_smart_money(minimum_aum=10e9)
        assert isinstance(smart_money, pd.DataFrame)


# =============================================================================
# Test Bloomberg-Beating Features - detect_13f_changes
# =============================================================================


class TestDetect13FChanges:
    """Test detect_13f_changes method."""

    @pytest.mark.asyncio
    async def test_detect_changes_returns_dataframe(self, analyzer):
        """Test 13F changes detection returns DataFrame."""
        changes = await analyzer.detect_13f_changes("AAPL")
        assert isinstance(changes, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_detect_changes_columns(self, analyzer):
        """Test 13F changes has expected columns."""
        changes = await analyzer.detect_13f_changes("AAPL")
        expected_cols = [
            "manager_name",
            "change_type",
            "shares_current",
            "shares_previous",
            "change_magnitude",
            "change_percentage",
            "conviction_score",
        ]
        for col in expected_cols:
            assert col in changes.columns

    @pytest.mark.asyncio
    async def test_detect_changes_conviction_bounds(self, analyzer):
        """Test conviction scores are bounded [-1, 1]."""
        changes = await analyzer.detect_13f_changes("AAPL")
        if not changes.empty:
            assert changes["conviction_score"].min() >= -1.0
            assert changes["conviction_score"].max() <= 1.0

    @pytest.mark.asyncio
    async def test_detect_changes_types(self, analyzer):
        """Test change types are valid."""
        changes = await analyzer.detect_13f_changes("AAPL")
        valid_types = ["new", "closed", "increased", "decreased", "unchanged"]
        if not changes.empty:
            for change_type in changes["change_type"]:
                assert change_type in valid_types

    @pytest.mark.asyncio
    async def test_detect_changes_different_symbol(self, analyzer):
        """Test changes detection with different symbol."""
        changes = await analyzer.detect_13f_changes("MSFT")
        assert isinstance(changes, pd.DataFrame)


# =============================================================================
# Test Bloomberg-Beating Features - detect_whale_accumulation
# =============================================================================


class TestDetectWhaleAccumulation:
    """Test detect_whale_accumulation method."""

    @pytest.mark.asyncio
    async def test_whale_accumulation_returns_dataframe(self, analyzer):
        """Test whale accumulation returns DataFrame."""
        whales = await analyzer.detect_whale_accumulation("AAPL")
        assert isinstance(whales, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_whale_accumulation_columns(self, analyzer):
        """Test whale accumulation has expected columns."""
        whales = await analyzer.detect_whale_accumulation("AAPL")
        expected_cols = [
            "institution_name",
            "change_type",
            "magnitude",
            "estimated_aum",
            "alert_level",
            "shares_changed",
        ]
        for col in expected_cols:
            assert col in whales.columns

    @pytest.mark.asyncio
    async def test_whale_accumulation_alert_levels(self, analyzer):
        """Test whale accumulation alert levels are valid."""
        whales = await analyzer.detect_whale_accumulation("AAPL")
        valid_levels = ["critical", "high", "medium", "low"]
        if not whales.empty:
            for level in whales["alert_level"]:
                assert level in valid_levels

    @pytest.mark.asyncio
    async def test_whale_accumulation_min_aum_filter(self, analyzer):
        """Test whale accumulation with minimum AUM filter."""
        whales = await analyzer.detect_whale_accumulation("AAPL", min_aum=500e9)
        assert isinstance(whales, pd.DataFrame)


# =============================================================================
# Test Bloomberg-Beating Features - calculate_sentiment_score
# =============================================================================


class TestCalculateSentimentScore:
    """Test calculate_sentiment_score method."""

    @pytest.mark.asyncio
    async def test_sentiment_returns_dict(self, analyzer):
        """Test sentiment score returns dictionary."""
        sentiment = await analyzer.calculate_sentiment_score("AAPL")
        assert isinstance(sentiment, dict)

    @pytest.mark.asyncio
    async def test_sentiment_keys(self, analyzer):
        """Test sentiment score has expected keys."""
        sentiment = await analyzer.calculate_sentiment_score("AAPL")
        expected_keys = [
            "score",
            "contributing_factors",
            "confidence",
            "classification",
            "weights_used",
        ]
        for key in expected_keys:
            assert key in sentiment

    @pytest.mark.asyncio
    async def test_sentiment_score_bounds(self, analyzer):
        """Test sentiment score is bounded [-1, 1]."""
        sentiment = await analyzer.calculate_sentiment_score("AAPL")
        assert -1.0 <= sentiment["score"] <= 1.0

    @pytest.mark.asyncio
    async def test_sentiment_confidence_bounds(self, analyzer):
        """Test confidence is bounded [0, 1]."""
        sentiment = await analyzer.calculate_sentiment_score("AAPL")
        assert 0.0 <= sentiment["confidence"] <= 1.0

    @pytest.mark.asyncio
    async def test_sentiment_classification(self, analyzer):
        """Test sentiment classification is valid."""
        sentiment = await analyzer.calculate_sentiment_score("AAPL")
        valid_classifications = [
            "strongly_bullish",
            "bullish",
            "neutral",
            "bearish",
            "strongly_bearish",
        ]
        assert sentiment["classification"] in valid_classifications

    @pytest.mark.asyncio
    async def test_sentiment_custom_weights(self, analyzer):
        """Test sentiment score with custom weights."""
        custom_weights = {
            "ownership_trend": 0.5,
            "buyer_seller_ratio": 0.2,
            "concentration_change": 0.1,
            "filing_momentum": 0.2,
        }
        sentiment = await analyzer.calculate_sentiment_score(
            "AAPL", weights=custom_weights
        )
        assert isinstance(sentiment, dict)
        total_weight = sum(sentiment["weights_used"].values())
        assert abs(total_weight - 1.0) < 0.01


# =============================================================================
# Test Bloomberg-Beating Features - cluster_positions
# =============================================================================


class TestClusterPositions:
    """Test cluster_positions method."""

    @pytest.mark.asyncio
    async def test_cluster_returns_dict(self, analyzer):
        """Test cluster positions returns dictionary."""
        clusters = await analyzer.cluster_positions("AAPL")
        assert isinstance(clusters, dict)

    @pytest.mark.asyncio
    async def test_cluster_keys(self, analyzer):
        """Test cluster positions has expected keys."""
        clusters = await analyzer.cluster_positions("AAPL")
        expected_keys = [
            "cluster_labels",
            "cluster_stats",
            "smart_money_direction",
            "cluster_summary",
        ]
        for key in expected_keys:
            assert key in clusters

    @pytest.mark.asyncio
    async def test_cluster_direction(self, analyzer):
        """Test smart money direction is valid."""
        clusters = await analyzer.cluster_positions("AAPL")
        valid_directions = ["accumulating", "distributing", "neutral"]
        assert clusters["smart_money_direction"] in valid_directions


# =============================================================================
# Test Bloomberg-Beating Features - analyze_cross_filing
# =============================================================================


class TestAnalyzeCrossFiling:
    """Test analyze_cross_filing method."""

    @pytest.mark.asyncio
    async def test_cross_filing_returns_dict(self, analyzer):
        """Test cross-filing analysis returns dictionary."""
        analysis = await analyzer.analyze_cross_filing("AAPL")
        assert isinstance(analysis, dict)

    @pytest.mark.asyncio
    async def test_cross_filing_keys(self, analyzer):
        """Test cross-filing analysis has expected keys."""
        analysis = await analyzer.analyze_cross_filing("AAPL")
        expected_keys = [
            "institution_count",
            "institution_agreement",
            "consensus_direction",
            "cross_filing_score",
            "filing_breakdown",
        ]
        for key in expected_keys:
            assert key in analysis

    @pytest.mark.asyncio
    async def test_cross_filing_score_bounds(self, analyzer):
        """Test cross-filing score is bounded [-1, 1]."""
        analysis = await analyzer.analyze_cross_filing("AAPL")
        assert -1.0 <= analysis["cross_filing_score"] <= 1.0

    @pytest.mark.asyncio
    async def test_cross_filing_consensus_values(self, analyzer):
        """Test consensus direction is valid."""
        analysis = await analyzer.analyze_cross_filing("AAPL")
        valid_consensus = ["buying", "selling", "mixed", "neutral", "insufficient_data"]
        assert analysis["consensus_direction"] in valid_consensus


# =============================================================================
# Test Bloomberg-Beating Features - track_smart_money_momentum
# =============================================================================


class TestTrackSmartMoneyMomentum:
    """Test track_smart_money_momentum method."""

    @pytest.mark.asyncio
    async def test_momentum_returns_dict(self, analyzer):
        """Test smart money momentum returns dictionary."""
        momentum = await analyzer.track_smart_money_momentum("AAPL")
        assert isinstance(momentum, dict)

    @pytest.mark.asyncio
    async def test_momentum_keys(self, analyzer):
        """Test smart money momentum has expected keys."""
        momentum = await analyzer.track_smart_money_momentum("AAPL")
        expected_keys = [
            "momentum_score",
            "trend_direction",
            "acceleration",
            "quarterly_momentum",
            "top_movers",
            "signal_strength",
        ]
        for key in expected_keys:
            assert key in momentum

    @pytest.mark.asyncio
    async def test_momentum_score_bounds(self, analyzer):
        """Test momentum score is bounded [-1, 1]."""
        momentum = await analyzer.track_smart_money_momentum("AAPL")
        assert -1.0 <= momentum["momentum_score"] <= 1.0

    @pytest.mark.asyncio
    async def test_momentum_trend_direction(self, analyzer):
        """Test trend direction is valid."""
        momentum = await analyzer.track_smart_money_momentum("AAPL")
        valid_directions = ["accelerating", "decelerating", "stable"]
        assert momentum["trend_direction"] in valid_directions

    @pytest.mark.asyncio
    async def test_momentum_custom_window(self, analyzer):
        """Test momentum with custom window size."""
        momentum = await analyzer.track_smart_money_momentum("AAPL", window_quarters=8)
        assert len(momentum["quarterly_momentum"]) >= 1


# =============================================================================
# Test Advanced 13F Methods
# =============================================================================


class TestTrackManagerPerformance:
    """Test track_manager_performance method."""

    @pytest.mark.asyncio
    async def test_performance_returns_dict(self, analyzer):
        """Test manager performance returns dictionary."""
        performance = await analyzer.track_manager_performance("0000102909")
        assert isinstance(performance, dict)

    @pytest.mark.asyncio
    async def test_performance_keys(self, analyzer):
        """Test manager performance has expected keys."""
        performance = await analyzer.track_manager_performance("0000102909")
        expected_keys = [
            "manager_cik",
            "lookback_quarters",
            "total_return",
            "annualized_return",
            "volatility",
            "sharpe_ratio",
            "max_drawdown",
            "win_rate",
            "quarterly_data",
            "performance_rank",
        ]
        for key in expected_keys:
            assert key in performance

    @pytest.mark.asyncio
    async def test_performance_custom_lookback(self, analyzer):
        """Test performance with custom lookback period."""
        performance = await analyzer.track_manager_performance(
            "0000102909", lookback_quarters=12
        )
        assert performance["lookback_quarters"] == 12


class TestDetectPositionClustering:
    """Test detect_position_clustering method."""

    @pytest.mark.asyncio
    async def test_clustering_returns_dataframe(self, analyzer):
        """Test position clustering returns DataFrame."""
        clustering = await analyzer.detect_position_clustering(
            ["AAPL", "MSFT", "GOOGL"]
        )
        assert isinstance(clustering, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_clustering_empty_symbols(self, analyzer):
        """Test clustering with empty symbols list."""
        clustering = await analyzer.detect_position_clustering([])
        assert isinstance(clustering, pd.DataFrame)
        assert clustering.empty


class TestGetConvictionPicks:
    """Test get_conviction_picks method."""

    @pytest.mark.asyncio
    async def test_conviction_returns_dataframe(self, analyzer):
        """Test conviction picks returns DataFrame."""
        conviction = await analyzer.get_conviction_picks()
        assert isinstance(conviction, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_conviction_with_min_weight(self, analyzer):
        """Test conviction picks with minimum weight filter."""
        conviction = await analyzer.get_conviction_picks(min_weight=0.10)
        assert isinstance(conviction, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_conviction_default_params(self, analyzer):
        """Test conviction picks with default parameters."""
        conviction = await analyzer.get_conviction_picks()
        assert isinstance(conviction, pd.DataFrame)
        if not conviction.empty:
            assert "symbol" in conviction.columns


class TestAnalyzePortfolioOverlap:
    """Test analyze_portfolio_overlap method."""

    @pytest.mark.asyncio
    async def test_overlap_returns_dict(self, analyzer):
        """Test portfolio overlap returns dictionary."""
        overlap = await analyzer.analyze_portfolio_overlap(["0000102909", "0001390777"])
        assert isinstance(overlap, dict)

    @pytest.mark.asyncio
    async def test_overlap_keys(self, analyzer):
        """Test portfolio overlap has expected keys."""
        overlap = await analyzer.analyze_portfolio_overlap(["0000102909", "0001390777"])
        expected_keys = [
            "manager_ciks",
            "overlap_matrix",
            "common_positions",
            "common_positions_count",
            "unique_positions",
            "average_overlap",
        ]
        for key in expected_keys:
            assert key in overlap

    @pytest.mark.asyncio
    async def test_overlap_single_manager(self, analyzer):
        """Test portfolio overlap with single manager."""
        overlap = await analyzer.analyze_portfolio_overlap(["0000102909"])
        assert overlap["average_overlap"] == 1.0


# =============================================================================
# Test Alert Methods
# =============================================================================


class TestAlertMethods:
    """Test alert methods."""

    @pytest.mark.asyncio
    async def test_new_positions_alert_returns_dataframe(self, analyzer):
        """Test new positions alert returns DataFrame."""
        alerts = await analyzer.get_new_positions_alert()
        assert isinstance(alerts, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_exit_positions_alert_returns_dataframe(self, analyzer):
        """Test exit positions alert returns DataFrame."""
        alerts = await analyzer.get_exit_positions_alert()
        assert isinstance(alerts, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_significant_changes_alert_returns_dataframe(self, analyzer):
        """Test significant changes alert returns DataFrame."""
        alerts = await analyzer.get_significant_changes_alert()
        assert isinstance(alerts, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_significant_changes_with_threshold(self, analyzer):
        """Test significant changes with custom threshold."""
        alerts = await analyzer.get_significant_changes_alert(threshold_pct=0.50)
        assert isinstance(alerts, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_coordinated_buying_alert_returns_dataframe(self, analyzer):
        """Test coordinated buying alert returns DataFrame."""
        alerts = await analyzer.get_coordinated_buying_alert()
        assert isinstance(alerts, pd.DataFrame)

    def test_concentration_risk_alert_returns_dataframe(self, analyzer):
        """Test concentration risk alert returns DataFrame."""
        alerts = analyzer.get_concentration_risk_alert()
        assert isinstance(alerts, pd.DataFrame)

    def test_concentration_risk_columns(self, analyzer):
        """Test concentration risk alert has expected columns."""
        alerts = analyzer.get_concentration_risk_alert()
        expected_cols = ["symbol", "top_holder_ownership", "hhi_score", "risk_level"]
        for col in expected_cols:
            assert col in alerts.columns


class TestCalculateSmartMoneyFlow:
    """Test calculate_smart_money_flow method."""

    @pytest.mark.asyncio
    async def test_smart_money_flow_returns_dict(self, analyzer):
        """Test smart money flow returns dictionary."""
        flow = await analyzer.calculate_smart_money_flow("AAPL")
        assert isinstance(flow, dict)

    @pytest.mark.asyncio
    async def test_smart_money_flow_keys(self, analyzer):
        """Test smart money flow has expected keys."""
        flow = await analyzer.calculate_smart_money_flow("AAPL")
        expected_keys = [
            "symbol",
            "net_flow",
            "weighted_flow",
            "signal",
            "signal_strength",
            "buyers_count",
            "sellers_count",
        ]
        for key in expected_keys:
            assert key in flow

    @pytest.mark.asyncio
    async def test_smart_money_flow_signal_values(self, analyzer):
        """Test smart money flow signal is valid."""
        flow = await analyzer.calculate_smart_money_flow("AAPL")
        valid_signals = ["accumulation", "distribution", "neutral"]
        assert flow["signal"] in valid_signals


# =============================================================================
# Test Private Async Methods
# =============================================================================


class TestPrivateAsyncMethods:
    """Test private async methods."""

    @pytest.mark.asyncio
    async def test_get_13f_holdings(self, analyzer):
        """Test _get_13f_holdings returns DataFrame."""
        holdings = await analyzer._get_13f_holdings("AAPL")
        assert isinstance(holdings, pd.DataFrame)
        assert not holdings.empty

    @pytest.mark.asyncio
    async def test_get_recent_institutional_changes(self, analyzer):
        """Test _get_recent_institutional_changes returns DataFrame."""
        changes = await analyzer._get_recent_institutional_changes("AAPL")
        assert isinstance(changes, pd.DataFrame)
        assert not changes.empty

    @pytest.mark.asyncio
    async def test_get_13f_filing(self, analyzer):
        """Test _get_13f_filing returns DataFrame."""
        filing = await analyzer._get_13f_filing("0000102909", "current")
        assert isinstance(filing, pd.DataFrame)
        assert not filing.empty

    @pytest.mark.asyncio
    async def test_get_previous_quarter_holdings(self, analyzer):
        """Test _get_previous_quarter_holdings returns DataFrame."""
        holdings = await analyzer._get_previous_quarter_holdings("AAPL")
        assert isinstance(holdings, pd.DataFrame)

    @pytest.mark.asyncio
    async def test_get_manager_aum_estimates(self, analyzer):
        """Test _get_manager_aum_estimates returns DataFrame."""
        aum = await analyzer._get_manager_aum_estimates()
        assert isinstance(aum, pd.DataFrame)
        assert "name" in aum.columns
        assert "aum" in aum.columns


# =============================================================================
# Test Health Check
# =============================================================================


class TestHealthCheck:
    """Test health_check method."""

    def test_health_check_returns_true(self, analyzer):
        """Test health check returns True."""
        assert analyzer.health_check() is True


# =============================================================================
# Test Edge Cases
# =============================================================================


class TestEdgeCases:
    """Edge case tests for InstitutionalAnalyzer."""

    @pytest.mark.asyncio
    async def test_large_universe_sentiment(self, analyzer):
        """Test sentiment with large stock universe."""
        universe = [f"STOCK{i}" for i in range(100)]
        sentiment = await analyzer.async_get_institutional_sentiment(universe)
        assert sentiment["universe_size"] == 100

    def test_calendar_large_quarters(self, analyzer):
        """Test calendar with large number of quarters."""
        calendar = analyzer.get_13f_filing_calendar(quarters_ahead=20)
        assert len(calendar) == 20

    @pytest.mark.asyncio
    async def test_multiple_manager_overlap(self, analyzer):
        """Test portfolio overlap with multiple managers."""
        ciks = ["0000102909", "0001390777", "0000093751", "0000315066"]
        overlap = await analyzer.analyze_portfolio_overlap(ciks)
        assert len(overlap["manager_ciks"]) == 4
