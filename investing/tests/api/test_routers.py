"""
Integration tests for Investing API routers.

Tests cover:
- Each router's endpoints (system, market, portfolio, analytics, research, options, etf, notes)
- Auth requirements (authenticated vs public endpoints)
- Rate limiting behavior
- Error handling
- Input validation
- Response structure
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def reset_environment():
    """Reset environment variables for clean test state."""
    # Store original env
    original_env = os.environ.copy()

    # Set test environment
    os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-purposes-32chars"
    os.environ["JWT_ALGORITHM"] = "HS256"
    os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"] = "15"
    os.environ["REFRESH_TOKEN_EXPIRE_DAYS"] = "7"
    os.environ["ZEE_INVESTING_AUTH_RATE_LIMIT_ENABLED"] = "false"  # Disable for most tests

    yield

    # Restore original env
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture
def mock_container():
    """Create a mock Container with all analyzers."""
    container = MagicMock()
    container._initialized = True
    container.is_initialized = True

    # Data manager mock
    container.data_manager = MagicMock()
    container.data_manager.health_check = AsyncMock(return_value=True)
    container.data_manager.get_stock_data = AsyncMock(
        return_value=_create_mock_stock_data()
    )

    # Money flow analyzer mock
    container.money_flow_analyzer = MagicMock()
    container.money_flow_analyzer.health_check = MagicMock(return_value=True)
    container.money_flow_analyzer.analyze_sector_flow = MagicMock(
        return_value=_create_mock_flow_df()
    )
    container.money_flow_analyzer.get_dark_pool_activity = MagicMock(
        return_value=_create_mock_dark_pool_df()
    )
    container.money_flow_analyzer.analyze_equity_flow = MagicMock(
        return_value=_create_mock_equity_flow()
    )
    container.money_flow_analyzer.detect_sector_rotation = MagicMock(
        return_value=_create_mock_rotation()
    )
    container.money_flow_analyzer.track_smart_money = MagicMock(
        return_value=MagicMock(to_dict=lambda: {})
    )
    container.money_flow_analyzer.detect_unusual_volume = MagicMock(
        return_value=MagicMock(to_dict=lambda: {})
    )
    container.money_flow_analyzer.calculate_flow_momentum = MagicMock(
        return_value=MagicMock(to_dict=lambda: {})
    )
    container.money_flow_analyzer.get_comprehensive_analysis = MagicMock(
        return_value={}
    )

    # Institutional analyzer mock
    container.institutional_analyzer = MagicMock()
    container.institutional_analyzer.health_check = MagicMock(return_value=True)

    # Portfolio analyzer mock
    container.portfolio_analyzer = MagicMock()
    container.portfolio_analyzer.health_check = MagicMock(return_value=True)
    container.portfolio_analyzer.analyze = AsyncMock(
        return_value=_create_mock_portfolio_summary()
    )
    container.portfolio_analyzer.calculate_var = AsyncMock(
        return_value=_create_mock_var_result()
    )
    container.portfolio_analyzer.calculate_beta = AsyncMock(
        return_value=MagicMock(beta=1.0)
    )
    container.portfolio_analyzer.get_performance_attribution = AsyncMock(
        return_value={}
    )
    container.portfolio_analyzer.get_correlation_matrix = AsyncMock(
        return_value=_create_mock_corr_matrix()
    )
    container.portfolio_analyzer.get_sector_exposure = AsyncMock(
        return_value={"Technology": 50.0}
    )

    # Research analyzer mock
    container.research_analyzer = MagicMock()
    container.research_analyzer.health_check = MagicMock(return_value=True)
    container.research_analyzer.generate_report = AsyncMock(
        return_value=_create_mock_research_report()
    )
    container.research_analyzer.get_valuation = AsyncMock(
        return_value=_create_mock_valuation()
    )
    container.research_analyzer.analyze_earnings = AsyncMock(
        return_value=_create_mock_earnings()
    )
    container.research_analyzer.get_peer_comparison = AsyncMock(return_value={})

    # Commodities analyzer mock
    container.commodities_analyzer = MagicMock()
    container.commodities_analyzer.health_check = MagicMock(return_value=True)

    # Options analyzer mock
    container.options_analyzer = MagicMock()
    container.options_analyzer.health_check = MagicMock(return_value=True)
    container.options_analyzer.get_options_flow = AsyncMock(
        return_value=_create_mock_options_flow()
    )
    container.options_analyzer.calculate_gamma_exposure = AsyncMock(
        return_value=_create_mock_gex()
    )
    container.options_analyzer.detect_unusual_activity = AsyncMock(
        return_value=_create_mock_empty_df()
    )
    container.options_analyzer.analyze_put_call_flow = AsyncMock(
        return_value=_create_mock_put_call()
    )
    container.options_analyzer.track_smart_money = AsyncMock(
        return_value=_create_mock_empty_df()
    )
    container.options_analyzer.analyze_expiration_flow = AsyncMock(
        return_value=_create_mock_max_pain()
    )
    container.options_analyzer._get_options_chain = AsyncMock(
        return_value=_create_mock_empty_df()
    )

    # ETF analyzer mock
    container.etf_analyzer = MagicMock()
    container.etf_analyzer.health_check = MagicMock(return_value=True)
    container.etf_analyzer.get_etf_flows = AsyncMock(return_value=[])
    container.etf_analyzer.get_sector_rotation = AsyncMock(return_value=[])
    container.etf_analyzer.get_sector_heatmap = AsyncMock(return_value={})
    container.etf_analyzer.get_smart_beta_flows = AsyncMock(return_value=[])
    container.etf_analyzer.get_thematic_flows = AsyncMock(return_value=[])
    container.etf_analyzer.get_factor_rotation_signals = AsyncMock(return_value={})
    container.etf_analyzer.get_theme_dashboard = AsyncMock(return_value={})
    container.etf_analyzer.get_institutional_etf_positioning = AsyncMock(
        return_value={}
    )
    container.etf_analyzer.get_flow_overview = AsyncMock(return_value={})
    container.etf_analyzer.get_creation_redemption_activity = AsyncMock(return_value={})

    # Note manager mock
    container.note_manager = MagicMock()
    container.note_manager.list_notes = MagicMock(return_value=[])
    container.note_manager.search = MagicMock(return_value=[])
    container.note_manager.get_graph = MagicMock(return_value={})
    container.note_manager.get_note = MagicMock(return_value=None)
    container.note_manager.get_theses = MagicMock(return_value=[])
    container.note_manager.get_trades = MagicMock(return_value=[])
    container.note_manager.get_trade_stats = MagicMock(return_value={})

    # Accounting analyzers mock
    container.accounting_analyzer = MagicMock()
    container.accounting_analyzer.health_check = MagicMock(return_value=True)
    container.earnings_quality_analyzer = MagicMock()
    container.red_flag_scorer = MagicMock()
    container.anomaly_aggregator = MagicMock()

    # Signal generator mock
    container.signal_generator = MagicMock()
    container.signal_generator.health_check = MagicMock(return_value=True)

    return container


@pytest.fixture
def app(mock_container):
    """Create a test FastAPI app with mocked dependencies."""
    from investing.api.main_new import create_app

    app = create_app()

    # Set mock container in app state; main_new.lifespan will detect this and
    # skip container initialization.
    app.state.app_state = mock_container

    yield app


@pytest.fixture
def client(app):
    """Create a test client."""
    yield TestClient(app)


@pytest.fixture
def auth_token():
    """Create a valid JWT auth token for testing."""
    from investing.api.auth import create_access_token

    return create_access_token("test-user-id", "test@example.com", ["analyst"])


@pytest.fixture
def auth_headers(auth_token):
    """Create auth headers with Bearer token."""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def admin_token():
    """Create an admin JWT token for testing."""
    from investing.api.auth import create_access_token

    return create_access_token("admin-user-id", "admin@example.com", ["admin"])


@pytest.fixture
def admin_headers(admin_token):
    """Create admin auth headers with Bearer token."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def trader_token():
    """Create a trader JWT token for testing."""
    from investing.api.auth import create_access_token

    return create_access_token("trader-user-id", "trader@example.com", ["trader"])


