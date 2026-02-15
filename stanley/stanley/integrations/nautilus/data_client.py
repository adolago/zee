"""
OpenBB Data Client for NautilusTrader

A custom DataClient implementation that fetches data from OpenBB
and converts it to NautilusTrader format for backtesting and live trading.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional

import pandas as pd

from nautilus_trader.cache.cache import Cache
from nautilus_trader.common.component import Clock, MessageBus
from nautilus_trader.data.client import DataClient
from nautilus_trader.model.data import Bar, BarType, DataType, QuoteTick, TradeTick
from nautilus_trader.model.enums import BarAggregation
from nautilus_trader.model.identifiers import ClientId, InstrumentId, Venue
from nautilus_trader.model.instruments import Equity

from stanley.integrations.nautilus.config import (
    InstrumentConfig,
    OpenBBDataClientConfig,
)
from stanley.integrations.nautilus.data_types import (
    OpenBBBarConverter,
    OpenBBInstrumentProvider,
    OpenBBQuoteTickConverter,
    OpenBBTradeTickConverter,
)

logger = logging.getLogger(__name__)


class OpenBBDataClient(DataClient):
    """
    A NautilusTrader DataClient that uses OpenBB as its data source.

    This client bridges OpenBB's market data API with NautilusTrader's
    data infrastructure, supporting:
    - Historical bar data requests
    - Bar data subscriptions (simulated for backtesting)
    - Instrument definitions

    Usage:
        config = OpenBBDataClientConfig(
            venue="OPENBB",
            openbb_token="your-token",
            provider="yfinance",
        )

        client = OpenBBDataClient(
            msgbus=msgbus,
            cache=cache,
            clock=clock,
            config=config,
        )

        # Request historical bars
        bars = await client.request_bars(bar_type, start, end)

        # Subscribe to bar updates
        await client.subscribe_bars(bar_type)
    """

    def __init__(
        self,
        msgbus: MessageBus,
        cache: Cache,
        clock: Clock,
        config: OpenBBDataClientConfig,
    ):
        """
        Initialize the OpenBB data client.

        Args:
            msgbus: NautilusTrader message bus.
            cache: NautilusTrader cache.
            clock: NautilusTrader clock.
            config: OpenBB data client configuration.
        """
        super().__init__(
            client_id=ClientId(config.venue),
            venue=Venue(config.venue),
            msgbus=msgbus,
            cache=cache,
            clock=clock,
        )

        self._config = config
        self._openbb = None  # Lazy-loaded OpenBB client
        self._instrument_provider = OpenBBInstrumentProvider(venue=config.venue)

        # Subscription tracking
        self._bar_subscriptions: dict[BarType, bool] = {}
        self._quote_subscriptions: set[InstrumentId] = set()
        self._trade_subscriptions: set[InstrumentId] = set()

        # Converters cache
        self._bar_converters: dict[BarType, OpenBBBarConverter] = {}
        self._quote_converters: dict[InstrumentId, OpenBBQuoteTickConverter] = {}
        self._trade_converters: dict[InstrumentId, OpenBBTradeTickConverter] = {}

        # Rate limiting
        self._last_request_time: float = 0
        self._request_interval = 60.0 / config.rate_limit_per_minute

        logger.info(f"OpenBBDataClient initialized for venue {config.venue}")

    @property
    def instrument_provider(self) -> OpenBBInstrumentProvider:
        """Get the instrument provider."""
        return self._instrument_provider

    async def _connect(self) -> None:
        """Connect to OpenBB data source."""
        try:
            from openbb import obb

            # Configure OpenBB with token if provided
            if self._config.openbb_token:
                obb.account.login(pat=self._config.openbb_token)

            self._openbb = obb
            logger.info("Connected to OpenBB data source")

        except ImportError:
            logger.error(
                "OpenBB is not installed. Please install with: pip install openbb"
            )
            raise
        except Exception as e:
            logger.error(f"Failed to connect to OpenBB: {e}")
            raise

    async def _disconnect(self) -> None:
        """Disconnect from OpenBB data source."""
        self._openbb = None
        self._bar_subscriptions.clear()
        self._quote_subscriptions.clear()
        self._trade_subscriptions.clear()
        logger.info("Disconnected from OpenBB data source")

    def _ensure_connected(self) -> None:
        """Ensure OpenBB client is connected."""
        if self._openbb is None:
            # Synchronous fallback for when not using async
            try:
                from openbb import obb

                if self._config.openbb_token:
                    obb.account.login(pat=self._config.openbb_token)
                self._openbb = obb
            except ImportError:
                raise RuntimeError("OpenBB is not installed")

    async def _rate_limit(self) -> None:
        """Apply rate limiting between requests."""
        current_time = asyncio.get_event_loop().time()
        elapsed = current_time - self._last_request_time
        if elapsed < self._request_interval:
            await asyncio.sleep(self._request_interval - elapsed)
        self._last_request_time = asyncio.get_event_loop().time()

    # -------------------------------------------------------------------------
    # Instrument Methods
    # -------------------------------------------------------------------------

    def add_instrument(self, instrument: Equity) -> None:
        """
        Add an instrument definition to the client.

        Args:
            instrument: The equity instrument to add.
        """
        self._instrument_provider.add_instrument(instrument)
        self._cache.add_instrument(instrument)

    def create_instrument(
        self,
        symbol: str,
        exchange: str = "NASDAQ",
        currency: str = "USD",
        tick_size: float = 0.01,
        lot_size: float = 1.0,
    ) -> Equity:
        """
        Create and register an equity instrument.

        Args:
            symbol: Instrument symbol.
            exchange: Exchange name.
            currency: Quote currency.
            tick_size: Minimum price increment.
            lot_size: Minimum lot size.

        Returns:
            The created Equity instrument.
        """
        config = InstrumentConfig(
            symbol=symbol,
            asset_class="EQUITY",
            currency=currency,
            exchange=exchange,
            tick_size=tick_size,
            lot_size=lot_size,
        )

        instrument = self._instrument_provider.create_equity(config)
        self._cache.add_instrument(instrument)
        return instrument

    def get_instrument(self, instrument_id: InstrumentId) -> Optional[Equity]:
        """
        Get an instrument by ID.

        Args:
            instrument_id: The instrument identifier.

        Returns:
            The instrument or None if not found.
        """
        return self._instrument_provider.get_instrument(instrument_id)

    # -------------------------------------------------------------------------
    # Bar Data Methods
    # -------------------------------------------------------------------------

    def _get_bar_converter(self, bar_type: BarType) -> OpenBBBarConverter:
        """Get or create a bar converter for the given bar type."""
        if bar_type not in self._bar_converters:
            instrument = self._instrument_provider.get_instrument(
                bar_type.instrument_id
            )
            price_precision = instrument.price_precision if instrument else 2

            self._bar_converters[bar_type] = OpenBBBarConverter(
                instrument_id=bar_type.instrument_id,
                bar_type=bar_type,
                price_precision=price_precision,
                size_precision=0,
            )
        return self._bar_converters[bar_type]

    async def request_bars(
        self,
        bar_type: BarType,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        limit: Optional[int] = None,
        correlation_id: Optional[str] = None,
    ) -> list[Bar]:
        """
        Request historical bar data from OpenBB.

        Args:
            bar_type: The bar type specification.
            start: Start datetime for the request.
            end: End datetime for the request.
            limit: Maximum number of bars to return.
            correlation_id: Optional correlation ID for the request.

        Returns:
            List of Bar objects.
        """
        self._ensure_connected()
        await self._rate_limit()

        symbol = bar_type.instrument_id.symbol.value
        interval = self._bar_type_to_openbb_interval(bar_type)

        try:
            # Fetch data from OpenBB
            df = await self._fetch_ohlcv_data(
                symbol=symbol,
                start=start,
                end=end,
                interval=interval,
                limit=limit,
            )

            if df is None or df.empty:
                logger.warning(f"No data returned for {symbol}")
                return []

            # Convert to Nautilus bars
            converter = self._get_bar_converter(bar_type)
            bars = converter.convert_dataframe(df)

            logger.info(f"Fetched {len(bars)} bars for {symbol}")
            return bars

        except Exception as e:
            logger.error(f"Failed to request bars for {symbol}: {e}")
            return []

    async def _fetch_ohlcv_data(
        self,
        symbol: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        interval: str = "1d",
        limit: Optional[int] = None,
    ) -> Optional[pd.DataFrame]:
        """
        Fetch OHLCV data from OpenBB.

        Args:
            symbol: The symbol to fetch.
            start: Start datetime.
            end: End datetime.
            interval: Bar interval string.
            limit: Maximum number of bars.

        Returns:
            DataFrame with OHLCV data or None.
        """
        try:
            # Build request parameters
            params = {
                "symbol": symbol,
                "provider": self._config.provider,
            }

            if start:
                params["start_date"] = start.strftime("%Y-%m-%d")
            if end:
                params["end_date"] = end.strftime("%Y-%m-%d")

            # Determine if we need intraday or daily data
            if interval in ("1d", "1wk", "1mo"):
                # Daily/weekly/monthly data
                result = self._openbb.equity.price.historical(**params)
            else:
                # Intraday data
                params["interval"] = interval
                result = self._openbb.equity.price.historical(**params)

            # Extract DataFrame from OpenBB result
            if hasattr(result, "to_df"):
                df = result.to_df()
            elif hasattr(result, "results"):
                df = pd.DataFrame(result.results)
            else:
                df = pd.DataFrame(result)

            # Apply limit if specified
            if limit and len(df) > limit:
                df = df.tail(limit)

            return df

        except Exception as e:
            logger.error(f"Failed to fetch OHLCV data for {symbol}: {e}")
            return None

    def _bar_type_to_openbb_interval(self, bar_type: BarType) -> str:
        """
        Convert a NautilusTrader BarType to an OpenBB interval string.

        Args:
            bar_type: The bar type specification.

        Returns:
            OpenBB interval string (e.g., "1m", "5m", "1h", "1d").
        """
        step = bar_type.bar_spec.step
        aggregation = bar_type.bar_spec.aggregation

        interval_map = {
            BarAggregation.SECOND: "s",
            BarAggregation.MINUTE: "m",
            BarAggregation.HOUR: "h",
            BarAggregation.DAY: "d",
            BarAggregation.WEEK: "wk",
            BarAggregation.MONTH: "mo",
        }

        unit = interval_map.get(aggregation, "d")
        return f"{step}{unit}"

    async def subscribe_bars(self, bar_type: BarType) -> None:
        """
        Subscribe to bar data updates.

        Note: OpenBB does not support real-time streaming, so this
        subscription is tracked for polling-based updates.

        Args:
            bar_type: The bar type to subscribe to.
        """
        self._bar_subscriptions[bar_type] = True
        logger.info(f"Subscribed to bars: {bar_type}")

    async def unsubscribe_bars(self, bar_type: BarType) -> None:
        """
        Unsubscribe from bar data updates.

        Args:
            bar_type: The bar type to unsubscribe from.
        """
        self._bar_subscriptions.pop(bar_type, None)
        logger.info(f"Unsubscribed from bars: {bar_type}")

    # -------------------------------------------------------------------------
    # Quote Data Methods
    # -------------------------------------------------------------------------

    def _get_quote_converter(
        self, instrument_id: InstrumentId
    ) -> OpenBBQuoteTickConverter:
        """Get or create a quote tick converter."""
        if instrument_id not in self._quote_converters:
            instrument = self._instrument_provider.get_instrument(instrument_id)
            price_precision = instrument.price_precision if instrument else 2

            self._quote_converters[instrument_id] = OpenBBQuoteTickConverter(
                instrument_id=instrument_id,
                price_precision=price_precision,
                size_precision=0,
            )
        return self._quote_converters[instrument_id]

    async def request_quote_ticks(
        self,
        instrument_id: InstrumentId,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        limit: Optional[int] = None,
    ) -> list[QuoteTick]:
        """
        Request historical quote tick data.

        Note: OpenBB has limited quote tick data availability.
        This method attempts to fetch available quote data.

        Args:
            instrument_id: The instrument to request quotes for.
            start: Start datetime.
            end: End datetime.
            limit: Maximum number of quotes.

        Returns:
            List of QuoteTick objects.
        """
        self._ensure_connected()
        await self._rate_limit()

        symbol = instrument_id.symbol.value

        try:
            # Try to fetch quote data from OpenBB
            result = self._openbb.equity.price.quote(
                symbol=symbol,
                provider=self._config.provider,
            )

            if hasattr(result, "to_df"):
                df = result.to_df()
            elif hasattr(result, "results"):
                df = pd.DataFrame(
                    [result.results]
                    if not isinstance(result.results, list)
                    else result.results
                )
            else:
                df = pd.DataFrame([result])

            if df.empty:
                return []

            converter = self._get_quote_converter(instrument_id)

            # Map OpenBB quote columns to expected format
            if "bid" not in df.columns and "bidPrice" in df.columns:
                df["bid"] = df["bidPrice"]
            if "ask" not in df.columns and "askPrice" in df.columns:
                df["ask"] = df["askPrice"]
            if "bid_size" not in df.columns and "bidSize" in df.columns:
                df["bid_size"] = df["bidSize"]
            if "ask_size" not in df.columns and "askSize" in df.columns:
                df["ask_size"] = df["askSize"]
            if "timestamp" not in df.columns:
                df["timestamp"] = pd.Timestamp.now(tz="UTC")

            return converter.convert_dataframe(df)

        except Exception as e:
            logger.warning(f"Failed to request quote ticks for {symbol}: {e}")
            return []

    async def subscribe_quote_ticks(self, instrument_id: InstrumentId) -> None:
        """
        Subscribe to quote tick updates.

        Args:
            instrument_id: The instrument to subscribe to.
        """
        self._quote_subscriptions.add(instrument_id)
        logger.info(f"Subscribed to quote ticks: {instrument_id}")

    async def unsubscribe_quote_ticks(self, instrument_id: InstrumentId) -> None:
        """
        Unsubscribe from quote tick updates.

        Args:
            instrument_id: The instrument to unsubscribe from.
        """
        self._quote_subscriptions.discard(instrument_id)
        logger.info(f"Unsubscribed from quote ticks: {instrument_id}")

    # -------------------------------------------------------------------------
    # Trade Data Methods
    # -------------------------------------------------------------------------

    def _get_trade_converter(
        self, instrument_id: InstrumentId
    ) -> OpenBBTradeTickConverter:
        """Get or create a trade tick converter."""
        if instrument_id not in self._trade_converters:
            instrument = self._instrument_provider.get_instrument(instrument_id)
            price_precision = instrument.price_precision if instrument else 2

            self._trade_converters[instrument_id] = OpenBBTradeTickConverter(
                instrument_id=instrument_id,
                price_precision=price_precision,
                size_precision=0,
            )
        return self._trade_converters[instrument_id]

    async def request_trade_ticks(
        self,
        instrument_id: InstrumentId,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        limit: Optional[int] = None,
    ) -> list[TradeTick]:
        """
        Request historical trade tick data.

        Note: Trade tick data availability depends on the OpenBB provider.

        Args:
            instrument_id: The instrument to request trades for.
            start: Start datetime.
            end: End datetime.
            limit: Maximum number of trades.

        Returns:
            List of TradeTick objects.
        """
        self._ensure_connected()
        await self._rate_limit()

        symbol = instrument_id.symbol.value

        try:
            # Attempt to fetch trade data - availability varies by provider
            # Fall back to last trade from quote if detailed trades unavailable
            result = self._openbb.equity.price.quote(
                symbol=symbol,
                provider=self._config.provider,
            )

            if hasattr(result, "to_df"):
                df = result.to_df()
            elif hasattr(result, "results"):
                df = pd.DataFrame(
                    [result.results]
                    if not isinstance(result.results, list)
                    else result.results
                )
            else:
                df = pd.DataFrame([result])

            if df.empty:
                return []

            converter = self._get_trade_converter(instrument_id)

            # Map to trade format
            if "price" not in df.columns and "lastPrice" in df.columns:
                df["price"] = df["lastPrice"]
            if "size" not in df.columns and "lastSize" in df.columns:
                df["size"] = df["lastSize"]
            if "size" not in df.columns and "volume" in df.columns:
                df["size"] = df["volume"]
            if "timestamp" not in df.columns:
                df["timestamp"] = pd.Timestamp.now(tz="UTC")

            return converter.convert_dataframe(df)

        except Exception as e:
            logger.warning(f"Failed to request trade ticks for {symbol}: {e}")
            return []

    async def subscribe_trade_ticks(self, instrument_id: InstrumentId) -> None:
        """
        Subscribe to trade tick updates.

        Args:
            instrument_id: The instrument to subscribe to.
        """
        self._trade_subscriptions.add(instrument_id)
        logger.info(f"Subscribed to trade ticks: {instrument_id}")

    async def unsubscribe_trade_ticks(self, instrument_id: InstrumentId) -> None:
        """
        Unsubscribe from trade tick updates.

        Args:
            instrument_id: The instrument to unsubscribe from.
        """
        self._trade_subscriptions.discard(instrument_id)
        logger.info(f"Unsubscribed from trade ticks: {instrument_id}")

    # -------------------------------------------------------------------------
    # Data Request Handler
    # -------------------------------------------------------------------------

    async def request(
        self,
        data_type: DataType,
        correlation_id: str,
    ) -> None:
        """
        Handle a data request.

        This method is called by NautilusTrader when data is requested.

        Args:
            data_type: The data type being requested.
            correlation_id: Correlation ID for the request.
        """
        logger.debug(
            f"Received data request: {data_type}, correlation_id={correlation_id}"
        )

        # The request is handled through the specific request_* methods
        # This base method can be extended for custom data types

    # -------------------------------------------------------------------------
    # Utility Methods
    # -------------------------------------------------------------------------

    def get_available_symbols(self) -> list[str]:
        """
        Get list of symbols available from OpenBB.

        Returns:
            List of available symbol strings.
        """
        # OpenBB supports most exchange-listed symbols
        # This could be extended to query available symbols from OpenBB
        return [str(iid.symbol) for iid in self._instrument_provider.instruments.keys()]

    @property
    def is_connected(self) -> bool:
        """Check if client is connected to OpenBB."""
        return self._openbb is not None

    @property
    def subscriptions(self) -> dict:
        """Get current subscriptions."""
        return {
            "bars": list(self._bar_subscriptions.keys()),
            "quotes": list(self._quote_subscriptions),
            "trades": list(self._trade_subscriptions),
        }


class OpenBBLiveDataClient(OpenBBDataClient):
    """
    OpenBB Data Client with simulated live data capabilities.

    Since OpenBB does not provide true streaming data, this client
    implements polling-based updates at configurable intervals.
    """

    def __init__(
        self,
        msgbus: MessageBus,
        cache: Cache,
        clock: Clock,
        config: OpenBBDataClientConfig,
        poll_interval_secs: float = 1.0,
    ):
        """
        Initialize the live data client.

        Args:
            msgbus: NautilusTrader message bus.
            cache: NautilusTrader cache.
            clock: NautilusTrader clock.
            config: OpenBB data client configuration.
            poll_interval_secs: Interval between data polls in seconds.
        """
        super().__init__(
            msgbus=msgbus,
            cache=cache,
            clock=clock,
            config=config,
        )

        self._poll_interval = poll_interval_secs
        self._polling_task: Optional[asyncio.Task] = None
        self._running = False

    async def _connect(self) -> None:
        """Connect and start polling."""
        await super()._connect()
        self._running = True
        self._polling_task = asyncio.create_task(self._poll_loop())
        logger.info("Started live data polling")

    async def _disconnect(self) -> None:
        """Stop polling and disconnect."""
        self._running = False
        if self._polling_task:
            self._polling_task.cancel()
            try:
                await self._polling_task
            except asyncio.CancelledError:
                pass
        await super()._disconnect()
        logger.info("Stopped live data polling")

    async def _poll_loop(self) -> None:
        """Main polling loop for live data updates."""
        while self._running:
            try:
                await self._poll_subscriptions()
            except Exception as e:
                logger.error(f"Error in poll loop: {e}")

            await asyncio.sleep(self._poll_interval)

    async def _poll_subscriptions(self) -> None:
        """Poll all active subscriptions for updates."""
        # Poll bar subscriptions
        for bar_type in list(self._bar_subscriptions.keys()):
            try:
                bars = await self.request_bars(
                    bar_type=bar_type,
                    limit=1,
                )
                for bar in bars:
                    # Publish bar to message bus
                    self._msgbus.publish(
                        topic=f"data.bars.{bar_type}",
                        msg=bar,
                    )
            except Exception as e:
                logger.warning(f"Failed to poll bars for {bar_type}: {e}")

        # Poll quote subscriptions
        for instrument_id in list(self._quote_subscriptions):
            try:
                quotes = await self.request_quote_ticks(
                    instrument_id=instrument_id,
                    limit=1,
                )
                for quote in quotes:
                    self._msgbus.publish(
                        topic=f"data.quotes.{instrument_id}",
                        msg=quote,
                    )
            except Exception as e:
                logger.warning(f"Failed to poll quotes for {instrument_id}: {e}")

        # Poll trade subscriptions
        for instrument_id in list(self._trade_subscriptions):
            try:
                trades = await self.request_trade_ticks(
                    instrument_id=instrument_id,
                    limit=1,
                )
                for trade in trades:
                    self._msgbus.publish(
                        topic=f"data.trades.{instrument_id}",
                        msg=trade,
                    )
            except Exception as e:
                logger.warning(f"Failed to poll trades for {instrument_id}: {e}")


class StanleyDataClient:
    """
    Simplified data client for Stanley-NautilusTrader integration.

    This is a lightweight wrapper that provides data conversion between
    Stanley/OpenBB formats and NautilusTrader data types.
    """

    def __init__(
        self,
        msgbus=None,
        cache=None,
        clock=None,
        openbb_adapter=None,
        config=None,
    ):
        """
        Initialize the Stanley data client.

        Args:
            msgbus: NautilusTrader message bus.
            cache: NautilusTrader cache.
            clock: NautilusTrader clock.
            openbb_adapter: OpenBB adapter for data fetching.
            config: Client configuration dictionary.
        """
        self._msgbus = msgbus
        self._cache = cache
        self._clock = clock
        self._openbb_adapter = openbb_adapter
        self._config = config or {}
        self._subscriptions = {}
        self._is_streaming = False

    def subscribe_bars(self, bar_type) -> None:
        """Subscribe to bar data."""
        self._subscriptions[bar_type] = True

    def unsubscribe_bars(self, bar_type) -> None:
        """Unsubscribe from bar data."""
        self._subscriptions.pop(bar_type, None)

    def subscribe_quote_ticks(self, instrument_id) -> None:
        """Subscribe to quote ticks."""

    def subscribe_trade_ticks(self, instrument_id) -> None:
        """Subscribe to trade ticks."""

    def request_bars(self, bar_type, start, end) -> None:
        """Request historical bars."""
        if self._openbb_adapter:
            symbol = (
                bar_type.symbol.value
                if hasattr(bar_type.symbol, "value")
                else str(bar_type.symbol)
            )
            data = self._openbb_adapter.get_historical_data(
                symbol,
                start.strftime("%Y-%m-%d"),
                end.strftime("%Y-%m-%d"),
            )
            bars = self._convert_to_bars(data, bar_type)
            return bars

    def request_quote_ticks(self, instrument_id) -> None:
        """Request quote ticks."""
        if self._openbb_adapter:
            symbol = (
                instrument_id.symbol.value
                if hasattr(instrument_id.symbol, "value")
                else str(instrument_id.symbol)
            )
            self._openbb_adapter.get_quote(symbol)

    def _convert_to_bars(self, df, bar_type):
        """Convert DataFrame to bar dictionaries."""
        if df is None or df.empty:
            return []

        bars = []
        for idx, row in df.iterrows():
            bar = {
                "open": float(row.get("open", row.get("Open", 0))),
                "high": float(row.get("high", row.get("High", 0))),
                "low": float(row.get("low", row.get("Low", 0))),
                "close": float(row.get("close", row.get("Close", 0))),
                "volume": int(row.get("volume", row.get("Volume", 0))),
                "timestamp": idx if hasattr(idx, "timestamp") else datetime.now(),
            }
            bars.append(bar)
        return bars

    def _convert_to_quote_tick(self, quote_data, instrument_id):
        """Convert quote data to quote tick format."""
        return {
            "bid": quote_data.get("bid", 0),
            "ask": quote_data.get("ask", 0),
            "bid_size": quote_data.get("bid_size", 0),
            "ask_size": quote_data.get("ask_size", 0),
            "timestamp": quote_data.get("timestamp", datetime.now()),
        }

    def _convert_to_trade_tick(self, trade_data, instrument_id):
        """Convert trade data to trade tick format."""
        return {
            "price": trade_data.get("price", 0),
            "size": trade_data.get("quantity", trade_data.get("size", 0)),
            "side": trade_data.get("side", "UNKNOWN"),
            "timestamp": trade_data.get("timestamp", datetime.now()),
        }

    def _create_equity_instrument(self, symbol, venue, currency):
        """Create an equity instrument definition."""
        return {
            "symbol": symbol,
            "venue": venue,
            "currency": currency,
            "type": "EQUITY",
        }

    async def start_stream(self, instrument_id) -> None:
        """Start streaming data."""
        self._is_streaming = True

    async def stop_stream(self, instrument_id) -> None:
        """Stop streaming data."""
        self._is_streaming = False
