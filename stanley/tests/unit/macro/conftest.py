"""
Shared test fixtures for macro regime detection tests.

Provides mock data managers, DBnomics adapters, and synthetic data
for testing business cycle, volatility, credit, and recession indicators.
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

# =============================================================================
# Date Range Fixtures
# =============================================================================


@pytest.fixture
def sample_dates():
    """Generate sample date range for testing (100 days)."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=100)
    return pd.date_range(start=start_date, end=end_date, freq="D")


@pytest.fixture
def monthly_dates():
    """Generate monthly date range (5 years)."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365 * 5)
    return pd.date_range(start=start_date, end=end_date, freq="ME")


@pytest.fixture
def quarterly_dates():
    """Generate quarterly date range (10 years)."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365 * 10)
    return pd.date_range(start=start_date, end=end_date, freq="QE")


# =============================================================================
# Mock Data Manager
# =============================================================================


@pytest.fixture
def mock_data_manager():
    """Create a mock DataManager with comprehensive method stubs."""
    dm = Mock()

    # Stock/ETF data
    dm.get_stock_data = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(start="2024-01-01", periods=252),
                "open": np.random.randn(252).cumsum() + 100,
                "high": np.random.randn(252).cumsum() + 102,
                "low": np.random.randn(252).cumsum() + 98,
                "close": np.random.randn(252).cumsum() + 100,
                "volume": np.random.randint(1_000_000, 10_000_000, 252),
                "adj_close": np.random.randn(252).cumsum() + 100,
            }
        )
    )

    # Options data for VIX
    dm.get_options_data = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(start="2024-01-01", periods=252),
                "vix": np.random.uniform(10, 40, 252),
                "vix_3m": np.random.uniform(12, 38, 252),
                "vvix": np.random.uniform(80, 150, 252),
            }
        )
    )

    # Treasury rates
    dm.get_treasury_rates = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(start="2024-01-01", periods=252),
                "3m": np.random.uniform(4.0, 5.5, 252),
                "2y": np.random.uniform(3.5, 5.0, 252),
                "5y": np.random.uniform(3.0, 4.5, 252),
                "10y": np.random.uniform(3.0, 4.5, 252),
                "30y": np.random.uniform(3.5, 5.0, 252),
            }
        )
    )

    # Credit spreads
    dm.get_credit_spreads = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(start="2024-01-01", periods=252),
                "ig_spread": np.random.uniform(80, 200, 252),
                "hy_spread": np.random.uniform(300, 600, 252),
                "bbb_spread": np.random.uniform(120, 280, 252),
            }
        )
    )

    return dm


# =============================================================================
# Mock DBnomics Adapter
# =============================================================================


