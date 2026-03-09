"""
Tests for Recession Probability Model.

Tests cover:
- RecessionProbability and HistoricalAccuracy dataclasses
- RecessionProbabilityModel class
- Individual signal calculations (yield curve, credit, LEI, Sahm)
- Signal combination and weighting
- Signal color mapping
- Interpretation methods
"""

import pytest
import numpy as np
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from investing.macro.recession_model import (
    RecessionProbability,
    HistoricalAccuracy,
    RecessionProbabilityModel,
)

# =============================================================================
# DATACLASS TESTS
# =============================================================================


class TestRecessionProbability:
    """Tests for RecessionProbability dataclass."""

    def test_probability_creation(self):
        """Test creating a recession probability result."""
        prob = RecessionProbability(
            probability_3m=0.15,
            probability_6m=0.22,
            probability_12m=0.35,
            probability_24m=0.28,
            current_signal="yellow",
            contributing_factors={"yield_curve": {"weight": 0.35, "signal": 0.4}},
            confidence=0.85,
            model_version="1.0.0",
            timestamp=datetime(2024, 1, 15),
        )
        assert prob.probability_3m == 0.15
        assert prob.probability_12m == 0.35
        assert prob.current_signal == "yellow"
        assert prob.confidence == 0.85

    def test_probability_signal_values(self):
        """Test all signal colors are valid."""
        for signal in ["green", "yellow", "orange", "red"]:
            prob = RecessionProbability(
                probability_3m=0.1,
                probability_6m=0.2,
                probability_12m=0.3,
                probability_24m=0.25,
                current_signal=signal,
                contributing_factors={},
                confidence=0.8,
                model_version="1.0.0",
                timestamp=datetime.now(),
            )
            assert prob.current_signal == signal


class TestHistoricalAccuracy:
    """Tests for HistoricalAccuracy dataclass."""

    def test_accuracy_creation(self):
        """Test creating historical accuracy result."""
        accuracy = HistoricalAccuracy(
            precision=0.78,
            recall=0.82,
            f1_score=0.80,
            false_positive_rate=0.15,
            auc_roc=0.87,
            sample_periods=240,
            recession_periods=24,
        )
        assert accuracy.precision == 0.78
        assert accuracy.recall == 0.82
        assert accuracy.f1_score == 0.80
        assert accuracy.auc_roc == 0.87

    def test_accuracy_metrics_bounded(self):
        """Test that metrics are typically bounded 0-1."""
        accuracy = HistoricalAccuracy(
            precision=0.78,
            recall=0.82,
            f1_score=0.80,
            false_positive_rate=0.15,
            auc_roc=0.87,
            sample_periods=240,
            recession_periods=24,
        )
        assert 0 <= accuracy.precision <= 1
        assert 0 <= accuracy.recall <= 1
        assert 0 <= accuracy.f1_score <= 1
        assert 0 <= accuracy.false_positive_rate <= 1
        assert 0 <= accuracy.auc_roc <= 1


# =============================================================================
# MODEL INITIALIZATION TESTS
# =============================================================================


class TestRecessionModelInit:
    """Tests for RecessionProbabilityModel initialization."""

    def test_init_without_adapters(self):
        """Test initialization without data adapters."""
        model = RecessionProbabilityModel()
        assert model.dbnomics is None
        assert model.data_manager is None
        assert model.business_cycle is None
        assert model.credit_monitor is None
        assert model._signal_cache == {}

    def test_init_with_adapters(self):
        """Test initialization with data adapters."""
        mock_dbnomics = MagicMock()
        mock_data_manager = MagicMock()
        model = RecessionProbabilityModel(
            dbnomics_adapter=mock_dbnomics,
            data_manager=mock_data_manager,
        )
        assert model.dbnomics is mock_dbnomics
        assert model.data_manager is mock_data_manager

    def test_model_version(self):
        """Test model version is defined."""
        assert RecessionProbabilityModel.MODEL_VERSION == "1.0.0"

    def test_weights_sum_to_one(self):
        """Test that 12M weights sum approximately to 1."""
        weights = RecessionProbabilityModel.WEIGHTS_12M
        total = sum(weights.values())
        assert total == pytest.approx(1.0)

    def test_horizon_adjustments_exist(self):
        """Test horizon adjustment weights exist."""
        model = RecessionProbabilityModel()
        assert 3 in model.HORIZON_ADJUSTMENTS
        assert 6 in model.HORIZON_ADJUSTMENTS
        assert 24 in model.HORIZON_ADJUSTMENTS

    def test_probit_coefficients_exist(self):
        """Test probit coefficients are defined."""
        coefs = RecessionProbabilityModel.PROBIT_COEFFICIENTS
        assert "10y3m" in coefs
        assert "10y2y" in coefs
        assert "beta0" in coefs["10y3m"]
        assert "beta1" in coefs["10y3m"]

    def test_signal_thresholds(self):
        """Test signal thresholds cover full range."""
        thresholds = RecessionProbabilityModel.SIGNAL_THRESHOLDS
        assert thresholds["green"] == (0.0, 0.15)
        assert thresholds["yellow"] == (0.15, 0.30)
        assert thresholds["orange"] == (0.30, 0.50)
        assert thresholds["red"] == (0.50, 1.0)


