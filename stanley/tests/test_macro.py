"""
Tests for the Macro Module

Comprehensive tests for macroeconomic analysis components including:
- Economic indicators registry
- Business cycle analysis
- Volatility regime detection
- Macro regime detection
- Cross-asset analysis
- Credit spread monitoring
"""

from datetime import datetime, timedelta
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from stanley.macro import (
    BusinessCycleAnalyzer,
    CorrelationRegime,
    CreditRegime,
    CreditSpreadMonitor,
    CreditState,
    CrossAssetAnalyzer,
    CrossAssetState,
    CyclePhase,
    CycleState,
    DBnomicsAdapter,
    EconomicIndicator,
    GrowthInflationQuadrant,
    IndicatorCategory,
    INDICATOR_REGISTRY,
    LEIComponent,
    MacroAnalyzer,
    TurningPoint,
    VIXTermStructure,
    VolatilityRegime,
    VolatilityRegimeDetector,
    VolatilityState,
)
from stanley.macro.indicators import (
    DataSource,
    Frequency,
    Transformation,
    get_indicator,
    get_indicators_by_category,
    register_indicator,
)
from stanley.macro.regime_detector import (
    MacroRegime,
    MacroRegimeState,
    RegimeConfidence,
    RegimeSignal,
)
from stanley.macro.macro_analyzer import (
    CountrySnapshot,
    EconomicForecast,
    EconomicRegime,
    YieldCurve as MacroYieldCurve,
)

# =============================================================================
# Indicator Tests
# =============================================================================


class TestIndicatorCategory:
    """Tests for IndicatorCategory enum."""

    def test_all_categories_defined(self):
        """Test all expected indicator categories exist."""
        expected = [
            "OUTPUT",
            "INFLATION",
            "EMPLOYMENT",
            "MONETARY",
            "FISCAL",
            "EXTERNAL",
            "FINANCIAL",
            "SENTIMENT",
            "HOUSING",
            "COMMODITIES",
        ]
        for category in expected:
            assert hasattr(IndicatorCategory, category)

    def test_category_values(self):
        """Test category enum values."""
        assert IndicatorCategory.OUTPUT.value == "output"
        assert IndicatorCategory.INFLATION.value == "inflation"
        assert IndicatorCategory.EMPLOYMENT.value == "employment"


class TestFrequency:
    """Tests for Frequency enum."""

    def test_frequency_values(self):
        """Test frequency enum values."""
        assert Frequency.DAILY.value == "D"
        assert Frequency.WEEKLY.value == "W"
        assert Frequency.MONTHLY.value == "M"
        assert Frequency.QUARTERLY.value == "Q"
        assert Frequency.ANNUAL.value == "A"


class TestTransformation:
    """Tests for Transformation enum."""

    def test_transformation_values(self):
        """Test transformation enum values."""
        assert Transformation.LEVEL.value == "level"
        assert Transformation.YOY.value == "yoy"
        assert Transformation.QOQ.value == "qoq"
        assert Transformation.MOM.value == "mom"
        assert Transformation.DIFF.value == "diff"
        assert Transformation.LOG.value == "log"
        assert Transformation.LOG_DIFF.value == "log_diff"


class TestDataSource:
    """Tests for DataSource dataclass."""

    def test_data_source_creation(self):
        """Test creating a data source."""
        source = DataSource(
            provider="OECD",
            dataset="QNA",
            series_template="{country}.B1_GE.VOBARSA.Q",
            frequency=Frequency.QUARTERLY,
            notes="Real GDP quarterly data",
        )
        assert source.provider == "OECD"
        assert source.dataset == "QNA"
        assert "{country}" in source.series_template
        assert source.frequency == Frequency.QUARTERLY
        assert source.notes == "Real GDP quarterly data"

    def test_data_source_defaults(self):
        """Test data source default values."""
        source = DataSource(
            provider="IMF",
            dataset="WEO",
            series_template="{country}.GDP",
        )
        assert source.frequency == Frequency.MONTHLY
        assert source.notes == ""