@pytest.fixture
def mock_dbnomics():
    """Create a mock DBnomicsAdapter with economic data stubs."""
    adapter = Mock()

    # GDP data (quarterly)
    def mock_gdp(country, frequency="Q", real=True):
        periods = 40  # 10 years quarterly
        dates = pd.date_range(end=datetime.now(), periods=periods, freq="QE")
        # Simulate realistic GDP growth pattern
        base = 20000 if country == "USA" else 5000
        trend = np.linspace(base, base * 1.3, periods)
        noise = np.random.normal(0, base * 0.01, periods)
        return pd.DataFrame(
            {
                "period": dates,
                "value": trend + noise,
            }
        )

    adapter.get_gdp = Mock(side_effect=mock_gdp)

    # Inflation data (monthly)
    def mock_inflation(country, measure="CPI"):
        periods = 120  # 10 years monthly
        dates = pd.date_range(end=datetime.now(), periods=periods, freq="ME")
        # CPI index growing over time
        base = 100
        values = base * np.exp(np.linspace(0, 0.3, periods))  # ~3% annual inflation
        return pd.DataFrame(
            {
                "period": dates,
                "value": values,
            }
        )

    adapter.get_inflation = Mock(side_effect=mock_inflation)

    # Unemployment data (monthly)
    def mock_unemployment(country):
        periods = 120
        dates = pd.date_range(end=datetime.now(), periods=periods, freq="ME")
        # Unemployment rate oscillating around 4-6%
        base = 5.0
        cycle = 1.5 * np.sin(np.linspace(0, 4 * np.pi, periods))
        noise = np.random.normal(0, 0.2, periods)
        return pd.DataFrame(
            {
                "period": dates,
                "value": base + cycle + noise,
            }
        )

    adapter.get_unemployment = Mock(side_effect=mock_unemployment)

    # Interest rates
    def mock_interest_rates(country, rate_type="policy"):
        periods = 120
        dates = pd.date_range(end=datetime.now(), periods=periods, freq="ME")
        if rate_type == "policy":
            values = np.linspace(0.25, 5.5, periods)  # Rising rates
        elif rate_type == "short":
            values = np.linspace(0.5, 5.0, periods)
        else:  # long
            values = np.linspace(2.0, 4.5, periods)
        return pd.DataFrame(
            {
                "period": dates,
                "value": values + np.random.normal(0, 0.1, periods),
            }
        )

    adapter.get_interest_rates = Mock(side_effect=mock_interest_rates)

    # Current account
    def mock_current_account(country):
        periods = 40
        dates = pd.date_range(end=datetime.now(), periods=periods, freq="QE")
        return pd.DataFrame(
            {
                "period": dates,
                "value": np.random.uniform(-3, 1, periods),  # % of GDP
            }
        )

    adapter.get_current_account = Mock(side_effect=mock_current_account)

    # Fetch series (generic)
    def mock_fetch_series(
        provider_code, dataset_code, series_code=None, max_results=100
    ):
        periods = 120
        dates = pd.date_range(end=datetime.now(), periods=periods, freq="ME")
        return pd.DataFrame(
            {
                "period": dates,
                "value": np.random.randn(periods).cumsum() + 100,
            }
        )

    adapter.fetch_series = Mock(side_effect=mock_fetch_series)

    # Health check
    adapter.health_check = Mock(return_value=True)

    return adapter


# =============================================================================
# Synthetic Data Generators
# =============================================================================


@pytest.fixture
def vix_data():
    """Generate synthetic VIX data with realistic characteristics."""
    np.random.seed(42)
    periods = 252 * 5  # 5 years of daily data
    dates = pd.date_range(end=datetime.now(), periods=periods, freq="B")

    # VIX characteristics: mean reversion around 20, occasional spikes
    base_level = 20
    mean_reversion = 0.03
    volatility = 3

    vix = np.zeros(periods)
    vix[0] = base_level

    for i in range(1, periods):
        # Mean reversion + random walk + occasional jumps
        reversion = mean_reversion * (base_level - vix[i - 1])
        innovation = volatility * np.random.randn()
        jump = np.random.choice([0, 10, 20], p=[0.98, 0.015, 0.005])
        vix[i] = max(10, vix[i - 1] + reversion + innovation + jump)

    return pd.DataFrame(
        {
            "date": dates,
            "close": vix,
            "vix_3m": vix + np.random.uniform(-2, 5, periods),  # Term structure
            "vix_6m": vix + np.random.uniform(-1, 7, periods),
        }
    )


@pytest.fixture
def credit_spread_data():
    """Generate synthetic credit spread data."""
    np.random.seed(42)
    periods = 252 * 5  # 5 years
    dates = pd.date_range(end=datetime.now(), periods=periods, freq="B")

    # IG spreads: typically 80-200 bps
    ig_base = 120
    ig_vol = 20
    ig_spread = ig_base + np.random.randn(periods).cumsum() * 0.5
    ig_spread = np.clip(ig_spread + np.random.randn(periods) * ig_vol, 60, 400)

    # HY spreads: typically 300-600 bps, correlated with IG but higher vol
    hy_base = 400
    hy_spread = hy_base + (ig_spread - ig_base) * 2 + np.random.randn(periods) * 50
    hy_spread = np.clip(hy_spread, 200, 1500)

    return pd.DataFrame(
        {
            "date": dates,
            "ig_spread": ig_spread,
            "hy_spread": hy_spread,
            "bbb_spread": ig_spread * 1.3 + np.random.randn(periods) * 10,
            "bb_spread": (ig_spread + hy_spread) / 2,
        }
    )