# =============================================================================
# YIELD CURVE PROBABILITY TESTS
# =============================================================================


class TestYieldCurveProbability:
    """Tests for yield curve probability calculation."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_steep_curve_low_probability(self, model):
        """Test steep curve gives low recession probability."""
        prob = model.yield_curve_probability(2.0)
        assert prob < 0.15

    def test_normal_curve_moderate_probability(self, model):
        """Test normal curve gives moderate probability."""
        prob = model.yield_curve_probability(1.0)
        assert 0.05 <= prob <= 0.35

    def test_flat_curve_elevated_probability(self, model):
        """Test flat curve gives elevated probability."""
        prob = model.yield_curve_probability(0.0)
        assert 0.25 <= prob <= 0.55

    def test_inverted_curve_high_probability(self, model):
        """Test inverted curve gives high probability."""
        prob = model.yield_curve_probability(-0.5)
        assert prob >= 0.45

    def test_deeply_inverted_very_high_probability(self, model):
        """Test deeply inverted curve gives very high probability."""
        prob = model.yield_curve_probability(-1.5)
        assert prob >= 0.75

    def test_probability_bounded(self, model):
        """Test probability is bounded 0.01 to 0.99."""
        for spread in [-5.0, -2.0, 0.0, 2.0, 5.0]:
            prob = model.yield_curve_probability(spread)
            assert 0.01 <= prob <= 0.99

    def test_10y2y_curve_type(self, model):
        """Test 10y2y curve type uses different coefficients."""
        prob_10y3m = model.yield_curve_probability(-0.5, curve_type="10y3m")
        prob_10y2y = model.yield_curve_probability(-0.5, curve_type="10y2y")
        # Both should be elevated but may differ slightly
        assert prob_10y3m >= 0.45
        assert prob_10y2y >= 0.40

    def test_short_horizon_adjustment(self, model):
        """Test short horizon adjusts probability."""
        prob_12m = model.yield_curve_probability(-0.5, horizon_months=12)
        prob_3m = model.yield_curve_probability(-0.5, horizon_months=3)
        # Short horizon should have less predictive power
        assert prob_3m < prob_12m

    def test_long_horizon_adjustment(self, model):
        """Test long horizon adjusts probability."""
        prob_12m = model.yield_curve_probability(-0.5, horizon_months=12)
        prob_24m = model.yield_curve_probability(-0.5, horizon_months=24)
        # Long horizon should have slightly less predictive power
        assert prob_24m <= prob_12m


# =============================================================================
# CREDIT SPREAD SIGNAL TESTS
# =============================================================================


class TestCreditSpreadSignal:
    """Tests for credit spread signal calculation."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_tight_spreads_low_signal(self, model):
        """Test tight spreads give low recession signal."""
        signal = model.credit_spread_signal(300, -10)
        assert signal < 0.25

    def test_normal_spreads_moderate_signal(self, model):
        """Test normal spreads give moderate signal."""
        signal = model.credit_spread_signal(450, 20)
        assert 0.20 <= signal <= 0.45

    def test_elevated_spreads_higher_signal(self, model):
        """Test elevated spreads give higher signal."""
        signal = model.credit_spread_signal(550, 50)
        assert 0.40 <= signal <= 0.65

    def test_stressed_spreads_high_signal(self, model):
        """Test stressed spreads give high signal."""
        signal = model.credit_spread_signal(650, 100)
        assert signal >= 0.55

    def test_crisis_spreads_very_high_signal(self, model):
        """Test crisis-level spreads give very high signal."""
        signal = model.credit_spread_signal(850, 150)
        assert signal >= 0.80

    def test_tightening_spreads_lower_signal(self, model):
        """Test tightening spreads reduce signal."""
        signal_stable = model.credit_spread_signal(500, 0)
        signal_tightening = model.credit_spread_signal(500, -50)
        assert signal_tightening < signal_stable

    def test_widening_spreads_higher_signal(self, model):
        """Test widening spreads increase signal."""
        signal_stable = model.credit_spread_signal(500, 0)
        signal_widening = model.credit_spread_signal(500, 100)
        assert signal_widening > signal_stable

    def test_signal_bounded(self, model):
        """Test signal is bounded 0.05 to 0.95."""
        for spread in [100, 400, 600, 900]:
            for change in [-100, 0, 200]:
                signal = model.credit_spread_signal(spread, change)
                assert 0.05 <= signal <= 0.95


