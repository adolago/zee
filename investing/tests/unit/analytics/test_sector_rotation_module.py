"""
Unit tests for SectorRotationAnalyzer.
"""

import asyncio
import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from investing.analytics.sector_rotation import (
    SectorRotationAnalyzer,
    BusinessCyclePhase,
    SECTOR_ETFS,
    CYCLE_SECTOR_MAP,
    RISK_ON_SECTORS,
    RISK_OFF_SECTORS,
)


def run_async(coro):
    """Helper to run async coroutines in sync tests.

    Python 3.11+ no longer creates an implicit default event loop for the main
    thread, so `asyncio.get_event_loop()` can raise. `asyncio.run(...)` is the
    supported way to execute a coroutine from synchronous code.
    """
    return asyncio.run(coro)


@pytest.fixture
def mock_data_manager():
    """Create a mock data manager."""
    manager = AsyncMock()
    return manager


@pytest.fixture
def analyzer():
    """Create a SectorRotationAnalyzer without data manager (uses mock data)."""
    return SectorRotationAnalyzer()


@pytest.fixture
def analyzer_with_manager(mock_data_manager):
    """Create a SectorRotationAnalyzer with mock data manager."""
    return SectorRotationAnalyzer(data_manager=mock_data_manager)


class TestSectorRotationAnalyzerInit:
    """Tests for SectorRotationAnalyzer initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data manager."""
        analyzer = SectorRotationAnalyzer()
        assert analyzer.data_manager is None
        assert analyzer.sector_etfs == SECTOR_ETFS
        assert analyzer.cycle_sector_map == CYCLE_SECTOR_MAP

    def test_init_with_data_manager(self, mock_data_manager):
        """Test initialization with data manager."""
        analyzer = SectorRotationAnalyzer(data_manager=mock_data_manager)
        assert analyzer.data_manager is mock_data_manager


class TestSectorETFDefinitions:
    """Tests for sector ETF definitions."""

    def test_sector_etfs_contains_expected_symbols(self):
        """Test that all expected sector ETFs are defined."""
        expected_symbols = [
            "XLK",
            "XLF",
            "XLE",
            "XLV",
            "XLY",
            "XLP",
            "XLI",
            "XLB",
            "XLU",
            "XLRE",
            "XLC",
        ]
        for symbol in expected_symbols:
            assert symbol in SECTOR_ETFS

    def test_business_cycle_mapping(self):
        """Test that business cycle phases have appropriate sectors."""
        # Early cycle should have Financials and Consumer Discretionary
        assert "XLF" in CYCLE_SECTOR_MAP[BusinessCyclePhase.EARLY_CYCLE]
        assert "XLY" in CYCLE_SECTOR_MAP[BusinessCyclePhase.EARLY_CYCLE]

        # Mid cycle should have Technology and Industrials
        assert "XLK" in CYCLE_SECTOR_MAP[BusinessCyclePhase.MID_CYCLE]
        assert "XLI" in CYCLE_SECTOR_MAP[BusinessCyclePhase.MID_CYCLE]

        # Late cycle should have Energy and Materials
        assert "XLE" in CYCLE_SECTOR_MAP[BusinessCyclePhase.LATE_CYCLE]
        assert "XLB" in CYCLE_SECTOR_MAP[BusinessCyclePhase.LATE_CYCLE]

        # Recession should have defensive sectors
        assert "XLU" in CYCLE_SECTOR_MAP[BusinessCyclePhase.RECESSION]
        assert "XLV" in CYCLE_SECTOR_MAP[BusinessCyclePhase.RECESSION]
        assert "XLP" in CYCLE_SECTOR_MAP[BusinessCyclePhase.RECESSION]

    def test_risk_on_off_classification(self):
        """Test that risk-on and risk-off sectors are mutually exclusive."""
        risk_on_set = set(RISK_ON_SECTORS)
        risk_off_set = set(RISK_OFF_SECTORS)

        # No overlap between risk-on and risk-off
        assert len(risk_on_set & risk_off_set) == 0

        # Together they should cover most sectors
        all_sectors = risk_on_set | risk_off_set
        assert len(all_sectors) >= 10


