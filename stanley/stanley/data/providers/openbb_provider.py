"""
OpenBB Data Provider

Implements the DataProvider interface using OpenBB SDK v4.
Provides async wrappers around the synchronous OpenBB SDK.
"""

import ast
import asyncio
import importlib.util
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd

from . import (
    CachingMixin,
    DataNotFoundError,
    DataProvider,
    DataProviderError,
    RateLimiter,
)

logger = logging.getLogger(__name__)
_OPENBB_COMPAT_PATCHED = False


def _apply_openbb_provider_interface_compat() -> None:
    """Patch missing OBBject_* symbols for OpenBB package compatibility."""
    global _OPENBB_COMPAT_PATCHED

    if _OPENBB_COMPAT_PATCHED:
        return

    try:
        import openbb_core.app.provider_interface as provider_interface
        from openbb_core.app.model.obbject import OBBject

        spec = importlib.util.find_spec("openbb")
        if not spec or not spec.origin:
            _OPENBB_COMPAT_PATCHED = True
            return

        package_dir = Path(spec.origin).resolve().parent / "package"
        if not package_dir.exists():
            _OPENBB_COMPAT_PATCHED = True
            return

        patched = 0
        for py_file in package_dir.glob("*.py"):
            try:
                tree = ast.parse(py_file.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                continue

            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                if node.module != "openbb_core.app.provider_interface":
                    continue

                for alias in node.names:
                    name = alias.name
                    if not name.startswith("OBBject_"):
                        continue
                    if not hasattr(provider_interface, name):
                        setattr(provider_interface, name, OBBject)
                        patched += 1

        if patched:
            logger.info("Applied OpenBB provider-interface compatibility patch (%d symbols)", patched)
    except Exception as exc:
        logger.debug("OpenBB compatibility patch skipped: %s", exc)
    finally:
        _OPENBB_COMPAT_PATCHED = True


class OpenBBProvider(DataProvider, CachingMixin):
    """
    Data provider implementation using OpenBB SDK v4.

    OpenBB SDK is synchronous, so this class provides async wrappers
    that execute SDK calls in a thread pool to avoid blocking.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_provider: str = "yfinance",
        max_retries: int = 3,
        timeout: int = 30,
        requests_per_second: float = 5.0,
        cache_ttl_seconds: int = 300,
    ):
        """
        Initialize OpenBB provider.

        Args:
            api_key: OpenBB API key (optional for some providers)
            default_provider: Default data provider for OpenBB queries
            max_retries: Maximum number of retries for failed requests
            timeout: Request timeout in seconds
            requests_per_second: Rate limit for API calls
            cache_ttl_seconds: Cache time-to-live in seconds
        """
        CachingMixin.__init__(self)

        self._api_key = api_key
        self._default_provider = default_provider
        self._max_retries = max_retries
        self._timeout = timeout
        self._rate_limiter = RateLimiter(requests_per_second)
        self._default_ttl_seconds = cache_ttl_seconds

        self._executor: Optional[ThreadPoolExecutor] = None
        self._obb = None
        self._initialized = False

    @property
    def name(self) -> str:
        """Return the provider name."""
        return "openbb"

    async def initialize(self) -> None:
        """
        Initialize the OpenBB SDK.

        Sets up credentials and thread pool for async execution.
        """
        if self._initialized:
            return

        logger.info("Initializing OpenBB provider...")

        try:
            # OpenBB 4.6.0 can import package routers that expect generated
            # OBBject_* symbols in provider_interface.
            _apply_openbb_provider_interface_compat()

            # Import OpenBB (this can take a moment)
            from openbb import obb

            self._obb = obb

            # Configure API key if provided
            if self._api_key:
                self._obb.user.credentials.openbb_api_key = self._api_key

            # Create thread pool for running sync OpenBB calls
            self._executor = ThreadPoolExecutor(
                max_workers=4, thread_name_prefix="openbb"
            )

            self._initialized = True
            logger.info("OpenBB provider initialized successfully")

        except ImportError as e:
            raise DataProviderError(
                "OpenBB SDK not installed. Install with: pip install openbb"
            ) from e
        except Exception as e:
            raise DataProviderError(f"Failed to initialize OpenBB: {e}") from e

    async def close(self) -> None:
        """Close the provider and cleanup resources."""
        if self._executor:
            self._executor.shutdown(wait=True)
            self._executor = None

        self._clear_cache()
        self._initialized = False
        logger.info("OpenBB provider closed")

    async def health_check(self) -> bool:
        """
        Check if the provider is operational.

        Attempts a simple API call to verify connectivity.
        """
        if not self._initialized:
            return False

        try:
            # Try to fetch a simple piece of data
            await self.get_stock_data(
                "AAPL", datetime(2024, 1, 1), datetime(2024, 1, 5)
            )
            return True
        except Exception as e:
            logger.warning(f"OpenBB health check failed: {e}")
            return False

    async def _run_in_executor(self, func, *args, **kwargs) -> Any:
        """
        Run a synchronous function in the thread pool.

        Args:
            func: Function to execute
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Function result
        """
        if not self._initialized:
            await self.initialize()

        loop = asyncio.get_event_loop()

        # Apply rate limiting
        await self._rate_limiter.acquire()

        # Run in thread pool
        partial_func = partial(func, *args, **kwargs)
        return await loop.run_in_executor(self._executor, partial_func)

    async def _execute_with_retry(self, func, *args, **kwargs) -> Any:
        """
        Execute a function with retry logic.

        Args:
            func: Function to execute
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Function result

        Raises:
            DataProviderError: If all retries fail
        """
        last_error = None

        for attempt in range(self._max_retries):
            try:
                return await self._run_in_executor(func, *args, **kwargs)
            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check if rate limited
                if "rate" in error_str and "limit" in error_str:
                    wait_time = 2**attempt  # Exponential backoff
                    logger.warning(f"Rate limited, waiting {wait_time}s before retry")
                    await asyncio.sleep(wait_time)
                    continue

                # Check if transient error
                if attempt < self._max_retries - 1:
                    if any(
                        x in error_str for x in ["timeout", "connection", "temporary"]
                    ):
                        wait_time = 1 + attempt
                        logger.warning(
                            f"Transient error, retrying in {wait_time}s: {e}"
                        )
                        await asyncio.sleep(wait_time)
                        continue

                # Non-retryable error
                break

        raise DataProviderError(
            f"Failed after {self._max_retries} attempts: {last_error}"
        )

    def _to_dataframe(self, result) -> pd.DataFrame:
        """
        Convert OpenBB result to DataFrame.

        Args:
            result: OpenBB API result object

        Returns:
            pandas DataFrame
        """
        if hasattr(result, "to_dataframe"):
            return result.to_dataframe()
        elif hasattr(result, "to_df"):
            return result.to_df()
        elif isinstance(result, pd.DataFrame):
            return result
        elif hasattr(result, "results"):
            # Handle OBBject with results attribute
            if isinstance(result.results, list):
                return pd.DataFrame(
                    [
                        r.model_dump() if hasattr(r, "model_dump") else r
                        for r in result.results
                    ]
                )
            elif hasattr(result.results, "model_dump"):
                return pd.DataFrame([result.results.model_dump()])
            else:
                return pd.DataFrame(result.results)
        else:
            raise DataProviderError(
                f"Cannot convert result to DataFrame: {type(result)}"
            )

    async def get_stock_data(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
        provider: Optional[str] = None,
        **kwargs,
    ) -> pd.DataFrame:
        """
        Get historical stock price data.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date for data range
            end_date: End date for data range
            provider: Data provider (default: yfinance)
            **kwargs: Additional parameters

        Returns:
            DataFrame with columns: date, open, high, low, close, volume
        """
        # Check cache
        cache_key = self._cache_key(
            "stock_data", symbol, start_date.isoformat(), end_date.isoformat(), provider
        )
        cached = self._get_cached(cache_key)
        if cached is not None:
            logger.debug(f"Cache hit for stock data: {symbol}")
            return cached

        provider = provider or self._default_provider

        def fetch_stock_data():
            result = self._obb.equity.price.historical(
                symbol=symbol,
                start_date=start_date.strftime("%Y-%m-%d"),
                end_date=end_date.strftime("%Y-%m-%d"),
                provider=provider,
            )
            return self._to_dataframe(result)

        try:
            df = await self._execute_with_retry(fetch_stock_data)

            # Normalize column names
            df = self._normalize_ohlcv_columns(df)

            # Cache result
            self._set_cached(cache_key, df)

            return df

        except Exception as e:
            if "not found" in str(e).lower() or "invalid" in str(e).lower():
                raise DataNotFoundError(f"Stock data not found for {symbol}") from e
            raise

    def _normalize_ohlcv_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Normalize OHLCV column names to standard format.

        Args:
            df: Input DataFrame

        Returns:
            DataFrame with normalized columns
        """
        column_mappings = {
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
            "Adj Close": "adj_close",
            "adj_close": "adj_close",
            "Dividends": "dividends",
            "Stock Splits": "stock_splits",
        }

        # Rename columns that exist
        rename_dict = {k: v for k, v in column_mappings.items() if k in df.columns}
        df = df.rename(columns=rename_dict)

        # If index is datetime, reset it to a column
        if isinstance(df.index, pd.DatetimeIndex) and "date" not in df.columns:
            df = df.reset_index()
            if "index" in df.columns:
                df = df.rename(columns={"index": "date"})

        return df

    def _yfinance_fundamentals(self, symbol: str) -> Dict[str, Any]:
        """Get fundamental data directly from yfinance."""
        try:
            import yfinance as yf

            ticker = yf.Ticker(symbol)
            info = ticker.info or {}

            def _num(key: str) -> Optional[float]:
                value = info.get(key)
                try:
                    return float(value) if value is not None else None
                except (TypeError, ValueError):
                    return None

            payload: Dict[str, Any] = {
                "symbol": symbol,
                "companyName": info.get("longName") or info.get("shortName"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "country": info.get("country"),
                "website": info.get("website"),
                "marketCap": info.get("marketCap"),
                "enterpriseValue": info.get("enterpriseValue"),
                "trailingPE": _num("trailingPE"),
                "forwardPE": _num("forwardPE"),
                "priceToBook": _num("priceToBook"),
                "pegRatio": _num("pegRatio"),
                "dividendYield": _num("dividendYield"),
                "beta": _num("beta"),
                "fiftyTwoWeekHigh": _num("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow": _num("fiftyTwoWeekLow"),
                "totalRevenue": info.get("totalRevenue"),
                "grossMargins": _num("grossMargins"),
                "operatingMargins": _num("operatingMargins"),
                "profitMargins": _num("profitMargins"),
                "returnOnEquity": _num("returnOnEquity"),
                "returnOnAssets": _num("returnOnAssets"),
                "debtToEquity": _num("debtToEquity"),
                "currentRatio": _num("currentRatio"),
                "quickRatio": _num("quickRatio"),
                "sharesOutstanding": info.get("sharesOutstanding"),
                "currency": info.get("currency"),
            }

            return {k: v for k, v in payload.items() if v is not None}
        except Exception as e:
            logger.error(f"yfinance fundamentals fetch failed for {symbol}: {e}")
            return {}

    async def get_institutional_holdings(
        self, symbol: str, provider: Optional[str] = None, **kwargs
    ) -> pd.DataFrame:
        """
        Get institutional holdings from 13F filings.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider (default: fmp or sec)
            **kwargs: Additional parameters

        Returns:
            DataFrame with institutional holding details
        """
        cache_key = self._cache_key("institutional_holdings", symbol, provider)
        cached = self._get_cached(cache_key, ttl_seconds=3600)  # 1 hour cache
        if cached is not None:
            return cached

        # Try different providers
        providers_to_try = [provider] if provider else ["fmp", "intrinio", "sec"]

        def fetch_holdings(prov: str):
            result = self._obb.equity.ownership.institutional(
                symbol=symbol,
                provider=prov,
            )
            return self._to_dataframe(result)

        last_error = None
        for prov in providers_to_try:
            try:
                df = await self._execute_with_retry(fetch_holdings, prov)

                # Normalize columns
                df = self._normalize_institutional_columns(df)

                self._set_cached(cache_key, df)
                return df

            except Exception as e:
                last_error = e
                logger.debug(f"Provider {prov} failed for institutional holdings: {e}")
                continue

        raise DataProviderError(
            f"Failed to fetch institutional holdings for {symbol}: {last_error}"
        )

    def _normalize_institutional_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize institutional holdings column names."""
        column_mappings = {
            "holder": "manager_name",
            "investor": "manager_name",
            "institutionName": "manager_name",
            "shares": "shares_held",
            "sharesHeld": "shares_held",
            "value": "value_held",
            "marketValue": "value_held",
            "percentOwnership": "ownership_percentage",
            "percent": "ownership_percentage",
            "change": "shares_change",
            "changePercent": "change_percentage",
            "dateReported": "report_date",
            "filingDate": "filing_date",
        }

        rename_dict = {k: v for k, v in column_mappings.items() if k in df.columns}
        return df.rename(columns=rename_dict)

    async def get_options_chain(
        self, symbol: str, provider: Optional[str] = None, **kwargs
    ) -> pd.DataFrame:
        """
        Get options chain data.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider
            **kwargs: Additional parameters (expiration, etc.)

        Returns:
            DataFrame with options chain data
        """
        cache_key = self._cache_key("options_chain", symbol, provider, **kwargs)
        cached = self._get_cached(cache_key, ttl_seconds=60)  # Short cache for options
        if cached is not None:
            return cached

        providers_to_try = [provider] if provider else ["intrinio", "cboe", "tradier"]

        def fetch_options(prov: str):
            result = self._obb.derivatives.options.chains(
                symbol=symbol, provider=prov, **kwargs
            )
            return self._to_dataframe(result)

        last_error = None
        for prov in providers_to_try:
            try:
                df = await self._execute_with_retry(fetch_options, prov)
                self._set_cached(cache_key, df)
                return df
            except Exception as e:
                last_error = e
                logger.debug(f"Provider {prov} failed for options chain: {e}")
                continue

        raise DataProviderError(
            f"Failed to fetch options chain for {symbol}: {last_error}"
        )

    async def get_fundamentals(
        self, symbol: str, provider: Optional[str] = None, **kwargs
    ) -> Dict[str, Any]:
        """
        Get fundamental data for a stock.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider
            **kwargs: Additional parameters

        Returns:
            Dictionary with fundamental metrics
        """
        cache_key = self._cache_key("fundamentals", symbol, provider)
        cached = self._get_cached(cache_key, ttl_seconds=3600)
        if cached is not None:
            return cached

        if not self._initialized:
            try:
                await self.initialize()
            except Exception as e:
                logger.warning(
                    f"OpenBB initialization failed for fundamentals ({e}), trying yfinance"
                )
                fallback = self._yfinance_fundamentals(symbol)
                if fallback:
                    self._set_cached(cache_key, fallback)
                    return fallback
                raise

        if self._obb is None:
            fallback = self._yfinance_fundamentals(symbol)
            if fallback:
                self._set_cached(cache_key, fallback)
                return fallback

        providers_to_try = [provider] if provider else ["fmp", "intrinio", "yfinance"]

        def fetch_fundamentals(prov: str):
            result = self._obb.equity.fundamental.overview(
                symbol=symbol,
                provider=prov,
            )
            # Return as dict
            if hasattr(result, "results"):
                if hasattr(result.results, "model_dump"):
                    return result.results.model_dump()
                elif isinstance(result.results, list) and len(result.results) > 0:
                    item = result.results[0]
                    return item.model_dump() if hasattr(item, "model_dump") else item
            return {}

        last_error = None
        for prov in providers_to_try:
            try:
                data = await self._execute_with_retry(fetch_fundamentals, prov)
                self._set_cached(cache_key, data)
                return data
            except Exception as e:
                last_error = e
                logger.debug(f"Provider {prov} failed for fundamentals: {e}")
                continue

        # OpenBB can fail from extension mismatch. Fall back to yfinance fundamentals.
        fallback = self._yfinance_fundamentals(symbol)
        if fallback:
            self._set_cached(cache_key, fallback)
            return fallback

        raise DataProviderError(
            f"Failed to fetch fundamentals for {symbol}: {last_error}"
        )

    async def get_insider_transactions(
        self, symbol: str, provider: Optional[str] = None, limit: int = 100, **kwargs
    ) -> pd.DataFrame:
        """
        Get insider trading transactions.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider
            limit: Maximum number of transactions
            **kwargs: Additional parameters

        Returns:
            DataFrame with insider transaction details
        """
        cache_key = self._cache_key("insider_transactions", symbol, provider, limit)
        cached = self._get_cached(cache_key, ttl_seconds=1800)  # 30 min cache
        if cached is not None:
            return cached

        providers_to_try = [provider] if provider else ["fmp", "intrinio", "sec"]

        def fetch_insider(prov: str):
            result = self._obb.equity.ownership.insider_trading(
                symbol=symbol,
                provider=prov,
                limit=limit,
            )
            return self._to_dataframe(result)

        last_error = None
        for prov in providers_to_try:
            try:
                df = await self._execute_with_retry(fetch_insider, prov)
                df = self._normalize_insider_columns(df)
                self._set_cached(cache_key, df)
                return df
            except Exception as e:
                last_error = e
                logger.debug(f"Provider {prov} failed for insider transactions: {e}")
                continue

        raise DataProviderError(
            f"Failed to fetch insider transactions for {symbol}: {last_error}"
        )

    def _normalize_insider_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize insider transaction column names."""
        column_mappings = {
            "filingDate": "date",
            "transactionDate": "transaction_date",
            "reportingName": "insider_name",
            "insiderName": "insider_name",
            "transactionType": "transaction_type",
            "securitiesTransacted": "shares",
            "shares": "shares",
            "price": "price",
            "transactionValue": "value",
            "ownershipType": "ownership_type",
            "securityTitle": "security_type",
            "reportingOwnerTitle": "position",
        }

        rename_dict = {k: v for k, v in column_mappings.items() if k in df.columns}
        return df.rename(columns=rename_dict)

    async def get_etf_holdings(
        self, symbol: str, provider: Optional[str] = None, **kwargs
    ) -> pd.DataFrame:
        """
        Get ETF holdings data.

        Args:
            symbol: ETF ticker symbol
            provider: Data provider
            **kwargs: Additional parameters

        Returns:
            DataFrame with ETF holdings
        """
        cache_key = self._cache_key("etf_holdings", symbol, provider)
        cached = self._get_cached(cache_key, ttl_seconds=3600)
        if cached is not None:
            return cached

        providers_to_try = [provider] if provider else ["fmp", "intrinio", "sec"]

        def fetch_holdings(prov: str):
            result = self._obb.etf.holdings(
                symbol=symbol,
                provider=prov,
            )
            return self._to_dataframe(result)

        last_error = None
        for prov in providers_to_try:
            try:
                df = await self._execute_with_retry(fetch_holdings, prov)
                self._set_cached(cache_key, df)
                return df
            except Exception as e:
                last_error = e
                logger.debug(f"Provider {prov} failed for ETF holdings: {e}")
                continue

        raise DataProviderError(
            f"Failed to fetch ETF holdings for {symbol}: {last_error}"
        )

    async def get_economic_indicator(
        self,
        indicator: str,
        start_date: datetime,
        end_date: datetime,
        provider: Optional[str] = None,
        **kwargs,
    ) -> pd.DataFrame:
        """
        Get economic indicator data.

        Args:
            indicator: Economic indicator identifier (e.g., 'GDP', 'CPI', 'UNRATE')
            start_date: Start date for data range
            end_date: End date for data range
            provider: Data provider
            **kwargs: Additional parameters

        Returns:
            DataFrame with indicator values over time
        """
        cache_key = self._cache_key(
            "economic_indicator",
            indicator,
            start_date.isoformat(),
            end_date.isoformat(),
        )
        cached = self._get_cached(cache_key, ttl_seconds=3600)
        if cached is not None:
            return cached

        # Map common indicator names to FRED series IDs
        indicator_mapping = {
            "gdp": "GDP",
            "gdp_growth": "A191RL1Q225SBEA",
            "unemployment": "UNRATE",
            "unemployment_rate": "UNRATE",
            "inflation": "CPIAUCSL",
            "inflation_rate": "CPIAUCSL",
            "cpi": "CPIAUCSL",
            "interest_rate": "FEDFUNDS",
            "fed_funds": "FEDFUNDS",
        }

        series_id = indicator_mapping.get(indicator.lower(), indicator.upper())

        def fetch_indicator():
            result = self._obb.economy.fred_series(
                symbol=series_id,
                start_date=start_date.strftime("%Y-%m-%d"),
                end_date=end_date.strftime("%Y-%m-%d"),
                provider=provider or "fred",
            )
            return self._to_dataframe(result)

        try:
            df = await self._execute_with_retry(fetch_indicator)

            # Add indicator name column
            df["indicator"] = indicator

            self._set_cached(cache_key, df)
            return df

        except Exception as e:
            raise DataProviderError(
                f"Failed to fetch economic indicator {indicator}: {e}"
            ) from e

    async def get_short_interest(
        self, symbol: str, provider: Optional[str] = None, **kwargs
    ) -> pd.DataFrame:
        """
        Get short interest data for a symbol.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider
            **kwargs: Additional parameters

        Returns:
            DataFrame with short interest data
        """
        cache_key = self._cache_key("short_interest", symbol, provider)
        cached = self._get_cached(cache_key, ttl_seconds=3600)
        if cached is not None:
            return cached

        providers_to_try = [provider] if provider else ["stockgrid", "finra"]

        def fetch_short_interest(prov: str):
            result = self._obb.equity.shorts.short_volume(
                symbol=symbol,
                provider=prov,
            )
            return self._to_dataframe(result)

        last_error = None
        for prov in providers_to_try:
            try:
                df = await self._execute_with_retry(fetch_short_interest, prov)
                self._set_cached(cache_key, df)
                return df
            except Exception as e:
                last_error = e
                logger.debug(f"Provider {prov} failed for short interest: {e}")
                continue

        raise DataProviderError(
            f"Failed to fetch short interest for {symbol}: {last_error}"
        )

    async def get_earnings_calendar(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        provider: Optional[str] = None,
        **kwargs,
    ) -> pd.DataFrame:
        """
        Get earnings calendar.

        Args:
            start_date: Start date (optional)
            end_date: End date (optional)
            provider: Data provider
            **kwargs: Additional parameters

        Returns:
            DataFrame with earnings announcements
        """

        def fetch_earnings():
            params = {"provider": provider or "fmp"}
            if start_date:
                params["start_date"] = start_date.strftime("%Y-%m-%d")
            if end_date:
                params["end_date"] = end_date.strftime("%Y-%m-%d")

            result = self._obb.equity.calendar.earnings(**params)
            return self._to_dataframe(result)

        try:
            df = await self._execute_with_retry(fetch_earnings)
            return df
        except Exception as e:
            raise DataProviderError(f"Failed to fetch earnings calendar: {e}") from e

    async def search_symbols(
        self, query: str, provider: Optional[str] = None, **kwargs
    ) -> pd.DataFrame:
        """
        Search for stock symbols.

        Args:
            query: Search query
            provider: Data provider
            **kwargs: Additional parameters

        Returns:
            DataFrame with matching symbols
        """

        def search():
            result = self._obb.equity.search(
                query=query,
                provider=provider or "sec",
            )
            return self._to_dataframe(result)

        try:
            df = await self._execute_with_retry(search)
            return df
        except Exception as e:
            raise DataProviderError(f"Failed to search symbols: {e}") from e


class OpenBBAdapter:
    """
    Synchronous adapter for OpenBB data access.

    Provides a simpler synchronous interface for use with NautilusTrader
    and other components that don't require async operations.

    Falls back to direct yfinance when OpenBB has version compatibility issues.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize the OpenBB adapter.

        Args:
            config: Configuration dictionary with keys:
                - provider: Default data provider (e.g., 'yfinance', 'fmp')
                - api_key: API key for premium providers
                - fallback_provider: Fallback provider if primary fails
                - timeout: Request timeout in seconds
                - rate_limit_calls: Max API calls per rate limit period
                - rate_limit_period: Rate limit period in seconds
        """
        self.config = config or {}
        self._provider = self.config.get("provider", "yfinance")
        self._fallback_provider = self.config.get("fallback_provider")
        self._obb = None
        self._initialized = False
        self._use_yfinance_direct = False  # Fallback flag

    def _ensure_initialized(self) -> None:
        """Ensure OpenBB SDK is initialized."""
        if self._initialized:
            return

        try:
            _apply_openbb_provider_interface_compat()
            from openbb import obb

            # Test that the equity module loads (this catches version mismatch)
            _ = obb.equity

            self._obb = obb

            # Configure API key if provided (handle different OpenBB versions)
            api_key = self.config.get("api_key")
            if api_key:
                try:
                    # Try different attribute names for different OpenBB versions
                    if hasattr(self._obb.user.credentials, "openbb_api_key"):
                        self._obb.user.credentials.openbb_api_key = api_key
                    elif hasattr(self._obb.user.credentials, "api_key"):
                        self._obb.user.credentials.api_key = api_key
                except Exception:
                    pass  # API key configuration optional

            self._initialized = True
        except (ImportError, AttributeError, Exception) as e:
            # OpenBB has version compatibility issues, fall back to direct yfinance
            logger.warning(f"OpenBB initialization failed ({e}), using direct yfinance")
            self._obb = None
            self._use_yfinance_direct = True
            self._initialized = True

    def _yfinance_historical(
        self, symbol: str, start_date: str, end_date: str
    ) -> pd.DataFrame:
        """Get historical data directly from yfinance."""
        try:
            import yfinance as yf

            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start_date, end=end_date, auto_adjust=True)

            if df.empty:
                return pd.DataFrame()

            # Normalize column names to lowercase
            df.columns = [c.lower() for c in df.columns]
            return df
        except Exception as e:
            logger.error(f"yfinance historical fetch failed for {symbol}: {e}")
            return pd.DataFrame()

    def _yfinance_quote(self, symbol: str) -> Dict[str, Any]:
        """Get current quote directly from yfinance."""
        try:
            import yfinance as yf

            ticker = yf.Ticker(symbol)
            info = ticker.info

            return {
                "symbol": symbol,
                "price": float(
                    info.get("currentPrice", info.get("regularMarketPrice", 0))
                ),
                "bid": float(info.get("bid", 0)),
                "ask": float(info.get("ask", 0)),
                "bid_size": int(info.get("bidSize", 0)),
                "ask_size": int(info.get("askSize", 0)),
                "volume": int(info.get("volume", info.get("regularMarketVolume", 0))),
                "timestamp": datetime.now(),
            }
        except Exception as e:
            logger.error(f"yfinance quote fetch failed for {symbol}: {e}")
            return {}

    def get_historical_data(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        provider: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get historical OHLCV data for a symbol.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            provider: Data provider to use

        Returns:
            DataFrame with OHLCV data
        """
        self._ensure_initialized()

        # Use direct yfinance if OpenBB has version issues
        if self._use_yfinance_direct:
            return self._yfinance_historical(symbol, start_date, end_date)

        if self._obb is None:
            return pd.DataFrame()

        provider = provider or self._provider

        try:
            result = self._obb.equity.price.historical(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                provider=provider,
            )
            return result.to_df()
        except Exception as e:
            # Try fallback provider if configured
            if self._fallback_provider and provider != self._fallback_provider:
                try:
                    result = self._obb.equity.price.historical(
                        symbol=symbol,
                        start_date=start_date,
                        end_date=end_date,
                        provider=self._fallback_provider,
                    )
                    return result.to_df()
                except Exception:
                    pass
            # Last resort: try direct yfinance
            logger.warning(f"OpenBB failed for {symbol}, trying direct yfinance")
            return self._yfinance_historical(symbol, start_date, end_date)

    def get_historical_bars(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        provider: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get historical data as list of bar dictionaries.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            provider: Data provider to use

        Returns:
            List of bar dictionaries with OHLCV data
        """
        df = self.get_historical_data(symbol, start_date, end_date, provider)

        if df.empty:
            return []

        bars = []
        for idx, row in df.iterrows():
            bar = {
                "timestamp": idx if isinstance(idx, datetime) else row.get("date", idx),
                "open": float(row.get("open", row.get("Open", 0))),
                "high": float(row.get("high", row.get("High", 0))),
                "low": float(row.get("low", row.get("Low", 0))),
                "close": float(row.get("close", row.get("Close", 0))),
                "volume": int(row.get("volume", row.get("Volume", 0))),
            }
            bars.append(bar)

        return bars

    def get_quote(self, symbol: str, provider: Optional[str] = None) -> Dict[str, Any]:
        """
        Get current quote for a symbol.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider to use

        Returns:
            Dictionary with quote data
        """
        self._ensure_initialized()

        # Use direct yfinance if OpenBB has version issues
        if self._use_yfinance_direct:
            return self._yfinance_quote(symbol)

        if self._obb is None:
            return self._yfinance_quote(symbol)

        provider = provider or self._provider

        try:
            result = self._obb.equity.price.quote(symbol=symbol, provider=provider)
            df = result.to_df()

            if df.empty:
                return self._yfinance_quote(symbol)

            row = df.iloc[0]
            price = row.get("last")
            if price in (None, 0):
                price = row.get("last_price")
            if price in (None, 0):
                price = row.get("price")
            if price in (None, 0):
                price = row.get("close")

            return {
                "symbol": symbol,
                "price": float(price or 0),
                "bid": float(row.get("bid", row.get("bid_price", 0))),
                "ask": float(row.get("ask", row.get("ask_price", 0))),
                "bid_size": int(row.get("bid_size", row.get("bidSize", 0))),
                "ask_size": int(row.get("ask_size", row.get("askSize", 0))),
                "volume": int(row.get("volume", 0)),
                "timestamp": datetime.now(),
            }
        except Exception:
            # Fall back to direct yfinance
            return self._yfinance_quote(symbol)

    def get_quote_tick(
        self, symbol: str, provider: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get quote tick data for NautilusTrader.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider to use

        Returns:
            Dictionary with quote tick data
        """
        quote = self.get_quote(symbol, provider)

        return {
            "bid": quote.get("bid", 0),
            "ask": quote.get("ask", 0),
            "bid_size": quote.get("bid_size", 0),
            "ask_size": quote.get("ask_size", 0),
            "timestamp": quote.get("timestamp", datetime.now()),
        }

    def get_institutional_holdings(
        self,
        symbol: str,
        provider: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get institutional holdings for a symbol.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider to use

        Returns:
            DataFrame with institutional holdings
        """
        self._ensure_initialized()

        if self._obb is None:
            return pd.DataFrame()

        try:
            result = self._obb.equity.ownership.major_holders(
                symbol=symbol,
                provider=provider or "fmp",
            )
            return result.to_df()
        except Exception:
            return pd.DataFrame()

    def get_options_chain(
        self,
        symbol: str,
        provider: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get options chain for a symbol.

        Args:
            symbol: Stock ticker symbol
            provider: Data provider to use

        Returns:
            DataFrame with options chain data
        """
        self._ensure_initialized()

        if self._obb is None:
            return pd.DataFrame()

        try:
            result = self._obb.derivatives.options.chains(
                symbol=symbol,
                provider=provider or "intrinio",
            )
            return result.to_df()
        except Exception:
            return pd.DataFrame()

    async def get_historical_data_async(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        provider: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Async wrapper for get_historical_data.

        Args:
            symbol: Stock ticker symbol
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            provider: Data provider to use

        Returns:
            DataFrame with OHLCV data
        """
        import asyncio

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.get_historical_data(symbol, start_date, end_date, provider),
        )

    async def get_historical_data_batch_async(
        self,
        symbols: List[str],
        start_date: str,
        end_date: str,
        provider: Optional[str] = None,
    ) -> Dict[str, pd.DataFrame]:
        """
        Get historical data for multiple symbols concurrently.

        Args:
            symbols: List of stock ticker symbols
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            provider: Data provider to use

        Returns:
            Dictionary mapping symbols to their DataFrames
        """
        import asyncio

        async def fetch_symbol(sym: str) -> tuple:
            try:
                df = await self.get_historical_data_async(
                    sym, start_date, end_date, provider
                )
                return (sym, df)
            except Exception:
                return (sym, pd.DataFrame())

        results = await asyncio.gather(*[fetch_symbol(s) for s in symbols])
        return dict(results)
