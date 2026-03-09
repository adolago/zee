"""
Smart Money Indicator for NautilusTrader

A custom indicator that tracks smart money activity by combining
institutional flows, dark pool data, and block trade analysis.
"""

import logging
from collections import deque

import numpy as np

# NautilusTrader imports
from nautilus_trader.indicators.base import Indicator
from nautilus_trader.model.data import Bar

logger = logging.getLogger(__name__)


class SmartMoneyIndicator(Indicator):
    """
    Smart Money Indicator that tracks institutional activity patterns.

    Combines multiple institutional signals:
    - Institutional buy/sell ratio
    - Dark pool activity levels
    - Block trade frequency
    - Large order flow imbalance

    The indicator outputs a value between -1.0 (heavy selling) and 1.0 (heavy buying).
    """

    def __init__(
        self,
        period: int = 20,
        dark_pool_weight: float = 0.3,
        block_trade_weight: float = 0.25,
        flow_imbalance_weight: float = 0.25,
        volume_weight: float = 0.2,
        dark_pool_threshold: float = 0.25,
        block_trade_threshold: float = 0.10,
    ):
        """
        Initialize the Smart Money Indicator.

        Args:
            period: Lookback period for calculations
            dark_pool_weight: Weight for dark pool signal (0-1)
            block_trade_weight: Weight for block trade signal (0-1)
            flow_imbalance_weight: Weight for flow imbalance signal (0-1)
            volume_weight: Weight for volume signal (0-1)
            dark_pool_threshold: Threshold for significant dark pool activity
            block_trade_threshold: Threshold for significant block trades
        """
        super().__init__([period])

        self._period = period

        # Weights (should sum to 1.0)
        total_weight = (
            dark_pool_weight
            + block_trade_weight
            + flow_imbalance_weight
            + volume_weight
        )
        self._dark_pool_weight = dark_pool_weight / total_weight
        self._block_trade_weight = block_trade_weight / total_weight
        self._flow_imbalance_weight = flow_imbalance_weight / total_weight
        self._volume_weight = volume_weight / total_weight

        # Thresholds
        self._dark_pool_threshold = dark_pool_threshold
        self._block_trade_threshold = block_trade_threshold

        # Data buffers
        self._prices: deque = deque(maxlen=period)
        self._volumes: deque = deque(maxlen=period)
        self._highs: deque = deque(maxlen=period)
        self._lows: deque = deque(maxlen=period)
        self._closes: deque = deque(maxlen=period)
        self._opens: deque = deque(maxlen=period)

        # Derived metrics buffers
        self._dark_pool_percentages: deque = deque(maxlen=period)
        self._block_trade_ratios: deque = deque(maxlen=period)
        self._flow_imbalances: deque = deque(maxlen=period)
        self._volume_ratios: deque = deque(maxlen=period)

        # Current values
        self._value: float = 0.0
        self._signal_strength: float = 0.0
        self._confidence: float = 0.0

        # Component signals
        self._dark_pool_signal: float = 0.0
        self._block_trade_signal: float = 0.0
        self._flow_imbalance_signal: float = 0.0
        self._volume_signal: float = 0.0

        # Simulated institutional data (in production, these would come from data feeds)
        self._simulated_dark_pool_pct: float = 0.0
        self._simulated_block_ratio: float = 0.0

    def handle_bar(self, bar: Bar) -> None:
        """
        Update the indicator with new bar data.

        Args:
            bar: New bar data
        """
        # Extract bar data
        close = float(bar.close)
        open_ = float(bar.open)
        high = float(bar.high)
        low = float(bar.low)
        volume = float(bar.volume)

        # Update price and volume buffers
        self._closes.append(close)
        self._opens.append(open_)
        self._highs.append(high)
        self._lows.append(low)
        self._volumes.append(volume)

        # Calculate derived metrics
        self._update_dark_pool_estimate(bar)
        self._update_block_trade_estimate(bar)
        self._update_flow_imbalance(bar)
        self._update_volume_analysis(bar)

        # Update main indicator value
        self._update_value()

        self._set_initialized(True)

    def _update_dark_pool_estimate(self, bar: Bar) -> None:
        """
        Estimate dark pool activity from bar characteristics.

        In production, this would use actual dark pool data feeds.
        Here we estimate based on volume/price patterns that suggest
        off-exchange institutional activity.
        """
        if len(self._volumes) < 2:
            return

        close = float(bar.close)
        high = float(bar.high)
        low = float(bar.low)
        volume = float(bar.volume)

        # Estimate dark pool activity based on:
        # 1. Price stability despite high volume (suggests accumulation/distribution)
        # 2. Narrow intraday range despite volume
        price_range = (high - low) / close if close > 0 else 0
        avg_volume = np.mean(list(self._volumes)) if self._volumes else volume

        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0

        # High volume with narrow range suggests dark pool activity
        if price_range < 0.01 and volume_ratio > 1.5:
            dark_pool_estimate = min(1.0, 0.2 + (volume_ratio - 1.0) * 0.1)
        elif price_range < 0.02 and volume_ratio > 1.2:
            dark_pool_estimate = min(0.8, 0.15 + (volume_ratio - 1.0) * 0.08)
        else:
            dark_pool_estimate = max(0.05, 0.1 * volume_ratio / 2)

        self._dark_pool_percentages.append(dark_pool_estimate)
        self._simulated_dark_pool_pct = dark_pool_estimate

        # Calculate dark pool signal
        if len(self._dark_pool_percentages) >= 3:
            recent_avg = np.mean(list(self._dark_pool_percentages)[-5:])
            if recent_avg > self._dark_pool_threshold:
                # High dark pool suggests accumulation
                self._dark_pool_signal = min(
                    1.0, (recent_avg - self._dark_pool_threshold) / 0.15
                )
            else:
                self._dark_pool_signal = 0.0

    def _update_block_trade_estimate(self, bar: Bar) -> None:
        """
        Estimate block trade activity from volume patterns.

        In production, this would use actual block trade data.
        """
        if len(self._volumes) < 3:
            return

        volume = float(bar.volume)
        close = float(bar.close)
        open_ = float(bar.open)

        avg_volume = np.mean(list(self._volumes)[-self._period :])
        volume_std = (
            np.std(list(self._volumes)[-self._period :])
            if len(self._volumes) >= self._period
            else avg_volume * 0.3
        )

        # Block trades show as volume spikes
        if volume_std > 0:
            z_score = (volume - avg_volume) / volume_std
        else:
            z_score = 0

        # Estimate block trade ratio
        if z_score > 2:
            block_ratio = min(1.0, 0.1 + z_score * 0.05)
        elif z_score > 1:
            block_ratio = 0.05 + z_score * 0.03
        else:
            block_ratio = max(0.01, 0.02 + z_score * 0.01)

        self._block_trade_ratios.append(block_ratio)
        self._simulated_block_ratio = block_ratio

        # Calculate block trade signal based on direction
        price_direction = np.sign(close - open_)

        if len(self._block_trade_ratios) >= 3:
            recent_block_avg = np.mean(list(self._block_trade_ratios)[-5:])
            if recent_block_avg > self._block_trade_threshold:
                # Block trades aligned with price direction
                self._block_trade_signal = price_direction * min(
                    1.0, recent_block_avg / 0.15
                )
            else:
                self._block_trade_signal = 0.0

    def _update_flow_imbalance(self, bar: Bar) -> None:
        """
        Calculate order flow imbalance from bar data.

        Uses close location within the bar range as a proxy for
        buy/sell pressure.
        """
        close = float(bar.close)
        high = float(bar.high)
        low = float(bar.low)
        volume = float(bar.volume)

        # Close Location Value (CLV)
        # CLV = ((Close - Low) - (High - Close)) / (High - Low)
        # Ranges from -1 (close at low) to +1 (close at high)
        bar_range = high - low
        if bar_range > 0:
            clv = ((close - low) - (high - close)) / bar_range
        else:
            clv = 0.0

        # Money Flow Multiplier
        mf_multiplier = clv

        # Volume-weighted flow imbalance
        flow_imbalance = mf_multiplier * (
            volume / max(1.0, np.mean(list(self._volumes)) if self._volumes else volume)
        )

        self._flow_imbalances.append(flow_imbalance)

        # Calculate flow imbalance signal
        if len(self._flow_imbalances) >= self._period // 2:
            recent_flow = list(self._flow_imbalances)[-self._period // 2 :]
            cumulative_flow = sum(recent_flow)

            # Normalize to -1 to 1 range
            self._flow_imbalance_signal = max(
                -1.0, min(1.0, cumulative_flow / (len(recent_flow) * 0.5))
            )

    def _update_volume_analysis(self, bar: Bar) -> None:
        """
        Analyze volume patterns for institutional activity.
        """
        if len(self._volumes) < 3:
            return

        volume = float(bar.volume)
        close = float(bar.close)
        open_ = float(bar.open)

        avg_volume = np.mean(list(self._volumes))
        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0

        self._volume_ratios.append(volume_ratio)

        # Calculate volume signal
        if len(self._volume_ratios) >= 3:
            recent_ratios = list(self._volume_ratios)[-5:]
            avg_recent_ratio = np.mean(recent_ratios)

            # Price direction
            price_direction = np.sign(close - open_)

            # High volume in price direction suggests institutional activity
            if avg_recent_ratio > 1.2:
                self._volume_signal = price_direction * min(
                    1.0, (avg_recent_ratio - 1.0) * 0.8
                )
            else:
                self._volume_signal = price_direction * avg_recent_ratio * 0.3

    def _update_value(self) -> None:
        """
        Calculate the final indicator value from component signals.
        """
        # Combine component signals with weights
        self._value = (
            self._dark_pool_weight * self._dark_pool_signal
            + self._block_trade_weight * self._block_trade_signal
            + self._flow_imbalance_weight * self._flow_imbalance_signal
            + self._volume_weight * self._volume_signal
        )

        # Clamp to -1 to 1 range
        self._value = max(-1.0, min(1.0, self._value))

        # Calculate signal strength (absolute value)
        self._signal_strength = abs(self._value)

        # Calculate confidence based on signal agreement
        signals = [
            self._dark_pool_signal,
            self._block_trade_signal,
            self._flow_imbalance_signal,
            self._volume_signal,
        ]

        # Count signals in same direction
        positive_count = sum(1 for s in signals if s > 0.1)
        negative_count = sum(1 for s in signals if s < -0.1)

        agreement = max(positive_count, negative_count) / len(signals)
        self._confidence = agreement * self._signal_strength

    @property
    def value(self) -> float:
        """
        Get the current indicator value.

        Returns:
            Smart money signal (-1.0 to 1.0)
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
    def dark_pool_signal(self) -> float:
        """Get the dark pool component signal."""
        return self._dark_pool_signal

    @property
    def block_trade_signal(self) -> float:
        """Get the block trade component signal."""
        return self._block_trade_signal

    @property
    def flow_imbalance_signal(self) -> float:
        """Get the flow imbalance component signal."""
        return self._flow_imbalance_signal

    @property
    def volume_signal(self) -> float:
        """Get the volume component signal."""
        return self._volume_signal

    @property
    def dark_pool_percentage(self) -> float:
        """Get the estimated dark pool percentage."""
        return self._simulated_dark_pool_pct

    @property
    def block_trade_ratio(self) -> float:
        """Get the estimated block trade ratio."""
        return self._simulated_block_ratio

    @property
    def period(self) -> int:
        """Get the lookback period."""
        return self._period

    def reset(self) -> None:
        """Reset the indicator state."""
        self._prices.clear()
        self._volumes.clear()
        self._highs.clear()
        self._lows.clear()
        self._closes.clear()
        self._opens.clear()

        self._dark_pool_percentages.clear()
        self._block_trade_ratios.clear()
        self._flow_imbalances.clear()
        self._volume_ratios.clear()

        self._value = 0.0
        self._signal_strength = 0.0
        self._confidence = 0.0
        self._dark_pool_signal = 0.0
        self._block_trade_signal = 0.0
        self._flow_imbalance_signal = 0.0
        self._volume_signal = 0.0

        self._set_initialized(False)

    def is_bullish(self, threshold: float = 0.3) -> bool:
        """
        Check if the indicator is bullish.

        Args:
            threshold: Minimum value to consider bullish

        Returns:
            True if bullish
        """
        return self._value >= threshold

    def is_bearish(self, threshold: float = -0.3) -> bool:
        """
        Check if the indicator is bearish.

        Args:
            threshold: Maximum value to consider bearish

        Returns:
            True if bearish
        """
        return self._value <= threshold

    def is_neutral(self, threshold: float = 0.3) -> bool:
        """
        Check if the indicator is neutral.

        Args:
            threshold: Range around zero to consider neutral

        Returns:
            True if neutral
        """
        return abs(self._value) < threshold
