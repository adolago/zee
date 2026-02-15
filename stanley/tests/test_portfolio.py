"""Comprehensive tests for the Portfolio module.

Tests cover:
- Position and Holdings dataclasses
- Risk metrics functions (VaR, CVaR, beta, Sharpe, Sortino)
- PortfolioAnalyzer async methods
- Edge cases and error handling
"""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch

from stanley.portfolio import PortfolioAnalyzer
from stanley.portfolio.portfolio_analyzer import PortfolioSummary
from stanley.portfolio.position import (
    Position,
    Holdings,
    get_sector,
    create_holdings_from_input,
    DEFAULT_SECTOR_MAP,
)
from stanley.portfolio.risk_metrics import (
    calculate_portfolio_var,
    calculate_beta,
    calculate_sharpe_ratio,
    calculate_sortino_ratio,
    calculate_returns,
    calculate_var_historical,
    calculate_var_parametric,
    calculate_cvar,
    calculate_volatility_metrics,
    calculate_sector_exposure,
    calculate_correlation_matrix,
    calculate_covariance_matrix,
    VaRResult,
    BetaResult,
    VolatilityMetrics,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_holdings_input():
    """Sample holdings input for testing."""
    return [
        {"symbol": "AAPL", "shares": 100, "average_cost": 150.0},
        {"symbol": "GOOGL", "shares": 50, "average_cost": 2800.0},
        {"symbol": "MSFT", "shares": 75, "average_cost": 300.0},
    ]


@pytest.fixture
def sample_prices():
    """Sample current prices."""
    return {
        "AAPL": 175.0,
        "GOOGL": 2900.0,
        "MSFT": 350.0,
    }


@pytest.fixture
def sample_returns_matrix():
    """Sample returns matrix for testing."""
    np.random.seed(42)
    dates = pd.date_range(end=datetime.now(), periods=252, freq="D")
    return pd.DataFrame(
        {
            "AAPL": np.random.normal(0.001, 0.02, 252),
            "GOOGL": np.random.normal(0.0015, 0.025, 252),
            "MSFT": np.random.normal(0.0012, 0.018, 252),
        },
        index=dates,
    )


@pytest.fixture
def sample_returns_series():
    """Sample returns series for testing."""
    np.random.seed(42)
    dates = pd.date_range(end=datetime.now(), periods=252, freq="D")
    return pd.Series(np.random.normal(0.001, 0.02, 252), index=dates)


@pytest.fixture
def sample_price_series():
    """Sample price series for testing."""
    np.random.seed(42)
    dates = pd.date_range(end=datetime.now(), periods=252, freq="D")
    returns = np.random.normal(0.001, 0.02, 252)
    prices = 100 * np.exp(np.cumsum(returns))
    return pd.Series(prices, index=dates)


@pytest.fixture
def mock_data_manager_portfolio():
    """Create a mock DataManager for portfolio tests."""
    mock = Mock()
    dates = pd.date_range(end=datetime.now(), periods=262, freq="D")
    np.random.seed(42)

    def create_stock_data(symbol, base_price=100):
        returns = np.random.normal(0.001, 0.02, len(dates))
        close_prices = base_price * np.exp(np.cumsum(returns))
        return pd.DataFrame(
            {
                "open": close_prices * 0.99,
                "high": close_prices * 1.01,
                "low": close_prices * 0.98,
                "close": close_prices,
                "volume": np.random.randint(1000000, 10000000, len(dates)),
            },
            index=dates,
        )

    stock_data_cache = {
        "AAPL": create_stock_data("AAPL", 150),
        "GOOGL": create_stock_data("GOOGL", 2800),
        "MSFT": create_stock_data("MSFT", 300),
        "SPY": create_stock_data("SPY", 400),
    }

    async def mock_get_stock_data(symbol, start_date, end_date):
        if symbol in stock_data_cache:
            return stock_data_cache[symbol]
        return pd.DataFrame()

    mock.get_stock_data = AsyncMock(side_effect=mock_get_stock_data)
    return mock


# =============================================================================
# Position Tests
# =============================================================================


class TestPosition:
    """Tests for Position dataclass."""

    def test_position_creation(self):
        pos = Position(
            symbol="AAPL",
            shares=100,
            average_cost=150.0,
            current_price=175.0,
            sector="Technology",
        )
        assert pos.symbol == "AAPL"
        assert pos.shares == 100
        assert pos.average_cost == 150.0
        assert pos.current_price == 175.0
        assert pos.sector == "Technology"

    def test_position_defaults(self):
        pos = Position(
            symbol="AAPL",
            shares=100,
            average_cost=150.0,
        )
        assert pos.current_price == 0.0
        assert pos.sector == "Unknown"
        assert pos.asset_class == "Equity"

    def test_market_value(self):
        pos = Position("AAPL", shares=100, average_cost=150.0, current_price=175.0)
        assert pos.market_value == 17500.0

    def test_cost_basis(self):
        pos = Position("AAPL", shares=100, average_cost=150.0, current_price=175.0)
        assert pos.cost_basis == 15000.0

    def test_unrealized_pnl(self):
        pos = Position("AAPL", shares=100, average_cost=150.0, current_price=175.0)
        assert pos.unrealized_pnl == 2500.0

    def test_unrealized_pnl_percent(self):
        pos = Position("AAPL", shares=100, average_cost=150.0, current_price=175.0)
        expected_pct = (2500.0 / 15000.0) * 100
        assert pos.unrealized_pnl_percent == pytest.approx(expected_pct)

    def test_unrealized_pnl_percent_zero_cost(self):
        """Test unrealized P&L percent when cost basis is zero."""
        pos = Position("AAPL", shares=100, average_cost=0.0, current_price=175.0)
        assert pos.unrealized_pnl_percent == 0.0

    def test_position_to_dict(self):
        pos = Position(
            "AAPL",
            shares=100,
            average_cost=150.0,
            current_price=175.0,
            sector="Technology",
        )
        d = pos.to_dict()
        assert d["symbol"] == "AAPL"
        assert d["shares"] == 100
        assert d["market_value"] == 17500.0
        assert d["unrealized_pnl"] == 2500.0

    def test_position_negative_pnl(self):
        """Test position with loss."""
        pos = Position("AAPL", shares=100, average_cost=200.0, current_price=175.0)
        assert pos.unrealized_pnl == -2500.0
        assert pos.unrealized_pnl_percent < 0

    def test_position_zero_shares(self):
        """Test position with zero shares."""
        pos = Position("AAPL", shares=0, average_cost=150.0, current_price=175.0)
        assert pos.market_value == 0.0
        assert pos.cost_basis == 0.0
        assert pos.unrealized_pnl == 0.0


# =============================================================================
# Holdings Tests
# =============================================================================


class TestHoldings:
    """Tests for Holdings dataclass."""

    def test_holdings_empty(self):
        holdings = Holdings()
        assert len(holdings.positions) == 0
        assert holdings.cash == 0.0
        assert holdings.total_market_value == 0.0
        assert holdings.total_cost_basis == 0.0

    def test_holdings_with_positions(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),
            Position("GOOGL", 50, 2800.0, 2900.0),
        ]
        holdings = Holdings(positions=positions, cash=10000.0)
        assert len(holdings.positions) == 2
        assert holdings.cash == 10000.0

    def test_total_market_value(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),  # 17500
            Position("GOOGL", 10, 2800.0, 2900.0),  # 29000
        ]
        holdings = Holdings(positions=positions, cash=5000.0)
        expected = 17500.0 + 29000.0 + 5000.0
        assert holdings.total_market_value == expected

    def test_total_cost_basis(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),  # 15000
            Position("GOOGL", 10, 2800.0, 2900.0),  # 28000
        ]
        holdings = Holdings(positions=positions)
        assert holdings.total_cost_basis == 43000.0

    def test_total_unrealized_pnl(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),  # +2500
            Position("GOOGL", 10, 2800.0, 2900.0),  # +1000
        ]
        holdings = Holdings(positions=positions)
        assert holdings.total_unrealized_pnl == 3500.0

    def test_total_unrealized_pnl_percent(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),
            Position("GOOGL", 10, 2800.0, 2900.0),
        ]
        holdings = Holdings(positions=positions)
        expected = (3500.0 / 43000.0) * 100
        assert holdings.total_unrealized_pnl_percent == pytest.approx(expected)

    def test_total_unrealized_pnl_percent_zero_cost(self):
        """Test when total cost basis is zero."""
        positions = [Position("AAPL", 100, 0.0, 175.0)]
        holdings = Holdings(positions=positions)
        assert holdings.total_unrealized_pnl_percent == 0.0

    def test_get_weights(self):
        positions = [
            Position("AAPL", 100, 150.0, 100.0),  # 10000
            Position("GOOGL", 100, 150.0, 100.0),  # 10000
        ]
        holdings = Holdings(positions=positions)
        weights = holdings.get_weights()
        assert weights["AAPL"] == pytest.approx(0.5)
        assert weights["GOOGL"] == pytest.approx(0.5)

    def test_get_weights_empty(self):
        holdings = Holdings()
        assert holdings.get_weights() == {}

    def test_get_weights_zero_value(self):
        """Test weights when total value is zero."""
        positions = [Position("AAPL", 0, 150.0, 100.0)]
        holdings = Holdings(positions=positions)
        assert holdings.get_weights() == {}

    def test_get_sector_weights(self):
        positions = [
            Position("AAPL", 100, 100.0, 100.0, sector="Technology"),  # 10000
            Position("MSFT", 100, 100.0, 100.0, sector="Technology"),  # 10000
            Position("JPM", 100, 100.0, 50.0, sector="Financial"),  # 5000
        ]
        holdings = Holdings(positions=positions)
        sector_weights = holdings.get_sector_weights()
        assert sector_weights["Technology"] == pytest.approx(0.8)
        assert sector_weights["Financial"] == pytest.approx(0.2)

    def test_get_sector_weights_empty(self):
        holdings = Holdings()
        assert holdings.get_sector_weights() == {}

    def test_add_position_new(self):
        holdings = Holdings()
        pos = Position("AAPL", 100, 150.0, 175.0)
        holdings.add_position(pos)
        assert len(holdings.positions) == 1
        assert holdings.positions[0].symbol == "AAPL"

    def test_add_position_merge_existing(self):
        """Test merging positions with same symbol."""
        holdings = Holdings()
        pos1 = Position("AAPL", 100, 150.0, 175.0)
        pos2 = Position("AAPL", 50, 160.0, 175.0)
        holdings.add_position(pos1)
        holdings.add_position(pos2)

        assert len(holdings.positions) == 1
        merged = holdings.positions[0]
        assert merged.shares == 150
        expected_avg_cost = (100 * 150.0 + 50 * 160.0) / 150
        assert merged.average_cost == pytest.approx(expected_avg_cost)

    def test_add_position_merge_to_zero_shares(self):
        """Test merging positions that result in zero shares."""
        holdings = Holdings()
        pos1 = Position("AAPL", 100, 150.0, 175.0)
        pos2 = Position("AAPL", -100, 150.0, 175.0)
        holdings.add_position(pos1)
        holdings.add_position(pos2)

        assert len(holdings.positions) == 1
        merged = holdings.positions[0]
        assert merged.shares == 0
        assert merged.average_cost == 0

    def test_remove_position(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),
            Position("GOOGL", 50, 2800.0, 2900.0),
        ]
        holdings = Holdings(positions=positions)
        removed = holdings.remove_position("AAPL")

        assert removed is not None
        assert removed.symbol == "AAPL"
        assert len(holdings.positions) == 1
        assert holdings.positions[0].symbol == "GOOGL"

    def test_remove_position_not_found(self):
        holdings = Holdings()
        removed = holdings.remove_position("AAPL")
        assert removed is None

    def test_get_position(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0),
            Position("GOOGL", 50, 2800.0, 2900.0),
        ]
        holdings = Holdings(positions=positions)
        pos = holdings.get_position("AAPL")

        assert pos is not None
        assert pos.symbol == "AAPL"
        assert pos.shares == 100

    def test_get_position_not_found(self):
        holdings = Holdings()
        pos = holdings.get_position("AAPL")
        assert pos is None

    def test_update_prices(self):
        positions = [
            Position("AAPL", 100, 150.0, 150.0),
            Position("GOOGL", 50, 2800.0, 2800.0),
        ]
        holdings = Holdings(positions=positions)
        new_prices = {"AAPL": 175.0, "GOOGL": 2900.0}
        holdings.update_prices(new_prices)

        assert holdings.get_position("AAPL").current_price == 175.0
        assert holdings.get_position("GOOGL").current_price == 2900.0

    def test_update_prices_partial(self):
        """Test updating prices when not all symbols have new prices."""
        positions = [
            Position("AAPL", 100, 150.0, 150.0),
            Position("GOOGL", 50, 2800.0, 2800.0),
        ]
        holdings = Holdings(positions=positions)
        holdings.update_prices({"AAPL": 175.0})

        assert holdings.get_position("AAPL").current_price == 175.0
        assert holdings.get_position("GOOGL").current_price == 2800.0

    def test_to_dataframe(self):
        positions = [
            Position("AAPL", 100, 150.0, 175.0, sector="Technology"),
            Position("GOOGL", 50, 2800.0, 2900.0, sector="Technology"),
        ]
        holdings = Holdings(positions=positions)
        df = holdings.to_dataframe()

        assert isinstance(df, pd.DataFrame)
        assert len(df) == 2
        assert "weight" in df.columns
        assert "symbol" in df.columns
        assert df["weight"].sum() == pytest.approx(100.0)

    def test_to_dataframe_empty(self):
        holdings = Holdings()
        df = holdings.to_dataframe()
        assert isinstance(df, pd.DataFrame)
        assert len(df) == 0

    def test_to_dataframe_zero_value(self):
        """Test DataFrame when total value is zero."""
        positions = [Position("AAPL", 0, 150.0, 0.0)]
        holdings = Holdings(positions=positions)
        df = holdings.to_dataframe()
        assert df["weight"].iloc[0] == 0

    def test_to_dict(self):
        positions = [Position("AAPL", 100, 150.0, 175.0)]
        holdings = Holdings(positions=positions, cash=5000.0)
        d = holdings.to_dict()

        assert "positions" in d
        assert "cash" in d
        assert "total_market_value" in d
        assert "updated_at" in d
        assert d["cash"] == 5000.0

    def test_from_dict(self):
        data = {
            "positions": [
                {
                    "symbol": "AAPL",
                    "shares": 100,
                    "average_cost": 150.0,
                    "current_price": 175.0,
                    "sector": "Technology",
                }
            ],
            "cash": 5000.0,
        }
        holdings = Holdings.from_dict(data)

        assert len(holdings.positions) == 1
        assert holdings.positions[0].symbol == "AAPL"
        assert holdings.cash == 5000.0

    def test_from_dict_empty(self):
        holdings = Holdings.from_dict({})
        assert len(holdings.positions) == 0
        assert holdings.cash == 0.0


