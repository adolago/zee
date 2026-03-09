"""
Dark Pool Breakout Strategy

A breakout trading strategy that uses unusual dark pool activity
as a leading indicator for price movements.

Strategy Logic:
1. Monitor dark pool volume and activity levels
2. Detect unusual dark pool prints (large blocks, venue concentration)
3. Enter breakout trades when dark pool signals confirm price action
4. Use dark pool sentiment for position bias (accumulation vs distribution)

Key Indicators:
- Dark pool percentage (vs lit exchanges)
- Block trade frequency and size
- Venue concentration (smart money venues)
- Dark pool sentiment (accumulation/distribution)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from investing.integrations.nautilus.strategies.base import (
    InvestingStrategy,
    InvestingStrategyConfig,
    NAUTILUS_AVAILABLE,
)

if NAUTILUS_AVAILABLE:
    from nautilus_trader.model.data import Bar

logger = logging.getLogger(__name__)


@dataclass
class DarkPoolSignal:
    """Represents a dark pool activity signal."""

    symbol: str
    dark_pool_pct: float  # Percentage of volume in dark pools
    block_trade_count: int  # Number of block trades detected
    avg_block_size: float  # Average block trade size
    sentiment: str  # ACCUMULATION, DISTRIBUTION, NEUTRAL
    venue_concentration: float  # How concentrated in smart money venues
    unusual_activity: bool  # Whether activity is unusually high
    confidence: float  # Signal confidence (0-1)


class DarkPoolBreakoutStrategyConfig(InvestingStrategyConfig):
    """
    Configuration for Dark Pool Breakout Strategy.

    Attributes:
        dark_pool_threshold: Minimum dark pool percentage for signal
        block_trade_threshold: Minimum block trades for confirmation
        unusual_activity_multiplier: Multiplier above average for "unusual"
        breakout_confirmation_bars: Bars to confirm price breakout
        volume_confirmation: Require volume confirmation
    """

    def __init__(
        self,
        strategy_id: str = "DarkPoolBreakout-001",
        instrument_ids: tuple[str, ...] = (),
        max_position_size_pct: float = 0.08,  # Slightly more conservative
        stop_loss_pct: float = 0.03,  # Tighter stops for breakouts
        take_profit_pct: float = 0.10,
        confidence_threshold: float = 0.7,
        dark_pool_threshold: float = 0.35,  # 35% dark pool minimum
        block_trade_threshold: int = 3,
        unusual_activity_multiplier: float = 1.5,
        breakout_confirmation_bars: int = 2,
        volume_confirmation: bool = True,
        **kwargs,
    ):
        super().__init__(
            strategy_id=strategy_id,
            instrument_ids=instrument_ids,
            max_position_size_pct=max_position_size_pct,
            stop_loss_pct=stop_loss_pct,
            take_profit_pct=take_profit_pct,
            confidence_threshold=confidence_threshold,
            **kwargs,
        )
        self.dark_pool_threshold = dark_pool_threshold
        self.block_trade_threshold = block_trade_threshold
        self.unusual_activity_multiplier = unusual_activity_multiplier
        self.breakout_confirmation_bars = breakout_confirmation_bars
        self.volume_confirmation = volume_confirmation


class DarkPoolBreakoutStrategy(InvestingStrategy):
    """
    Breakout strategy using dark pool activity as a leading indicator.

    The strategy looks for:
    1. Unusual dark pool activity (volume spike)
    2. Block trade accumulation or distribution
    3. Price approaching key levels (recent highs/lows)
    4. Confirmation via lit market breakout

    Entry Signals:
    - LONG: Accumulation + price breaking above resistance
    - SHORT: Distribution + price breaking below support

    The edge: Dark pool activity often precedes price moves as
    institutional traders accumulate/distribute before public moves.
    """

    def __init__(self, config: DarkPoolBreakoutStrategyConfig):
        super().__init__(config)

        self.config: DarkPoolBreakoutStrategyConfig = config

        # Dark pool signal cache
        self._dark_pool_signals: Dict[str, DarkPoolSignal] = {}

        # Price tracking for breakout detection
        self._recent_highs: Dict[str, float] = {}
        self._recent_lows: Dict[str, float] = {}
        self._bar_history: Dict[str, list] = {}

        # Breakout confirmation tracking
        self._breakout_bars: Dict[str, int] = {}
        self._breakout_direction: Dict[str, str] = {}

    def on_start(self) -> None:
        """Subscribe to bar data."""
        super().on_start()

        if not NAUTILUS_AVAILABLE:
            return

        from nautilus_trader.model.data import BarType
        from nautilus_trader.model.enums import (
            AggregationSource,
            BarAggregation,
            PriceType,
        )
        from nautilus_trader.model.identifiers import InstrumentId

        for instrument_id_str in self.config.instrument_ids:
            instrument_id = InstrumentId.from_str(instrument_id_str)
            instrument = self.cache.instrument(instrument_id)

            if instrument is None:
                logger.warning(f"Instrument not found: {instrument_id}")
                continue

            # Subscribe to daily bars for breakout detection
            bar_type = BarType(
                instrument_id=instrument_id,
                bar_spec=BarType.standard(
                    1,
                    BarAggregation.DAY,
                    PriceType.LAST,
                ).bar_spec,
                aggregation_source=AggregationSource.EXTERNAL,
            )

            self.subscribe_bars(bar_type)

            # Initialize tracking
            symbol = str(instrument_id.symbol)
            self._bar_history[symbol] = []

            logger.info(f"Subscribed to {instrument_id}")

    def update_dark_pool_signal(
        self,
        symbol: str,
        dark_pool_pct: float,
        block_trade_count: int,
        avg_block_size: float,
        sentiment: str,
        venue_concentration: float,
        unusual_activity: bool,
        confidence: float,
    ) -> None:
        """
        Update dark pool signal for a symbol.

        Args:
            symbol: Stock symbol
            dark_pool_pct: Percentage of volume in dark pools
            block_trade_count: Number of block trades
            avg_block_size: Average block size
            sentiment: ACCUMULATION, DISTRIBUTION, or NEUTRAL
            venue_concentration: Concentration in smart money venues
            unusual_activity: Whether activity is unusual
            confidence: Signal confidence
        """
        self._dark_pool_signals[symbol] = DarkPoolSignal(
            symbol=symbol,
            dark_pool_pct=dark_pool_pct,
            block_trade_count=block_trade_count,
            avg_block_size=avg_block_size,
            sentiment=sentiment,
            venue_concentration=venue_concentration,
            unusual_activity=unusual_activity,
            confidence=confidence,
        )

    def on_event(self, event: Any) -> None:
        """Handle dark pool events from actors."""
        if hasattr(event, "dark_pool_pct"):
            symbol = getattr(event, "symbol", None)
            if symbol:
                self.update_dark_pool_signal(
                    symbol=symbol,
                    dark_pool_pct=getattr(event, "dark_pool_pct", 0.0),
                    block_trade_count=getattr(event, "block_trade_count", 0),
                    avg_block_size=getattr(event, "avg_block_size", 0.0),
                    sentiment=getattr(event, "sentiment", "NEUTRAL"),
                    venue_concentration=getattr(event, "venue_concentration", 0.0),
                    unusual_activity=getattr(event, "unusual_activity", False),
                    confidence=getattr(event, "confidence", 0.5),
                )

    def on_bar(self, bar: Bar) -> None:
        """Process bar data and check for breakouts."""
        symbol = str(bar.bar_type.instrument_id.symbol)

        # Update bar history
        if symbol not in self._bar_history:
            self._bar_history[symbol] = []

        self._bar_history[symbol].append(
            {
                "high": float(bar.high),
                "low": float(bar.low),
                "close": float(bar.close),
                "volume": float(bar.volume),
            }
        )

        # Keep last 20 bars
        if len(self._bar_history[symbol]) > 20:
            self._bar_history[symbol] = self._bar_history[symbol][-20:]

        # Update recent highs/lows (last 10 bars)
        history = self._bar_history[symbol][-10:]
        if history:
            self._recent_highs[symbol] = (
                max(b["high"] for b in history[:-1])
                if len(history) > 1
                else float(bar.high)
            )
            self._recent_lows[symbol] = (
                min(b["low"] for b in history[:-1])
                if len(history) > 1
                else float(bar.low)
            )

        # Check for breakout continuation
        if symbol in self._breakout_bars:
            self._breakout_bars[symbol] += 1
            if self._breakout_bars[symbol] >= self.config.breakout_confirmation_bars:
                # Breakout confirmed, enter position
                direction = self._breakout_direction.get(symbol)
                if direction == "LONG":
                    self._enter_long(symbol, bar, "[DP Breakout Confirmed]")
                elif direction == "SHORT":
                    self._enter_short(symbol, bar, "[DP Breakout Confirmed]")

                # Clear breakout tracking
                del self._breakout_bars[symbol]
                del self._breakout_direction[symbol]
                return

        # Parent class handles exit conditions
        super().on_bar(bar)

    def _evaluate_entry(self, symbol: str, bar: Bar) -> None:
        """
        Evaluate breakout entry conditions.

        Args:
            symbol: Symbol to evaluate
            bar: Current bar data
        """
        # Get dark pool signal
        dp_signal = self._dark_pool_signals.get(symbol)
        if dp_signal is None:
            return

        # Check basic dark pool criteria
        if dp_signal.dark_pool_pct < self.config.dark_pool_threshold:
            return

        if dp_signal.block_trade_count < self.config.block_trade_threshold:
            return

        if dp_signal.confidence < self.config.confidence_threshold:
            return

        # Check for unusual activity
        if not dp_signal.unusual_activity:
            return

        current_price = float(bar.close)
        recent_high = self._recent_highs.get(symbol, current_price)
        recent_low = self._recent_lows.get(symbol, current_price)

        # Detect breakout with dark pool confirmation
        if dp_signal.sentiment == "ACCUMULATION":
            # Look for upside breakout
            if current_price > recent_high:
                logger.info(
                    f"Dark pool breakout detected for {symbol}: "
                    f"DP={dp_signal.dark_pool_pct:.1%}, "
                    f"Blocks={dp_signal.block_trade_count}, "
                    f"Sentiment=ACCUMULATION"
                )
                # Start breakout confirmation
                self._breakout_bars[symbol] = 1
                self._breakout_direction[symbol] = "LONG"

        elif dp_signal.sentiment == "DISTRIBUTION":
            # Look for downside breakout
            if current_price < recent_low:
                logger.info(
                    f"Dark pool breakdown detected for {symbol}: "
                    f"DP={dp_signal.dark_pool_pct:.1%}, "
                    f"Blocks={dp_signal.block_trade_count}, "
                    f"Sentiment=DISTRIBUTION"
                )
                # Start breakout confirmation
                self._breakout_bars[symbol] = 1
                self._breakout_direction[symbol] = "SHORT"
