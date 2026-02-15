"""
Data Management Module

Handle data sources, caching, and data quality for Stanley.
Integrates with OpenBB, SEC filings, and other institutional data sources.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .openbb_adapter import OpenBBAdapter
from .providers import DataProviderError

logger = logging.getLogger(__name__)


class DataManager:
    """
    Manage data sources and caching for Stanley.

    Uses OpenBB as the primary data provider with fallback to mock data
    when real data is unavailable or for testing.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None, use_mock: bool = False):
        """
        Initialize data manager with configuration.

        Args:
            config: Stanley configuration dictionary
            use_mock: If True, use mock data instead of real data providers
        """
        self.config = config or {}
        self._use_mock = use_mock
        self._adapter: Optional[OpenBBAdapter] = None
        self._initialized = False

        logger.info("DataManager initialized (mock=%s)", use_mock)

    async def initialize(self) -> None:
        """Initialize the data manager and underlying providers."""
        if self._initialized:
            return

        if not self._use_mock:
            try:
                self._adapter = OpenBBAdapter(config=self.config)
                await self._adapter.initialize()
                self._initialized = True
                logger.info("DataManager initialized with OpenBB provider")
            except Exception as e:
                logger.warning(
                    f"Failed to initialize OpenBB provider, falling back to mock: {e}"
                )
                self._use_mock = True
                self._initialized = True
        else:
            self._initialized = True

    async def close(self) -> None:
        """Close the data manager and cleanup resources."""
        if self._adapter:
            await self._adapter.close()
            self._adapter = None
        self._initialized = False

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    async def get_stock_data(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """
        Get stock price and volume data.

        Args:
            symbol: Stock symbol
            start_date: Start date for data
            end_date: End date for data

        Returns:
            DataFrame with stock data (columns: date, open, high, low, close, volume)
        """
        await self.initialize()

        if self._adapter and not self._use_mock:
            try:
                return await self._adapter.get_historical_prices(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                )
            except DataProviderError as e:
                logger.warning(f"Real data fetch failed for {symbol}, using mock: {e}")

        # Fallback to mock data
        return await self._fetch_stock_data_mock(symbol, start_date, end_date)

    async def get_etf_flows(
        self,
        etf_symbol: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """
        Get ETF flow data (creations/redemptions).

        Args:
            etf_symbol: ETF symbol
            start_date: Start date for data
            end_date: End date for data

        Returns:
            DataFrame with ETF flow data
        """
        await self.initialize()

        # Note: ETF flows require specialized data sources
        # OpenBB doesn't directly provide flow data, so we use ETF holdings + price data
        if self._adapter and not self._use_mock:
            try:
                # Get ETF holdings as a proxy for understanding ETF composition
                holdings = await self._adapter.get_etf_holdings(etf_symbol)
                # For actual flows, we'd need a specialized provider
                # Returning holdings data for now
                return holdings
            except DataProviderError as e:
                logger.warning(
                    f"ETF data fetch failed for {etf_symbol}, using mock: {e}"
                )

        # Fallback to mock data
        return await self._fetch_etf_flows_mock(etf_symbol, start_date, end_date)

    async def get_institutional_holdings(self, symbol: str) -> pd.DataFrame:
        """
        Get institutional holdings data from 13F filings.

        Args:
            symbol: Stock symbol

        Returns:
            DataFrame with institutional holdings
        """
        await self.initialize()

        if self._adapter and not self._use_mock:
            try:
                return await self._adapter.get_institutional_holders(symbol)
            except DataProviderError as e:
                logger.warning(
                    f"Institutional holdings fetch failed for {symbol}, using mock: {e}"
                )

        # Fallback to mock data
        return await self._fetch_institutional_holdings_mock(symbol)

    async def get_institutional_changes(self, symbol: str) -> pd.DataFrame:
        """
        Get recent institutional changes for a symbol.

        Args:
            symbol: Stock symbol

        Returns:
            DataFrame with recent institutional changes
        """
        await self.initialize()
        # Not available in OpenBBAdapter yet, falling back to mock
        return await self._fetch_institutional_changes_mock(symbol)

    async def get_13f_filing(self, manager_cik: str, period: str) -> pd.DataFrame:
        """
        Get 13F filing data for a manager.

        Args:
            manager_cik: Manager CIK
            period: 'current', 'previous', or 'Q-X'

        Returns:
            DataFrame with 13F filing data
        """
        await self.initialize()
        # Not available in OpenBBAdapter yet, falling back to mock
        return await self._fetch_13f_filing_mock(manager_cik, period)

    async def get_13f_holdings_previous(self, symbol: str) -> pd.DataFrame:
        """
        Get previous quarter holdings data for a symbol.

        Args:
            symbol: Stock symbol

        Returns:
            DataFrame with previous holdings
        """
        await self.initialize()
        # Placeholder implementation until available in provider
        return await self._fetch_institutional_holdings_mock(symbol)

    async def get_manager_aum(self) -> pd.DataFrame:
        """
        Get estimated AUM for institutional managers.

        Returns:
             DataFrame with manager AUM data
        """
        await self.initialize()
        # Placeholder implementation
        return pd.DataFrame(
            {
                "name": [
                    "Vanguard",
                    "BlackRock",
                    "State Street",
                    "Fidelity",
                    "T. Rowe Price",
                ],
                "aum": [
                    7.0e12,
                    8.0e12,
                    3.0e12,
                    2.5e12,
                    1.3e12,
                ],
            }
        )

    async def get_options_flow(
        self,
        symbol: str,
        unusual_only: bool = True,
    ) -> pd.DataFrame:
        """
        Get options flow data.

        Args:
            symbol: Stock symbol
            unusual_only: Only return unusual options activity

        Returns:
            DataFrame with options flow data
        """
        await self.initialize()

        if self._adapter and not self._use_mock:
            try:
                if unusual_only:
                    return await self._adapter.get_unusual_options_activity(symbol)
                else:
                    return await self._adapter.get_options_chain(symbol)
            except DataProviderError as e:
                logger.warning(
                    f"Options flow fetch failed for {symbol}, using mock: {e}"
                )

        # Fallback to mock data
        return await self._fetch_options_flow_mock(symbol, unusual_only)

    async def get_dark_pool_volume(
        self,
        symbol: str,
        lookback_days: int = 20,
    ) -> pd.DataFrame:
        """
        Get dark pool volume data.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to retrieve

        Returns:
            DataFrame with dark pool volume data
        """
        await self.initialize()

        # Note: Dark pool data requires specialized providers not in OpenBB
        # Using short interest as a proxy indicator when available
        if self._adapter and not self._use_mock:
            try:
                # Short interest can indicate dark pool activity
                short_data = await self._adapter.get_short_interest(symbol)
                return short_data
            except DataProviderError as e:
                logger.debug(f"Dark pool data not available for {symbol}: {e}")

        # Fallback to mock data
        return await self._fetch_dark_pool_volume_mock(symbol, lookback_days)

    async def get_short_interest(self, symbol: str) -> pd.DataFrame:
        """
        Get short interest data.

        Args:
            symbol: Stock symbol

        Returns:
            DataFrame with short interest data
        """
        await self.initialize()

        if self._adapter and not self._use_mock:
            try:
                return await self._adapter.get_short_interest(symbol)
            except DataProviderError as e:
                logger.warning(
                    f"Short interest fetch failed for {symbol}, using mock: {e}"
                )

        # Fallback to mock data
        return await self._fetch_short_interest_mock(symbol)

    async def get_insider_trading(
        self,
        symbol: str,
        lookback_days: int = 90,
    ) -> pd.DataFrame:
        """
        Get insider trading data from SEC Forms 4.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to retrieve

        Returns:
            DataFrame with insider trading data
        """
        await self.initialize()

        if self._adapter and not self._use_mock:
            try:
                return await self._adapter.get_insider_activity(
                    symbol=symbol,
                    lookback_days=lookback_days,
                )
            except DataProviderError as e:
                logger.warning(
                    f"Insider trading fetch failed for {symbol}, using mock: {e}"
                )

        # Fallback to mock data
        return await self._fetch_insider_trading_mock(symbol, lookback_days)

    async def get_economic_data(
        self,
        indicator: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """
        Get economic indicator data.

        Args:
            indicator: Economic indicator name
            start_date: Start date for data
            end_date: End date for data

        Returns:
            DataFrame with economic data
        """
        await self.initialize()

        if self._adapter and not self._use_mock:
            try:
                return await self._adapter.get_economic_data(
                    indicator=indicator,
                    start_date=start_date,
                    end_date=end_date,
                )
            except DataProviderError as e:
                logger.warning(
                    f"Economic data fetch failed for {indicator}, using mock: {e}"
                )

        # Fallback to mock data
        return await self._fetch_economic_data_mock(indicator, start_date, end_date)

    # ========================================================================
    # Mock Data Methods (fallback when real data unavailable)
    # ========================================================================

    async def _fetch_stock_data_mock(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """
        Generate mock stock data.

        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date

        Returns:
            DataFrame with mock stock data
        """
        dates = pd.date_range(start=start_date, end=end_date, freq="D")

        # Generate realistic price data
        initial_price = 150.0
        prices = []
        current_price = initial_price

        for i in range(len(dates)):
            # Random walk with slight upward bias
            daily_return = np.random.normal(
                0.001, 0.02
            )  # 0.1% avg daily return, 2% volatility
            current_price *= 1 + daily_return
            prices.append(current_price)

        volume = np.random.randint(1000000, 10000000, len(dates))

        # Generate OHLC data with proper constraints (high >= close >= low)
        prices_arr = np.array(prices)
        high_multiplier = 1 + np.random.uniform(0, 0.02, len(dates))
        low_multiplier = 1 - np.random.uniform(0, 0.02, len(dates))
        open_multiplier = 1 + np.random.uniform(-0.01, 0.01, len(dates))

        high = prices_arr * high_multiplier
        low = prices_arr * low_multiplier
        open_prices = prices_arr * open_multiplier

        # Ensure OHLC constraints: high is max, low is min
        high = np.maximum(high, np.maximum(prices_arr, open_prices))
        low = np.minimum(low, np.minimum(prices_arr, open_prices))

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

    async def _fetch_etf_flows_mock(
        self,
        etf_symbol: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """Generate mock ETF flow data."""
        dates = pd.date_range(start=start_date, end=end_date, freq="D")

        # Generate realistic ETF flow data
        base_flow = np.random.normal(0, 500000, len(dates))  # Mean 0, std 500K

        return pd.DataFrame(
            {
                "date": dates,
                "net_flow": base_flow,
                "creation_units": np.where(base_flow > 0, base_flow / 100000, 0),
                "redemption_units": np.where(base_flow < 0, -base_flow / 100000, 0),
            }
        )

    async def _fetch_institutional_holdings_mock(self, symbol: str) -> pd.DataFrame:
        """Generate mock institutional holdings data."""
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
                "value_held": [
                    10000000000,
                    8000000000,
                    6000000000,
                    4000000000,
                    3000000000,
                ],
                "ownership_percentage": [0.05, 0.04, 0.03, 0.02, 0.015],
            }
        )

    async def _fetch_institutional_changes_mock(self, symbol: str) -> pd.DataFrame:
        """Generate mock recent institutional changes."""
        dates = pd.date_range(end=datetime.now(), periods=5, freq="ME")
        return pd.DataFrame(
            {
                "date": dates,
                "net_institutional_change": [
                    1000000,
                    -500000,
                    2000000,
                    -100000,
                    1500000,
                ],
                "new_institutions": [5, 2, 8, 1, 6],
                "closed_institutions": [2, 4, 1, 3, 2],
                "total_institutions": [250, 253, 251, 258, 256],
            }
        )

    async def _fetch_13f_filing_mock(
        self, manager_cik: str, period: str
    ) -> pd.DataFrame:
        """Generate mock 13F filing data."""
        symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA"]
        return pd.DataFrame(
            {
                "symbol": symbols,
                "shares": [10000000, 8000000, 6000000, 5000000, 4000000],
                "value": [1500000000, 1200000000, 900000000, 750000000, 600000000],
                "weight": [0.25, 0.20, 0.15, 0.12, 0.10],
            }
        )

    async def _fetch_options_flow_mock(
        self,
        symbol: str,
        unusual_only: bool,
    ) -> pd.DataFrame:
        """Generate mock options flow data."""
        dates = pd.date_range(end=datetime.now(), periods=20, freq="D")

        return pd.DataFrame(
            {
                "date": dates,
                "contract_symbol": [f"{symbol}230101C00150000" for _ in dates],
                "volume": np.random.randint(100, 5000, len(dates)),
                "open_interest": np.random.randint(500, 20000, len(dates)),
                "notional_value": np.random.uniform(100000, 10000000, len(dates)),
                "unusual_activity": np.random.choice(
                    [True, False], len(dates), p=[0.3, 0.7]
                ),
            }
        )

    async def _fetch_dark_pool_volume_mock(
        self,
        symbol: str,
        lookback_days: int,
    ) -> pd.DataFrame:
        """Generate mock dark pool volume data."""
        dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")

        return pd.DataFrame(
            {
                "date": dates,
                "dark_pool_volume": np.random.randint(100000, 1000000, len(dates)),
                "total_volume": np.random.randint(1000000, 10000000, len(dates)),
                "dark_pool_percentage": np.random.uniform(0.15, 0.35, len(dates)),
                "large_block_activity": np.random.uniform(0.05, 0.15, len(dates)),
            }
        )

    async def _fetch_short_interest_mock(self, symbol: str) -> pd.DataFrame:
        """Generate mock short interest data."""
        return pd.DataFrame(
            {
                "current_short_interest": [np.random.uniform(0.02, 0.10)],
                "previous_short_interest": [np.random.uniform(0.02, 0.10)],
                "days_to_cover": [np.random.uniform(1, 10)],
                "short_ratio": [np.random.uniform(0.01, 0.05)],
            }
        )

    async def _fetch_insider_trading_mock(
        self,
        symbol: str,
        lookback_days: int,
    ) -> pd.DataFrame:
        """Generate mock insider trading data."""
        dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")

        return pd.DataFrame(
            {
                "date": dates,
                "insider_name": [f"Insider_{i}" for i in range(len(dates))],
                "transaction_type": np.random.choice(["Buy", "Sell"], len(dates)),
                "shares": np.random.randint(1000, 100000, len(dates)),
                "value": np.random.uniform(100000, 10000000, len(dates)),
                "position": np.random.choice(
                    ["CEO", "CFO", "Director", "VP"], len(dates)
                ),
            }
        )

    async def _fetch_economic_data_mock(
        self,
        indicator: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """Generate mock economic indicator data."""
        dates = pd.date_range(start=start_date, end=end_date, freq="ME")

        # Generate data based on indicator type
        if indicator == "unemployment_rate":
            values = np.random.uniform(3.5, 6.5, len(dates))
        elif indicator == "inflation_rate":
            values = np.random.uniform(1.5, 4.0, len(dates))
        elif indicator == "gdp_growth":
            values = np.random.uniform(-2.0, 4.0, len(dates))
        else:
            values = np.random.uniform(0, 100, len(dates))

        return pd.DataFrame({"date": dates, "value": values, "indicator": indicator})

    # ========================================================================
    # Utility Methods
    # ========================================================================

    async def health_check(self) -> bool:
        """
        Check if data manager is operational.

        Returns:
            True if healthy, False otherwise
        """
        try:
            await self.initialize()

            if self._adapter and not self._use_mock:
                return await self._adapter.health_check()

            # Mock mode is always healthy
            return True
        except Exception as e:
            logger.error(f"Data manager health check failed: {e}")
            return False

    def is_using_mock(self) -> bool:
        """Check if data manager is using mock data."""
        return self._use_mock

    def clear_cache(self) -> None:
        """Clear all cached data."""
        if self._adapter:
            self._adapter.clear_cache()