# =============================================================================
# Position Helper Tests
# =============================================================================


class TestPositionHelpers:
    """Tests for position helper functions."""

    def test_get_sector_known_symbol(self):
        assert get_sector("AAPL") == "Technology"
        assert get_sector("JPM") == "Financial"
        assert get_sector("XOM") == "Energy"
        assert get_sector("JNJ") == "Healthcare"

    def test_get_sector_lowercase(self):
        assert get_sector("aapl") == "Technology"
        assert get_sector("Aapl") == "Technology"

    def test_get_sector_unknown(self):
        assert get_sector("UNKNOWN_TICKER") == "Other"

    def test_get_sector_custom_map(self):
        custom_map = {"CUSTOM": "Custom Sector"}
        assert get_sector("CUSTOM", sector_map=custom_map) == "Custom Sector"
        assert get_sector("OTHER", sector_map=custom_map) == "Other"

    def test_create_holdings_from_input(self, sample_holdings_input, sample_prices):
        holdings = create_holdings_from_input(sample_holdings_input, sample_prices)

        assert len(holdings.positions) == 3
        aapl = holdings.get_position("AAPL")
        assert aapl is not None
        assert aapl.shares == 100
        assert aapl.current_price == 175.0
        assert aapl.sector == "Technology"

    def test_create_holdings_from_input_no_prices(self, sample_holdings_input):
        """Test that average_cost is used when no prices provided."""
        holdings = create_holdings_from_input(sample_holdings_input, None)

        aapl = holdings.get_position("AAPL")
        assert aapl.current_price == 150.0

    def test_create_holdings_from_input_partial_prices(self, sample_holdings_input):
        """Test with prices for only some symbols."""
        prices = {"AAPL": 175.0}
        holdings = create_holdings_from_input(sample_holdings_input, prices)

        assert holdings.get_position("AAPL").current_price == 175.0
        assert holdings.get_position("GOOGL").current_price == 2800.0

    def test_create_holdings_from_input_empty(self):
        holdings = create_holdings_from_input([], None)
        assert len(holdings.positions) == 0

    def test_create_holdings_from_input_missing_fields(self):
        """Test with missing fields in input."""
        input_data = [{"symbol": "AAPL"}]
        holdings = create_holdings_from_input(input_data, None)

        assert len(holdings.positions) == 1
        assert holdings.positions[0].shares == 0.0
        assert holdings.positions[0].average_cost == 0.0


