"""
Shared test fixtures for signals module tests.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock
from dataclasses import dataclass
from typing import Optional

# =============================================================================
# Signal Data Fixtures
# =============================================================================


@pytest.fixture
def sample_dates():
    """Generate sample date range for testing."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=252)  # 1 trading year
    return pd.date_range(start=start_date, end=end_date, freq="B")  # Business days


@pytest.fixture
def sample_price_data(sample_dates):
    """Generate sample price data for backtesting."""
    np.random.seed(42)
    n = len(sample_dates)

    # Generate realistic price series with random walk
    returns = np.random.normal(0.0005, 0.02, n)
    prices = 100 * np.exp(np.cumsum(returns))

    # Generate OHLCV data
    high = prices * (1 + np.abs(np.random.normal(0, 0.01, n)))
    low = prices * (1 - np.abs(np.random.normal(0, 0.01, n)))
    open_prices = low + (high - low) * np.random.random(n)
    volume = np.random.randint(1000000, 10000000, n)

    return pd.DataFrame(
        {
            "date": sample_dates,
            "open": open_prices,
            "high": high,
            "low": low,
            "close": prices,
            "volume": volume,
        }
    )


@pytest.fixture
def sample_multi_symbol_prices(sample_dates):
    """Generate price data for multiple symbols."""
    np.random.seed(42)
    n = len(sample_dates)
    symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "META"]

    price_data = {}
    for i, symbol in enumerate(symbols):
        np.random.seed(42 + i)  # Different seed per symbol
        returns = np.random.normal(0.0005 + i * 0.0001, 0.02 + i * 0.002, n)
        prices = (100 + i * 50) * np.exp(np.cumsum(returns))
        price_data[symbol] = pd.DataFrame(
            {
                "date": sample_dates,
                "close": prices,
                "volume": np.random.randint(1000000, 10000000, n),
            }
        )

    return price_data


@pytest.fixture
def sample_signal():
    """Create a sample signal dictionary."""
    return {
        "symbol": "AAPL",
        "timestamp": datetime.now(),
        "direction": "BULLISH",
        "strength": 0.75,
        "confidence": 0.85,
        "factors": {
            "money_flow": 0.8,
            "institutional": 0.7,
            "momentum": 0.75,
            "value": 0.6,
        },
        "conviction": "HIGH",
        "entry_price": 175.50,
        "target_price": 195.00,
        "stop_loss": 168.00,
    }


@pytest.fixture
def sample_signals_list():
    """Create a list of sample signals for multiple symbols."""
    base_time = datetime.now()
    return [
        {
            "symbol": "AAPL",
            "timestamp": base_time,
            "direction": "BULLISH",
            "strength": 0.75,
            "confidence": 0.85,
            "factors": {"money_flow": 0.8, "institutional": 0.7},
            "conviction": "HIGH",
        },
        {
            "symbol": "MSFT",
            "timestamp": base_time,
            "direction": "BULLISH",
            "strength": 0.65,
            "confidence": 0.75,
            "factors": {"money_flow": 0.6, "institutional": 0.7},
            "conviction": "MEDIUM",
        },
        {
            "symbol": "GOOGL",
            "timestamp": base_time,
            "direction": "BEARISH",
            "strength": -0.55,
            "confidence": 0.70,
            "factors": {"money_flow": -0.5, "institutional": -0.6},
            "conviction": "MEDIUM",
        },
        {
            "symbol": "AMZN",
            "timestamp": base_time,
            "direction": "NEUTRAL",
            "strength": 0.10,
            "confidence": 0.40,
            "factors": {"money_flow": 0.1, "institutional": 0.1},
            "conviction": "LOW",
        },
    ]


@pytest.fixture
def sample_factor_weights():
    """Default factor weights for signal generation."""
    return {
        "money_flow": 0.30,
        "institutional": 0.25,
        "momentum": 0.20,
        "value": 0.15,
        "technical": 0.10,
    }


# =============================================================================
# Mock Data Manager Fixtures
# =============================================================================


@pytest.fixture
def mock_data_manager():
    """Create a mock DataManager for testing."""
    mock = Mock()

    # Mock price data methods
    mock.get_price_history = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(end=datetime.now(), periods=100, freq="B"),
                "close": np.random.normal(100, 10, 100),
                "volume": np.random.randint(1000000, 10000000, 100),
            }
        )
    )

    # Mock money flow methods
    mock.get_money_flow = Mock(
        return_value={
            "money_flow_score": 0.65,
            "institutional_sentiment": 0.7,
            "smart_money_activity": 0.5,
            "confidence": 0.75,
        }
    )

    # Mock institutional methods
    mock.get_institutional_holdings = Mock(
        return_value={
            "institutional_ownership": 0.75,
            "ownership_trend": 0.05,
            "smart_money_score": 0.6,
            "top_holders": [],
        }
    )

    # Mock fundamental data
    mock.get_fundamentals = Mock(
        return_value={
            "pe_ratio": 25.5,
            "forward_pe": 22.0,
            "peg_ratio": 1.5,
            "ev_to_ebitda": 18.0,
        }
    )

    return mock