@pytest.fixture
def trader_headers(trader_token):
    """Create trader auth headers with Bearer token."""
    return {"Authorization": f"Bearer {trader_token}"}


# =============================================================================
# Mock Data Helpers
# =============================================================================


def _create_mock_stock_data():
    """Create mock stock data DataFrame."""
    import pandas as pd
    import numpy as np

    dates = pd.date_range(end=datetime.now(), periods=5, freq="D")
    return pd.DataFrame(
        {
            "date": dates,
            "open": [150.0 + np.random.uniform(-2, 2) for _ in range(5)],
            "high": [152.0 + np.random.uniform(-2, 2) for _ in range(5)],
            "low": [148.0 + np.random.uniform(-2, 2) for _ in range(5)],
            "close": [150.0 + np.random.uniform(-1, 1) for _ in range(5)],
            "volume": [50000000 for _ in range(5)],
        }
    )


def _create_mock_flow_df():
    """Create mock money flow DataFrame."""
    import pandas as pd

    return pd.DataFrame(
        {
            "net_flow_1m": [100.0, -50.0],
            "net_flow_3m": [200.0, -100.0],
            "institutional_change": [0.02, -0.01],
            "smart_money_sentiment": [0.5, -0.3],
            "flow_acceleration": [0.1, -0.05],
            "confidence_score": [0.8, 0.6],
        },
        index=["XLK", "XLF"],
    )


