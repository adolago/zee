"""
Tests for Yield Curve Analysis Module.

Tests cover:
- CurveShape and CurveDynamic enums
- YieldCurvePoint and YieldCurveAnalysis dataclasses
- YieldCurveAnalyzer class and methods
- Nelson-Siegel model fitting
- Spread calculations and shape classification
- Recession signal generation
"""

import pytest
import numpy as np
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from stanley.macro.yield_curve import (
    CurveShape,
    CurveDynamic,
    YieldCurvePoint,
    YieldCurveAnalysis,
    YieldCurveAnalyzer,
)

# =============================================================================
# ENUM TESTS
# =============================================================================


class TestCurveShape:
    """Tests for CurveShape enum."""

    def test_all_shapes_defined(self):
        """Test all curve shapes are defined."""
        shapes = list(CurveShape)
        assert len(shapes) == 5

    def test_shape_values(self):
        """Test shape enum values."""
        assert CurveShape.NORMAL.value == "normal"
        assert CurveShape.FLAT.value == "flat"
        assert CurveShape.INVERTED.value == "inverted"
        assert CurveShape.HUMPED.value == "humped"
        assert CurveShape.TWISTED.value == "twisted"

    def test_shape_from_string(self):
        """Test creating shape from string value."""
        assert CurveShape("normal") == CurveShape.NORMAL
        assert CurveShape("inverted") == CurveShape.INVERTED


class TestCurveDynamic:
    """Tests for CurveDynamic enum."""

    def test_all_dynamics_defined(self):
        """Test all curve dynamics are defined."""
        dynamics = list(CurveDynamic)
        assert len(dynamics) == 6

    def test_dynamic_values(self):
        """Test dynamic enum values."""
        assert CurveDynamic.STEEPENING.value == "steepening"
        assert CurveDynamic.FLATTENING.value == "flattening"
        assert CurveDynamic.PARALLEL_UP.value == "parallel_up"
        assert CurveDynamic.PARALLEL_DOWN.value == "parallel_down"
        assert CurveDynamic.TWISTING.value == "twisting"
        assert CurveDynamic.STABLE.value == "stable"


# =============================================================================
# DATACLASS TESTS
# =============================================================================


class TestYieldCurvePoint:
    """Tests for YieldCurvePoint dataclass."""

    def test_point_creation(self):
        """Test creating a yield curve point."""
        point = YieldCurvePoint(
            tenor="10Y",
            tenor_years=10.0,
            yield_value=4.25,
        )
        assert point.tenor == "10Y"
        assert point.tenor_years == 10.0
        assert point.yield_value == 4.25

    def test_point_with_real_yield(self):
        """Test point with real yield value."""
        point = YieldCurvePoint(
            tenor="10Y",
            tenor_years=10.0,
            yield_value=4.25,
            real_yield=1.75,
        )
        assert point.real_yield == 1.75

    def test_point_default_real_yield(self):
        """Test real yield defaults to None."""
        point = YieldCurvePoint(
            tenor="5Y",
            tenor_years=5.0,
            yield_value=3.50,
        )
        assert point.real_yield is None