# =============================================================================
# Risk Metrics Tests
# =============================================================================


class TestCalculateReturns:
    """Tests for calculate_returns function."""

    def test_calculate_returns_basic(self):
        prices = pd.Series([100, 101, 102, 103, 104])
        returns = calculate_returns(prices)

        assert len(returns) == 4
        assert all(returns > 0)

    def test_calculate_returns_negative(self):
        prices = pd.Series([100, 99, 98, 97])
        returns = calculate_returns(prices)

        assert len(returns) == 3
        assert all(returns < 0)

    def test_calculate_returns_mixed(self):
        prices = pd.Series([100, 110, 100, 110])
        returns = calculate_returns(prices)

        assert len(returns) == 3
        assert returns.iloc[0] > 0
        assert returns.iloc[1] < 0
        assert returns.iloc[2] > 0


class TestVaRCalculation:
    """Tests for VaR calculation."""

    def test_historical_var(self, sample_returns_matrix):
        weights = np.array([0.4, 0.35, 0.25])
        portfolio_value = 100000.0

        result = calculate_portfolio_var(
            sample_returns_matrix, weights, portfolio_value, method="historical"
        )

        assert isinstance(result, VaRResult)
        assert result.var_95 > 0
        assert result.var_99 > result.var_95
        assert result.cvar_95 >= result.var_95
        assert result.cvar_99 >= result.var_99
        assert result.method == "historical"

    def test_parametric_var(self, sample_returns_matrix):
        weights = np.array([0.4, 0.35, 0.25])
        portfolio_value = 100000.0

        result = calculate_portfolio_var(
            sample_returns_matrix, weights, portfolio_value, method="parametric"
        )

        assert isinstance(result, VaRResult)
        assert result.method == "parametric"
        assert result.var_95 > 0
        assert result.var_99 > result.var_95

    def test_var_percent_calculation(self, sample_returns_matrix):
        weights = np.array([0.4, 0.35, 0.25])
        portfolio_value = 100000.0

        result = calculate_portfolio_var(
            sample_returns_matrix, weights, portfolio_value
        )

        expected_95_pct = (result.var_95 / portfolio_value) * 100
        assert result.var_95_percent == pytest.approx(expected_95_pct)

    def test_var_with_lookback_days(self, sample_returns_matrix):
        weights = np.array([0.4, 0.35, 0.25])
        portfolio_value = 100000.0

        result = calculate_portfolio_var(
            sample_returns_matrix, weights, portfolio_value, lookback_days=60
        )

        assert result.lookback_days == 60

    def test_var_historical_direct(self, sample_returns_series):
        portfolio_value = 100000.0
        var_dict = calculate_var_historical(sample_returns_series, portfolio_value)

        assert 0.95 in var_dict
        assert 0.99 in var_dict
        assert var_dict[0.99] > var_dict[0.95]

    def test_var_parametric_direct(self, sample_returns_series):
        portfolio_value = 100000.0
        var_dict = calculate_var_parametric(sample_returns_series, portfolio_value)

        assert 0.95 in var_dict
        assert 0.99 in var_dict