class TestAnalyzeRotation:
    """Tests for analyze_rotation method."""

    def test_analyze_rotation_returns_expected_keys(self, analyzer):
        """Test that analyze_rotation returns expected dictionary keys."""
        result = run_async(analyzer.analyze_rotation(lookback_days=63))

        assert "sector_performance" in result
        assert "rotation_scores" in result
        assert "phase_alignment" in result
        assert "leadership" in result
        assert "analysis_period" in result

    def test_analyze_rotation_with_custom_lookback(self, analyzer):
        """Test analyze_rotation with custom lookback period."""
        result = run_async(analyzer.analyze_rotation(lookback_days=21))

        assert result["analysis_period"]["days"] == 21

    def test_analyze_rotation_phase_alignment_structure(self, analyzer):
        """Test that phase alignment has correct structure."""
        result = run_async(analyzer.analyze_rotation())

        phase_alignment = result["phase_alignment"]
        assert "phase" in phase_alignment
        assert "confidence" in phase_alignment


class TestGetSectorMomentum:
    """Tests for get_sector_momentum method."""

    def test_get_sector_momentum_all_sectors(self, analyzer):
        """Test momentum calculation for all sectors."""
        result = run_async(analyzer.get_sector_momentum())

        assert isinstance(result, pd.DataFrame)
        # Should have momentum columns
        assert "price_momentum_1m" in result.columns
        assert "price_momentum_3m" in result.columns
        assert "composite_score" in result.columns
        assert "rank" in result.columns

    def test_get_sector_momentum_specific_sectors(self, analyzer):
        """Test momentum calculation for specific sectors."""
        sectors = ["XLK", "XLF", "XLE"]
        result = run_async(analyzer.get_sector_momentum(sectors=sectors))

        assert isinstance(result, pd.DataFrame)
        # Should only have requested sectors
        assert len(result) <= len(sectors)

    def test_get_sector_momentum_ranking(self, analyzer):
        """Test that sectors are ranked by composite score."""
        result = run_async(analyzer.get_sector_momentum())

        if not result.empty:
            # Ranks should be in ascending order when sorted by composite_score desc
            ranks = result["rank"].values
            assert ranks[0] == 1  # First should be rank 1


class TestDetectRiskOnOff:
    """Tests for detect_risk_on_off method."""

    def test_detect_risk_on_off_returns_expected_keys(self, analyzer):
        """Test that risk regime detection returns expected keys."""
        result = run_async(analyzer.detect_risk_on_off(lookback_days=20))

        assert "regime" in result
        assert "confidence" in result
        assert "risk_on_score" in result
        assert "risk_off_score" in result
        assert "spread" in result
        assert "trend" in result

    def test_detect_risk_on_off_regime_values(self, analyzer):
        """Test that regime is one of expected values."""
        result = run_async(analyzer.detect_risk_on_off())

        assert result["regime"] in ["risk_on", "risk_off", "neutral"]

    def test_detect_risk_on_off_confidence_bounds(self, analyzer):
        """Test that confidence is between 0 and 1."""
        result = run_async(analyzer.detect_risk_on_off())

        assert 0 <= result["confidence"] <= 1


class TestGetSectorCorrelationChanges:
    """Tests for get_sector_correlation_changes method."""

    def test_correlation_changes_returns_expected_keys(self, analyzer):
        """Test that correlation analysis returns expected keys."""
        result = run_async(analyzer.get_sector_correlation_changes())

        assert "correlation_matrix_current" in result
        assert "correlation_matrix_historical" in result
        assert "correlation_changes" in result
        assert "breakdowns" in result

    def test_correlation_matrices_are_symmetric(self, analyzer):
        """Test that correlation matrices are symmetric."""
        result = run_async(analyzer.get_sector_correlation_changes())

        if result["analysis_valid"]:
            current = result["correlation_matrix_current"]
            if not current.empty:
                # Check symmetry
                np.testing.assert_array_almost_equal(current.values, current.values.T)