class TestEconomicIndicator:
    """Tests for EconomicIndicator dataclass."""

    def test_indicator_creation(self):
        """Test creating an economic indicator."""
        indicator = EconomicIndicator(
            code="TEST_IND",
            name="Test Indicator",
            category=IndicatorCategory.OUTPUT,
            description="A test indicator",
            unit="Percent",
            default_transform=Transformation.YOY,
        )
        assert indicator.code == "TEST_IND"
        assert indicator.name == "Test Indicator"
        assert indicator.category == IndicatorCategory.OUTPUT
        assert indicator.default_transform == Transformation.YOY

    def test_indicator_defaults(self):
        """Test indicator default values."""
        indicator = EconomicIndicator(
            code="TEST",
            name="Test",
            category=IndicatorCategory.OUTPUT,
            description="Test",
            unit="Index",
        )
        assert indicator.sources == []
        assert indicator.default_transform == Transformation.LEVEL
        assert indicator.seasonal_adjustment is True
        assert indicator.countries == []
        assert indicator.tags == []


class TestIndicatorRegistry:
    """Tests for the indicator registry."""

    def test_registry_has_indicators(self):
        """Test registry contains indicators."""
        assert len(INDICATOR_REGISTRY) > 0

    def test_gdp_indicators_registered(self):
        """Test GDP indicators are registered."""
        assert "GDP_REAL" in INDICATOR_REGISTRY
        assert "GDP_NOMINAL" in INDICATOR_REGISTRY

    def test_get_indicator(self):
        """Test getting an indicator by code."""
        indicator = get_indicator("GDP_REAL")
        assert indicator is not None
        assert indicator.code == "GDP_REAL"
        assert indicator.category == IndicatorCategory.OUTPUT

    def test_get_indicator_not_found(self):
        """Test getting non-existent indicator returns None."""
        indicator = get_indicator("NONEXISTENT_INDICATOR")
        assert indicator is None

    def test_get_indicators_by_category(self):
        """Test filtering indicators by category."""
        output_indicators = get_indicators_by_category(IndicatorCategory.OUTPUT)
        assert len(output_indicators) > 0
        for ind in output_indicators:
            assert ind.category == IndicatorCategory.OUTPUT

    def test_register_indicator(self):
        """Test registering a new indicator."""
        new_indicator = EconomicIndicator(
            code="TEST_REGISTER",
            name="Test Registration",
            category=IndicatorCategory.SENTIMENT,
            description="For testing registration",
            unit="Index",
        )
        result = register_indicator(new_indicator)
        assert result == new_indicator
        assert "TEST_REGISTER" in INDICATOR_REGISTRY
        # Clean up
        del INDICATOR_REGISTRY["TEST_REGISTER"]


# =============================================================================
# Business Cycle Tests
# =============================================================================


class TestCyclePhase:
    """Tests for CyclePhase enum."""

    def test_all_phases_defined(self):
        """Test all cycle phases exist."""
        phases = [
            "EXPANSION",
            "PEAK",
            "CONTRACTION",
            "TROUGH",
            "EARLY_RECOVERY",
            "LATE_CYCLE",
        ]
        for phase in phases:
            assert hasattr(CyclePhase, phase)

    def test_phase_values(self):
        """Test phase enum values."""
        assert CyclePhase.EXPANSION.value == "expansion"
        assert CyclePhase.CONTRACTION.value == "contraction"


class TestGrowthInflationQuadrant:
    """Tests for GrowthInflationQuadrant enum."""

    def test_quadrant_values(self):
        """Test quadrant enum values."""
        assert GrowthInflationQuadrant.GOLDILOCKS.value == "goldilocks"
        assert GrowthInflationQuadrant.REFLATION.value == "reflation"
        assert GrowthInflationQuadrant.STAGFLATION.value == "stagflation"
        assert GrowthInflationQuadrant.DEFLATION.value == "deflation"


class TestCycleState:
    """Tests for CycleState dataclass."""

    def test_cycle_state_creation(self):
        """Test creating a cycle state."""
        state = CycleState(
            phase=CyclePhase.EXPANSION,
            phase_duration_months=18,
            phase_start_date=datetime(2023, 1, 1),
            confidence=0.85,
            leading_indicators={"yield_spread": 1.5, "stock_prices": 0.8},
            sahm_indicator=0.2,
            growth_inflation_quadrant="goldilocks",
        )
        assert state.phase == CyclePhase.EXPANSION
        assert state.phase_duration_months == 18
        assert state.confidence == 0.85
        assert "yield_spread" in state.leading_indicators