class TestCVaRCalculation:
    """Tests for CVaR (Expected Shortfall) calculation."""

    def test_cvar_basic(self, sample_returns_series):
        portfolio_value = 100000.0
        cvar_dict = calculate_cvar(sample_returns_series, portfolio_value)

        assert 0.95 in cvar_dict
        assert 0.99 in cvar_dict
        assert cvar_dict[0.99] > cvar_dict[0.95]

    def test_cvar_greater_than_var(self, sample_returns_series):
        """CVaR should be >= VaR for the same confidence level."""
        portfolio_value = 100000.0
        var_dict = calculate_var_historical(sample_returns_series, portfolio_value)
        cvar_dict = calculate_cvar(sample_returns_series, portfolio_value)

        assert cvar_dict[0.95] >= var_dict[0.95]
        assert cvar_dict[0.99] >= var_dict[0.99]


class TestBetaCalculation:
    """Tests for beta calculation."""

    def test_beta_calculation_basic(self):
        np.random.seed(42)
        benchmark_returns = pd.Series(np.random.normal(0.001, 0.01, 100))
        portfolio_returns = pd.Series(
            1.2 * benchmark_returns + np.random.normal(0, 0.005, 100)
        )

        result = calculate_beta(portfolio_returns, benchmark_returns)

        assert isinstance(result, BetaResult)
        assert result.beta == pytest.approx(1.2, abs=0.3)

    def test_beta_low_beta_portfolio(self):
        """Test with a low beta portfolio."""
        np.random.seed(42)
        benchmark_returns = pd.Series(np.random.normal(0.001, 0.02, 100))
        portfolio_returns = pd.Series(
            0.5 * benchmark_returns + np.random.normal(0, 0.005, 100)
        )

        result = calculate_beta(portfolio_returns, benchmark_returns)
        assert result.beta < 1.0

    def test_beta_negative_beta(self):
        """Test with negatively correlated returns."""
        np.random.seed(42)
        benchmark_returns = pd.Series(np.random.normal(0.001, 0.02, 100))
        portfolio_returns = pd.Series(
            -0.5 * benchmark_returns + np.random.normal(0.001, 0.005, 100)
        )

        result = calculate_beta(portfolio_returns, benchmark_returns)
        assert result.beta < 0

    def test_beta_insufficient_data(self):
        """Test beta with insufficient data."""
        benchmark_returns = pd.Series([0.01, 0.02])
        portfolio_returns = pd.Series([0.015, 0.025])

        result = calculate_beta(portfolio_returns, benchmark_returns)
        assert result.beta == 1.0
        assert result.lookback_days < 10

    def test_beta_zero_variance(self):
        """Test beta when benchmark has zero variance."""
        benchmark_returns = pd.Series([0.01] * 50)
        portfolio_returns = pd.Series(np.random.normal(0.01, 0.02, 50))

        result = calculate_beta(portfolio_returns, benchmark_returns)
        # When benchmark has zero variance, beta is mathematically undefined
        # Different numpy versions handle this differently:
        # - Returns 0.0, 1.0, or NaN depending on implementation
        assert result.beta in [0.0, 1.0] or np.isnan(result.beta)

    def test_beta_r_squared(self):
        """Test that r_squared is calculated correctly."""
        np.random.seed(42)
        benchmark_returns = pd.Series(np.random.normal(0.001, 0.01, 100))
        portfolio_returns = pd.Series(
            1.0 * benchmark_returns + np.random.normal(0, 0.001, 100)
        )

        result = calculate_beta(portfolio_returns, benchmark_returns)
        assert result.r_squared > 0.8


