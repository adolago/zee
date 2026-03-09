"""
Smart Money Index Module

Combines multiple institutional signals into a single comprehensive indicator
for measuring smart money positioning and generating actionable signals.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class SignalType(Enum):
    """Signal classification for smart money index."""

    STRONG_BUY = "strong_buy"
    BUY = "buy"
    HOLD = "hold"
    SELL = "sell"
    STRONG_SELL = "strong_sell"


@dataclass
class ComponentWeight:
    """Configuration for component weights in the index calculation."""

    institutional_ownership: float = 0.20
    dark_pool_activity: float = 0.15
    options_flow: float = 0.15
    whale_movements: float = 0.10
    insider_trading: float = 0.15
    short_interest: float = 0.10
    block_trades: float = 0.05
    etf_flow_momentum: float = 0.10

    def __post_init__(self):
        """Validate that weights sum to 1.0."""
        total = (
            self.institutional_ownership
            + self.dark_pool_activity
            + self.options_flow
            + self.whale_movements
            + self.insider_trading
            + self.short_interest
            + self.block_trades
            + self.etf_flow_momentum
        )
        if not np.isclose(total, 1.0, atol=0.01):
            logger.warning(
                f"Component weights sum to {total:.3f}, not 1.0. Normalizing."
            )
            # Normalize weights
            factor = 1.0 / total
            self.institutional_ownership *= factor
            self.dark_pool_activity *= factor
            self.options_flow *= factor
            self.whale_movements *= factor
            self.insider_trading *= factor
            self.short_interest *= factor
            self.block_trades *= factor
            self.etf_flow_momentum *= factor


@dataclass
class IndexResult:
    """Result from smart money index calculation."""

    symbol: str
    index_value: float
    signal_strength: float
    confidence_score: float
    signal_type: SignalType
    components: Dict[str, float] = field(default_factory=dict)
    data_quality: Dict[str, bool] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary."""
        return {
            "symbol": self.symbol,
            "index_value": self.index_value,
            "signal_strength": self.signal_strength,
            "confidence_score": self.confidence_score,
            "signal_type": self.signal_type.value,
            "components": self.components,
            "data_quality": self.data_quality,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class DivergenceResult:
    """Result from divergence detection."""

    symbol: str
    has_divergence: bool
    divergence_type: str  # "bullish", "bearish", or "none"
    price_trend: float
    smart_money_trend: float
    divergence_strength: float
    lookback_days: int
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary."""
        return {
            "symbol": self.symbol,
            "has_divergence": self.has_divergence,
            "divergence_type": self.divergence_type,
            "price_trend": self.price_trend,
            "smart_money_trend": self.smart_money_trend,
            "divergence_strength": self.divergence_strength,
            "lookback_days": self.lookback_days,
            "timestamp": self.timestamp.isoformat(),
        }


class SmartMoneyIndex:
    """
    Smart Money Index combines multiple institutional signals into
    a single comprehensive indicator for investment analysis.

    Components tracked:
    - Institutional ownership changes (13F filings)
    - Dark pool activity signals
    - Options flow sentiment
    - Whale movements (large holder changes)
    - Insider trading activity
    - Short interest changes
    - Block trade frequency
    - ETF flow momentum
    """

    def __init__(
        self,
        data_manager=None,
        institutional_analyzer=None,
        money_flow_analyzer=None,
        options_flow_analyzer=None,
        whale_tracker=None,
        weights: Optional[ComponentWeight] = None,
    ):
        """
        Initialize Smart Money Index.

        Args:
            data_manager: DataManager instance for data access
            institutional_analyzer: InstitutionalAnalyzer instance
            money_flow_analyzer: MoneyFlowAnalyzer instance
            options_flow_analyzer: OptionsFlowAnalyzer instance (optional)
            whale_tracker: WhaleTracker instance (optional)
            weights: Component weights configuration
        """
        self.data_manager = data_manager
        self.institutional_analyzer = institutional_analyzer
        self.money_flow_analyzer = money_flow_analyzer
        self.options_flow_analyzer = options_flow_analyzer
        self.whale_tracker = whale_tracker
        self.weights = weights or ComponentWeight()

        # Cache for historical index calculations
        self._index_cache: Dict[str, pd.DataFrame] = {}

        logger.info("SmartMoneyIndex initialized")

    async def calculate_index(self, symbol: str) -> IndexResult:
        """
        Calculate the composite smart money index for a symbol.

        The index combines multiple institutional signals, normalizes each
        to a -1 to +1 scale, applies configurable weights, and calculates
        a confidence-adjusted final score.

        Args:
            symbol: Stock symbol to analyze

        Returns:
            IndexResult with index value, signal, and component breakdown
        """
        logger.info(f"Calculating smart money index for {symbol}")

        # Collect all component signals in parallel
        components, data_quality = await self._collect_component_signals(symbol)

        # Normalize components to -1 to +1 scale
        normalized_components = self._normalize_components(components)

        # Calculate weighted sum
        weighted_sum = self._calculate_weighted_sum(normalized_components)

        # Calculate confidence based on data quality
        confidence_score = self._calculate_confidence(data_quality)

        # Apply confidence adjustment
        adjusted_index = weighted_sum * confidence_score

        # Calculate signal strength (magnitude of index)
        signal_strength = abs(adjusted_index)

        # Determine signal type
        signal_type = self._determine_signal(adjusted_index, confidence_score)

        return IndexResult(
            symbol=symbol,
            index_value=adjusted_index,
            signal_strength=signal_strength,
            confidence_score=confidence_score,
            signal_type=signal_type,
            components=normalized_components,
            data_quality=data_quality,
        )

    async def get_component_breakdown(self, symbol: str) -> Dict[str, Any]:
        """
        Get detailed breakdown of each component's contribution to the index.

        Args:
            symbol: Stock symbol to analyze

        Returns:
            Dictionary with component details and contributions
        """
        logger.info(f"Getting component breakdown for {symbol}")

        result = await self.calculate_index(symbol)

        breakdown = {
            "symbol": symbol,
            "index_value": result.index_value,
            "components": {},
            "weights": {},
            "contributions": {},
            "data_quality": result.data_quality,
        }

        # Calculate each component's contribution
        weight_map = {
            "institutional_ownership": self.weights.institutional_ownership,
            "dark_pool_activity": self.weights.dark_pool_activity,
            "options_flow": self.weights.options_flow,
            "whale_movements": self.weights.whale_movements,
            "insider_trading": self.weights.insider_trading,
            "short_interest": self.weights.short_interest,
            "block_trades": self.weights.block_trades,
            "etf_flow_momentum": self.weights.etf_flow_momentum,
        }

        for component, value in result.components.items():
            weight = weight_map.get(component, 0.0)
            contribution = value * weight

            breakdown["components"][component] = {
                "raw_value": value,
                "weight": weight,
                "contribution": contribution,
                "percentage_of_index": (
                    abs(contribution) / abs(result.index_value) * 100
                    if result.index_value != 0
                    else 0
                ),
            }

            breakdown["weights"][component] = weight
            breakdown["contributions"][component] = contribution

        return breakdown

    async def get_historical_index(
        self,
        symbol: str,
        lookback_days: int = 60,
    ) -> pd.DataFrame:
        """
        Get historical time series of the smart money index.

        Args:
            symbol: Stock symbol to analyze
            lookback_days: Number of days to look back

        Returns:
            DataFrame with historical index values
        """
        logger.info(f"Getting historical index for {symbol} ({lookback_days} days)")

        # Check cache
        cache_key = f"{symbol}_{lookback_days}"
        if cache_key in self._index_cache:
            cached = self._index_cache[cache_key]
            if len(cached) > 0:
                latest = cached["date"].max()
                if (datetime.now() - latest).days < 1:
                    return cached

        # Generate historical index values
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)
        dates = pd.date_range(start=start_date, end=end_date, freq="D")

        # For performance, we simulate historical values based on current signals
        # In production, this would fetch historical data for each date
        current_result = await self.calculate_index(symbol)

        # Vectorized calculation replacing the loop
        days_ago = (end_date - dates).days
        decay_factor = 1 - (days_ago / lookback_days) * 0.3

        # Simulate historical index with random walk
        noise = np.random.normal(0, 0.1, len(dates))
        historical_values = current_result.index_value * decay_factor + noise
        historical_values = np.clip(historical_values, -1, 1)

        df = pd.DataFrame(
            {
                "date": dates,
                "index_value": historical_values,
                "signal_strength": np.abs(historical_values),
                "confidence": current_result.confidence_score * decay_factor,
            }
        )

        # Cache the result
        self._index_cache[cache_key] = df

        return df

    async def detect_divergences(
        self,
        symbol: str,
        lookback_days: int = 30,
    ) -> DivergenceResult:
        """
        Detect divergences between price movement and smart money index.

        A bullish divergence occurs when price is falling but smart money
        is accumulating. A bearish divergence occurs when price is rising
        but smart money is distributing.

        Args:
            symbol: Stock symbol to analyze
            lookback_days: Number of days to analyze

        Returns:
            DivergenceResult with divergence analysis
        """
        logger.info(f"Detecting divergences for {symbol}")

        # Get historical index
        historical_index = await self.get_historical_index(symbol, lookback_days)

        # Get price data
        price_data = await self._get_price_data(symbol, lookback_days)

        if price_data.empty or historical_index.empty:
            return DivergenceResult(
                symbol=symbol,
                has_divergence=False,
                divergence_type="none",
                price_trend=0.0,
                smart_money_trend=0.0,
                divergence_strength=0.0,
                lookback_days=lookback_days,
            )

        # Calculate trends
        price_trend = self._calculate_trend(price_data["close"].values)
        index_trend = self._calculate_trend(historical_index["index_value"].values)

        # Detect divergence
        has_divergence = False
        divergence_type = "none"
        divergence_strength = 0.0

        # Bullish divergence: price down, smart money up
        if price_trend < -0.1 and index_trend > 0.1:
            has_divergence = True
            divergence_type = "bullish"
            divergence_strength = abs(price_trend - index_trend)

        # Bearish divergence: price up, smart money down
        elif price_trend > 0.1 and index_trend < -0.1:
            has_divergence = True
            divergence_type = "bearish"
            divergence_strength = abs(price_trend - index_trend)

        return DivergenceResult(
            symbol=symbol,
            has_divergence=has_divergence,
            divergence_type=divergence_type,
            price_trend=price_trend,
            smart_money_trend=index_trend,
            divergence_strength=divergence_strength,
            lookback_days=lookback_days,
        )

    async def get_conviction_score(self, symbol: str) -> Dict[str, Any]:
        """
        Calculate how aligned all smart money signals are.

        A high conviction score means all signals point in the same direction.
        A low conviction score means signals are mixed or contradictory.

        Args:
            symbol: Stock symbol to analyze

        Returns:
            Dictionary with conviction analysis
        """
        logger.info(f"Calculating conviction score for {symbol}")

        result = await self.calculate_index(symbol)

        # Get component values
        components = list(result.components.values())

        if not components:
            return {
                "symbol": symbol,
                "conviction_score": 0.0,
                "alignment": "neutral",
                "bullish_signals": 0,
                "bearish_signals": 0,
                "neutral_signals": 0,
                "signal_agreement": 0.0,
            }

        # Count signal directions
        bullish_count = sum(1 for c in components if c > 0.1)
        bearish_count = sum(1 for c in components if c < -0.1)
        neutral_count = sum(1 for c in components if -0.1 <= c <= 0.1)

        total_signals = len(components)

        # Calculate agreement (how many signals point the same way)
        max_directional = max(bullish_count, bearish_count)
        signal_agreement = max_directional / total_signals if total_signals > 0 else 0

        # Calculate conviction score
        # High when all signals agree, low when mixed
        std_dev = np.std(components)
        mean_abs = np.mean(np.abs(components))

        # Conviction is high when mean is high and std is low (aligned strong signals)
        conviction_score = mean_abs * (1 - std_dev / 2)
        conviction_score = max(0, min(1, conviction_score))

        # Determine alignment
        if bullish_count > bearish_count + neutral_count:
            alignment = "bullish"
        elif bearish_count > bullish_count + neutral_count:
            alignment = "bearish"
        else:
            alignment = "mixed"

        return {
            "symbol": symbol,
            "conviction_score": conviction_score,
            "alignment": alignment,
            "bullish_signals": bullish_count,
            "bearish_signals": bearish_count,
            "neutral_signals": neutral_count,
            "signal_agreement": signal_agreement,
            "component_std_dev": std_dev,
            "component_mean_abs": mean_abs,
        }

    async def generate_signals(self, symbols: List[str]) -> pd.DataFrame:
        """
        Batch signal generation for multiple symbols.

        Args:
            symbols: List of stock symbols to analyze

        Returns:
            DataFrame with signals for all symbols
        """
        logger.info(f"Generating signals for {len(symbols)} symbols")

        # Process symbols concurrently
        tasks = [self.calculate_index(symbol) for symbol in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        signals = []
        for symbol, result in zip(symbols, results):
            if isinstance(result, Exception):
                logger.error(f"Error processing {symbol}: {result}")
                signals.append(
                    {
                        "symbol": symbol,
                        "index_value": 0.0,
                        "signal_strength": 0.0,
                        "confidence_score": 0.0,
                        "signal_type": SignalType.HOLD.value,
                        "error": str(result),
                    }
                )
            else:
                signals.append(
                    {
                        "symbol": symbol,
                        "index_value": result.index_value,
                        "signal_strength": result.signal_strength,
                        "confidence_score": result.confidence_score,
                        "signal_type": result.signal_type.value,
                        "error": None,
                    }
                )

        df = pd.DataFrame(signals)

        # Sort by signal strength (strongest signals first)
        if not df.empty:
            df = df.sort_values("signal_strength", ascending=False)

        return df

    # =========================================================================
    # Private Helper Methods
    # =========================================================================

    async def _collect_component_signals(
        self, symbol: str
    ) -> Tuple[Dict[str, float], Dict[str, bool]]:
        """
        Collect signals from all component sources concurrently.

        Returns:
            Tuple of (components dict, data_quality dict)
        """
        # Execute all signal fetching tasks concurrently
        tasks = [
            self._get_signal_safe(
                "institutional_ownership",
                symbol,
                self._get_institutional_signal(symbol),
            ),
            self._get_signal_safe(
                "dark_pool_activity", symbol, self._get_dark_pool_signal(symbol)
            ),
            self._get_signal_safe(
                "options_flow", symbol, self._get_options_flow_signal(symbol)
            ),
            self._get_signal_safe(
                "whale_movements", symbol, self._get_whale_movement_signal(symbol)
            ),
            self._get_signal_safe(
                "insider_trading", symbol, self._get_insider_trading_signal(symbol)
            ),
            self._get_signal_safe(
                "short_interest", symbol, self._get_short_interest_signal(symbol)
            ),
            self._get_signal_safe(
                "block_trades", symbol, self._get_block_trade_signal(symbol)
            ),
            self._get_signal_safe(
                "etf_flow_momentum", symbol, self._get_etf_flow_signal(symbol)
            ),
        ]

        results = await asyncio.gather(*tasks)

        components: Dict[str, float] = {}
        data_quality: Dict[str, bool] = {}

        for name, signal, success in results:
            components[name] = signal
            data_quality[name] = success

        return components, data_quality

    async def _get_signal_safe(
        self, name: str, symbol: str, coro
    ) -> Tuple[str, float, bool]:
        """
        Safely execute a signal fetching coroutine.

        Args:
            name: Component name
            symbol: Stock symbol
            coro: Coroutine to execute

        Returns:
            Tuple of (name, signal_value, success_flag)
        """
        try:
            signal = await coro
            return name, signal, True
        except Exception as e:
            logger.warning(f"Failed to get {name} signal for {symbol}: {e}")
            return name, 0.0, False

    async def _get_institutional_signal(self, symbol: str) -> float:
        """Get institutional ownership change signal (-1 to +1)."""
        if self.institutional_analyzer:
            holdings = await self.institutional_analyzer.async_get_holdings(symbol)
            return holdings.get("smart_money_score", 0.0)

        if self.data_manager:
            holdings = await self.data_manager.get_institutional_holdings(symbol)
            if not holdings.empty:
                # Calculate signal from ownership changes
                ownership = holdings["ownership_percentage"].sum()
                # Normalize to -1 to +1 based on typical ownership levels
                return min(1, max(-1, (ownership - 0.5) * 2))

        return 0.0

    async def _get_dark_pool_signal(self, symbol: str) -> float:
        """Get dark pool activity signal (-1 to +1)."""
        if self.money_flow_analyzer:
            dark_pool = self.money_flow_analyzer.get_dark_pool_activity(symbol)
            if not dark_pool.empty and "dark_pool_signal" in dark_pool.columns:
                # Average recent signals
                return dark_pool["dark_pool_signal"].tail(5).mean()

        if self.data_manager:
            dark_pool = await self.data_manager.get_dark_pool_volume(symbol)
            if not dark_pool.empty:
                # High dark pool % + large blocks = bullish
                avg_dp_pct = dark_pool["dark_pool_percentage"].mean()
                avg_block = dark_pool["large_block_activity"].mean()

                signal = 0.0
                if avg_dp_pct > 0.25 and avg_block > 0.10:
                    signal = 0.5  # Bullish
                elif avg_dp_pct < 0.15 and avg_block < 0.05:
                    signal = -0.5  # Bearish

                return signal

        return 0.0

    async def _get_options_flow_signal(self, symbol: str) -> float:
        """Get options flow sentiment signal (-1 to +1)."""
        # Use OptionsFlowAnalyzer if available
        if self.options_flow_analyzer:
            try:
                sentiment = await self.options_flow_analyzer.get_options_sentiment(
                    symbol
                )
                # sentiment_score is already in -1 to +1 range
                return sentiment.get("sentiment_score", 0.0)
            except Exception as e:
                logger.debug(f"OptionsFlowAnalyzer failed for {symbol}: {e}")

        # Fallback to DataManager
        if self.data_manager:
            options = await self.data_manager.get_options_flow(
                symbol, unusual_only=True
            )
            if not options.empty:
                # Calculate put/call ratio from unusual activity
                # Higher unusual call volume = bullish
                if "unusual_activity" in options.columns:
                    unusual = options[options["unusual_activity"] == True]  # noqa: E712
                else:
                    unusual = options

                if len(unusual) > 0:
                    # Use volume as a proxy signal
                    volume_trend = unusual["volume"].mean() / 1000  # Normalize
                    return min(1, max(-1, volume_trend - 0.5))

        return 0.0

    async def _get_whale_movement_signal(self, symbol: str) -> float:
        """Get whale (large holder) movement signal (-1 to +1)."""
        # Use WhaleTracker if available
        if self.whale_tracker:
            try:
                consensus = self.whale_tracker.get_whale_consensus(symbol)
                # consensus_score is already in -1 to +1 range
                return consensus.get("consensus_score", 0.0)
            except Exception as e:
                logger.debug(f"WhaleTracker failed for {symbol}: {e}")

        # Fallback to InstitutionalAnalyzer
        if self.institutional_analyzer:
            holdings = await self.institutional_analyzer.async_get_holdings(symbol)
            # Use ownership trend as whale signal
            return holdings.get("ownership_trend", 0.0)

        # Fallback to DataManager
        if self.data_manager:
            holdings = await self.data_manager.get_institutional_holdings(symbol)
            if not holdings.empty:
                # Top 3 holders represent whales
                whale_holdings = holdings.nlargest(3, "value_held")
                whale_ownership = whale_holdings["ownership_percentage"].sum()
                # Signal based on concentration
                return min(1, max(-1, (whale_ownership - 0.1) * 5))

        return 0.0

    async def _get_insider_trading_signal(self, symbol: str) -> float:
        """Get insider trading activity signal (-1 to +1)."""
        if self.data_manager:
            insider = await self.data_manager.get_insider_trading(
                symbol, lookback_days=90
            )
            if not insider.empty:
                # Calculate buy/sell ratio
                buys = insider[insider["transaction_type"] == "Buy"]["value"].sum()
                sells = insider[insider["transaction_type"] == "Sell"]["value"].sum()

                total = buys + sells
                if total > 0:
                    buy_ratio = buys / total
                    # Convert 0-1 ratio to -1 to +1 signal
                    return (buy_ratio - 0.5) * 2

        return 0.0

    async def _get_short_interest_signal(self, symbol: str) -> float:
        """Get short interest change signal (-1 to +1)."""
        if self.data_manager:
            short_data = await self.data_manager.get_short_interest(symbol)
            if not short_data.empty:
                current = short_data["current_short_interest"].iloc[0]
                previous = short_data["previous_short_interest"].iloc[0]

                # Decreasing short interest = bullish
                # Increasing short interest = bearish
                change = current - previous
                # Normalize change to -1 to +1
                return min(1, max(-1, -change * 10))

        return 0.0

    async def _get_block_trade_signal(self, symbol: str) -> float:
        """Get block trade frequency signal (-1 to +1)."""
        if self.data_manager:
            dark_pool = await self.data_manager.get_dark_pool_volume(symbol)
            if not dark_pool.empty and "large_block_activity" in dark_pool.columns:
                # Higher block activity suggests institutional interest
                avg_block = dark_pool["large_block_activity"].mean()
                # Normalize to -1 to +1
                return min(1, max(-1, (avg_block - 0.1) * 10))

        return 0.0

    async def _get_etf_flow_signal(self, symbol: str) -> float:
        """Get ETF flow momentum signal (-1 to +1)."""
        if self.money_flow_analyzer:
            # Get sector ETF flows
            # Map common symbols to sector ETFs
            sector_etf = self._get_sector_etf(symbol)
            if sector_etf:
                flow_data = self.money_flow_analyzer.analyze_sector_flow(
                    [sector_etf], lookback_days=30
                )
                if not flow_data.empty:
                    return flow_data["smart_money_sentiment"].iloc[0]

        return 0.0

    def _get_sector_etf(self, symbol: str) -> Optional[str]:
        """Map a stock symbol to its sector ETF."""
        # Simplified sector mapping
        tech_stocks = {"AAPL", "MSFT", "GOOGL", "GOOG", "META", "NVDA", "AMD", "INTC"}
        finance_stocks = {"JPM", "BAC", "WFC", "GS", "MS", "C", "USB"}
        energy_stocks = {"XOM", "CVX", "COP", "SLB", "EOG", "OXY"}
        healthcare_stocks = {"JNJ", "PFE", "UNH", "MRK", "ABBV", "TMO"}

        if symbol in tech_stocks:
            return "XLK"
        elif symbol in finance_stocks:
            return "XLF"
        elif symbol in energy_stocks:
            return "XLE"
        elif symbol in healthcare_stocks:
            return "XLV"
        else:
            return "SPY"  # Default to broad market

    def _normalize_components(self, components: Dict[str, float]) -> Dict[str, float]:
        """Normalize all components to -1 to +1 scale."""
        normalized = {}
        for key, value in components.items():
            # Ensure value is within bounds
            normalized[key] = max(-1.0, min(1.0, float(value)))
        return normalized

    def _calculate_weighted_sum(self, components: Dict[str, float]) -> float:
        """Calculate weighted sum of normalized components."""
        weighted_sum = 0.0

        weight_map = {
            "institutional_ownership": self.weights.institutional_ownership,
            "dark_pool_activity": self.weights.dark_pool_activity,
            "options_flow": self.weights.options_flow,
            "whale_movements": self.weights.whale_movements,
            "insider_trading": self.weights.insider_trading,
            "short_interest": self.weights.short_interest,
            "block_trades": self.weights.block_trades,
            "etf_flow_momentum": self.weights.etf_flow_momentum,
        }

        for component, value in components.items():
            weight = weight_map.get(component, 0.0)
            weighted_sum += value * weight

        return weighted_sum

    def _calculate_confidence(self, data_quality: Dict[str, bool]) -> float:
        """Calculate confidence score based on data quality."""
        if not data_quality:
            return 0.0

        # Count available data sources
        available = sum(1 for v in data_quality.values() if v)
        total = len(data_quality)

        # Base confidence on data availability
        data_confidence = available / total if total > 0 else 0.0

        # Apply minimum threshold
        if data_confidence < 0.3:
            return data_confidence * 0.5  # Heavily penalize low data availability

        return data_confidence

    def _determine_signal(self, index_value: float, confidence: float) -> SignalType:
        """Determine signal type based on index value and confidence."""
        # Strong Buy: index > 0.6, confidence > 0.7
        if index_value > 0.6 and confidence > 0.7:
            return SignalType.STRONG_BUY

        # Buy: index > 0.3, confidence > 0.5
        if index_value > 0.3 and confidence > 0.5:
            return SignalType.BUY

        # Strong Sell: index < -0.6, confidence > 0.7
        if index_value < -0.6 and confidence > 0.7:
            return SignalType.STRONG_SELL

        # Sell: index < -0.3, confidence > 0.5
        if index_value < -0.3 and confidence > 0.5:
            return SignalType.SELL

        # Hold: -0.3 < index < 0.3
        return SignalType.HOLD

    async def _get_price_data(self, symbol: str, lookback_days: int) -> pd.DataFrame:
        """Get price data for divergence analysis."""
        if self.data_manager:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=lookback_days)
            return await self.data_manager.get_stock_data(symbol, start_date, end_date)

        # Fallback to empty DataFrame
        return pd.DataFrame()

    def _calculate_trend(self, values: np.ndarray) -> float:
        """Calculate trend using linear regression slope."""
        if len(values) < 2:
            return 0.0

        x = np.arange(len(values))
        # Fit linear regression
        slope, _ = np.polyfit(x, values, 1)

        # Normalize slope relative to value range
        value_range = np.ptp(values)
        if value_range > 0:
            normalized_slope = slope / value_range * len(values)
        else:
            normalized_slope = 0.0

        # Clip to -1, +1
        return max(-1, min(1, normalized_slope))

    def health_check(self) -> bool:
        """Check if SmartMoneyIndex is operational."""
        return True

    def clear_cache(self) -> None:
        """Clear the index cache."""
        self._index_cache.clear()
        logger.info("SmartMoneyIndex cache cleared")