class TestTurningPoint:
    """Tests for TurningPoint dataclass."""

    def test_turning_point_peak(self):
        """Test creating a peak turning point."""
        tp = TurningPoint(
            date=datetime(2023, 6, 1),
            point_type="peak",
            value=100.5,
            confirmed=True,
        )
        assert tp.point_type == "peak"
        assert tp.confirmed is True

    def test_turning_point_trough(self):
        """Test creating a trough turning point."""
        tp = TurningPoint(
            date=datetime(2023, 12, 1),
            point_type="trough",
            value=85.2,
            confirmed=False,
        )
        assert tp.point_type == "trough"
        assert tp.confirmed is False


class TestLEIComponent:
    """Tests for LEIComponent dataclass."""

    def test_lei_component(self):
        """Test creating an LEI component."""
        comp = LEIComponent(
            name="yield_spread",
            weight=0.20,
            current_value=1.5,
            contribution=0.30,
            signal="positive",
        )
        assert comp.name == "yield_spread"
        assert comp.weight == 0.20
        assert comp.signal == "positive"


class TestBusinessCycleAnalyzer:
    """Tests for BusinessCycleAnalyzer."""

    @pytest.fixture
    def mock_dbnomics(self):
        """Create mock DBnomics adapter."""
        adapter = MagicMock(spec=DBnomicsAdapter)
        adapter.get_series = MagicMock(return_value=pd.DataFrame())
        return adapter

    @pytest.fixture
    def analyzer(self, mock_dbnomics):
        """Create BusinessCycleAnalyzer with mocked dependencies."""
        return BusinessCycleAnalyzer(dbnomics_adapter=mock_dbnomics)

    def test_initialization(self, analyzer):
        """Test analyzer initialization."""
        assert analyzer is not None
        assert analyzer.dbnomics is not None

    def test_lei_weights_sum_to_one(self, analyzer):
        """Test LEI weights sum to approximately 1.0."""
        total_weight = sum(analyzer.LEI_WEIGHTS.values())
        assert abs(total_weight - 1.0) < 0.01

    def test_sahm_threshold(self, analyzer):
        """Test Sahm rule threshold is set correctly."""
        assert analyzer.SAHM_THRESHOLD == 0.5


# =============================================================================
# Volatility Regime Tests
# =============================================================================


class TestVolatilityRegime:
    """Tests for VolatilityRegime enum."""

    def test_all_regimes_defined(self):
        """Test all volatility regimes exist."""
        regimes = ["LOW", "NORMAL", "ELEVATED", "HIGH", "EXTREME"]
        for regime in regimes:
            assert hasattr(VolatilityRegime, regime)

    def test_regime_values(self):
        """Test regime enum values."""
        assert VolatilityRegime.LOW.value == "low"
        assert VolatilityRegime.EXTREME.value == "extreme"


class TestVIXTermStructure:
    """Tests for VIXTermStructure enum."""

    def test_term_structure_values(self):
        """Test term structure enum values."""
        assert VIXTermStructure.STEEP_CONTANGO.value == "steep_contango"
        assert VIXTermStructure.CONTANGO.value == "contango"
        assert VIXTermStructure.FLAT.value == "flat"
        assert VIXTermStructure.BACKWARDATION.value == "backwardation"
        assert VIXTermStructure.STEEP_BACKWARDATION.value == "steep_backwardation"


class TestVolatilityState:
    """Tests for VolatilityState dataclass."""

    def test_volatility_state_creation(self):
        """Test creating a volatility state."""
        state = VolatilityState(
            regime=VolatilityRegime.NORMAL,
            vix_level=18.5,
            vix_percentile=45.0,
            term_structure=VIXTermStructure.CONTANGO,
            realized_implied_ratio=0.85,
            vol_of_vol=22.0,
            cross_asset_stress=0.3,
            regime_duration_days=45,
            regime_confidence=0.8,
        )
        assert state.regime == VolatilityRegime.NORMAL
        assert state.vix_level == 18.5
        assert state.vix_percentile == 45.0

    def test_volatility_state_to_dict(self):
        """Test converting volatility state to dictionary."""
        state = VolatilityState(
            regime=VolatilityRegime.ELEVATED,
            vix_level=25.0,
            vix_percentile=75.0,
            term_structure=VIXTermStructure.FLAT,
            realized_implied_ratio=1.0,
            vol_of_vol=28.0,
            cross_asset_stress=0.5,
            regime_duration_days=10,
            regime_confidence=0.7,
        )
        result = state.to_dict()
        assert result["regime"] == "elevated"
        assert result["vix_level"] == 25.0
        assert result["term_structure"] == "flat"
        assert "timestamp" in result