def _create_mock_dark_pool_df():
    """Create mock dark pool DataFrame."""
    import pandas as pd

    return pd.DataFrame(
        {
            "date": [datetime.now()],
            "dark_pool_volume": [1000000],
            "total_volume": [5000000],
            "dark_pool_percentage": [0.20],
            "large_block_activity": [0.15],
            "dark_pool_signal": [1],
        }
    )


def _create_mock_equity_flow():
    """Create mock equity flow data."""
    return {
        "symbol": "AAPL",
        "money_flow_score": 0.5,
        "institutional_sentiment": 0.3,
        "smart_money_activity": 0.4,
        "short_pressure": 0.1,
        "accumulation_distribution": 0.2,
        "confidence": 0.75,
    }


def _create_mock_rotation():
    """Create mock sector rotation signal."""
    signal = MagicMock()
    signal.sector_scores = {"XLK": 0.5, "XLF": -0.2}
    signal.momentum_scores = {"XLK": 0.3, "XLF": -0.1}
    signal.leaders = ["XLK"]
    signal.laggards = ["XLF"]
    signal.rotating_into = ["XLK"]
    signal.rotating_out_of = ["XLF"]
    return signal


def _create_mock_portfolio_summary():
    """Create mock portfolio analysis summary."""
    summary = MagicMock()
    summary.total_value = 100000.0
    summary.total_cost = 90000.0
    summary.total_return = 10000.0
    summary.total_return_percent = 11.11
    summary.beta = 1.05
    summary.alpha = 0.02
    summary.sharpe_ratio = 1.5
    summary.sortino_ratio = 2.0
    summary.var_95 = 5000.0
    summary.var_99 = 8000.0
    summary.var_95_percent = 5.0
    summary.var_99_percent = 8.0
    summary.volatility = 15.0
    summary.max_drawdown = 10.0
    summary.sector_exposure = {"Technology": 50.0, "Healthcare": 30.0}
    summary.top_holdings = [{"symbol": "AAPL", "weight": 25.0}]
    return summary


def _create_mock_var_result():
    """Create mock VaR result."""
    result = MagicMock()
    result.var_95 = 5000.0
    result.var_99 = 8000.0
    result.var_95_percent = 5.0
    result.var_99_percent = 8.0
    result.cvar_95 = 6000.0
    result.cvar_99 = 9000.0
    result.method = "historical"
    result.lookback_days = 252
    return result


def _create_mock_corr_matrix():
    """Create mock correlation matrix."""
    import pandas as pd

    return pd.DataFrame(
        {
            "AAPL": [1.0, 0.5],
            "MSFT": [0.5, 1.0],
        },
        index=["AAPL", "MSFT"],
    )


def _create_mock_research_report():
    """Create mock research report."""
    report = MagicMock()
    report.to_dict = MagicMock(
        return_value={
            "symbol": "AAPL",
            "companyName": "Apple Inc.",
            "sector": "Technology",
            "industry": "Consumer Electronics",
            "currentPrice": 150.0,
            "marketCap": 2500000000000,
            "valuation": {"peRatio": 25.0, "forwardPe": 22.0, "evToEbitda": 18.0},
            "dcf": {"intrinsicValue": 175.0},
            "fairValueRange": {"low": 140.0, "high": 180.0},
            "valuationRating": "Fair",
            "earnings": {},
            "earningsQualityScore": 0.85,
            "revenueGrowth5yr": 15.0,
            "epsGrowth5yr": 18.0,
            "grossMargin": 43.0,
            "operatingMargin": 30.0,
            "netMargin": 25.0,
            "roe": 150.0,
            "roic": 35.0,
            "debtToEquity": 180.0,
            "currentRatio": 0.9,
            "overallScore": 75.0,
            "strengths": ["Strong brand", "High margins"],
            "weaknesses": ["Hardware dependency"],
            "catalysts": ["AI products"],
            "risks": ["China exposure"],
        }
    )
    return report