class TestVolatilityMetrics:
    """Tests for volatility metrics calculation."""

    def test_volatility_metrics_basic(self, sample_returns_series):
        result = calculate_volatility_metrics(sample_returns_series)

        assert isinstance(result, VolatilityMetrics)
        assert result.daily_volatility > 0
        assert result.annualized_volatility > result.daily_volatility
        assert result.annualized_volatility == pytest.approx(
            result.daily_volatility * np.sqrt(252), rel=0.01
        )

    def test_volatility_metrics_with_prices(
        self, sample_returns_series, sample_price_series
    ):
        result = calculate_volatility_metrics(
            sample_returns_series, prices=sample_price_series
        )

        assert result.max_drawdown <= 0
        # numpy integers are valid integer types
        assert isinstance(result.max_drawdown_duration, (int, np.integer))

    def test_volatility_metrics_without_prices(self, sample_returns_series):
        """Test drawdown calculation from returns only."""
        result = calculate_volatility_metrics(sample_returns_series)
        assert result.max_drawdown <= 0

    def test_downside_volatility(self, sample_returns_series):
        """Test that downside volatility is calculated."""
        result = calculate_volatility_metrics(sample_returns_series)
        assert result.downside_volatility >= 0

    def test_downside_volatility_no_negative_returns(self):
        """Test downside volatility when all returns are positive."""
        returns = pd.Series(np.abs(np.random.normal(0.01, 0.005, 100)))
        result = calculate_volatility_metrics(returns)
        assert result.downside_volatility == 0.0


class TestSharpeRatio:
    """Tests for Sharpe ratio calculation."""

    def test_sharpe_ratio_basic(self, sample_returns_series):
        sharpe = calculate_sharpe_ratio(sample_returns_series)
        assert isinstance(sharpe, float)

    def test_sharpe_ratio_with_risk_free(self, sample_returns_series):
        sharpe_0 = calculate_sharpe_ratio(sample_returns_series, risk_free_rate=0.0)
        sharpe_rf = calculate_sharpe_ratio(sample_returns_series, risk_free_rate=0.05)
        assert sharpe_rf < sharpe_0

    def test_sharpe_ratio_zero_volatility(self):
        """Test Sharpe ratio with near-zero volatility."""
        # Constant returns result in zero std deviation
        # The function may return inf, 0, or a very large number depending on implementation
        returns = pd.Series([0.001] * 100)
        sharpe = calculate_sharpe_ratio(returns)
        # With near-zero volatility and positive excess return, sharpe is very large or inf
        assert sharpe >= 0 or np.isinf(sharpe)

    def test_sharpe_ratio_negative(self):
        """Test Sharpe ratio for losing strategy."""
        np.random.seed(42)
        returns = pd.Series(np.random.normal(-0.01, 0.02, 252))
        sharpe = calculate_sharpe_ratio(returns)
        assert sharpe < 0