class TestYieldCurveAnalysis:
    """Tests for YieldCurveAnalysis dataclass."""

    def test_analysis_creation(self):
        """Test creating a yield curve analysis."""
        analysis = YieldCurveAnalysis(
            country="USA",
            date=datetime(2024, 1, 15),
            curve_points=[],
            shape=CurveShape.NORMAL,
            dynamic=CurveDynamic.STABLE,
        )
        assert analysis.country == "USA"
        assert analysis.shape == CurveShape.NORMAL
        assert analysis.dynamic == CurveDynamic.STABLE

    def test_analysis_with_spreads(self):
        """Test analysis with spread values."""
        analysis = YieldCurveAnalysis(
            country="USA",
            date=datetime.now(),
            curve_points=[],
            shape=CurveShape.NORMAL,
            dynamic=CurveDynamic.STABLE,
            spread_3m10y=1.50,
            spread_2y10y=0.80,
            spread_3m2y=0.70,
            spread_10y30y=0.25,
        )
        assert analysis.spread_3m10y == 1.50
        assert analysis.spread_2y10y == 0.80
        assert analysis.spread_3m2y == 0.70
        assert analysis.spread_10y30y == 0.25

    def test_analysis_with_nelson_siegel(self):
        """Test analysis with Nelson-Siegel factors."""
        analysis = YieldCurveAnalysis(
            country="USA",
            date=datetime.now(),
            curve_points=[],
            shape=CurveShape.NORMAL,
            dynamic=CurveDynamic.STABLE,
            level=4.5,
            slope=-1.2,
            curvature=0.5,
        )
        assert analysis.level == 4.5
        assert analysis.slope == -1.2
        assert analysis.curvature == 0.5

    def test_analysis_inversion_tracking(self):
        """Test inversion depth and duration tracking."""
        analysis = YieldCurveAnalysis(
            country="USA",
            date=datetime.now(),
            curve_points=[],
            shape=CurveShape.INVERTED,
            dynamic=CurveDynamic.FLATTENING,
            inversion_depth=-0.5,
            inversion_duration_days=45,
            recession_signal_strength=0.65,
        )
        assert analysis.inversion_depth == -0.5
        assert analysis.inversion_duration_days == 45
        assert analysis.recession_signal_strength == 0.65

    def test_analysis_default_values(self):
        """Test default values for optional fields."""
        analysis = YieldCurveAnalysis(
            country="USA",
            date=datetime.now(),
            curve_points=[],
            shape=CurveShape.NORMAL,
            dynamic=CurveDynamic.STABLE,
        )
        assert analysis.spread_3m10y is None
        assert analysis.level is None
        assert analysis.inversion_depth == 0.0
        assert analysis.inversion_duration_days == 0
        assert analysis.recession_signal_strength == 0.0
        assert analysis.percentile_vs_history == {}


# =============================================================================
# YIELD CURVE ANALYZER TESTS
# =============================================================================


class TestYieldCurveAnalyzerInit:
    """Tests for YieldCurveAnalyzer initialization."""

    def test_init_without_adapters(self):
        """Test initialization without data adapters."""
        analyzer = YieldCurveAnalyzer()
        assert analyzer.dbnomics is None
        assert analyzer.data_manager is None
        assert analyzer._curve_history == {}
        assert analyzer._inversion_tracker == {}

    def test_init_with_adapters(self):
        """Test initialization with data adapters."""
        mock_dbnomics = MagicMock()
        mock_data_manager = MagicMock()
        analyzer = YieldCurveAnalyzer(
            dbnomics_adapter=mock_dbnomics,
            data_manager=mock_data_manager,
        )
        assert analyzer.dbnomics is mock_dbnomics
        assert analyzer.data_manager is mock_data_manager

    def test_standard_tenors(self):
        """Test standard tenors dictionary."""
        assert YieldCurveAnalyzer.STANDARD_TENORS["1M"] == pytest.approx(1 / 12)
        assert YieldCurveAnalyzer.STANDARD_TENORS["3M"] == 0.25
        assert YieldCurveAnalyzer.STANDARD_TENORS["1Y"] == 1.0
        assert YieldCurveAnalyzer.STANDARD_TENORS["10Y"] == 10.0
        assert YieldCurveAnalyzer.STANDARD_TENORS["30Y"] == 30.0

    def test_thresholds(self):
        """Test classification thresholds."""
        assert YieldCurveAnalyzer.FLAT_THRESHOLD == 0.25
        assert YieldCurveAnalyzer.INVERSION_THRESHOLD == -0.10


