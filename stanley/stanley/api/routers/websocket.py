"""
Stanley WebSocket Router
========================

Real-time data streaming via WebSocket connections.
Provides live updates for:
- Market data (quotes, prices)
- Signals (new signals, status changes)
- Portfolio updates (value changes, alerts)

Usage:
    Connect to: ws://localhost:8000/ws/market/{symbol}
    Connect to: ws://localhost:8000/ws/signals
    Connect to: ws://localhost:8000/ws/portfolio
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["WebSocket"])


# =============================================================================
# Connection Manager
# =============================================================================


class ConnectionManager:
    """
    Manages WebSocket connections for real-time data streaming.

    Supports:
    - Multiple channels (market, signals, portfolio)
    - Symbol-specific subscriptions
    - Broadcast to all subscribers
    - Graceful disconnect handling
    """

    def __init__(self):
        # Channel -> Set of WebSocket connections
        self._connections: Dict[str, Set[WebSocket]] = {}
        # WebSocket -> Set of subscribed symbols
        self._subscriptions: Dict[WebSocket, Set[str]] = {}
        # Background tasks for periodic updates
        self._tasks: List[asyncio.Task] = []
        self._running = False

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        """Accept a new WebSocket connection."""
        await websocket.accept()

        if channel not in self._connections:
            self._connections[channel] = set()

        self._connections[channel].add(websocket)
        self._subscriptions[websocket] = set()

        logger.info(f"WebSocket connected to channel: {channel}")

    def disconnect(self, websocket: WebSocket, channel: str) -> None:
        """Remove a WebSocket connection."""
        if channel in self._connections:
            self._connections[channel].discard(websocket)

        if websocket in self._subscriptions:
            del self._subscriptions[websocket]

        logger.info(f"WebSocket disconnected from channel: {channel}")

    def subscribe(self, websocket: WebSocket, symbol: str) -> None:
        """Subscribe a connection to a specific symbol."""
        if websocket in self._subscriptions:
            self._subscriptions[websocket].add(symbol.upper())

    def unsubscribe(self, websocket: WebSocket, symbol: str) -> None:
        """Unsubscribe from a symbol."""
        if websocket in self._subscriptions:
            self._subscriptions[websocket].discard(symbol.upper())

    async def send_personal(
        self, websocket: WebSocket, message: Dict[str, Any]
    ) -> None:
        """Send message to a specific connection."""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.warning(f"Failed to send personal message: {e}")

    async def broadcast(self, channel: str, message: Dict[str, Any]) -> None:
        """Broadcast message to all connections in a channel."""
        if channel not in self._connections:
            return

        disconnected = []
        for connection in self._connections[channel]:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)

        # Clean up disconnected
        for conn in disconnected:
            self.disconnect(conn, channel)

    async def broadcast_symbol(
        self, channel: str, symbol: str, message: Dict[str, Any]
    ) -> None:
        """Broadcast to connections subscribed to a specific symbol."""
        if channel not in self._connections:
            return

        symbol = symbol.upper()
        for connection in self._connections[channel]:
            if (
                connection in self._subscriptions
                and symbol in self._subscriptions[connection]
            ):
                try:
                    await connection.send_json(message)
                except Exception:
                    pass

    @property
    def connection_count(self) -> int:
        """Total number of active connections."""
        return sum(len(conns) for conns in self._connections.values())

    def channel_stats(self) -> Dict[str, int]:
        """Get connection counts per channel."""
        return {channel: len(conns) for channel, conns in self._connections.items()}


# Global connection manager
manager = ConnectionManager()


# =============================================================================
# Message Types
# =============================================================================


class WSMarketUpdate(BaseModel):
    """Market data update message."""

    type: str = "market_update"
    symbol: str
    price: float
    change: float
    change_percent: float
    volume: int
    timestamp: str


class WSSignalUpdate(BaseModel):
    """Signal update message."""

    type: str = "signal_update"
    signal_id: str
    symbol: str
    signal_type: str
    conviction: float
    timestamp: str


class WSPortfolioUpdate(BaseModel):
    """Portfolio update message."""

    type: str = "portfolio_update"
    total_value: float
    day_change: float
    day_change_percent: float
    timestamp: str


class WSAlert(BaseModel):
    """Alert message."""

    type: str = "alert"
    severity: str  # info, warning, critical
    title: str
    message: str
    symbol: Optional[str] = None
    timestamp: str


class WSBarUpdate(BaseModel):
    """OHLCV bar update message."""

    type: str = "bar_update"
    symbol: str
    timeframe: str  # "1m", "5m", "15m", "1h", "1d"
    open: float
    high: float
    low: float
    close: float
    volume: int
    vwap: Optional[float] = None
    trade_count: Optional[int] = None
    timestamp: str


class WSOptionsFlowUpdate(BaseModel):
    """Options flow update message."""

    type: str = "options_flow"
    symbol: str
    strike: float
    expiration: str
    option_type: str  # "call" or "put"
    premium: float
    volume: int
    open_interest: int
    implied_volatility: float
    trade_type: str  # "block", "sweep", "split"
    sentiment: str  # "bullish", "bearish", "neutral"
    timestamp: str


class WSDarkPoolUpdate(BaseModel):
    """Dark pool activity update message."""

    type: str = "dark_pool"
    symbol: str
    price: float
    size: int
    notional: float
    venue: Optional[str] = None
    side: Optional[str] = None  # "buy", "sell", or None if unknown
    percent_of_adv: Optional[float] = None  # As percent of average daily volume
    timestamp: str


# =============================================================================
# WebSocket Endpoints
# =============================================================================


@router.websocket("/market/{symbol}")
async def market_websocket(websocket: WebSocket, symbol: str):
    """
    WebSocket for real-time market data.

    Sends periodic price updates for the subscribed symbol.

    Message format:
    {
        "type": "market_update",
        "symbol": "AAPL",
        "price": 175.50,
        "change": 2.30,
        "change_percent": 1.33,
        "volume": 45000000,
        "timestamp": "2024-01-15T14:30:00Z"
    }
    """
    await manager.connect(websocket, "market")
    symbol = symbol.upper()
    manager.subscribe(websocket, symbol)

    try:
        # Send initial data
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "channel": "market",
                "symbol": symbol,
                "message": f"Subscribed to {symbol} market data",
            },
        )

        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for client messages (ping/pong, subscribe/unsubscribe)
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                action = data.get("action")
                if action == "subscribe":
                    new_symbol = data.get("symbol", "").upper()
                    if new_symbol:
                        manager.subscribe(websocket, new_symbol)
                        await manager.send_personal(
                            websocket, {"type": "subscribed", "symbol": new_symbol}
                        )
                elif action == "unsubscribe":
                    old_symbol = data.get("symbol", "").upper()
                    if old_symbol:
                        manager.unsubscribe(websocket, old_symbol)
                        await manager.send_personal(
                            websocket, {"type": "unsubscribed", "symbol": old_symbol}
                        )
                elif action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc)
                            .replace(tzinfo=None)
                            .isoformat(),
                        },
                    )
            except asyncio.TimeoutError:
                # Send heartbeat on timeout
                await manager.send_personal(
                    websocket,
                    {
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc)
                        .replace(tzinfo=None)
                        .isoformat()
                        + "Z",
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, "market")
    except Exception as e:
        logger.error(f"Market WebSocket error: {e}")
        manager.disconnect(websocket, "market")


@router.websocket("/signals")
async def signals_websocket(websocket: WebSocket):
    """
    WebSocket for real-time signal updates.

    Broadcasts new signals as they are generated.

    Message format:
    {
        "type": "signal_update",
        "signal_id": "sig_abc123",
        "symbol": "AAPL",
        "signal_type": "buy",
        "conviction": 0.85,
        "timestamp": "2024-01-15T14:30:00Z"
    }
    """
    await manager.connect(websocket, "signals")

    try:
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "channel": "signals",
                "message": "Subscribed to signal updates",
            },
        )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=60.0)

                action = data.get("action")
                if action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc)
                            .replace(tzinfo=None)
                            .isoformat(),
                        },
                    )
                elif action == "filter":
                    # Client wants to filter signals by symbol
                    symbols = data.get("symbols", [])
                    for sym in symbols:
                        manager.subscribe(websocket, sym)
            except asyncio.TimeoutError:
                await manager.send_personal(
                    websocket,
                    {
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc)
                        .replace(tzinfo=None)
                        .isoformat()
                        + "Z",
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, "signals")
    except Exception as e:
        logger.error(f"Signals WebSocket error: {e}")
        manager.disconnect(websocket, "signals")


@router.websocket("/portfolio")
async def portfolio_websocket(websocket: WebSocket):
    """
    WebSocket for real-time portfolio updates.

    Sends portfolio value changes and alerts.

    Message format:
    {
        "type": "portfolio_update",
        "total_value": 150000.00,
        "day_change": 1250.00,
        "day_change_percent": 0.84,
        "timestamp": "2024-01-15T14:30:00Z"
    }
    """
    await manager.connect(websocket, "portfolio")

    try:
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "channel": "portfolio",
                "message": "Subscribed to portfolio updates",
            },
        )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=60.0)

                action = data.get("action")
                if action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc)
                            .replace(tzinfo=None)
                            .isoformat(),
                        },
                    )
                elif action == "set_holdings":
                    # Client sends their holdings for tracking
                    holdings = data.get("holdings", [])
                    for h in holdings:
                        if "symbol" in h:
                            manager.subscribe(websocket, h["symbol"])
            except asyncio.TimeoutError:
                await manager.send_personal(
                    websocket,
                    {
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc)
                        .replace(tzinfo=None)
                        .isoformat()
                        + "Z",
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, "portfolio")
    except Exception as e:
        logger.error(f"Portfolio WebSocket error: {e}")
        manager.disconnect(websocket, "portfolio")


@router.websocket("/bars/{symbol}")
async def bars_websocket(websocket: WebSocket, symbol: str):
    """
    WebSocket for real-time OHLCV bar streaming.

    Provides aggregated bars at configurable timeframes (1m, 5m, 15m, etc.)
    Clients can specify timeframe via message: {"action": "set_timeframe", "timeframe": "5m"}

    Message format:
    {
        "type": "bar_update",
        "symbol": "AAPL",
        "timeframe": "1m",
        "open": 175.20,
        "high": 175.65,
        "low": 175.15,
        "close": 175.50,
        "volume": 125000,
        "vwap": 175.38,
        "trade_count": 450,
        "timestamp": "2024-01-15T14:30:00Z"
    }
    """
    await manager.connect(websocket, "bars")
    symbol = symbol.upper()
    manager.subscribe(websocket, symbol)

    # Default timeframe
    timeframe = "1m"

    try:
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "channel": "bars",
                "symbol": symbol,
                "timeframe": timeframe,
                "message": f"Subscribed to {symbol} bar data",
            },
        )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                action = data.get("action")
                if action == "set_timeframe":
                    new_tf = data.get("timeframe", "1m")
                    if new_tf in ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]:
                        timeframe = new_tf
                        await manager.send_personal(
                            websocket,
                            {"type": "timeframe_changed", "timeframe": timeframe},
                        )
                elif action == "subscribe":
                    new_symbol = data.get("symbol", "").upper()
                    if new_symbol:
                        manager.subscribe(websocket, new_symbol)
                        await manager.send_personal(
                            websocket, {"type": "subscribed", "symbol": new_symbol}
                        )
                elif action == "unsubscribe":
                    old_symbol = data.get("symbol", "").upper()
                    if old_symbol:
                        manager.unsubscribe(websocket, old_symbol)
                        await manager.send_personal(
                            websocket, {"type": "unsubscribed", "symbol": old_symbol}
                        )
                elif action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc)
                            .replace(tzinfo=None)
                            .isoformat()
                            + "Z",
                        },
                    )
            except asyncio.TimeoutError:
                await manager.send_personal(
                    websocket,
                    {
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc)
                        .replace(tzinfo=None)
                        .isoformat()
                        + "Z",
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, "bars")
    except Exception as e:
        logger.error(f"Bars WebSocket error: {e}")
        manager.disconnect(websocket, "bars")


@router.websocket("/options-flow/{symbol}")
async def options_flow_websocket(websocket: WebSocket, symbol: str):
    """
    WebSocket for real-time options flow streaming.

    Provides live options flow data including unusual activity,
    block trades, and sweeps.

    Message format:
    {
        "type": "options_flow",
        "symbol": "AAPL",
        "strike": 180.0,
        "expiration": "2024-01-19",
        "option_type": "call",
        "premium": 250000,
        "volume": 500,
        "open_interest": 2500,
        "implied_volatility": 0.32,
        "trade_type": "sweep",
        "sentiment": "bullish",
        "timestamp": "2024-01-15T14:30:00Z"
    }
    """
    await manager.connect(websocket, "options_flow")
    symbol = symbol.upper()
    manager.subscribe(websocket, symbol)

    try:
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "channel": "options_flow",
                "symbol": symbol,
                "message": f"Subscribed to {symbol} options flow",
            },
        )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                action = data.get("action")
                if action == "subscribe":
                    new_symbol = data.get("symbol", "").upper()
                    if new_symbol:
                        manager.subscribe(websocket, new_symbol)
                        await manager.send_personal(
                            websocket, {"type": "subscribed", "symbol": new_symbol}
                        )
                elif action == "unsubscribe":
                    old_symbol = data.get("symbol", "").upper()
                    if old_symbol:
                        manager.unsubscribe(websocket, old_symbol)
                        await manager.send_personal(
                            websocket, {"type": "unsubscribed", "symbol": old_symbol}
                        )
                elif action == "set_filters":
                    # Filter by trade type, minimum premium, etc.
                    filters = data.get("filters", {})
                    await manager.send_personal(
                        websocket, {"type": "filters_updated", "filters": filters}
                    )
                elif action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc)
                            .replace(tzinfo=None)
                            .isoformat()
                            + "Z",
                        },
                    )
            except asyncio.TimeoutError:
                await manager.send_personal(
                    websocket,
                    {
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc)
                        .replace(tzinfo=None)
                        .isoformat()
                        + "Z",
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, "options_flow")
    except Exception as e:
        logger.error(f"Options flow WebSocket error: {e}")
        manager.disconnect(websocket, "options_flow")


@router.websocket("/dark-pool/{symbol}")
async def dark_pool_websocket(websocket: WebSocket, symbol: str):
    """
    WebSocket for real-time dark pool activity streaming.

    Provides live dark pool prints and ATS activity.

    Message format:
    {
        "type": "dark_pool",
        "symbol": "AAPL",
        "price": 175.50,
        "size": 50000,
        "notional": 8775000,
        "venue": "UBSS",
        "side": "buy",
        "percent_of_adv": 0.25,
        "timestamp": "2024-01-15T14:30:00Z"
    }
    """
    await manager.connect(websocket, "dark_pool")
    symbol = symbol.upper()
    manager.subscribe(websocket, symbol)

    try:
        await manager.send_personal(
            websocket,
            {
                "type": "connected",
                "channel": "dark_pool",
                "symbol": symbol,
                "message": f"Subscribed to {symbol} dark pool activity",
            },
        )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                action = data.get("action")
                if action == "subscribe":
                    new_symbol = data.get("symbol", "").upper()
                    if new_symbol:
                        manager.subscribe(websocket, new_symbol)
                        await manager.send_personal(
                            websocket, {"type": "subscribed", "symbol": new_symbol}
                        )
                elif action == "unsubscribe":
                    old_symbol = data.get("symbol", "").upper()
                    if old_symbol:
                        manager.unsubscribe(websocket, old_symbol)
                        await manager.send_personal(
                            websocket, {"type": "unsubscribed", "symbol": old_symbol}
                        )
                elif action == "set_min_size":
                    # Filter by minimum trade size
                    min_size = data.get("min_size", 10000)
                    await manager.send_personal(
                        websocket,
                        {"type": "min_size_updated", "min_size": min_size},
                    )
                elif action == "ping":
                    await manager.send_personal(
                        websocket,
                        {
                            "type": "pong",
                            "timestamp": datetime.now(timezone.utc)
                            .replace(tzinfo=None)
                            .isoformat()
                            + "Z",
                        },
                    )
            except asyncio.TimeoutError:
                await manager.send_personal(
                    websocket,
                    {
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc)
                        .replace(tzinfo=None)
                        .isoformat()
                        + "Z",
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket, "dark_pool")
    except Exception as e:
        logger.error(f"Dark pool WebSocket error: {e}")
        manager.disconnect(websocket, "dark_pool")


@router.get("/status")
async def websocket_status():
    """Get WebSocket connection statistics."""
    return {
        "success": True,
        "data": {
            "total_connections": manager.connection_count,
            "channels": manager.channel_stats(),
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    }


# =============================================================================
# Broadcasting Functions (for use by other modules)
# =============================================================================


async def broadcast_market_update(
    symbol: str, price: float, change: float, change_percent: float, volume: int
) -> None:
    """Broadcast a market update to all subscribers."""
    await manager.broadcast(
        "market",
        {
            "type": "market_update",
            "symbol": symbol.upper(),
            "price": price,
            "change": change,
            "change_percent": change_percent,
            "volume": volume,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    )


async def broadcast_signal(
    signal_id: str, symbol: str, signal_type: str, conviction: float
) -> None:
    """Broadcast a new signal to all subscribers."""
    await manager.broadcast(
        "signals",
        {
            "type": "signal_update",
            "signal_id": signal_id,
            "symbol": symbol.upper(),
            "signal_type": signal_type,
            "conviction": conviction,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    )


async def broadcast_alert(
    severity: str, title: str, message: str, symbol: Optional[str] = None
) -> None:
    """Broadcast an alert to all portfolio subscribers."""
    await manager.broadcast(
        "portfolio",
        {
            "type": "alert",
            "severity": severity,
            "title": title,
            "message": message,
            "symbol": symbol.upper() if symbol else None,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    )


async def broadcast_bar_update(
    symbol: str,
    timeframe: str,
    open_price: float,
    high: float,
    low: float,
    close: float,
    volume: int,
    vwap: Optional[float] = None,
    trade_count: Optional[int] = None,
) -> None:
    """Broadcast an OHLCV bar update to all subscribers."""
    await manager.broadcast_symbol(
        "bars",
        symbol.upper(),
        {
            "type": "bar_update",
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
            "vwap": vwap,
            "trade_count": trade_count,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    )


async def broadcast_options_flow(
    symbol: str,
    strike: float,
    expiration: str,
    option_type: str,
    premium: float,
    volume: int,
    open_interest: int,
    implied_volatility: float,
    trade_type: str,
    sentiment: str,
) -> None:
    """Broadcast an options flow update to all subscribers."""
    await manager.broadcast_symbol(
        "options_flow",
        symbol.upper(),
        {
            "type": "options_flow",
            "symbol": symbol.upper(),
            "strike": strike,
            "expiration": expiration,
            "option_type": option_type,
            "premium": premium,
            "volume": volume,
            "open_interest": open_interest,
            "implied_volatility": implied_volatility,
            "trade_type": trade_type,
            "sentiment": sentiment,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    )


async def broadcast_dark_pool(
    symbol: str,
    price: float,
    size: int,
    notional: float,
    venue: Optional[str] = None,
    side: Optional[str] = None,
    percent_of_adv: Optional[float] = None,
) -> None:
    """Broadcast a dark pool print to all subscribers."""
    await manager.broadcast_symbol(
        "dark_pool",
        symbol.upper(),
        {
            "type": "dark_pool",
            "symbol": symbol.upper(),
            "price": price,
            "size": size,
            "notional": notional,
            "venue": venue,
            "side": side,
            "percent_of_adv": percent_of_adv,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            + "Z",
        },
    )
