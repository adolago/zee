"""
Commodity Price Data Module

Fetch and manage commodity price data from various sources.
Supports energy, metals, agriculture, and other commodities.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class CommodityCategory(Enum):
    """Categories of commodities."""

    ENERGY = "energy"
    PRECIOUS_METALS = "precious_metals"
    BASE_METALS = "base_metals"
    AGRICULTURE = "agriculture"
    SOFTS = "softs"
    LIVESTOCK = "livestock"


@dataclass
class Commodity:
    """Definition of a commodity."""

    symbol: str
    name: str
    category: CommodityCategory
    unit: str
    exchange: str = ""
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "name": self.name,
            "category": self.category.value,
            "unit": self.unit,
            "exchange": self.exchange,
            "description": self.description,
        }


# Registry of common commodities
COMMODITY_REGISTRY: Dict[str, Commodity] = {
    # Energy
    "CL": Commodity(
        "CL", "Crude Oil (WTI)", CommodityCategory.ENERGY, "USD/barrel", "NYMEX"
    ),
    "BZ": Commodity("BZ", "Brent Crude", CommodityCategory.ENERGY, "USD/barrel", "ICE"),
    "NG": Commodity(
        "NG", "Natural Gas", CommodityCategory.ENERGY, "USD/MMBtu", "NYMEX"
    ),
    "RB": Commodity(
        "RB", "RBOB Gasoline", CommodityCategory.ENERGY, "USD/gallon", "NYMEX"
    ),
    "HO": Commodity(
        "HO", "Heating Oil", CommodityCategory.ENERGY, "USD/gallon", "NYMEX"
    ),
    # Precious Metals
    "GC": Commodity("GC", "Gold", CommodityCategory.PRECIOUS_METALS, "USD/oz", "COMEX"),
    "SI": Commodity(
        "SI", "Silver", CommodityCategory.PRECIOUS_METALS, "USD/oz", "COMEX"
    ),
    "PL": Commodity(
        "PL", "Platinum", CommodityCategory.PRECIOUS_METALS, "USD/oz", "NYMEX"
    ),
    "PA": Commodity(
        "PA", "Palladium", CommodityCategory.PRECIOUS_METALS, "USD/oz", "NYMEX"
    ),
    # Base Metals
    "HG": Commodity("HG", "Copper", CommodityCategory.BASE_METALS, "USD/lb", "COMEX"),
    "ALI": Commodity("ALI", "Aluminum", CommodityCategory.BASE_METALS, "USD/mt", "LME"),
    "ZN": Commodity("ZN", "Zinc", CommodityCategory.BASE_METALS, "USD/mt", "LME"),
    "NI": Commodity("NI", "Nickel", CommodityCategory.BASE_METALS, "USD/mt", "LME"),
    # Agriculture
    "ZC": Commodity("ZC", "Corn", CommodityCategory.AGRICULTURE, "USc/bushel", "CBOT"),
    "ZW": Commodity("ZW", "Wheat", CommodityCategory.AGRICULTURE, "USc/bushel", "CBOT"),
    "ZS": Commodity(
        "ZS", "Soybeans", CommodityCategory.AGRICULTURE, "USc/bushel", "CBOT"
    ),
    "ZM": Commodity(
        "ZM", "Soybean Meal", CommodityCategory.AGRICULTURE, "USD/short ton", "CBOT"
    ),
    "ZL": Commodity(
        "ZL", "Soybean Oil", CommodityCategory.AGRICULTURE, "USc/lb", "CBOT"
    ),
    # Softs
    "KC": Commodity("KC", "Coffee", CommodityCategory.SOFTS, "USc/lb", "ICE"),
    "SB": Commodity("SB", "Sugar #11", CommodityCategory.SOFTS, "USc/lb", "ICE"),
    "CC": Commodity("CC", "Cocoa", CommodityCategory.SOFTS, "USD/mt", "ICE"),
    "CT": Commodity("CT", "Cotton", CommodityCategory.SOFTS, "USc/lb", "ICE"),
    # Livestock
    "LE": Commodity("LE", "Live Cattle", CommodityCategory.LIVESTOCK, "USc/lb", "CME"),
    "HE": Commodity("HE", "Lean Hogs", CommodityCategory.LIVESTOCK, "USc/lb", "CME"),
    "GF": Commodity(
        "GF", "Feeder Cattle", CommodityCategory.LIVESTOCK, "USc/lb", "CME"
    ),
}


@dataclass
class CommodityPrice:
    """Price data for a commodity."""

    symbol: str
    name: str
    price: float
    change: float
    change_percent: float
    high: float
    low: float
    volume: int
    open_interest: int
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "name": self.name,
            "price": self.price,
            "change": self.change,
            "changePercent": self.change_percent,
            "high": self.high,
            "low": self.low,
            "volume": self.volume,
            "openInterest": self.open_interest,
            "timestamp": self.timestamp.isoformat(),
        }


def get_commodity(symbol: str) -> Optional[Commodity]:
    """Get commodity by symbol."""
    return COMMODITY_REGISTRY.get(symbol.upper())


def get_commodities_by_category(category: CommodityCategory) -> List[Commodity]:
    """Get all commodities in a category."""
    return [c for c in COMMODITY_REGISTRY.values() if c.category == category]


def list_all_commodities() -> List[str]:
    """List all commodity symbols."""
    return list(COMMODITY_REGISTRY.keys())


class CommodityPriceProvider:
    """
    Provider for commodity price data.

    Fetches real-time and historical commodity prices.
    """

    def __init__(self, data_manager=None):
        """
        Initialize price provider.

        Args:
            data_manager: DataManager for data access
        """
        self.data_manager = data_manager
        self._cache: Dict[str, tuple] = {}  # symbol -> (data, timestamp)
        self._cache_ttl = 300  # 5 minutes
        logger.info("CommodityPriceProvider initialized")

    async def get_price(self, symbol: str) -> CommodityPrice:
        """
        Get current price for a commodity.

        Args:
            symbol: Commodity symbol

        Returns:
            CommodityPrice with current data
        """
        commodity = get_commodity(symbol)
        if not commodity:
            raise ValueError(f"Unknown commodity: {symbol}")

        # Check cache
        if symbol in self._cache:
            data, ts = self._cache[symbol]
            if (datetime.now() - ts).seconds < self._cache_ttl:
                return data

        # Fetch new data
        price_data = await self._fetch_price(symbol)

        # Cache result
        self._cache[symbol] = (price_data, datetime.now())

        return price_data

    async def get_prices(self, symbols: List[str]) -> Dict[str, CommodityPrice]:
        """
        Get prices for multiple commodities.

        Args:
            symbols: List of commodity symbols

        Returns:
            Dict mapping symbol to CommodityPrice
        """
        results = {}
        for symbol in symbols:
            try:
                results[symbol] = await self.get_price(symbol)
            except Exception as e:
                logger.warning(f"Failed to get price for {symbol}: {e}")
        return results

    async def get_historical(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """
        Get historical price data.

        Args:
            symbol: Commodity symbol
            start_date: Start date
            end_date: End date

        Returns:
            DataFrame with OHLCV data
        """
        commodity = get_commodity(symbol)
        if not commodity:
            raise ValueError(f"Unknown commodity: {symbol}")

        # Generate mock historical data
        dates = pd.date_range(start=start_date, end=end_date, freq="D")

        # Simulate realistic price movement
        base_prices = {
            "CL": 75.0,
            "BZ": 80.0,
            "NG": 2.5,
            "GC": 1950.0,
            "SI": 24.0,
            "HG": 3.8,
            "ZC": 450.0,
            "ZW": 600.0,
            "ZS": 1200.0,
        }

        base_price = base_prices.get(symbol, 100.0)

        # Generate random walk
        prices = [base_price]
        for _ in range(len(dates) - 1):
            daily_return = np.random.normal(0.0002, 0.02)
            prices.append(prices[-1] * (1 + daily_return))

        prices = np.array(prices)
        high = prices * (1 + np.random.uniform(0, 0.02, len(dates)))
        low = prices * (1 - np.random.uniform(0, 0.02, len(dates)))
        open_prices = prices * (1 + np.random.uniform(-0.01, 0.01, len(dates)))
        volume = np.random.randint(10000, 500000, len(dates))

        return pd.DataFrame(
            {
                "date": dates,
                "open": open_prices,
                "high": high,
                "low": low,
                "close": prices,
                "volume": volume,
            }
        )

    async def get_category_prices(
        self,
        category: CommodityCategory,
    ) -> Dict[str, CommodityPrice]:
        """
        Get prices for all commodities in a category.

        Args:
            category: Commodity category

        Returns:
            Dict mapping symbol to CommodityPrice
        """
        commodities = get_commodities_by_category(category)
        return await self.get_prices([c.symbol for c in commodities])

    async def _fetch_price(self, symbol: str) -> CommodityPrice:
        """Fetch price from data source."""
        commodity = get_commodity(symbol)

        # Mock price data
        base_prices = {
            "CL": 75.0,
            "BZ": 80.0,
            "NG": 2.5,
            "GC": 1950.0,
            "SI": 24.0,
            "HG": 3.8,
            "ZC": 450.0,
            "ZW": 600.0,
            "ZS": 1200.0,
            "PL": 950.0,
            "PA": 1100.0,
            "KC": 180.0,
            "SB": 22.0,
        }

        base = base_prices.get(symbol, 100.0)
        price = base * (1 + np.random.uniform(-0.03, 0.03))
        change = np.random.uniform(-2, 2)
        change_pct = (change / base) * 100

        return CommodityPrice(
            symbol=symbol,
            name=commodity.name if commodity else symbol,
            price=round(price, 2),
            change=round(change, 2),
            change_percent=round(change_pct, 2),
            high=round(price * 1.02, 2),
            low=round(price * 0.98, 2),
            volume=np.random.randint(50000, 500000),
            open_interest=np.random.randint(100000, 1000000),
            timestamp=datetime.now(),
        )

    def clear_cache(self) -> None:
        """Clear price cache."""
        self._cache.clear()