# =============================================================================
# LEI MOMENTUM SIGNAL TESTS
# =============================================================================


class TestLEIMomentumSignal:
    """Tests for LEI momentum signal calculation."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_strong_growth_low_signal(self, model):
        """Test strong growth gives low recession signal."""
        signal = model.lei_momentum_signal(3.0, 1.0)
        assert signal < 0.20

    def test_moderate_growth_low_signal(self, model):
        """Test moderate growth gives low signal."""
        signal = model.lei_momentum_signal(1.5, 0.5)
        assert 0.15 <= signal <= 0.35

    def test_stagnation_moderate_signal(self, model):
        """Test stagnation gives moderate signal."""
        signal = model.lei_momentum_signal(0.0, 0.0)
        assert 0.35 <= signal <= 0.55

    def test_contraction_elevated_signal(self, model):
        """Test contraction gives elevated signal."""
        signal = model.lei_momentum_signal(-1.5, -0.5)
        assert signal >= 0.50

    def test_sharp_contraction_high_signal(self, model):
        """Test sharp contraction gives high signal."""
        signal = model.lei_momentum_signal(-3.0, -1.5)
        assert signal >= 0.75

    def test_momentum_component(self, model):
        """Test 3-month momentum affects signal."""
        signal_stable = model.lei_momentum_signal(0.5, 0.0)
        signal_declining = model.lei_momentum_signal(0.5, -1.0)
        assert signal_declining > signal_stable

    def test_signal_bounded(self, model):
        """Test signal is bounded 0.05 to 0.95."""
        for yoy in [-4.0, -1.0, 0.0, 1.0, 4.0]:
            for mom in [-2.0, 0.0, 1.0]:
                signal = model.lei_momentum_signal(yoy, mom)
                assert 0.05 <= signal <= 0.95


# =============================================================================
# SAHM RULE SIGNAL TESTS
# =============================================================================


class TestSahmRuleSignal:
    """Tests for Sahm Rule signal calculation."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_no_deterioration_low_signal(self, model):
        """Test no unemployment deterioration gives low signal."""
        signal = model.sahm_rule_signal(-0.1)
        assert signal == 0.1

    def test_slight_rise_low_signal(self, model):
        """Test slight unemployment rise gives low signal."""
        signal = model.sahm_rule_signal(0.2)
        assert signal == 0.25

    def test_approaching_trigger_moderate_signal(self, model):
        """Test approaching trigger gives moderate signal."""
        signal = model.sahm_rule_signal(0.45)
        assert signal == 0.55

    def test_trigger_breached_high_signal(self, model):
        """Test trigger breach gives high signal."""
        signal = model.sahm_rule_signal(0.55)
        assert signal == 0.75

    def test_deep_breach_very_high_signal(self, model):
        """Test deep breach gives very high signal."""
        signal = model.sahm_rule_signal(1.0)
        assert signal == 0.95

    def test_sahm_threshold_at_0_5(self, model):
        """Test Sahm trigger at 0.5 threshold."""
        below = model.sahm_rule_signal(0.49)
        at = model.sahm_rule_signal(0.50)
        above = model.sahm_rule_signal(0.51)
        assert below < at <= above