class TestCalculateSpreads:
    """Tests for spread calculation."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_calculate_spreads_full_curve(self, analyzer):
        """Test spread calculation with full curve."""
        points = [
            YieldCurvePoint("3M", 0.25, 5.25),
            YieldCurvePoint("2Y", 2.0, 4.50),
            YieldCurvePoint("10Y", 10.0, 4.25),
            YieldCurvePoint("30Y", 30.0, 4.50),
        ]
        spreads = analyzer._calculate_spreads(points)
        assert spreads["3m10y"] == pytest.approx(-1.0)  # 4.25 - 5.25
        assert spreads["2y10y"] == pytest.approx(-0.25)  # 4.25 - 4.50
        assert spreads["3m2y"] == pytest.approx(-0.75)  # 4.50 - 5.25
        assert spreads["10y30y"] == pytest.approx(0.25)  # 4.50 - 4.25

    def test_calculate_spreads_partial_curve(self, analyzer):
        """Test spread calculation with partial curve."""
        points = [
            YieldCurvePoint("3M", 0.25, 5.00),
            YieldCurvePoint("10Y", 10.0, 4.00),
        ]
        spreads = analyzer._calculate_spreads(points)
        assert spreads["3m10y"] == pytest.approx(-1.0)
        assert spreads["2y10y"] is None
        assert spreads["3m2y"] is None
        assert spreads["10y30y"] is None

    def test_calculate_spreads_empty_points(self, analyzer):
        """Test spread calculation with no points."""
        spreads = analyzer._calculate_spreads([])
        assert all(v is None for v in spreads.values())


class TestClassifyShape:
    """Tests for curve shape classification."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_classify_normal_curve(self, analyzer):
        """Test normal (upward sloping) curve classification."""
        points = [
            YieldCurvePoint("3M", 0.25, 4.00),
            YieldCurvePoint("10Y", 10.0, 5.50),
        ]
        spreads = {"3m10y": 1.50, "2y10y": 0.80}
        shape = analyzer._classify_shape(points, spreads)
        assert shape == CurveShape.NORMAL

    def test_classify_flat_curve(self, analyzer):
        """Test flat curve classification."""
        points = [
            YieldCurvePoint("3M", 0.25, 4.00),
            YieldCurvePoint("10Y", 10.0, 4.15),
        ]
        spreads = {"3m10y": 0.15, "2y10y": 0.10}
        shape = analyzer._classify_shape(points, spreads)
        assert shape == CurveShape.FLAT

    def test_classify_inverted_curve(self, analyzer):
        """Test inverted curve classification."""
        points = [
            YieldCurvePoint("3M", 0.25, 5.50),
            YieldCurvePoint("10Y", 10.0, 4.50),
        ]
        spreads = {"3m10y": -1.0, "2y10y": -0.5}
        shape = analyzer._classify_shape(points, spreads)
        assert shape == CurveShape.INVERTED

    def test_classify_humped_curve(self, analyzer):
        """Test humped curve classification."""
        points = [
            YieldCurvePoint("3M", 0.25, 3.50),
            YieldCurvePoint("2Y", 2.0, 5.00),
            YieldCurvePoint("10Y", 10.0, 4.50),
        ]
        spreads = {"3m10y": 1.00, "2y10y": -0.50, "3m2y": 1.50}
        shape = analyzer._classify_shape(points, spreads)
        assert shape == CurveShape.HUMPED

    def test_classify_insufficient_points(self, analyzer):
        """Test classification with insufficient points."""
        points = [YieldCurvePoint("10Y", 10.0, 4.50)]
        spreads = {}
        shape = analyzer._classify_shape(points, spreads)
        assert shape == CurveShape.FLAT

    def test_classify_fallback_to_2y10y(self, analyzer):
        """Test fallback to 2y10y spread when 3m10y unavailable."""
        points = [
            YieldCurvePoint("2Y", 2.0, 5.00),
            YieldCurvePoint("10Y", 10.0, 4.00),
        ]
        spreads = {"3m10y": None, "2y10y": -1.0}
        shape = analyzer._classify_shape(points, spreads)
        assert shape == CurveShape.INVERTED