class TestIdentifyLeadershipChanges:
    """Tests for identify_leadership_changes method."""

    def test_leadership_changes_returns_expected_keys(self, analyzer):
        """Test that leadership analysis returns expected keys."""
        result = run_async(analyzer.identify_leadership_changes())

        assert "current_leaders" in result
        assert "previous_leaders" in result
        assert "rising_sectors" in result
        assert "falling_sectors" in result
        assert "leadership_stability" in result

    def test_leadership_stability_bounds(self, analyzer):
        """Test that leadership stability is between 0 and 1."""
        result = run_async(analyzer.identify_leadership_changes())

        assert 0 <= result["leadership_stability"] <= 1


class TestGetRotationSignals:
    """Tests for get_rotation_signals method."""

    def test_rotation_signals_returns_dataframe(self, analyzer):
        """Test that rotation signals returns a DataFrame."""
        result = run_async(analyzer.get_rotation_signals())

        assert isinstance(result, pd.DataFrame)

    def test_rotation_signals_has_expected_columns(self, analyzer):
        """Test that rotation signals has expected columns."""
        result = run_async(analyzer.get_rotation_signals())

        if not result.empty:
            assert "sector" in result.columns
            assert "signal" in result.columns
            assert "strength" in result.columns
            assert "composite_signal" in result.columns

    def test_rotation_signals_valid_signal_values(self, analyzer):
        """Test that signals are valid values."""
        result = run_async(analyzer.get_rotation_signals())

        if not result.empty:
            valid_signals = ["overweight", "underweight", "neutral"]
            assert all(s in valid_signals for s in result["signal"])


class TestAnalyzeETFFlowsBySector:
    """Tests for analyze_etf_flows_by_sector method."""

    def test_etf_flows_returns_dataframe(self, analyzer):
        """Test that ETF flow analysis returns a DataFrame."""
        result = run_async(analyzer.analyze_etf_flows_by_sector(lookback_days=63))

        assert isinstance(result, pd.DataFrame)

    def test_etf_flows_has_flow_columns(self, analyzer):
        """Test that ETF flow analysis has flow columns."""
        result = run_async(analyzer.analyze_etf_flows_by_sector())

        if not result.empty:
            assert "net_flow_1m" in result.columns
            assert "net_flow_3m" in result.columns
            assert "flow_momentum" in result.columns


class TestGetBusinessCyclePositioning:
    """Tests for get_business_cycle_positioning method."""

    def test_business_cycle_returns_expected_keys(self, analyzer):
        """Test that business cycle positioning returns expected keys."""
        result = run_async(analyzer.get_business_cycle_positioning())

        assert "current_phase" in result
        assert "confidence" in result
        assert "phase_scores" in result
        assert "leading_sectors" in result
        assert "cycle_description" in result

    def test_business_cycle_phase_is_valid(self, analyzer):
        """Test that current phase is a valid phase."""
        result = run_async(analyzer.get_business_cycle_positioning())

        valid_phases = [phase.value for phase in BusinessCyclePhase]
        assert result["current_phase"] in valid_phases

    def test_business_cycle_has_description(self, analyzer):
        """Test that business cycle has a description."""
        result = run_async(analyzer.get_business_cycle_positioning())

        assert isinstance(result["cycle_description"], str)
        assert len(result["cycle_description"]) > 0


class TestHealthCheck:
    """Tests for health_check method."""

    def test_health_check_returns_true(self, analyzer):
        """Test that health check returns True."""
        assert analyzer.health_check() is True


class TestMockDataGeneration:
    """Tests for mock data generation methods."""

    def test_generate_mock_price_data(self, analyzer):
        """Test mock price data generation."""
        start_date = datetime.now() - timedelta(days=63)
        end_date = datetime.now()

        prices = analyzer._generate_mock_price_data("XLK", start_date, end_date)

        assert isinstance(prices, pd.Series)
        assert len(prices) > 0
        assert all(p > 0 for p in prices)  # Prices should be positive

    def test_generate_mock_flow_data(self, analyzer):
        """Test mock flow data generation."""
        start_date = datetime.now() - timedelta(days=63)
        end_date = datetime.now()

        flows = analyzer._generate_mock_flow_data(start_date, end_date)

        assert isinstance(flows, pd.DataFrame)
        assert "net_flow" in flows.columns
        assert "date" in flows.columns