class TestVolatilityRegimeDetector:
    """Tests for VolatilityRegimeDetector."""

    @pytest.fixture
    def detector(self):
        """Create VolatilityRegimeDetector."""
        return VolatilityRegimeDetector()

    def test_initialization(self, detector):
        """Test detector initialization."""
        assert detector is not None
        assert detector.lookback_days == 252 * 5

    def test_vix_thresholds(self, detector):
        """Test VIX thresholds are properly defined."""
        thresholds = detector.VIX_THRESHOLDS
        assert VolatilityRegime.LOW in thresholds
        assert VolatilityRegime.EXTREME in thresholds
        # Check LOW is 0-15
        assert thresholds[VolatilityRegime.LOW] == (0.0, 15.0)
        # Check EXTREME is 40+
        assert thresholds[VolatilityRegime.EXTREME][0] == 40.0

    def test_term_structure_thresholds(self, detector):
        """Test term structure thresholds are defined."""
        thresholds = detector.TERM_STRUCTURE_THRESHOLDS
        assert VIXTermStructure.STEEP_CONTANGO in thresholds
        assert VIXTermStructure.STEEP_BACKWARDATION in thresholds

    def test_classify_vix_regime_low(self, detector):
        """Test classifying low VIX as LOW regime."""
        # VIX < 15 should be LOW
        for vix in [10, 12, 14.9]:
            regime = detector.classify_vix_regime(vix)
            assert regime == VolatilityRegime.LOW

    def test_classify_vix_regime_normal(self, detector):
        """Test classifying normal VIX as NORMAL regime."""
        # VIX 15-20 should be NORMAL
        for vix in [15, 17, 19.9]:
            regime = detector.classify_vix_regime(vix)
            assert regime == VolatilityRegime.NORMAL

    def test_classify_vix_regime_elevated(self, detector):
        """Test classifying elevated VIX as ELEVATED regime."""
        # VIX 20-30 should be ELEVATED
        for vix in [20, 25, 29.9]:
            regime = detector.classify_vix_regime(vix)
            assert regime == VolatilityRegime.ELEVATED

    def test_classify_vix_regime_high(self, detector):
        """Test classifying high VIX as HIGH regime."""
        # VIX 30-40 should be HIGH
        for vix in [30, 35, 39.9]:
            regime = detector.classify_vix_regime(vix)
            assert regime == VolatilityRegime.HIGH

    def test_classify_vix_regime_extreme(self, detector):
        """Test classifying extreme VIX as EXTREME regime."""
        # VIX > 40 should be EXTREME
        for vix in [40, 50, 80]:
            regime = detector.classify_vix_regime(vix)
            assert regime == VolatilityRegime.EXTREME


# =============================================================================
# Macro Regime Detector Tests
# =============================================================================


class TestMacroRegime:
    """Tests for MacroRegime enum."""

    def test_all_regimes_defined(self):
        """Test all macro regimes exist."""
        regimes = [
            "GOLDILOCKS",
            "REFLATION",
            "STAGFLATION",
            "DEFLATION",
            "RISK_ON",
            "RISK_OFF",
            "CRISIS",
            "TRANSITION",
        ]
        for regime in regimes:
            assert hasattr(MacroRegime, regime)


class TestRegimeConfidence:
    """Tests for RegimeConfidence enum."""

    def test_confidence_levels(self):
        """Test confidence level values."""
        assert RegimeConfidence.HIGH.value == "high"
        assert RegimeConfidence.MEDIUM.value == "medium"
        assert RegimeConfidence.LOW.value == "low"


class TestRegimeSignal:
    """Tests for RegimeSignal dataclass."""

    def test_regime_signal_creation(self):
        """Test creating a regime signal."""
        signal = RegimeSignal(
            source="volatility_detector",
            signal="elevated",
            strength=0.7,
            confidence=0.8,
            details={"vix_level": 25.0},
        )
        assert signal.source == "volatility_detector"
        assert signal.strength == 0.7
        assert "vix_level" in signal.details


