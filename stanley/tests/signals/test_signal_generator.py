"""
Tests for SignalGenerator module.
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, AsyncMock

from stanley.signals import (
    SignalGenerator,
    Signal,
    SignalType,
    SignalStrength,
    CompositeSignal,
)


class TestSignalGeneratorInit:
    """Tests for SignalGenerator initialization."""

    def test_init_without_dependencies(self):
        """Test initialization without data manager."""
        generator = SignalGenerator()
        assert generator is not None
        assert generator.data_manager is None

    def test_init_with_data_manager(self):
        """Test initialization with mock data manager."""
        mock_dm = Mock()
        generator = SignalGenerator(data_manager=mock_dm)
        assert generator.data_manager is mock_dm

    def test_init_with_custom_weights(self):
        """Test initialization with custom factor weights."""
        weights = {"money_flow": 0.5, "institutional": 0.5}
        generator = SignalGenerator(weights=weights)
        # Weights should be normalized
        assert sum(generator.weights.values()) == pytest.approx(1.0)

    def test_init_with_analyzers(self):
        """Test initialization with pre-configured analyzers."""
        mock_mf = Mock()
        mock_inst = Mock()
        generator = SignalGenerator(
            money_flow_analyzer=mock_mf,
            institutional_analyzer=mock_inst,
        )
        assert generator.money_flow_analyzer is mock_mf
        assert generator.institutional_analyzer is mock_inst

    def test_default_factor_weights(self):
        """Test that default factor weights sum to 1.0."""
        generator = SignalGenerator()
        total_weight = sum(generator.weights.values())
        assert total_weight == pytest.approx(1.0, abs=0.001)


class TestSignalDataClass:
    """Tests for Signal data class."""

    def test_signal_creation(self):
        """Test creating a Signal instance."""
        signal = Signal(
            symbol="AAPL",
            signal_type=SignalType.BUY,
            strength=SignalStrength.STRONG,
            conviction=0.85,
            factors={"money_flow": 0.7, "institutional": 0.8},
        )
        assert signal.symbol == "AAPL"
        assert signal.signal_type == SignalType.BUY
        assert signal.conviction == 0.85

    def test_signal_with_factors(self):
        """Test signal with factor contributions."""
        factors = {"money_flow": 0.5, "institutional": 0.6, "valuation": 0.4}
        signal = Signal(
            symbol="MSFT",
            signal_type=SignalType.BUY,
            strength=SignalStrength.MODERATE,
            conviction=0.7,
            factors=factors,
        )
        assert signal.factors == factors

    def test_signal_with_price_targets(self):
        """Test signal with price targets."""
        signal = Signal(
            symbol="GOOGL",
            signal_type=SignalType.BUY,
            strength=SignalStrength.STRONG,
            conviction=0.9,
            factors={"momentum": 0.8},
            price_at_signal=150.0,
            target_price=180.0,
            stop_loss=140.0,
        )
        assert signal.price_at_signal == 150.0
        assert signal.target_price == 180.0
        assert signal.stop_loss == 140.0


class TestSignalType:
    """Tests for SignalType enum."""

    def test_signal_type_values(self):
        """Test signal type enum values."""
        assert SignalType.BUY.value == "buy"
        assert SignalType.SELL.value == "sell"
        assert SignalType.HOLD.value == "hold"


class TestSignalStrength:
    """Tests for SignalStrength enum."""

    def test_signal_strength_values(self):
        """Test signal strength enum values."""
        assert SignalStrength.WEAK.value == "weak"
        assert SignalStrength.MODERATE.value == "moderate"
        assert SignalStrength.STRONG.value == "strong"
        assert SignalStrength.VERY_STRONG.value == "very_strong"

    def test_from_score_very_strong(self):
        """Test from_score for very strong signals."""
        assert SignalStrength.from_score(0.9) == SignalStrength.VERY_STRONG
        assert SignalStrength.from_score(0.8) == SignalStrength.VERY_STRONG

    def test_from_score_strong(self):
        """Test from_score for strong signals."""
        assert SignalStrength.from_score(0.7) == SignalStrength.STRONG
        assert SignalStrength.from_score(0.6) == SignalStrength.STRONG

    def test_from_score_moderate(self):
        """Test from_score for moderate signals."""
        assert SignalStrength.from_score(0.5) == SignalStrength.MODERATE
        assert SignalStrength.from_score(0.4) == SignalStrength.MODERATE

    def test_from_score_weak(self):
        """Test from_score for weak signals."""
        assert SignalStrength.from_score(0.3) == SignalStrength.WEAK
        assert SignalStrength.from_score(0.1) == SignalStrength.WEAK


class TestCompositeSignal:
    """Tests for CompositeSignal data class."""

    def test_composite_signal_creation(self):
        """Test creating a CompositeSignal instance."""
        signal = CompositeSignal(
            symbol="AAPL",
            overall_score=0.65,
            signal_type=SignalType.BUY,
            strength=SignalStrength.STRONG,
            conviction=0.8,
            money_flow_score=0.7,
            institutional_score=0.6,
            valuation_score=0.5,
            momentum_score=0.8,
            quality_score=0.6,
            weights={"money_flow": 0.25, "institutional": 0.25},
        )
        assert signal.symbol == "AAPL"
        assert signal.overall_score == 0.65

    def test_composite_signal_to_dict(self):
        """Test CompositeSignal to_dict method."""
        signal = CompositeSignal(
            symbol="MSFT",
            overall_score=0.5,
            signal_type=SignalType.HOLD,
            strength=SignalStrength.MODERATE,
            conviction=0.6,
            money_flow_score=0.5,
            institutional_score=0.5,
            valuation_score=0.5,
            momentum_score=0.5,
            quality_score=0.5,
            weights={"money_flow": 0.2},
        )
        d = signal.to_dict()
        assert d["symbol"] == "MSFT"
        assert "overallScore" in d
        assert "factorScores" in d


class TestSignalGeneratorMethods:
    """Tests for SignalGenerator methods."""

    def test_weights_property(self):
        """Test weights property."""
        generator = SignalGenerator()
        assert "money_flow" in generator.weights
        assert "institutional" in generator.weights

    def test_default_weights(self):
        """Test DEFAULT_WEIGHTS class attribute."""
        assert "money_flow" in SignalGenerator.DEFAULT_WEIGHTS
        assert SignalGenerator.DEFAULT_WEIGHTS["money_flow"] == 0.25

    def test_buy_threshold(self):
        """Test BUY_THRESHOLD constant."""
        assert SignalGenerator.BUY_THRESHOLD == 0.2

    def test_sell_threshold(self):
        """Test SELL_THRESHOLD constant."""
        assert SignalGenerator.SELL_THRESHOLD == -0.2


class TestSignalGeneratorEdgeCases:
    """Edge case tests for SignalGenerator."""

    def test_empty_weights(self):
        """Test with empty weights dict."""
        generator = SignalGenerator(weights={})
        # Should fall back to defaults or handle gracefully
        assert generator is not None

    def test_single_weight(self):
        """Test with single factor weight."""
        generator = SignalGenerator(weights={"money_flow": 1.0})
        assert generator.weights["money_flow"] == 1.0

    def test_none_analyzers(self):
        """Test all analyzers as None."""
        generator = SignalGenerator()
        assert generator.money_flow_analyzer is None
        assert generator.institutional_analyzer is None
        assert generator.research_analyzer is None
        assert generator.portfolio_analyzer is None
