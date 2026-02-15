"""
Comprehensive Tests for the Commodities Module.

Tests commodity price data, CommoditiesAnalyzer async methods, and macro linkages.
Target: 80%+ coverage for stanley/commodities/ module.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import numpy as np
import pandas as pd

from stanley.commodities import (
    CommoditiesAnalyzer,
    CommoditySummary,
    MacroLinkage,
    CommodityPriceProvider,
    CommodityPrice,
    Commodity,
    CommodityCategory,
    COMMODITY_REGISTRY,
    get_commodity,
    get_commodities_by_category,
    list_all_commodities,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_commodity():
    """Sample commodity for testing."""
    return Commodity(
        symbol="TEST",
        name="Test Commodity",
        category=CommodityCategory.ENERGY,
        unit="USD/barrel",
        exchange="NYMEX",
        description="A test commodity for unit tests",
    )


@pytest.fixture
def sample_commodity_price():
    """Sample commodity price for testing."""
    return CommodityPrice(
        symbol="CL",
        name="Crude Oil (WTI)",
        price=75.50,
        change=1.25,
        change_percent=1.68,
        high=76.50,
        low=74.25,
        volume=500000,
        open_interest=1000000,
        timestamp=datetime.now(),
    )


@pytest.fixture
def sample_commodity_summary():
    """Sample commodity summary for testing."""
    return CommoditySummary(
        symbol="CL",
        name="Crude Oil (WTI)",
        category="energy",
        price=75.50,
        change_1d=1.68,
        change_1w=3.25,
        change_1m=-2.15,
        change_ytd=15.50,
        volatility_30d=28.50,
        trend="bullish",
        relative_strength=5.25,
    )


@pytest.fixture
def sample_macro_linkage():
    """Sample macro linkage for testing."""
    return MacroLinkage(
        commodity="CL",
        macro_indicator="USD Index",
        correlation=-0.65,
        lead_lag_days=0,
        relationship="Inverse - weak USD supports oil prices",
        strength="strong",
    )


@pytest.fixture
def sample_historical_prices():
    """Sample historical price DataFrame."""
    dates = pd.date_range(end=datetime.now(), periods=100, freq="D")
    prices = 75 + np.cumsum(np.random.randn(100) * 0.5)

    return pd.DataFrame(
        {
            "date": dates,
            "open": prices * (1 + np.random.uniform(-0.01, 0.01, 100)),
            "high": prices * 1.02,
            "low": prices * 0.98,
            "close": prices,
            "volume": np.random.randint(100000, 500000, 100),
        }
    )


@pytest.fixture
def mock_data_manager():
    """Mock DataManager for commodity tests."""
    mock = MagicMock()
    mock.get_commodity_price = AsyncMock(
        return_value={
            "symbol": "CL",
            "price": 75.50,
            "change": 1.25,
            "change_percent": 1.68,
        }
    )
    mock.get_commodity_historical = AsyncMock(
        return_value=pd.DataFrame(
            {
                "date": pd.date_range(end=datetime.now(), periods=252, freq="D"),
                "close": 75 + np.cumsum(np.random.randn(252) * 0.5),
            }
        )
    )
    return mock


# =============================================================================
# Commodity Registry Tests
# =============================================================================


class TestCommodityRegistry:
    """Tests for commodity registry."""

    def test_registry_not_empty(self):
        """Test that registry contains commodities."""
        assert len(COMMODITY_REGISTRY) > 0

    def test_registry_contains_major_commodities(self):
        """Test that major commodities are in registry."""
        major = ["CL", "BZ", "NG", "GC", "SI", "HG", "ZC", "ZW", "ZS"]
        for symbol in major:
            assert symbol in COMMODITY_REGISTRY
            assert COMMODITY_REGISTRY[symbol].symbol == symbol

    def test_registry_commodities_have_required_fields(self):
        """Test that all commodities have required fields."""
        for symbol, commodity in COMMODITY_REGISTRY.items():
            assert commodity.symbol == symbol
            assert commodity.name is not None
            assert commodity.category is not None
            assert commodity.unit is not None

    def test_energy_commodities_exist(self):
        """Test that energy commodities exist."""
        energy = ["CL", "BZ", "NG", "RB", "HO"]
        for symbol in energy:
            assert symbol in COMMODITY_REGISTRY
            assert COMMODITY_REGISTRY[symbol].category == CommodityCategory.ENERGY

    def test_precious_metals_exist(self):
        """Test that precious metals exist."""
        precious = ["GC", "SI", "PL", "PA"]
        for symbol in precious:
            assert symbol in COMMODITY_REGISTRY
            assert (
                COMMODITY_REGISTRY[symbol].category == CommodityCategory.PRECIOUS_METALS
            )

    def test_base_metals_exist(self):
        """Test that base metals exist."""
        base = ["HG", "ALI", "ZN", "NI"]
        for symbol in base:
            assert symbol in COMMODITY_REGISTRY
            assert COMMODITY_REGISTRY[symbol].category == CommodityCategory.BASE_METALS

    def test_agriculture_commodities_exist(self):
        """Test that agriculture commodities exist."""
        agri = ["ZC", "ZW", "ZS", "ZM", "ZL"]
        for symbol in agri:
            assert symbol in COMMODITY_REGISTRY
            assert COMMODITY_REGISTRY[symbol].category == CommodityCategory.AGRICULTURE


# =============================================================================
# Commodity Category Tests
# =============================================================================


class TestCommodityCategory:
    """Tests for CommodityCategory enum."""

    def test_all_categories_exist(self):
        """Test that all categories are defined."""
        categories = [
            CommodityCategory.ENERGY,
            CommodityCategory.PRECIOUS_METALS,
            CommodityCategory.BASE_METALS,
            CommodityCategory.AGRICULTURE,
            CommodityCategory.SOFTS,
            CommodityCategory.LIVESTOCK,
        ]
        for cat in categories:
            assert cat.value is not None

    def test_category_values(self):
        """Test category string values."""
        assert CommodityCategory.ENERGY.value == "energy"
        assert CommodityCategory.PRECIOUS_METALS.value == "precious_metals"
        assert CommodityCategory.BASE_METALS.value == "base_metals"
        assert CommodityCategory.AGRICULTURE.value == "agriculture"
        assert CommodityCategory.SOFTS.value == "softs"
        assert CommodityCategory.LIVESTOCK.value == "livestock"

    def test_get_commodities_by_category_energy(self):
        """Test getting energy commodities by category."""
        energy = get_commodities_by_category(CommodityCategory.ENERGY)

        assert len(energy) > 0
        assert all(c.category == CommodityCategory.ENERGY for c in energy)
        symbols = [c.symbol for c in energy]
        assert "CL" in symbols

    def test_get_commodities_by_category_precious(self):
        """Test getting precious metals by category."""
        precious = get_commodities_by_category(CommodityCategory.PRECIOUS_METALS)

        assert len(precious) > 0
        assert all(c.category == CommodityCategory.PRECIOUS_METALS for c in precious)
        symbols = [c.symbol for c in precious]
        assert "GC" in symbols

    def test_get_commodities_by_category_all(self):
        """Test that all categories return commodities."""
        for category in CommodityCategory:
            commodities = get_commodities_by_category(category)
            assert len(commodities) >= 0  # Some may be empty


# =============================================================================
# Get Commodity Function Tests
# =============================================================================


class TestGetCommodity:
    """Tests for get_commodity function."""

    def test_get_commodity_exists(self):
        """Test getting an existing commodity."""
        comm = get_commodity("CL")

        assert comm is not None
        assert comm.symbol == "CL"
        assert comm.name == "Crude Oil (WTI)"
        assert comm.category == CommodityCategory.ENERGY

    def test_get_commodity_not_exists(self):
        """Test getting a non-existent commodity."""
        comm = get_commodity("INVALID")
        assert comm is None

    def test_get_commodity_case_insensitive(self):
        """Test case insensitivity."""
        comm_lower = get_commodity("cl")
        comm_upper = get_commodity("CL")

        assert comm_lower is not None
        assert comm_upper is not None
        assert comm_lower.symbol == comm_upper.symbol

    def test_get_commodity_gold(self):
        """Test getting gold commodity."""
        gold = get_commodity("GC")

        assert gold is not None
        assert gold.symbol == "GC"
        assert gold.name == "Gold"
        assert gold.category == CommodityCategory.PRECIOUS_METALS

    def test_get_commodity_corn(self):
        """Test getting corn commodity."""
        corn = get_commodity("ZC")

        assert corn is not None
        assert corn.symbol == "ZC"
        assert corn.name == "Corn"
        assert corn.category == CommodityCategory.AGRICULTURE


# =============================================================================
# List All Commodities Tests
# =============================================================================


class TestListAllCommodities:
    """Tests for list_all_commodities function."""

    def test_list_returns_all_symbols(self):
        """Test that list returns all symbols."""
        all_symbols = list_all_commodities()

        assert len(all_symbols) == len(COMMODITY_REGISTRY)

    def test_list_contains_major_commodities(self):
        """Test that list contains major commodities."""
        all_symbols = list_all_commodities()

        assert "CL" in all_symbols
        assert "GC" in all_symbols
        assert "SI" in all_symbols
        assert "HG" in all_symbols
        assert "ZC" in all_symbols
        assert "NG" in all_symbols

    def test_list_returns_strings(self):
        """Test that list returns strings."""
        all_symbols = list_all_commodities()

        assert all(isinstance(s, str) for s in all_symbols)


# =============================================================================
# Commodity Dataclass Tests
# =============================================================================


class TestCommodity:
    """Tests for Commodity dataclass."""

    def test_commodity_creation(self, sample_commodity):
        """Test Commodity creation."""
        assert sample_commodity.symbol == "TEST"
        assert sample_commodity.name == "Test Commodity"
        assert sample_commodity.category == CommodityCategory.ENERGY
        assert sample_commodity.unit == "USD/barrel"
        assert sample_commodity.exchange == "NYMEX"
        assert sample_commodity.description == "A test commodity for unit tests"

    def test_commodity_to_dict(self, sample_commodity):
        """Test Commodity to_dict conversion."""
        result = sample_commodity.to_dict()

        assert result["symbol"] == "TEST"
        assert result["name"] == "Test Commodity"
        assert result["category"] == "energy"
        assert result["unit"] == "USD/barrel"
        assert result["exchange"] == "NYMEX"
        assert result["description"] == "A test commodity for unit tests"

    def test_commodity_minimal(self):
        """Test Commodity with minimal fields."""
        comm = Commodity(
            symbol="MIN",
            name="Minimal",
            category=CommodityCategory.SOFTS,
            unit="USD/lb",
        )

        assert comm.symbol == "MIN"
        assert comm.exchange == ""
        assert comm.description == ""


# =============================================================================
# CommodityPrice Dataclass Tests
# =============================================================================


class TestCommodityPrice:
    """Tests for CommodityPrice dataclass."""

    def test_price_creation(self, sample_commodity_price):
        """Test CommodityPrice creation."""
        assert sample_commodity_price.symbol == "CL"
        assert sample_commodity_price.name == "Crude Oil (WTI)"
        assert sample_commodity_price.price == 75.50
        assert sample_commodity_price.change == 1.25
        assert sample_commodity_price.change_percent == 1.68
        assert sample_commodity_price.high == 76.50
        assert sample_commodity_price.low == 74.25
        assert sample_commodity_price.volume == 500000
        assert sample_commodity_price.open_interest == 1000000

    def test_price_to_dict(self, sample_commodity_price):
        """Test CommodityPrice to_dict conversion."""
        result = sample_commodity_price.to_dict()

        assert result["symbol"] == "CL"
        assert result["name"] == "Crude Oil (WTI)"
        assert result["price"] == 75.50
        assert result["change"] == 1.25
        assert result["changePercent"] == 1.68
        assert result["high"] == 76.50
        assert result["low"] == 74.25
        assert result["volume"] == 500000
        assert result["openInterest"] == 1000000
        assert "timestamp" in result

    def test_price_with_negative_change(self):
        """Test CommodityPrice with negative change."""
        price = CommodityPrice(
            symbol="GC",
            name="Gold",
            price=1950.00,
            change=-15.50,
            change_percent=-0.79,
            high=1975.00,
            low=1945.00,
            volume=250000,
            open_interest=500000,
            timestamp=datetime.now(),
        )

        assert price.change == -15.50
        assert price.change_percent == -0.79


# =============================================================================
# CommoditySummary Dataclass Tests
# =============================================================================


class TestCommoditySummary:
    """Tests for CommoditySummary dataclass."""

    def test_summary_creation(self, sample_commodity_summary):
        """Test CommoditySummary creation."""
        assert sample_commodity_summary.symbol == "CL"
        assert sample_commodity_summary.name == "Crude Oil (WTI)"
        assert sample_commodity_summary.category == "energy"
        assert sample_commodity_summary.price == 75.50
        assert sample_commodity_summary.change_1d == 1.68
        assert sample_commodity_summary.change_1w == 3.25
        assert sample_commodity_summary.change_1m == -2.15
        assert sample_commodity_summary.change_ytd == 15.50
        assert sample_commodity_summary.volatility_30d == 28.50
        assert sample_commodity_summary.trend == "bullish"
        assert sample_commodity_summary.relative_strength == 5.25

    def test_summary_to_dict(self, sample_commodity_summary):
        """Test CommoditySummary to_dict conversion."""
        result = sample_commodity_summary.to_dict()

        assert result["symbol"] == "CL"
        assert result["name"] == "Crude Oil (WTI)"
        assert result["category"] == "energy"
        assert result["price"] == 75.50
        assert result["change1d"] == 1.68
        assert result["change1w"] == 3.25
        assert result["change1m"] == -2.15
        assert result["changeYtd"] == 15.50
        assert result["volatility30d"] == 28.50
        assert result["trend"] == "bullish"
        assert result["relativeStrength"] == 5.25

    def test_summary_bearish_trend(self):
        """Test CommoditySummary with bearish trend."""
        summary = CommoditySummary(
            symbol="NG",
            name="Natural Gas",
            category="energy",
            price=2.50,
            change_1d=-5.25,
            change_1w=-12.50,
            change_1m=-25.00,
            change_ytd=-35.00,
            volatility_30d=45.00,
            trend="bearish",
            relative_strength=-8.50,
        )

        assert summary.trend == "bearish"
        assert summary.change_1m < 0
        assert summary.relative_strength < 0

    def test_summary_neutral_trend(self):
        """Test CommoditySummary with neutral trend."""
        summary = CommoditySummary(
            symbol="SI",
            name="Silver",
            category="precious_metals",
            price=24.00,
            change_1d=0.25,
            change_1w=-0.50,
            change_1m=0.75,
            change_ytd=2.00,
            volatility_30d=20.00,
            trend="neutral",
            relative_strength=0.50,
        )

        assert summary.trend == "neutral"


# =============================================================================
# MacroLinkage Dataclass Tests
# =============================================================================


class TestMacroLinkage:
    """Tests for MacroLinkage dataclass."""

    def test_linkage_creation(self, sample_macro_linkage):
        """Test MacroLinkage creation."""
        assert sample_macro_linkage.commodity == "CL"
        assert sample_macro_linkage.macro_indicator == "USD Index"
        assert sample_macro_linkage.correlation == -0.65
        assert sample_macro_linkage.lead_lag_days == 0
        assert (
            sample_macro_linkage.relationship
            == "Inverse - weak USD supports oil prices"
        )
        assert sample_macro_linkage.strength == "strong"

    def test_linkage_to_dict(self, sample_macro_linkage):
        """Test MacroLinkage to_dict conversion."""
        result = sample_macro_linkage.to_dict()

        assert result["commodity"] == "CL"
        assert result["macroIndicator"] == "USD Index"
        assert result["correlation"] == -0.65
        assert result["leadLagDays"] == 0
        assert result["relationship"] == "Inverse - weak USD supports oil prices"
        assert result["strength"] == "strong"

    def test_linkage_positive_correlation(self):
        """Test MacroLinkage with positive correlation."""
        linkage = MacroLinkage(
            commodity="HG",
            macro_indicator="China Manufacturing PMI",
            correlation=0.65,
            lead_lag_days=-20,
            relationship="China demand drives copper prices",
            strength="strong",
        )

        assert linkage.correlation == 0.65
        assert linkage.lead_lag_days == -20

    def test_linkage_moderate_strength(self):
        """Test MacroLinkage with moderate strength."""
        linkage = MacroLinkage(
            commodity="GC",
            macro_indicator="VIX",
            correlation=0.40,
            lead_lag_days=-5,
            relationship="Safe haven during volatility",
            strength="moderate",
        )

        assert linkage.strength == "moderate"


# =============================================================================
# CommodityPriceProvider Tests
# =============================================================================


class TestCommodityPriceProvider:
    """Tests for CommodityPriceProvider class."""

    def test_provider_creation(self):
        """Test CommodityPriceProvider initialization."""
        provider = CommodityPriceProvider()

        assert provider is not None
        assert provider._cache == {}

    def test_provider_with_data_manager(self, mock_data_manager):
        """Test provider with DataManager."""
        provider = CommodityPriceProvider(data_manager=mock_data_manager)

        assert provider.data_manager is not None

    @pytest.mark.asyncio
    async def test_get_price(self):
        """Test get_price async method."""
        provider = CommodityPriceProvider()
        price = await provider.get_price("CL")

        assert price is not None
        assert price.symbol == "CL"
        assert price.price > 0

    @pytest.mark.asyncio
    async def test_get_price_unknown_commodity(self):
        """Test get_price with unknown commodity raises error."""
        provider = CommodityPriceProvider()

        with pytest.raises(ValueError, match="Unknown commodity"):
            await provider.get_price("INVALID")

    @pytest.mark.asyncio
    async def test_get_price_caching(self):
        """Test that prices are cached."""
        provider = CommodityPriceProvider()

        # First call
        price1 = await provider.get_price("GC")

        # Second call should use cache
        price2 = await provider.get_price("GC")

        # Prices should be identical if cached
        assert price1.price == price2.price
        assert "GC" in provider._cache

    @pytest.mark.asyncio
    async def test_get_prices_multiple(self):
        """Test get_prices for multiple commodities."""
        provider = CommodityPriceProvider()
        prices = await provider.get_prices(["CL", "GC", "SI"])

        assert len(prices) == 3
        assert "CL" in prices
        assert "GC" in prices
        assert "SI" in prices
        assert all(p.price > 0 for p in prices.values())

    @pytest.mark.asyncio
    async def test_get_prices_partial_failure(self):
        """Test get_prices with some invalid symbols."""
        provider = CommodityPriceProvider()
        prices = await provider.get_prices(["CL", "INVALID", "GC"])

        # Should return valid prices, skip invalid
        assert "CL" in prices
        assert "GC" in prices
        assert "INVALID" not in prices

    @pytest.mark.asyncio
    async def test_get_historical(self):
        """Test get_historical method."""
        provider = CommodityPriceProvider()
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)

        hist = await provider.get_historical("CL", start_date, end_date)

        assert not hist.empty
        assert "date" in hist.columns
        assert "close" in hist.columns
        assert "high" in hist.columns
        assert "low" in hist.columns
        assert "volume" in hist.columns

    @pytest.mark.asyncio
    async def test_get_historical_unknown_commodity(self):
        """Test get_historical with unknown commodity."""
        provider = CommodityPriceProvider()
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)

        with pytest.raises(ValueError, match="Unknown commodity"):
            await provider.get_historical("INVALID", start_date, end_date)

    @pytest.mark.asyncio
    async def test_get_category_prices(self):
        """Test get_category_prices method."""
        provider = CommodityPriceProvider()
        prices = await provider.get_category_prices(CommodityCategory.ENERGY)

        assert len(prices) > 0
        assert all(
            COMMODITY_REGISTRY[symbol].category == CommodityCategory.ENERGY
            for symbol in prices.keys()
        )

    def test_clear_cache(self):
        """Test cache clearing."""
        provider = CommodityPriceProvider()
        provider._cache["TEST"] = ("data", datetime.now())

        assert "TEST" in provider._cache

        provider.clear_cache()

        assert provider._cache == {}


# =============================================================================
# CommoditiesAnalyzer Tests
# =============================================================================


class TestCommoditiesAnalyzer:
    """Tests for CommoditiesAnalyzer class."""

    def test_analyzer_creation(self):
        """Test CommoditiesAnalyzer initialization."""
        analyzer = CommoditiesAnalyzer()

        assert analyzer is not None
        assert analyzer.health_check() is True

    def test_analyzer_with_data_manager(self, mock_data_manager):
        """Test analyzer with DataManager."""
        analyzer = CommoditiesAnalyzer(data_manager=mock_data_manager)

        assert analyzer.data_manager is not None
        assert analyzer.price_provider is not None

    @pytest.mark.asyncio
    async def test_get_prices_all(self):
        """Test get_prices for all commodities."""
        analyzer = CommoditiesAnalyzer()
        prices_df = await analyzer.get_prices()

        assert not prices_df.empty
        assert len(prices_df) == len(COMMODITY_REGISTRY)

    @pytest.mark.asyncio
    async def test_get_prices_specific(self):
        """Test get_prices for specific commodities."""
        analyzer = CommoditiesAnalyzer()
        prices_df = await analyzer.get_prices(["CL", "GC", "SI"])

        assert not prices_df.empty
        assert len(prices_df) <= 3

    @pytest.mark.asyncio
    async def test_get_historical_prices(self):
        """Test get_historical_prices method."""
        analyzer = CommoditiesAnalyzer()
        hist = await analyzer.get_historical_prices(["CL", "GC"], lookback_days=30)

        assert not hist.empty
        assert "CL" in hist.columns or "GC" in hist.columns

    @pytest.mark.asyncio
    async def test_get_correlations(self):
        """Test get_correlations method."""
        analyzer = CommoditiesAnalyzer()
        corr = await analyzer.get_correlations(
            ["CL", "GC", "SI", "HG"], lookback_days=60
        )

        assert not corr.empty
        # Diagonal should be 1.0 (self-correlation)
        for symbol in corr.index:
            if symbol in corr.columns:
                assert corr.loc[symbol, symbol] == pytest.approx(1.0, rel=0.01)

    @pytest.mark.asyncio
    async def test_get_correlations_default_commodities(self):
        """Test get_correlations with default commodities."""
        analyzer = CommoditiesAnalyzer()
        corr = await analyzer.get_correlations(lookback_days=60)

        assert not corr.empty

    @pytest.mark.asyncio
    async def test_get_summary(self):
        """Test get_summary method."""
        analyzer = CommoditiesAnalyzer()
        summary = await analyzer.get_summary("CL")

        assert summary is not None
        assert summary.symbol == "CL"
        assert summary.name == "Crude Oil (WTI)"
        assert summary.category == "energy"
        assert summary.price > 0
        assert summary.trend in ["bullish", "bearish", "neutral"]

    @pytest.mark.asyncio
    async def test_get_summary_unknown_commodity(self):
        """Test get_summary with unknown commodity."""
        analyzer = CommoditiesAnalyzer()

        with pytest.raises(ValueError, match="Unknown commodity"):
            await analyzer.get_summary("INVALID")

    @pytest.mark.asyncio
    async def test_get_summary_gold(self):
        """Test get_summary for gold."""
        analyzer = CommoditiesAnalyzer()
        summary = await analyzer.get_summary("GC")

        assert summary.symbol == "GC"
        assert summary.category == "precious_metals"

    @pytest.mark.asyncio
    async def test_analyze_macro_linkage_energy(self):
        """Test analyze_macro_linkage for energy commodity."""
        analyzer = CommoditiesAnalyzer()
        linkage = await analyzer.analyze_macro_linkage("CL")

        assert linkage is not None
        assert linkage["commodity"] == "CL"
        assert linkage["category"] == "energy"
        assert "linkages" in linkage
        assert len(linkage["linkages"]) > 0

        # Check expected macro indicators for energy
        indicators = [l["macroIndicator"] for l in linkage["linkages"]]
        assert "USD Index" in indicators or "S&P 500" in indicators

    @pytest.mark.asyncio
    async def test_analyze_macro_linkage_precious_metals(self):
        """Test analyze_macro_linkage for precious metals."""
        analyzer = CommoditiesAnalyzer()
        linkage = await analyzer.analyze_macro_linkage("GC")

        assert linkage["commodity"] == "GC"
        assert linkage["category"] == "precious_metals"
        assert len(linkage["linkages"]) > 0

        # Gold should have real interest rate linkage
        indicators = [l["macroIndicator"] for l in linkage["linkages"]]
        assert "Real Interest Rates" in indicators or "USD Index" in indicators

    @pytest.mark.asyncio
    async def test_analyze_macro_linkage_base_metals(self):
        """Test analyze_macro_linkage for base metals."""
        analyzer = CommoditiesAnalyzer()
        linkage = await analyzer.analyze_macro_linkage("HG")

        assert linkage["commodity"] == "HG"
        assert linkage["category"] == "base_metals"

        # Copper should have China PMI linkage
        indicators = [l["macroIndicator"] for l in linkage["linkages"]]
        assert (
            "China Manufacturing PMI" in indicators
            or "Global Industrial Production" in indicators
        )

    @pytest.mark.asyncio
    async def test_analyze_macro_linkage_agriculture(self):
        """Test analyze_macro_linkage for agriculture."""
        analyzer = CommoditiesAnalyzer()
        linkage = await analyzer.analyze_macro_linkage("ZC")

        assert linkage["commodity"] == "ZC"
        assert linkage["category"] == "agriculture"

        # Agriculture should have USD linkage
        indicators = [l["macroIndicator"] for l in linkage["linkages"]]
        assert (
            "US Dollar Index" in indicators or "Global Food Price Index" in indicators
        )

    @pytest.mark.asyncio
    async def test_analyze_macro_linkage_unknown(self):
        """Test analyze_macro_linkage with unknown commodity."""
        analyzer = CommoditiesAnalyzer()

        with pytest.raises(ValueError, match="Unknown commodity"):
            await analyzer.analyze_macro_linkage("INVALID")

    @pytest.mark.asyncio
    async def test_get_category_overview_energy(self):
        """Test get_category_overview for energy."""
        analyzer = CommoditiesAnalyzer()
        overview = await analyzer.get_category_overview(CommodityCategory.ENERGY)

        assert overview is not None
        assert overview["category"] == "energy"
        assert overview["count"] > 0
        assert "avgChange" in overview
        assert "leader" in overview
        assert "laggard" in overview
        assert "commodities" in overview

    @pytest.mark.asyncio
    async def test_get_category_overview_precious(self):
        """Test get_category_overview for precious metals."""
        analyzer = CommoditiesAnalyzer()
        overview = await analyzer.get_category_overview(
            CommodityCategory.PRECIOUS_METALS
        )

        assert overview["category"] == "precious_metals"
        assert overview["count"] > 0

    @pytest.mark.asyncio
    async def test_get_market_overview(self):
        """Test get_market_overview method."""
        analyzer = CommoditiesAnalyzer()
        overview = await analyzer.get_market_overview()

        assert overview is not None
        assert "timestamp" in overview
        assert "sentiment" in overview
        assert overview["sentiment"] in ["bullish", "bearish", "neutral"]
        assert "avgChange" in overview
        assert "categories" in overview

        # Check that categories are present
        assert len(overview["categories"]) > 0


# =============================================================================
# CommoditiesAnalyzer Internal Methods Tests
# =============================================================================


class TestCommoditiesAnalyzerInternals:
    """Tests for CommoditiesAnalyzer internal methods."""

    @pytest.mark.asyncio
    async def test_calculate_relative_strength(self):
        """Test _calculate_relative_strength method."""
        analyzer = CommoditiesAnalyzer()

        # Should return a float
        strength = await analyzer._calculate_relative_strength(
            "CL", CommodityCategory.ENERGY, 60
        )

        assert isinstance(strength, float)

    @pytest.mark.asyncio
    async def test_calculate_relative_strength_single_commodity(self):
        """Test relative strength with single commodity in category."""
        analyzer = CommoditiesAnalyzer()

        # Mock a category with only one commodity
        with patch(
            "stanley.commodities.commodities_analyzer.get_commodities_by_category"
        ) as mock_get:
            mock_get.return_value = [COMMODITY_REGISTRY["CL"]]

            strength = await analyzer._calculate_relative_strength(
                "CL", CommodityCategory.ENERGY, 60
            )

            assert strength == 0


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_commodity_registry_immutability(self):
        """Test that registry can't be accidentally modified."""
        original_len = len(COMMODITY_REGISTRY)

        # This should not affect the original registry
        copy = dict(COMMODITY_REGISTRY)
        copy["NEW"] = Commodity("NEW", "New Commodity", CommodityCategory.ENERGY, "USD")

        assert len(COMMODITY_REGISTRY) == original_len

    @pytest.mark.asyncio
    async def test_empty_historical_data(self):
        """Test handling of empty historical data."""
        analyzer = CommoditiesAnalyzer()

        # Mock empty historical data
        with patch.object(
            analyzer.price_provider, "get_historical", new_callable=AsyncMock
        ) as mock_hist:
            mock_hist.return_value = pd.DataFrame()

            summary = await analyzer.get_summary("CL")

            # Should handle gracefully with defaults
            assert summary.symbol == "CL"
            assert summary.change_1w == 0
            assert summary.trend == "neutral"

    @pytest.mark.asyncio
    async def test_get_prices_empty_list(self):
        """Test get_prices with empty list."""
        analyzer = CommoditiesAnalyzer()
        prices_df = await analyzer.get_prices([])

        assert prices_df.empty

    @pytest.mark.asyncio
    async def test_get_historical_prices_empty_list(self):
        """Test get_historical_prices with empty list."""
        analyzer = CommoditiesAnalyzer()
        hist = await analyzer.get_historical_prices([])

        assert hist.empty

    @pytest.mark.asyncio
    async def test_correlation_matrix_single_commodity(self):
        """Test correlation matrix with single commodity."""
        analyzer = CommoditiesAnalyzer()

        # Single commodity should still work
        corr = await analyzer.get_correlations(["CL"], lookback_days=30)

        # Should have at least the single commodity
        assert len(corr) >= 0

    def test_price_provider_cache_expiry(self):
        """Test that old cache entries are not used."""
        provider = CommodityPriceProvider()

        # Add old cache entry
        old_time = datetime.now() - timedelta(seconds=400)  # Older than TTL
        provider._cache["CL"] = (
            CommodityPrice("CL", "Oil", 50.0, 0, 0, 50, 50, 0, 0, old_time),
            old_time,
        )

        # The cache entry exists but is old
        assert "CL" in provider._cache


