"""
Tests for SmartMoneyIndex module.
"""

import pytest
import numpy as np
from unittest.mock import Mock

from stanley.analytics.smart_money_index import (
    SmartMoneyIndex,
    ComponentWeight,
    IndexResult,
    SignalType,
)


class TestSmartMoneyIndexInit:
    """Tests for SmartMoneyIndex initialization."""

    def test_init_without_dependencies(self):
        """Test initialization without dependencies."""
        smi = SmartMoneyIndex()
        assert smi is not None
        assert smi.data_manager is None

    def test_init_with_data_manager(self):
        """Test initialization with data manager."""
        mock_dm = Mock()
        smi = SmartMoneyIndex(data_manager=mock_dm)
        assert smi.data_manager is mock_dm

    def test_init_with_analyzers(self):
        """Test initialization with analyzers."""
        mock_inst = Mock()
        mock_mf = Mock()
        smi = SmartMoneyIndex(
            institutional_analyzer=mock_inst,
            money_flow_analyzer=mock_mf,
        )
        assert smi.institutional_analyzer is mock_inst
        assert smi.money_flow_analyzer is mock_mf

    def test_default_weights(self):
        """Test default weights are applied."""
        smi = SmartMoneyIndex()
        assert smi.weights is not None
        assert isinstance(smi.weights, ComponentWeight)


class TestComponentWeight:
    """Tests for ComponentWeight dataclass."""

    def test_default_weights_sum_to_one(self):
        """Test default weights sum to 1.0."""
        weights = ComponentWeight()
        total = (
            weights.institutional_ownership
            + weights.dark_pool_activity
            + weights.options_flow
            + weights.whale_movements
            + weights.insider_trading
            + weights.short_interest
            + weights.block_trades
            + weights.etf_flow_momentum
        )
        assert np.isclose(total, 1.0, atol=0.01)

    def test_custom_weights_normalized(self):
        """Test that custom weights get normalized."""
        weights = ComponentWeight(
            institutional_ownership=0.5,
            dark_pool_activity=0.5,
            options_flow=0.0,
            whale_movements=0.0,
            insider_trading=0.0,
            short_interest=0.0,
            block_trades=0.0,
            etf_flow_momentum=0.0,
        )
        total = (
            weights.institutional_ownership
            + weights.dark_pool_activity
            + weights.options_flow
            + weights.whale_movements
            + weights.insider_trading
            + weights.short_interest
            + weights.block_trades
            + weights.etf_flow_momentum
        )
        assert np.isclose(total, 1.0, atol=0.01)


class TestSignalType:
    """Tests for SignalType enum."""

    def test_signal_type_values(self):
        """Test signal type enum values."""
        assert SignalType.STRONG_BUY.value == "strong_buy"
        assert SignalType.BUY.value == "buy"
        assert SignalType.HOLD.value == "hold"
        assert SignalType.SELL.value == "sell"
        assert SignalType.STRONG_SELL.value == "strong_sell"


class TestSmartMoneyIndexMethods:
    """Tests for SmartMoneyIndex methods."""

    def test_has_calculate_index_method(self):
        """Test that calculate_index method exists."""
        smi = SmartMoneyIndex()
        assert hasattr(smi, "calculate_index")

    def test_has_index_cache(self):
        """Test that index cache exists."""
        smi = SmartMoneyIndex()
        assert hasattr(smi, "_index_cache")
        assert isinstance(smi._index_cache, dict)


class TestSmartMoneyIndexEdgeCases:
    """Edge case tests for SmartMoneyIndex."""

    def test_none_analyzers(self):
        """Test all analyzers as None."""
        smi = SmartMoneyIndex()
        assert smi.institutional_analyzer is None
        assert smi.money_flow_analyzer is None
        assert smi.options_flow_analyzer is None
        assert smi.whale_tracker is None

    def test_custom_weights_object(self):
        """Test with custom ComponentWeight object."""
        weights = ComponentWeight(institutional_ownership=0.5, dark_pool_activity=0.5)
        smi = SmartMoneyIndex(weights=weights)
        assert smi.weights is weights
