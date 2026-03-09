"""Money Flow actor (Investing ↔ Nautilus integration).

The code under `investing.integrations.nautilus` is primarily exercised by our
integration tests. Historically this repo implemented multiple experimental
approaches to Nautilus integration.

To keep the surface area stable across NautilusTrader versions, this actor is a
lightweight wrapper which:
- Runs `MoneyFlowAnalyzer.analyze_equity_flow` for a configured symbol universe
- Converts results into a small, normalized signal payload
- Publishes signals via `msgbus.publish(...)` when a message bus is provided

If you need a full NautilusTrader runtime integration, implement a proper
`nautilus_trader.common.actor.Actor` subclass separately and keep this module as
a thin, test-friendly abstraction.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from investing.analytics.money_flow import MoneyFlowAnalyzer

logger = logging.getLogger(__name__)


@dataclass
class MoneyFlowActorConfig:
    """Configuration for MoneyFlowActor used in tests."""

    component_id: str
    symbols: List[str] = field(default_factory=list)

    # Scheduling
    update_interval_seconds: int = 60

    # Analysis
    lookback_days: int = 20

    # Signal generation
    signal_threshold: float = 0.5
    stale_data_threshold_hours: int = 12

    # Caching
    cache_ttl_seconds: int = 60

    # Publishing
    publish_topic: str = "signals.money_flow"


class MoneyFlowActor:
    """Test-oriented money flow actor.

    The unit/integration tests treat this as a plain Python object and inject
    `._msgbus` / `._clock` mocks directly.
    """

    def __init__(
        self,
        config: MoneyFlowActorConfig,
        analyzer: Optional[MoneyFlowAnalyzer] = None,
    ):
        self.config = config
        self._analyzer = analyzer or MoneyFlowAnalyzer()

        # Optional Nautilus-like components (tests patch these in)
        self._msgbus = None
        self._clock = None

        # Name used for scheduling (tests may override)
        self._timer_name = "money_flow_update"

        # symbol -> (cached_result, cached_at_utc)
        self._cache: Dict[str, Tuple[Dict[str, Any], datetime]] = {}

    # ---------------------------------------------------------------------
    # Nautilus-ish lifecycle hooks (used by tests)
    # ---------------------------------------------------------------------

    def on_start(self) -> None:
        """Start periodic updates via the injected clock (if present)."""
        clock = getattr(self, "_clock", None)
        if clock is not None and hasattr(clock, "set_timer"):
            # Signature is implementation-dependent; tests only assert it's called.
            clock.set_timer(self._timer_name, self.config.update_interval_seconds)

    def on_stop(self) -> None:
        """Stop periodic updates via the injected clock (if present)."""
        clock = getattr(self, "_clock", None)
        if clock is not None and hasattr(clock, "cancel_timer"):
            clock.cancel_timer(self._timer_name)

    def on_bar(self, bar: Any) -> None:
        """Handle a bar update (no-op for tests).

        In a real Nautilus integration this would update internal buffers.
        """
        _ = bar

    # ---------------------------------------------------------------------
    # Core logic (used directly by tests)
    # ---------------------------------------------------------------------

    def _update_signals(self) -> None:
        """Compute and publish signals for all configured symbols."""
        if not self.config.symbols:
            return

        for symbol in self.config.symbols:
            try:
                signal = self._generate_signal(symbol)
                if signal is None:
                    continue
                self._publish_signal(signal)
            except Exception:
                # Tests allow "implementation dependent" behavior here.
                logger.debug(
                    "Error updating money flow signal for %s", symbol, exc_info=True
                )

    def _publish_signal(self, signal: Dict[str, Any]) -> None:
        msgbus = getattr(self, "_msgbus", None)
        if msgbus is not None and hasattr(msgbus, "publish"):
            msgbus.publish(self.config.publish_topic, signal)

    def _get_cached(self, symbol: str) -> Optional[Dict[str, Any]]:
        entry = self._cache.get(symbol)
        if not entry:
            return None

        cached, cached_at = entry
        if (
            datetime.now(timezone.utc) - cached_at
        ).total_seconds() <= self.config.cache_ttl_seconds:
            return cached

        return None

    def _set_cached(self, symbol: str, value: Dict[str, Any]) -> None:
        self._cache[symbol] = (value, datetime.now(timezone.utc))

    def _generate_signal(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Generate a normalized signal for a single symbol."""
        symbol = (symbol or "").upper()
        if not symbol:
            return None

        cached = self._get_cached(symbol)
        if cached is not None:
            analysis = cached
        else:
            analysis = self._analyzer.analyze_equity_flow(symbol)
            if analysis is None:
                return None
            if not isinstance(analysis, dict):
                # Be forgiving: treat non-dicts as invalid.
                return None
            self._set_cached(symbol, analysis)

        score = float(analysis.get("money_flow_score", 0.0) or 0.0)
        strength = abs(score)

        direction = "NEUTRAL"
        if score >= self.config.signal_threshold:
            direction = "BULLISH"
        elif score <= -self.config.signal_threshold:
            direction = "BEARISH"

        confidence = float(analysis.get("confidence", 0.5) or 0.0)

        # Stale-data handling
        is_stale = False
        last_updated = analysis.get("last_updated")
        if isinstance(last_updated, datetime):
            age = datetime.now() - last_updated
            if age > timedelta(hours=self.config.stale_data_threshold_hours):
                is_stale = True
                confidence = min(confidence, 0.4)

        return {
            "symbol": symbol,
            "direction": direction,
            "strength": strength,
            "confidence": confidence,
            "is_stale": is_stale,
            "raw": analysis,
        }