@pytest.fixture
def yield_curve_data():
    """Generate synthetic yield curve data."""
    np.random.seed(42)
    periods = 252 * 10  # 10 years
    dates = pd.date_range(end=datetime.now(), periods=periods, freq="B")

    # Base short rate path (Fed funds proxy)
    short_rate = 2.0 + np.random.randn(periods).cumsum() * 0.01
    short_rate = np.clip(short_rate, 0, 8)

    # Term premium typically 0-2%
    term_premium = 1.0 + np.random.randn(periods).cumsum() * 0.005
    term_premium = np.clip(term_premium, -1, 3)

    return pd.DataFrame(
        {
            "date": dates,
            "3m": short_rate,
            "2y": short_rate + 0.3 + np.random.randn(periods) * 0.1,
            "5y": short_rate + 0.6 + np.random.randn(periods) * 0.15,
            "10y": short_rate + term_premium + np.random.randn(periods) * 0.1,
            "30y": short_rate + term_premium + 0.5 + np.random.randn(periods) * 0.15,
        }
    )


@pytest.fixture
def business_cycle_data():
    """Generate synthetic leading economic indicators data."""
    np.random.seed(42)
    periods = 120  # 10 years monthly
    dates = pd.date_range(end=datetime.now(), periods=periods, freq="ME")

    # Business cycle: expansion/contraction pattern
    cycle_phase = np.sin(np.linspace(0, 3 * np.pi, periods))

    return pd.DataFrame(
        {
            "date": dates,
            "lei": 100
            + cycle_phase * 5
            + np.random.randn(periods) * 0.5,  # Leading Economic Index
            "pmi": 50 + cycle_phase * 8 + np.random.randn(periods) * 2,  # PMI
            "unemployment": 5 - cycle_phase * 2 + np.random.randn(periods) * 0.3,
            "gdp_growth": 2 + cycle_phase * 3 + np.random.randn(periods) * 0.5,
            "inflation": 2.5 + cycle_phase * 1 + np.random.randn(periods) * 0.3,
            "consumer_confidence": 100
            + cycle_phase * 15
            + np.random.randn(periods) * 3,
        }
    )


@pytest.fixture
def recession_dates():
    """NBER recession date ranges for testing."""
    return [
        ("2001-03-01", "2001-11-30"),  # Dot-com recession
        ("2007-12-01", "2009-06-30"),  # Great Recession
        ("2020-02-01", "2020-04-30"),  # COVID recession
    ]


@pytest.fixture
def sahm_rule_trigger_data():
    """Unemployment data that triggers the Sahm Rule (0.5pp rise)."""
    periods = 24  # 2 years monthly
    dates = pd.date_range(end=datetime.now(), periods=periods, freq="ME")

    # Unemployment rises 0.6pp over 3 months (triggers Sahm Rule)
    unemployment = np.array(
        [
            3.5,
            3.5,
            3.5,
            3.6,
            3.6,
            3.5,  # Stable
            3.5,
            3.6,
            3.6,
            3.7,
            3.7,
            3.8,  # Slight increase
            3.8,
            3.9,
            4.0,
            4.1,
            4.2,
            4.3,  # Rising (triggers Sahm)
            4.3,
            4.4,
            4.5,
            4.5,
            4.6,
            4.6,  # Continued rise
        ]
    )

    return pd.DataFrame(
        {
            "date": dates,
            "unemployment_rate": unemployment,
        }
    )