class TestNelsonSiegel:
    """Tests for Nelson-Siegel model fitting."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_fit_nelson_siegel_full_curve(self, analyzer):
        """Test NS fitting with full curve."""
        points = [
            YieldCurvePoint("3M", 0.25, 5.00),
            YieldCurvePoint("2Y", 2.0, 4.50),
            YieldCurvePoint("5Y", 5.0, 4.25),
            YieldCurvePoint("10Y", 10.0, 4.00),
        ]
        params = analyzer._fit_nelson_siegel(points)
        assert "beta0" in params
        assert "beta1" in params
        assert "beta2" in params
        assert "lambda" in params
        # Beta0 should be close to long rate
        assert params["beta0"] is not None

    def test_fit_nelson_siegel_two_points(self, analyzer):
        """Test NS fitting with only two points."""
        points = [
            YieldCurvePoint("3M", 0.25, 5.00),
            YieldCurvePoint("10Y", 10.0, 4.00),
        ]
        params = analyzer._fit_nelson_siegel(points)
        assert params["beta0"] == pytest.approx(4.0)  # Long rate
        assert params["beta1"] == pytest.approx(1.0)  # Short - long
        assert params["beta2"] is None

    def test_fit_nelson_siegel_one_point(self, analyzer):
        """Test NS fitting with only one point."""
        points = [YieldCurvePoint("10Y", 10.0, 4.00)]
        params = analyzer._fit_nelson_siegel(points)
        assert all(v is None for v in params.values())

    def test_fit_nelson_siegel_empty(self, analyzer):
        """Test NS fitting with no points."""
        params = analyzer._fit_nelson_siegel([])
        assert all(v is None for v in params.values())


class TestRecessionSignal:
    """Tests for recession signal calculation."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_recession_signal_steep_curve(self, analyzer):
        """Test recession signal for steep curve (low risk)."""
        spreads = {"3m10y": 2.0, "2y10y": 1.5}
        ns_params = {"beta0": 4.0, "beta1": 1.5}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert signal <= 0.10

    def test_recession_signal_normal_curve(self, analyzer):
        """Test recession signal for normal curve."""
        spreads = {"3m10y": 1.0, "2y10y": 0.5}
        ns_params = {"beta0": 4.0, "beta1": 0.5}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert 0.10 <= signal <= 0.20

    def test_recession_signal_flat_curve(self, analyzer):
        """Test recession signal for flat curve."""
        spreads = {"3m10y": 0.2, "2y10y": 0.1}
        ns_params = {"beta0": 4.0, "beta1": 0.0}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert 0.20 <= signal <= 0.40

    def test_recession_signal_inverted_curve(self, analyzer):
        """Test recession signal for inverted curve."""
        spreads = {"3m10y": -0.5, "2y10y": -0.3}
        ns_params = {"beta0": 4.0, "beta1": -0.5}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert signal >= 0.50

    def test_recession_signal_deeply_inverted(self, analyzer):
        """Test recession signal for deeply inverted curve."""
        spreads = {"3m10y": -1.5, "2y10y": -1.0}
        ns_params = {"beta0": 4.0, "beta1": -1.5}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert signal >= 0.80

    def test_recession_signal_fallback_to_2y10y(self, analyzer):
        """Test recession signal falls back to 2y10y."""
        spreads = {"3m10y": None, "2y10y": -0.3}
        ns_params = {}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert signal >= 0.40

    def test_recession_signal_no_data(self, analyzer):
        """Test recession signal with no data."""
        spreads = {"3m10y": None, "2y10y": None}
        ns_params = {}
        signal = analyzer._calculate_recession_signal(spreads, ns_params)
        assert signal == 0.0


