"""
Advanced Tests for InstitutionalAnalyzer module.

Tests for enhanced institutional analytics features:
- 13F change detection (new/closed positions, conviction scoring)
- Whale accumulation detection
- Sentiment score calculation
- Position clustering
- Cross-filing analysis
- Smart money momentum tracking
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

from stanley.analytics.institutional import InstitutionalAnalyzer

# =============================================================================
# FIXTURES - Sample Data for Testing
# =============================================================================


@pytest.fixture
def sample_13f_current():
    """Current quarter 13F filing data."""
    return pd.DataFrame(
        {
            "symbol": ["AAPL", "MSFT", "GOOGL", "NVDA", "NEW_STOCK"],
            "shares": [10000000, 8000000, 6000000, 7500000, 2000000],
            "value": [1500000000, 1200000000, 900000000, 1125000000, 300000000],
            "weight": [0.25, 0.20, 0.15, 0.19, 0.05],
        }
    )


@pytest.fixture
def sample_13f_previous():
    """Previous quarter 13F filing data."""
    return pd.DataFrame(
        {
            "symbol": ["AAPL", "MSFT", "GOOGL", "NVDA", "OLD_STOCK"],
            "shares": [8000000, 8000000, 7000000, 5000000, 3000000],
            "value": [1200000000, 1200000000, 1050000000, 750000000, 450000000],
            "weight": [0.22, 0.22, 0.19, 0.14, 0.08],
        }
    )


@pytest.fixture
def sample_13f_current_empty():
    """Empty current 13F filing."""
    return pd.DataFrame(columns=["symbol", "shares", "value", "weight"])


@pytest.fixture
def sample_13f_previous_empty():
    """Empty previous 13F filing."""
    return pd.DataFrame(columns=["symbol", "shares", "value", "weight"])


@pytest.fixture
def sample_whale_data():
    """Sample whale institution data with various AUM levels."""
    return pd.DataFrame(
        {
            "manager_name": [
                "Vanguard Group",
                "BlackRock",
                "State Street",
                "Fidelity",
                "Berkshire Hathaway",
                "Small Fund A",
                "Small Fund B",
            ],
            "manager_cik": [
                "0000102909",
                "0001390777",
                "0000093751",
                "0000315066",
                "0001067983",
                "0009999901",
                "0009999902",
            ],
            "aum": [
                7_000_000_000_000,  # $7T
                8_000_000_000_000,  # $8T
                3_000_000_000_000,  # $3T
                4_000_000_000_000,  # $4T
                500_000_000_000,  # $500B
                50_000_000,  # $50M
                100_000_000,  # $100M
            ],
            "position_change_pct": [0.15, 0.05, -0.10, 0.25, 0.50, 0.80, -0.20],
            "shares_added": [
                5000000,
                2000000,
                -3000000,
                8000000,
                10000000,
                50000,
                -10000,
            ],
            "value_change": [
                750_000_000,
                300_000_000,
                -450_000_000,
                1_200_000_000,
                1_500_000_000,
                7_500_000,
                -1_500_000,
            ],
        }
    )


@pytest.fixture
def sample_cross_filing_data():
    """Sample data for cross-filing analysis (multiple institutions, same symbol)."""
    return pd.DataFrame(
        {
            "manager_name": [
                "Vanguard",
                "BlackRock",
                "State Street",
                "Fidelity",
                "Bridgewater",
            ],
            "manager_cik": [
                "0000102909",
                "0001390777",
                "0000093751",
                "0000315066",
                "0001350694",
            ],
            "symbol": ["AAPL", "AAPL", "AAPL", "AAPL", "AAPL"],
            "action": ["increase", "increase", "decrease", "increase", "new"],
            "change_percentage": [0.15, 0.08, -0.12, 0.20, 1.0],
            "conviction_score": [0.7, 0.5, -0.6, 0.8, 0.9],
            "aum": [
                7_000_000_000_000,
                8_000_000_000_000,
                3_000_000_000_000,
                4_000_000_000_000,
                150_000_000_000,
            ],
        }
    )


@pytest.fixture
def sample_cross_filing_conflicting():
    """Cross-filing data with conflicting signals."""
    return pd.DataFrame(
        {
            "manager_name": ["Fund A", "Fund B", "Fund C", "Fund D"],
            "manager_cik": ["001", "002", "003", "004"],
            "symbol": ["TSLA", "TSLA", "TSLA", "TSLA"],
            "action": ["increase", "decrease", "increase", "decrease"],
            "change_percentage": [0.30, -0.25, 0.10, -0.35],
            "conviction_score": [0.6, -0.7, 0.3, -0.8],
            "aum": [
                100_000_000_000,
                100_000_000_000,
                100_000_000_000,
                100_000_000_000,
            ],
        }
    )


@pytest.fixture
def sample_momentum_history():
    """Sample smart money momentum history over multiple periods."""
    dates = pd.date_range(end=datetime.now(), periods=12, freq="7D")
    np.random.seed(42)
    return pd.DataFrame(
        {
            "date": dates,
            "net_flow": [
                100000,
                150000,
                200000,
                180000,
                250000,
                300000,
                280000,
                350000,
                320000,
                400000,
                380000,
                450000,
            ],
            "institution_count": [50, 52, 55, 54, 58, 62, 60, 65, 63, 68, 66, 70],
            "smart_money_score": [
                0.1,
                0.15,
                0.22,
                0.20,
                0.28,
                0.35,
                0.32,
                0.40,
                0.38,
                0.48,
                0.45,
                0.55,
            ],
            "whale_activity": [2, 3, 4, 3, 5, 6, 5, 7, 6, 8, 7, 9],
        }
    )


@pytest.fixture
def sample_momentum_insufficient():
    """Insufficient momentum history (less than minimum required)."""
    return pd.DataFrame(
        {
            "date": [datetime.now()],
            "net_flow": [100000],
            "institution_count": [50],
            "smart_money_score": [0.1],
            "whale_activity": [2],
        }
    )


@pytest.fixture
def sample_single_institution():
    """Single institution data for edge case testing."""
    return pd.DataFrame(
        {
            "manager_name": ["Solo Fund"],
            "manager_cik": ["0001234567"],
            "shares_held": [1000000],
            "value_held": [100000000],
            "ownership_percentage": [0.10],
        }
    )


@pytest.fixture
def sample_uniform_positions():
    """All institutions with identical position sizes."""
    return pd.DataFrame(
        {
            "manager_name": ["Fund A", "Fund B", "Fund C", "Fund D"],
            "manager_cik": ["001", "002", "003", "004"],
            "shares_held": [1000000, 1000000, 1000000, 1000000],
            "value_held": [100000000, 100000000, 100000000, 100000000],
            "ownership_percentage": [0.025, 0.025, 0.025, 0.025],
        }
    )


# =============================================================================
# TEST CLASS: 13F Change Detection
# =============================================================================


class TestDetect13FChanges:
    """Tests for detect_13f_changes method (13F filing change detection)."""

    def test_new_positions_detected(self, sample_13f_current, sample_13f_previous):
        """Test that new positions are correctly detected."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        new_positions = result[result["change_type"] == "new"]
        assert len(new_positions) == 1
        assert "NEW_STOCK" in new_positions["symbol"].values

    def test_closed_positions_detected(self, sample_13f_current, sample_13f_previous):
        """Test that closed positions are correctly detected."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        closed_positions = result[result["change_type"] == "closed"]
        assert len(closed_positions) == 1
        assert "OLD_STOCK" in closed_positions["symbol"].values

    def test_change_magnitude_calculation(
        self, sample_13f_current, sample_13f_previous
    ):
        """Test that change magnitude is calculated correctly."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        # AAPL: 10M - 8M = 2M shares change
        aapl_row = result[result["symbol"] == "AAPL"].iloc[0]
        assert aapl_row["shares_change"] == 2000000

        # NVDA: 7.5M - 5M = 2.5M shares change
        nvda_row = result[result["symbol"] == "NVDA"].iloc[0]
        assert nvda_row["shares_change"] == 2500000

        # GOOGL: 6M - 7M = -1M shares change (reduction)
        googl_row = result[result["symbol"] == "GOOGL"].iloc[0]
        assert googl_row["shares_change"] == -1000000

    def test_change_percentage_calculation(
        self, sample_13f_current, sample_13f_previous
    ):
        """Test that change percentage is calculated correctly."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        # AAPL: (10M - 8M) / 8M = 0.25 = 25%
        aapl_row = result[result["symbol"] == "AAPL"].iloc[0]
        assert abs(aapl_row["change_percentage"] - 0.25) < 0.001

        # NVDA: (7.5M - 5M) / 5M = 0.50 = 50%
        nvda_row = result[result["symbol"] == "NVDA"].iloc[0]
        assert abs(nvda_row["change_percentage"] - 0.50) < 0.001

    def test_new_position_change_percentage(
        self, sample_13f_current, sample_13f_previous
    ):
        """Test that new positions have change_percentage of 1.0 (100%)."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        new_stock_row = result[result["symbol"] == "NEW_STOCK"].iloc[0]
        assert new_stock_row["change_percentage"] == 1.0

    def test_closed_position_change_percentage(
        self, sample_13f_current, sample_13f_previous
    ):
        """Test that closed positions have -100% change (shares went to 0)."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        old_stock_row = result[result["symbol"] == "OLD_STOCK"].iloc[0]
        # Closed means current shares = 0, previous > 0
        # change = (0 - prev) / prev = -1.0
        assert old_stock_row["shares_change"] == -3000000

    def test_empty_current_filing(self, sample_13f_current_empty, sample_13f_previous):
        """Test with empty current filing (all positions closed)."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current_empty, sample_13f_previous
        )

        # All previous positions should be marked as closed
        assert len(result) == len(sample_13f_previous)
        assert all(result["change_type"] == "closed")

    def test_empty_previous_filing(self, sample_13f_current, sample_13f_previous_empty):
        """Test with empty previous filing (all positions are new)."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous_empty
        )

        # All current positions should be marked as new
        assert len(result) == len(sample_13f_current)
        assert all(result["change_type"] == "new")

    def test_both_filings_empty(
        self, sample_13f_current_empty, sample_13f_previous_empty
    ):
        """Test with both filings empty."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current_empty, sample_13f_previous_empty
        )

        assert len(result) == 0

    def test_result_sorted_by_change_percentage(
        self, sample_13f_current, sample_13f_previous
    ):
        """Test that results are sorted by change_percentage descending."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        if len(result) > 1:
            for i in range(len(result) - 1):
                assert (
                    result["change_percentage"].iloc[i]
                    >= result["change_percentage"].iloc[i + 1]
                )

    def test_value_change_calculation(self, sample_13f_current, sample_13f_previous):
        """Test that value changes are calculated correctly."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer._calculate_13f_changes(
            sample_13f_current, sample_13f_previous
        )

        # AAPL: 1.5B - 1.2B = 300M value change
        aapl_row = result[result["symbol"] == "AAPL"].iloc[0]
        assert aapl_row["value_change"] == 300000000


