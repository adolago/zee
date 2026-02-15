"""
DBnomics Adapter Module

Provides interface to DBnomics - the world's economic database.
Access to 80+ data providers including IMF, World Bank, OECD,
Eurostat, Fed, ECB, and national statistical offices.
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional, Union

import pandas as pd

logger = logging.getLogger(__name__)

# Lazy import to handle optional dependency
_dbnomics_available = None


def _check_dbnomics_available():
    """Check if dbnomics is available."""
    global _dbnomics_available
    if _dbnomics_available is None:
        try:
            import dbnomics  # noqa: F401

            _dbnomics_available = True
        except ImportError:
            _dbnomics_available = False
    return _dbnomics_available


class DBnomicsAdapter:
    """
    Adapter for DBnomics economic database.

    Provides unified access to macroeconomic data from 80+ providers
    including IMF, World Bank, OECD, Eurostat, FRED, ECB, and more.
    """

    # Major data providers
    PROVIDERS = {
        "IMF": "International Monetary Fund",
        "WB": "World Bank",
        "OECD": "Organisation for Economic Co-operation and Development",
        "Eurostat": "European Statistical Office",
        "FRED": "Federal Reserve Economic Data",
        "ECB": "European Central Bank",
        "BIS": "Bank for International Settlements",
        "BLS": "Bureau of Labor Statistics",
        "INSEE": "French National Statistics",
        "Destatis": "German Federal Statistical Office",
        "ONS": "UK Office for National Statistics",
        "BOJ": "Bank of Japan",
        "RBA": "Reserve Bank of Australia",
        "BOE": "Bank of England",
    }

    # Common dataset codes by provider
    COMMON_DATASETS = {
        "IMF": {
            "WEO": "World Economic Outlook",
            "IFS": "International Financial Statistics",
            "GFSR": "Global Financial Stability Report",
            "BOP": "Balance of Payments",
            "DOT": "Direction of Trade Statistics",
        },
        "WB": {
            "WDI": "World Development Indicators",
            "GEM": "Global Economic Monitor",
        },
        "OECD": {
            "MEI": "Main Economic Indicators",
            "QNA": "Quarterly National Accounts",
            "EO": "Economic Outlook",
            "STLABOUR": "Short-Term Labour Market Statistics",
        },
        "Eurostat": {
            "prc_hicp_manr": "HICP Monthly Inflation",
            "nama_10_gdp": "GDP and Main Components",
            "une_rt_m": "Unemployment Rate Monthly",
        },
        "FRED": {
            "GNPCA": "Real GNP",
            "CPIAUCSL": "Consumer Price Index",
            "UNRATE": "Unemployment Rate",
            "FEDFUNDS": "Federal Funds Rate",
            "DGS10": "10-Year Treasury Rate",
        },
    }

    def __init__(
        self,
        api_base_url: Optional[str] = None,
        cache_enabled: bool = True,
        cache_ttl_seconds: int = 3600,
    ):
        """
        Initialize DBnomics adapter.

        Args:
            api_base_url: Custom API URL (default: DBnomics public API)
            cache_enabled: Enable caching of fetched data
            cache_ttl_seconds: Cache time-to-live in seconds
        """
        self._api_base_url = api_base_url
        self._cache_enabled = cache_enabled
        self._cache_ttl = cache_ttl_seconds
        self._cache: Dict[str, tuple] = {}  # key -> (data, timestamp)
        self._initialized = False

    def initialize(self) -> None:
        """Initialize the adapter."""
        if self._initialized:
            return

        if not _check_dbnomics_available():
            raise ImportError(
                "dbnomics is not installed. Install with: pip install dbnomics"
            )

        if self._api_base_url:
            import dbnomics

            dbnomics.default_api_base_url = self._api_base_url

        self._initialized = True
        logger.info("DBnomicsAdapter initialized")

    def _ensure_initialized(self) -> None:
        """Ensure adapter is initialized."""
        if not self._initialized:
            self.initialize()

    def _get_cache_key(self, provider: str, dataset: str, series: Optional[str]) -> str:
        """Generate cache key."""
        return f"{provider}:{dataset}:{series or 'all'}"

    def _get_from_cache(self, key: str) -> Optional[pd.DataFrame]:
        """Get data from cache if valid."""
        if not self._cache_enabled or key not in self._cache:
            return None

        data, timestamp = self._cache[key]
        if (datetime.now() - timestamp).seconds > self._cache_ttl:
            del self._cache[key]
            return None

        return data

    def _set_cache(self, key: str, data: pd.DataFrame) -> None:
        """Store data in cache."""
        if self._cache_enabled:
            self._cache[key] = (data, datetime.now())

    def fetch_series(
        self,
        provider_code: str,
        dataset_code: str,
        series_code: Optional[str] = None,
        max_results: int = 100,
    ) -> pd.DataFrame:
        """
        Fetch time series data from DBnomics.

        Args:
            provider_code: Data provider code (e.g., 'IMF', 'OECD')
            dataset_code: Dataset code within provider
            series_code: Specific series code (optional)
            max_results: Maximum number of series to return

        Returns:
            DataFrame with time series data
        """
        self._ensure_initialized()

        cache_key = self._get_cache_key(provider_code, dataset_code, series_code)
        cached = self._get_from_cache(cache_key)
        if cached is not None:
            return cached

        try:
            import dbnomics

            kwargs = {
                "provider_code": provider_code,
                "dataset_code": dataset_code,
                "max_nb_series": max_results,
            }

            if series_code:
                kwargs["series_code"] = series_code

            df = dbnomics.fetch_series(**kwargs)
            self._set_cache(cache_key, df)

            return df

        except Exception as e:
            logger.error(f"Failed to fetch series: {e}")
            return pd.DataFrame()

    def fetch_series_by_id(
        self,
        series_ids: Union[str, List[str]],
    ) -> pd.DataFrame:
        """
        Fetch series by full DBnomics series ID.

        Args:
            series_ids: Series ID(s) in format 'provider/dataset/series'

        Returns:
            DataFrame with time series data
        """
        self._ensure_initialized()

        if isinstance(series_ids, str):
            series_ids = [series_ids]

        try:
            import dbnomics

            df = dbnomics.fetch_series(series_ids=series_ids)
            return df

        except Exception as e:
            logger.error(f"Failed to fetch series by ID: {e}")
            return pd.DataFrame()

    def fetch_series_by_api_link(self, api_link: str) -> pd.DataFrame:
        """
        Fetch series using a DBnomics API URL.

        Args:
            api_link: Full DBnomics API URL

        Returns:
            DataFrame with time series data
        """
        self._ensure_initialized()

        try:
            import dbnomics

            df = dbnomics.fetch_series_by_api_link(api_link)
            return df

        except Exception as e:
            logger.error(f"Failed to fetch by API link: {e}")
            return pd.DataFrame()

    def search_series(
        self,
        query: str,
        provider_code: Optional[str] = None,
        limit: int = 50,
    ) -> pd.DataFrame:
        """
        Search for series matching a query.

        Args:
            query: Search query
            provider_code: Limit search to specific provider
            limit: Maximum results

        Returns:
            DataFrame with search results
        """
        self._ensure_initialized()

        try:
            import dbnomics

            # Note: dbnomics search functionality may vary by version
            # This is a simplified implementation
            if provider_code:
                df = dbnomics.fetch_series(
                    provider_code=provider_code,
                    max_nb_series=limit,
                )
            else:
                # Search across providers requires API call
                df = pd.DataFrame()
                logger.warning("Cross-provider search not implemented")

            return df

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return pd.DataFrame()

    def get_providers(self) -> pd.DataFrame:
        """
        Get list of available data providers.

        Returns:
            DataFrame with provider information
        """
        self._ensure_initialized()

        try:
            import requests

            url = self._api_base_url or "https://api.db.nomics.world"
            response = requests.get(f"{url}/v22/providers", timeout=30)
            response.raise_for_status()

            data = response.json()
            providers = data.get("providers", {}).get("docs", [])

            return pd.DataFrame(providers)

        except Exception as e:
            logger.error(f"Failed to get providers: {e}")
            # Return static provider list as fallback
            return pd.DataFrame(
                [{"code": k, "name": v} for k, v in self.PROVIDERS.items()]
            )

    def get_datasets(self, provider_code: str) -> pd.DataFrame:
        """
        Get datasets available from a provider.

        Args:
            provider_code: Provider code

        Returns:
            DataFrame with dataset information
        """
        self._ensure_initialized()

        try:
            import requests

            url = self._api_base_url or "https://api.db.nomics.world"
            response = requests.get(f"{url}/v22/providers/{provider_code}", timeout=30)
            response.raise_for_status()

            data = response.json()
            datasets = data.get("category_tree", [])

            # Flatten the category tree
            flat_datasets = []
            self._flatten_datasets(datasets, flat_datasets)

            return pd.DataFrame(flat_datasets)

        except Exception as e:
            logger.error(f"Failed to get datasets for {provider_code}: {e}")
            return pd.DataFrame()

    def _flatten_datasets(
        self,
        tree: List[Dict],
        result: List[Dict],
        parent: str = "",
    ) -> None:
        """Recursively flatten dataset category tree."""
        for item in tree:
            if "code" in item:
                result.append(
                    {
                        "code": item.get("code"),
                        "name": item.get("name"),
                        "parent": parent,
                    }
                )
            if "children" in item:
                self._flatten_datasets(
                    item["children"], result, item.get("name", parent)
                )

    def get_gdp(
        self,
        country: str,
        frequency: str = "A",
        real: bool = True,
    ) -> pd.DataFrame:
        """
        Get GDP data for a country.

        Args:
            country: ISO country code (e.g., 'USA', 'DEU', 'JPN')
            frequency: 'A' for annual, 'Q' for quarterly
            real: If True, get real GDP; otherwise nominal

        Returns:
            DataFrame with GDP data
        """
        # Try OECD first, then IMF
        try:
            # OECD QNA dataset
            measure = "VOBARSA" if real else "VOBSURA"  # Real vs Nominal
            series_code = f"{country}.B1_GE.{measure}.{frequency}"

            df = self.fetch_series("OECD", "QNA", series_code)
            if not df.empty:
                return df
        except Exception:
            pass

        # Fallback to IMF WEO
        try:
            indicator = "NGDP_R" if real else "NGDP"
            series_code = f"{country}.{indicator}"
            return self.fetch_series("IMF", "WEO:latest", series_code)
        except Exception as e:
            logger.error(f"Failed to get GDP for {country}: {e}")
            return pd.DataFrame()

    def get_inflation(
        self,
        country: str,
        measure: str = "CPI",
    ) -> pd.DataFrame:
        """
        Get inflation data for a country.

        Args:
            country: ISO country code
            measure: 'CPI' for consumer prices, 'PPI' for producer prices

        Returns:
            DataFrame with inflation data
        """
        try:
            if measure == "CPI":
                # Try Eurostat for EU countries
                if country in ["DEU", "FRA", "ITA", "ESP", "NLD"]:
                    return self.fetch_series(
                        "Eurostat", "prc_hicp_manr", f"M.RCH_A.CP00.{country}"
                    )
                # Try OECD MEI
                return self.fetch_series("OECD", "MEI", f"{country}.CPALTT01.IXOB.M")
            else:
                # Producer prices
                return self.fetch_series("OECD", "MEI", f"{country}.PIEAMP01.IXOB.M")
        except Exception as e:
            logger.error(f"Failed to get inflation for {country}: {e}")
            return pd.DataFrame()

    def get_unemployment(self, country: str) -> pd.DataFrame:
        """
        Get unemployment rate for a country.

        Args:
            country: ISO country code

        Returns:
            DataFrame with unemployment data
        """
        try:
            # OECD Short-Term Labour Statistics
            return self.fetch_series("OECD", "STLABOUR", f"{country}.LRUNTTTT.STSA.M")
        except Exception as e:
            logger.error(f"Failed to get unemployment for {country}: {e}")
            return pd.DataFrame()

    def get_interest_rates(
        self,
        country: str,
        rate_type: str = "policy",
    ) -> pd.DataFrame:
        """
        Get interest rate data.

        Args:
            country: ISO country code
            rate_type: 'policy', 'short', 'long'

        Returns:
            DataFrame with interest rate data
        """
        try:
            if rate_type == "policy":
                # Central bank policy rates
                return self.fetch_series("BIS", "WS_CBPOL_D_csv", f"D.{country}..")
            elif rate_type == "short":
                # 3-month rates
                return self.fetch_series("OECD", "MEI", f"{country}.IRSTCI01.ST.M")
            else:
                # 10-year government bonds
                return self.fetch_series("OECD", "MEI", f"{country}.IRLTLT01.ST.M")
        except Exception as e:
            logger.error(f"Failed to get interest rates for {country}: {e}")
            return pd.DataFrame()

    def get_trade_balance(self, country: str) -> pd.DataFrame:
        """
        Get trade balance data.

        Args:
            country: ISO country code

        Returns:
            DataFrame with trade balance data
        """
        try:
            return self.fetch_series("IMF", "DOT", f"{country}..TMG_CIF_USD")
        except Exception as e:
            logger.error(f"Failed to get trade balance for {country}: {e}")
            return pd.DataFrame()

    def get_current_account(self, country: str) -> pd.DataFrame:
        """
        Get current account balance data.

        Args:
            country: ISO country code

        Returns:
            DataFrame with current account data
        """
        try:
            return self.fetch_series("IMF", "BOP", f"{country}.BCA..")
        except Exception as e:
            logger.error(f"Failed to get current account for {country}: {e}")
            return pd.DataFrame()

    def get_money_supply(
        self,
        country: str,
        aggregate: str = "M2",
    ) -> pd.DataFrame:
        """
        Get money supply data.

        Args:
            country: ISO country code
            aggregate: 'M1', 'M2', or 'M3'

        Returns:
            DataFrame with money supply data
        """
        try:
            return self.fetch_series("OECD", "MEI", f"{country}.MAN{aggregate}.IXOB.M")
        except Exception as e:
            logger.error(f"Failed to get money supply for {country}: {e}")
            return pd.DataFrame()

    def clear_cache(self) -> None:
        """Clear all cached data."""
        self._cache.clear()
        logger.info("DBnomicsAdapter cache cleared")

    def health_check(self) -> bool:
        """
        Check if adapter is operational.

        Returns:
            True if healthy
        """
        if not _check_dbnomics_available():
            return False

        try:
            self._ensure_initialized()
            # Try a simple API call
            providers = self.get_providers()
            return len(providers) > 0
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False
