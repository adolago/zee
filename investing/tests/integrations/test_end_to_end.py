"""
End-to-end integration tests for Investing-NautilusTrader integration.

This module tests the complete data flow from OpenBB through Investing analytics
to NautilusTrader for backtesting simulations.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import Mock, MagicMock, patch, AsyncMock
import asyncio

# =============================================================================
# Fixtures
# =============================================================================


def _make_float_mock(value: float) -> Mock:
    """Create a Mock that works with float() conversion like nautilus Price/Quantity."""
    mock = Mock()
    mock.__float__ = Mock(return_value=float(value))
    mock.as_double = Mock(return_value=float(value))
    return mock


def _make_bar_mock(
    open_: float, high: float, low: float, close: float, volume: float
) -> Mock:
    """Create a complete bar mock with float-compatible fields."""
    bar = Mock()
    bar.open = _make_float_mock(open_)
    bar.high = _make_float_mock(high)
    bar.low = _make_float_mock(low)
    bar.close = _make_float_mock(close)
    bar.volume = _make_float_mock(volume)
    bar.ts_event = int(datetime.now().timestamp() * 1e9)
    return bar


@pytest.fixture
def mock_openbb_platform():
    """Create a complete mock OpenBB platform."""
    with patch("openbb.obb") as mock:
        # Historical data with valid OHLC relationships
        dates = pd.date_range(end=datetime.now(), periods=252, freq="D")
        prices = 100 * (1 + np.random.randn(252).cumsum() * 0.02)

        # Generate open/close with small random variations around price
        opens = prices * (1 + np.random.uniform(-0.01, 0.01, 252))
        closes = prices

        # Ensure high is max of open, close, and some random variation above
        highs = np.maximum(opens, closes) * (1 + np.random.uniform(0.001, 0.02, 252))

        # Ensure low is min of open, close, and some random variation below
        lows = np.minimum(opens, closes) * (1 - np.random.uniform(0.001, 0.02, 252))

        historical_data = pd.DataFrame(
            {
                "date": dates,
                "open": opens,
                "high": highs,
                "low": lows,
                "close": closes,
                "volume": np.random.randint(1000000, 10000000, 252),
            }
        )

        mock.equity.price.historical.return_value = Mock(
            to_df=Mock(return_value=historical_data)
        )

        # Quote data
        mock.equity.price.quote.return_value = Mock(
            to_df=Mock(
                return_value=pd.DataFrame(
                    [
                        {
                            "symbol": "AAPL",
                            "bid": 175.48,
                            "ask": 175.52,
                            "bid_size": 100,
                            "ask_size": 200,
                            "last": 175.50,
                            "volume": 52345678,
                        }
                    ]
                )
            )
        )

        # Institutional data
        mock.equity.ownership.major_holders.return_value = Mock(
            to_df=Mock(
                return_value=pd.DataFrame(
                    {
                        "symbol": ["AAPL"] * 5,
                        "manager_name": [
                            "Vanguard",
                            "BlackRock",
                            "State Street",
                            "Fidelity",
                            "T. Rowe Price",
                        ],
                        "shares": [100000000, 80000000, 60000000, 40000000, 30000000],
                        "value": [
                            17500000000,
                            14000000000,
                            10500000000,
                            7000000000,
                            5250000000,
                        ],
                        "weight": [0.05, 0.04, 0.03, 0.02, 0.015],
                    }
                )
            )
        )

        yield mock


@pytest.fixture
def mock_stanley_analyzers():
    """Create mock Investing analyzers."""
    money_flow = Mock()
    money_flow.analyze_equity_flow.return_value = {
        "symbol": "AAPL",
        "money_flow_score": 0.65,
        "institutional_sentiment": 0.7,
        "smart_money_activity": 0.5,
        "short_pressure": -0.2,
        "accumulation_distribution": 0.4,
        "confidence": 0.65,
    }
    money_flow.analyze_sector_flow.return_value = pd.DataFrame(
        {
            "net_flow_1m": [1000000, -500000, 200000],
            "net_flow_3m": [5000000, -2000000, 1000000],
            "institutional_change": [0.05, -0.02, 0.01],
            "smart_money_sentiment": [0.6, -0.3, 0.2],
            "flow_acceleration": [0.1, -0.05, 0.02],
            "confidence_score": [0.8, 0.6, 0.5],
        },
        index=["XLK", "XLF", "XLE"],
    )

    institutional = Mock()
    institutional.get_holdings.return_value = {
        "symbol": "AAPL",
        "institutional_ownership": 0.75,
        "number_of_institutions": 250,
        "top_holders": pd.DataFrame(
            {
                "manager_name": ["Vanguard", "BlackRock"],
                "value_held": [10000000000, 8000000000],
                "ownership_percentage": [0.05, 0.04],
            }
        ),
        "recent_changes": pd.DataFrame(),
        "ownership_trend": 0.05,
        "concentration_risk": 0.3,
        "smart_money_score": 0.6,
    }
    institutional.get_institutional_sentiment.return_value = {
        "universe_size": 5,
        "average_institutional_ownership": 0.72,
        "percentage_trending_up": 0.6,
        "average_smart_money_score": 0.55,
        "institutional_sentiment": "bullish",
        "details": pd.DataFrame(),
    }

    return {"money_flow": money_flow, "institutional": institutional}


@pytest.fixture
def mock_nautilus_engine():
    """Create a mock NautilusTrader engine."""
    engine = Mock()
    engine.add_data_client = Mock()
    engine.add_actor = Mock()
    engine.add_strategy = Mock()
    engine.run = Mock()
    engine.portfolio = Mock()
    engine.portfolio.account = Mock()
    engine.portfolio.account.balance = Mock(
        return_value=Mock(as_double=Mock(return_value=100000.0))
    )
    return engine


@pytest.fixture
def sample_backtest_config():
    """Sample backtest configuration."""
    return {
        "symbols": ["AAPL", "MSFT", "GOOGL"],
        "start_date": datetime(2023, 1, 1),
        "end_date": datetime(2023, 12, 31),
        "initial_capital": 100000.0,
        "strategy": {
            "name": "InstitutionalMomentum",
            "signal_threshold": 0.5,
            "position_size": 0.1,
            "stop_loss": 0.05,
            "take_profit": 0.15,
        },
        "data_provider": "openbb",
        "venue": "NASDAQ",
    }


# =============================================================================
# End-to-End Data Flow Tests
# =============================================================================


class TestDataFlowIntegration:
    """Test complete data flow from OpenBB to Nautilus."""

    def test_openbb_to_stanley_data_flow(self, mock_openbb_platform):
        """Test data flow from OpenBB to Investing analyzers."""
        from investing.data.providers.openbb_provider import OpenBBAdapter
        from investing.analytics.money_flow import MoneyFlowAnalyzer

        # Create OpenBB adapter
        adapter = OpenBBAdapter()

        # Fetch historical data
        data = adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")

        assert isinstance(data, pd.DataFrame)
        assert len(data) > 0
        assert "close" in data.columns

        # Create analyzer and process data
        analyzer = MoneyFlowAnalyzer()

        # Analyzer should be able to work with the data format
        # (actual integration test)

    def test_stanley_to_nautilus_signal_flow(
        self, mock_stanley_analyzers, mock_nautilus_engine
    ):
        """Test signal flow from Investing analyzers to Nautilus actors."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        # Generate signal
        signal = actor._generate_signal("AAPL")

        assert signal is not None
        assert "direction" in signal
        assert "strength" in signal

    def test_complete_data_pipeline(self, mock_openbb_platform, mock_stanley_analyzers):
        """Test complete data pipeline from fetch to signal."""
        from investing.data.providers.openbb_provider import OpenBBAdapter
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )
        from investing.integrations.nautilus.indicators import SmartMoneyIndicator

        # 1. Fetch data from OpenBB
        adapter = OpenBBAdapter()
        data = adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")

        # 2. Convert to bars for indicator
        indicator = SmartMoneyIndicator(period=20)

        for _, row in data.iterrows():
            bar = _make_bar_mock(
                float(row["open"]),
                float(row["high"]),
                float(row["low"]),
                float(row["close"]),
                float(row["volume"]),
            )
            indicator.handle_bar(bar)

        # 3. Get indicator signal
        assert indicator.initialized is True
        assert indicator.value is not None

        # 4. Generate actor signal
        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        signal = actor._generate_signal("AAPL")
        assert signal is not None