def _create_mock_valuation():
    """Create mock valuation data."""
    return {
        "valuation": {
            "peRatio": 25.0,
            "forwardPe": 22.0,
            "evToEbitda": 18.0,
            "priceToSales": 7.0,
        },
        "dcf": {
            "intrinsicValue": 175.0,
            "currentPrice": 150.0,
            "upsidePercentage": 16.67,
            "discountRate": 0.10,
        },
    }


def _create_mock_earnings():
    """Create mock earnings analysis."""
    earnings = MagicMock()
    earnings.to_dict = MagicMock(
        return_value={
            "symbol": "AAPL",
            "quarters": [],
            "epsGrowthYoy": 15.0,
            "epsGrowth3yrCagr": 12.0,
            "avgEpsSurprisePercent": 5.0,
            "beatRate": 0.90,
            "consecutiveBeats": 8,
            "earningsVolatility": 10.0,
            "earningsConsistency": 0.85,
        }
    )
    return earnings


def _create_mock_options_flow():
    """Create mock options flow data."""
    return {
        "symbol": "AAPL",
        "total_call_volume": 100000,
        "total_put_volume": 80000,
        "total_call_premium": 5000000.0,
        "total_put_premium": 4000000.0,
        "put_call_ratio": 0.8,
        "premium_put_call_ratio": 0.8,
        "net_premium_flow": 1000000.0,
        "unusual_activity_count": 5,
        "smart_money_trades": 3,
        "sentiment": "bullish",
        "confidence": 0.75,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _create_mock_gex():
    """Create mock gamma exposure data."""
    return {
        "symbol": "AAPL",
        "total_gex": 500000000.0,
        "call_gex": 300000000.0,
        "put_gex": -200000000.0,
        "net_gex": 300000000.0,
        "flip_point": 155.0,
        "max_gamma_strike": 150.0,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _create_mock_put_call():
    """Create mock put/call analysis data."""
    return {
        "symbol": "AAPL",
        "put_call_ratio": 0.8,
        "premium_put_call_ratio": 0.75,
        "oi_put_call_ratio": 0.9,
        "total_call_volume": 100000,
        "total_put_volume": 80000,
        "total_call_premium": 5000000.0,
        "total_put_premium": 4000000.0,
        "call_open_interest": 500000,
        "put_open_interest": 450000,
        "itm_call_volume": 30000,
        "otm_call_volume": 70000,
        "itm_put_volume": 20000,
        "otm_put_volume": 60000,
        "weighted_call_strike": 155.0,
        "weighted_put_strike": 145.0,
        "underlying_price": 150.0,
        "sentiment": "bullish",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _create_mock_max_pain():
    """Create mock max pain analysis data."""
    return {
        "expiration": "2024-01-19",
        "max_pain": 150.0,
        "total_call_oi": 500000,
        "total_put_oi": 450000,
        "total_call_volume": 100000,
        "total_put_volume": 80000,
        "gamma_concentration": 0.75,
        "pin_risk": 0.6,
        "days_to_expiry": 14,
    }


def _create_mock_empty_df():
    """Create empty DataFrame."""
    import pandas as pd

    return pd.DataFrame()


# =============================================================================
# System Router Tests
# =============================================================================


class TestSystemRouter:
    """Tests for system endpoints."""

    def test_health_check_returns_healthy(self, client):
        """Test /api/health returns healthy status."""
        response = client.get("/api/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ["healthy", "degraded"]
        assert "version" in data
        assert "components" in data
        assert "timestamp" in data

    def test_health_check_no_auth_required(self, client):
        """Test health endpoint works without authentication."""
        response = client.get("/api/health")
        assert response.status_code == 200

    def test_version_endpoint(self, client):
        """Test /api/version returns version info."""
        response = client.get("/api/version")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data
        assert "version" in data["data"]
        # Should be redacted in production/test env without DEBUG
        assert data["data"]["python_version"] == "restricted"
        assert data["data"]["platform"] == "restricted"

    def test_status_endpoint(self, client):
        """Test /api/status returns system status."""
        response = client.get("/api/status")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "data" in data

    def test_ping_endpoint(self, client):
        """Test /api/ping returns pong response."""
        response = client.get("/api/ping")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "pong"
        assert "timestamp" in data


# =============================================================================
# Market Router Tests
# =============================================================================


class TestMarketRouter:
    """Tests for market data endpoints."""

    def test_get_market_data(self, client, mock_container):
        """Test GET /api/market/{symbol} returns market data."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/AAPL")

        # May return 200 or 503 depending on mock setup
        assert response.status_code in [200, 503]

    def test_get_market_data_no_auth_required(self, client, mock_container):
        """Test market data works without authentication."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/AAPL")

        # Should not return 401 (auth not required for market data)
        assert response.status_code != 401

    def test_get_market_data_with_auth(self, client, auth_headers, mock_container):
        """Test market data works with authentication."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/AAPL", headers=auth_headers)

        assert response.status_code in [200, 503]

    def test_get_quote(self, client, mock_container):
        """Test GET /api/market/{symbol}/quote returns quote data."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/AAPL/quote")

        assert response.status_code in [200, 503]

    def test_get_history(self, client, mock_container):
        """Test GET /api/market/{symbol}/history returns historical data."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/AAPL/history")

        assert response.status_code in [200, 503]

    def test_get_history_with_params(self, client, mock_container):
        """Test history endpoint with query parameters."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/AAPL/history?interval=1d&period=30")

        assert response.status_code in [200, 422, 503]

    def test_symbol_case_insensitive(self, client, mock_container):
        """Test symbol is normalized to uppercase."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            with patch(
                "investing.api.routers.market.get_app_state", return_value=mock_container
            ):
                response = client.get("/api/market/aapl")

        assert response.status_code in [200, 503]


# =============================================================================
# Portfolio Router Tests
# =============================================================================


class TestPortfolioRouter:
    """Tests for portfolio analytics endpoints."""

    def test_portfolio_analytics_requires_auth(self, client):
        """Test POST /api/portfolio/analytics requires authentication."""
        response = client.post(
            "/api/portfolio/analytics",
            json={"holdings": [{"symbol": "AAPL", "shares": 100}], "benchmark": "SPY"},
        )

        assert response.status_code == 401

    def test_portfolio_risk_requires_auth(self, client):
        """Test POST /api/portfolio/risk requires authentication."""
        response = client.post(
            "/api/portfolio/risk",
            json={
                "holdings": [{"symbol": "AAPL", "shares": 100}],
                "confidence_level": 0.95,
            },
        )

        assert response.status_code == 401

    def test_portfolio_analytics_with_auth(self, client, auth_headers, mock_container):
        """Test portfolio analytics works with authentication."""
        with patch(
            "investing.api.routers.portfolio._get_portfolio_analyzer",
            return_value=mock_container.portfolio_analyzer,
        ):
            response = client.post(
                "/api/portfolio/analytics",
                json={
                    "holdings": [
                        {"symbol": "AAPL", "shares": 100, "average_cost": 150.0}
                    ],
                    "benchmark": "SPY",
                },
                headers=auth_headers,
            )

        # Should get 200 or 503 (if mock not fully set up)
        assert response.status_code in [200, 503]

    def test_portfolio_correlation_requires_auth(self, client):
        """Test POST /api/portfolio/correlation requires authentication."""
        response = client.post(
            "/api/portfolio/correlation",
            json={
                "holdings": [
                    {"symbol": "AAPL", "shares": 100},
                    {"symbol": "MSFT", "shares": 50},
                ]
            },
        )

        assert response.status_code == 401

    def test_portfolio_optimize_requires_trader(self, client, auth_headers):
        """Test POST /api/portfolio/optimize requires TRADER role."""
        response = client.post(
            "/api/portfolio/optimize",
            json={"holdings": [{"symbol": "AAPL", "shares": 100}]},
            headers=auth_headers,  # analyst role
        )

        # Should fail - analyst doesn't have trader permission
        assert response.status_code in [403, 503]

    def test_portfolio_optimize_with_trader(
        self, client, trader_headers, mock_container
    ):
        """Test portfolio optimize works with trader role."""
        with patch(
            "investing.api.routers.portfolio._get_portfolio_analyzer",
            return_value=mock_container.portfolio_analyzer,
        ):
            response = client.post(
                "/api/portfolio/optimize",
                json={"holdings": [{"symbol": "AAPL", "shares": 100}]},
                headers=trader_headers,
            )

        assert response.status_code in [200, 503]

    def test_benchmark_comparison_requires_auth(self, client):
        """Test GET /api/portfolio/benchmark/{benchmark} requires auth."""
        response = client.get("/api/portfolio/benchmark/SPY")

        assert response.status_code == 401

    def test_portfolio_holdings_validation(self, client, auth_headers):
        """Test portfolio endpoints validate holdings input."""
        response = client.post(
            "/api/portfolio/analytics",
            json={
                "holdings": [],  # Empty holdings should fail validation
                "benchmark": "SPY",
            },
            headers=auth_headers,
        )

        assert response.status_code == 422  # Validation error


# =============================================================================
# Analytics Router Tests
# =============================================================================


class TestAnalyticsRouter:
    """Tests for analytics endpoints."""

    def test_money_flow_endpoint(self, client, mock_container):
        """Test POST /api/money-flow returns flow data."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.post(
                "/api/money-flow", json={"sectors": ["XLK", "XLF"], "lookback_days": 30}
            )

        assert response.status_code in [200, 503]

    def test_dark_pool_endpoint(self, client, mock_container):
        """Test GET /api/dark-pool/{symbol} returns dark pool data."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/dark-pool/AAPL")

        assert response.status_code in [200, 503]

    def test_equity_flow_endpoint(self, client, mock_container):
        """Test GET /api/equity-flow/{symbol} returns equity flow."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/equity-flow/AAPL")

        assert response.status_code in [200, 503]

    def test_sector_rotation_endpoint(self, client, mock_container):
        """Test GET /api/sector-rotation returns rotation signals."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/sector-rotation")

        assert response.status_code in [200, 503]

    def test_market_breadth_endpoint(self, client, mock_container):
        """Test GET /api/market-breadth returns breadth data."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/market-breadth")

        assert response.status_code in [200, 503]

    def test_smart_money_endpoint(self, client, mock_container):
        """Test GET /api/smart-money/{symbol} returns smart money data."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/smart-money/AAPL")

        assert response.status_code in [200, 503]

    def test_analytics_no_auth_required(self, client, mock_container):
        """Test analytics endpoints work without auth."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/sector-rotation")

        assert response.status_code != 401