# =============================================================================
# SIGNAL COMBINATION TESTS
# =============================================================================


class TestCombineSignals:
    """Tests for signal combination."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_combine_uniform_signals(self, model):
        """Test combining uniform signals."""
        signals = {
            "yield_curve_10y3m": 0.5,
            "yield_curve_10y2y": 0.5,
            "credit_spread": 0.5,
            "lei_momentum": 0.5,
            "sahm_indicator": 0.5,
            "financial_conditions": 0.5,
        }
        prob, conf = model.combine_signals(signals, model.WEIGHTS_12M, 12)
        assert prob == pytest.approx(0.5, abs=0.01)
        assert conf > 0.5  # High agreement should give good confidence

    def test_combine_low_risk_signals(self, model):
        """Test combining low risk signals."""
        signals = {
            "yield_curve_10y3m": 0.1,
            "yield_curve_10y2y": 0.1,
            "credit_spread": 0.2,
            "lei_momentum": 0.1,
            "sahm_indicator": 0.1,
            "financial_conditions": 0.2,
        }
        prob, conf = model.combine_signals(signals, model.WEIGHTS_12M, 12)
        assert prob < 0.20

    def test_combine_high_risk_signals(self, model):
        """Test combining high risk signals."""
        signals = {
            "yield_curve_10y3m": 0.8,
            "yield_curve_10y2y": 0.75,
            "credit_spread": 0.7,
            "lei_momentum": 0.8,
            "sahm_indicator": 0.85,
            "financial_conditions": 0.6,
        }
        prob, conf = model.combine_signals(signals, model.WEIGHTS_12M, 12)
        assert prob > 0.70

    def test_combine_missing_signals(self, model):
        """Test combining with missing signals."""
        signals = {
            "yield_curve_10y3m": 0.5,
            "credit_spread": 0.5,
        }
        prob, conf = model.combine_signals(signals, model.WEIGHTS_12M, 12)
        assert 0.01 <= prob <= 0.99
        # Lower confidence due to missing data
        assert conf < 1.0

    def test_combine_conflicting_signals(self, model):
        """Test combining conflicting signals reduces confidence."""
        signals = {
            "yield_curve_10y3m": 0.2,
            "yield_curve_10y2y": 0.2,
            "credit_spread": 0.8,
            "lei_momentum": 0.2,
            "sahm_indicator": 0.8,
            "financial_conditions": 0.2,
        }
        prob, conf = model.combine_signals(signals, model.WEIGHTS_12M, 12)
        # High variance should reduce confidence
        assert conf < 0.7

    def test_combine_empty_weights(self, model):
        """Test combining with empty weights."""
        signals = {"test": 0.5}
        prob, conf = model.combine_signals(signals, {}, 12)
        assert prob == 0.5
        assert conf == 0.0


# =============================================================================
# SIGNAL COLOR TESTS
# =============================================================================


class TestSignalColor:
    """Tests for signal color mapping."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_green_signal(self, model):
        """Test green signal for low probability."""
        assert model.get_signal_color(0.05) == "green"
        assert model.get_signal_color(0.10) == "green"
        assert model.get_signal_color(0.14) == "green"

    def test_yellow_signal(self, model):
        """Test yellow signal for moderate probability."""
        assert model.get_signal_color(0.15) == "yellow"
        assert model.get_signal_color(0.22) == "yellow"
        assert model.get_signal_color(0.29) == "yellow"

    def test_orange_signal(self, model):
        """Test orange signal for elevated probability."""
        assert model.get_signal_color(0.30) == "orange"
        assert model.get_signal_color(0.40) == "orange"
        assert model.get_signal_color(0.49) == "orange"

    def test_red_signal(self, model):
        """Test red signal for high probability."""
        assert model.get_signal_color(0.50) == "red"
        assert model.get_signal_color(0.70) == "red"
        assert model.get_signal_color(0.95) == "red"

    def test_boundary_values(self, model):
        """Test boundary values between colors."""
        assert model.get_signal_color(0.149) == "green"
        assert model.get_signal_color(0.150) == "yellow"
        assert model.get_signal_color(0.299) == "yellow"
        assert model.get_signal_color(0.300) == "orange"
        assert model.get_signal_color(0.499) == "orange"
        assert model.get_signal_color(0.500) == "red"