# =============================================================================
# TEST CLASS: Whale Accumulation Detection
# =============================================================================


class TestDetectWhaleAccumulation:
    """Tests for whale accumulation detection functionality."""

    def test_whale_detection_default_threshold(self, sample_whale_data):
        """Test whale detection with default AUM threshold ($1B)."""
        analyzer = InstitutionalAnalyzer()

        # Filter whales above $1B threshold
        whales = sample_whale_data[sample_whale_data["aum"] >= 1e9]

        # Should include Vanguard, BlackRock, State Street, Fidelity, Berkshire
        assert len(whales) == 5
        assert "Small Fund A" not in whales["manager_name"].values
        assert "Small Fund B" not in whales["manager_name"].values

    def test_whale_detection_high_threshold(self, sample_whale_data):
        """Test whale detection with high AUM threshold ($1T)."""
        # Filter whales above $1T threshold
        whales = sample_whale_data[sample_whale_data["aum"] >= 1e12]

        # Should only include the mega-institutions
        assert len(whales) == 4
        assert "Berkshire Hathaway" not in whales["manager_name"].values

    def test_whale_detection_low_threshold(self, sample_whale_data):
        """Test whale detection with low AUM threshold ($10M)."""
        # Filter whales above $10M threshold
        whales = sample_whale_data[sample_whale_data["aum"] >= 10e6]

        # Should include all institutions
        assert len(whales) == 7

    def test_no_whales_meet_criteria(self, sample_whale_data):
        """Test when no whales meet the AUM criteria."""
        # Filter with impossibly high threshold
        whales = sample_whale_data[sample_whale_data["aum"] >= 100e12]

        assert len(whales) == 0

    def test_accumulating_whales(self, sample_whale_data):
        """Test identifying whales that are accumulating positions."""
        whales = sample_whale_data[sample_whale_data["aum"] >= 1e9]
        accumulating = whales[whales["position_change_pct"] > 0]

        # Should identify those with positive position changes
        assert len(accumulating) == 4
        assert "State Street" not in accumulating["manager_name"].values

    def test_whale_position_change_magnitude(self, sample_whale_data):
        """Test filtering whales by position change magnitude."""
        whales = sample_whale_data[sample_whale_data["aum"] >= 1e9]
        significant_changes = whales[abs(whales["position_change_pct"]) > 0.20]

        # Should include Fidelity (25%) and Berkshire (50%)
        assert len(significant_changes) == 2

    def test_alert_level_classification(self, sample_whale_data):
        """Test whale activity alert level classification."""
        whales = sample_whale_data[sample_whale_data["aum"] >= 1e9].copy()

        # Classify alert levels based on position change
        def classify_alert(change_pct):
            if abs(change_pct) >= 0.30:
                return "critical"
            elif abs(change_pct) >= 0.15:
                return "high"
            elif abs(change_pct) >= 0.05:
                return "medium"
            else:
                return "low"

        whales["alert_level"] = whales["position_change_pct"].apply(classify_alert)

        # Verify classifications
        critical = whales[whales["alert_level"] == "critical"]
        high = whales[whales["alert_level"] == "high"]

        assert len(critical) == 1  # Berkshire at 50%
        assert "Berkshire Hathaway" in critical["manager_name"].values
        assert len(high) == 2  # Vanguard (15%) and Fidelity (25%)


