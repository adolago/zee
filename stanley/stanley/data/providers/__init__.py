"""
Data Provider Interface Module

Defines abstract interfaces for data providers used by Stanley.
Enables swapping between different data sources (OpenBB, direct APIs, etc.)
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, Optional

import pandas as pd


class DataProviderError(Exception):
    """Base exception for data provider errors."""


class RateLimitError(DataProviderError):
    """Raised when rate limit is exceeded."""


class DataNotFoundError(DataProviderError):
    """Raised when requested data is not found."""


class AuthenticationError(DataProviderError):
    """Raised when authentication fails."""


class DataProvider(ABC):
    """
    Abstract base class for data providers.

    All data providers (OpenBB, SEC, etc.) should implement this interface.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the provider name."""

    @abstractmethod
    async def initialize(self) -> None:
        """
        Initialize the data provider.

        This should be called before any data fetching operations.
        May include authentication, connection setup, etc.
        """

    @abstractmethod
    async def close(self) -> None:
        """
        Close the data provider and cleanup resources.
        """

    @abstractmethod
    async def health_check(self) -> bool:
        """
        Check if the provider is operational.

        Returns:
            True if healthy, False otherwise.
        """

    @abstractmethod
    async def get_stock_data(
        self, symbol: str, start_date: datetime, end_date: datetime, **kwargs
    ) -> pd.DataFrame:
        """
        Get historical stock price data.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date for data range
            end_date: End date for data range
            **kwargs: Additional provider-specific parameters

        Returns:
            DataFrame with columns: date, open, high, low, close, volume
        """

    @abstractmethod
    async def get_institutional_holdings(self, symbol: str, **kwargs) -> pd.DataFrame:
        """
        Get institutional holdings from 13F filings.

        Args:
            symbol: Stock ticker symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            DataFrame with institutional holding details
        """

    @abstractmethod
    async def get_options_chain(self, symbol: str, **kwargs) -> pd.DataFrame:
        """
        Get options chain data.

        Args:
            symbol: Stock ticker symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            DataFrame with options chain data
        """

    @abstractmethod
    async def get_fundamentals(self, symbol: str, **kwargs) -> Dict[str, Any]:
        """
        Get fundamental data for a stock.

        Args:
            symbol: Stock ticker symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            Dictionary with fundamental metrics
        """

    @abstractmethod
    async def get_insider_transactions(self, symbol: str, **kwargs) -> pd.DataFrame:
        """
        Get insider trading transactions.

        Args:
            symbol: Stock ticker symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            DataFrame with insider transaction details
        """

    @abstractmethod
    async def get_etf_holdings(self, symbol: str, **kwargs) -> pd.DataFrame:
        """
        Get ETF holdings data.

        Args:
            symbol: ETF ticker symbol
            **kwargs: Additional provider-specific parameters

        Returns:
            DataFrame with ETF holdings
        """

    @abstractmethod
    async def get_economic_indicator(
        self, indicator: str, start_date: datetime, end_date: datetime, **kwargs
    ) -> pd.DataFrame:
        """
        Get economic indicator data.

        Args:
            indicator: Economic indicator identifier
            start_date: Start date for data range
            end_date: End date for data range
            **kwargs: Additional provider-specific parameters

        Returns:
            DataFrame with indicator values over time
        """


class CachingMixin:
    """
    Mixin class providing caching functionality for data providers.
    """

    def __init__(self):
        self._cache: Dict[str, Any] = {}
        self._cache_timestamps: Dict[str, datetime] = {}
        self._default_ttl_seconds: int = 300  # 5 minutes default

    def _cache_key(self, method: str, *args, **kwargs) -> str:
        """Generate a cache key from method name and arguments."""
        key_parts = [method]
        key_parts.extend(str(arg) for arg in args)
        key_parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
        return ":".join(key_parts)

    def _get_cached(self, key: str, ttl_seconds: Optional[int] = None) -> Optional[Any]:
        """
        Get a value from cache if not expired.

        Args:
            key: Cache key
            ttl_seconds: Time-to-live in seconds (uses default if None)

        Returns:
            Cached value or None if not found/expired
        """
        if key not in self._cache:
            return None

        ttl = ttl_seconds if ttl_seconds is not None else self._default_ttl_seconds
        cached_at = self._cache_timestamps.get(key)

        if cached_at and (datetime.now() - cached_at).total_seconds() > ttl:
            # Cache expired
            del self._cache[key]
            del self._cache_timestamps[key]
            return None

        return self._cache[key]

    def _set_cached(self, key: str, value: Any) -> None:
        """
        Store a value in cache.

        Args:
            key: Cache key
            value: Value to cache
        """
        self._cache[key] = value
        self._cache_timestamps[key] = datetime.now()

    def _clear_cache(self) -> None:
        """Clear all cached data."""
        self._cache.clear()
        self._cache_timestamps.clear()


class RateLimiter:
    """
    Rate limiter for API calls.

    Uses a token bucket algorithm to enforce rate limits.
    """

    def __init__(self, requests_per_second: float = 10.0):
        """
        Initialize rate limiter.

        Args:
            requests_per_second: Maximum allowed requests per second
        """
        self._rate = requests_per_second
        self._tokens = requests_per_second
        self._last_update = datetime.now()
        self._lock = None  # Will be initialized as asyncio.Lock() when needed

    async def acquire(self) -> None:
        """
        Acquire permission to make a request.

        Will wait if rate limit is exceeded.
        """
        import asyncio

        if self._lock is None:
            self._lock = asyncio.Lock()

        async with self._lock:
            now = datetime.now()
            elapsed = (now - self._last_update).total_seconds()
            self._tokens = min(self._rate, self._tokens + elapsed * self._rate)
            self._last_update = now

            if self._tokens < 1:
                wait_time = (1 - self._tokens) / self._rate
                await asyncio.sleep(wait_time)
                self._tokens = 0
            else:
                self._tokens -= 1


# Import specific providers
from .openbb_provider import OpenBBProvider, OpenBBAdapter
from .finra_provider import FINRAProvider, FINRAProviderConfig
from .options_provider import OptionsProvider, OptionsProviderConfig

__all__ = [
    "DataProvider",
    "DataProviderError",
    "RateLimitError",
    "DataNotFoundError",
    "AuthenticationError",
    "CachingMixin",
    "RateLimiter",
    "OpenBBProvider",
    "OpenBBAdapter",
    "FINRAProvider",
    "FINRAProviderConfig",
    "OptionsProvider",
    "OptionsProviderConfig",
]