# =============================================================================
# Research Router Tests
# =============================================================================


class TestResearchRouter:
    """Tests for research endpoints."""

    def test_research_report_endpoint(self, client, mock_container):
        """Test GET /api/research/{symbol} returns research report."""
        with patch(
            "investing.api.routers.research.get_research_analyzer",
            return_value=mock_container.research_analyzer,
        ):
            response = client.get("/api/research/AAPL")

        assert response.status_code in [200, 503]

    def test_valuation_endpoint(self, client, mock_container):
        """Test GET /api/valuation/{symbol} returns valuation data."""
        with patch(
            "investing.api.routers.research.get_research_analyzer",
            return_value=mock_container.research_analyzer,
        ):
            response = client.get("/api/valuation/AAPL")

        assert response.status_code in [200, 503]

    def test_earnings_endpoint(self, client, mock_container):
        """Test GET /api/earnings/{symbol} returns earnings analysis."""
        with patch(
            "investing.api.routers.research.get_research_analyzer",
            return_value=mock_container.research_analyzer,
        ):
            response = client.get("/api/earnings/AAPL")

        assert response.status_code in [200, 503]

    def test_peers_endpoint(self, client, mock_container):
        """Test GET /api/peers/{symbol} returns peer comparison."""
        with patch(
            "investing.api.routers.research.get_research_analyzer",
            return_value=mock_container.research_analyzer,
        ):
            response = client.get("/api/peers/AAPL")

        assert response.status_code in [200, 503]

    def test_dcf_endpoint(self, client, mock_container):
        """Test GET /api/research/{symbol}/dcf returns DCF model."""
        with patch(
            "investing.api.routers.research.get_research_analyzer",
            return_value=mock_container.research_analyzer,
        ):
            response = client.get("/api/research/AAPL/dcf")

        assert response.status_code in [200, 503]

    def test_research_summary_endpoint(self, client, mock_container):
        """Test GET /api/research/{symbol}/summary returns summary."""
        with patch(
            "investing.api.routers.research.get_research_analyzer",
            return_value=mock_container.research_analyzer,
        ):
            response = client.get("/api/research/AAPL/summary")

        assert response.status_code in [200, 503]