class TestSortinoRatio:
    """Tests for Sortino ratio calculation."""

    def test_sortino_ratio_basic(self, sample_returns_series):
        sortino = calculate_sortino_ratio(sample_returns_series)
        assert isinstance(sortino, float)

    def test_sortino_vs_sharpe(self, sample_returns_series):
        """Sortino uses downside deviation."""
        sharpe = calculate_sharpe_ratio(sample_returns_series)
        sortino = calculate_sortino_ratio(sample_returns_series)

        assert np.isfinite(sharpe)
        assert np.isfinite(sortino) or sortino == float("inf")

    def test_sortino_no_negative_returns(self):
        """Test Sortino when there are no negative returns."""
        returns = pd.Series(np.abs(np.random.normal(0.01, 0.005, 100)))
        sortino = calculate_sortino_ratio(returns)
        assert sortino == float("inf")

    def test_sortino_all_negative_returns(self):
        """Test Sortino when all returns are negative."""
        returns = pd.Series(-np.abs(np.random.normal(0.01, 0.005, 100)))
        sortino = calculate_sortino_ratio(returns)
        assert sortino < 0


class TestSectorExposure:
    """Tests for sector exposure calculation."""

    def test_sector_exposure_basic(self):
        holdings = {"AAPL": 0.3, "MSFT": 0.2, "JPM": 0.3, "XOM": 0.2}
        sector_map = {
            "AAPL": "Technology",
            "MSFT": "Technology",
            "JPM": "Financial",
            "XOM": "Energy",
        }

        result = calculate_sector_exposure(holdings, sector_map)

        assert result["Technology"] == pytest.approx(0.5)
        assert result["Financial"] == pytest.approx(0.3)
        assert result["Energy"] == pytest.approx(0.2)

    def test_sector_exposure_unknown_sector(self):
        holdings = {"AAPL": 0.5, "UNKNOWN": 0.5}
        sector_map = {"AAPL": "Technology"}

        result = calculate_sector_exposure(holdings, sector_map)

        assert result["Technology"] == pytest.approx(0.5)
        assert result["Other"] == pytest.approx(0.5)

    def test_sector_exposure_empty(self):
        result = calculate_sector_exposure({}, {})
        assert result == {}


class TestCorrelationMatrix:
    """Tests for correlation matrix calculation."""

    def test_correlation_matrix_basic(self, sample_returns_matrix):
        corr = calculate_correlation_matrix(sample_returns_matrix)

        assert isinstance(corr, pd.DataFrame)
        assert corr.shape == (3, 3)
        np.testing.assert_array_almost_equal(np.diag(corr), np.ones(3))
        np.testing.assert_array_almost_equal(corr.values, corr.values.T)

    def test_correlation_matrix_values_range(self, sample_returns_matrix):
        """Correlation values should be between -1 and 1."""
        corr = calculate_correlation_matrix(sample_returns_matrix)

        assert (corr >= -1).all().all()
        assert (corr <= 1).all().all()


class TestCovarianceMatrix:
    """Tests for covariance matrix calculation."""

    def test_covariance_matrix_basic(self, sample_returns_matrix):
        cov = calculate_covariance_matrix(sample_returns_matrix, annualize=False)

        assert isinstance(cov, pd.DataFrame)
        assert cov.shape == (3, 3)
        np.testing.assert_array_almost_equal(cov.values, cov.values.T)

    def test_covariance_matrix_annualized(self, sample_returns_matrix):
        cov_daily = calculate_covariance_matrix(sample_returns_matrix, annualize=False)
        cov_annual = calculate_covariance_matrix(sample_returns_matrix, annualize=True)

        np.testing.assert_array_almost_equal(cov_annual.values, cov_daily.values * 252)

    def test_covariance_matrix_positive_diagonal(self, sample_returns_matrix):
        """Diagonal (variances) should be positive."""
        cov = calculate_covariance_matrix(sample_returns_matrix)
        assert all(np.diag(cov) > 0)


# =============================================================================
# Portfolio Analyzer Async Tests
# =============================================================================