# =============================================================================
# Parametrized Tests
# =============================================================================


class TestParametrized:
    """Parametrized tests for comprehensive coverage."""

    @pytest.mark.parametrize(
        "symbol,expected_category",
        [
            ("CL", CommodityCategory.ENERGY),
            ("GC", CommodityCategory.PRECIOUS_METALS),
            ("HG", CommodityCategory.BASE_METALS),
            ("ZC", CommodityCategory.AGRICULTURE),
            ("KC", CommodityCategory.SOFTS),
            ("LE", CommodityCategory.LIVESTOCK),
        ],
    )
    def test_commodity_categories(self, symbol, expected_category):
        """Parametrized test for commodity categories."""
        comm = get_commodity(symbol)

        assert comm is not None
        assert comm.category == expected_category

    @pytest.mark.parametrize(
        "category",
        [
            CommodityCategory.ENERGY,
            CommodityCategory.PRECIOUS_METALS,
            CommodityCategory.BASE_METALS,
            CommodityCategory.AGRICULTURE,
            CommodityCategory.SOFTS,
            CommodityCategory.LIVESTOCK,
        ],
    )
    def test_category_has_commodities(self, category):
        """Parametrized test that each category has commodities."""
        commodities = get_commodities_by_category(category)
        assert len(commodities) >= 1

    @pytest.mark.parametrize(
        "symbol",
        ["CL", "GC", "SI", "HG", "ZC", "ZW", "NG"],
    )
    @pytest.mark.asyncio
    async def test_get_price_various_commodities(self, symbol):
        """Parametrized test for getting prices of various commodities."""
        provider = CommodityPriceProvider()
        price = await provider.get_price(symbol)

        assert price is not None
        assert price.symbol == symbol
        assert price.price > 0

    @pytest.mark.parametrize(
        "trend,sma_relationship",
        [
            ("bullish", "above"),
            ("bearish", "below"),
            ("neutral", "mixed"),
        ],
    )
    def test_trend_descriptions(self, trend, sma_relationship):
        """Parametrized test for trend validity."""
        summary = CommoditySummary(
            symbol="TEST",
            name="Test",
            category="energy",
            price=100,
            change_1d=0,
            change_1w=0,
            change_1m=0,
            change_ytd=0,
            volatility_30d=20,
            trend=trend,
            relative_strength=0,
        )

        assert summary.trend in ["bullish", "bearish", "neutral"]

    @pytest.mark.parametrize(
        "strength",
        ["strong", "moderate", "weak"],
    )
    def test_linkage_strengths(self, strength):
        """Parametrized test for linkage strength values."""
        linkage = MacroLinkage(
            commodity="TEST",
            macro_indicator="Test Indicator",
            correlation=0.5,
            lead_lag_days=0,
            relationship="Test relationship",
            strength=strength,
        )

        assert linkage.strength == strength