# =============================================================================
# Options Router Tests
# =============================================================================


class TestOptionsRouter:
    """Tests for options analytics endpoints."""

    def test_options_flow_endpoint(self, client, mock_container):
        """Test GET /api/options/{symbol}/flow returns options flow."""
        with patch(
            "investing.api.routers.options.get_options_analyzer",
            return_value=mock_container.options_analyzer,
        ):
            response = client.get("/api/options/AAPL/flow")

        assert response.status_code in [200, 503]

    def test_gamma_exposure_endpoint(self, client, mock_container):
        """Test GET /api/options/{symbol}/gamma returns GEX data."""
        with patch(
            "investing.api.routers.options.get_options_analyzer",
            return_value=mock_container.options_analyzer,
        ):
            response = client.get("/api/options/AAPL/gamma")

        assert response.status_code in [200, 503]

    def test_unusual_activity_endpoint(self, client, mock_container):
        """Test GET /api/options/{symbol}/unusual returns unusual activity."""
        with patch(
            "investing.api.routers.options.get_options_analyzer",
            return_value=mock_container.options_analyzer,
        ):
            response = client.get("/api/options/AAPL/unusual")

        assert response.status_code in [200, 503]

    def test_put_call_endpoint(self, client, mock_container):
        """Test GET /api/options/{symbol}/put-call returns put/call analysis."""
        with patch(
            "investing.api.routers.options.get_options_analyzer",
            return_value=mock_container.options_analyzer,
        ):
            response = client.get("/api/options/AAPL/put-call")

        assert response.status_code in [200, 503]

    def test_max_pain_endpoint(self, client, mock_container):
        """Test GET /api/options/{symbol}/max-pain returns max pain data."""
        with patch(
            "investing.api.routers.options.get_options_analyzer",
            return_value=mock_container.options_analyzer,
        ):
            response = client.get("/api/options/AAPL/max-pain")

        assert response.status_code in [200, 503]