@pytest.fixture
def mock_money_flow_analyzer():
    """Create a mock MoneyFlowAnalyzer."""
    mock = Mock()
    mock.analyze_equity_flow = Mock(
        return_value={
            "symbol": "AAPL",
            "money_flow_score": 0.65,
            "institutional_sentiment": 0.7,
            "smart_money_activity": 0.5,
            "short_pressure": -0.2,
            "accumulation_distribution": 0.4,
            "confidence": 0.75,
        }
    )
    mock.analyze_sector_flow = Mock(
        return_value=pd.DataFrame(
            {
                "sector": ["XLK", "XLF", "XLE"],
                "net_flow_1m": [1000000, -500000, 200000],
                "confidence_score": [0.8, 0.6, 0.5],
            }
        ).set_index("sector")
    )
    return mock


@pytest.fixture
def mock_institutional_analyzer():
    """Create a mock InstitutionalAnalyzer."""
    mock = Mock()
    mock.get_holdings = Mock(
        return_value={
            "symbol": "AAPL",
            "institutional_ownership": 0.75,
            "ownership_trend": 0.05,
            "concentration_risk": 0.3,
            "smart_money_score": 0.6,
        }
    )
    return mock


# =============================================================================
# Trade Record Fixtures
# =============================================================================


@pytest.fixture
def sample_trade_records():
    """Create sample trade records for performance tracking."""
    base_time = datetime.now() - timedelta(days=30)
    return [
        {
            "trade_id": "trade_001",
            "symbol": "AAPL",
            "entry_time": base_time,
            "exit_time": base_time + timedelta(days=5),
            "direction": "LONG",
            "entry_price": 170.00,
            "exit_price": 180.00,
            "quantity": 100,
            "pnl": 1000.00,
            "pnl_percent": 5.88,
            "signal_strength": 0.75,
            "signal_confidence": 0.85,
        },
        {
            "trade_id": "trade_002",
            "symbol": "MSFT",
            "entry_time": base_time + timedelta(days=2),
            "exit_time": base_time + timedelta(days=8),
            "direction": "LONG",
            "entry_price": 350.00,
            "exit_price": 340.00,
            "quantity": 50,
            "pnl": -500.00,
            "pnl_percent": -2.86,
            "signal_strength": 0.60,
            "signal_confidence": 0.70,
        },
        {
            "trade_id": "trade_003",
            "symbol": "GOOGL",
            "entry_time": base_time + timedelta(days=5),
            "exit_time": base_time + timedelta(days=12),
            "direction": "SHORT",
            "entry_price": 140.00,
            "exit_price": 135.00,
            "quantity": 200,
            "pnl": 1000.00,
            "pnl_percent": 3.57,
            "signal_strength": -0.65,
            "signal_confidence": 0.80,
        },
    ]


@pytest.fixture
def sample_backtest_config():
    """Sample configuration for backtesting."""
    return {
        "initial_capital": 100000.0,
        "max_position_size_pct": 0.10,
        "stop_loss_pct": 0.05,
        "take_profit_pct": 0.15,
        "signal_threshold": 0.4,
        "confidence_threshold": 0.6,
        "slippage_pct": 0.001,
        "commission_per_trade": 1.0,
    }


# =============================================================================
# Empty/Edge Case Fixtures
# =============================================================================


@pytest.fixture
def empty_price_data():
    """Empty price DataFrame for edge case testing."""
    return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])


@pytest.fixture
def single_row_price_data():
    """Single row price data for edge case testing."""
    return pd.DataFrame(
        {
            "date": [datetime.now()],
            "open": [100.0],
            "high": [102.0],
            "low": [99.0],
            "close": [101.0],
            "volume": [5000000],
        }
    )


@pytest.fixture
def nan_price_data(sample_dates):
    """Price data with NaN values for edge case testing."""
    n = len(sample_dates)
    prices = np.random.normal(100, 10, n)
    prices[10:15] = np.nan  # Insert NaN values

    return pd.DataFrame(
        {
            "date": sample_dates,
            "close": prices,
            "volume": np.random.randint(1000000, 10000000, n),
        }
    )
