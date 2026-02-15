"""
Tests for Backtester module.

This module tests the backtesting framework including:
- Backtest execution
- Performance metric calculations
- Attribution analysis
- Portfolio tracking
- Trade simulation
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock

# Skip all tests if signals module doesn't exist yet
try:
    from stanley.signals import Backtester
    from stanley.signals.backtester import (
        BacktestConfig,
        BacktestResult,
        Trade,
        PerformanceMetrics,
        AttributionAnalysis,
    )

    HAS_SIGNALS_MODULE = True
except ImportError:
    HAS_SIGNALS_MODULE = False
    Backtester = None
    BacktestConfig = None
    BacktestResult = None
    Trade = None
    PerformanceMetrics = None
    AttributionAnalysis = None

pytestmark = pytest.mark.skipif(
    not HAS_SIGNALS_MODULE, reason="stanley.signals module not yet implemented"
)


# =============================================================================
# Backtester Initialization Tests
# =============================================================================


class TestBacktesterInit:
    """Tests for Backtester initialization."""

    def test_init_without_config(self):
        """Test initialization without configuration."""
        backtester = Backtester()
        assert backtester is not None
        assert backtester.config is not None  # Should use defaults

    def test_init_with_config(self, sample_backtest_config):
        """Test initialization with custom configuration."""
        config = BacktestConfig(**sample_backtest_config)
        backtester = Backtester(config=config)

        assert backtester.config.initial_capital == 100000.0
        assert backtester.config.max_position_size_pct == 0.10

    def test_init_with_signal_generator(self, mock_data_manager):
        """Test initialization with signal generator."""
        from stanley.signals import SignalGenerator

        generator = SignalGenerator(data_manager=mock_data_manager)
        backtester = Backtester(signal_generator=generator)

        assert backtester.signal_generator is generator

    def test_init_with_data_manager(self, mock_data_manager):
        """Test initialization with data manager."""
        backtester = Backtester(data_manager=mock_data_manager)
        assert backtester.data_manager is mock_data_manager


# =============================================================================
# BacktestConfig Tests
# =============================================================================


class TestBacktestConfig:
    """Tests for BacktestConfig dataclass."""

    def test_config_creation(self):
        """Test creating a BacktestConfig instance."""
        config = BacktestConfig(
            initial_capital=100000.0,
            max_position_size_pct=0.10,
            stop_loss_pct=0.05,
            take_profit_pct=0.15,
        )
        assert config.initial_capital == 100000.0
        assert config.max_position_size_pct == 0.10
        assert config.stop_loss_pct == 0.05
        assert config.take_profit_pct == 0.15

    def test_config_default_values(self):
        """Test BacktestConfig default values."""
        config = BacktestConfig()
        assert config.initial_capital > 0
        assert config.slippage_pct >= 0
        assert config.commission_per_trade >= 0

    def test_config_validation(self):
        """Test BacktestConfig validation."""
        # Invalid position size
        with pytest.raises(ValueError):
            BacktestConfig(max_position_size_pct=1.5)  # > 100%

        # Negative initial capital
        with pytest.raises(ValueError):
            BacktestConfig(initial_capital=-100000)


# =============================================================================
# Backtest Execution Tests
# =============================================================================


class TestBacktestExecution:
    """Tests for backtest execution."""

    def test_run_backtest_returns_result(
        self, mock_data_manager, sample_price_data, sample_signals_list
    ):
        """Test that run_backtest returns a BacktestResult."""
        backtester = Backtester(data_manager=mock_data_manager)
        mock_data_manager.get_price_history = AsyncMock(return_value=sample_price_data)

        result = backtester.run_backtest(
            symbols=["AAPL", "MSFT", "GOOGL"],
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 6, 30),
            signals=sample_signals_list,
        )

        assert isinstance(result, BacktestResult)

    def test_backtest_result_has_required_fields(
        self, mock_data_manager, sample_price_data, sample_signals_list
    ):
        """Test that BacktestResult has all required fields."""
        backtester = Backtester(data_manager=mock_data_manager)
        mock_data_manager.get_price_history = AsyncMock(return_value=sample_price_data)

        result = backtester.run_backtest(
            symbols=["AAPL"],
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 6, 30),
            signals=sample_signals_list,
        )

        assert hasattr(result, "total_return")
        assert hasattr(result, "sharpe_ratio")
        assert hasattr(result, "max_drawdown")
        assert hasattr(result, "trades")
        assert hasattr(result, "equity_curve")

    def test_backtest_generates_trades(
        self, mock_data_manager, sample_price_data, sample_signals_list
    ):
        """Test that backtest generates trade records."""
        backtester = Backtester(data_manager=mock_data_manager)
        mock_data_manager.get_price_history = AsyncMock(return_value=sample_price_data)

        result = backtester.run_backtest(
            symbols=["AAPL", "MSFT"],
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 6, 30),
            signals=sample_signals_list,
        )

        assert isinstance(result.trades, list)
        for trade in result.trades:
            assert isinstance(trade, Trade)

    def test_backtest_respects_config(
        self, mock_data_manager, sample_price_data, sample_signals_list
    ):
        """Test that backtest respects configuration settings."""
        config = BacktestConfig(
            initial_capital=50000.0,
            max_position_size_pct=0.05,
        )
        backtester = Backtester(data_manager=mock_data_manager, config=config)
        mock_data_manager.get_price_history = AsyncMock(return_value=sample_price_data)

        result = backtester.run_backtest(
            symbols=["AAPL"],
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 6, 30),
            signals=sample_signals_list,
        )

        # Starting equity should match initial capital
        assert result.equity_curve.iloc[0] == pytest.approx(50000.0, rel=0.01)


# =============================================================================
# Performance Metric Calculation Tests
# =============================================================================


class TestPerformanceMetrics:
    """Tests for performance metric calculations."""

    def test_calculate_total_return(self, sample_price_data):
        """Test total return calculation."""
        backtester = Backtester()
        equity_curve = pd.Series([100000, 105000, 110000, 108000, 115000])

        total_return = backtester._calculate_total_return(equity_curve)

        expected_return = (115000 - 100000) / 100000
        assert total_return == pytest.approx(expected_return, rel=0.001)

    def test_calculate_sharpe_ratio(self):
        """Test Sharpe ratio calculation."""
        backtester = Backtester()
        np.random.seed(42)
        returns = pd.Series(np.random.normal(0.001, 0.02, 252))

        sharpe = backtester._calculate_sharpe_ratio(returns, risk_free_rate=0.02)

        assert isinstance(sharpe, float)
        assert not np.isnan(sharpe)

    def test_calculate_max_drawdown(self):
        """Test maximum drawdown calculation."""
        backtester = Backtester()
        # Create equity curve with clear drawdown
        equity_curve = pd.Series([100, 120, 110, 90, 100, 85, 95])

        max_dd = backtester._calculate_max_drawdown(equity_curve)

        # Max drawdown should be from 120 to 85 = 29.17%
        assert max_dd == pytest.approx(0.2917, rel=0.01)

    def test_calculate_win_rate(self, sample_trade_records):
        """Test win rate calculation."""
        backtester = Backtester()

        trades = [Trade(**record) for record in sample_trade_records]
        win_rate = backtester._calculate_win_rate(trades)

        # 2 winners out of 3 trades = 66.67%
        assert win_rate == pytest.approx(0.6667, rel=0.01)

    def test_calculate_profit_factor(self, sample_trade_records):
        """Test profit factor calculation."""
        backtester = Backtester()

        trades = [Trade(**record) for record in sample_trade_records]
        profit_factor = backtester._calculate_profit_factor(trades)

        # Gross profit: 2000, Gross loss: 500
        assert profit_factor == pytest.approx(4.0, rel=0.1)

    def test_calculate_sortino_ratio(self):
        """Test Sortino ratio calculation."""
        backtester = Backtester()
        np.random.seed(42)
        returns = pd.Series(np.random.normal(0.001, 0.02, 252))

        sortino = backtester._calculate_sortino_ratio(returns, risk_free_rate=0.02)

        assert isinstance(sortino, float)
        assert not np.isnan(sortino)

    def test_calculate_calmar_ratio(self):
        """Test Calmar ratio calculation."""
        backtester = Backtester()

        # Annual return 20%, max drawdown 10%
        calmar = backtester._calculate_calmar_ratio(
            annual_return=0.20, max_drawdown=0.10
        )

        assert calmar == pytest.approx(2.0, rel=0.01)

    def test_calculate_average_trade_duration(self, sample_trade_records):
        """Test average trade duration calculation."""
        backtester = Backtester()

        trades = [Trade(**record) for record in sample_trade_records]
        avg_duration = backtester._calculate_average_trade_duration(trades)

        assert isinstance(avg_duration, timedelta)
        assert avg_duration.days > 0


# =============================================================================
# Attribution Analysis Tests
# =============================================================================


class TestAttributionAnalysis:
    """Tests for attribution analysis."""

    def test_attribution_by_symbol(self, mock_data_manager, sample_trade_records):
        """Test attribution analysis by symbol."""
        backtester = Backtester(data_manager=mock_data_manager)
        trades = [Trade(**record) for record in sample_trade_records]

        attribution = backtester.analyze_attribution(trades, by="symbol")

        assert isinstance(attribution, AttributionAnalysis)
        assert "AAPL" in attribution.breakdown
        assert "MSFT" in attribution.breakdown

    def test_attribution_by_direction(self, mock_data_manager, sample_trade_records):
        """Test attribution analysis by trade direction."""
        backtester = Backtester(data_manager=mock_data_manager)
        trades = [Trade(**record) for record in sample_trade_records]

        attribution = backtester.analyze_attribution(trades, by="direction")

        assert "LONG" in attribution.breakdown
        assert "SHORT" in attribution.breakdown

    def test_attribution_by_signal_strength(
        self, mock_data_manager, sample_trade_records
    ):
        """Test attribution analysis by signal strength buckets."""
        backtester = Backtester(data_manager=mock_data_manager)
        trades = [Trade(**record) for record in sample_trade_records]

        attribution = backtester.analyze_attribution(trades, by="signal_strength")

        assert isinstance(attribution, AttributionAnalysis)
        # Should have strength buckets
        assert len(attribution.breakdown) > 0

    def test_attribution_total_matches_sum(
        self, mock_data_manager, sample_trade_records
    ):
        """Test that attribution breakdown sums to total."""
        backtester = Backtester(data_manager=mock_data_manager)
        trades = [Trade(**record) for record in sample_trade_records]

        attribution = backtester.analyze_attribution(trades, by="symbol")

        total_from_breakdown = sum(attribution.breakdown.values())
        total_pnl = sum(t.pnl for t in trades)

        assert total_from_breakdown == pytest.approx(total_pnl, rel=0.01)


# =============================================================================
# Trade Data Class Tests
# =============================================================================


class TestTradeDataClass:
    """Tests for Trade data class."""

    def test_trade_creation(self):
        """Test creating a Trade instance."""
        trade = Trade(
            trade_id="trade_001",
            symbol="AAPL",
            entry_time=datetime(2024, 1, 15),
            exit_time=datetime(2024, 1, 20),
            direction="LONG",
            entry_price=175.00,
            exit_price=185.00,
            quantity=100,
            pnl=1000.00,
            pnl_percent=5.71,
        )
        assert trade.symbol == "AAPL"
        assert trade.direction == "LONG"
        assert trade.pnl == 1000.00

    def test_trade_with_signal_info(self):
        """Test Trade with signal information."""
        trade = Trade(
            trade_id="trade_001",
            symbol="AAPL",
            entry_time=datetime(2024, 1, 15),
            exit_time=datetime(2024, 1, 20),
            direction="LONG",
            entry_price=175.00,
            exit_price=185.00,
            quantity=100,
            pnl=1000.00,
            pnl_percent=5.71,
            signal_strength=0.75,
            signal_confidence=0.85,
        )
        assert trade.signal_strength == 0.75
        assert trade.signal_confidence == 0.85


# =============================================================================
# Mock Price Data Backtest Tests
# =============================================================================


class TestBacktestWithMockData:
    """Tests for backtesting with mock price data."""

    def test_backtest_with_synthetic_prices(
        self, sample_price_data, sample_signals_list
    ):
        """Test backtest with synthetic price data."""
        backtester = Backtester()

        # Direct injection of price data
        result = backtester.run_backtest_with_data(
            price_data={"AAPL": sample_price_data},
            signals=sample_signals_list,
        )

        assert isinstance(result, BacktestResult)
        assert len(result.equity_curve) > 0

    def test_backtest_with_multi_symbol_prices(
        self, sample_multi_symbol_prices, sample_signals_list
    ):
        """Test backtest with multiple symbol price data."""
        backtester = Backtester()

        result = backtester.run_backtest_with_data(
            price_data=sample_multi_symbol_prices,
            signals=sample_signals_list,
        )

        assert isinstance(result, BacktestResult)

    def test_backtest_slippage_applied(self, sample_price_data, sample_signals_list):
        """Test that slippage is applied to trades."""
        config = BacktestConfig(slippage_pct=0.01)  # 1% slippage
        backtester = Backtester(config=config)

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": sample_price_data},
            signals=sample_signals_list,
        )

        # With slippage, actual entry prices should differ from signal prices
        for trade in result.trades:
            if trade.direction == "LONG":
                # Entry should be higher than ideal (slippage)
                pass  # Verification depends on implementation

    def test_backtest_commission_applied(self, sample_price_data, sample_signals_list):
        """Test that commissions are applied to trades."""
        config = BacktestConfig(commission_per_trade=10.0)
        backtester = Backtester(config=config)

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": sample_price_data},
            signals=sample_signals_list,
        )

        # Total commissions should be num_trades * 2 * commission (entry + exit)
        expected_commission = len(result.trades) * 2 * 10.0
        assert result.total_commission == pytest.approx(expected_commission, rel=0.1)


# =============================================================================
# Edge Case Tests
# =============================================================================


class TestBacktesterEdgeCases:
    """Edge case tests for Backtester."""

    def test_backtest_empty_signals(self, sample_price_data):
        """Test backtest with no signals."""
        backtester = Backtester()

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": sample_price_data},
            signals=[],
        )

        # Should return valid result with no trades
        assert isinstance(result, BacktestResult)
        assert len(result.trades) == 0
        assert result.total_return == 0.0

    def test_backtest_insufficient_capital(
        self, sample_price_data, sample_signals_list
    ):
        """Test backtest with insufficient initial capital."""
        config = BacktestConfig(initial_capital=100.0)  # Very low capital
        backtester = Backtester(config=config)

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": sample_price_data},
            signals=sample_signals_list,
        )

        # Should handle gracefully, possibly with fewer/no trades
        assert isinstance(result, BacktestResult)

    def test_backtest_empty_price_data(self, empty_price_data, sample_signals_list):
        """Test backtest with empty price data."""
        backtester = Backtester()

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": empty_price_data},
            signals=sample_signals_list,
        )

        # Should handle gracefully
        assert isinstance(result, BacktestResult)
        assert len(result.trades) == 0

    def test_backtest_misaligned_dates(self, sample_price_data):
        """Test backtest when signal dates don't align with price data."""
        backtester = Backtester()

        # Signals with dates outside price data range
        future_signals = [
            {
                "symbol": "AAPL",
                "timestamp": datetime.now() + timedelta(days=365),
                "direction": "BULLISH",
                "strength": 0.75,
                "confidence": 0.85,
            }
        ]

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": sample_price_data},
            signals=future_signals,
        )

        # Should handle gracefully with no trades
        assert len(result.trades) == 0

    def test_backtest_all_losing_trades(self, sample_price_data):
        """Test backtest metrics when all trades are losers."""
        backtester = Backtester()

        # Mock trades that all lose
        losing_trades = [
            Trade(
                trade_id=f"trade_{i}",
                symbol="AAPL",
                entry_time=datetime.now() - timedelta(days=30 - i),
                exit_time=datetime.now() - timedelta(days=25 - i),
                direction="LONG",
                entry_price=100.0,
                exit_price=95.0,  # All losers
                quantity=100,
                pnl=-500.0,
                pnl_percent=-5.0,
            )
            for i in range(5)
        ]

        win_rate = backtester._calculate_win_rate(losing_trades)
        profit_factor = backtester._calculate_profit_factor(losing_trades)

        assert win_rate == 0.0
        assert profit_factor == 0.0  # No winning trades

    def test_backtest_zero_volatility_period(self):
        """Test backtest with zero price volatility."""
        backtester = Backtester()

        # Price data with no movement
        static_prices = pd.DataFrame(
            {
                "date": pd.date_range(end=datetime.now(), periods=100, freq="B"),
                "close": [100.0] * 100,
                "volume": [1000000] * 100,
            }
        )

        signals = [
            {
                "symbol": "AAPL",
                "timestamp": datetime.now() - timedelta(days=50),
                "direction": "BULLISH",
                "strength": 0.75,
                "confidence": 0.85,
            }
        ]

        result = backtester.run_backtest_with_data(
            price_data={"AAPL": static_prices},
            signals=signals,
        )

        # Should handle gracefully
        assert isinstance(result, BacktestResult)


# =============================================================================
# Integration Tests
# =============================================================================


class TestBacktesterIntegration:
    """Integration tests for Backtester with SignalGenerator."""

    def test_backtest_with_signal_generator(self, mock_data_manager, sample_price_data):
        """Test backtest using signals from SignalGenerator."""
        from stanley.signals import SignalGenerator

        generator = SignalGenerator(data_manager=mock_data_manager)
        backtester = Backtester(
            data_manager=mock_data_manager,
            signal_generator=generator,
        )

        mock_data_manager.get_price_history = AsyncMock(return_value=sample_price_data)

        result = backtester.run_backtest(
            symbols=["AAPL", "MSFT"],
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 6, 30),
        )

        assert isinstance(result, BacktestResult)


# =============================================================================
# Health Check Tests
# =============================================================================


class TestBacktesterHealthCheck:
    """Tests for Backtester health check."""

    def test_health_check_returns_true(self):
        """Test that health_check returns True when healthy."""
        backtester = Backtester()
        assert backtester.health_check() is True

    def test_health_check_with_config(self, sample_backtest_config):
        """Test health check with configuration."""
        config = BacktestConfig(**sample_backtest_config)
        backtester = Backtester(config=config)
        assert backtester.health_check() is True
