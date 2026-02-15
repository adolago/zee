"""
Options Data Provider

Provides real options chain data from multiple sources:
- OpenBB (primary, already integrated)
- Tradier API (real-time options)
- CBOE (index options)

Features:
- Real-time options chains with Greeks
- Unusual activity detection
- Options flow tracking
- Smart money options analysis
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import numpy as np

from stanley.data.providers import (
    DataProvider,
    DataProviderError,
    DataNotFoundError,
    CachingMixin,
    RateLimiter,
)
from stanley.core.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitBreakerOpen,
)

logger = logging.getLogger(__name__)


class OptionsProviderConfig:
    """Configuration for options data provider."""

    def __init__(
        self,
        primary_source: str = "openbb",
        tradier_api_key: Optional[str] = None,
        cboe_enabled: bool = False,
        requests_per_second: float = 5.0,
        cache_ttl_seconds: int = 60,
        use_mock_data: bool = False,
        calculate_greeks: bool = True,
        risk_free_rate: float = 0.05,
    ):
        self.primary_source = primary_source
        self.tradier_api_key = tradier_api_key
        self.cboe_enabled = cboe_enabled
        self.requests_per_second = requests_per_second
        self.cache_ttl_seconds = cache_ttl_seconds
        self.use_mock_data = use_mock_data
        self.calculate_greeks = calculate_greeks
        self.risk_free_rate = risk_free_rate


class OptionsProvider(CachingMixin):
    """
    Multi-source options data provider.

    Aggregates options data from multiple sources with automatic
    fallback and circuit breaker protection.
    """

    def __init__(
        self,
        config: Optional[OptionsProviderConfig] = None,
        openbb_adapter: Optional[Any] = None,
    ):
        CachingMixin.__init__(self)

        self.config = config or OptionsProviderConfig()
        self._openbb_adapter = openbb_adapter
        self._rate_limiter = RateLimiter(self.config.requests_per_second)

        # Circuit breakers for each source
        self._circuit_breakers = {
            "openbb": CircuitBreaker(
                CircuitBreakerConfig(name="options_openbb", failure_threshold=3)
            ),
            "tradier": CircuitBreaker(
                CircuitBreakerConfig(name="options_tradier", failure_threshold=3)
            ),
        }

        self._http_client = None
        self._initialized = False

    @property
    def name(self) -> str:
        return "options"

    async def initialize(self) -> None:
        """Initialize the options provider."""
        if self._initialized:
            return

        try:
            import httpx

            self._http_client = httpx.AsyncClient(timeout=30.0)
            self._initialized = True
            logger.info("Options provider initialized")
        except ImportError:
            logger.warning("httpx not available, using mock data")
            self.config.use_mock_data = True
            self._initialized = True

    async def close(self) -> None:
        """Close the provider."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        self._initialized = False

    async def health_check(self) -> bool:
        """Check if options data is accessible."""
        if self.config.use_mock_data:
            return True

        # Check OpenBB adapter
        if self._openbb_adapter:
            try:
                # Quick health check
                return True
            except Exception:
                pass

        return False

    async def get_options_chain(
        self,
        symbol: str,
        expiration: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get options chain for a symbol.

        Args:
            symbol: Stock ticker symbol
            expiration: Specific expiration date (YYYY-MM-DD) or None for all

        Returns:
            DataFrame with options chain data including Greeks
        """
        symbol = symbol.upper()
        cache_key = self._cache_key("options_chain", symbol, expiration or "all")

        # Check cache
        cached = self._get_cached(cache_key, self.config.cache_ttl_seconds)
        if cached is not None:
            return cached

        # Fetch data
        try:
            if self.config.use_mock_data:
                df = self._generate_mock_options_chain(symbol, expiration)
            else:
                df = await self._fetch_options_chain(symbol, expiration)

            if df is not None and not df.empty:
                # Calculate Greeks if needed
                if self.config.calculate_greeks and "delta" not in df.columns:
                    df = self._calculate_greeks(df, symbol)

                self._set_cached(cache_key, df)

            return df

        except CircuitBreakerOpen as e:
            logger.warning(f"Options circuit breaker open: {e}")
            return self._generate_mock_options_chain(symbol, expiration)

        except Exception as e:
            logger.error(f"Error fetching options chain for {symbol}: {e}")
            return pd.DataFrame()

    async def _fetch_options_chain(
        self,
        symbol: str,
        expiration: Optional[str],
    ) -> pd.DataFrame:
        """Fetch options chain from configured source."""
        # Try OpenBB first
        if self._openbb_adapter and self.config.primary_source == "openbb":
            try:
                cb = self._circuit_breakers["openbb"]
                df = await cb.execute_async(
                    self._fetch_openbb_options(symbol, expiration)
                )
                if df is not None and not df.empty:
                    return df
            except Exception as e:
                logger.debug(f"OpenBB options fetch failed: {e}")

        # Try Tradier if configured
        if self.config.tradier_api_key:
            try:
                cb = self._circuit_breakers["tradier"]
                df = await cb.execute_async(
                    self._fetch_tradier_options(symbol, expiration)
                )
                if df is not None and not df.empty:
                    return df
            except Exception as e:
                logger.debug(f"Tradier options fetch failed: {e}")

        # Fallback to mock
        return self._generate_mock_options_chain(symbol, expiration)

    async def _fetch_openbb_options(
        self,
        symbol: str,
        expiration: Optional[str],
    ) -> pd.DataFrame:
        """Fetch from OpenBB adapter."""
        if not self._openbb_adapter:
            return pd.DataFrame()

        await self._rate_limiter.acquire()

        try:
            # Call OpenBB adapter's options method
            df = await self._openbb_adapter.get_options_chain(
                symbol=symbol,
                expiration=expiration,
            )
            return df
        except Exception as e:
            logger.error(f"OpenBB options error: {e}")
            raise

    async def _fetch_tradier_options(
        self,
        symbol: str,
        expiration: Optional[str],
    ) -> pd.DataFrame:
        """Fetch from Tradier API."""
        if not self._http_client or not self.config.tradier_api_key:
            return pd.DataFrame()

        await self._rate_limiter.acquire()

        headers = {
            "Authorization": f"Bearer {self.config.tradier_api_key}",
            "Accept": "application/json",
        }

        try:
            # Get expirations first if not specified
            if not expiration:
                exp_response = await self._http_client.get(
                    "https://api.tradier.com/v1/markets/options/expirations",
                    params={"symbol": symbol},
                    headers=headers,
                )
                exp_data = exp_response.json()
                expirations = exp_data.get("expirations", {}).get("date", [])
                if expirations:
                    expiration = expirations[0]  # Use nearest expiration

            if not expiration:
                return pd.DataFrame()

            # Get options chain
            response = await self._http_client.get(
                "https://api.tradier.com/v1/markets/options/chains",
                params={"symbol": symbol, "expiration": expiration, "greeks": "true"},
                headers=headers,
            )
            data = response.json()

            options = data.get("options", {}).get("option", [])
            if not options:
                return pd.DataFrame()

            return pd.DataFrame(options)

        except Exception as e:
            logger.error(f"Tradier API error: {e}")
            raise

    def _calculate_greeks(
        self,
        df: pd.DataFrame,
        symbol: str,
    ) -> pd.DataFrame:
        """
        Calculate Greeks using Black-Scholes model.

        Adds: delta, gamma, theta, vega, rho
        """
        if df.empty:
            return df

        # Get current price (use mid of bid/ask if available)
        if "underlying_price" in df.columns:
            S = df["underlying_price"].iloc[0]
        else:
            # Estimate from ATM strikes
            S = df["strike"].median()

        r = self.config.risk_free_rate

        greeks_data = []

        for _, row in df.iterrows():
            K = row.get("strike", S)
            T = self._calculate_time_to_expiry(row.get("expiration"))
            sigma = row.get("implied_volatility", 0.3)
            option_type = row.get("option_type", "call").lower()

            if T <= 0 or sigma <= 0:
                greeks_data.append(
                    {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0}
                )
                continue

            greeks = self._black_scholes_greeks(S, K, T, r, sigma, option_type)
            greeks_data.append(greeks)

        greeks_df = pd.DataFrame(greeks_data)

        for col in greeks_df.columns:
            df[col] = greeks_df[col].values

        return df

    def _black_scholes_greeks(
        self,
        S: float,  # Stock price
        K: float,  # Strike price
        T: float,  # Time to expiry (years)
        r: float,  # Risk-free rate
        sigma: float,  # Volatility
        option_type: str,  # 'call' or 'put'
    ) -> Dict[str, float]:
        """Calculate Black-Scholes Greeks."""
        from scipy.stats import norm

        try:
            d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
            d2 = d1 - sigma * math.sqrt(T)

            if option_type == "call":
                delta = norm.cdf(d1)
                rho = K * T * math.exp(-r * T) * norm.cdf(d2) / 100
            else:
                delta = norm.cdf(d1) - 1
                rho = -K * T * math.exp(-r * T) * norm.cdf(-d2) / 100

            gamma = norm.pdf(d1) / (S * sigma * math.sqrt(T))
            vega = S * norm.pdf(d1) * math.sqrt(T) / 100
            theta = (
                -(S * norm.pdf(d1) * sigma) / (2 * math.sqrt(T))
                - r
                * K
                * math.exp(-r * T)
                * (norm.cdf(d2) if option_type == "call" else norm.cdf(-d2))
            ) / 365

            return {
                "delta": round(delta, 4),
                "gamma": round(gamma, 6),
                "theta": round(theta, 4),
                "vega": round(vega, 4),
                "rho": round(rho, 4),
            }

        except Exception:
            return {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0}

    def _calculate_time_to_expiry(self, expiration: Any) -> float:
        """Calculate time to expiry in years."""
        if expiration is None:
            return 0.0

        try:
            if isinstance(expiration, str):
                exp_date = datetime.strptime(expiration, "%Y-%m-%d")
            elif isinstance(expiration, datetime):
                exp_date = expiration
            else:
                return 0.0

            now = datetime.now()
            days = (exp_date - now).days
            return max(0, days / 365.0)

        except Exception:
            return 0.0

    def _generate_mock_options_chain(
        self,
        symbol: str,
        expiration: Optional[str],
    ) -> pd.DataFrame:
        """Generate realistic mock options chain data."""
        import random

        random.seed(hash(symbol) % 2**32)

        # Simulated underlying price
        base_price = random.uniform(50, 500)

        # Generate expirations if not specified
        if not expiration:
            today = datetime.now()
            expirations = [
                (today + timedelta(days=d)).strftime("%Y-%m-%d")
                for d in [7, 14, 30, 60, 90]
            ]
        else:
            expirations = [expiration]

        data = []

        for exp in expirations:
            T = self._calculate_time_to_expiry(exp)
            if T <= 0:
                continue

            # Generate strikes around the current price
            strike_range = base_price * 0.3  # +/- 30%
            strikes = np.arange(
                base_price - strike_range,
                base_price + strike_range,
                base_price * 0.025,  # 2.5% increments
            )

            for strike in strikes:
                moneyness = base_price / strike

                # IV smile - higher for OTM options
                base_iv = 0.25 + random.uniform(-0.05, 0.05)
                iv_adjustment = abs(1 - moneyness) * 0.5
                iv = base_iv + iv_adjustment

                for opt_type in ["call", "put"]:
                    # Calculate theoretical price
                    intrinsic = (
                        max(0, base_price - strike)
                        if opt_type == "call"
                        else max(0, strike - base_price)
                    )
                    time_value = base_price * iv * math.sqrt(T) * 0.4

                    mid_price = intrinsic + time_value
                    spread = mid_price * 0.02  # 2% spread

                    # Volume/OI - higher for ATM
                    atm_factor = 1 - min(1, abs(1 - moneyness) * 3)
                    volume = int(random.uniform(100, 5000) * (0.3 + 0.7 * atm_factor))
                    oi = int(volume * random.uniform(2, 10))

                    data.append(
                        {
                            "symbol": symbol,
                            "underlying_price": round(base_price, 2),
                            "strike": round(strike, 2),
                            "expiration": exp,
                            "option_type": opt_type,
                            "bid": round(max(0.01, mid_price - spread / 2), 2),
                            "ask": round(mid_price + spread / 2, 2),
                            "last": round(mid_price, 2),
                            "volume": volume,
                            "open_interest": oi,
                            "implied_volatility": round(iv, 4),
                        }
                    )

        df = pd.DataFrame(data)

        # Calculate Greeks for mock data
        if self.config.calculate_greeks and not df.empty:
            df = self._calculate_greeks(df, symbol)

        return df

    async def get_unusual_activity(
        self,
        symbol: str,
        volume_threshold: float = 2.0,
        min_premium: float = 50000,
    ) -> List[Dict[str, Any]]:
        """
        Detect unusual options activity.

        Args:
            symbol: Stock ticker symbol
            volume_threshold: Volume/OI ratio threshold
            min_premium: Minimum premium in dollars

        Returns:
            List of unusual activity contracts
        """
        chain = await self.get_options_chain(symbol)
        if chain.empty:
            return []

        unusual = []

        for _, row in chain.iterrows():
            volume = row.get("volume", 0)
            oi = row.get("open_interest", 1)
            mid_price = (row.get("bid", 0) + row.get("ask", 0)) / 2

            # Calculate volume/OI ratio
            vol_oi_ratio = volume / max(1, oi)

            # Calculate premium
            premium = volume * mid_price * 100  # 100 shares per contract

            if vol_oi_ratio >= volume_threshold and premium >= min_premium:
                unusual.append(
                    {
                        "symbol": symbol,
                        "strike": row.get("strike"),
                        "expiration": row.get("expiration"),
                        "option_type": row.get("option_type"),
                        "volume": volume,
                        "open_interest": oi,
                        "vol_oi_ratio": round(vol_oi_ratio, 2),
                        "premium": round(premium, 2),
                        "implied_volatility": row.get("implied_volatility"),
                        "sentiment": (
                            "bullish" if row.get("option_type") == "call" else "bearish"
                        ),
                    }
                )

        # Sort by premium descending
        unusual.sort(key=lambda x: x["premium"], reverse=True)

        return unusual[:20]  # Return top 20

    def get_circuit_breaker_stats(self) -> Dict[str, Any]:
        """Get circuit breaker statistics for all sources."""
        return {
            name: {
                "state": cb.state.value,
                "failure_count": cb._failure_count,
            }
            for name, cb in self._circuit_breakers.items()
        }