class TestInversionTracking:
    """Tests for inversion tracking."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_track_inversion_normal_curve(self, analyzer):
        """Test tracking when curve is not inverted."""
        spreads = {"3m10y": 1.0, "2y10y": 0.5}
        result = analyzer._track_inversion("USA", spreads)
        assert result["is_inverted"] is False
        assert result["depth"] == 1.0
        assert result["duration"] == 0

    def test_track_inversion_inverted_curve(self, analyzer):
        """Test tracking when curve is inverted."""
        spreads = {"3m10y": -0.5, "2y10y": -0.3}
        result = analyzer._track_inversion("USA", spreads)
        assert result["is_inverted"] is True
        assert result["depth"] == -0.5
        assert result["duration"] >= 0

    def test_track_inversion_duration(self, analyzer):
        """Test inversion duration tracking."""
        spreads = {"3m10y": -0.5}
        # First call starts tracking
        analyzer._track_inversion("USA", spreads)
        # Second call should show duration
        result = analyzer._track_inversion("USA", spreads)
        assert result["duration"] >= 0

    def test_track_inversion_reset(self, analyzer):
        """Test inversion tracking reset when curve normalizes."""
        # Start inverted
        analyzer._track_inversion("USA", {"3m10y": -0.5})
        # Normalize
        result = analyzer._track_inversion("USA", {"3m10y": 0.5})
        assert result["is_inverted"] is False
        assert "USA" not in analyzer._inversion_tracker


class TestRecessionProbability:
    """Tests for recession probability calculation."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_probability_steep_curve(self, analyzer):
        """Test recession probability for steep curve."""
        prob = analyzer.get_recession_probability_from_curve(2.0)
        assert prob < 0.10

    def test_probability_normal_curve(self, analyzer):
        """Test recession probability for normal curve."""
        prob = analyzer.get_recession_probability_from_curve(1.0)
        assert 0.05 <= prob <= 0.30

    def test_probability_flat_curve(self, analyzer):
        """Test recession probability for flat curve."""
        prob = analyzer.get_recession_probability_from_curve(0.0)
        assert 0.30 <= prob <= 0.50

    def test_probability_inverted_curve(self, analyzer):
        """Test recession probability for inverted curve."""
        prob = analyzer.get_recession_probability_from_curve(-0.5)
        assert prob >= 0.45

    def test_probability_deeply_inverted(self, analyzer):
        """Test recession probability for deeply inverted curve."""
        prob = analyzer.get_recession_probability_from_curve(-1.5)
        assert prob >= 0.80

    def test_probability_bounded(self, analyzer):
        """Test probability is bounded between 0 and 1."""
        for spread in [-3.0, -1.0, 0.0, 1.0, 3.0]:
            prob = analyzer.get_recession_probability_from_curve(spread)
            assert 0.0 <= prob <= 1.0


class TestHealthCheck:
    """Tests for health check."""

    def test_health_check_returns_true(self):
        """Test health check returns True."""
        analyzer = YieldCurveAnalyzer()
        assert analyzer.health_check() is True


class TestEmptyAnalysis:
    """Tests for empty analysis generation."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    def test_empty_analysis_structure(self, analyzer):
        """Test empty analysis has correct structure."""
        analysis = analyzer._empty_analysis("USA")
        assert analysis.country == "USA"
        assert isinstance(analysis.date, datetime)
        assert analysis.curve_points == []
        assert analysis.shape == CurveShape.NORMAL
        assert analysis.dynamic == CurveDynamic.STABLE


# =============================================================================
# ASYNC TESTS
# =============================================================================


class TestAnalyzeCurveAsync:
    """Async tests for analyze_curve method."""

    @pytest.fixture
    def analyzer(self):
        return YieldCurveAnalyzer()

    @pytest.mark.asyncio
    async def test_analyze_curve_no_data(self, analyzer):
        """Test analyze_curve with no data available."""
        analysis = await analyzer.analyze_curve("USA")
        assert analysis.country == "USA"
        assert analysis.curve_points == []
        assert analysis.shape == CurveShape.NORMAL

    @pytest.mark.asyncio
    async def test_analyze_curve_with_mock_data(self):
        """Test analyze_curve with mocked data."""
        import pandas as pd

        mock_dbnomics = MagicMock()
        mock_dbnomics.get_interest_rates = MagicMock(
            return_value=pd.DataFrame({"value": [4.5]})
        )
        analyzer = YieldCurveAnalyzer(dbnomics_adapter=mock_dbnomics)
        analysis = await analyzer.analyze_curve("USA")
        assert analysis.country == "USA"