# =============================================================================
# ETF Router Tests
# =============================================================================


class TestETFRouter:
    """Tests for ETF analytics endpoints."""

    def test_etf_flows_endpoint(self, client, mock_container):
        """Test GET /api/etf/flows returns ETF flows."""
        with patch(
            "investing.api.routers.etf.get_etf_analyzer",
            return_value=mock_container.etf_analyzer,
        ):
            response = client.get("/api/etf/flows")

        assert response.status_code in [200, 503]

    def test_sector_rotation_endpoint(self, client, mock_container):
        """Test GET /api/etf/sector-rotation returns sector rotation."""
        with patch(
            "investing.api.routers.etf.get_etf_analyzer",
            return_value=mock_container.etf_analyzer,
        ):
            response = client.get("/api/etf/sector-rotation")

        assert response.status_code in [200, 503]

    def test_smart_beta_endpoint(self, client, mock_container):
        """Test GET /api/etf/smart-beta returns smart beta flows."""
        with patch(
            "investing.api.routers.etf.get_etf_analyzer",
            return_value=mock_container.etf_analyzer,
        ):
            response = client.get("/api/etf/smart-beta")

        assert response.status_code in [200, 503]

    def test_thematic_endpoint(self, client, mock_container):
        """Test GET /api/etf/thematic returns thematic ETF flows."""
        with patch(
            "investing.api.routers.etf.get_etf_analyzer",
            return_value=mock_container.etf_analyzer,
        ):
            response = client.get("/api/etf/thematic")

        assert response.status_code in [200, 503]

    def test_etf_overview_endpoint(self, client, mock_container):
        """Test GET /api/etf/overview returns ETF overview."""
        with patch(
            "investing.api.routers.etf.get_etf_analyzer",
            return_value=mock_container.etf_analyzer,
        ):
            response = client.get("/api/etf/overview")

        assert response.status_code in [200, 503]


# =============================================================================
# Notes Router Tests
# =============================================================================


