"""
Live Feed Provider Module

Provides real-time market data streaming from multiple sources:
- Alpaca Markets (primary)
- Polygon.io (secondary)
- Mock data (fallback for development)

Features:
- Automatic reconnection with exponential backoff
- Circuit breaker pattern for failed connections
- Multiple symbol subscriptions
- Trade and quote streaming
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set

from investing.core.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitBreakerOpen,
)

logger = logging.getLogger(__name__)


class FeedSource(Enum):
    """Available data feed sources."""

    ALPACA = "alpaca"
    POLYGON = "polygon"
    MOCK = "mock"


@dataclass
class LiveFeedConfig:
    """Configuration for live feed provider."""

    # API Keys
    alpaca_api_key: Optional[str] = None
    alpaca_secret_key: Optional[str] = None
    polygon_api_key: Optional[str] = None

    # Connection settings
    primary_source: FeedSource = FeedSource.ALPACA
    reconnect_delay: float = 1.0
    max_reconnect_delay: float = 60.0
    use_mock_data: bool = False

    # Subscription settings
    max_symbols: int = 100


@dataclass
class Trade:
    """Trade tick data."""

    symbol: str
    price: float
    size: int
    timestamp: datetime
    exchange: Optional[str] = None
    conditions: Optional[List[str]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "price": self.price,
            "size": self.size,
            "timestamp": self.timestamp.isoformat() + "Z",
            "exchange": self.exchange,
            "conditions": self.conditions,
        }


@dataclass
class Quote:
    """Quote data."""

    symbol: str
    bid: float
    bid_size: int
    ask: float
    ask_size: int
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "bid": self.bid,
            "bid_size": self.bid_size,
            "ask": self.ask,
            "ask_size": self.ask_size,
            "timestamp": self.timestamp.isoformat() + "Z",
        }


class LiveFeedProvider:
    """
    Real-time market data feed provider.

    Manages WebSocket connections to data providers and
    delivers trade/quote updates via callbacks.
    """

    def __init__(
        self,
        config: Optional[LiveFeedConfig] = None,
        on_trade: Optional[Callable[[Trade], None]] = None,
        on_quote: Optional[Callable[[Quote], None]] = None,
    ):
        """
        Initialize live feed provider.

        Args:
            config: Feed configuration
            on_trade: Callback for trade updates
            on_quote: Callback for quote updates
        """
        self.config = config or LiveFeedConfig()
        self._on_trade = on_trade
        self._on_quote = on_quote

        # Subscribed symbols
        self._symbols: Set[str] = set()

        # Connection state
        self._running = False
        self._connected = False
        self._ws_task: Optional[asyncio.Task] = None
        self._mock_task: Optional[asyncio.Task] = None

        # WebSocket client
        self._ws_client = None

        # Circuit breaker for connection
        self._circuit_breaker = CircuitBreaker(
            CircuitBreakerConfig(
                name="live_feed",
                failure_threshold=3,
                recovery_timeout=30.0,
            )
        )

        logger.info(
            f"LiveFeedProvider initialized (source: {self.config.primary_source.value})"
        )

    async def start(self) -> None:
        """Start the live feed provider."""
        if self._running:
            return

        self._running = True

        if self.config.use_mock_data:
            self._mock_task = asyncio.create_task(self._mock_feed_loop())
            logger.info("LiveFeedProvider started with mock data")
        else:
            self._ws_task = asyncio.create_task(self._connection_loop())
            logger.info("LiveFeedProvider started")

    async def stop(self) -> None:
        """Stop the live feed provider."""
        self._running = False

        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass
            self._ws_task = None

        if self._mock_task:
            self._mock_task.cancel()
            try:
                await self._mock_task
            except asyncio.CancelledError:
                pass
            self._mock_task = None

        if self._ws_client:
            await self._ws_client.close()
            self._ws_client = None

        self._connected = False
        logger.info("LiveFeedProvider stopped")

    def subscribe(self, symbol: str) -> None:
        """
        Subscribe to a symbol for live data.

        Args:
            symbol: Stock ticker symbol
        """
        symbol = symbol.upper()

        if len(self._symbols) >= self.config.max_symbols:
            logger.warning(
                f"Max symbols ({self.config.max_symbols}) reached, cannot subscribe to {symbol}"
            )
            return

        self._symbols.add(symbol)
        logger.debug(f"Subscribed to {symbol}")

        # If already connected, send subscription message
        if self._connected and self._ws_client:
            asyncio.create_task(self._send_subscription(symbol, subscribe=True))

    def unsubscribe(self, symbol: str) -> None:
        """
        Unsubscribe from a symbol.

        Args:
            symbol: Stock ticker symbol
        """
        symbol = symbol.upper()
        self._symbols.discard(symbol)
        logger.debug(f"Unsubscribed from {symbol}")

        if self._connected and self._ws_client:
            asyncio.create_task(self._send_subscription(symbol, subscribe=False))

    @property
    def is_connected(self) -> bool:
        """Check if feed is connected."""
        return self._connected

    @property
    def subscribed_symbols(self) -> List[str]:
        """Get list of subscribed symbols."""
        return list(self._symbols)

    async def _connection_loop(self) -> None:
        """Main connection loop with reconnection logic."""
        delay = self.config.reconnect_delay

        while self._running:
            try:
                await self._connect()
                delay = self.config.reconnect_delay  # Reset delay on success

            except CircuitBreakerOpen:
                logger.warning("Circuit breaker open, waiting for recovery")
                await asyncio.sleep(self._circuit_breaker.config.recovery_timeout)

            except Exception as e:
                logger.error(f"Connection error: {e}")
                self._connected = False

                # Exponential backoff
                await asyncio.sleep(delay)
                delay = min(delay * 2, self.config.max_reconnect_delay)

    async def _connect(self) -> None:
        """Connect to the data feed."""
        if self.config.primary_source == FeedSource.ALPACA:
            await self._connect_alpaca()
        elif self.config.primary_source == FeedSource.POLYGON:
            await self._connect_polygon()
        else:
            raise ValueError(f"Unknown source: {self.config.primary_source}")

    async def _connect_alpaca(self) -> None:
        """Connect to Alpaca WebSocket."""
        if not self.config.alpaca_api_key or not self.config.alpaca_secret_key:
            logger.warning("Alpaca API keys not configured, using mock data")
            self.config.use_mock_data = True
            self._mock_task = asyncio.create_task(self._mock_feed_loop())
            return

        try:
            import websockets
        except ImportError:
            logger.warning("websockets not installed, using mock data")
            self.config.use_mock_data = True
            self._mock_task = asyncio.create_task(self._mock_feed_loop())
            return

        url = "wss://stream.data.alpaca.markets/v2/iex"

        async with websockets.connect(url) as ws:
            self._ws_client = ws
            self._connected = True

            # Authenticate
            auth_msg = {
                "action": "auth",
                "key": self.config.alpaca_api_key,
                "secret": self.config.alpaca_secret_key,
            }
            await ws.send(str(auth_msg).replace("'", '"'))

            # Wait for auth response
            response = await ws.recv()
            logger.debug(f"Auth response: {response}")

            # Subscribe to symbols
            if self._symbols:
                await self._send_subscription_batch(list(self._symbols))

            # Process messages
            async for message in ws:
                if not self._running:
                    break

                await self._process_alpaca_message(message)

    async def _connect_polygon(self) -> None:
        """Connect to Polygon WebSocket."""
        if not self.config.polygon_api_key:
            logger.warning("Polygon API key not configured, using mock data")
            self.config.use_mock_data = True
            self._mock_task = asyncio.create_task(self._mock_feed_loop())
            return

        try:
            import websockets
        except ImportError:
            logger.warning("websockets not installed, using mock data")
            self.config.use_mock_data = True
            self._mock_task = asyncio.create_task(self._mock_feed_loop())
            return

        url = "wss://socket.polygon.io/stocks"

        async with websockets.connect(url) as ws:
            self._ws_client = ws
            self._connected = True

            # Authenticate
            auth_msg = {"action": "auth", "params": self.config.polygon_api_key}
            await ws.send(str(auth_msg).replace("'", '"'))

            # Wait for auth
            response = await ws.recv()
            logger.debug(f"Auth response: {response}")

            # Subscribe
            if self._symbols:
                sub_msg = {
                    "action": "subscribe",
                    "params": ",".join(f"T.{s}" for s in self._symbols),
                }
                await ws.send(str(sub_msg).replace("'", '"'))

            # Process messages
            async for message in ws:
                if not self._running:
                    break

                await self._process_polygon_message(message)

    async def _send_subscription(self, symbol: str, subscribe: bool = True) -> None:
        """Send subscription/unsubscription message."""
        if not self._ws_client:
            return

        if self.config.primary_source == FeedSource.ALPACA:
            action = "subscribe" if subscribe else "unsubscribe"
            msg = {"action": action, "trades": [symbol], "quotes": [symbol]}
        else:
            action = "subscribe" if subscribe else "unsubscribe"
            msg = {"action": action, "params": f"T.{symbol},Q.{symbol}"}

        try:
            await self._ws_client.send(str(msg).replace("'", '"'))
        except Exception as e:
            logger.error(f"Failed to send subscription: {e}")

    async def _send_subscription_batch(self, symbols: List[str]) -> None:
        """Send batch subscription message."""
        if not self._ws_client:
            return

        if self.config.primary_source == FeedSource.ALPACA:
            msg = {"action": "subscribe", "trades": symbols, "quotes": symbols}
        else:
            params = ",".join(f"T.{s},Q.{s}" for s in symbols)
            msg = {"action": "subscribe", "params": params}

        try:
            await self._ws_client.send(str(msg).replace("'", '"'))
        except Exception as e:
            logger.error(f"Failed to send batch subscription: {e}")

    async def _process_alpaca_message(self, message: str) -> None:
        """Process Alpaca WebSocket message."""
        import json

        try:
            data = json.loads(message)

            if not isinstance(data, list):
                data = [data]

            for msg in data:
                msg_type = msg.get("T")

                if msg_type == "t":  # Trade
                    trade = Trade(
                        symbol=msg.get("S", ""),
                        price=float(msg.get("p", 0)),
                        size=int(msg.get("s", 0)),
                        timestamp=datetime.fromisoformat(
                            msg.get("t", "").replace("Z", "+00:00")
                        ),
                        exchange=msg.get("x"),
                        conditions=msg.get("c"),
                    )
                    self._emit_trade(trade)

                elif msg_type == "q":  # Quote
                    quote = Quote(
                        symbol=msg.get("S", ""),
                        bid=float(msg.get("bp", 0)),
                        bid_size=int(msg.get("bs", 0)),
                        ask=float(msg.get("ap", 0)),
                        ask_size=int(msg.get("as", 0)),
                        timestamp=datetime.fromisoformat(
                            msg.get("t", "").replace("Z", "+00:00")
                        ),
                    )
                    self._emit_quote(quote)

        except Exception as e:
            logger.error(f"Error processing Alpaca message: {e}")

    async def _process_polygon_message(self, message: str) -> None:
        """Process Polygon WebSocket message."""
        import json

        try:
            data = json.loads(message)

            if not isinstance(data, list):
                data = [data]

            for msg in data:
                ev = msg.get("ev")

                if ev == "T":  # Trade
                    trade = Trade(
                        symbol=msg.get("sym", ""),
                        price=float(msg.get("p", 0)),
                        size=int(msg.get("s", 0)),
                        timestamp=datetime.fromtimestamp(
                            msg.get("t", 0) / 1000, tz=timezone.utc
                        ),
                        exchange=msg.get("x"),
                        conditions=msg.get("c"),
                    )
                    self._emit_trade(trade)

                elif ev == "Q":  # Quote
                    quote = Quote(
                        symbol=msg.get("sym", ""),
                        bid=float(msg.get("bp", 0)),
                        bid_size=int(msg.get("bs", 0)),
                        ask=float(msg.get("ap", 0)),
                        ask_size=int(msg.get("as", 0)),
                        timestamp=datetime.fromtimestamp(
                            msg.get("t", 0) / 1000, tz=timezone.utc
                        ),
                    )
                    self._emit_quote(quote)

        except Exception as e:
            logger.error(f"Error processing Polygon message: {e}")

    def _emit_trade(self, trade: Trade) -> None:
        """Emit trade to callback."""
        if self._on_trade:
            try:
                result = self._on_trade(trade)
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception as e:
                logger.error(f"Error in trade callback: {e}")

    def _emit_quote(self, quote: Quote) -> None:
        """Emit quote to callback."""
        if self._on_quote:
            try:
                result = self._on_quote(quote)
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception as e:
                logger.error(f"Error in quote callback: {e}")

    async def _mock_feed_loop(self) -> None:
        """Generate mock data for testing."""
        import random

        # Base prices for mock symbols
        base_prices: Dict[str, float] = {}

        while self._running:
            try:
                if not self._symbols:
                    await asyncio.sleep(1.0)
                    continue

                # Generate mock data for each symbol
                for symbol in list(self._symbols):
                    # Initialize base price if needed
                    if symbol not in base_prices:
                        base_prices[symbol] = random.uniform(50, 500)

                    # Random walk price
                    base_prices[symbol] *= 1 + random.gauss(0, 0.0005)
                    price = round(base_prices[symbol], 2)

                    # Generate trade
                    trade = Trade(
                        symbol=symbol,
                        price=price,
                        size=random.randint(1, 1000) * 100,
                        timestamp=datetime.now(timezone.utc),
                        exchange="MOCK",
                    )
                    self._emit_trade(trade)

                    # Generate quote (occasionally)
                    if random.random() < 0.3:
                        spread = price * random.uniform(0.0001, 0.001)
                        quote = Quote(
                            symbol=symbol,
                            bid=round(price - spread / 2, 2),
                            bid_size=random.randint(1, 100) * 100,
                            ask=round(price + spread / 2, 2),
                            ask_size=random.randint(1, 100) * 100,
                            timestamp=datetime.now(timezone.utc),
                        )
                        self._emit_quote(quote)

                # Sleep between batches (simulate ~100 trades/sec)
                await asyncio.sleep(0.01)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Mock feed error: {e}")
                await asyncio.sleep(1.0)

    def get_status(self) -> Dict[str, Any]:
        """Get feed provider status."""
        return {
            "running": self._running,
            "connected": self._connected,
            "source": self.config.primary_source.value,
            "use_mock": self.config.use_mock_data,
            "subscribed_symbols": list(self._symbols),
            "symbol_count": len(self._symbols),
            "circuit_breaker": {
                "state": self._circuit_breaker.state.value,
                "failures": self._circuit_breaker._failure_count,
            },
        }