class TestMacroRegimeState:
    """Tests for MacroRegimeState dataclass."""

    def test_regime_state_creation(self):
        """Test creating a macro regime state."""
        state = MacroRegimeState(
            timestamp=datetime.now(),
            country="USA",
            regime=MacroRegime.GOLDILOCKS,
            regime_confidence=RegimeConfidence.HIGH,
            regime_score=0.85,
            business_cycle_phase="expansion",
            volatility_regime="low",
            credit_regime="normal",
            correlation_regime="risk_on",
            yield_curve_signal="normal",
            recession_probability_12m=0.15,
            vix_level=14.5,
            credit_spread_hy=350.0,
            yield_curve_spread=1.2,
            stock_bond_correlation=-0.3,
            risk_score=25.0,
            risk_trend="stable",
            equity_signal="overweight",
            duration_signal="neutral",
            credit_signal="overweight",
            volatility_signal="sell",
        )
        assert state.regime == MacroRegime.GOLDILOCKS
        assert state.country == "USA"
        assert state.recession_probability_12m == 0.15

    def test_regime_state_to_dict(self):
        """Test converting regime state to dictionary."""
        state = MacroRegimeState(
            timestamp=datetime(2024, 1, 15, 12, 0, 0),
            country="USA",
            regime=MacroRegime.RISK_ON,
            regime_confidence=RegimeConfidence.MEDIUM,
            regime_score=0.65,
            business_cycle_phase="late_cycle",
            volatility_regime="normal",
            credit_regime="tight",
            correlation_regime="risk_on",
            yield_curve_signal="flat",
            recession_probability_12m=0.30,
            vix_level=18.0,
            credit_spread_hy=400.0,
            yield_curve_spread=0.5,
            stock_bond_correlation=0.1,
            risk_score=45.0,
            risk_trend="increasing",
            equity_signal="neutral",
            duration_signal="short",
            credit_signal="underweight",
            volatility_signal="neutral",
            signals=[
                RegimeSignal(
                    source="business_cycle",
                    signal="late_cycle",
                    strength=0.7,
                    confidence=0.8,
                )
            ],
            regime_duration_days=60,
            regime_percentiles={"vix": 50.0, "credit_spread": 65.0},
        )
        result = state.to_dict()
        assert result["regime"] == "risk_on"
        assert result["country"] == "USA"
        assert "components" in result
        assert result["components"]["business_cycle"] == "late_cycle"
        assert "metrics" in result
        assert "risk" in result
        assert "positioning" in result
        assert len(result["signals"]) == 1


# =============================================================================
# Macro Analyzer Tests
# =============================================================================


class TestEconomicRegime:
    """Tests for EconomicRegime enum."""

    def test_all_regimes_defined(self):
        """Test all economic regimes exist."""
        regimes = [
            "EXPANSION",
            "PEAK",
            "CONTRACTION",
            "TROUGH",
            "RECOVERY",
            "STAGFLATION",
            "GOLDILOCKS",
            "REFLATION",
        ]
        for regime in regimes:
            assert hasattr(EconomicRegime, regime)


class TestCountrySnapshot:
    """Tests for CountrySnapshot dataclass."""

    def test_country_snapshot_creation(self):
        """Test creating a country snapshot."""
        snapshot = CountrySnapshot(
            country="USA",
            timestamp=datetime.now(),
            gdp_growth=2.5,
            inflation=3.2,
            unemployment=3.8,
            policy_rate=5.25,
            current_account=-3.0,
            pmi=52.5,
            regime=EconomicRegime.EXPANSION,
            additional_indicators={"consumer_confidence": 102.5},
        )
        assert snapshot.country == "USA"
        assert snapshot.gdp_growth == 2.5
        assert snapshot.regime == EconomicRegime.EXPANSION

    def test_country_snapshot_defaults(self):
        """Test country snapshot default values."""
        snapshot = CountrySnapshot(
            country="DEU",
            timestamp=datetime.now(),
        )
        assert snapshot.gdp_growth is None
        assert snapshot.additional_indicators == {}