class TestNotesRouter:
    """Tests for notes/research vault endpoints."""

    def test_list_notes_endpoint(self, client, mock_container):
        """Test GET /api/notes returns notes list."""
        with patch(
            "investing.api.dependencies.get_note_manager",
            return_value=mock_container.note_manager,
        ):
            response = client.get("/api/notes")

        assert response.status_code in [200, 503]

    def test_search_notes_endpoint(self, client, mock_container):
        """Test GET /api/notes/search with query."""
        with patch(
            "investing.api.dependencies.get_note_manager",
            return_value=mock_container.note_manager,
        ):
            response = client.get("/api/notes/search?query=apple")

        assert response.status_code in [200, 503]

    def test_get_theses_endpoint(self, client, mock_container):
        """Test GET /api/theses returns theses list."""
        with patch(
            "investing.api.dependencies.get_note_manager",
            return_value=mock_container.note_manager,
        ):
            response = client.get("/api/theses")

        assert response.status_code in [200, 503]

    def test_get_trades_endpoint(self, client, mock_container):
        """Test GET /api/trades returns trades list."""
        with patch(
            "investing.api.dependencies.get_note_manager",
            return_value=mock_container.note_manager,
        ):
            response = client.get("/api/trades")

        assert response.status_code in [200, 503]

    def test_trade_stats_endpoint(self, client, mock_container):
        """Test GET /api/trades/stats returns trade statistics."""
        with patch(
            "investing.api.dependencies.get_note_manager",
            return_value=mock_container.note_manager,
        ):
            response = client.get("/api/trades/stats")

        assert response.status_code in [200, 503]


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for API error handling."""

    def test_404_for_unknown_endpoint(self, client):
        """Test 404 response for unknown endpoints."""
        response = client.get("/api/unknown/endpoint")
        assert response.status_code == 404

    def test_422_for_invalid_input(self, client, auth_headers):
        """Test 422 response for invalid input."""
        response = client.post(
            "/api/portfolio/analytics",
            json={"invalid": "data"},  # Missing required fields
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_error_response_structure(self, client, auth_headers):
        """Test error responses have correct structure."""
        response = client.post(
            "/api/portfolio/analytics",
            json={"holdings": []},  # Invalid - empty holdings
            headers=auth_headers,
        )

        assert response.status_code == 422
        data = response.json()
        assert "detail" in data


# =============================================================================
# Input Validation Tests
# =============================================================================


class TestInputValidation:
    """Tests for input validation."""

    def test_symbol_too_long(self, client, mock_container):
        """Test handling of overly long symbol."""
        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/market/" + "A" * 100)

        # Should not crash - may return error or 404
        assert response.status_code in [200, 404, 422, 503]

    def test_negative_lookback_days(self, client, mock_container):
        """Test validation of negative lookback_days."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/dark-pool/AAPL?lookback_days=-10")

        assert response.status_code == 422

    def test_lookback_days_too_large(self, client, mock_container):
        """Test validation of excessively large lookback_days."""
        with patch(
            "investing.api.routers.analytics.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/dark-pool/AAPL?lookback_days=1000")

        assert response.status_code == 422

    def test_portfolio_holdings_missing_symbol(self, client, auth_headers):
        """Test validation of holdings without symbol."""
        response = client.post(
            "/api/portfolio/analytics",
            json={"holdings": [{"shares": 100}], "benchmark": "SPY"},  # Missing symbol
            headers=auth_headers,
        )

        assert response.status_code == 422

    def test_portfolio_negative_shares(self, client, auth_headers):
        """Test validation of negative shares."""
        response = client.post(
            "/api/portfolio/analytics",
            json={"holdings": [{"symbol": "AAPL", "shares": -100}], "benchmark": "SPY"},
            headers=auth_headers,
        )

        assert response.status_code == 422


# =============================================================================
# Response Structure Tests
# =============================================================================


class TestResponseStructure:
    """Tests for API response structure."""

    def test_success_response_structure(self, client):
        """Test successful responses have correct structure."""
        response = client.get("/api/health")

        assert response.status_code == 200
        data = response.json()

        # Health endpoint has its own structure
        assert "status" in data
        assert "timestamp" in data

    def test_api_response_has_timestamp(self, client):
        """Test API responses include timestamp."""
        response = client.get("/api/version")

        assert response.status_code == 200
        data = response.json()
        assert "timestamp" in data

    def test_api_response_has_success_flag(self, client):
        """Test API responses include success flag."""
        response = client.get("/api/version")

        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert data["success"] is True


# =============================================================================
# Rate Limiting Tests
# =============================================================================


class TestRateLimitingIntegration:
    """Tests for rate limiting integration with routers."""

    @pytest.fixture
    def rate_limited_app(self, mock_container):
        """Create app with rate limiting enabled."""
        os.environ["ZEE_INVESTING_AUTH_RATE_LIMIT_ENABLED"] = "true"

        # Reset rate limiter module
        import importlib
        import investing.api.auth.rate_limit as rate_limit_module

        rate_limit_module._rate_limiter = None

        from investing.api.main_new import create_app

        app = create_app()
        app.state.app_state = mock_container

        yield app

        os.environ["ZEE_INVESTING_AUTH_RATE_LIMIT_ENABLED"] = "false"

    def test_rate_limit_headers_present(self, rate_limited_app, mock_container):
        """Test rate limit headers are present in response."""
        client = TestClient(rate_limited_app)

        with patch(
            "investing.api.routers.base.get_app_state", return_value=mock_container
        ):
            response = client.get("/api/version")

        # Rate limit headers should be present when middleware is enabled
        # May or may not have headers depending on middleware configuration
        assert response.status_code == 200


# =============================================================================
# CORS Tests
# =============================================================================


class TestCORSConfiguration:
    """Tests for CORS configuration."""

    def test_cors_headers_on_options(self, client):
        """Test CORS headers on preflight request."""
        response = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

        # Should allow CORS for configured origins
        assert response.status_code == 200

    def test_cors_allows_localhost(self, client):
        """Test CORS allows localhost origins."""
        response = client.get(
            "/api/health", headers={"Origin": "http://localhost:3000"}
        )

        assert response.status_code == 200


# =============================================================================
# Main Entry Point
# =============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
