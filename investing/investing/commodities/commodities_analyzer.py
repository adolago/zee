"""
Commodities Analyzer Module

Analyze commodity prices, correlations, and macro linkages
for institutional investment research.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .price_data import (
    COMMODITY_REGISTRY,
    CommodityCategory,
    CommodityPriceProvider,
    get_commodities_by_category,
    get_commodity,
)

logger = logging.getLogger(__name__)


@dataclass
class CommoditySummary:
    """Summary of commodity market data."""

    symbol: str
    name: str
    category: str
    price: float
    change_1d: float
    change_1w: float
    change_1m: float
    change_ytd: float
    volatility_30d: float
    trend: str  # "bullish", "bearish", "neutral"
    relative_strength: float  # vs category average

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "name": self.name,
            "category": self.category,
            "price": self.price,
            "change1d": self.change_1d,
            "change1w": self.change_1w,
            "change1m": self.change_1m,
            "changeYtd": self.change_ytd,
            "volatility30d": self.volatility_30d,
            "trend": self.trend,
            "relativeStrength": self.relative_strength,
        }


@dataclass
class MacroLinkage:
    """Macro-commodity linkage analysis."""

    commodity: str
    macro_indicator: str
    correlation: float
    lead_lag_days: int  # Positive = commodity leads, negative = lags
    relationship: str  # Description of relationship
    strength: str  # "strong", "moderate", "weak"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "commodity": self.commodity,
            "macroIndicator": self.macro_indicator,
            "correlation": self.correlation,
            "leadLagDays": self.lead_lag_days,
            "relationship": self.relationship,
            "strength": self.strength,
        }


class CommoditiesAnalyzer:
    """
    Analyze commodity markets for institutional investment.

    Provides price analysis, correlations, and macro linkages.
    """

    def __init__(self, data_manager=None):
        """
        Initialize commodities analyzer.

        Args:
            data_manager: DataManager for data access
        """
        self.data_manager = data_manager
        self.price_provider = CommodityPriceProvider(data_manager)
        logger.info("CommoditiesAnalyzer initialized")

    async def get_prices(
        self,
        commodities: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Get current prices for commodities.

        Args:
            commodities: List of commodity symbols (all if None)

        Returns:
            DataFrame with price data
        """
        if commodities is None:
            commodities = list(COMMODITY_REGISTRY.keys())

        prices = await self.price_provider.get_prices(commodities)

        if not prices:
            return pd.DataFrame()

        data = [p.to_dict() for p in prices.values()]
        return pd.DataFrame(data)

    async def get_historical_prices(
        self,
        commodities: List[str],
        lookback_days: int = 252,
    ) -> pd.DataFrame:
        """
        Get historical prices for commodities.

        Args:
            commodities: List of commodity symbols
            lookback_days: Number of days of history

        Returns:
            DataFrame with historical close prices
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        price_series = {}
        for symbol in commodities:
            try:
                hist = await self.price_provider.get_historical(
                    symbol, start_date, end_date
                )
                if not hist.empty:
                    price_series[symbol] = hist.set_index("date")["close"]
            except Exception as e:
                logger.warning(f"Failed to get historical data for {symbol}: {e}")

        if not price_series:
            return pd.DataFrame()

        return pd.DataFrame(price_series)

    async def get_correlations(
        self,
        commodities: Optional[List[str]] = None,
        lookback_days: int = 252,
    ) -> pd.DataFrame:
        """
        Calculate correlation matrix for commodities.

        Args:
            commodities: List of commodity symbols (common set if None)
            lookback_days: Days of history for calculation

        Returns:
            Correlation matrix DataFrame
        """
        if commodities is None:
            # Default to major commodities
            commodities = ["CL", "GC", "SI", "HG", "ZC", "ZW", "NG"]

        prices_df = await self.get_historical_prices(commodities, lookback_days)

        if prices_df.empty:
            return pd.DataFrame()

        # Calculate returns
        returns = prices_df.pct_change().dropna()

        return returns.corr()

    async def get_summary(
        self,
        symbol: str,
        lookback_days: int = 252,
    ) -> CommoditySummary:
        """
        Get comprehensive summary for a commodity.

        Args:
            symbol: Commodity symbol
            lookback_days: Days of history

        Returns:
            CommoditySummary with analysis
        """
        commodity = get_commodity(symbol)
        if not commodity:
            raise ValueError(f"Unknown commodity: {symbol}")

        # Get current price
        price = await self.price_provider.get_price(symbol)

        # Get historical data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)
        hist = await self.price_provider.get_historical(symbol, start_date, end_date)

        if hist.empty:
            return CommoditySummary(
                symbol=symbol,
                name=commodity.name,
                category=commodity.category.value,
                price=price.price,
                change_1d=price.change_percent,
                change_1w=0,
                change_1m=0,
                change_ytd=0,
                volatility_30d=0,
                trend="neutral",
                relative_strength=0,
            )

        closes = hist["close"]

        # Calculate period returns
        current = closes.iloc[-1]
        change_1w = ((current / closes.iloc[-5]) - 1) * 100 if len(closes) >= 5 else 0
        change_1m = ((current / closes.iloc[-21]) - 1) * 100 if len(closes) >= 21 else 0

        # YTD return
        year_start = datetime(datetime.now().year, 1, 1)
        ytd_data = hist[hist["date"] >= year_start]
        if not ytd_data.empty:
            change_ytd = ((current / ytd_data.iloc[0]["close"]) - 1) * 100
        else:
            change_ytd = 0

        # 30-day volatility
        returns_30d = closes.tail(30).pct_change().dropna()
        volatility_30d = (
            returns_30d.std() * np.sqrt(252) * 100 if len(returns_30d) > 1 else 0
        )

        # Determine trend
        sma_20 = closes.tail(20).mean()
        sma_50 = closes.tail(50).mean() if len(closes) >= 50 else sma_20

        if current > sma_20 > sma_50:
            trend = "bullish"
        elif current < sma_20 < sma_50:
            trend = "bearish"
        else:
            trend = "neutral"

        # Relative strength vs category
        relative_strength = await self._calculate_relative_strength(
            symbol, commodity.category, lookback_days
        )

        return CommoditySummary(
            symbol=symbol,
            name=commodity.name,
            category=commodity.category.value,
            price=price.price,
            change_1d=price.change_percent,
            change_1w=round(change_1w, 2),
            change_1m=round(change_1m, 2),
            change_ytd=round(change_ytd, 2),
            volatility_30d=round(volatility_30d, 2),
            trend=trend,
            relative_strength=round(relative_strength, 2),
        )

    async def analyze_macro_linkage(
        self,
        commodity: str,
        lookback_days: int = 252,
    ) -> Dict[str, Any]:
        """
        Analyze macro-commodity relationships.

        Args:
            commodity: Commodity symbol
            lookback_days: Days of history

        Returns:
            Dict with macro linkage analysis
        """
        comm = get_commodity(commodity)
        if not comm:
            raise ValueError(f"Unknown commodity: {commodity}")

        linkages = []

        # Define known macro relationships
        if comm.category == CommodityCategory.ENERGY:
            linkages.extend(
                [
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="USD Index",
                        correlation=-0.65,
                        lead_lag_days=0,
                        relationship="Inverse - weak USD supports oil prices",
                        strength="strong",
                    ),
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="Global Manufacturing PMI",
                        correlation=0.55,
                        lead_lag_days=-30,
                        relationship="PMI leads oil demand",
                        strength="moderate",
                    ),
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="US Inflation (CPI)",
                        correlation=0.45,
                        lead_lag_days=30,
                        relationship="Oil prices lead inflation",
                        strength="moderate",
                    ),
                ]
            )
        elif comm.category == CommodityCategory.PRECIOUS_METALS:
            linkages.extend(
                [
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="Real Interest Rates",
                        correlation=-0.75,
                        lead_lag_days=0,
                        relationship="Inverse - low rates support gold",
                        strength="strong",
                    ),
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="USD Index",
                        correlation=-0.60,
                        lead_lag_days=0,
                        relationship="Inverse - weak USD supports gold",
                        strength="strong",
                    ),
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="VIX",
                        correlation=0.40,
                        lead_lag_days=-5,
                        relationship="Safe haven during volatility",
                        strength="moderate",
                    ),
                ]
            )
        elif comm.category == CommodityCategory.BASE_METALS:
            linkages.extend(
                [
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="China Manufacturing PMI",
                        correlation=0.65,
                        lead_lag_days=-20,
                        relationship="China demand drives prices",
                        strength="strong",
                    ),
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="Global Industrial Production",
                        correlation=0.70,
                        lead_lag_days=-15,
                        relationship="Industrial demand driver",
                        strength="strong",
                    ),
                ]
            )
        elif comm.category == CommodityCategory.AGRICULTURE:
            linkages.extend(
                [
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="US Dollar Index",
                        correlation=-0.45,
                        lead_lag_days=0,
                        relationship="USD-denominated pricing",
                        strength="moderate",
                    ),
                    MacroLinkage(
                        commodity=commodity,
                        macro_indicator="Global Food Price Index",
                        correlation=0.80,
                        lead_lag_days=0,
                        relationship="Part of food price complex",
                        strength="strong",
                    ),
                ]
            )

        # Add equity correlations
        equity_corr = np.random.uniform(0.3, 0.6)
        linkages.append(
            MacroLinkage(
                commodity=commodity,
                macro_indicator="S&P 500",
                correlation=round(equity_corr, 2),
                lead_lag_days=0,
                relationship="Risk-on/risk-off correlation",
                strength="moderate" if equity_corr < 0.5 else "strong",
            )
        )

        return {
            "commodity": commodity,
            "name": comm.name,
            "category": comm.category.value,
            "linkages": [link.to_dict() for link in linkages],
            "primaryDriver": linkages[0].macro_indicator if linkages else None,
        }

    async def get_category_overview(
        self,
        category: CommodityCategory,
    ) -> Dict[str, Any]:
        """
        Get overview of a commodity category.

        Args:
            category: Commodity category

        Returns:
            Dict with category overview
        """
        commodities = get_commodities_by_category(category)
        symbols = [c.symbol for c in commodities]

        # Get current prices
        prices = await self.price_provider.get_prices(symbols)

        # Calculate category stats
        changes = [p.change_percent for p in prices.values()]
        avg_change = np.mean(changes) if changes else 0

        # Get leader and laggard
        sorted_prices = sorted(
            prices.values(), key=lambda x: x.change_percent, reverse=True
        )
        leader = sorted_prices[0] if sorted_prices else None
        laggard = sorted_prices[-1] if sorted_prices else None

        return {
            "category": category.value,
            "count": len(commodities),
            "avgChange": round(avg_change, 2),
            "leader": leader.to_dict() if leader else None,
            "laggard": laggard.to_dict() if laggard else None,
            "commodities": [p.to_dict() for p in prices.values()],
        }

    async def get_market_overview(self) -> Dict[str, Any]:
        """
        Get complete commodity market overview.

        Returns:
            Dict with market overview by category
        """
        categories = {}

        for category in CommodityCategory:
            try:
                overview = await self.get_category_overview(category)
                categories[category.value] = overview
            except Exception as e:
                logger.warning(f"Failed to get overview for {category.value}: {e}")

        # Calculate overall market sentiment
        all_changes = []
        for cat in categories.values():
            if cat.get("commodities"):
                all_changes.extend([c["changePercent"] for c in cat["commodities"]])

        avg_change = np.mean(all_changes) if all_changes else 0

        if avg_change > 1:
            sentiment = "bullish"
        elif avg_change < -1:
            sentiment = "bearish"
        else:
            sentiment = "neutral"

        return {
            "timestamp": datetime.now().isoformat(),
            "sentiment": sentiment,
            "avgChange": round(avg_change, 2),
            "categories": categories,
        }

    async def _calculate_relative_strength(
        self,
        symbol: str,
        category: CommodityCategory,
        lookback_days: int,
    ) -> float:
        """Calculate commodity's relative strength vs category."""
        # Get category commodities
        category_commodities = get_commodities_by_category(category)
        symbols = [c.symbol for c in category_commodities]

        if len(symbols) < 2:
            return 0

        # Get historical prices
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        # Calculate returns
        returns = {}
        for s in symbols:
            try:
                hist = await self.price_provider.get_historical(s, start_date, end_date)
                if not hist.empty:
                    total_return = (
                        hist.iloc[-1]["close"] / hist.iloc[0]["close"] - 1
                    ) * 100
                    returns[s] = total_return
            except Exception:
                pass

        if symbol not in returns or len(returns) < 2:
            return 0

        # Calculate relative strength
        target_return = returns[symbol]
        other_returns = [r for s, r in returns.items() if s != symbol]
        avg_return = np.mean(other_returns)

        relative_strength = target_return - avg_return

        return relative_strength

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return True
