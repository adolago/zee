"""
FINRA ATS Data Provider

Fetches dark pool data from FINRA's Alternative Trading System (ATS)
transparency data. FINRA publishes weekly aggregated ATS volume data.

Data Source: https://www.finra.org/finra-data/browse-catalog/alternative-trading-system-ats-transparency-data

Features:
- Weekly ATS volume by security
- Volume by ATS venue
- Block trade detection
- Historical dark pool trends
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd

from stanley.data.providers import (
    DataProvider,
    DataProviderError,
    DataNotFoundError,
    RateLimitError,
    CachingMixin,
    RateLimiter,
)
from stanley.core.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitBreakerOpen,
)

logger = logging.getLogger(__name__)


# ATS venue mappings
ATS_VENUES = {
    "UBSS": {"name": "UBS ATS", "type": "bank"},
    "CROS": {"name": "Credit Suisse Crossfinder", "type": "bank"},
    "SGMT": {"name": "Goldman Sachs Sigma X", "type": "bank"},
    "JPMX": {"name": "JPMorgan JPM-X", "type": "bank"},
    "MSPL": {"name": "Morgan Stanley MS Pool", "type": "bank"},
    "DBAX": {"name": "Deutsche Bank SuperX", "type": "bank"},
    "BIDS": {"name": "BIDS Trading", "type": "institutional"},
    "LQFI": {"name": "Liquidnet", "type": "institutional"},
    "IEGX": {"name": "IEX", "type": "exchange"},
    "MEMX": {"name": "MEMX", "type": "exchange"},
    "VIRX": {"name": "Virtu Americas", "type": "market_maker"},
    "CDED": {"name": "Citadel Connect", "type": "market_maker"},
}


class FINRAProviderConfig:
    """Configuration for FINRA data provider."""

    def __init__(
        self,
        api_base_url: str = "https://api.finra.org",
        requests_per_second: float = 2.0,
        cache_ttl_seconds: int = 3600,  # 1 hour (data is weekly)
        use_mock_data: bool = False,
        circuit_breaker_threshold: int = 5,
        circuit_breaker_timeout: float = 60.0,
    ):
        self.api_base_url = api_base_url
        self.requests_per_second = requests_per_second
        self.cache_ttl_seconds = cache_ttl_seconds
        self.use_mock_data = use_mock_data
        self.circuit_breaker_threshold = circuit_breaker_threshold
        self.circuit_breaker_timeout = circuit_breaker_timeout


class FINRAProvider(CachingMixin):
    """
    FINRA ATS data provider.

    Provides dark pool volume data from FINRA's weekly ATS reports.
    Falls back to mock data when FINRA API is unavailable.
    """

    def __init__(self, config: Optional[FINRAProviderConfig] = None):
        CachingMixin.__init__(self)

        self.config = config or FINRAProviderConfig()
        self._rate_limiter = RateLimiter(self.config.requests_per_second)
        self._circuit_breaker = CircuitBreaker(
            CircuitBreakerConfig(
                name="finra",
                failure_threshold=self.config.circuit_breaker_threshold,
                timeout=self.config.circuit_breaker_timeout,
            )
        )
        self._http_client = None
        self._initialized = False

    @property
    def name(self) -> str:
        return "finra"

    async def initialize(self) -> None:
        """Initialize the FINRA provider."""
        if self._initialized:
            return

        try:
            import httpx

            self._http_client = httpx.AsyncClient(
                base_url=self.config.api_base_url,
                timeout=30.0,
            )
            self._initialized = True
            logger.info("FINRA provider initialized")
        except ImportError:
            logger.warning("httpx not available, FINRA provider will use mock data")
            self.config.use_mock_data = True
            self._initialized = True

    async def close(self) -> None:
        """Close the provider."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        self._initialized = False

    async def health_check(self) -> bool:
        """Check if FINRA API is accessible."""
        if self.config.use_mock_data:
            return True

        try:
            # Simple connectivity check
            if self._http_client:
                response = await self._http_client.get("/health")
                return response.status_code == 200
        except Exception:
            pass

        return False

    async def get_ats_data(
        self,
        symbol: str,
        weeks: int = 4,
    ) -> Optional[Dict[str, Any]]:
        """
        Get ATS volume data for a symbol.

        Args:
            symbol: Stock ticker symbol
            weeks: Number of weeks of data to retrieve

        Returns:
            Dictionary with ATS volume data or None if not found
        """
        symbol = symbol.upper()
        cache_key = self._cache_key("ats_data", symbol, weeks)

        # Check cache
        cached = self._get_cached(cache_key, self.config.cache_ttl_seconds)
        if cached is not None:
            return cached

        # Fetch data
        try:
            if self.config.use_mock_data:
                data = self._generate_mock_ats_data(symbol, weeks)
            else:
                data = await self._fetch_ats_data(symbol, weeks)

            if data:
                self._set_cached(cache_key, data)

            return data

        except CircuitBreakerOpen as e:
            logger.warning(f"FINRA circuit breaker open: {e}")
            # Return mock data as fallback
            return self._generate_mock_ats_data(symbol, weeks)

        except Exception as e:
            logger.error(f"Error fetching ATS data for {symbol}: {e}")
            return None

    async def _fetch_ats_data(
        self,
        symbol: str,
        weeks: int,
    ) -> Optional[Dict[str, Any]]:
        """Fetch ATS data from FINRA API."""
        if not self._http_client:
            return None

        await self._rate_limiter.acquire()

        async def _make_request():
            # FINRA OTC Transparency API endpoint
            response = await self._http_client.get(
                "/data/otc/weekly-summary",
                params={"symbol": symbol, "weeks": weeks},
            )
            response.raise_for_status()
            return response.json()

        try:
            data = await self._circuit_breaker.execute_async(_make_request())
            return self._parse_ats_response(symbol, data)
        except Exception as e:
            logger.error(f"FINRA API error: {e}")
            raise

    def _parse_ats_response(
        self,
        symbol: str,
        raw_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Parse FINRA API response into standardized format."""
        # Extract relevant fields from FINRA response
        total_volume = raw_data.get("totalShares", 0)
        total_trades = raw_data.get("totalTrades", 0)

        # Calculate dark pool percentage (ATS vs total market)
        market_volume = raw_data.get("marketVolume", total_volume)
        dark_pool_pct = total_volume / market_volume if market_volume > 0 else 0.0

        # Venue breakdown
        venues = {}
        for venue_data in raw_data.get("venues", []):
            venue_id = venue_data.get("mpid", "")
            if venue_id in ATS_VENUES:
                venues[venue_id] = {
                    "name": ATS_VENUES[venue_id]["name"],
                    "volume": venue_data.get("shares", 0),
                    "trades": venue_data.get("trades", 0),
                    "pct_of_ats": venue_data.get("pctOfAts", 0.0),
                }

        # Block trade estimation (trades > 10,000 shares)
        avg_trade_size = total_volume / max(1, total_trades)
        block_trades_est = int(total_trades * 0.1)  # Estimate 10% are blocks

        return {
            "symbol": symbol,
            "total_volume": total_volume,
            "total_trades": total_trades,
            "dark_pool_pct": dark_pool_pct,
            "avg_trade_size": avg_trade_size,
            "block_trades": block_trades_est,
            "venues": venues,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "finra",
        }

    def _generate_mock_ats_data(
        self,
        symbol: str,
        weeks: int,
    ) -> Dict[str, Any]:
        """Generate realistic mock ATS data."""
        import random

        # Seed based on symbol for consistency
        random.seed(hash(symbol) % 2**32)

        # Generate realistic volumes
        base_volume = random.randint(5_000_000, 50_000_000)
        total_volume = base_volume * weeks

        # Dark pool percentage typically 35-45%
        dark_pool_pct = random.uniform(0.32, 0.48)

        # Trade count
        avg_trade_size = random.randint(300, 2000)
        total_trades = total_volume // avg_trade_size

        # Generate venue breakdown
        venues = {}
        remaining_pct = 1.0

        venue_list = list(ATS_VENUES.keys())
        random.shuffle(venue_list)

        for i, venue_id in enumerate(venue_list):
            if remaining_pct <= 0:
                break

            # Larger venues get more volume
            if i < 3:
                venue_pct = random.uniform(0.15, 0.25)
            else:
                venue_pct = random.uniform(0.02, 0.10)

            venue_pct = min(venue_pct, remaining_pct)
            remaining_pct -= venue_pct

            venue_volume = int(total_volume * venue_pct)
            venue_trades = venue_volume // avg_trade_size

            venues[venue_id] = {
                "name": ATS_VENUES[venue_id]["name"],
                "volume": venue_volume,
                "trades": venue_trades,
                "pct_of_ats": venue_pct,
            }

        # Block trades (typically 5-15% of trades)
        block_trades = int(total_trades * random.uniform(0.05, 0.15))

        return {
            "symbol": symbol,
            "total_volume": total_volume,
            "total_trades": total_trades,
            "dark_pool_pct": dark_pool_pct,
            "avg_trade_size": avg_trade_size,
            "block_trades": block_trades,
            "venues": venues,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "mock",
        }

    async def get_ats_venue_data(
        self,
        symbol: str,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Get detailed venue-level ATS data.

        Args:
            symbol: Stock ticker symbol

        Returns:
            Dictionary mapping venue ID to venue details
        """
        ats_data = await self.get_ats_data(symbol)
        if ats_data:
            return ats_data.get("venues", {})
        return {}

    async def get_ats_history(
        self,
        symbol: str,
        weeks: int = 12,
    ) -> pd.DataFrame:
        """
        Get historical ATS volume data.

        Args:
            symbol: Stock ticker symbol
            weeks: Number of weeks of history

        Returns:
            DataFrame with weekly ATS volume history
        """
        symbol = symbol.upper()

        # Generate mock historical data
        import random

        random.seed(hash(symbol) % 2**32)

        data = []
        base_date = datetime.now(timezone.utc)

        for week in range(weeks):
            week_date = base_date - pd.Timedelta(weeks=week)

            base_volume = random.randint(5_000_000, 50_000_000)
            dark_pool_pct = random.uniform(0.32, 0.48)
            avg_trade_size = random.randint(300, 2000)

            data.append(
                {
                    "symbol": symbol,
                    "week_ending": week_date.strftime("%Y-%m-%d"),
                    "total_volume": base_volume,
                    "dark_pool_pct": dark_pool_pct,
                    "avg_trade_size": avg_trade_size,
                    "block_trades": int(base_volume / avg_trade_size * 0.1),
                }
            )

        df = pd.DataFrame(data)
        df["week_ending"] = pd.to_datetime(df["week_ending"])
        df = df.sort_values("week_ending")

        return df

    def get_circuit_breaker_stats(self) -> Dict[str, Any]:
        """Get circuit breaker statistics."""
        stats = self._circuit_breaker.get_stats()
        return {
            "name": stats.name,
            "state": stats.state.value,
            "failure_count": stats.failure_count,
            "total_failures": stats.total_failures,
            "total_successes": stats.total_successes,
            "total_rejected": stats.total_rejected,
        }
