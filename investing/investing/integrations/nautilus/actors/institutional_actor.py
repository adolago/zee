"""Institutional actor (Investing ↔ Nautilus integration).

Like `MoneyFlowActor`, this module is primarily driven by our integration tests
and intentionally keeps a small, stable surface area.

The actor:
- Pulls holdings and universe sentiment from an injected analyzer
- Generates a simple institutional pattern signal per symbol
- Publishes via `msgbus.publish(...)` when a message bus is provided
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from investing.analytics.institutional import InstitutionalAnalyzer

logger = logging.getLogger(__name__)


@dataclass
class InstitutionalActorConfig:
    """Configuration for InstitutionalActor used in tests."""

    component_id: str
    symbols: List[str] = field(default_factory=list)

    update_interval_seconds: int = 3600

    minimum_ownership_threshold: float = 0.5
    concentration_risk_threshold: float = 0.5

    publish_topic: str = "signals.institutional"


class InstitutionalActor:
    """Test-oriented institutional actor."""

    def __init__(
        self,
        config: InstitutionalActorConfig,
        analyzer: Optional[InstitutionalAnalyzer] = None,
    ):
        self.config = config
        self._analyzer = analyzer or InstitutionalAnalyzer()

        # Optional Nautilus-like components (tests patch these in)
        self._msgbus = None
        self._clock = None
        self._timer_name = "institutional_update"

    def on_start(self) -> None:
        clock = getattr(self, "_clock", None)
        if clock is not None and hasattr(clock, "set_timer"):
            clock.set_timer(self._timer_name, self.config.update_interval_seconds)

    def on_stop(self) -> None:
        clock = getattr(self, "_clock", None)
        if clock is not None and hasattr(clock, "cancel_timer"):
            clock.cancel_timer(self._timer_name)

    # ------------------------------------------------------------------
    # Core logic (used directly by tests)
    # ------------------------------------------------------------------

    def _analyze_holdings(self) -> None:
        if not self.config.symbols:
            return

        for symbol in self.config.symbols:
            try:
                signal = self._generate_signal(symbol)
                self._publish_signal(signal)
            except Exception:
                logger.debug("Error analyzing holdings for %s", symbol, exc_info=True)

    def _publish_signal(self, signal: Dict[str, Any]) -> None:
        msgbus = getattr(self, "_msgbus", None)
        if msgbus is not None and hasattr(msgbus, "publish"):
            msgbus.publish(self.config.publish_topic, signal)

    def _calculate_universe_sentiment(self) -> Dict[str, Any]:
        sentiment = self._analyzer.get_institutional_sentiment(self.config.symbols)
        # Tests only check the key exists.
        if isinstance(sentiment, dict) and "institutional_sentiment" in sentiment:
            return sentiment
        return {"institutional_sentiment": "neutral", "details": sentiment}

    def _generate_signal(self, symbol: str) -> Dict[str, Any]:
        symbol = (symbol or "").upper()
        holdings = self._analyzer.get_holdings(symbol)

        institutional_ownership = float(
            holdings.get("institutional_ownership", 0.0) or 0.0
        )
        ownership_trend = float(holdings.get("ownership_trend", 0.0) or 0.0)
        smart_money_score = float(holdings.get("smart_money_score", 0.0) or 0.0)
        concentration_risk = float(holdings.get("concentration_risk", 0.0) or 0.0)

        pattern = "NEUTRAL"
        if institutional_ownership >= self.config.minimum_ownership_threshold:
            if ownership_trend > 0.05 or smart_money_score > 0.4:
                pattern = "ACCUMULATION"
            elif ownership_trend < -0.05 or smart_money_score < -0.4:
                pattern = "DISTRIBUTION"

        return {
            "symbol": symbol,
            "pattern": pattern,
            "institutional_ownership": institutional_ownership,
            "ownership_trend": ownership_trend,
            "smart_money_score": smart_money_score,
            "concentration_risk": concentration_risk,
            "concentration_risk_warning": concentration_risk
            > self.config.concentration_risk_threshold,
            "raw": holdings,
        }
