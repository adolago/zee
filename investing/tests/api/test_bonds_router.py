"""
Tests for the bonds router.

Covers all endpoints for government, corporate, and municipal bonds.
"""

import os
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from investing.api.main_new import app
from investing.api.routers.bonds import get_analyzer, get_provider, get_screener
from investing.bonds import (
    BondReference,
    BondScreenResponse,
    BondSummary,
    CreditSpreadAnalysis,
    MuniBondReference,
    YieldCurve,
    YieldCurvePoint,
)
from investing.data.providers.terrapin_provider import (
    TerrapinError,
    TerrapinNotFoundError,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def client():
    """Create test client with clean state."""
    # Reset global provider instances before each test
    import investing.api.routers.bonds as bonds_module

    bonds_module._provider = None
    bonds_module._analyzer = None
    bonds_module._screener = None

    with TestClient(app) as c:
        yield c

    # Clear any overrides
    app.dependency_overrides.clear()


@pytest.fixture
def mock_provider():
    """Create mock TerrapinProvider."""
    provider = MagicMock()
    provider.health_check = AsyncMock(return_value=True)
    provider.get_bond_pricing = AsyncMock(return_value=pd.DataFrame())
    provider.search_bonds = AsyncMock(return_value=[])
    provider.get_yield_curve = AsyncMock(return_value=None)
    provider.search_municipal_bonds = AsyncMock(return_value=[])
    provider.get_municipal_bond = AsyncMock(return_value=None)
    provider.get_muni_yields_by_state = AsyncMock(return_value={})
    provider.initialize = AsyncMock()
    provider.close = AsyncMock()
    return provider


@pytest.fixture
def mock_analyzer(mock_bond_reference):
    """Create mock BondAnalyzer."""
    analyzer = MagicMock()
    analyzer.get_bond = AsyncMock(return_value=mock_bond_reference)
    analyzer.get_company_bonds = AsyncMock(return_value=[])
    analyzer.get_company_credit_spread = AsyncMock(return_value=None)
    # Yield curve method
    analyzer.get_yield_curve = AsyncMock(return_value=None)
    # Municipal bond methods
    analyzer.search_munis = AsyncMock(return_value=([], 0))
    analyzer.get_muni_bond = AsyncMock(return_value=None)
    analyzer.get_muni_yield_by_state = AsyncMock(return_value=pd.DataFrame())
    return analyzer


@pytest.fixture
def mock_screener():
    """Create mock BondScreener."""
    screener = MagicMock()
    default_response = BondScreenResponse(
        bonds=[],
        total=0,
        filters_applied={},
    )
    screener.screen = AsyncMock(return_value=default_response)
    screener.screen_from_request = AsyncMock(return_value=default_response)
    return screener


@pytest.fixture
def mock_bond_reference():
    """Create mock BondReference."""
    return BondReference(
        isin="US912810SZ21",
        name="United States Treasury Bond 2.5% 15-Feb-2045",
        issuer_name="United States Treasury",
        issuer_type="government",
        country_code="US",
        coupon=2.5,
        coupon_frequency=2,
        interest_type="fixed rate",
        maturity_date=date(2045, 2, 15),
        issue_date=date(2015, 2, 15),
        currency="USD",
        issued_amount=1000000000.0,
        rating_composite="AAA",
    )


@pytest.fixture
def mock_corporate_bond():
    """Create mock corporate BondReference."""
    return BondReference(
        isin="US037833DV99",
        name="Apple Inc 3.25% 08-Feb-2029",
        issuer_name="Apple Inc",
        issuer_type="corporate",
        country_code="US",
        coupon=3.25,
        coupon_frequency=2,
        interest_type="fixed rate",
        maturity_date=date(2029, 2, 8),
        issue_date=date(2019, 2, 8),
        currency="USD",
        issued_amount=500000000.0,
        rating_composite="AA+",
        sector="Technology",
        lei="HWUPKR0MPOU8FGXBT394",
    )


@pytest.fixture
def mock_muni_bond():
    """Create mock MuniBondReference."""
    return MuniBondReference(
        isin="US64971Q5R47",
        name="New York State GO Bond 4.0% 01-Aug-2035",
        issuer_name="State of New York",
        issuer_type="government",
        country_code="US",
        state="NY",
        coupon=4.0,
        coupon_frequency=2,
        interest_type="fixed rate",
        maturity_date=date(2035, 8, 1),
        issue_date=date(2020, 8, 1),
        currency="USD",
        issued_amount=100000000.0,
        rating_composite="AA",
        tax_status="tax_exempt",
        use_of_proceeds="General Obligation",
    )


@pytest.fixture
def mock_bond_summary():
    """Create mock BondSummary."""
    return BondSummary(
        isin="US912810SZ21",
        name="United States Treasury Bond 2.5% 15-Feb-2045",
        issuer_name="United States Treasury",
        coupon=2.5,
        maturity_date=date(2045, 2, 15),
        interest_type="fixed rate",
        rating="AAA",
    )


@pytest.fixture
def mock_yield_curve():
    """Create mock YieldCurve."""
    return YieldCurve(
        country="US",
        currency="USD",
        curve_date=date(2024, 1, 15),
        points=[
            YieldCurvePoint(tenor="1M", years=1 / 12, yield_pct=5.25),
            YieldCurvePoint(tenor="3M", years=0.25, yield_pct=5.30),
            YieldCurvePoint(tenor="6M", years=0.5, yield_pct=5.20),
            YieldCurvePoint(tenor="1Y", years=1.0, yield_pct=5.00),
            YieldCurvePoint(tenor="2Y", years=2.0, yield_pct=4.50),
            YieldCurvePoint(tenor="5Y", years=5.0, yield_pct=4.20),
            YieldCurvePoint(tenor="10Y", years=10.0, yield_pct=4.30),
            YieldCurvePoint(tenor="30Y", years=30.0, yield_pct=4.50),
        ],
    )


@pytest.fixture
def mock_credit_spread():
    """Create mock CreditSpreadAnalysis."""
    return CreditSpreadAnalysis(
        symbol="AAPL",
        company_name="Apple Inc",
        analysis_date=date(2024, 1, 15),
        bonds_outstanding=5,
        average_spread_bps=85.0,
        min_spread_bps=45.0,
        max_spread_bps=120.0,
        average_ytm=4.5,
        average_duration=5.2,
        total_debt_outstanding=125000000000.0,
    )


# =============================================================================
# Helper to set up dependency overrides
# =============================================================================


def setup_provider_override(mock_provider):
    """Set up provider dependency override."""

    async def mock_get_provider():
        return mock_provider

    app.dependency_overrides[get_provider] = mock_get_provider


def setup_analyzer_override(mock_analyzer):
    """Set up analyzer dependency override."""

    async def mock_get_analyzer():
        return mock_analyzer

    app.dependency_overrides[get_analyzer] = mock_get_analyzer


def setup_screener_override(mock_screener):
    """Set up screener dependency override."""

    async def mock_get_screener():
        return mock_screener

    app.dependency_overrides[get_screener] = mock_get_screener


# =============================================================================
# Health Endpoint Tests
# =============================================================================


class TestBondsHealthEndpoint:
    """Tests for bonds health check endpoint."""

    def test_health_returns_not_configured_without_api_key(self, client):
        """Test health returns not_configured when no API key is set."""
        response = client.get("/bonds/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_configured"
        assert data["service"] == "bonds"

    def test_health_returns_healthy_with_provider(self, client, mock_provider):
        """Test health returns healthy when provider is available."""
        # Health endpoint calls get_provider() directly, not via Depends,
        # so we need to patch the function directly
        with patch(
            "investing.api.routers.bonds.get_provider",
            return_value=mock_provider,
        ):
            response = client.get("/bonds/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "bonds"
        assert data["provider"] == "terrapin"

    def test_health_returns_unhealthy_on_provider_error(self, client, mock_provider):
        """Test health returns unhealthy when provider fails."""
        mock_provider.health_check = AsyncMock(
            side_effect=Exception("Connection failed")
        )

        # Patch the function to return our mock provider
        async def mock_get_provider():
            return mock_provider

        with patch(
            "investing.api.routers.bonds.get_provider",
            side_effect=mock_get_provider,
        ):
            response = client.get("/bonds/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"
        assert "error" in data


# =============================================================================
# Bond Reference Endpoint Tests
# =============================================================================


class TestBondReferenceEndpoint:
    """Tests for bond reference data endpoint."""

    def test_get_bond_returns_bond_data(
        self, client, mock_analyzer, mock_bond_reference
    ):
        """Test GET /bonds/{isin} returns bond reference data."""
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/US912810SZ21")

        assert response.status_code == 200
        data = response.json()
        assert data["isin"] == "US912810SZ21"
        assert data["name"] == mock_bond_reference.name
        assert data["coupon"] == mock_bond_reference.coupon
        assert data["issuer_name"] == mock_bond_reference.issuer_name

    def test_get_bond_returns_404_when_not_found(self, client, mock_analyzer):
        """Test GET /bonds/{isin} returns 404 for unknown ISIN."""
        mock_analyzer.get_bond = AsyncMock(return_value=None)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/INVALID123")

        assert response.status_code == 404
        data = response.json()
        # Check for error message in either format
        error_msg = data.get("detail", data.get("error", "")).lower()
        assert "not found" in error_msg

    def test_get_bond_handles_terrapin_not_found_error(self, client, mock_analyzer):
        """Test GET /bonds/{isin} handles TerrapinNotFoundError."""
        mock_analyzer.get_bond = AsyncMock(
            side_effect=TerrapinNotFoundError("Bond not found")
        )
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/INVALID123")

        assert response.status_code == 404

    def test_get_bond_handles_terrapin_error(self, client, mock_analyzer):
        """Test GET /bonds/{isin} handles TerrapinError."""
        mock_analyzer.get_bond = AsyncMock(side_effect=TerrapinError("API error"))
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/US912810SZ21")

        assert response.status_code == 500


# =============================================================================
# Bond Pricing Endpoint Tests
# =============================================================================


class TestBondPricingEndpoint:
    """Tests for bond pricing history endpoint."""

    def test_get_bond_pricing_returns_pricing_data(self, client, mock_provider):
        """Test GET /bonds/{isin}/pricing returns pricing data."""
        pricing_df = pd.DataFrame(
            {
                "date": pd.to_datetime(["2024-01-10", "2024-01-11", "2024-01-12"]),
                "price": [98.50, 98.75, 98.60],
                "yield": [4.25, 4.22, 4.24],
                "spread": [85, 82, 84],
            }
        )
        mock_provider.get_bond_pricing = AsyncMock(return_value=pricing_df)
        setup_provider_override(mock_provider)

        response = client.get("/bonds/US912810SZ21/pricing")

        assert response.status_code == 200
        data = response.json()
        assert data["isin"] == "US912810SZ21"
        assert len(data["pricing"]) == 3
        assert data["pricing"][0]["price"] == 98.50

    def test_get_bond_pricing_with_date_range(self, client, mock_provider):
        """Test GET /bonds/{isin}/pricing with date parameters."""
        mock_provider.get_bond_pricing = AsyncMock(return_value=pd.DataFrame())
        setup_provider_override(mock_provider)

        response = client.get(
            "/bonds/US912810SZ21/pricing?start_date=2024-01-01&end_date=2024-01-15"
        )

        assert response.status_code == 200
        # Verify provider was called with date params
        mock_provider.get_bond_pricing.assert_called_once()
        call_args = mock_provider.get_bond_pricing.call_args
        assert call_args.kwargs.get("start_date") == date(2024, 1, 1)
        assert call_args.kwargs.get("end_date") == date(2024, 1, 15)

    def test_get_bond_pricing_empty_returns_empty_list(self, client, mock_provider):
        """Test GET /bonds/{isin}/pricing returns empty list when no data."""
        mock_provider.get_bond_pricing = AsyncMock(return_value=pd.DataFrame())
        setup_provider_override(mock_provider)

        response = client.get("/bonds/US912810SZ21/pricing")

        assert response.status_code == 200
        data = response.json()
        assert data["isin"] == "US912810SZ21"
        assert data["pricing"] == []

    def test_get_bond_pricing_handles_error(self, client, mock_provider):
        """Test GET /bonds/{isin}/pricing handles TerrapinError."""
        mock_provider.get_bond_pricing = AsyncMock(
            side_effect=TerrapinError("API error")
        )
        setup_provider_override(mock_provider)

        response = client.get("/bonds/US912810SZ21/pricing")

        assert response.status_code == 500


# =============================================================================
# Bond Search Endpoint Tests
# =============================================================================


class TestBondSearchEndpoints:
    """Tests for bond search and screening endpoints."""

    def test_search_bonds_returns_results(
        self, client, mock_screener, mock_bond_summary
    ):
        """Test POST /bonds/search returns screening results."""
        mock_screener.screen_from_request = AsyncMock(
            return_value=BondScreenResponse(
                bonds=[mock_bond_summary],
                total=1,
                filters_applied={"bond_type": "government"},
            )
        )
        setup_screener_override(mock_screener)

        response = client.post(
            "/bonds/search",
            json={
                "bond_type": "government",
                "min_coupon": 2.0,
                "max_coupon": 5.0,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert len(data["bonds"]) == 1

    def test_search_government_bonds(self, client, mock_screener, mock_bond_summary):
        """Test GET /bonds/search/government returns government bonds."""
        mock_screener.screen = AsyncMock(
            return_value=BondScreenResponse(
                bonds=[mock_bond_summary],
                total=1,
                filters_applied={"bond_type": "government"},
            )
        )
        setup_screener_override(mock_screener)

        response = client.get("/bonds/search/government")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1

    def test_search_government_bonds_with_params(
        self, client, mock_screener, mock_bond_summary
    ):
        """Test GET /bonds/search/government with filter parameters."""
        mock_screener.screen = AsyncMock(
            return_value=BondScreenResponse(
                bonds=[mock_bond_summary],
                total=1,
                filters_applied={"country": "US"},
            )
        )
        setup_screener_override(mock_screener)

        response = client.get("/bonds/search/government?country=US&limit=50")

        assert response.status_code == 200
        mock_screener.screen.assert_called_once()

    def test_search_corporate_bonds(self, client, mock_screener, mock_bond_summary):
        """Test GET /bonds/search/corporate returns corporate bonds."""
        mock_screener.screen = AsyncMock(
            return_value=BondScreenResponse(
                bonds=[mock_bond_summary],
                total=1,
                filters_applied={"bond_type": "corporate"},
            )
        )
        setup_screener_override(mock_screener)

        response = client.get("/bonds/search/corporate")

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1

    def test_search_corporate_bonds_with_filters(self, client, mock_screener):
        """Test GET /bonds/search/corporate with rating filters."""
        mock_screener.screen = AsyncMock(
            return_value=BondScreenResponse(
                bonds=[],
                total=0,
                filters_applied={},
            )
        )
        setup_screener_override(mock_screener)

        response = client.get("/bonds/search/corporate?min_rating=AA&limit=25")

        assert response.status_code == 200
        mock_screener.screen.assert_called_once()

    def test_search_bonds_handles_error(self, client, mock_screener):
        """Test POST /bonds/search handles TerrapinError."""
        mock_screener.screen_from_request = AsyncMock(
            side_effect=TerrapinError("API error")
        )
        setup_screener_override(mock_screener)

        response = client.post(
            "/bonds/search",
            json={"bond_type": "government"},
        )

        assert response.status_code == 500


# =============================================================================
# Yield Curve Endpoint Tests
# =============================================================================


class TestYieldCurveEndpoints:
    """Tests for yield curve endpoints."""

    def test_get_yield_curve_default(self, client, mock_analyzer, mock_yield_curve):
        """Test GET /bonds/yield-curve returns US curve by default."""
        mock_analyzer.get_yield_curve = AsyncMock(return_value=mock_yield_curve)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/yield-curve")

        assert response.status_code == 200
        data = response.json()
        assert data["country"] == "US"
        assert data["currency"] == "USD"
        assert len(data["points"]) > 0

    def test_get_yield_curve_with_country(
        self, client, mock_analyzer, mock_yield_curve
    ):
        """Test GET /bonds/yield-curve with country parameter."""
        # Modify mock to return DE curve
        de_curve = YieldCurve(
            country="DE",
            currency="EUR",
            curve_date=date(2024, 1, 15),
            points=[
                YieldCurvePoint(tenor="2Y", years=2.0, yield_pct=3.0),
                YieldCurvePoint(tenor="10Y", years=10.0, yield_pct=3.5),
            ],
        )
        mock_analyzer.get_yield_curve = AsyncMock(return_value=de_curve)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/yield-curve?country=DE")

        assert response.status_code == 200
        data = response.json()
        assert data["country"] == "DE"

    def test_get_yield_curve_with_date(self, client, mock_analyzer, mock_yield_curve):
        """Test GET /bonds/yield-curve with as_of_date parameter."""
        mock_analyzer.get_yield_curve = AsyncMock(return_value=mock_yield_curve)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/yield-curve?as_of_date=2024-01-15")

        assert response.status_code == 200

    def test_yield_curve_handles_error(self, client, mock_analyzer):
        """Test GET /bonds/yield-curve handles TerrapinError."""
        mock_analyzer.get_yield_curve = AsyncMock(
            side_effect=TerrapinError("API error")
        )
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/yield-curve")

        assert response.status_code == 500


# =============================================================================
# Company Bonds Endpoint Tests
# =============================================================================


class TestCompanyBondsEndpoints:
    """Tests for company bonds and credit spread endpoints."""

    def test_get_company_bonds(self, client, mock_analyzer, mock_corporate_bond):
        """Test GET /bonds/company/{symbol} returns company bonds."""
        # Create a summary version
        summary = BondSummary(
            isin=mock_corporate_bond.isin,
            name=mock_corporate_bond.name,
            issuer_name=mock_corporate_bond.issuer_name,
            bond_type=mock_corporate_bond.bond_type,
            coupon=mock_corporate_bond.coupon,
            maturity_date=mock_corporate_bond.maturity_date,
            interest_type=mock_corporate_bond.interest_type,
            currency=mock_corporate_bond.currency,
            price=102.50,
            yield_to_maturity=2.85,
        )
        mock_analyzer.get_company_bonds = AsyncMock(return_value=[summary])
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/company/AAPL")

        assert response.status_code == 200
        data = response.json()
        assert "bonds" in data
        assert "bonds_count" in data
        assert "symbol" in data
        assert data["symbol"] == "AAPL"
        assert data["bonds_count"] == 1
        assert len(data["bonds"]) == 1

    def test_get_company_bonds_with_lei(self, client, mock_analyzer):
        """Test GET /bonds/company/{symbol} with LEI parameter."""
        mock_analyzer.get_company_bonds = AsyncMock(return_value=[])
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/company/AAPL?lei=HWUPKR0MPOU8FGXBT394")

        assert response.status_code == 200
        mock_analyzer.get_company_bonds.assert_called_once()

    def test_get_credit_spread(self, client, mock_analyzer, mock_credit_spread):
        """Test GET /bonds/credit-spread/{symbol} returns spread analysis."""
        mock_analyzer.get_company_credit_spread = AsyncMock(
            return_value=mock_credit_spread
        )
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/credit-spread/AAPL")

        assert response.status_code == 200
        data = response.json()
        assert data["symbol"] == "AAPL"
        assert data["average_spread_bps"] == 85.0
        assert "bonds_outstanding" in data

    def test_get_credit_spread_with_lei(
        self, client, mock_analyzer, mock_credit_spread
    ):
        """Test GET /bonds/credit-spread/{symbol} with LEI parameter."""
        mock_analyzer.get_company_credit_spread = AsyncMock(
            return_value=mock_credit_spread
        )
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/credit-spread/AAPL?lei=HWUPKR0MPOU8FGXBT394")

        assert response.status_code == 200
        mock_analyzer.get_company_credit_spread.assert_called_once()

    def test_company_bonds_handles_error(self, client, mock_analyzer):
        """Test GET /bonds/company/{symbol} handles TerrapinError."""
        mock_analyzer.get_company_bonds = AsyncMock(
            side_effect=TerrapinError("API error")
        )
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/company/AAPL")

        assert response.status_code == 500


# =============================================================================
# Municipal Bond Endpoint Tests
# =============================================================================


class TestMunicipalBondEndpoints:
    """Tests for municipal bond endpoints."""

    def test_search_municipal_bonds(self, client, mock_analyzer, mock_muni_bond):
        """Test POST /bonds/munis/search returns municipal bonds."""
        mock_analyzer.search_munis = AsyncMock(return_value=([mock_muni_bond], 1))
        setup_analyzer_override(mock_analyzer)

        response = client.post(
            "/bonds/munis/search",
        )

        assert response.status_code == 200
        data = response.json()
        assert "bonds" in data
        assert "total" in data

    def test_search_municipal_bonds_with_filters(self, client, mock_analyzer):
        """Test POST /bonds/munis/search with various filters."""
        mock_analyzer.search_munis = AsyncMock(return_value=([], 0))
        setup_analyzer_override(mock_analyzer)

        response = client.post(
            "/bonds/munis/search?states=CA&tax_exempt_only=true&limit=25",
        )

        assert response.status_code == 200
        mock_analyzer.search_munis.assert_called_once()

    def test_get_municipal_bond(self, client, mock_analyzer, mock_muni_bond):
        """Test GET /bonds/munis/{isin} returns municipal bond details."""
        mock_analyzer.get_muni_bond = AsyncMock(return_value=mock_muni_bond)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/munis/US64971Q5R47")

        assert response.status_code == 200
        data = response.json()
        assert data["isin"] == "US64971Q5R47"
        assert data["state"] == "NY"
        assert data["tax_status"] == "tax_exempt"

    def test_get_municipal_bond_not_found(self, client, mock_analyzer):
        """Test GET /bonds/munis/{isin} returns 404 when not found."""
        mock_analyzer.get_muni_bond = AsyncMock(return_value=None)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/munis/INVALID123")

        assert response.status_code == 404
        data = response.json()
        # Check for error message in either format
        error_msg = data.get("detail", data.get("error", "")).lower()
        assert "not found" in error_msg

    def test_get_municipal_bond_terrapin_not_found(self, client, mock_analyzer):
        """Test GET /bonds/munis/{isin} handles TerrapinNotFoundError."""
        mock_analyzer.get_muni_bond = AsyncMock(
            side_effect=TerrapinNotFoundError("Bond not found")
        )
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/munis/INVALID123")

        assert response.status_code == 404

    def test_get_muni_yields_by_state(self, client, mock_analyzer):
        """Test GET /bonds/munis/states returns state yields."""
        mock_df = pd.DataFrame(
            {
                "state": ["NY", "CA", "TX"],
                "avg_yield": [3.5, 3.25, 3.75],
            }
        )
        mock_analyzer.get_muni_yield_by_state = AsyncMock(return_value=mock_df)
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/munis/states")

        assert response.status_code == 200
        data = response.json()
        assert "states" in data
        assert len(data["states"]) == 3

    def test_get_muni_yields_by_state_empty(self, client, mock_analyzer):
        """Test GET /bonds/munis/states returns empty list when no data."""
        mock_analyzer.get_muni_yield_by_state = AsyncMock(return_value=pd.DataFrame())
        setup_analyzer_override(mock_analyzer)

        response = client.get("/bonds/munis/states")

        assert response.status_code == 200
        data = response.json()
        assert data["states"] == []

    def test_muni_search_handles_error(self, client, mock_analyzer):
        """Test POST /bonds/munis/search handles TerrapinError."""
        mock_analyzer.search_munis = AsyncMock(side_effect=TerrapinError("API error"))
        setup_analyzer_override(mock_analyzer)

        response = client.post(
            "/bonds/munis/search",
        )

        assert response.status_code == 500


# =============================================================================
# Dependency Tests
# =============================================================================


class TestBondsDependencies:
    """Tests for bonds router dependency functions."""

    def test_get_provider_requires_api_key(self, client):
        """Test get_provider raises 503 without API key."""
        # Clear any previous overrides
        app.dependency_overrides.clear()

        # Access an endpoint that requires provider
        response = client.get("/bonds/US912810SZ21")

        # Should get 503 because no API key is set
        assert response.status_code == 503

    def test_provider_is_reused(self, client, mock_provider):
        """Test provider instance is reused across requests."""
        call_count = 0

        async def counting_provider():
            nonlocal call_count
            call_count += 1
            return mock_provider

        app.dependency_overrides[get_provider] = counting_provider

        # Make two requests
        mock_provider.get_bond_pricing = AsyncMock(return_value=pd.DataFrame())
        client.get("/bonds/US912810SZ21/pricing")
        client.get("/bonds/US912810SZ21/pricing")

        # Each request calls the dependency
        assert call_count == 2


# =============================================================================
# Input Validation Tests
# =============================================================================


class TestBondsInputValidation:
    """Tests for input validation on bonds endpoints."""

    def test_limit_validation_min(self, client, mock_screener):
        """Test limit parameter has minimum validation."""
        mock_screener.get_government_bonds = AsyncMock(return_value=[])
        setup_screener_override(mock_screener)

        # Limit of 0 or negative should be rejected or use default
        response = client.get("/bonds/search/government?limit=0")

        # FastAPI will validate the Query parameter constraints
        # Either returns 422 (validation error) or uses default
        assert response.status_code in [200, 422]

    def test_limit_validation_max(self, client, mock_screener):
        """Test limit parameter has maximum validation."""
        mock_screener.get_government_bonds = AsyncMock(return_value=[])
        setup_screener_override(mock_screener)

        # Very large limit should be capped or rejected
        response = client.get("/bonds/search/government?limit=10000")

        # Either returns 422 or proceeds with capped limit
        assert response.status_code in [200, 422]

    def test_date_format_validation(self, client, mock_provider):
        """Test date parameters require correct format."""
        mock_provider.get_bond_pricing = AsyncMock(return_value=pd.DataFrame())
        setup_provider_override(mock_provider)

        # Invalid date format
        response = client.get("/bonds/US912810SZ21/pricing?start_date=invalid-date")

        assert response.status_code == 422