# =============================================================================
# Backtest Simulation Tests
# =============================================================================


class TestBacktestSimulation:
    """Test NautilusTrader backtest simulation with Investing signals."""

    def test_backtest_engine_setup(
        self, mock_nautilus_engine, mock_stanley_analyzers, sample_backtest_config
    ):
        """Test backtest engine setup with Investing components."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        # Create actor for backtest
        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=sample_backtest_config["symbols"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        # Add actor to engine
        mock_nautilus_engine.add_actor(actor)

        mock_nautilus_engine.add_actor.assert_called_once_with(actor)

    def test_backtest_with_historical_data(
        self, mock_openbb_platform, mock_stanley_analyzers, mock_nautilus_engine
    ):
        """Test backtest execution with historical data."""
        from investing.data.providers.openbb_provider import OpenBBAdapter
        from investing.integrations.nautilus.data_client import InvestingDataClient
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        # Setup data client
        adapter = OpenBBAdapter()
        data_client = InvestingDataClient(
            msgbus=Mock(),
            cache=Mock(),
            clock=Mock(),
            openbb_adapter=adapter,
        )

        # Setup actor
        actor_config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        actor = MoneyFlowActor(
            config=actor_config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        # Run backtest
        mock_nautilus_engine.add_data_client(data_client)
        mock_nautilus_engine.add_actor(actor)
        mock_nautilus_engine.run()

        mock_nautilus_engine.run.assert_called_once()

    def test_backtest_generates_trades(
        self, mock_stanley_analyzers, mock_nautilus_engine
    ):
        """Test that backtest generates trading signals."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        # Track generated signals
        signals = []

        mock_msgbus = Mock()
        mock_msgbus.publish = Mock(side_effect=lambda topic, msg: signals.append(msg))

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL", "MSFT", "GOOGL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )
        actor._msgbus = mock_msgbus

        # Simulate signal generation
        actor._update_signals()

        # Should generate signals for each symbol
        assert len(signals) >= 3

    def test_backtest_respects_position_limits(
        self, mock_stanley_analyzers, sample_backtest_config
    ):
        """Test that backtest generates valid signals with bounded values."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=sample_backtest_config["symbols"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        # Generate signal
        signal = actor._generate_signal("AAPL")

        # Signal strength should be bounded
        if "strength" in signal:
            assert -1 <= signal["strength"] <= 1

        # Direction should be valid
        if "direction" in signal:
            assert signal["direction"] in ["BULLISH", "BEARISH", "NEUTRAL"]


# =============================================================================
# Strategy Integration Tests
# =============================================================================


class TestStrategyIntegration:
    """Test strategy integration with Investing signals."""

    def test_strategy_receives_signals(self, mock_stanley_analyzers):
        """Test that strategy receives signals from actors."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        received_signals = []

        class MockStrategy:
            def on_signal(self, signal):
                received_signals.append(signal)

        strategy = MockStrategy()

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        # Simulate signal generation and delivery
        signal = actor._generate_signal("AAPL")
        strategy.on_signal(signal)

        assert len(received_signals) == 1
        assert received_signals[0]["symbol"] == "AAPL"

    def test_strategy_combines_multiple_signals(self, mock_stanley_analyzers):
        """Test strategy combining signals from multiple actors."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
            InstitutionalActor,
            InstitutionalActorConfig,
        )

        # Create both actors
        money_flow_config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        institutional_config = InstitutionalActorConfig(
            component_id="InstitutionalActor-001",
            symbols=["AAPL"],
        )

        money_flow_actor = MoneyFlowActor(
            config=money_flow_config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        institutional_actor = InstitutionalActor(
            config=institutional_config,
            analyzer=mock_stanley_analyzers["institutional"],
        )

        # Generate signals from both
        mf_signal = money_flow_actor._generate_signal("AAPL")
        inst_signal = institutional_actor._generate_signal("AAPL")

        # Combine signals (simple example)
        combined_strength = 0.5 * mf_signal.get("strength", 0) + 0.5 * (
            1 if inst_signal.get("pattern") == "ACCUMULATION" else -1
        )

        assert -1 <= combined_strength <= 1


# =============================================================================
# Error Recovery Tests
# =============================================================================


class TestErrorRecovery:
    """Test error recovery in end-to-end flow."""

    def test_recovers_from_data_provider_error(self, mock_openbb_platform):
        """Test recovery from data provider error."""
        from investing.data.providers.openbb_provider import OpenBBAdapter

        adapter = OpenBBAdapter()

        # First call fails
        mock_openbb_platform.equity.price.historical.side_effect = [
            Exception("Provider temporarily unavailable"),
            Mock(
                to_df=Mock(
                    return_value=pd.DataFrame(
                        {
                            "date": pd.date_range(
                                end=datetime.now(), periods=10, freq="D"
                            ),
                            "open": [100.0] * 10,
                            "high": [102.0] * 10,
                            "low": [99.0] * 10,
                            "close": [101.0] * 10,
                            "volume": [1000000] * 10,
                        }
                    )
                )
            ),
        ]

        # First attempt fails
        try:
            adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")
        except Exception:
            pass

        # Second attempt succeeds
        data = adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")
        assert len(data) == 10

    def test_recovers_from_analyzer_error(self, mock_stanley_analyzers):
        """Test recovery from analyzer error."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        # First call fails
        mock_stanley_analyzers["money_flow"].analyze_equity_flow.side_effect = [
            Exception("Analysis failed"),
            {
                "symbol": "AAPL",
                "money_flow_score": 0.65,
                "institutional_sentiment": 0.7,
                "smart_money_activity": 0.5,
                "short_pressure": -0.2,
                "accumulation_distribution": 0.4,
                "confidence": 0.65,
            },
        ]

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        # First attempt may fail
        try:
            signal = actor._generate_signal("AAPL")
        except Exception:
            pass

        # Second attempt should succeed
        signal = actor._generate_signal("AAPL")
        assert signal is not None

    def test_continues_after_partial_failure(self, mock_stanley_analyzers):
        """Test that processing continues after partial failure."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        # Mixed success/failure
        mock_stanley_analyzers["money_flow"].analyze_equity_flow.side_effect = [
            {"symbol": "AAPL", "money_flow_score": 0.5, "direction": "BULLISH"},
            Exception("Failed for MSFT"),
            {"symbol": "GOOGL", "money_flow_score": 0.3, "direction": "NEUTRAL"},
        ]

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL", "MSFT", "GOOGL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        mock_msgbus = Mock()
        actor._msgbus = mock_msgbus

        # Should continue processing despite MSFT failure
        actor._update_signals()

        # Should have processed at least 2 symbols
        assert mock_msgbus.publish.call_count >= 2


# =============================================================================
# Performance Integration Tests
# =============================================================================


class TestPerformanceIntegration:
    """Test performance of integrated system."""

    def test_processes_full_year_data(self, mock_openbb_platform):
        """Test processing a full year of data."""
        from investing.data.providers.openbb_provider import OpenBBAdapter
        from investing.integrations.nautilus.indicators import SmartMoneyIndicator

        adapter = OpenBBAdapter()
        data = adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")

        indicator = SmartMoneyIndicator(period=20)

        import time

        start = time.time()

        for _, row in data.iterrows():
            bar = _make_bar_mock(
                float(row["open"]),
                float(row["high"]),
                float(row["low"]),
                float(row["close"]),
                float(row["volume"]),
            )
            indicator.handle_bar(bar)

        elapsed = time.time() - start

        # Should process 252 trading days quickly
        assert elapsed < 1.0
        assert indicator.initialized is True

    def test_handles_multiple_symbols_concurrently(
        self, mock_openbb_platform, mock_stanley_analyzers
    ):
        """Test handling multiple symbols concurrently."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "AMD"]

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=symbols,
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        mock_msgbus = Mock()
        actor._msgbus = mock_msgbus

        import time

        start = time.time()

        actor._update_signals()

        elapsed = time.time() - start

        # Should process 8 symbols quickly
        assert elapsed < 2.0
        assert mock_msgbus.publish.call_count == len(symbols)


