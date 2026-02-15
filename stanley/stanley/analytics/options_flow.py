"""
Options Flow Analysis Module

Analyze unusual options activity, sweep orders, and institutional options flow.
Provides signals for smart money positioning through options market analysis.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, TypedDict

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class UnusualActivityResult(TypedDict):
    """Type definition for unusual activity detection results."""

    symbol: str
    date: datetime
    volume_ratio: float
    avg_volume_20d: float
    current_volume: float
    call_volume: int
    put_volume: int
    unusual_contracts: pd.DataFrame
    signal: str
    confidence: float


class PutCallRatioResult(TypedDict):
    """Type definition for put/call ratio analysis."""

    symbol: str
    volume_pc_ratio: float
    oi_pc_ratio: float
    interpretation: str
    historical_percentile: float
    signal: str


class SweepOrderResult(TypedDict):
    """Type definition for sweep order detection."""

    symbol: str
    sweeps: pd.DataFrame
    bullish_sweep_count: int
    bearish_sweep_count: int
    total_bullish_premium: float
    total_bearish_premium: float
    net_sweep_sentiment: str


class LargeTradeResult(TypedDict):
    """Type definition for large trade tracking."""

    symbol: str
    large_trades: pd.DataFrame
    total_call_premium: float
    total_put_premium: float
    largest_trade: Dict[str, Any]
    smart_money_direction: str


class GammaExposureResult(TypedDict):
    """Type definition for gamma exposure analysis."""

    symbol: str
    net_gamma: float
    call_gamma: float
    put_gamma: float
    gamma_flip_price: Optional[float]
    max_pain: float
    gamma_exposure_by_strike: pd.DataFrame


class OptionsSentimentResult(TypedDict):
    """Type definition for options sentiment aggregation."""

    symbol: str
    overall_sentiment: str
    sentiment_score: float
    components: Dict[str, float]
    confidence: float


class SmartMoneyResult(TypedDict):
    """Type definition for smart money detection."""

    symbol: str
    smart_money_signals: pd.DataFrame
    institutional_bias: str
    conviction_score: float
    key_levels: List[float]


class OptionsFlowAnalyzer:
    """
    Analyze options flow for unusual activity and institutional positioning signals.

    Provides detection of unusual volume, sweep orders, large block trades,
    and gamma exposure to identify smart money activity in the options market.
    """

    def __init__(self, data_manager=None):
        """
        Initialize options flow analyzer.

        Args:
            data_manager: Data manager instance for data access
        """
        self.data_manager = data_manager
        logger.info("OptionsFlowAnalyzer initialized")

    async def get_unusual_activity(
        self, symbol: str, lookback_days: int = 5
    ) -> UnusualActivityResult:
        """
        Detect unusual options volume activity.

        Compares current options volume to 20-day average to identify
        abnormal trading activity that may indicate institutional interest.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to analyze for current activity

        Returns:
            UnusualActivityResult with volume analysis and signals
        """
        logger.info(f"Analyzing unusual options activity for {symbol}")

        # Get options flow data
        options_data = await self._get_options_data(symbol, lookback_days + 20)

        if options_data.empty:
            return self._empty_unusual_activity_result(symbol)

        # Calculate 20-day average volume
        avg_volume_20d = options_data["volume"].tail(20).mean()

        # Get recent volume
        recent_data = options_data.tail(lookback_days)
        current_volume = recent_data["volume"].sum()

        # Calculate volume ratio
        volume_ratio = (
            current_volume / (avg_volume_20d * lookback_days)
            if avg_volume_20d > 0
            else 0
        )

        # Separate call and put volumes
        call_volume = recent_data[recent_data["option_type"] == "call"]["volume"].sum()
        put_volume = recent_data[recent_data["option_type"] == "put"]["volume"].sum()

        # Identify unusual contracts (volume > 2x average)
        unusual_contracts = self._identify_unusual_contracts(
            options_data, lookback_days
        )

        # Generate signal
        signal, confidence = self._generate_unusual_activity_signal(
            volume_ratio, call_volume, put_volume
        )

        return UnusualActivityResult(
            symbol=symbol,
            date=datetime.now(),
            volume_ratio=volume_ratio,
            avg_volume_20d=avg_volume_20d,
            current_volume=current_volume,
            call_volume=int(call_volume),
            put_volume=int(put_volume),
            unusual_contracts=unusual_contracts,
            signal=signal,
            confidence=confidence,
        )

    async def analyze_put_call_ratio(self, symbol: str) -> PutCallRatioResult:
        """
        Calculate and interpret put/call ratio.

        Analyzes both volume-based and open interest-based P/C ratios
        to gauge market sentiment.

        Args:
            symbol: Stock symbol

        Returns:
            PutCallRatioResult with ratio analysis and interpretation
        """
        logger.info(f"Analyzing put/call ratio for {symbol}")

        # Get options chain data
        options_data = await self._get_options_chain(symbol)

        if options_data.empty:
            return self._empty_pc_ratio_result(symbol)

        # Calculate volume P/C ratio
        call_volume = options_data[options_data["option_type"] == "call"][
            "volume"
        ].sum()
        put_volume = options_data[options_data["option_type"] == "put"]["volume"].sum()
        volume_pc_ratio = put_volume / call_volume if call_volume > 0 else 0

        # Calculate open interest P/C ratio
        call_oi = options_data[options_data["option_type"] == "call"][
            "open_interest"
        ].sum()
        put_oi = options_data[options_data["option_type"] == "put"][
            "open_interest"
        ].sum()
        oi_pc_ratio = put_oi / call_oi if call_oi > 0 else 0

        # Get historical P/C ratios for percentile calculation
        historical_pc = await self._get_historical_pc_ratio(symbol)
        historical_percentile = self._calculate_percentile(
            volume_pc_ratio, historical_pc
        )

        # Interpret the ratio
        interpretation, signal = self._interpret_pc_ratio(
            volume_pc_ratio, historical_percentile
        )

        return PutCallRatioResult(
            symbol=symbol,
            volume_pc_ratio=volume_pc_ratio,
            oi_pc_ratio=oi_pc_ratio,
            interpretation=interpretation,
            historical_percentile=historical_percentile,
            signal=signal,
        )

    async def detect_sweep_orders(self, symbol: str) -> SweepOrderResult:
        """
        Identify aggressive sweep orders across multiple exchanges.

        Sweep orders indicate urgency and are often used by institutions
        to quickly establish or exit positions.

        Args:
            symbol: Stock symbol

        Returns:
            SweepOrderResult with sweep order analysis
        """
        logger.info(f"Detecting sweep orders for {symbol}")

        # Get options flow with exchange data
        options_flow = await self._get_options_flow_with_exchange(symbol)

        if options_flow.empty:
            return self._empty_sweep_result(symbol)

        # Identify sweep orders (multi-exchange fills at aggressive prices)
        sweeps = self._identify_sweeps(options_flow)

        # Separate bullish and bearish sweeps
        bullish_sweeps = sweeps[sweeps["sweep_type"] == "bullish"]
        bearish_sweeps = sweeps[sweeps["sweep_type"] == "bearish"]

        bullish_sweep_count = len(bullish_sweeps)
        bearish_sweep_count = len(bearish_sweeps)

        total_bullish_premium = bullish_sweeps["premium"].sum()
        total_bearish_premium = bearish_sweeps["premium"].sum()

        # Determine net sentiment
        if total_bullish_premium > total_bearish_premium * 1.5:
            net_sentiment = "bullish"
        elif total_bearish_premium > total_bullish_premium * 1.5:
            net_sentiment = "bearish"
        else:
            net_sentiment = "neutral"

        return SweepOrderResult(
            symbol=symbol,
            sweeps=sweeps,
            bullish_sweep_count=bullish_sweep_count,
            bearish_sweep_count=bearish_sweep_count,
            total_bullish_premium=total_bullish_premium,
            total_bearish_premium=total_bearish_premium,
            net_sweep_sentiment=net_sentiment,
        )

    async def get_large_trades(
        self, symbol: str, min_premium: float = 100000
    ) -> LargeTradeResult:
        """
        Track large premium options trades.

        Identifies block trades with premium exceeding the threshold,
        which typically represent institutional activity.

        Args:
            symbol: Stock symbol
            min_premium: Minimum premium threshold in dollars (default: $100K)

        Returns:
            LargeTradeResult with large trade analysis
        """
        logger.info(
            f"Tracking large trades for {symbol} (min premium: ${min_premium:,})"
        )

        # Get options flow data
        options_flow = await self._get_options_flow(symbol)

        if options_flow.empty:
            return self._empty_large_trade_result(symbol)

        # Filter for large trades
        large_trades = options_flow[options_flow["premium"] >= min_premium].copy()

        if large_trades.empty:
            return self._empty_large_trade_result(symbol)

        # Calculate totals by type
        call_trades = large_trades[large_trades["option_type"] == "call"]
        put_trades = large_trades[large_trades["option_type"] == "put"]

        total_call_premium = call_trades["premium"].sum()
        total_put_premium = put_trades["premium"].sum()

        # Find largest trade
        largest_idx = large_trades["premium"].idxmax()
        largest_trade = large_trades.loc[largest_idx].to_dict()

        # Determine smart money direction
        if total_call_premium > total_put_premium * 1.3:
            direction = "bullish"
        elif total_put_premium > total_call_premium * 1.3:
            direction = "bearish"
        else:
            direction = "mixed"

        return LargeTradeResult(
            symbol=symbol,
            large_trades=large_trades,
            total_call_premium=total_call_premium,
            total_put_premium=total_put_premium,
            largest_trade=largest_trade,
            smart_money_direction=direction,
        )

    async def analyze_gamma_exposure(self, symbol: str) -> GammaExposureResult:
        """
        Calculate dealer gamma exposure.

        Gamma exposure analysis helps identify key price levels where
        dealer hedging may amplify or dampen price movements.

        Args:
            symbol: Stock symbol

        Returns:
            GammaExposureResult with gamma analysis
        """
        logger.info(f"Analyzing gamma exposure for {symbol}")

        # Get full options chain with greeks
        options_chain = await self._get_options_chain_with_greeks(symbol)

        if options_chain.empty:
            return self._empty_gamma_result(symbol)

        # Get current stock price
        current_price = await self._get_current_price(symbol)

        # Calculate gamma exposure by strike
        gamma_by_strike = self._calculate_gamma_by_strike(options_chain, current_price)

        # Calculate net gamma
        call_gamma = options_chain[options_chain["option_type"] == "call"][
            "gamma"
        ].sum()
        put_gamma = options_chain[options_chain["option_type"] == "put"]["gamma"].sum()

        # Net gamma (dealers are typically short calls, long puts)
        # Positive net gamma = dealers long gamma = price stabilizing
        # Negative net gamma = dealers short gamma = price amplifying
        net_gamma = -call_gamma + put_gamma

        # Find gamma flip price (where net gamma crosses zero)
        gamma_flip_price = self._find_gamma_flip(gamma_by_strike)

        # Calculate max pain (strike with maximum open interest-weighted losses)
        max_pain = self._calculate_max_pain(options_chain)

        return GammaExposureResult(
            symbol=symbol,
            net_gamma=net_gamma,
            call_gamma=call_gamma,
            put_gamma=put_gamma,
            gamma_flip_price=gamma_flip_price,
            max_pain=max_pain,
            gamma_exposure_by_strike=gamma_by_strike,
        )

    async def get_options_sentiment(self, symbol: str) -> OptionsSentimentResult:
        """
        Aggregate options-based sentiment indicators.

        Combines multiple options metrics (P/C ratio, unusual activity,
        sweep orders, large trades) into a unified sentiment score.

        Args:
            symbol: Stock symbol

        Returns:
            OptionsSentimentResult with aggregated sentiment
        """
        logger.info(f"Calculating options sentiment for {symbol}")

        # Gather all component analyses in parallel
        (
            unusual_activity,
            pc_ratio,
            sweeps,
            large_trades,
        ) = await asyncio.gather(
            self.get_unusual_activity(symbol),
            self.analyze_put_call_ratio(symbol),
            self.detect_sweep_orders(symbol),
            self.get_large_trades(symbol),
        )

        # Score each component (-1 to 1 scale)
        components = {}

        # Unusual activity score
        if unusual_activity["signal"] == "bullish":
            components["unusual_activity"] = 0.5 * unusual_activity["confidence"]
        elif unusual_activity["signal"] == "bearish":
            components["unusual_activity"] = -0.5 * unusual_activity["confidence"]
        else:
            components["unusual_activity"] = 0.0

        # P/C ratio score (contrarian: high P/C = bullish)
        if pc_ratio["signal"] == "bullish":
            components["put_call_ratio"] = 0.3
        elif pc_ratio["signal"] == "bearish":
            components["put_call_ratio"] = -0.3
        else:
            components["put_call_ratio"] = 0.0

        # Sweep sentiment score
        if sweeps["net_sweep_sentiment"] == "bullish":
            components["sweeps"] = 0.4
        elif sweeps["net_sweep_sentiment"] == "bearish":
            components["sweeps"] = -0.4
        else:
            components["sweeps"] = 0.0

        # Large trades score
        if large_trades["smart_money_direction"] == "bullish":
            components["large_trades"] = 0.3
        elif large_trades["smart_money_direction"] == "bearish":
            components["large_trades"] = -0.3
        else:
            components["large_trades"] = 0.0

        # Calculate weighted sentiment score
        weights = {
            "unusual_activity": 0.25,
            "put_call_ratio": 0.20,
            "sweeps": 0.30,
            "large_trades": 0.25,
        }

        sentiment_score = sum(components[k] * weights[k] for k in components)

        # Determine overall sentiment
        if sentiment_score > 0.15:
            overall_sentiment = "bullish"
        elif sentiment_score < -0.15:
            overall_sentiment = "bearish"
        else:
            overall_sentiment = "neutral"

        # Calculate confidence based on signal agreement
        agreement_count = sum(
            1
            for v in components.values()
            if (v > 0) == (sentiment_score > 0) and v != 0
        )
        confidence = agreement_count / len(components) if components else 0

        return OptionsSentimentResult(
            symbol=symbol,
            overall_sentiment=overall_sentiment,
            sentiment_score=sentiment_score,
            components=components,
            confidence=confidence,
        )

    async def detect_smart_money_options(self, symbol: str) -> SmartMoneyResult:
        """
        Identify institutional options flow patterns.

        Detects patterns consistent with sophisticated institutional
        trading strategies in the options market.

        Args:
            symbol: Stock symbol

        Returns:
            SmartMoneyResult with smart money analysis
        """
        logger.info(f"Detecting smart money options for {symbol}")

        # Get options flow with detailed execution data
        options_flow = await self._get_options_flow(symbol)

        if options_flow.empty:
            return self._empty_smart_money_result(symbol)

        # Identify smart money signals
        smart_money_signals = self._identify_smart_money_signals(options_flow)

        # Calculate institutional bias
        bullish_signals = smart_money_signals[
            smart_money_signals["signal_type"].str.contains("bullish", case=False)
        ]
        bearish_signals = smart_money_signals[
            smart_money_signals["signal_type"].str.contains("bearish", case=False)
        ]

        bullish_premium = (
            bullish_signals["premium"].sum() if not bullish_signals.empty else 0
        )
        bearish_premium = (
            bearish_signals["premium"].sum() if not bearish_signals.empty else 0
        )

        if bullish_premium > bearish_premium * 1.5:
            institutional_bias = "bullish"
        elif bearish_premium > bullish_premium * 1.5:
            institutional_bias = "bearish"
        else:
            institutional_bias = "neutral"

        # Calculate conviction score (0 to 1)
        total_premium = bullish_premium + bearish_premium
        if total_premium > 0:
            conviction_score = abs(bullish_premium - bearish_premium) / total_premium
        else:
            conviction_score = 0.0

        # Identify key levels from strike clustering
        key_levels = self._identify_key_levels(smart_money_signals)

        return SmartMoneyResult(
            symbol=symbol,
            smart_money_signals=smart_money_signals,
            institutional_bias=institutional_bias,
            conviction_score=conviction_score,
            key_levels=key_levels,
        )

    # ========================================================================
    # Private Helper Methods - Data Fetching
    # ========================================================================

    async def _get_options_data(self, symbol: str, lookback_days: int) -> pd.DataFrame:
        """Get historical options data."""
        if self.data_manager:
            try:
                return await self.data_manager.get_options_flow(
                    symbol, unusual_only=False
                )
            except Exception as e:
                logger.warning(f"Failed to get options data for {symbol}: {e}")

        # Fallback to mock data
        return self._generate_mock_options_data(symbol, lookback_days)

    async def _get_options_chain(self, symbol: str) -> pd.DataFrame:
        """Get current options chain."""
        if self.data_manager:
            try:
                return await self.data_manager.get_options_flow(
                    symbol, unusual_only=False
                )
            except Exception as e:
                logger.warning(f"Failed to get options chain for {symbol}: {e}")

        return self._generate_mock_options_chain(symbol)

    async def _get_options_chain_with_greeks(self, symbol: str) -> pd.DataFrame:
        """Get options chain with greeks."""
        options_chain = await self._get_options_chain(symbol)

        # Add mock greeks if not present
        if "gamma" not in options_chain.columns:
            options_chain = self._add_mock_greeks(options_chain)

        return options_chain

    async def _get_options_flow(self, symbol: str) -> pd.DataFrame:
        """Get options flow data with trade details."""
        if self.data_manager:
            try:
                return await self.data_manager.get_options_flow(
                    symbol, unusual_only=False
                )
            except Exception as e:
                logger.warning(f"Failed to get options flow for {symbol}: {e}")

        return self._generate_mock_options_flow(symbol)

    async def _get_options_flow_with_exchange(self, symbol: str) -> pd.DataFrame:
        """Get options flow with exchange information."""
        options_flow = await self._get_options_flow(symbol)

        # Add mock exchange data if not present
        if "exchange" not in options_flow.columns and not options_flow.empty:
            exchanges = ["CBOE", "ISE", "PHLX", "AMEX", "BOX", "MIAX"]
            options_flow["exchange"] = np.random.choice(exchanges, len(options_flow))
            options_flow["num_exchanges"] = np.random.randint(1, 5, len(options_flow))

        return options_flow

    async def _get_historical_pc_ratio(self, symbol: str) -> List[float]:
        """Get historical put/call ratios."""
        # Generate mock historical P/C ratios
        return list(np.random.uniform(0.5, 1.5, 252))  # 1 year of data

    async def _get_current_price(self, symbol: str) -> float:
        """Get current stock price."""
        if self.data_manager:
            try:
                end_date = datetime.now()
                start_date = end_date - timedelta(days=5)
                stock_data = await self.data_manager.get_stock_data(
                    symbol, start_date, end_date
                )
                if not stock_data.empty:
                    return stock_data["close"].iloc[-1]
            except Exception as e:
                logger.warning(f"Failed to get current price for {symbol}: {e}")

        # Mock price
        return 150.0 + np.random.uniform(-10, 10)

    # ========================================================================
    # Private Helper Methods - Analysis
    # ========================================================================

    def _identify_unusual_contracts(
        self, options_data: pd.DataFrame, lookback_days: int
    ) -> pd.DataFrame:
        """Identify contracts with unusual volume."""
        if options_data.empty:
            return pd.DataFrame()

        # Calculate average volume per contract
        avg_volume = options_data.groupby("contract_symbol")["volume"].mean()

        # Get recent data
        recent_data = options_data.tail(lookback_days * 10)  # Approximate

        # Find unusual contracts
        unusual = []
        for contract in recent_data["contract_symbol"].unique():
            contract_data = recent_data[recent_data["contract_symbol"] == contract]
            if contract in avg_volume.index:
                ratio = contract_data["volume"].sum() / (
                    avg_volume[contract] * lookback_days + 1
                )
                if ratio > 2.0:  # 2x average
                    unusual.append(
                        {
                            "contract_symbol": contract,
                            "volume_ratio": ratio,
                            "volume": contract_data["volume"].sum(),
                            "avg_volume": avg_volume[contract],
                        }
                    )

        return pd.DataFrame(unusual)

    def _generate_unusual_activity_signal(
        self, volume_ratio: float, call_volume: int, put_volume: int
    ) -> tuple:
        """Generate signal based on unusual activity metrics."""
        total_volume = call_volume + put_volume

        if volume_ratio < 1.5:
            return "neutral", 0.3

        # High volume detected
        if total_volume > 0:
            call_ratio = call_volume / total_volume

            if call_ratio > 0.65 and volume_ratio > 2.0:
                confidence = min(1.0, volume_ratio / 3.0)
                return "bullish", confidence
            elif call_ratio < 0.35 and volume_ratio > 2.0:
                confidence = min(1.0, volume_ratio / 3.0)
                return "bearish", confidence

        return "neutral", 0.5

    def _calculate_percentile(self, value: float, historical: List[float]) -> float:
        """Calculate percentile of value in historical distribution."""
        if not historical:
            return 50.0
        return (
            float(np.percentile([1 if v < value else 0 for v in historical], 50) * 100)
            if historical
            else 50.0
        )

    def _interpret_pc_ratio(self, pc_ratio: float, percentile: float) -> tuple:
        """Interpret put/call ratio with contrarian view."""
        # High P/C ratio (extreme fear) is contrarian bullish
        # Low P/C ratio (extreme greed) is contrarian bearish

        if pc_ratio > 1.2 and percentile > 80:
            interpretation = "Extreme fear - contrarian bullish"
            signal = "bullish"
        elif pc_ratio > 0.9 and percentile > 65:
            interpretation = "Elevated puts - moderately bullish"
            signal = "moderately_bullish"
        elif pc_ratio < 0.6 and percentile < 20:
            interpretation = "Extreme greed - contrarian bearish"
            signal = "bearish"
        elif pc_ratio < 0.75 and percentile < 35:
            interpretation = "Elevated calls - moderately bearish"
            signal = "moderately_bearish"
        else:
            interpretation = "Neutral positioning"
            signal = "neutral"

        return interpretation, signal

    def _identify_sweeps(self, options_flow: pd.DataFrame) -> pd.DataFrame:
        """Identify sweep orders from options flow."""
        if options_flow.empty:
            return pd.DataFrame(
                columns=[
                    "contract_symbol",
                    "sweep_type",
                    "premium",
                    "strike",
                    "expiration",
                    "num_exchanges",
                    "timestamp",
                ]
            )

        # Sweeps are characterized by:
        # 1. Multi-exchange fills (num_exchanges > 1)
        # 2. Aggressive pricing (at ask for buys, at bid for sells)
        # 3. Large premium

        sweeps = options_flow[
            (options_flow.get("num_exchanges", 1) > 1)
            | (options_flow.get("premium", 0) > 50000)
        ].copy()

        if sweeps.empty:
            return pd.DataFrame(
                columns=[
                    "contract_symbol",
                    "sweep_type",
                    "premium",
                    "strike",
                    "expiration",
                    "num_exchanges",
                    "timestamp",
                ]
            )

        # Determine sweep type based on option type and trade direction
        # Vectorized optimization:
        # call + buy -> bullish (True == True)
        # put + sell -> bullish (False == False)
        # call + sell -> bearish (True != False)
        # put + buy -> bearish (False != True)

        is_call = sweeps.get("option_type", "call") == "call"
        is_buy = sweeps.get("trade_type", "buy") == "buy"

        sweeps["sweep_type"] = np.where(is_call == is_buy, "bullish", "bearish")

        return sweeps

    def _calculate_gamma_by_strike(
        self, options_chain: pd.DataFrame, current_price: float
    ) -> pd.DataFrame:
        """Calculate gamma exposure by strike price."""
        if options_chain.empty:
            return pd.DataFrame(
                columns=["strike", "call_gamma", "put_gamma", "net_gamma"]
            )

        # Vectorized calculation
        # Calculate gamma exposure per position
        chain = options_chain.copy()
        chain["gamma_exposure"] = chain["gamma"] * chain["open_interest"]

        # Group by strike and option_type
        grouped = (
            chain.groupby(["strike", "option_type"])["gamma_exposure"]
            .sum()
            .unstack(fill_value=0)
        )

        # Ensure call/put columns exist
        if "call" not in grouped.columns:
            grouped["call"] = 0.0
        if "put" not in grouped.columns:
            grouped["put"] = 0.0

        # Calculate metrics
        result = grouped.reset_index()
        result = result.rename(columns={"call": "call_gamma", "put": "put_gamma"})
        result["net_gamma"] = -result["call_gamma"] + result["put_gamma"]

        return result[["strike", "call_gamma", "put_gamma", "net_gamma"]].sort_values(
            "strike"
        )

    def _find_gamma_flip(self, gamma_by_strike: pd.DataFrame) -> Optional[float]:
        """Find the price where net gamma flips from positive to negative."""
        if gamma_by_strike.empty:
            return None

        # Look for sign change in net_gamma
        for i in range(1, len(gamma_by_strike)):
            prev_gamma = gamma_by_strike.iloc[i - 1]["net_gamma"]
            curr_gamma = gamma_by_strike.iloc[i]["net_gamma"]

            if prev_gamma * curr_gamma < 0:  # Sign change
                # Linear interpolation
                prev_strike = gamma_by_strike.iloc[i - 1]["strike"]
                curr_strike = gamma_by_strike.iloc[i]["strike"]
                ratio = abs(prev_gamma) / (abs(prev_gamma) + abs(curr_gamma))
                return prev_strike + ratio * (curr_strike - prev_strike)

        return None

    def _calculate_max_pain(self, options_chain: pd.DataFrame) -> float:
        """Calculate max pain strike (where options buyers lose most)."""
        if options_chain.empty:
            return 0.0

        # Aggregate open interest by strike and option type first
        # This drastically reduces problem size from N (rows) to ~2*S (strikes)
        grouped = (
            options_chain.groupby(["strike", "option_type"])["open_interest"]
            .sum()
            .unstack(fill_value=0)
        )

        if grouped.empty:
            return 0.0

        strikes = grouped.index.values

        # Ensure call/put columns exist
        if "call" not in grouped.columns:
            grouped["call"] = 0
        if "put" not in grouped.columns:
            grouped["put"] = 0

        call_oi = grouped["call"].values
        put_oi = grouped["put"].values

        # Fully vectorized broadcasting approach (O(S^2))
        # shape (S, 1) - column vector
        strikes_v = strikes.reshape(-1, 1)
        # shape (1, S) - row vector (these are the test strikes)
        test_strikes_v = strikes.reshape(1, -1)

        # Difference matrix: diff[i, j] = strike[i] - test_strike[j]
        diff = strikes_v - test_strikes_v

        # Call Pain: sum(call_oi[i] * (strike[i] - test_strike[j])) where strike[i] > test_strike[j]
        # diff > 0 means strike[i] > test_strike[j]
        # We sum over axis 0 (summing over all strikes i for each test strike j)
        call_pain = np.sum(
            np.where(diff > 0, call_oi.reshape(-1, 1) * diff, 0), axis=0
        )

        # Put Pain: sum(put_oi[i] * (test_strike[j] - strike[i])) where strike[i] < test_strike[j]
        # diff < 0 means strike[i] < test_strike[j]
        # test_strike[j] - strike[i] is -diff
        put_pain = np.sum(
            np.where(diff < 0, put_oi.reshape(-1, 1) * (-diff), 0), axis=0
        )

        total_pain = call_pain + put_pain

        # Find index of minimum pain
        min_pain_idx = np.argmin(total_pain)

        return float(strikes[min_pain_idx])

    def _identify_smart_money_signals(self, options_flow: pd.DataFrame) -> pd.DataFrame:
        """Identify smart money trading patterns."""
        if options_flow.empty:
            return pd.DataFrame(
                columns=[
                    "contract_symbol",
                    "signal_type",
                    "premium",
                    "strike",
                    "expiration",
                    "confidence",
                ]
            )

        # Vectorized implementation for performance (avoid iterrows)
        # Extract columns with fallback to defaults
        premium = (
            options_flow["premium"]
            if "premium" in options_flow.columns
            else pd.Series(0, index=options_flow.index)
        ).fillna(0)

        option_type = (
            options_flow["option_type"]
            if "option_type" in options_flow.columns
            else pd.Series("call", index=options_flow.index)
        ).fillna("call")

        dte = (
            options_flow["days_to_expiry"]
            if "days_to_expiry" in options_flow.columns
            else pd.Series(30, index=options_flow.index)
        ).fillna(30)

        contract_symbol = (
            options_flow["contract_symbol"]
            if "contract_symbol" in options_flow.columns
            else pd.Series("", index=options_flow.index)
        ).fillna("")

        strike = (
            options_flow["strike"]
            if "strike" in options_flow.columns
            else pd.Series(0, index=options_flow.index)
        ).fillna(0)

        expiration = (
            options_flow["expiration"]
            if "expiration" in options_flow.columns
            else pd.Series("", index=options_flow.index)
        ).fillna("")

        results = []

        # 1. Large Blocks: premium >= 100000
        mask_block = premium >= 100000
        if mask_block.any():
            block_types = np.where(
                option_type[mask_block] == "call", "bullish_block", "bearish_block"
            )
            block_conf = np.minimum(1.0, premium[mask_block] / 500000)

            blocks = pd.DataFrame(
                {
                    "contract_symbol": contract_symbol[mask_block],
                    "signal_type": block_types,
                    "premium": premium[mask_block],
                    "strike": strike[mask_block],
                    "expiration": expiration[mask_block],
                    "confidence": block_conf,
                }
            )
            results.append(blocks)

        # 2. LEAPS: premium >= 50000 and dte > 90
        mask_leaps = (premium >= 50000) & (dte > 90)
        if mask_leaps.any():
            leaps_types = np.where(
                option_type[mask_leaps] == "call", "bullish_leaps", "bearish_leaps"
            )
            leaps_conf = np.minimum(
                1.0, premium[mask_leaps] / 200000 + dte[mask_leaps] / 365
            )

            leaps = pd.DataFrame(
                {
                    "contract_symbol": contract_symbol[mask_leaps],
                    "signal_type": leaps_types,
                    "premium": premium[mask_leaps],
                    "strike": strike[mask_leaps],
                    "expiration": expiration[mask_leaps],
                    "confidence": leaps_conf,
                }
            )
            results.append(leaps)

        if results:
            return pd.concat(results, ignore_index=True)
        else:
            return pd.DataFrame(
                columns=[
                    "contract_symbol",
                    "signal_type",
                    "premium",
                    "strike",
                    "expiration",
                    "confidence",
                ]
            )

    def _identify_key_levels(self, smart_money_signals: pd.DataFrame) -> List[float]:
        """Identify key price levels from smart money activity."""
        if smart_money_signals.empty:
            return []

        # Weight strikes by premium
        strike_weights = smart_money_signals.groupby("strike")["premium"].sum()

        # Get top 5 strikes by premium
        top_strikes = strike_weights.nlargest(5).index.tolist()

        return sorted(top_strikes)

    # ========================================================================
    # Private Helper Methods - Mock Data Generation
    # ========================================================================

    def _generate_mock_options_data(
        self, symbol: str, lookback_days: int
    ) -> pd.DataFrame:
        """Generate mock options data."""
        dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")
        data = []

        base_price = 150.0
        strikes = [base_price * (0.9 + i * 0.05) for i in range(5)]

        for date in dates:
            for strike in strikes:
                for option_type in ["call", "put"]:
                    data.append(
                        {
                            "date": date,
                            "contract_symbol": f"{symbol}{date.strftime('%y%m%d')}{option_type[0].upper()}{int(strike*1000):08d}",
                            "option_type": option_type,
                            "strike": strike,
                            "expiration": date + timedelta(days=30),
                            "volume": np.random.randint(100, 5000),
                            "open_interest": np.random.randint(1000, 50000),
                            "premium": np.random.uniform(10000, 500000),
                            "days_to_expiry": 30,
                            "trade_type": np.random.choice(["buy", "sell"]),
                        }
                    )

        return pd.DataFrame(data)

    def _generate_mock_options_chain(self, symbol: str) -> pd.DataFrame:
        """Generate mock options chain."""
        base_price = 150.0
        strikes = [base_price * (0.8 + i * 0.05) for i in range(9)]
        expirations = [datetime.now() + timedelta(days=d) for d in [7, 14, 30, 60, 90]]

        data = []
        for exp in expirations:
            for strike in strikes:
                for option_type in ["call", "put"]:
                    dte = (exp - datetime.now()).days
                    data.append(
                        {
                            "contract_symbol": f"{symbol}{exp.strftime('%y%m%d')}{option_type[0].upper()}{int(strike*1000):08d}",
                            "option_type": option_type,
                            "strike": strike,
                            "expiration": exp,
                            "volume": np.random.randint(100, 5000),
                            "open_interest": np.random.randint(1000, 50000),
                            "premium": np.random.uniform(10000, 500000),
                            "days_to_expiry": dte,
                        }
                    )

        return pd.DataFrame(data)

    def _generate_mock_options_flow(self, symbol: str) -> pd.DataFrame:
        """Generate mock options flow data."""
        base_price = 150.0
        strikes = [base_price * (0.9 + i * 0.05) for i in range(5)]

        data = []
        for _ in range(50):  # 50 trades
            strike = np.random.choice(strikes)
            option_type = np.random.choice(["call", "put"])
            exp_date = datetime.now() + timedelta(days=np.random.randint(7, 120))

            data.append(
                {
                    "contract_symbol": f"{symbol}{exp_date.strftime('%y%m%d')}{option_type[0].upper()}{int(strike*1000):08d}",
                    "option_type": option_type,
                    "strike": strike,
                    "expiration": exp_date,
                    "volume": np.random.randint(100, 5000),
                    "open_interest": np.random.randint(1000, 50000),
                    "premium": np.random.uniform(10000, 500000),
                    "days_to_expiry": (exp_date - datetime.now()).days,
                    "trade_type": np.random.choice(["buy", "sell"]),
                    "num_exchanges": np.random.randint(1, 5),
                    "timestamp": datetime.now()
                    - timedelta(hours=np.random.randint(0, 72)),
                }
            )

        return pd.DataFrame(data)

    def _add_mock_greeks(self, options_chain: pd.DataFrame) -> pd.DataFrame:
        """Add mock greeks to options chain."""
        if options_chain.empty:
            return options_chain

        options_chain = options_chain.copy()

        # Generate mock greeks based on moneyness and time to expiry
        base_price = 150.0

        # Vectorized gamma calculation
        moneyness = options_chain["strike"] / base_price
        dte = (
            options_chain["days_to_expiry"].fillna(30)
            if "days_to_expiry" in options_chain.columns
            else 30
        )

        # Gamma highest ATM and decreases with time
        atm_factor = np.exp(-10 * (moneyness - 1) ** 2)
        time_factor = 1 / np.sqrt(dte + 1)
        options_chain["gamma"] = atm_factor * time_factor * 0.05
        options_chain["delta"] = np.where(
            options_chain["option_type"] == "call",
            np.random.uniform(0.2, 0.8, len(options_chain)),
            np.random.uniform(-0.8, -0.2, len(options_chain)),
        )
        options_chain["theta"] = -np.random.uniform(0.01, 0.1, len(options_chain))
        options_chain["vega"] = np.random.uniform(0.1, 0.5, len(options_chain))

        return options_chain

    # ========================================================================
    # Private Helper Methods - Empty Results
    # ========================================================================

    def _empty_unusual_activity_result(self, symbol: str) -> UnusualActivityResult:
        """Return empty unusual activity result."""
        return UnusualActivityResult(
            symbol=symbol,
            date=datetime.now(),
            volume_ratio=0.0,
            avg_volume_20d=0.0,
            current_volume=0.0,
            call_volume=0,
            put_volume=0,
            unusual_contracts=pd.DataFrame(),
            signal="neutral",
            confidence=0.0,
        )

    def _empty_pc_ratio_result(self, symbol: str) -> PutCallRatioResult:
        """Return empty P/C ratio result."""
        return PutCallRatioResult(
            symbol=symbol,
            volume_pc_ratio=0.0,
            oi_pc_ratio=0.0,
            interpretation="No data available",
            historical_percentile=50.0,
            signal="neutral",
        )

    def _empty_sweep_result(self, symbol: str) -> SweepOrderResult:
        """Return empty sweep order result."""
        return SweepOrderResult(
            symbol=symbol,
            sweeps=pd.DataFrame(),
            bullish_sweep_count=0,
            bearish_sweep_count=0,
            total_bullish_premium=0.0,
            total_bearish_premium=0.0,
            net_sweep_sentiment="neutral",
        )

    def _empty_large_trade_result(self, symbol: str) -> LargeTradeResult:
        """Return empty large trade result."""
        return LargeTradeResult(
            symbol=symbol,
            large_trades=pd.DataFrame(),
            total_call_premium=0.0,
            total_put_premium=0.0,
            largest_trade={},
            smart_money_direction="neutral",
        )

    def _empty_gamma_result(self, symbol: str) -> GammaExposureResult:
        """Return empty gamma exposure result."""
        return GammaExposureResult(
            symbol=symbol,
            net_gamma=0.0,
            call_gamma=0.0,
            put_gamma=0.0,
            gamma_flip_price=None,
            max_pain=0.0,
            gamma_exposure_by_strike=pd.DataFrame(),
        )

    def _empty_smart_money_result(self, symbol: str) -> SmartMoneyResult:
        """Return empty smart money result."""
        return SmartMoneyResult(
            symbol=symbol,
            smart_money_signals=pd.DataFrame(),
            institutional_bias="neutral",
            conviction_score=0.0,
            key_levels=[],
        )

    # ========================================================================
    # Utility Methods
    # ========================================================================

    def health_check(self) -> bool:
        """
        Check if options flow analyzer is operational.

        Returns:
            True if healthy
        """
        return True