class TestEconomicForecast:
    """Tests for EconomicForecast dataclass."""

    def test_economic_forecast(self):
        """Test creating an economic forecast."""
        forecast = EconomicForecast(
            country="USA",
            indicator="GDP_REAL",
            horizon_months=12,
            forecast_value=2.8,
            confidence_lower=2.2,
            confidence_upper=3.4,
            model="arima",
        )
        assert forecast.country == "USA"
        assert forecast.forecast_value == 2.8
        assert forecast.model == "arima"


class TestMacroYieldCurve:
    """Tests for YieldCurve dataclass in macro_analyzer."""

    def test_yield_curve_creation(self):
        """Test creating a yield curve."""
        curve = MacroYieldCurve(
            country="USA",
            date=datetime.now(),
            tenors=["3M", "2Y", "5Y", "10Y", "30Y"],
            yields=[5.0, 4.5, 4.3, 4.2, 4.5],
            spread_2y10y=-0.3,
            spread_3m10y=-0.8,
            curve_shape="inverted",
        )
        assert curve.country == "USA"
        assert len(curve.tenors) == 5
        assert curve.curve_shape == "inverted"


class TestMacroAnalyzer:
    """Tests for MacroAnalyzer."""

    @pytest.fixture
    def mock_dbnomics(self):
        """Create mock DBnomics adapter."""
        adapter = MagicMock(spec=DBnomicsAdapter)
        adapter.get_series = MagicMock(return_value=pd.DataFrame())
        return adapter

    @pytest.fixture
    def analyzer(self, mock_dbnomics):
        """Create MacroAnalyzer with mocked dependencies."""
        return MacroAnalyzer(dbnomics_adapter=mock_dbnomics)

    def test_initialization(self, analyzer):
        """Test analyzer initialization."""
        assert analyzer is not None
        assert analyzer.dbnomics is not None

    def test_g7_countries(self, analyzer):
        """Test G7 countries list."""
        assert len(analyzer.G7_COUNTRIES) == 7
        assert "USA" in analyzer.G7_COUNTRIES
        assert "JPN" in analyzer.G7_COUNTRIES
        assert "DEU" in analyzer.G7_COUNTRIES

    def test_g20_countries(self, analyzer):
        """Test G20 countries include G7."""
        for country in analyzer.G7_COUNTRIES:
            assert country in analyzer.G20_COUNTRIES
        assert len(analyzer.G20_COUNTRIES) > len(analyzer.G7_COUNTRIES)


# =============================================================================
# Credit Spread Tests
# =============================================================================


class TestCreditRegime:
    """Tests for CreditRegime enum."""

    def test_credit_regime_exists(self):
        """Test CreditRegime enum is importable."""
        assert CreditRegime is not None


class TestCreditState:
    """Tests for CreditState dataclass."""

    def test_credit_state_importable(self):
        """Test CreditState is importable."""
        assert CreditState is not None


class TestCreditSpreadMonitor:
    """Tests for CreditSpreadMonitor."""

    def test_credit_spread_monitor_importable(self):
        """Test CreditSpreadMonitor is importable."""
        assert CreditSpreadMonitor is not None


# =============================================================================
# Cross-Asset Tests
# =============================================================================


class TestCorrelationRegime:
    """Tests for CorrelationRegime enum."""

    def test_correlation_regime_exists(self):
        """Test CorrelationRegime enum is importable."""
        assert CorrelationRegime is not None


class TestCrossAssetState:
    """Tests for CrossAssetState dataclass."""

    def test_cross_asset_state_importable(self):
        """Test CrossAssetState is importable."""
        assert CrossAssetState is not None


class TestCrossAssetAnalyzer:
    """Tests for CrossAssetAnalyzer."""

    def test_cross_asset_analyzer_importable(self):
        """Test CrossAssetAnalyzer is importable."""
        assert CrossAssetAnalyzer is not None


# =============================================================================
# DBnomics Adapter Tests
# =============================================================================


class TestDBnomicsAdapter:
    """Tests for DBnomicsAdapter."""

    @pytest.fixture
    def adapter(self):
        """Create DBnomics adapter."""
        return DBnomicsAdapter()

    def test_initialization(self, adapter):
        """Test adapter initialization."""
        assert adapter is not None

    def test_adapter_importable(self):
        """Test DBnomicsAdapter is importable."""
        assert DBnomicsAdapter is not None


# =============================================================================
# Integration-like Tests (with mocks)
# =============================================================================