class TestFlowMetricsCalculation:
    """Tests for flow metrics calculation."""

    def test_calculate_flow_metrics_empty_data(self, analyzer):
        """Test flow metrics with empty data."""
        result = analyzer._calculate_flow_metrics(pd.DataFrame())

        assert result["net_flow_1m"] == 0.0
        assert result["net_flow_3m"] == 0.0
        assert result["flow_signal"] == "neutral"

    def test_calculate_flow_metrics_with_data(self, analyzer):
        """Test flow metrics with valid data."""
        dates = pd.date_range(end=datetime.now(), periods=63, freq="D")
        flow_data = pd.DataFrame(
            {
                "date": dates,
                "net_flow": np.random.normal(100000, 50000, len(dates)),
            }
        )

        result = analyzer._calculate_flow_metrics(flow_data)

        assert "net_flow_1m" in result
        assert "flow_momentum" in result
        assert result["flow_signal"] in [
            "strong_inflow",
            "mild_inflow",
            "mild_outflow",
            "strong_outflow",
        ]


class TestCorrelationAnalysis:
    """Tests for correlation analysis helpers."""

    def test_average_correlation_empty_matrix(self, analyzer):
        """Test average correlation with empty matrix."""
        result = analyzer._average_correlation(pd.DataFrame())
        assert result == 0.0

    def test_average_correlation_valid_matrix(self, analyzer):
        """Test average correlation with valid matrix."""
        # Create a correlation-like matrix
        data = np.array(
            [
                [1.0, 0.5, 0.3],
                [0.5, 1.0, 0.4],
                [0.3, 0.4, 1.0],
            ]
        )
        corr_matrix = pd.DataFrame(data)

        result = analyzer._average_correlation(corr_matrix)

        # Average of off-diagonal: (0.5 + 0.3 + 0.4) / 3 = 0.4
        assert abs(result - 0.4) < 0.01

    def test_classify_correlation_regime(self, analyzer):
        """Test correlation regime classification."""
        # High correlation matrix
        data = np.ones((3, 3)) * 0.8
        np.fill_diagonal(data, 1.0)
        high_corr = pd.DataFrame(data)

        result = analyzer._classify_correlation_regime(high_corr)
        assert result == "high_correlation"

        # Low correlation matrix
        low_corr = pd.DataFrame(np.eye(3) * 1.0 + np.ones((3, 3)) * 0.1)
        result = analyzer._classify_correlation_regime(low_corr)
        assert result in ["low_correlation", "moderate_correlation"]


class TestCycleDescription:
    """Tests for cycle description helper."""

    def test_get_cycle_description_early(self, analyzer):
        """Test early cycle description."""
        desc = analyzer._get_cycle_description("early_cycle")
        assert "Financials" in desc
        assert "Consumer Discretionary" in desc

    def test_get_cycle_description_mid(self, analyzer):
        """Test mid cycle description."""
        desc = analyzer._get_cycle_description("mid_cycle")
        assert "Technology" in desc
        assert "Industrials" in desc

    def test_get_cycle_description_late(self, analyzer):
        """Test late cycle description."""
        desc = analyzer._get_cycle_description("late_cycle")
        assert "Energy" in desc
        assert "Materials" in desc

    def test_get_cycle_description_recession(self, analyzer):
        """Test recession description."""
        desc = analyzer._get_cycle_description("recession")
        assert "Utilities" in desc
        assert "Healthcare" in desc
        assert "Staples" in desc

    def test_get_cycle_description_unknown(self, analyzer):
        """Test unknown phase description."""
        desc = analyzer._get_cycle_description("unknown_phase")
        assert "Unknown" in desc