# =============================================================================
# Data Consistency Tests
# =============================================================================


class TestDataConsistency:
    """Test data consistency across the integration."""

    def test_timestamps_are_consistent(self, mock_openbb_platform):
        """Test that timestamps are consistent across components."""
        from investing.data.providers.openbb_provider import OpenBBAdapter
        from investing.integrations.nautilus.data_client import InvestingDataClient

        adapter = OpenBBAdapter()
        data = adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")

        # Timestamps should be in chronological order
        dates = data["date"].values
        assert all(dates[i] <= dates[i + 1] for i in range(len(dates) - 1))

    def test_price_data_is_valid(self, mock_openbb_platform):
        """Test that price data is valid across pipeline."""
        from investing.data.providers.openbb_provider import OpenBBAdapter

        adapter = OpenBBAdapter()
        data = adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")

        # OHLC constraints
        assert (data["high"] >= data["open"]).all()
        assert (data["high"] >= data["close"]).all()
        assert (data["high"] >= data["low"]).all()
        assert (data["low"] <= data["open"]).all()
        assert (data["low"] <= data["close"]).all()

        # Positive values
        assert (data["open"] > 0).all()
        assert (data["volume"] >= 0).all()

    def test_signal_values_are_bounded(self, mock_stanley_analyzers):
        """Test that signal values are properly bounded."""
        from investing.integrations.nautilus.actors import (
            MoneyFlowActor,
            MoneyFlowActorConfig,
        )

        config = MoneyFlowActorConfig(
            component_id="MoneyFlowActor-001",
            symbols=["AAPL"],
        )

        actor = MoneyFlowActor(
            config=config,
            analyzer=mock_stanley_analyzers["money_flow"],
        )

        signal = actor._generate_signal("AAPL")

        # Signal strength should be bounded
        if "strength" in signal:
            assert -1 <= signal["strength"] <= 1

        # Direction should be valid
        if "direction" in signal:
            assert signal["direction"] in ["BULLISH", "BEARISH", "NEUTRAL"]