# =============================================================================
# INTERPRETATION TESTS
# =============================================================================


class TestInterpretations:
    """Tests for interpretation methods."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_interpret_yield_curve_steep(self, model):
        """Test yield curve interpretation for steep curve."""
        interp = model._interpret_yield_curve(2.0)
        assert "expansion" in interp.lower() or "steep" in interp.lower()

    def test_interpret_yield_curve_normal(self, model):
        """Test yield curve interpretation for normal curve."""
        interp = model._interpret_yield_curve(1.0)
        assert "low" in interp.lower() or "normal" in interp.lower()

    def test_interpret_yield_curve_flat(self, model):
        """Test yield curve interpretation for flat curve."""
        interp = model._interpret_yield_curve(0.25)
        assert "flat" in interp.lower() or "caution" in interp.lower()

    def test_interpret_yield_curve_inverted(self, model):
        """Test yield curve interpretation for inverted curve."""
        interp = model._interpret_yield_curve(-0.3)
        assert "inverted" in interp.lower()

    def test_interpret_yield_curve_deeply_inverted(self, model):
        """Test yield curve interpretation for deeply inverted curve."""
        interp = model._interpret_yield_curve(-1.0)
        assert "deeply" in interp.lower() or "strong" in interp.lower()

    def test_interpret_yield_curve_none(self, model):
        """Test yield curve interpretation for None."""
        interp = model._interpret_yield_curve(None)
        assert "unavailable" in interp.lower()

    def test_interpret_credit_spread_tight(self, model):
        """Test credit spread interpretation for tight spreads."""
        interp = model._interpret_credit_spread(250)
        assert "tight" in interp.lower() or "high" in interp.lower()

    def test_interpret_credit_spread_normal(self, model):
        """Test credit spread interpretation for normal spreads."""
        interp = model._interpret_credit_spread(350)
        assert "normal" in interp.lower() or "stable" in interp.lower()

    def test_interpret_credit_spread_elevated(self, model):
        """Test credit spread interpretation for elevated spreads."""
        interp = model._interpret_credit_spread(450)
        assert "elevated" in interp.lower() or "monitor" in interp.lower()

    def test_interpret_credit_spread_stressed(self, model):
        """Test credit spread interpretation for stressed spreads."""
        interp = model._interpret_credit_spread(650)
        assert "stress" in interp.lower()

    def test_interpret_lei_strong(self, model):
        """Test LEI interpretation for strong growth."""
        interp = model._interpret_lei(3.0)
        assert "strong" in interp.lower() or "positive" in interp.lower()

    def test_interpret_lei_contraction(self, model):
        """Test LEI interpretation for contraction."""
        interp = model._interpret_lei(-1.5)
        assert "contraction" in interp.lower() or "caution" in interp.lower()

    def test_interpret_sahm_below_trigger(self, model):
        """Test Sahm interpretation below trigger."""
        interp = model._interpret_sahm(0.2)
        assert "below" in interp.lower() or "no" in interp.lower()

    def test_interpret_sahm_approaching(self, model):
        """Test Sahm interpretation approaching trigger."""
        interp = model._interpret_sahm(0.45)
        assert "approaching" in interp.lower() or "elevated" in interp.lower()

    def test_interpret_sahm_triggered(self, model):
        """Test Sahm interpretation when triggered."""
        interp = model._interpret_sahm(0.55)
        assert "triggered" in interp.lower() or "breach" in interp.lower()


# =============================================================================
# MOCK DATA TESTS
# =============================================================================


class TestMockData:
    """Tests for mock data generation."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_mock_yield_curve_data(self, model):
        """Test mock yield curve data generation."""
        data = model._mock_yield_curve_data()
        assert "10y3m" in data
        assert "10y2y" in data
        assert data["10y3m"] == 0.50
        assert data["10y2y"] == 0.30


# =============================================================================
# ASYNC TESTS
# =============================================================================