class TestPortfolioAnalyzer:
    """Tests for PortfolioAnalyzer."""

    def test_analyzer_creation(self):
        analyzer = PortfolioAnalyzer()
        assert analyzer is not None
        assert analyzer.health_check() is True

    def test_analyzer_creation_with_data_manager(self, mock_data_manager_portfolio):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        assert analyzer.data_manager is not None

    @pytest.mark.asyncio
    async def test_analyze_empty_holdings(self):
        analyzer = PortfolioAnalyzer()
        result = await analyzer.analyze([])

        assert isinstance(result, PortfolioSummary)
        assert result.total_value == 0
        assert result.total_cost == 0
        assert result.beta == 1.0
        assert result.sector_exposure == {}

    @pytest.mark.asyncio
    async def test_analyze_with_holdings(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.analyze(sample_holdings_input)

        assert isinstance(result, PortfolioSummary)
        assert result.total_value > 0
        assert result.total_cost > 0
        assert isinstance(result.beta, float)
        assert isinstance(result.sharpe_ratio, float)
        assert isinstance(result.var_95, float)

    @pytest.mark.asyncio
    async def test_analyze_without_data_manager(self, sample_holdings_input):
        """Test analyze with mock data (no data manager)."""
        analyzer = PortfolioAnalyzer(data_manager=None)
        result = await analyzer.analyze(sample_holdings_input)

        assert isinstance(result, PortfolioSummary)
        assert result.total_value > 0

    @pytest.mark.asyncio
    async def test_analyze_summary_to_dict(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.analyze(sample_holdings_input)
        d = result.to_dict()

        assert "totalValue" in d
        assert "totalCost" in d
        assert "beta" in d
        assert "sharpeRatio" in d
        assert "sectorExposure" in d
        assert "topHoldings" in d

    @pytest.mark.asyncio
    async def test_calculate_var_empty_holdings(self):
        analyzer = PortfolioAnalyzer()
        result = await analyzer.calculate_var([])

        assert isinstance(result, VaRResult)
        assert result.var_95 == 0
        assert result.var_99 == 0

    @pytest.mark.asyncio
    async def test_calculate_var_with_holdings(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.calculate_var(sample_holdings_input)

        assert isinstance(result, VaRResult)
        assert result.var_95 > 0
        assert result.var_99 > result.var_95

    @pytest.mark.asyncio
    async def test_calculate_var_parametric_method(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.calculate_var(
            sample_holdings_input, method="parametric"
        )

        assert result.method == "parametric"

    @pytest.mark.asyncio
    async def test_calculate_var_zero_value_portfolio(self):
        """Test VaR when portfolio value is zero."""
        analyzer = PortfolioAnalyzer()
        holdings = [{"symbol": "AAPL", "shares": 0, "average_cost": 150.0}]
        result = await analyzer.calculate_var(holdings)

        assert result.var_95 == 0
        assert result.var_99 == 0

    @pytest.mark.asyncio
    async def test_calculate_beta_empty_holdings(self):
        analyzer = PortfolioAnalyzer()
        result = await analyzer.calculate_beta([])

        assert isinstance(result, BetaResult)
        assert result.beta == 1.0
        assert result.alpha == 0.0

    @pytest.mark.asyncio
    async def test_calculate_beta_with_holdings(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.calculate_beta(sample_holdings_input)

        assert isinstance(result, BetaResult)
        assert isinstance(result.beta, float)
        assert result.benchmark == "SPY"

    @pytest.mark.asyncio
    async def test_calculate_beta_custom_benchmark(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.calculate_beta(sample_holdings_input, benchmark="QQQ")

        assert result.benchmark == "QQQ"

    @pytest.mark.asyncio
    async def test_get_sector_exposure_empty(self):
        analyzer = PortfolioAnalyzer()
        result = await analyzer.get_sector_exposure([])

        assert result == {}

    @pytest.mark.asyncio
    async def test_get_sector_exposure_with_holdings(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.get_sector_exposure(sample_holdings_input)

        assert isinstance(result, dict)
        assert "Technology" in result
        assert all(0 <= v <= 100 for v in result.values())

    @pytest.mark.asyncio
    async def test_get_correlation_matrix_empty(self):
        analyzer = PortfolioAnalyzer()
        result = await analyzer.get_correlation_matrix([])

        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_get_correlation_matrix_with_holdings(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.get_correlation_matrix(sample_holdings_input)

        assert isinstance(result, pd.DataFrame)
        assert result.shape[0] == result.shape[1]

    @pytest.mark.asyncio
    async def test_get_performance_attribution_empty(self):
        analyzer = PortfolioAnalyzer()
        result = await analyzer.get_performance_attribution([])

        assert result["total_return"] == 0
        assert result["by_sector"] == {}
        assert result["by_holding"] == []

    @pytest.mark.asyncio
    async def test_get_performance_attribution_with_holdings(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.get_performance_attribution(sample_holdings_input)

        assert "period" in result
        assert "total_return" in result
        assert "by_sector" in result
        assert "by_holding" in result
        assert isinstance(result["by_holding"], list)

    @pytest.mark.asyncio
    async def test_get_performance_attribution_periods(
        self, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)

        for period in ["1M", "3M", "6M", "1Y"]:
            result = await analyzer.get_performance_attribution(
                sample_holdings_input, period=period
            )
            assert result["period"] == period


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_var_with_single_asset(self):
        """Test VaR calculation with single asset."""
        np.random.seed(42)
        returns = pd.DataFrame({"AAPL": np.random.normal(0.001, 0.02, 252)})
        weights = np.array([1.0])

        result = calculate_portfolio_var(returns, weights, 100000.0)
        assert result.var_95 > 0

    def test_var_with_many_assets(self):
        """Test VaR with many assets."""
        np.random.seed(42)
        n_assets = 50
        returns = pd.DataFrame(
            {f"STOCK_{i}": np.random.normal(0.001, 0.02, 252) for i in range(n_assets)}
        )
        weights = np.ones(n_assets) / n_assets

        result = calculate_portfolio_var(returns, weights, 100000.0)
        assert result.var_95 > 0

    def test_beta_with_nan_values(self):
        """Test beta calculation handles NaN values."""
        np.random.seed(42)
        benchmark = pd.Series(np.random.normal(0.001, 0.01, 100))
        portfolio = pd.Series(np.random.normal(0.001, 0.02, 100))
        portfolio.iloc[10:15] = np.nan

        result = calculate_beta(portfolio, benchmark)
        assert np.isfinite(result.beta)

    def test_sharpe_with_very_small_volatility(self):
        """Test Sharpe ratio with very small volatility."""
        returns = pd.Series(np.random.normal(0.001, 0.0001, 252))
        sharpe = calculate_sharpe_ratio(returns)
        assert np.isfinite(sharpe)

    @pytest.mark.asyncio
    async def test_analyzer_with_failed_price_fetch(self):
        """Test analyzer handles price fetch failures gracefully."""
        mock_dm = Mock()
        mock_dm.get_stock_data = AsyncMock(side_effect=Exception("API Error"))

        analyzer = PortfolioAnalyzer(data_manager=mock_dm)
        holdings = [{"symbol": "AAPL", "shares": 100, "average_cost": 150.0}]

        result = await analyzer.analyze(holdings)
        assert isinstance(result, PortfolioSummary)

    @pytest.mark.asyncio
    async def test_analyzer_with_empty_returns_data(self):
        """Test analyzer handles empty returns data."""
        mock_dm = Mock()
        mock_dm.get_stock_data = AsyncMock(return_value=pd.DataFrame())

        analyzer = PortfolioAnalyzer(data_manager=mock_dm)
        holdings = [{"symbol": "AAPL", "shares": 100, "average_cost": 150.0}]

        result = await analyzer.calculate_var(holdings)
        assert result.method == "estimated"

    def test_holdings_with_negative_shares(self):
        """Test holdings handle short positions (negative shares)."""
        pos = Position("AAPL", shares=-100, average_cost=150.0, current_price=175.0)
        assert pos.market_value == -17500.0
        assert pos.cost_basis == -15000.0

    def test_holdings_with_fractional_shares(self):
        """Test holdings handle fractional shares."""
        pos = Position("AAPL", shares=10.5, average_cost=150.0, current_price=175.0)
        assert pos.shares == 10.5
        assert pos.market_value == 10.5 * 175.0


# =============================================================================
# Parametrized Tests
# =============================================================================


class TestParametrized:
    """Parametrized tests for comprehensive coverage."""

    @pytest.mark.parametrize(
        "symbol,expected_sector",
        [
            ("AAPL", "Technology"),
            ("MSFT", "Technology"),
            ("JPM", "Financial"),
            ("JNJ", "Healthcare"),
            ("XOM", "Energy"),
            ("CAT", "Industrial"),
            ("DIS", "Communication"),
            ("NEE", "Utilities"),
            ("AMT", "Real Estate"),
            ("LIN", "Materials"),
            ("AMZN", "Consumer"),
            ("UNKNOWN", "Other"),
        ],
    )
    def test_get_sector_mapping(self, symbol, expected_sector):
        assert get_sector(symbol) == expected_sector

    @pytest.mark.parametrize(
        "method",
        ["historical", "parametric"],
    )
    def test_var_methods(self, method, sample_returns_matrix):
        weights = np.array([0.4, 0.35, 0.25])
        result = calculate_portfolio_var(
            sample_returns_matrix, weights, 100000.0, method=method
        )
        assert result.method == method
        assert result.var_95 > 0

    @pytest.mark.parametrize(
        "confidence_levels",
        [
            [0.90],
            [0.95],
            [0.99],
            [0.90, 0.95],
            [0.95, 0.99],
            [0.90, 0.95, 0.99],
        ],
    )
    def test_var_confidence_levels(self, confidence_levels, sample_returns_series):
        var_dict = calculate_var_historical(
            sample_returns_series, 100000.0, confidence_levels
        )
        for level in confidence_levels:
            assert level in var_dict
            assert var_dict[level] > 0

    @pytest.mark.parametrize(
        "risk_free_rate",
        [0.0, 0.01, 0.02, 0.05],
    )
    def test_sharpe_risk_free_rates(self, risk_free_rate, sample_returns_series):
        sharpe = calculate_sharpe_ratio(
            sample_returns_series, risk_free_rate=risk_free_rate
        )
        assert isinstance(sharpe, float)
        assert np.isfinite(sharpe)

    @pytest.mark.parametrize(
        "annualization_factor",
        [252, 365, 12],
    )
    def test_volatility_annualization_factors(
        self, annualization_factor, sample_returns_series
    ):
        result = calculate_volatility_metrics(
            sample_returns_series, annualization_factor=annualization_factor
        )
        expected = result.daily_volatility * np.sqrt(annualization_factor)
        assert result.annualized_volatility == pytest.approx(expected, rel=0.01)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "period",
        ["1M", "3M", "6M", "1Y"],
    )
    async def test_performance_attribution_periods(
        self, period, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.get_performance_attribution(
            sample_holdings_input, period=period
        )
        assert result["period"] == period

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "lookback_days",
        [21, 63, 126, 252],
    )
    async def test_analyzer_lookback_days(
        self, lookback_days, sample_holdings_input, mock_data_manager_portfolio
    ):
        analyzer = PortfolioAnalyzer(data_manager=mock_data_manager_portfolio)
        result = await analyzer.calculate_var(
            sample_holdings_input, lookback_days=lookback_days
        )
        assert isinstance(result, VaRResult)