class TestVolatilityRegimeClassification:
    """Integration tests for volatility regime classification."""

    @pytest.fixture
    def detector(self):
        """Create VolatilityRegimeDetector."""
        return VolatilityRegimeDetector()

    def test_classify_calm_market(self, detector):
        """Test classification of calm market conditions."""
        regime = detector.classify_vix_regime(12.0)
        assert regime == VolatilityRegime.LOW

    def test_classify_stressed_market(self, detector):
        """Test classification of stressed market conditions."""
        regime = detector.classify_vix_regime(35.0)
        assert regime == VolatilityRegime.HIGH

    def test_classify_panic_market(self, detector):
        """Test classification of panic market conditions."""
        regime = detector.classify_vix_regime(65.0)
        assert regime == VolatilityRegime.EXTREME


class TestBusinessCyclePhaseDetection:
    """Integration tests for business cycle phase detection."""

    def test_expansion_characteristics(self):
        """Test characteristics of expansion phase."""
        state = CycleState(
            phase=CyclePhase.EXPANSION,
            phase_duration_months=24,
            phase_start_date=datetime(2022, 1, 1),
            confidence=0.9,
            leading_indicators={
                "yield_spread": 1.5,
                "stock_prices": 0.7,
                "ism_new_orders": 55.0,
            },
            sahm_indicator=0.1,
            growth_inflation_quadrant="goldilocks",
        )
        assert state.phase == CyclePhase.EXPANSION
        assert state.confidence > 0.5
        assert state.sahm_indicator < 0.5  # Below recession threshold

    def test_contraction_characteristics(self):
        """Test characteristics of contraction phase."""
        state = CycleState(
            phase=CyclePhase.CONTRACTION,
            phase_duration_months=6,
            phase_start_date=datetime(2024, 6, 1),
            confidence=0.85,
            leading_indicators={
                "yield_spread": -0.5,
                "stock_prices": -0.3,
                "ism_new_orders": 45.0,
            },
            sahm_indicator=0.7,
            growth_inflation_quadrant="deflation",
        )
        assert state.phase == CyclePhase.CONTRACTION
        assert state.sahm_indicator > 0.5  # Above recession threshold


class TestMacroRegimeIntegration:
    """Integration tests for macro regime classification."""

    def test_goldilocks_regime(self):
        """Test Goldilocks regime characteristics."""
        state = MacroRegimeState(
            timestamp=datetime.now(),
            country="USA",
            regime=MacroRegime.GOLDILOCKS,
            regime_confidence=RegimeConfidence.HIGH,
            regime_score=0.9,
            business_cycle_phase="expansion",
            volatility_regime="low",
            credit_regime="normal",
            correlation_regime="risk_on",
            yield_curve_signal="normal",
            recession_probability_12m=0.10,
            vix_level=12.0,
            credit_spread_hy=300.0,
            yield_curve_spread=1.5,
            stock_bond_correlation=-0.4,
            risk_score=20.0,
            risk_trend="stable",
            equity_signal="overweight",
            duration_signal="neutral",
            credit_signal="overweight",
            volatility_signal="sell",
        )
        assert state.regime == MacroRegime.GOLDILOCKS
        assert state.recession_probability_12m < 0.2
        assert state.vix_level < 15
        assert state.equity_signal == "overweight"

    def test_crisis_regime(self):
        """Test Crisis regime characteristics."""
        state = MacroRegimeState(
            timestamp=datetime.now(),
            country="USA",
            regime=MacroRegime.CRISIS,
            regime_confidence=RegimeConfidence.HIGH,
            regime_score=0.95,
            business_cycle_phase="contraction",
            volatility_regime="extreme",
            credit_regime="stressed",
            correlation_regime="risk_off",
            yield_curve_signal="inverted",
            recession_probability_12m=0.85,
            vix_level=55.0,
            credit_spread_hy=800.0,
            yield_curve_spread=-0.5,
            stock_bond_correlation=0.5,
            risk_score=90.0,
            risk_trend="increasing",
            equity_signal="underweight",
            duration_signal="long",
            credit_signal="underweight",
            volatility_signal="buy",
        )
        assert state.regime == MacroRegime.CRISIS
        assert state.recession_probability_12m > 0.7
        assert state.vix_level > 40
        assert state.equity_signal == "underweight"
        assert state.risk_score > 80