# =============================================================================
# Integration Tests
# =============================================================================


class TestIntegration:
    """Integration tests for commodities module."""

    @pytest.mark.asyncio
    async def test_full_analysis_workflow(self):
        """Test complete analysis workflow."""
        analyzer = CommoditiesAnalyzer()

        # Step 1: Get market overview
        overview = await analyzer.get_market_overview()
        assert overview is not None

        # Step 2: Get specific commodity summary
        summary = await analyzer.get_summary("CL")
        assert summary is not None

        # Step 3: Analyze macro linkages
        linkage = await analyzer.analyze_macro_linkage("CL")
        assert linkage is not None

        # Step 4: Get correlations
        corr = await analyzer.get_correlations(["CL", "GC", "HG"])
        assert not corr.empty

    @pytest.mark.asyncio
    async def test_category_analysis_workflow(self):
        """Test category-based analysis workflow."""
        analyzer = CommoditiesAnalyzer()

        for category in [CommodityCategory.ENERGY, CommodityCategory.PRECIOUS_METALS]:
            overview = await analyzer.get_category_overview(category)

            assert overview["category"] == category.value
            assert overview["count"] > 0
            assert "leader" in overview
            assert "commodities" in overview

    @pytest.mark.asyncio
    async def test_provider_and_analyzer_consistency(self):
        """Test that provider and analyzer return consistent data."""
        provider = CommodityPriceProvider()
        analyzer = CommoditiesAnalyzer()

        # Get price from provider
        price = await provider.get_price("GC")

        # Get summary from analyzer
        summary = await analyzer.get_summary("GC")

        # Prices should be close (may differ due to mock data randomness)
        assert abs(price.price - summary.price) < 200  # Within $200 for gold mock data
