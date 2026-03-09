"""
OpenBB Adapter Module

High-level adapter providing a simplified interface to OpenBB SDK.
Handles configuration, provider selection, and data transformation.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pandas as pd

from .providers import OpenBBProvider

logger = logging.getLogger(__name__)


class OpenBBAdapter:
    """
    High-level adapter for OpenBB SDK.

    Provides a simplified interface for common data fetching operations,
    handles provider fallbacks, and standardizes output formats.
    """

    # Mapping of data types to preferred providers
    DEFAULT_PROVIDERS = {
        "stock_data": "yfinance",
        "fundamentals": "fmp",
        "institutional": "fmp",
        "insider": "fmp",
        "options": "intrinio",
        "economic": "fred",
        "etf": "fmp",
        "short_interest": "stockgrid",
    }

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        api_key: Optional[str] = None,
    ):
        """
        Initialize the OpenBB adapter.

        Args:
            config: Configuration dictionary (from investing.yaml)
            api_key: OpenBB API key (overrides config)
        """
        self._config = config or {}

        # Extract OpenBB config
        openbb_config = self._config.get("openbb", {})

        self._provider = OpenBBProvider(
            api_key=api_key or openbb_config.get("api_key"),
            max_retries=openbb_config.get("max_retries", 3),
            timeout=openbb_config.get("timeout", 30),
            requests_per_second=openbb_config.get("rate_limit", 5.0),
            cache_ttl_seconds=openbb_config.get("cache_ttl", 300),
        )

        self._initialized = False

    async def initialize(self) -> None:
        """Initialize the adapter and underlying provider."""
        if not self._initialized:
            await self._provider.initialize()
            self._initialized = True

    async def close(self) -> None:
        """Close the adapter and cleanup resources."""
        await self._provider.close()
        self._initialized = False

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    # ========================================================================
    # Stock Price Data
    # ========================================================================

    async def get_historical_prices(
        self,
        symbol: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        lookback_days: int = 252,
    ) -> pd.DataFrame:
        """
        Get historical stock prices.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date (optional, uses lookback if not provided)
            end_date: End date (default: today)
            lookback_days: Days to look back if start_date not provided

        Returns:
            DataFrame with OHLCV data
        """
        await self.initialize()

        end_date = end_date or datetime.now()
        start_date = start_date or (end_date - timedelta(days=lookback_days))

        return await self._provider.get_stock_data(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
        )

    async def get_multiple_prices(
        self,
        symbols: List[str],
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        lookback_days: int = 252,
    ) -> Dict[str, pd.DataFrame]:
        """
        Get historical prices for multiple symbols.

        Args:
            symbols: List of stock ticker symbols
            start_date: Start date
            end_date: End date
            lookback_days: Days to look back if start_date not provided

        Returns:
            Dictionary mapping symbols to DataFrames
        """
        import asyncio

        await self.initialize()

        end_date = end_date or datetime.now()
        start_date = start_date or (end_date - timedelta(days=lookback_days))

        async def fetch_one(sym: str) -> tuple:
            try:
                df = await self._provider.get_stock_data(
                    symbol=sym,
                    start_date=start_date,
                    end_date=end_date,
                )
                return sym, df
            except Exception as e:
                logger.warning(f"Failed to fetch {sym}: {e}")
                return sym, pd.DataFrame()

        results = await asyncio.gather(*[fetch_one(s) for s in symbols])
        return {sym: df for sym, df in results}

    # ========================================================================
    # Institutional Data
    # ========================================================================

    async def get_institutional_holders(
        self,
        symbol: str,
        min_value: Optional[float] = None,
    ) -> pd.DataFrame:
        """
        Get institutional holders for a stock.

        Args:
            symbol: Stock ticker symbol
            min_value: Minimum holding value to include

        Returns:
            DataFrame with institutional holders
        """
        await self.initialize()

        df = await self._provider.get_institutional_holdings(symbol)

        if min_value and "value_held" in df.columns:
            df = df[df["value_held"] >= min_value]

        return df

    async def get_institutional_summary(
        self,
        symbol: str,
    ) -> Dict[str, Any]:
        """
        Get institutional ownership summary.

        Args:
            symbol: Stock ticker symbol

        Returns:
            Dictionary with summary statistics
        """
        await self.initialize()

        df = await self._provider.get_institutional_holdings(symbol)

        summary = {
            "symbol": symbol,
            "total_institutions": len(df),
            "total_shares_held": (
                df["shares_held"].sum() if "shares_held" in df.columns else None
            ),
            "total_value_held": (
                df["value_held"].sum() if "value_held" in df.columns else None
            ),
            "top_holders": [],
        }

        # Get top 5 holders
        if "shares_held" in df.columns:
            top = df.nlargest(5, "shares_held")
            for _, row in top.iterrows():
                holder = {
                    "name": row.get("manager_name", "Unknown"),
                    "shares": row.get("shares_held", 0),
                    "value": row.get("value_held", 0),
                }
                summary["top_holders"].append(holder)

        return summary

    # ========================================================================
    # Insider Trading
    # ========================================================================

    async def get_insider_activity(
        self,
        symbol: str,
        lookback_days: int = 90,
        transaction_type: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get insider trading activity.

        Args:
            symbol: Stock ticker symbol
            lookback_days: Number of days to look back
            transaction_type: Filter by transaction type ('buy', 'sell', or None for all)

        Returns:
            DataFrame with insider transactions
        """
        await self.initialize()

        df = await self._provider.get_insider_transactions(symbol)

        # Filter by date if possible
        if "date" in df.columns:
            cutoff = datetime.now() - timedelta(days=lookback_days)
            if not pd.api.types.is_datetime64_any_dtype(df["date"]):
                df["date"] = pd.to_datetime(df["date"])
            df = df[df["date"] >= cutoff]

        # Filter by transaction type
        if transaction_type and "transaction_type" in df.columns:
            type_lower = transaction_type.lower()
            df = df[df["transaction_type"].str.lower().str.contains(type_lower)]

        return df

    async def get_insider_summary(
        self,
        symbol: str,
        lookback_days: int = 90,
    ) -> Dict[str, Any]:
        """
        Get insider trading summary.

        Args:
            symbol: Stock ticker symbol
            lookback_days: Number of days to look back

        Returns:
            Dictionary with summary statistics
        """
        await self.initialize()

        df = await self.get_insider_activity(symbol, lookback_days)

        summary = {
            "symbol": symbol,
            "lookback_days": lookback_days,
            "total_transactions": len(df),
            "buy_transactions": 0,
            "sell_transactions": 0,
            "net_shares": 0,
            "net_value": 0,
        }

        if "transaction_type" in df.columns:
            # Optimization: Calculate lower case series once
            trans_types = df["transaction_type"].str.lower()

            buys = df[trans_types.str.contains("buy|purchase", na=False)]
            sells = df[trans_types.str.contains("sell|sale", na=False)]

            summary["buy_transactions"] = len(buys)
            summary["sell_transactions"] = len(sells)

            if "shares" in df.columns:
                buy_shares = buys["shares"].sum() if len(buys) > 0 else 0
                sell_shares = sells["shares"].sum() if len(sells) > 0 else 0
                summary["net_shares"] = buy_shares - sell_shares

            if "value" in df.columns:
                buy_value = buys["value"].sum() if len(buys) > 0 else 0
                sell_value = sells["value"].sum() if len(sells) > 0 else 0
                summary["net_value"] = buy_value - sell_value

        return summary

    # ========================================================================
    # Options Data
    # ========================================================================

    async def get_options_chain(
        self,
        symbol: str,
        expiration: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get options chain for a symbol.

        Args:
            symbol: Stock ticker symbol
            expiration: Specific expiration date (YYYY-MM-DD)

        Returns:
            DataFrame with options chain
        """
        await self.initialize()

        kwargs = {}
        if expiration:
            kwargs["expiration"] = expiration

        return await self._provider.get_options_chain(symbol, **kwargs)

    async def get_unusual_options_activity(
        self,
        symbol: str,
        volume_threshold: float = 2.0,
    ) -> pd.DataFrame:
        """
        Get unusual options activity.

        Args:
            symbol: Stock ticker symbol
            volume_threshold: Minimum ratio of volume to open interest

        Returns:
            DataFrame with unusual options activity
        """
        await self.initialize()

        df = await self._provider.get_options_chain(symbol)

        # Filter for unusual activity
        if "volume" in df.columns and "openInterest" in df.columns:
            df["vol_oi_ratio"] = df["volume"] / df["openInterest"].replace(0, 1)
            df = df[df["vol_oi_ratio"] >= volume_threshold]

        return df

    # ========================================================================
    # Fundamentals
    # ========================================================================

    async def get_company_overview(
        self,
        symbol: str,
    ) -> Dict[str, Any]:
        """
        Get company fundamental overview.

        Args:
            symbol: Stock ticker symbol

        Returns:
            Dictionary with fundamental metrics
        """
        await self.initialize()

        return await self._provider.get_fundamentals(symbol)

    # ========================================================================
    # ETF Data
    # ========================================================================

    async def get_etf_holdings(
        self,
        symbol: str,
        top_n: Optional[int] = None,
    ) -> pd.DataFrame:
        """
        Get ETF holdings.

        Args:
            symbol: ETF ticker symbol
            top_n: Return only top N holdings by weight

        Returns:
            DataFrame with ETF holdings
        """
        await self.initialize()

        df = await self._provider.get_etf_holdings(symbol)

        if top_n and "weight" in df.columns:
            df = df.nlargest(top_n, "weight")

        return df

    # ========================================================================
    # Economic Data
    # ========================================================================

    async def get_economic_data(
        self,
        indicator: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        lookback_years: int = 5,
    ) -> pd.DataFrame:
        """
        Get economic indicator data.

        Args:
            indicator: Economic indicator name (e.g., 'gdp', 'unemployment', 'cpi')
            start_date: Start date
            end_date: End date
            lookback_years: Years to look back if start_date not provided

        Returns:
            DataFrame with indicator data
        """
        await self.initialize()

        end_date = end_date or datetime.now()
        start_date = start_date or (end_date - timedelta(days=lookback_years * 365))

        return await self._provider.get_economic_indicator(
            indicator=indicator,
            start_date=start_date,
            end_date=end_date,
        )

    # ========================================================================
    # Short Interest
    # ========================================================================

    async def get_short_interest(
        self,
        symbol: str,
    ) -> pd.DataFrame:
        """
        Get short interest data.

        Args:
            symbol: Stock ticker symbol

        Returns:
            DataFrame with short interest data
        """
        await self.initialize()

        return await self._provider.get_short_interest(symbol)

    # ========================================================================
    # Search
    # ========================================================================

    async def search_symbols(
        self,
        query: str,
    ) -> pd.DataFrame:
        """
        Search for stock symbols.

        Args:
            query: Search query

        Returns:
            DataFrame with matching symbols
        """
        await self.initialize()

        return await self._provider.search_symbols(query)

    # ========================================================================
    # Utility Methods
    # ========================================================================

    async def health_check(self) -> bool:
        """Check if the adapter is operational."""
        await self.initialize()
        return await self._provider.health_check()

    def clear_cache(self) -> None:
        """Clear all cached data."""
        self._provider._clear_cache()
