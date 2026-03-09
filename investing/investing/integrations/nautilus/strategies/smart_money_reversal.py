"""
Smart Money Reversal Strategy

A mean-reversion strategy that trades divergences between
smart money positioning and price action.

Strategy Logic:
1. Track smart money indicators (institutional flow, dark pool sentiment)
2. Detect divergences where price moves against smart money positioning
3. Enter reversal trades expecting price to align with smart money
4. Use tight risk management as reversals are higher risk

Key Concept:
When retail pushes price in one direction but smart money is positioned
the other way, price often reverts to align with institutional positioning.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from investing.integrations.nautilus.strategies.base import (
    InvestingStrategy,
    InvestingStrategyConfig,
    NAUTILUS_AVAILABLE,
)

if NAUTILUS_AVAILABLE:
    from nautilus_trader.model.data import Bar

logger = logging.getLogger(__name__)


@dataclass
class SmartMoneyState:
    """Tracks smart money positioning for a symbol."""

    symbol: str
    smart_money_score: float  # -1 (bearish) to 1 (bullish)
    institutional_flow: float  # Net institutional buying/selling
    dark_pool_sentiment: str  # ACCUMULATION, DISTRIBUTION, NEUTRAL
    retail_flow: float  # Estimated retail flow (inverse proxy)
    divergence_score: float  # How much price diverges from smart money
    confidence: float


class SmartMoneyReversalStrategyConfig(InvestingStrategyConfig):
    """
    Configuration for Smart Money Reversal Strategy.

    Attributes:
        divergence_threshold: Minimum divergence score for entry
        smart_money_threshold: Minimum smart money score magnitude
        price_extension_pct: Minimum price extension from mean
        lookback_bars: Bars to calculate price extension
        reversal_confirmation_bars: Bars to confirm reversal
    """

    def __init__(
        self,
        strategy_id: str = "SmartMoneyReversal-001",
        instrument_ids: tuple[str, ...] = (),
        max_position_size_pct: float = 0.06,  # More conservative for reversals
        stop_loss_pct: float = 0.04,  # Tighter stops
        take_profit_pct: float = 0.08,  # Smaller targets
        confidence_threshold: float = 0.7,
        divergence_threshold: float = 0.5,
        smart_money_threshold: float = 0.4,
        price_extension_pct: float = 0.03,  # 3% from moving average
        lookback_bars: int = 20,
        reversal_confirmation_bars: int = 2,
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
        self.divergence_threshold = divergence_threshold
        self.smart_money_threshold = smart_money_threshold
        self.price_extension_pct = price_extension_pct
        self.lookback_bars = lookback_bars
        self.reversal_confirmation_bars = reversal_confirmation_bars


class SmartMoneyReversalStrategy(InvestingStrategy):
    """
    Mean-reversion strategy based on smart money divergence.

    The strategy identifies opportunities when:
    1. Smart money is strongly positioned in one direction
    2. Price has moved significantly in the opposite direction
    3. The divergence exceeds a threshold

    Entry Signals:
    - LONG: Smart money bullish + price extended downward
    - SHORT: Smart money bearish + price extended upward

    This is a contrarian strategy that fades retail-driven moves
    in favor of institutional positioning.
    """

    def __init__(self, config: SmartMoneyReversalStrategyConfig):
        super().__init__(config)

        self.config: SmartMoneyReversalStrategyConfig = config

        # Smart money state cache
        self._smart_money_states: Dict[str, SmartMoneyState] = {}

        # Price history for extension calculation
        self._price_history: Dict[str, List[float]] = {}

        # Moving averages
        self._moving_averages: Dict[str, float] = {}

        # Reversal confirmation tracking
        self._reversal_bars: Dict[str, int] = {}
        self._reversal_direction: Dict[str, str] = {}
        self._reversal_trigger_price: Dict[str, float] = {}

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

            symbol = str(instrument_id.symbol)
            self._price_history[symbol] = []

            logger.info(f"Subscribed to {instrument_id}")

    def update_smart_money_state(
        self,
        symbol: str,
        smart_money_score: float,
        institutional_flow: float,
        dark_pool_sentiment: str,
        retail_flow: float,
        confidence: float,
    ) -> None:
        """
        Update smart money state for a symbol.

        Args:
            symbol: Stock symbol
            smart_money_score: Combined smart money score (-1 to 1)
            institutional_flow: Net institutional buying/selling
            dark_pool_sentiment: ACCUMULATION, DISTRIBUTION, NEUTRAL
            retail_flow: Estimated retail flow
            confidence: Signal confidence
        """
        # Calculate divergence from price
        ma = self._moving_averages.get(symbol)
        history = self._price_history.get(symbol, [])

        divergence_score = 0.0
        if ma and history:
            current_price = history[-1]
            price_extension = (current_price - ma) / ma

            # Divergence: price going one way, smart money the other
            if smart_money_score > 0 and price_extension < 0:
                # Smart money bullish but price down
                divergence_score = abs(smart_money_score * price_extension)
            elif smart_money_score < 0 and price_extension > 0:
                # Smart money bearish but price up
                divergence_score = abs(smart_money_score * price_extension)

        self._smart_money_states[symbol] = SmartMoneyState(
            symbol=symbol,
            smart_money_score=smart_money_score,
            institutional_flow=institutional_flow,
            dark_pool_sentiment=dark_pool_sentiment,
            retail_flow=retail_flow,
            divergence_score=divergence_score,
            confidence=confidence,
        )

    def on_event(self, event: Any) -> None:
        """Handle smart money events from actors."""
        symbol = getattr(event, "symbol", None)
        if not symbol:
            return

        # Handle SmartMoneyIndicator output
        if hasattr(event, "smart_money_score"):
            self.update_smart_money_state(
                symbol=symbol,
                smart_money_score=getattr(event, "smart_money_score", 0.0),
                institutional_flow=getattr(event, "institutional_flow", 0.0),
                dark_pool_sentiment=getattr(event, "dark_pool_sentiment", "NEUTRAL"),
                retail_flow=getattr(event, "retail_flow", 0.0),
                confidence=getattr(event, "confidence", 0.5),
            )

    def on_bar(self, bar: Bar) -> None:
        """Process bar data and track price history."""
        symbol = str(bar.bar_type.instrument_id.symbol)
        current_price = float(bar.close)

        # Update price history
        if symbol not in self._price_history:
            self._price_history[symbol] = []

        self._price_history[symbol].append(current_price)

        # Keep last N bars
        lookback = self.config.lookback_bars
        if len(self._price_history[symbol]) > lookback:
            self._price_history[symbol] = self._price_history[symbol][-lookback:]

        # Calculate moving average
        history = self._price_history[symbol]
        if len(history) >= lookback:
            self._moving_averages[symbol] = sum(history) / len(history)

        # Update divergence score if we have smart money state
        if symbol in self._smart_money_states:
            state = self._smart_money_states[symbol]
            self.update_smart_money_state(
                symbol=symbol,
                smart_money_score=state.smart_money_score,
                institutional_flow=state.institutional_flow,
                dark_pool_sentiment=state.dark_pool_sentiment,
                retail_flow=state.retail_flow,
                confidence=state.confidence,
            )

        # Check for reversal confirmation
        if symbol in self._reversal_bars:
            self._check_reversal_confirmation(symbol, bar)
            return

        # Parent class handles exit conditions
        super().on_bar(bar)

    def _check_reversal_confirmation(self, symbol: str, bar: Bar) -> None:
        """Check if a reversal setup is confirming."""
        trigger_price = self._reversal_trigger_price.get(symbol)
        direction = self._reversal_direction.get(symbol)
        current_price = float(bar.close)

        # Check if price is moving in expected direction
        confirming = False
        if direction == "LONG" and trigger_price:
            confirming = current_price > trigger_price
        elif direction == "SHORT" and trigger_price:
            confirming = current_price < trigger_price

        if confirming:
            self._reversal_bars[symbol] += 1

            if self._reversal_bars[symbol] >= self.config.reversal_confirmation_bars:
                # Reversal confirmed, enter position
                state = self._smart_money_states.get(symbol)
                reason = (
                    f"[SM={state.smart_money_score:.2f}, "
                    f"Div={state.divergence_score:.2f}]"
                    if state
                    else "[Reversal Confirmed]"
                )

                if direction == "LONG":
                    self._enter_long(symbol, bar, reason)
                elif direction == "SHORT":
                    self._enter_short(symbol, bar, reason)

                # Clear reversal tracking
                self._clear_reversal_tracking(symbol)
        else:
            # Reversal failed, reset
            logger.debug(f"Reversal setup failed for {symbol}")
            self._clear_reversal_tracking(symbol)

    def _clear_reversal_tracking(self, symbol: str) -> None:
        """Clear reversal tracking for a symbol."""
        self._reversal_bars.pop(symbol, None)
        self._reversal_direction.pop(symbol, None)
        self._reversal_trigger_price.pop(symbol, None)

    def _evaluate_entry(self, symbol: str, bar: Bar) -> None:
        """
        Evaluate reversal entry conditions.

        Args:
            symbol: Symbol to evaluate
            bar: Current bar data
        """
        # Get smart money state
        state = self._smart_money_states.get(symbol)
        if state is None:
            return

        # Check confidence
        if state.confidence < self.config.confidence_threshold:
            return

        # Check smart money score magnitude
        if abs(state.smart_money_score) < self.config.smart_money_threshold:
            return

        # Check divergence threshold
        if state.divergence_score < self.config.divergence_threshold:
            return

        # Check price extension
        ma = self._moving_averages.get(symbol)
        if not ma:
            return

        current_price = float(bar.close)
        price_extension = (current_price - ma) / ma

        # Look for reversal setups
        if state.smart_money_score > self.config.smart_money_threshold:
            # Smart money bullish
            if price_extension < -self.config.price_extension_pct:
                # Price extended below MA - potential long reversal
                logger.info(
                    f"Smart money reversal setup (LONG) for {symbol}: "
                    f"SM={state.smart_money_score:.2f}, "
                    f"Extension={price_extension:.2%}, "
                    f"Divergence={state.divergence_score:.2f}"
                )
                self._reversal_bars[symbol] = 1
                self._reversal_direction[symbol] = "LONG"
                self._reversal_trigger_price[symbol] = current_price

        elif state.smart_money_score < -self.config.smart_money_threshold:
            # Smart money bearish
            if price_extension > self.config.price_extension_pct:
                # Price extended above MA - potential short reversal
                logger.info(
                    f"Smart money reversal setup (SHORT) for {symbol}: "
                    f"SM={state.smart_money_score:.2f}, "
                    f"Extension={price_extension:.2%}, "
                    f"Divergence={state.divergence_score:.2f}"
                )
                self._reversal_bars[symbol] = 1
                self._reversal_direction[symbol] = "SHORT"
                self._reversal_trigger_price[symbol] = current_price
