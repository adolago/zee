"""
Bar Aggregator Module

Aggregates tick data (trades) into OHLCV bars at multiple timeframes.
Supports:
- 1m, 5m, 15m, 30m, 1h, 4h, 1d timeframes
- VWAP calculation within bars
- Trade count tracking
- Multiple concurrent symbol tracking
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class BarTimeframe(Enum):
    """Supported bar timeframes."""

    M1 = "1m"  # 1 minute
    M5 = "5m"  # 5 minutes
    M15 = "15m"  # 15 minutes
    M30 = "30m"  # 30 minutes
    H1 = "1h"  # 1 hour
    H4 = "4h"  # 4 hours
    D1 = "1d"  # 1 day

    @property
    def seconds(self) -> int:
        """Get timeframe duration in seconds."""
        mapping = {
            "1m": 60,
            "5m": 300,
            "15m": 900,
            "30m": 1800,
            "1h": 3600,
            "4h": 14400,
            "1d": 86400,
        }
        return mapping[self.value]


@dataclass
class Bar:
    """OHLCV bar data structure."""

    symbol: str
    timeframe: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    vwap: float
    trade_count: int
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        """Convert bar to dictionary."""
        return {
            "symbol": self.symbol,
            "timeframe": self.timeframe,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "vwap": round(self.vwap, 4) if self.vwap else 0,
            "trade_count": self.trade_count,
            "timestamp": self.timestamp.isoformat() + "Z",
        }


@dataclass
class BarState:
    """Tracks the current state of a bar being built."""

    open: float = 0.0
    high: float = 0.0
    low: float = float("inf")
    close: float = 0.0
    volume: int = 0
    turnover: float = 0.0  # For VWAP calculation (sum of price * size)
    trade_count: int = 0
    bar_start: Optional[datetime] = None

    def update(self, price: float, size: int) -> None:
        """Update bar with new trade."""
        if self.trade_count == 0:
            self.open = price
            self.high = price
            self.low = price
        else:
            self.high = max(self.high, price)
            self.low = min(self.low, price)

        self.close = price
        self.volume += size
        self.turnover += price * size
        self.trade_count += 1

    @property
    def vwap(self) -> float:
        """Calculate VWAP for the bar."""
        if self.volume == 0:
            return 0.0
        return self.turnover / self.volume

    def reset(self) -> None:
        """Reset bar state for new bar."""
        self.open = 0.0
        self.high = 0.0
        self.low = float("inf")
        self.close = 0.0
        self.volume = 0
        self.turnover = 0.0
        self.trade_count = 0
        self.bar_start = None


class BarAggregator:
    """
    Aggregates tick data into OHLCV bars.

    Supports multiple timeframes and symbols simultaneously.
    Calls callback when bars are completed.
    """

    def __init__(
        self,
        on_bar_complete: Optional[Callable[[Bar], None]] = None,
        timeframes: Optional[List[BarTimeframe]] = None,
    ):
        """
        Initialize bar aggregator.

        Args:
            on_bar_complete: Callback when a bar is completed
            timeframes: List of timeframes to aggregate (default: all)
        """
        self._on_bar_complete = on_bar_complete
        self._timeframes = timeframes or list(BarTimeframe)

        # State: {symbol: {timeframe: BarState}}
        self._states: Dict[str, Dict[str, BarState]] = {}

        # Background task for periodic bar closing
        self._running = False
        self._timer_task: Optional[asyncio.Task] = None

        logger.info(
            f"BarAggregator initialized with timeframes: "
            f"{[tf.value for tf in self._timeframes]}"
        )

    async def start(self) -> None:
        """Start the bar aggregator background tasks."""
        if self._running:
            return

        self._running = True
        self._timer_task = asyncio.create_task(self._bar_timer())
        logger.info("BarAggregator started")

    async def stop(self) -> None:
        """Stop the bar aggregator."""
        self._running = False

        if self._timer_task:
            self._timer_task.cancel()
            try:
                await self._timer_task
            except asyncio.CancelledError:
                pass
            self._timer_task = None

        logger.info("BarAggregator stopped")

    def subscribe(self, symbol: str) -> None:
        """
        Subscribe to a symbol for bar aggregation.

        Args:
            symbol: Stock ticker symbol
        """
        symbol = symbol.upper()

        if symbol in self._states:
            return

        self._states[symbol] = {tf.value: BarState() for tf in self._timeframes}
        logger.debug(f"Subscribed to {symbol} for bar aggregation")

    def unsubscribe(self, symbol: str) -> None:
        """
        Unsubscribe from a symbol.

        Args:
            symbol: Stock ticker symbol
        """
        symbol = symbol.upper()

        if symbol in self._states:
            del self._states[symbol]
            logger.debug(f"Unsubscribed from {symbol}")

    def process_trade(
        self,
        symbol: str,
        price: float,
        size: int,
        timestamp: Optional[datetime] = None,
    ) -> None:
        """
        Process a trade tick and update bars.

        Args:
            symbol: Stock ticker symbol
            price: Trade price
            size: Trade size (shares)
            timestamp: Trade timestamp (default: now)
        """
        symbol = symbol.upper()

        if symbol not in self._states:
            self.subscribe(symbol)

        timestamp = timestamp or datetime.now(timezone.utc)

        for tf in self._timeframes:
            state = self._states[symbol][tf.value]

            # Check if we need to start a new bar
            if state.bar_start is None:
                state.bar_start = self._align_to_timeframe(timestamp, tf)

            # Check if trade belongs to next bar
            bar_end = self._get_bar_end(state.bar_start, tf)
            if timestamp >= bar_end:
                # Complete current bar if it has data
                if state.trade_count > 0:
                    self._complete_bar(symbol, tf, state)

                # Start new bar
                state.reset()
                state.bar_start = self._align_to_timeframe(timestamp, tf)

            # Update bar state
            state.update(price, size)

    def _align_to_timeframe(
        self, timestamp: datetime, timeframe: BarTimeframe
    ) -> datetime:
        """Align timestamp to the start of a bar period."""
        seconds = timeframe.seconds

        # Round down to nearest bar boundary
        epoch = timestamp.timestamp()
        aligned_epoch = (epoch // seconds) * seconds

        return datetime.fromtimestamp(aligned_epoch, tz=timezone.utc)

    def _get_bar_end(self, bar_start: datetime, timeframe: BarTimeframe) -> datetime:
        """Get the end timestamp for a bar."""
        from datetime import timedelta

        return bar_start + timedelta(seconds=timeframe.seconds)

    def _complete_bar(
        self, symbol: str, timeframe: BarTimeframe, state: BarState
    ) -> None:
        """Complete a bar and trigger callback."""
        if state.trade_count == 0:
            return

        bar = Bar(
            symbol=symbol,
            timeframe=timeframe.value,
            open=state.open,
            high=state.high,
            low=state.low,
            close=state.close,
            volume=state.volume,
            vwap=state.vwap,
            trade_count=state.trade_count,
            timestamp=state.bar_start or datetime.now(timezone.utc),
        )

        logger.debug(
            f"Bar complete: {symbol} {timeframe.value} "
            f"O:{bar.open} H:{bar.high} L:{bar.low} C:{bar.close} V:{bar.volume}"
        )

        if self._on_bar_complete:
            try:
                # Support both sync and async callbacks
                result = self._on_bar_complete(bar)
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception as e:
                logger.error(f"Error in bar callback: {e}")

    async def _bar_timer(self) -> None:
        """Background task to close bars at timeframe boundaries."""
        while self._running:
            try:
                now = datetime.now(timezone.utc)

                # Check each symbol and timeframe
                for symbol, timeframe_states in list(self._states.items()):
                    for tf_str, state in list(timeframe_states.items()):
                        if state.bar_start is None:
                            continue

                        tf = BarTimeframe(tf_str)
                        bar_end = self._get_bar_end(state.bar_start, tf)

                        if now >= bar_end and state.trade_count > 0:
                            self._complete_bar(symbol, tf, state)
                            state.reset()

                # Sleep until next second
                await asyncio.sleep(1.0)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Bar timer error: {e}")
                await asyncio.sleep(1.0)

    def get_current_bar(self, symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
        """
        Get the current in-progress bar for a symbol/timeframe.

        Args:
            symbol: Stock ticker symbol
            timeframe: Bar timeframe (e.g., "1m", "5m")

        Returns:
            Current bar data or None if no data
        """
        symbol = symbol.upper()

        if symbol not in self._states:
            return None

        if timeframe not in self._states[symbol]:
            return None

        state = self._states[symbol][timeframe]

        if state.trade_count == 0:
            return None

        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "open": state.open,
            "high": state.high,
            "low": state.low,
            "close": state.close,
            "volume": state.volume,
            "vwap": round(state.vwap, 4) if state.vwap else 0,
            "trade_count": state.trade_count,
            "bar_start": state.bar_start.isoformat() + "Z" if state.bar_start else None,
            "in_progress": True,
        }

    def get_subscribed_symbols(self) -> List[str]:
        """Get list of subscribed symbols."""
        return list(self._states.keys())