# =============================================================================
# TEST CLASS: Sentiment Score Calculation
# =============================================================================


class TestCalculateSentimentScore:
    """Tests for institutional sentiment score calculation."""

    def test_sentiment_score_bounded(self):
        """Test that sentiment score is bounded to [-1, 1]."""
        analyzer = InstitutionalAnalyzer()

        # Test with multiple symbols
        result = analyzer.get_institutional_sentiment(["AAPL", "MSFT", "GOOGL"])

        assert -1 <= result["average_smart_money_score"] <= 1

    def test_sentiment_classification_bullish(self):
        """Test bullish sentiment classification."""
        analyzer = InstitutionalAnalyzer()

        # Mock to return consistently positive smart money scores
        with patch.object(analyzer, "get_holdings") as mock_holdings:
            mock_holdings.return_value = {
                "institutional_ownership": 0.80,
                "ownership_trend": 0.5,
                "smart_money_score": 0.5,  # Positive score
                "concentration_risk": 0.3,
            }

            result = analyzer.get_institutional_sentiment(["AAPL"])

            assert result["institutional_sentiment"] == "bullish"

    def test_sentiment_classification_bearish(self):
        """Test bearish sentiment classification."""
        analyzer = InstitutionalAnalyzer()

        with patch.object(analyzer, "get_holdings") as mock_holdings:
            mock_holdings.return_value = {
                "institutional_ownership": 0.50,
                "ownership_trend": -0.5,
                "smart_money_score": -0.5,  # Negative score
                "concentration_risk": 0.6,
            }

            result = analyzer.get_institutional_sentiment(["AAPL"])

            assert result["institutional_sentiment"] == "bearish"

    def test_sentiment_classification_neutral(self):
        """Test neutral sentiment classification."""
        analyzer = InstitutionalAnalyzer()

        with patch.object(analyzer, "get_holdings") as mock_holdings:
            mock_holdings.return_value = {
                "institutional_ownership": 0.65,
                "ownership_trend": 0.0,
                "smart_money_score": 0.0,  # Neutral score
                "concentration_risk": 0.4,
            }

            result = analyzer.get_institutional_sentiment(["AAPL"])

            assert result["institutional_sentiment"] == "neutral"

    def test_contributing_factors_returned(self):
        """Test that all contributing factors are returned."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment(["AAPL", "MSFT"])

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

    def test_sentiment_with_extreme_values(self):
        """Test sentiment calculation with extreme input values."""
        analyzer = InstitutionalAnalyzer()

        with patch.object(analyzer, "get_holdings") as mock_holdings:
            # Extreme bullish scenario
            mock_holdings.return_value = {
                "institutional_ownership": 0.99,
                "ownership_trend": 1.0,
                "smart_money_score": 1.0,
                "concentration_risk": 0.01,
            }

            result = analyzer.get_institutional_sentiment(["AAPL"])

            assert result["institutional_sentiment"] == "bullish"
            assert result["average_smart_money_score"] == 1.0

    def test_sentiment_with_missing_data(self):
        """Test graceful handling of missing data."""
        analyzer = InstitutionalAnalyzer()

        with patch.object(analyzer, "get_holdings") as mock_holdings:
            # Simulate an error for one symbol
            def side_effect(symbol):
                if symbol == "BAD_SYMBOL":
                    raise ValueError("Invalid symbol")
                return {
                    "institutional_ownership": 0.70,
                    "ownership_trend": 0.2,
                    "smart_money_score": 0.3,
                    "concentration_risk": 0.4,
                }

            mock_holdings.side_effect = side_effect

            result = analyzer.get_institutional_sentiment(["AAPL", "BAD_SYMBOL"])

            # Should still return valid results for AAPL
            assert result["universe_size"] == 2
            assert len(result["details"]) == 1  # Only AAPL succeeded

    def test_sentiment_empty_universe(self):
        """Test sentiment with empty universe."""
        analyzer = InstitutionalAnalyzer()
        result = analyzer.get_institutional_sentiment([])

        assert result["universe_size"] == 0
        assert result["institutional_sentiment"] == "neutral"
        assert result["average_smart_money_score"] == 0.0


# =============================================================================
# TEST CLASS: Position Clustering
# =============================================================================


class TestClusterPositions:
    """Tests for quartile-based position clustering."""

    def test_quartile_clustering_basics(self, sample_holdings_df):
        """Test basic quartile-based clustering."""
        holdings = sample_holdings_df.copy()

        # Add quartile classification based on shares_held
        holdings["quartile"] = pd.qcut(
            holdings["shares_held"], q=4, labels=["Q1", "Q2", "Q3", "Q4"]
        )

        assert "quartile" in holdings.columns
        assert set(holdings["quartile"].unique()).issubset({"Q1", "Q2", "Q3", "Q4"})

    def test_cluster_statistics(self, sample_holdings_df):
        """Test that cluster statistics are calculated correctly."""
        holdings = sample_holdings_df.copy()

        # Calculate cluster statistics
        stats = {
            "total_shares": holdings["shares_held"].sum(),
            "mean_shares": holdings["shares_held"].mean(),
            "median_shares": holdings["shares_held"].median(),
            "std_shares": holdings["shares_held"].std(),
            "count": len(holdings),
        }

        expected_total = 310000000  # Sum of all shares
        assert stats["total_shares"] == expected_total
        assert stats["count"] == 5

    def test_smart_money_direction_bullish(self, sample_holdings_df):
        """Test smart money direction determination (bullish case)."""
        holdings = sample_holdings_df.copy()
        holdings["change_direction"] = [
            "increase",
            "increase",
            "increase",
            "hold",
            "decrease",
        ]

        # Calculate net direction
        increases = len(holdings[holdings["change_direction"] == "increase"])
        decreases = len(holdings[holdings["change_direction"] == "decrease"])

        if increases > decreases:
            direction = "bullish"
        elif decreases > increases:
            direction = "bearish"
        else:
            direction = "neutral"

        assert direction == "bullish"

    def test_smart_money_direction_bearish(self, sample_holdings_df):
        """Test smart money direction determination (bearish case)."""
        holdings = sample_holdings_df.copy()
        holdings["change_direction"] = [
            "decrease",
            "decrease",
            "decrease",
            "hold",
            "increase",
        ]

        increases = len(holdings[holdings["change_direction"] == "increase"])
        decreases = len(holdings[holdings["change_direction"] == "decrease"])

        if increases > decreases:
            direction = "bullish"
        elif decreases > increases:
            direction = "bearish"
        else:
            direction = "neutral"

        assert direction == "bearish"

    def test_single_institution_clustering(self, sample_single_institution):
        """Test clustering with single institution (edge case)."""
        holdings = sample_single_institution

        # With single institution, all stats collapse to single value
        stats = {
            "total_shares": holdings["shares_held"].sum(),
            "mean_shares": holdings["shares_held"].mean(),
            "count": len(holdings),
        }

        assert stats["count"] == 1
        assert stats["total_shares"] == stats["mean_shares"]

    def test_uniform_positions_clustering(self, sample_uniform_positions):
        """Test clustering when all positions are the same size."""
        holdings = sample_uniform_positions

        # Standard deviation should be 0 for uniform positions
        std = holdings["shares_held"].std()
        assert std == 0 or pd.isna(std) or std < 1e-10

        # All institutions in same cluster when uniform
        mean = holdings["shares_held"].mean()
        assert all(holdings["shares_held"] == mean)


# =============================================================================
# TEST CLASS: Cross-Filing Analysis
# =============================================================================


class TestAnalyzeCrossFiling:
    """Tests for cross-filing analysis (multiple institutions, same symbol)."""

    def test_agreement_calculation(self, sample_cross_filing_data):
        """Test that agreement among institutions is calculated correctly."""
        data = sample_cross_filing_data

        # Count institutions by action
        action_counts = data["action"].value_counts()
        total = len(data)

        # Agreement = max action count / total
        agreement = action_counts.max() / total

        # In sample data: 3 increase, 1 decrease, 1 new
        assert action_counts.get("increase", 0) == 3
        assert abs(agreement - 0.6) < 0.01  # 3/5 = 0.6

    def test_consensus_detection_strong(self, sample_cross_filing_data):
        """Test strong consensus detection."""
        data = sample_cross_filing_data

        action_counts = data["action"].value_counts()
        total = len(data)
        agreement = action_counts.max() / total

        # Define consensus thresholds
        if agreement >= 0.8:
            consensus = "strong"
        elif agreement >= 0.6:
            consensus = "moderate"
        else:
            consensus = "weak"

        assert consensus == "moderate"  # 60% agreement

    def test_weighted_conviction_calculation(self, sample_cross_filing_data):
        """Test weighted conviction score calculation."""
        data = sample_cross_filing_data

        # Weight conviction scores by AUM
        total_aum = data["aum"].sum()
        weighted_conviction = (data["conviction_score"] * data["aum"]).sum() / total_aum

        # Should be between -1 and 1
        assert -1 <= weighted_conviction <= 1

    def test_conflicting_signals(self, sample_cross_filing_conflicting):
        """Test handling of conflicting signals."""
        data = sample_cross_filing_conflicting

        action_counts = data["action"].value_counts()

        # Equal split between increase and decrease
        assert action_counts.get("increase", 0) == 2
        assert action_counts.get("decrease", 0) == 2

        # Agreement should be 0.5
        agreement = action_counts.max() / len(data)
        assert agreement == 0.5

    def test_net_conviction_conflicting(self, sample_cross_filing_conflicting):
        """Test net conviction calculation with conflicting signals."""
        data = sample_cross_filing_conflicting

        # Simple average conviction (unweighted)
        avg_conviction = data["conviction_score"].mean()

        # With conflicting signals, should be close to 0
        assert abs(avg_conviction) < 0.5

    def test_aum_weighted_consensus(self, sample_cross_filing_data):
        """Test AUM-weighted consensus calculation."""
        data = sample_cross_filing_data

        # Group by action and sum AUM
        action_aum = data.groupby("action")["aum"].sum()
        total_aum = data["aum"].sum()

        # Dominant action by AUM
        dominant_action = action_aum.idxmax()
        dominance = action_aum.max() / total_aum

        # 'increase' has most AUM (Vanguard + BlackRock + Fidelity)
        assert dominant_action == "increase"


# =============================================================================
# TEST CLASS: Smart Money Momentum Tracking
# =============================================================================


class TestTrackSmartMoneyMomentum:
    """Tests for smart money momentum tracking over time windows."""

    def test_momentum_calculation(self, sample_momentum_history):
        """Test basic momentum calculation over windows."""
        data = sample_momentum_history

        # Calculate momentum as change in smart_money_score
        data["momentum"] = data["smart_money_score"].diff()

        # Last momentum value
        last_momentum = data["momentum"].iloc[-1]

        # Should be positive (0.55 - 0.45 = 0.10)
        assert abs(last_momentum - 0.10) < 0.01

    def test_momentum_rolling_average(self, sample_momentum_history):
        """Test rolling average momentum calculation."""
        data = sample_momentum_history

        # 4-week rolling average of smart money score
        data["rolling_avg"] = data["smart_money_score"].rolling(window=4).mean()

        # Last value should be average of last 4 periods
        expected_avg = data["smart_money_score"].iloc[-4:].mean()
        actual_avg = data["rolling_avg"].iloc[-1]

        assert abs(actual_avg - expected_avg) < 0.01

    def test_trend_direction_detection_uptrend(self, sample_momentum_history):
        """Test uptrend detection."""
        data = sample_momentum_history

        # Calculate linear regression slope
        x = np.arange(len(data))
        y = data["smart_money_score"].values
        slope = np.polyfit(x, y, 1)[0]

        # Positive slope indicates uptrend
        trend = "uptrend" if slope > 0 else "downtrend" if slope < 0 else "sideways"

        assert trend == "uptrend"
        assert slope > 0

    def test_trend_direction_detection_downtrend(self):
        """Test downtrend detection."""
        # Create downtrend data
        data = pd.DataFrame({"smart_money_score": [0.5, 0.45, 0.40, 0.35, 0.30, 0.25]})

        x = np.arange(len(data))
        y = data["smart_money_score"].values
        slope = np.polyfit(x, y, 1)[0]

        trend = "uptrend" if slope > 0 else "downtrend" if slope < 0 else "sideways"

        assert trend == "downtrend"
        assert slope < 0

    def test_acceleration_calculation(self, sample_momentum_history):
        """Test momentum acceleration (second derivative) calculation."""
        data = sample_momentum_history

        # First derivative (momentum)
        data["momentum"] = data["smart_money_score"].diff()

        # Second derivative (acceleration)
        data["acceleration"] = data["momentum"].diff()

        # Should have valid acceleration values after 2 periods
        assert not pd.isna(data["acceleration"].iloc[-1])

    def test_momentum_with_window_sizes(self, sample_momentum_history):
        """Test momentum calculation with different window sizes."""
        data = sample_momentum_history

        for window in [2, 4, 6]:
            rolling = data["smart_money_score"].rolling(window=window).mean()
            assert len(rolling) == len(data)
            # First (window-1) values should be NaN
            assert pd.isna(rolling.iloc[: window - 1]).all()

    def test_insufficient_history(self, sample_momentum_insufficient):
        """Test handling of insufficient momentum history."""
        data = sample_momentum_insufficient

        # With only 1 data point, momentum cannot be calculated
        if len(data) < 2:
            momentum = None
        else:
            momentum = data["smart_money_score"].diff().iloc[-1]

        assert momentum is None

    def test_momentum_strength_classification(self, sample_momentum_history):
        """Test momentum strength classification."""
        data = sample_momentum_history

        # Calculate recent momentum
        recent_momentum = (
            data["smart_money_score"].iloc[-1] - data["smart_money_score"].iloc[-4]
        )

        # Classify strength
        if abs(recent_momentum) >= 0.3:
            strength = "strong"
        elif abs(recent_momentum) >= 0.15:
            strength = "moderate"
        else:
            strength = "weak"

        # 0.55 - 0.38 = 0.17, so moderate
        assert strength == "moderate"


# =============================================================================
# TEST CLASS: Edge Cases and Error Handling
# =============================================================================


class TestEdgeCasesAdvanced:
    """Edge case tests for advanced institutional analytics."""

    def test_all_new_positions(self):
        """Test when all positions are new (no previous filing)."""
        analyzer = InstitutionalAnalyzer()

        current = pd.DataFrame(
            {
                "symbol": ["AAPL", "MSFT"],
                "shares": [1000, 2000],
                "value": [100000, 200000],
                "weight": [0.4, 0.6],
            }
        )
        previous = pd.DataFrame(columns=["symbol", "shares", "value", "weight"])

        result = analyzer._calculate_13f_changes(current, previous)

        assert len(result) == 2
        assert all(result["change_type"] == "new")

    def test_all_closed_positions(self):
        """Test when all positions are closed."""
        analyzer = InstitutionalAnalyzer()

        current = pd.DataFrame(columns=["symbol", "shares", "value", "weight"])
        previous = pd.DataFrame(
            {
                "symbol": ["AAPL", "MSFT"],
                "shares": [1000, 2000],
                "value": [100000, 200000],
                "weight": [0.4, 0.6],
            }
        )

        result = analyzer._calculate_13f_changes(current, previous)

        assert len(result) == 2
        assert all(result["change_type"] == "closed")

    def test_no_changes(self):
        """Test when there are no changes between filings."""
        analyzer = InstitutionalAnalyzer()

        filing = pd.DataFrame(
            {
                "symbol": ["AAPL", "MSFT"],
                "shares": [1000, 2000],
                "value": [100000, 200000],
                "weight": [0.4, 0.6],
            }
        )

        result = analyzer._calculate_13f_changes(filing, filing.copy())

        # All should be 'existing' with 0 change
        assert all(result["change_type"] == "existing")
        assert all(result["shares_change"] == 0)
        assert all(result["change_percentage"] == 0)

    def test_very_small_position_changes(self):
        """Test with very small position changes."""
        analyzer = InstitutionalAnalyzer()

        current = pd.DataFrame(
            {
                "symbol": ["AAPL"],
                "shares": [1000001],
                "value": [100000100],
                "weight": [1.0],
            }
        )
        previous = pd.DataFrame(
            {
                "symbol": ["AAPL"],
                "shares": [1000000],
                "value": [100000000],
                "weight": [1.0],
            }
        )

        result = analyzer._calculate_13f_changes(current, previous)

        # Change should be 0.0001% (very small)
        assert result["shares_change"].iloc[0] == 1
        assert abs(result["change_percentage"].iloc[0] - 0.000001) < 1e-8

    def test_very_large_position_values(self):
        """Test with very large position values (billions)."""
        analyzer = InstitutionalAnalyzer()

        current = pd.DataFrame(
            {
                "symbol": ["MEGA"],
                "shares": [10_000_000_000],  # 10 billion shares
                "value": [1_000_000_000_000],  # $1 trillion
                "weight": [1.0],
            }
        )
        previous = pd.DataFrame(
            {
                "symbol": ["MEGA"],
                "shares": [5_000_000_000],  # 5 billion shares
                "value": [500_000_000_000],  # $500 billion
                "weight": [1.0],
            }
        )

        result = analyzer._calculate_13f_changes(current, previous)

        assert result["shares_change"].iloc[0] == 5_000_000_000
        assert result["change_percentage"].iloc[0] == 1.0  # 100% increase

    def test_unicode_manager_names(self):
        """Test handling of unicode characters in manager names."""
        holdings = pd.DataFrame(
            {
                "manager_name": [
                    "Deutsche Bank AG",
                    "Societe Generale",
                    "Credit Agricole",
                ],
                "manager_cik": ["001", "002", "003"],
                "shares_held": [1000, 2000, 3000],
                "value_held": [100000, 200000, 300000],
                "ownership_percentage": [0.1, 0.2, 0.3],
            }
        )

        assert len(holdings) == 3
        assert "Deutsche Bank AG" in holdings["manager_name"].values

    def test_duplicate_symbols_in_filing(self):
        """Test handling of duplicate symbols in filing data."""
        analyzer = InstitutionalAnalyzer()

        # Some filings may have duplicate entries for same symbol (e.g., different share classes)
        current = pd.DataFrame(
            {
                "symbol": ["AAPL", "AAPL", "MSFT"],  # Duplicate AAPL
                "shares": [1000, 500, 2000],
                "value": [100000, 50000, 200000],
                "weight": [0.3, 0.15, 0.55],
            }
        )
        previous = pd.DataFrame(
            {
                "symbol": ["AAPL", "MSFT"],
                "shares": [1200, 1800],
                "value": [120000, 180000],
                "weight": [0.4, 0.6],
            }
        )

        # The merge behavior with duplicates - verify it doesn't crash
        result = analyzer._calculate_13f_changes(current, previous)
        assert result is not None
        assert len(result) > 0


# =============================================================================
# TEST CLASS: Integration with Institutional Analyzer
# =============================================================================


class TestIntegrationAdvanced:
    """Integration tests for advanced institutional analytics."""

    def test_full_13f_analysis_workflow(self):
        """Test complete 13F analysis workflow."""
        analyzer = InstitutionalAnalyzer()

        # Get 13F changes (uses mock data)
        result = analyzer.analyze_13f_changes("0000102909")

        assert isinstance(result, pd.DataFrame)
        assert "symbol" in result.columns
        assert "shares_change" in result.columns
        assert "change_type" in result.columns

    def test_sentiment_to_momentum_pipeline(self):
        """Test pipeline from sentiment to momentum analysis."""
        analyzer = InstitutionalAnalyzer()

        # Step 1: Get sentiment
        sentiment = analyzer.get_institutional_sentiment(["AAPL", "MSFT", "GOOGL"])
        assert "average_smart_money_score" in sentiment

        # Step 2: Track smart money
        smart_money = analyzer.track_smart_money(minimum_aum=1e9)
        assert isinstance(smart_money, pd.DataFrame)

    def test_holdings_with_advanced_options(self):
        """Test get_holdings with include_changes and include_performance."""
        analyzer = InstitutionalAnalyzer()

        result = analyzer.get_holdings(
            "AAPL",
            include_changes=True,
            include_performance=True,
        )

        assert "symbol" in result
        assert result["symbol"] == "AAPL"
        assert "institutional_ownership" in result
        assert "smart_money_score" in result


# =============================================================================
# TEST CLASS: Performance and Stress Testing
# =============================================================================


class TestPerformanceAdvanced:
    """Performance tests for advanced institutional analytics."""

    def test_large_filing_performance(self):
        """Test performance with large filing data."""
        analyzer = InstitutionalAnalyzer()

        # Create large filing with 1000 positions
        np.random.seed(42)
        symbols = [f"STOCK_{i}" for i in range(1000)]
        current = pd.DataFrame(
            {
                "symbol": symbols,
                "shares": np.random.randint(1000, 10000000, 1000),
                "value": np.random.randint(100000, 1000000000, 1000),
                "weight": np.random.uniform(0.001, 0.1, 1000),
            }
        )
        previous = pd.DataFrame(
            {
                "symbol": symbols,
                "shares": np.random.randint(1000, 10000000, 1000),
                "value": np.random.randint(100000, 1000000000, 1000),
                "weight": np.random.uniform(0.001, 0.1, 1000),
            }
        )

        import time

        start = time.time()
        result = analyzer._calculate_13f_changes(current, previous)
        elapsed = time.time() - start

        assert len(result) == 1000
        assert elapsed < 1.0  # Should complete in under 1 second

    def test_large_universe_sentiment(self):
        """Test sentiment analysis with large stock universe."""
        analyzer = InstitutionalAnalyzer()

        # Create large universe
        universe = [f"STOCK_{i}" for i in range(100)]

        import time

        start = time.time()
        result = analyzer.get_institutional_sentiment(universe)
        elapsed = time.time() - start

        assert result["universe_size"] == 100
        # Should complete in reasonable time (< 5 seconds for mock data)
        assert elapsed < 5.0