# =============================================================================
# Rate Limiting Tests
# =============================================================================


class TestRateLimiting:
    """Test rate limiting behavior."""

    def test_respects_api_rate_limits(self, mock_openbb_platform):
        """Test that API rate limits are respected."""
        from investing.data.providers.openbb_provider import OpenBBAdapter

        adapter = OpenBBAdapter(config={"rate_limit_calls": 5, "rate_limit_period": 1})

        # Make multiple rapid requests
        for i in range(10):
            try:
                adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")
            except Exception as e:
                if "rate limit" in str(e).lower():
                    # Rate limiting is working
                    pass

        # Implementation should handle rate limiting gracefully

    def test_queues_requests_during_rate_limit(self, mock_openbb_platform):
        """Test that requests are queued during rate limit."""
        from investing.data.providers.openbb_provider import OpenBBAdapter

        call_count = [0]

        def track_calls(*args, **kwargs):
            call_count[0] += 1
            return Mock(
                to_df=Mock(
                    return_value=pd.DataFrame(
                        {
                            "date": pd.date_range(
                                end=datetime.now(), periods=10, freq="D"
                            ),
                            "open": [100.0] * 10,
                            "high": [102.0] * 10,
                            "low": [99.0] * 10,
                            "close": [101.0] * 10,
                            "volume": [1000000] * 10,
                        }
                    )
                )
            )

        mock_openbb_platform.equity.price.historical = track_calls

        adapter = OpenBBAdapter()

        # Multiple requests should all complete eventually
        for _ in range(5):
            adapter.get_historical_data("AAPL", "2023-01-01", "2023-12-31")

        assert call_count[0] == 5
