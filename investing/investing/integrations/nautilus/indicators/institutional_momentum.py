"""
Institutional Momentum Indicator for NautilusTrader

A custom indicator that measures institutional momentum by tracking
ownership trends, 13F filing changes, and smart money positioning.
"""

import logging
from collections import deque
from typing import Dict, Optional

import numpy as np

# NautilusTrader imports
from nautilus_trader.indicators.base import Indicator
from nautilus_trader.model.data import Bar

# Investing imports
from investing.analytics.institutional import InstitutionalAnalyzer

logger = logging.getLogger(__name__)


class InstitutionalMomentumIndicator(Indicator):
    """
    Institutional Momentum Indicator that tracks institutional positioning trends.

    Combines multiple institutional signals:
    - Ownership trend (increasing/decreasing institutional ownership)
    - Smart money score from Investing's InstitutionalAnalyzer
    - Concentration changes (diversification vs concentration)
    - Price momentum correlation with institutional activity

    The indicator outputs a momentum value between -1.0 and 1.0.
    """

    def __init__(
        self,
        period: int = 20,
        ownership_weight: float = 0.35,
        smart_money_weight: float = 0.30,
        concentration_weight: float = 0.15,
        momentum_weight: float = 0.20,
        symbol: Optional[str] = None,
        data_manager=None,
    ):
        """
        Initialize the Institutional Momentum Indicator.

        Args:
            period: Lookback period for momentum calculations
            ownership_weight: Weight for ownership trend signal (0-1)
            smart_money_weight: Weight for smart money signal (0-1)
            concentration_weight: Weight for concentration signal (0-1)
            momentum_weight: Weight for price momentum correlation (0-1)
            symbol: Stock symbol to track (for institutional data)
            data_manager: Optional data manager for Investing analytics
        """
        super().__init__([period])

        self._period = period
        self._symbol = symbol

        # Weights (normalize to sum to 1.0)
        total_weight = (
            ownership_weight
            + smart_money_weight
            + concentration_weight
            + momentum_weight
        )
        self._ownership_weight = ownership_weight / total_weight
        self._smart_money_weight = smart_money_weight / total_weight
        self._concentration_weight = concentration_weight / total_weight
        self._momentum_weight = momentum_weight / total_weight

        # Investing analyzer
        self._analyzer = InstitutionalAnalyzer(data_manager)

        # Data buffers
        self._closes: deque = deque(maxlen=period * 2)
        self._volumes: deque = deque(maxlen=period * 2)
        self._returns: deque = deque(maxlen=period)

        # Institutional data buffers
        self._ownership_history: deque = deque(maxlen=period)
        self._smart_money_history: deque = deque(maxlen=period)
        self._concentration_history: deque = deque(maxlen=period)

        # Current values
        self._value: float = 0.0
        self._signal_strength: float = 0.0
        self._confidence: float = 0.0

        # Component signals
        self._ownership_signal: float = 0.0
        self._smart_money_signal: float = 0.0
        self._concentration_signal: float = 0.0
        self._momentum_signal: float = 0.0

        # Cached institutional data
        self._current_holdings: Optional[Dict] = None
        self._last_data_update: int = 0
        self._data_update_interval: int = 10  # Update every N bars

        # Bar counter
        self._bar_count: int = 0

    def handle_bar(self, bar: Bar) -> None:
        """
        Update the indicator with new bar data.

        Args:
            bar: New bar data
        """
        close = float(bar.close)
        volume = float(bar.volume)

        # Calculate return
        if len(self._closes) > 0:
            prev_close = self._closes[-1]
            ret = (close - prev_close) / prev_close if prev_close > 0 else 0.0
            self._returns.append(ret)

        # Update price buffers
        self._closes.append(close)
        self._volumes.append(volume)

        self._bar_count += 1

        # Update institutional data periodically
        if self._bar_count - self._last_data_update >= self._data_update_interval:
            self._update_institutional_data()
            self._last_data_update = self._bar_count

        # Calculate component signals
        self._update_ownership_signal()
        self._update_smart_money_signal()
        self._update_concentration_signal()
        self._update_momentum_signal()

        # Calculate final value
        self._update_value()

        self._set_initialized(True)

    def _update_institutional_data(self) -> None:
        """
        Fetch and update institutional data from Investing analyzer.
        """
        if not self._symbol:
            return

        try:
            holdings = self._analyzer.get_holdings(self._symbol)
            self._current_holdings = holdings

            # Update history buffers
            ownership = holdings.get("institutional_ownership", 0.0)
            smart_money = holdings.get("smart_money_score", 0.0)
            concentration = holdings.get("concentration_risk", 0.0)

            self._ownership_history.append(ownership)
            self._smart_money_history.append(smart_money)
            self._concentration_history.append(concentration)

        except Exception as e:
            logger.debug(f"Error updating institutional data: {e}")

    def _update_ownership_signal(self) -> None:
        """
        Calculate ownership trend signal.

        Positive signal when institutional ownership is increasing,
        negative when decreasing.
        """
        if len(self._ownership_history) < 3:
            return

        ownership_list = list(self._ownership_history)

        # Calculate trend using linear regression slope
        n = len(ownership_list)
        x = np.arange(n)
        y = np.array(ownership_list)

        # Simple linear regression
        x_mean = x.mean()
        y_mean = y.mean()

        numerator = np.sum((x - x_mean) * (y - y_mean))
        denominator = np.sum((x - x_mean) ** 2)

        if denominator > 0:
            slope = numerator / denominator
            # Normalize slope to -1 to 1 range
            # Typical ownership changes are small (e.g., 0.01 per period)
            self._ownership_signal = max(-1.0, min(1.0, slope * 100))
        else:
            self._ownership_signal = 0.0

        # Also factor in current ownership level
        if self._current_holdings:
            ownership_trend = self._current_holdings.get("ownership_trend", 0.0)
            self._ownership_signal = (
                0.7 * self._ownership_signal + 0.3 * ownership_trend
            )

    def _update_smart_money_signal(self) -> None:
        """
        Calculate smart money signal from Investing analytics.
        """
        if len(self._smart_money_history) < 2:
            if self._current_holdings:
                self._smart_money_signal = self._current_holdings.get(
                    "smart_money_score", 0.0
                )
            return

        smart_money_list = list(self._smart_money_history)

        # Use weighted average with recency bias
        weights = np.linspace(0.5, 1.0, len(smart_money_list))
        weights = weights / weights.sum()

        weighted_avg = np.average(smart_money_list, weights=weights)

        # Check for momentum in smart money
        recent_smart_money = np.mean(smart_money_list[-3:])
        earlier_smart_money = (
            np.mean(smart_money_list[:-3])
            if len(smart_money_list) > 3
            else recent_smart_money
        )

        smart_money_momentum = recent_smart_money - earlier_smart_money

        # Combine level and momentum
        self._smart_money_signal = 0.6 * weighted_avg + 0.4 * smart_money_momentum

        # Clamp to range
        self._smart_money_signal = max(-1.0, min(1.0, self._smart_money_signal))

    def _update_concentration_signal(self) -> None:
        """
        Calculate concentration signal.

        Decreasing concentration (more diversified ownership) is typically bullish
        as it suggests broader institutional interest.
        """
        if len(self._concentration_history) < 3:
            return

        concentration_list = list(self._concentration_history)

        # Calculate change in concentration
        recent_concentration = np.mean(concentration_list[-3:])
        earlier_concentration = (
            np.mean(concentration_list[:-3])
            if len(concentration_list) > 3
            else recent_concentration
        )

        concentration_change = (
            earlier_concentration - recent_concentration
        )  # Negative change = increasing concentration

        # Normalize and invert (lower concentration is bullish)
        self._concentration_signal = concentration_change * 5  # Scale factor

        # Also factor in absolute level
        current_concentration = concentration_list[-1] if concentration_list else 0.5
        concentration_level_signal = (
            1.0 - current_concentration * 2
        )  # 0 concentration = 1, 0.5 = 0, 1 = -1

        self._concentration_signal = (
            0.6 * self._concentration_signal + 0.4 * concentration_level_signal
        )

        # Clamp to range
        self._concentration_signal = max(-1.0, min(1.0, self._concentration_signal))

    def _update_momentum_signal(self) -> None:
        """
        Calculate price momentum correlation with institutional activity.

        Strong price momentum aligned with institutional buying is bullish.
        """
        if len(self._returns) < self._period // 2:
            return

        returns_list = list(self._returns)

        # Calculate momentum
        cumulative_return = np.sum(returns_list[-self._period // 2 :])
        momentum = cumulative_return

        # Calculate momentum strength
        avg_abs_return = np.mean(np.abs(returns_list))
        if avg_abs_return > 0:
            momentum_strength = abs(momentum) / (
                avg_abs_return * len(returns_list[-self._period // 2 :]) / 2
            )
        else:
            momentum_strength = 0.0

        # Combine direction and strength
        self._momentum_signal = np.sign(momentum) * min(1.0, momentum_strength)

        # If we have institutional data, weight by alignment
        if self._current_holdings:
            smart_money = self._current_holdings.get("smart_money_score", 0.0)

            # Institutional alignment multiplier
            if np.sign(self._momentum_signal) == np.sign(smart_money):
                # Aligned - boost signal
                alignment_factor = 1.0 + abs(smart_money) * 0.3
            else:
                # Divergent - reduce signal
                alignment_factor = 1.0 - abs(smart_money) * 0.3

            self._momentum_signal *= alignment_factor
            self._momentum_signal = max(-1.0, min(1.0, self._momentum_signal))

    def _update_value(self) -> None:
        """
        Calculate the final indicator value from component signals.
        """
        # Combine component signals with weights
        self._value = (
            self._ownership_weight * self._ownership_signal
            + self._smart_money_weight * self._smart_money_signal
            + self._concentration_weight * self._concentration_signal
            + self._momentum_weight * self._momentum_signal
        )

        # Clamp to -1 to 1 range
        self._value = max(-1.0, min(1.0, self._value))

        # Calculate signal strength (absolute value)
        self._signal_strength = abs(self._value)

        # Calculate confidence
        self._calculate_confidence()

    def _calculate_confidence(self) -> None:
        """
        Calculate confidence based on data quality and signal agreement.
        """
        signals = [
            self._ownership_signal,
            self._smart_money_signal,
            self._concentration_signal,
            self._momentum_signal,
        ]

        # Count signals in same direction
        positive_count = sum(1 for s in signals if s > 0.1)
        negative_count = sum(1 for s in signals if s < -0.1)

        agreement = max(positive_count, negative_count) / len(signals)

        # Data quality factor
        data_quality = 0.5  # Base quality

        if len(self._ownership_history) >= self._period // 2:
            data_quality += 0.2

        if self._current_holdings is not None:
            data_quality += 0.2

        if len(self._returns) >= self._period:
            data_quality += 0.1

        # Combine factors
        self._confidence = agreement * data_quality * self._signal_strength

        # Clamp to range
        self._confidence = max(0.0, min(1.0, self._confidence))

    def set_symbol(self, symbol: str) -> None:
        """
        Set the symbol to track.

        Args:
            symbol: Stock symbol
        """
        self._symbol = symbol
        # Reset institutional data
        self._ownership_history.clear()
        self._smart_money_history.clear()
        self._concentration_history.clear()
        self._current_holdings = None

    @property
    def value(self) -> float:
        """
        Get the current indicator value.

        Returns:
            Institutional momentum signal (-1.0 to 1.0)
        """
        return self._value

    @property
    def signal_strength(self) -> float:
        """
        Get the absolute signal strength.

        Returns:
            Signal strength (0.0 to 1.0)
        """
        return self._signal_strength

    @property
    def confidence(self) -> float:
        """
        Get the confidence score.

        Returns:
            Confidence (0.0 to 1.0)
        """
        return self._confidence

    @property
    def ownership_signal(self) -> float:
        """Get the ownership trend component signal."""
        return self._ownership_signal

    @property
    def smart_money_signal(self) -> float:
        """Get the smart money component signal."""
        return self._smart_money_signal

    @property
    def concentration_signal(self) -> float:
        """Get the concentration component signal."""
        return self._concentration_signal

    @property
    def momentum_signal(self) -> float:
        """Get the price momentum component signal."""
        return self._momentum_signal

    @property
    def institutional_ownership(self) -> Optional[float]:
        """Get the current institutional ownership percentage."""
        if self._current_holdings:
            return self._current_holdings.get("institutional_ownership")
        return None

    @property
    def period(self) -> int:
        """Get the lookback period."""
        return self._period

    @property
    def symbol(self) -> Optional[str]:
        """Get the tracked symbol."""
        return self._symbol

    def get_component_signals(self) -> Dict[str, float]:
        """
        Get all component signals.

        Returns:
            Dictionary of component signal values
        """
        return {
            "ownership": self._ownership_signal,
            "smart_money": self._smart_money_signal,
            "concentration": self._concentration_signal,
            "momentum": self._momentum_signal,
        }

    def reset(self) -> None:
        """Reset the indicator state."""
        self._closes.clear()
        self._volumes.clear()
        self._returns.clear()

        self._ownership_history.clear()
        self._smart_money_history.clear()
        self._concentration_history.clear()

        self._value = 0.0
        self._signal_strength = 0.0
        self._confidence = 0.0
        self._ownership_signal = 0.0
        self._smart_money_signal = 0.0
        self._concentration_signal = 0.0
        self._momentum_signal = 0.0

        self._current_holdings = None
        self._last_data_update = 0
        self._bar_count = 0

        self._set_initialized(False)

    def is_bullish(self, threshold: float = 0.3) -> bool:
        """
        Check if institutional momentum is bullish.

        Args:
            threshold: Minimum value to consider bullish

        Returns:
            True if bullish
        """
        return self._value >= threshold

    def is_bearish(self, threshold: float = -0.3) -> bool:
        """
        Check if institutional momentum is bearish.

        Args:
            threshold: Maximum value to consider bearish

        Returns:
            True if bearish
        """
        return self._value <= threshold

    def is_neutral(self, threshold: float = 0.3) -> bool:
        """
        Check if institutional momentum is neutral.

        Args:
            threshold: Range around zero to consider neutral

        Returns:
            True if neutral
        """
        return abs(self._value) < threshold

    def get_sentiment(self) -> str:
        """
        Get the institutional sentiment as a string.

        Returns:
            Sentiment string ('bullish', 'bearish', or 'neutral')
        """
        if self.is_bullish():
            return "bullish"
        elif self.is_bearish():
            return "bearish"
        return "neutral"