@pytest.fixture
def asset_returns_data():
    """Generate multi-asset return data for cross-asset analysis."""
    np.random.seed(42)
    periods = 252 * 3  # 3 years
    dates = pd.date_range(end=datetime.now(), periods=periods, freq="B")

    # Correlated asset returns
    n_assets = 5
    correlation_matrix = np.array(
        [
            [1.0, 0.6, 0.3, -0.2, 0.1],  # SPY
            [0.6, 1.0, 0.4, -0.15, 0.2],  # EFA (intl developed)
            [0.3, 0.4, 1.0, -0.1, 0.3],  # EEM (emerging)
            [-0.2, -0.15, -0.1, 1.0, 0.4],  # TLT (bonds)
            [0.1, 0.2, 0.3, 0.4, 1.0],  # GLD (gold)
        ]
    )

    # Cholesky decomposition for correlated returns
    L = np.linalg.cholesky(correlation_matrix)
    uncorrelated = np.random.randn(periods, n_assets)
    correlated = uncorrelated @ L.T

    # Scale to realistic volatilities
    vols = np.array([0.16, 0.18, 0.22, 0.12, 0.14]) / np.sqrt(252)
    returns = correlated * vols

    prices = 100 * np.exp(np.cumsum(returns, axis=0))

    return pd.DataFrame(
        {
            "date": dates,
            "SPY": prices[:, 0],
            "EFA": prices[:, 1],
            "EEM": prices[:, 2],
            "TLT": prices[:, 3],
            "GLD": prices[:, 4],
        }
    )


# =============================================================================
# Regime Classification Helpers
# =============================================================================


@pytest.fixture
def expansion_scenario():
    """Economic data representing expansion phase."""
    return {
        "gdp_growth": 3.5,
        "inflation": 2.2,
        "unemployment": 3.8,
        "unemployment_change_3m": -0.2,
        "pmi": 56,
        "lei_mom": 0.3,
        "yield_curve_slope": 1.5,
        "credit_spread": 100,
    }


@pytest.fixture
def recession_scenario():
    """Economic data representing recession phase."""
    return {
        "gdp_growth": -2.0,
        "inflation": 1.5,
        "unemployment": 7.5,
        "unemployment_change_3m": 1.2,
        "pmi": 42,
        "lei_mom": -0.8,
        "yield_curve_slope": -0.5,
        "credit_spread": 600,
    }


@pytest.fixture
def stagflation_scenario():
    """Economic data representing stagflation."""
    return {
        "gdp_growth": -0.5,
        "inflation": 6.5,
        "unemployment": 6.0,
        "unemployment_change_3m": 0.4,
        "pmi": 47,
        "lei_mom": -0.3,
        "yield_curve_slope": 0.2,
        "credit_spread": 400,
    }


@pytest.fixture
def goldilocks_scenario():
    """Economic data representing goldilocks (low inflation, solid growth)."""
    return {
        "gdp_growth": 2.8,
        "inflation": 1.8,
        "unemployment": 4.2,
        "unemployment_change_3m": -0.1,
        "pmi": 54,
        "lei_mom": 0.2,
        "yield_curve_slope": 1.2,
        "credit_spread": 90,
    }


# =============================================================================
# Error Scenario Fixtures
# =============================================================================


@pytest.fixture
def empty_dataframe():
    """Empty DataFrame for edge case testing."""
    return pd.DataFrame()


@pytest.fixture
def missing_data_dataframe():
    """DataFrame with significant missing data."""
    dates = pd.date_range(end=datetime.now(), periods=100, freq="D")
    values = np.random.randn(100)
    values[::3] = np.nan  # Every 3rd value missing
    return pd.DataFrame(
        {
            "date": dates,
            "value": values,
        }
    )


@pytest.fixture
def extreme_values_dataframe():
    """DataFrame with extreme/outlier values."""
    dates = pd.date_range(end=datetime.now(), periods=100, freq="D")
    values = np.random.randn(100)
    values[50] = 1000  # Extreme outlier
    values[75] = -500  # Extreme negative
    return pd.DataFrame(
        {
            "date": dates,
            "value": values,
        }
    )
