"""
Configuration for OpenBB Data Client Integration with NautilusTrader

Provides configuration classes for connecting OpenBB data sources
to NautilusTrader's data infrastructure.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class OpenBBDataClientConfig:
    """
    Configuration for the OpenBB data client.

    Attributes:
        venue: The venue identifier for this data source (e.g., "OPENBB").
        openbb_token: OpenBB API token for authentication.
        provider: Default data provider within OpenBB (e.g., "yfinance", "polygon").
        base_currency: Base currency for price data (default: "USD").
        request_timeout_secs: Timeout for data requests in seconds.
        max_retries: Maximum number of retry attempts for failed requests.
        retry_delay_secs: Delay between retry attempts in seconds.
        cache_enabled: Whether to cache data locally.
        cache_ttl_secs: Time-to-live for cached data in seconds.
        rate_limit_per_minute: Maximum requests per minute to OpenBB.
    """

    venue: str = "OPENBB"
    openbb_token: Optional[str] = None
    provider: str = "yfinance"
    base_currency: str = "USD"
    request_timeout_secs: float = 30.0
    max_retries: int = 3
    retry_delay_secs: float = 1.0
    cache_enabled: bool = True
    cache_ttl_secs: int = 300
    rate_limit_per_minute: int = 60


@dataclass
class InstrumentConfig:
    """
    Configuration for a single instrument.

    Attributes:
        symbol: The instrument symbol (e.g., "AAPL").
        asset_class: Asset class (EQUITY, ETF, CRYPTO, etc.).
        currency: Quote currency for the instrument.
        exchange: Exchange where the instrument trades.
        lot_size: Minimum lot size for the instrument.
        tick_size: Minimum price increment.
        multiplier: Contract multiplier (for derivatives).
    """

    symbol: str
    asset_class: str = "EQUITY"
    currency: str = "USD"
    exchange: str = "NASDAQ"
    lot_size: float = 1.0
    tick_size: float = 0.01
    multiplier: float = 1.0


@dataclass
class BarSubscriptionConfig:
    """
    Configuration for bar data subscriptions.

    Attributes:
        symbol: Instrument symbol to subscribe to.
        aggregation: Bar aggregation type ("time", "tick", "volume").
        interval: Aggregation interval (e.g., 1 for 1-minute bars).
        interval_unit: Unit for the interval ("minute", "hour", "day").
        start_time: Optional start time for historical data.
        end_time: Optional end time for historical data.
    """

    symbol: str
    aggregation: str = "time"
    interval: int = 1
    interval_unit: str = "minute"
    start_time: Optional[str] = None
    end_time: Optional[str] = None


@dataclass
class OpenBBProviderConfig:
    """
    Configuration for specific OpenBB data providers.

    Different providers may have different capabilities and rate limits.

    Attributes:
        name: Provider name (e.g., "yfinance", "polygon", "fmp").
        api_key: Provider-specific API key (if required).
        priority: Priority for provider selection (lower = higher priority).
        supports_intraday: Whether provider supports intraday data.
        supports_realtime: Whether provider supports real-time data.
        max_symbols_per_request: Maximum symbols in a single request.
        rate_limit_per_minute: Provider-specific rate limit.
    """

    name: str
    api_key: Optional[str] = None
    priority: int = 1
    supports_intraday: bool = True
    supports_realtime: bool = False
    max_symbols_per_request: int = 100
    rate_limit_per_minute: int = 60


@dataclass
class OpenBBDataClientConfigFull:
    """
    Full configuration for OpenBB data client with multiple providers.

    Attributes:
        base_config: Base OpenBB data client configuration.
        providers: List of provider configurations.
        instruments: Pre-configured instrument definitions.
        default_bar_config: Default bar subscription configuration.
    """

    base_config: OpenBBDataClientConfig = field(default_factory=OpenBBDataClientConfig)
    providers: list[OpenBBProviderConfig] = field(default_factory=list)
    instruments: list[InstrumentConfig] = field(default_factory=list)
    default_bar_config: BarSubscriptionConfig = field(
        default_factory=lambda: BarSubscriptionConfig(symbol="")
    )

    def get_provider(self, name: str) -> Optional[OpenBBProviderConfig]:
        """Get provider configuration by name."""
        for provider in self.providers:
            if provider.name == name:
                return provider
        return None

    def get_instrument(self, symbol: str) -> Optional[InstrumentConfig]:
        """Get instrument configuration by symbol."""
        for instrument in self.instruments:
            if instrument.symbol == symbol:
                return instrument
        return None