class TestAsyncMethods:
    """Async tests for model methods."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    @pytest.mark.asyncio
    async def test_get_recession_probability(self, model):
        """Test getting recession probability."""
        result = await model.get_recession_probability("USA")
        assert isinstance(result, RecessionProbability)
        assert 0 <= result.probability_3m <= 1
        assert 0 <= result.probability_6m <= 1
        assert 0 <= result.probability_12m <= 1
        assert 0 <= result.probability_24m <= 1
        assert result.current_signal in ["green", "yellow", "orange", "red"]
        assert result.model_version == "1.0.0"

    @pytest.mark.asyncio
    async def test_get_historical_accuracy(self, model):
        """Test getting historical accuracy."""
        accuracy = await model.get_historical_accuracy(lookback_years=20)
        assert isinstance(accuracy, HistoricalAccuracy)
        assert 0 <= accuracy.precision <= 1
        assert 0 <= accuracy.recall <= 1
        assert accuracy.sample_periods > 0

    @pytest.mark.asyncio
    async def test_get_component_breakdown(self, model):
        """Test getting component breakdown."""
        breakdown = await model.get_component_breakdown("USA")
        assert "timestamp" in breakdown
        assert "country" in breakdown
        assert "components" in breakdown
        assert breakdown["country"] == "USA"

    @pytest.mark.asyncio
    async def test_gather_signals(self, model):
        """Test signal gathering."""
        signals = await model._gather_signals("USA")
        # All factors should be present (with neutral fallback)
        for factor in model.WEIGHTS_12M.keys():
            assert factor in signals
            assert 0 <= signals[factor] <= 1

    @pytest.mark.asyncio
    async def test_get_yield_curve_data_no_adapter(self, model):
        """Test yield curve data without adapter returns mock."""
        data = await model._get_yield_curve_data("USA")
        assert data is not None
        assert "10y3m" in data

    @pytest.mark.asyncio
    async def test_get_credit_spread_data(self, model):
        """Test credit spread data returns mock."""
        data = await model._get_credit_spread_data("USA")
        assert data is not None
        assert "hy_spread" in data

    @pytest.mark.asyncio
    async def test_get_lei_data_no_adapter(self, model):
        """Test LEI data without adapter returns mock."""
        data = await model._get_lei_data("USA")
        assert data is not None
        assert "yoy_change" in data

    @pytest.mark.asyncio
    async def test_get_sahm_indicator_no_adapter(self, model):
        """Test Sahm indicator without adapter returns mock."""
        value = await model._get_sahm_indicator("USA")
        assert value is not None
        assert isinstance(value, float)

    @pytest.mark.asyncio
    async def test_get_financial_conditions(self, model):
        """Test financial conditions returns neutral value."""
        value = await model._get_financial_conditions("USA")
        assert value == 0.0


# =============================================================================
# FCI SIGNAL TESTS
# =============================================================================


class TestFCISignal:
    """Tests for Financial Conditions Index signal."""

    @pytest.fixture
    def model(self):
        return RecessionProbabilityModel()

    def test_fci_loose_conditions(self, model):
        """Test FCI signal for loose conditions."""
        signal = model._fci_signal(-1.5)
        assert signal == 0.1

    def test_fci_neutral_conditions(self, model):
        """Test FCI signal for neutral conditions."""
        signal = model._fci_signal(0.0)
        assert signal == 0.2

    def test_fci_slightly_tight(self, model):
        """Test FCI signal for slightly tight conditions."""
        signal = model._fci_signal(0.5)
        assert signal == 0.35

    def test_fci_tight_conditions(self, model):
        """Test FCI signal for tight conditions."""
        signal = model._fci_signal(1.0)
        assert signal == 0.5

    def test_fci_very_tight(self, model):
        """Test FCI signal for very tight conditions."""
        signal = model._fci_signal(1.5)
        assert signal == 0.65

    def test_fci_crisis_conditions(self, model):
        """Test FCI signal for crisis conditions."""
        signal = model._fci_signal(2.5)
        assert signal == 0.9


# =============================================================================
# NBER RECESSION DATES TESTS
# =============================================================================


class TestNBERDates:
    """Tests related to NBER recession dating."""

    @pytest.mark.asyncio
    async def test_historical_accuracy_includes_recessions(self):
        """Test historical accuracy calculation includes recession periods."""
        model = RecessionProbabilityModel()
        accuracy = await model.get_historical_accuracy(lookback_years=40)
        assert accuracy.recession_periods > 0
        assert accuracy.sample_periods > accuracy.recession_periods
