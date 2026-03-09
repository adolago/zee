"""
Shared test fixtures for Investing test suite.
"""

import os
import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock, patch


@pytest.fixture(autouse=True)
def disable_rate_limiting():
    """Disable rate limiting for all tests."""
    from investing.api.auth.rate_limit import RateLimiter

    async def mock_check(*args, **kwargs):
        return (True, 999999, int(datetime.now().timestamp() + 60))

    with patch.object(RateLimiter, "check_rate_limit", side_effect=mock_check):
        yield

# Set test mode environment variable for rate limiter bypass
os.environ["ZEE_INVESTING_TEST_MODE"] = "true"


@pytest.fixture
def sample_dates():
    """Generate sample date range for testing."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    return pd.date_range(start=start_date, end=end_date, freq="D")


@pytest.fixture
def sample_flow_data(sample_dates):
    """Generate sample flow data DataFrame."""
    np.random.seed(42)  # For reproducibility
    return pd.DataFrame(
        {
            "date": sample_dates,
            "net_flow": np.random.normal(0, 1000000, len(sample_dates)),
            "creation_units": np.random.randint(0, 100, len(sample_dates)),
            "redemption_units": np.random.randint(0, 100, len(sample_dates)),
        }
    )


@pytest.fixture
def empty_flow_data():
    """Empty flow data DataFrame."""
    return pd.DataFrame(
        columns=["date", "net_flow", "creation_units", "redemption_units"]
    )


@pytest.fixture
def sample_institutional_data():
    """Sample institutional positioning data."""
    return {
        "institutional_ownership": 0.75,
        "net_buyer_count": 50,
        "total_institutions": 200,
        "avg_position_size": 5000000,
    }


@pytest.fixture
def sample_holdings_df():
    """Sample holdings DataFrame."""
    return pd.DataFrame(
        {
            "manager_name": [
                "Vanguard",
                "BlackRock",
                "State Street",
                "Fidelity",
                "T. Rowe Price",
            ],
            "manager_cik": [
                "0000102909",
                "0001390777",
                "0000093751",
                "0000315066",
                "0000080227",
            ],
            "shares_held": [100000000, 80000000, 60000000, 40000000, 30000000],
            "value_held": [10000000000, 8000000000, 6000000000, 4000000000, 3000000000],
            "ownership_percentage": [0.05, 0.04, 0.03, 0.02, 0.015],
        }
    )


@pytest.fixture
def sample_changes_df():
    """Sample institutional changes DataFrame."""
    dates = pd.date_range(end=datetime.now(), periods=5, freq="30D")
    return pd.DataFrame(
        {
            "date": dates,
            "net_institutional_change": [1000000, -500000, 2000000, -100000, 1500000],
            "new_institutions": [5, 2, 8, 1, 6],
            "closed_institutions": [2, 4, 1, 3, 2],
            "total_institutions": [250, 253, 251, 258, 256],
        }
    )


@pytest.fixture
def mock_data_manager():
    """Create a mock DataManager."""
    mock = Mock()
    mock.get_etf_flows = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(end=datetime.now(), periods=10, freq="D"),
                "net_flow": np.random.normal(0, 1000000, 10),
            }
        )
    )
    mock.get_institutional_positioning = Mock(
        return_value={
            "institutional_ownership": 0.75,
            "net_buyer_count": 50,
            "total_institutions": 200,
            "avg_position_size": 5000000,
        }
    )
    mock.get_13f_holdings = Mock()
    mock.get_institutional_changes = Mock()
    return mock


@pytest.fixture
def sample_config():
    """Sample configuration dictionary."""
    return {
        "openbb": {"api_key": "test_key"},
        "sec": {"enabled": True},
        "database": {"postgresql": {"host": "localhost", "port": 5432}},
    }


# =============================================================================
# OPTIONS CHAIN FIXTURES
# =============================================================================


@pytest.fixture
def sample_expiration_dates():
    """Generate sample expiration dates for options testing."""
    today = datetime.now()
    return [
        today + timedelta(days=7),  # Weekly
        today + timedelta(days=14),  # 2 weeks
        today + timedelta(days=30),  # Monthly
        today + timedelta(days=60),  # 2 months
        today + timedelta(days=90),  # Quarterly
    ]


@pytest.fixture
def sample_options_chain(sample_expiration_dates):
    """
    Generate a comprehensive sample options chain DataFrame.

    Contains both calls and puts with various strikes, volumes, and open interest.
    Suitable for testing OptionsAnalyzer and related functionality.
    """
    np.random.seed(42)  # For reproducibility

    underlying_price = 150.0
    strikes = [130, 135, 140, 145, 150, 155, 160, 165, 170]

    data = []
    for exp_date in sample_expiration_dates:
        dte = (exp_date - datetime.now()).days

        for strike in strikes:
            moneyness = strike / underlying_price

            # Call option
            call_iv = 0.25 + 0.1 * abs(moneyness - 1) + np.random.uniform(-0.02, 0.02)
            call_delta = max(0, min(1, 1 - (strike - underlying_price) / 20))
            call_gamma = 0.05 * np.exp(-0.5 * ((strike - underlying_price) / 10) ** 2)
            call_volume = np.random.randint(100, 5000)
            call_oi = np.random.randint(1000, 50000)
            call_bid = max(
                0.01,
                (underlying_price - strike)
                + call_iv * np.sqrt(dte / 365) * underlying_price * 0.1,
            )
            call_ask = call_bid * 1.05

            data.append(
                {
                    "expiration": exp_date,
                    "strike": float(strike),
                    "option_type": "call",
                    "bid": round(call_bid, 2),
                    "ask": round(call_ask, 2),
                    "last_price": round((call_bid + call_ask) / 2, 2),
                    "volume": call_volume,
                    "open_interest": call_oi,
                    "implied_volatility": round(call_iv, 4),
                    "delta": round(call_delta, 4),
                    "gamma": round(call_gamma, 6),
                    "theta": round(-0.05 * call_iv, 4),
                    "vega": round(0.1 * np.sqrt(dte / 365), 4),
                    "underlying_price": underlying_price,
                }
            )

            # Put option
            put_iv = 0.28 + 0.12 * abs(moneyness - 1) + np.random.uniform(-0.02, 0.02)
            put_delta = max(-1, min(0, (strike - underlying_price) / 20 - 1))
            put_gamma = 0.05 * np.exp(-0.5 * ((strike - underlying_price) / 10) ** 2)
            put_volume = np.random.randint(50, 4000)
            put_oi = np.random.randint(500, 40000)
            put_bid = max(
                0.01,
                (strike - underlying_price)
                + put_iv * np.sqrt(dte / 365) * underlying_price * 0.1,
            )
            put_ask = put_bid * 1.05

            data.append(
                {
                    "expiration": exp_date,
                    "strike": float(strike),
                    "option_type": "put",
                    "bid": round(put_bid, 2),
                    "ask": round(put_ask, 2),
                    "last_price": round((put_bid + put_ask) / 2, 2),
                    "volume": put_volume,
                    "open_interest": put_oi,
                    "implied_volatility": round(put_iv, 4),
                    "delta": round(put_delta, 4),
                    "gamma": round(put_gamma, 6),
                    "theta": round(-0.06 * put_iv, 4),
                    "vega": round(0.1 * np.sqrt(dte / 365), 4),
                    "underlying_price": underlying_price,
                }
            )

    return pd.DataFrame(data)


@pytest.fixture
def empty_options_chain():
    """Empty options chain DataFrame with correct schema."""
    return pd.DataFrame(
        columns=[
            "expiration",
            "strike",
            "option_type",
            "bid",
            "ask",
            "last_price",
            "volume",
            "open_interest",
            "implied_volatility",
            "delta",
            "gamma",
            "theta",
            "vega",
            "underlying_price",
        ]
    )


@pytest.fixture
def unusual_activity_options_chain(sample_expiration_dates):
    """
    Options chain with unusual activity patterns.

    Contains options with volume >> open interest (unusual activity indicator).
    """
    exp_date = sample_expiration_dates[0]
    underlying_price = 150.0

    return pd.DataFrame(
        [
            # Normal activity
            {
                "expiration": exp_date,
                "strike": 145.0,
                "option_type": "call",
                "bid": 7.50,
                "ask": 7.75,
                "last_price": 7.625,
                "volume": 500,
                "open_interest": 5000,
                "implied_volatility": 0.28,
                "delta": 0.65,
                "gamma": 0.04,
                "theta": -0.02,
                "vega": 0.15,
                "underlying_price": underlying_price,
            },
            # UNUSUAL: Volume is 10x open interest
            {
                "expiration": exp_date,
                "strike": 160.0,
                "option_type": "call",
                "bid": 2.50,
                "ask": 2.75,
                "last_price": 2.625,
                "volume": 50000,
                "open_interest": 5000,
                "implied_volatility": 0.45,
                "delta": 0.25,
                "gamma": 0.03,
                "theta": -0.03,
                "vega": 0.20,
                "underlying_price": underlying_price,
            },
            # UNUSUAL: Large block trade pattern
            {
                "expiration": exp_date,
                "strike": 140.0,
                "option_type": "put",
                "bid": 3.00,
                "ask": 3.25,
                "last_price": 3.125,
                "volume": 25000,
                "open_interest": 2000,
                "implied_volatility": 0.50,
                "delta": -0.30,
                "gamma": 0.035,
                "theta": -0.025,
                "vega": 0.18,
                "underlying_price": underlying_price,
            },
        ]
    )


@pytest.fixture
def mock_options_data_manager():
    """Create a mock DataManager for options data."""
    mock = Mock()
    mock.get_options_chain = AsyncMock()
    mock.get_historical_options = AsyncMock()
    mock.get_options_flow = AsyncMock()
    return mock


# =============================================================================
# ACCOUNTING QUALITY FIXTURES
# =============================================================================


@pytest.fixture
def healthy_company_data():
    """Financial data for a healthy company with good accounting quality."""
    return {
        "balance_sheet": pd.DataFrame(
            {
                "receivables": [100, 110, 121],  # Growing proportionally with revenue
                "total_assets": [1000, 1100, 1210],
                "current_assets": [500, 550, 605],
                "ppe_net": [300, 320, 342],
                "total_liabilities": [400, 420, 441],
                "current_liabilities": [150, 160, 172],
                "shares_outstanding": [100, 100, 100],  # No dilution
                "retained_earnings": [400, 460, 530],
                "working_capital": [350, 390, 433],
                "market_cap": [2000, 2300, 2600],
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "income_statement": pd.DataFrame(
            {
                "revenue": [1000, 1100, 1210],  # 10% growth
                "cogs": [600, 660, 726],  # Stable margin
                "sga": [200, 215, 230],
                "depreciation": [30, 32, 34],
                "ebit": [170, 193, 220],
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "cash_flow": pd.DataFrame(
            {
                "net_income": [100, 115, 132],
                "operating_cash_flow": [110, 125, 142],  # Slightly higher than NI
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
    }


@pytest.fixture
def manipulator_company_data():
    """Financial data resembling Enron-style manipulation patterns."""
    return {
        "balance_sheet": pd.DataFrame(
            {
                "receivables": [100, 150, 220],  # Growing faster than revenue
                "total_assets": [1000, 1200, 1500],
                "current_assets": [500, 580, 700],
                "ppe_net": [300, 400, 550],  # Aggressive capitalization
                "total_liabilities": [400, 550, 750],  # Increasing leverage
                "current_liabilities": [150, 180, 230],
                "shares_outstanding": [100, 105, 112],  # Dilution
                "retained_earnings": [400, 420, 430],  # Minimal growth
                "working_capital": [350, 400, 470],
                "market_cap": [2000, 1800, 1500],  # Declining market value
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "income_statement": pd.DataFrame(
            {
                "revenue": [1000, 1100, 1150],  # Slowing growth
                "cogs": [600, 680, 750],  # Deteriorating margin
                "sga": [200, 180, 160],  # Suspiciously decreasing
                "depreciation": [30, 28, 26],  # Decreasing despite capex
                "ebit": [170, 212, 214],
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "cash_flow": pd.DataFrame(
            {
                "net_income": [100, 130, 140],
                "operating_cash_flow": [80, 70, 60],  # Red flag: declining OCF
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
    }


@pytest.fixture
def excellent_fundamentals_data():
    """Financial data for Piotroski F-Score 9/9."""
    return {
        "cash_flow": pd.DataFrame(
            {
                "net_income": [80, 100, 120],  # Positive and growing
                "operating_cash_flow": [100, 130, 160],  # Strong and > NI
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "balance_sheet": pd.DataFrame(
            {
                "total_assets": [1000, 1100, 1200],
                "total_liabilities": [500, 450, 400],  # Decreasing leverage
                "current_assets": [400, 500, 600],
                "current_liabilities": [200, 220, 230],  # Improving current ratio
                "shares_outstanding": [100, 100, 100],  # No dilution
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "income_statement": pd.DataFrame(
            {
                "revenue": [1000, 1200, 1500],
                "cogs": [650, 720, 900],  # Improving gross margin
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
    }


@pytest.fixture
def poor_fundamentals_data():
    """Financial data for Piotroski F-Score 0-3/9."""
    return {
        "cash_flow": pd.DataFrame(
            {
                "net_income": [-20, -30, -40],  # Negative and declining
                "operating_cash_flow": [-10, -25, -45],  # Negative
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "balance_sheet": pd.DataFrame(
            {
                "total_assets": [1000, 1100, 1200],
                "total_liabilities": [400, 500, 650],  # Increasing leverage
                "current_assets": [400, 350, 300],
                "current_liabilities": [200, 220, 250],  # Deteriorating current ratio
                "shares_outstanding": [100, 110, 125],  # Dilution
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
        "income_statement": pd.DataFrame(
            {
                "revenue": [1000, 950, 900],  # Declining
                "cogs": [700, 690, 680],  # Worsening margin
            },
            index=["2021-12-31", "2022-12-31", "2023-12-31"],
        ),
    }


@pytest.fixture
def multi_year_financial_data():
    """Multi-year financial data for trend analysis."""
    years = pd.date_range("2018-12-31", periods=6, freq="Y")

    return {
        "balance_sheet": pd.DataFrame(
            {
                "receivables": [80, 90, 100, 110, 125, 145],
                "total_assets": [800, 900, 1000, 1100, 1200, 1300],
                "current_assets": [400, 450, 500, 550, 600, 650],
                "ppe_net": [250, 270, 300, 320, 350, 380],
                "total_liabilities": [350, 370, 400, 420, 450, 480],
                "current_liabilities": [130, 140, 150, 160, 170, 180],
                "shares_outstanding": [100, 100, 100, 105, 105, 110],
                "retained_earnings": [300, 350, 400, 460, 520, 570],
                "working_capital": [270, 310, 350, 390, 430, 470],
                "market_cap": [1500, 1700, 2000, 2300, 2500, 2600],
            },
            index=years,
        ),
        "income_statement": pd.DataFrame(
            {
                "revenue": [800, 900, 1000, 1100, 1200, 1300],
                "cogs": [500, 555, 600, 660, 720, 780],
                "sga": [150, 165, 200, 215, 230, 250],
                "depreciation": [25, 27, 30, 32, 35, 38],
                "ebit": [125, 153, 170, 193, 215, 232],
            },
            index=years,
        ),
        "cash_flow": pd.DataFrame(
            {
                "net_income": [75, 90, 100, 115, 130, 140],
                "operating_cash_flow": [85, 100, 110, 125, 140, 150],
            },
            index=years,
        ),
    }


@pytest.fixture
def mock_financial_data():
    """Create comprehensive mock financial statement data."""
    return {
        "balance_sheet": pd.DataFrame(
            {
                "cash": [100, 120],
                "receivables": [150, 180],
                "inventory": [200, 240],
                "current_assets": [500, 600],
                "ppe_gross": [400, 450],
                "accumulated_depreciation": [100, 130],
                "ppe_net": [300, 320],
                "total_assets": [1000, 1100],
                "current_liabilities": [200, 220],
                "short_term_debt": [50, 60],
                "long_term_debt": [300, 320],
                "total_liabilities": [600, 650],
                "shareholders_equity": [400, 450],
                "retained_earnings": [300, 350],
                "shares_outstanding": [100, 100],
            },
            index=["2022-12-31", "2023-12-31"],
        ),
        "income_statement": pd.DataFrame(
            {
                "revenue": [1000, 1200],
                "cogs": [600, 720],
                "gross_profit": [400, 480],
                "sga": [200, 230],
                "depreciation": [30, 35],
                "operating_income": [170, 215],
                "interest_expense": [20, 22],
                "ebt": [150, 193],
                "tax_expense": [50, 63],
                "net_income": [100, 130],
            },
            index=["2022-12-31", "2023-12-31"],
        ),
        "cash_flow": pd.DataFrame(
            {
                "net_income": [100, 130],
                "depreciation": [30, 35],
                "change_in_receivables": [-10, -30],
                "change_in_inventory": [-20, -40],
                "change_in_payables": [10, 15],
                "operating_cash_flow": [110, 110],
                "capex": [-50, -60],
                "free_cash_flow": [60, 50],
            },
            index=["2022-12-31", "2023-12-31"],
        ),
    }


# =============================================================================
# WHALE TRACKER FIXTURES
# =============================================================================


@pytest.fixture
def sample_whale_holdings():
    """Sample whale holdings DataFrame."""
    return pd.DataFrame(
        {
            "manager_name": [
                "Berkshire Hathaway",
                "Renaissance Technologies",
                "Bridgewater Associates",
                "Two Sigma",
                "Citadel Advisors",
            ],
            "manager_cik": [
                "0001067983",
                "0001037389",
                "0001350694",
                "0001450144",
                "0001423053",
            ],
            "aum": [
                700_000_000_000,
                130_000_000_000,
                150_000_000_000,
                60_000_000_000,
                50_000_000_000,
            ],
            "shares_held": [
                100_000_000,
                50_000_000,
                30_000_000,
                25_000_000,
                20_000_000,
            ],
            "value_held": [
                15_000_000_000,
                7_500_000_000,
                4_500_000_000,
                3_750_000_000,
                3_000_000_000,
            ],
            "ownership_percentage": [0.08, 0.04, 0.024, 0.02, 0.016],
            "quarter_change": [5_000_000, -2_000_000, 3_000_000, 0, 1_000_000],
        }
    )


# =============================================================================
# OPTIONS FLOW FIXTURES (for OptionsFlowAnalyzer)
# =============================================================================


@pytest.fixture
def sample_options_flow_data(sample_dates):
    """Sample options flow DataFrame for OptionsFlowAnalyzer."""
    np.random.seed(42)
    return pd.DataFrame(
        {
            "date": sample_dates,
            "call_volume": np.random.randint(50000, 200000, len(sample_dates)),
            "put_volume": np.random.randint(30000, 150000, len(sample_dates)),
            "call_premium": np.random.uniform(
                10_000_000, 50_000_000, len(sample_dates)
            ),
            "put_premium": np.random.uniform(5_000_000, 30_000_000, len(sample_dates)),
            "call_oi": np.random.randint(100000, 500000, len(sample_dates)),
            "put_oi": np.random.randint(80000, 400000, len(sample_dates)),
        }
    )


# =============================================================================
# SECTOR ROTATION FIXTURES
# =============================================================================


@pytest.fixture
def sample_sector_etfs():
    """List of sector ETF symbols."""
    return [
        "XLK",
        "XLF",
        "XLE",
        "XLV",
        "XLY",
        "XLP",
        "XLI",
        "XLB",
        "XLRE",
        "XLU",
        "XLC",
    ]


@pytest.fixture
def sample_sector_momentum():
    """Sample sector momentum DataFrame."""
    sectors = ["XLK", "XLE", "XLV", "XLF", "XLY", "XLP", "XLI", "XLB"]
    return pd.DataFrame(
        {
            "sector": sectors,
            "momentum_1m": [0.08, -0.05, 0.03, 0.02, 0.06, 0.01, 0.04, -0.02],
            "momentum_3m": [0.15, -0.10, 0.08, 0.05, 0.12, 0.04, 0.09, -0.03],
            "momentum_6m": [0.25, -0.15, 0.12, 0.10, 0.20, 0.08, 0.15, -0.05],
            "relative_strength": [1.2, 0.7, 1.0, 0.9, 1.1, 0.85, 1.05, 0.75],
            "rank": [1, 8, 4, 5, 2, 6, 3, 7],
        }
    )


# =============================================================================
# SMART MONEY INDEX FIXTURES
# =============================================================================


@pytest.fixture
def sample_smi_components(sample_dates):
    """Sample SMI component data."""
    np.random.seed(42)
    return pd.DataFrame(
        {
            "date": sample_dates,
            "institutional_flow": np.random.normal(0, 1_000_000, len(sample_dates)),
            "dark_pool_activity": np.random.uniform(0.15, 0.35, len(sample_dates)),
            "options_sentiment": np.random.uniform(-1, 1, len(sample_dates)),
            "whale_accumulation": np.random.uniform(-1, 1, len(sample_dates)),
            "sector_rotation_signal": np.random.uniform(-1, 1, len(sample_dates)),
        }
    )


@pytest.fixture
def sample_smi_weights():
    """Sample SMI component weights."""
    return {
        "institutional_flow": 0.30,
        "dark_pool_activity": 0.20,
        "options_sentiment": 0.20,
        "whale_accumulation": 0.20,
        "sector_rotation_signal": 0.10,
    }
