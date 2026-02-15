"""
Institutional Momentum Strategy

A trading strategy that combines Stanley's institutional analytics
with NautilusTrader's execution capabilities.

Strategy Logic:
1. Monitor money flow signals from MoneyFlowActor
2. Track institutional positioning from InstitutionalActor
3. Enter long on strong accumulation (positive money flow + institutional buying)
4. Enter short on strong distribution (negative money flow + institutional selling)
5. Manage risk with stop losses and position sizing
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from stanley.integrations.nautilus.strategies.base import (
    StanleyStrategy,
    StanleyStrategyConfig,
    NAUTILUS_AVAILABLE,
)

if NAUTILUS_AVAILABLE:
    from nautilus_trader.model.data import Bar

logger = logging.getLogger(__name__)


class InstitutionalMomentumStrategyConfig(StanleyStrategyConfig):
    """
    Configuration for Institutional Momentum Strategy.

    Attributes:
        money_flow_threshold: Minimum money flow score for entry
        institutional_threshold: Minimum institutional signal for entry
        money_flow_weight: Weight for money flow signal (0-1)
        institutional_weight: Weight for institutional signal (0-1)
    """

    def __init__(
        self,
        strategy_id: str = "InstitutionalMomentum-001",
        instrument_ids: tuple[str, ...] = (),
        max_position_size_pct: float = 0.10,
        stop_loss_pct: float = 0.05,
        take_profit_pct: float = 0.15,
        confidence_threshold: float = 0.6,
        money_flow_threshold: float = 0.4,
        institutional_threshold: float = 0.3,
        money_flow_weight: float = 0.6,
        institutional_weight: float = 0.4,
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
        self.money_flow_threshold = money_flow_threshold
        self.institutional_threshold = institutional_threshold
        self.money_flow_weight = money_flow_weight
        self.institutional_weight = institutional_weight


class InstitutionalMomentumStrategy(StanleyStrategy):
    """
    Trading strategy based on institutional momentum.

    Combines money flow analysis with institutional positioning to
    identify accumulation and distribution patterns.

    Entry Signals:
    - LONG: Combined signal >= money_flow_threshold with accumulation pattern
    - SHORT: Combined signal <= -money_flow_threshold with distribution pattern

    Exit Signals:
    - Stop loss hit
    - Take profit hit
    - Signal reversal (optional)
    """

    def __init__(self, config: InstitutionalMomentumStrategyConfig):
        super().__init__(config)

        self.config: InstitutionalMomentumStrategyConfig = config

        # Signal caches from actors
        self._money_flow_signals: Dict[str, Dict[str, Any]] = {}
        self._institutional_signals: Dict[str, Dict[str, Any]] = {}

    def on_start(self) -> None:
        """Subscribe to bar data for configured instruments."""
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
            logger.info(f"Subscribed to {instrument_id}")

    def on_event(self, event: Any) -> None:
        """
        Handle custom events from Stanley actors.

        Args:
            event: Event from MoneyFlowActor or InstitutionalActor
        """
        # Handle money flow signals
        if hasattr(event, "money_flow_score"):
            symbol = getattr(event, "symbol", None)
            if symbol:
                self._money_flow_signals[symbol] = {
                    "score": event.money_flow_score,
                    "direction": getattr(event, "direction", "NEUTRAL"),
                    "confidence": getattr(event, "confidence", 0.5),
                    "strength": getattr(event, "strength", 0.0),
                }

        # Handle institutional signals
        elif hasattr(event, "pattern"):
            symbol = getattr(event, "symbol", None)
            if symbol:
                self._institutional_signals[symbol] = {
                    "pattern": event.pattern,
                    "ownership": getattr(event, "institutional_ownership", 0.0),
                    "trend": getattr(event, "ownership_trend", 0.0),
                    "smart_money_score": getattr(event, "smart_money_score", 0.0),
                }

    def update_money_flow_signal(
        self,
        symbol: str,
        score: float,
        direction: str,
        confidence: float,
        strength: float,
    ) -> None:
        """
        Update money flow signal for a symbol.

        Args:
            symbol: Stock symbol
            score: Money flow score (-1 to 1)
            direction: BULLISH, BEARISH, or NEUTRAL
            confidence: Signal confidence (0-1)
            strength: Signal strength (0-1)
        """
        self._money_flow_signals[symbol] = {
            "score": score,
            "direction": direction,
            "confidence": confidence,
            "strength": strength,
        }

    def update_institutional_signal(
        self,
        symbol: str,
        pattern: str,
        ownership: float,
        trend: float,
        smart_money_score: float,
    ) -> None:
        """
        Update institutional signal for a symbol.

        Args:
            symbol: Stock symbol
            pattern: ACCUMULATION, DISTRIBUTION, or NEUTRAL
            ownership: Institutional ownership percentage
            trend: Ownership trend (-1 to 1)
            smart_money_score: Smart money score (-1 to 1)
        """
        self._institutional_signals[symbol] = {
            "pattern": pattern,
            "ownership": ownership,
            "trend": trend,
            "smart_money_score": smart_money_score,
        }

    def _evaluate_entry(self, symbol: str, bar: Bar) -> None:
        """
        Evaluate entry conditions for a symbol.

        Args:
            symbol: Symbol to evaluate
            bar: Current bar data
        """
        # Get signals
        money_flow = self._money_flow_signals.get(symbol)
        institutional = self._institutional_signals.get(symbol)

        if money_flow is None or institutional is None:
            return

        # Check confidence threshold
        mf_confidence = money_flow.get("confidence", 0.0)
        inst_confidence = 0.7 if institutional.get("pattern") != "NEUTRAL" else 0.3
        avg_confidence = (mf_confidence + inst_confidence) / 2

        if avg_confidence < self.config.confidence_threshold:
            return

        # Calculate combined signal
        mf_strength = money_flow.get("strength", 0.0)
        mf_direction = (
            1.0
            if money_flow.get("direction") == "BULLISH"
            else (-1.0 if money_flow.get("direction") == "BEARISH" else 0.0)
        )
        mf_signal = mf_strength * mf_direction

        inst_pattern = institutional.get("pattern", "NEUTRAL")
        inst_signal = (
            institutional.get("smart_money_score", 0.0)
            if inst_pattern != "NEUTRAL"
            else 0.0
        )

        combined_signal = (
            self.config.money_flow_weight * mf_signal
            + self.config.institutional_weight * inst_signal
        )

        # Generate entry signals
        if combined_signal >= self.config.money_flow_threshold:
            if inst_pattern == "ACCUMULATION":
                reason = f"[MF={mf_signal:.2f}, Inst={inst_signal:.2f}, Combined={combined_signal:.2f}]"
                self._enter_long(symbol, bar, reason)

        elif combined_signal <= -self.config.money_flow_threshold:
            if inst_pattern == "DISTRIBUTION":
                reason = f"[MF={mf_signal:.2f}, Inst={inst_signal:.2f}, Combined={combined_signal:.2f}]"
                self._enter_short(symbol, bar, reason)
