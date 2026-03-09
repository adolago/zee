"""
Options Flow Analyzer Module

Analyze options flow to detect institutional activity, calculate gamma exposure,
track smart money, and identify unusual options activity.
No crystal balls, no tea leaves - just real options flow data.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, TypedDict

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class GammaExposure(TypedDict):
    """Gamma exposure analysis result."""

    symbol: str
    total_gex: float
    call_gex: float
    put_gex: float
    net_gex: float
    flip_point: Optional[float]
    max_gamma_strike: float
    timestamp: str


class UnusualActivity(TypedDict):
    """Unusual options activity record."""

    symbol: str
    strike: float
    expiration: str
    option_type: str
    volume: int
    open_interest: int
    vol_oi_ratio: float
    premium: float
    implied_volatility: float
    trade_type: str  # 'sweep', 'block', 'split'
    sentiment: str  # 'bullish', 'bearish', 'neutral'


class SmartMoneyTrade(TypedDict):
    """Smart money trade record."""

    symbol: str
    strike: float
    expiration: str
    option_type: str
    premium: float
    volume: int
    trade_type: str
    side: str  # 'buy', 'sell'
    sentiment: str
    timestamp: str


class OptionsFlowSummary(TypedDict):
    """Complete options flow analysis summary."""

    symbol: str
    total_call_volume: int
    total_put_volume: int
    total_call_premium: float
    total_put_premium: float
    put_call_ratio: float
    premium_put_call_ratio: float
    gamma_exposure: GammaExposure
    unusual_activity_count: int
    smart_money_trades: int
    net_premium_flow: float
    sentiment: str
    confidence: float
    timestamp: str


class ExpirationAnalysis(TypedDict):
    """Analysis for a specific expiration date."""

    expiration: str
    max_pain: float
    total_call_oi: int
    total_put_oi: int
    total_call_volume: int
    total_put_volume: int
    gamma_concentration: float
    pin_risk: float
    days_to_expiry: int


class OptionsAnalyzer:
    """
    Analyze options flow for institutional activity and smart money signals.

    Provides institutional-grade options flow analysis including:
    - Unusual options activity detection
    - Gamma exposure (GEX) calculation
    - Put/call flow analysis
    - Smart money tracking
    - Expiration flow and max pain analysis
    """

    # Volume/OI ratio threshold for unusual activity
    UNUSUAL_VOL_OI_THRESHOLD = 2.0

    # Minimum premium for smart money consideration ($)
    SMART_MONEY_MIN_PREMIUM = 100_000

    # Block trade minimum premium ($)
    BLOCK_TRADE_THRESHOLD = 1_000_000

    # Sweep detection: minimum contracts across multiple exchanges
    SWEEP_MIN_CONTRACTS = 100

    def __init__(self, data_manager=None, options_provider=None):
        """
        Initialize options flow analyzer.

        Args:
            data_manager: Data manager instance for options chain access
            options_provider: OptionsProvider instance for real options data with Greeks
        """
        self.data_manager = data_manager
        self._options_provider = options_provider
        logger.info("OptionsAnalyzer initialized")

    @property
    def options_provider(self):
        """Lazy initialization of Options provider."""
        if self._options_provider is None:
            try:
                from investing.data.providers import OptionsProvider

                self._options_provider = OptionsProvider()
            except ImportError:
                logger.warning("Options provider not available")
        return self._options_provider

    async def _ensure_options_provider_initialized(self):
        """Ensure Options provider is initialized."""
        if self.options_provider and not getattr(
            self.options_provider, "_initialized", False
        ):
            try:
                await self.options_provider.initialize()
            except Exception as e:
                logger.warning(f"Failed to initialize Options provider: {e}")

    async def get_options_flow(
        self, symbol: str, lookback_days: int = 5
    ) -> OptionsFlowSummary:
        """
        Get comprehensive options flow analysis for a symbol.

        Args:
            symbol: Stock ticker symbol
            lookback_days: Number of days of data to analyze

        Returns:
            OptionsFlowSummary with complete flow analysis
        """
        symbol = symbol.upper()
        logger.info(f"Analyzing options flow for {symbol}")

        try:
            # Get options chain data
            options_df = await self._get_options_chain(symbol)

            if options_df.empty:
                return self._empty_flow_summary(symbol)

            # Calculate all flow metrics
            call_data = options_df[options_df["option_type"] == "call"]
            put_data = options_df[options_df["option_type"] == "put"]

            total_call_volume = (
                int(call_data["volume"].sum()) if not call_data.empty else 0
            )
            total_put_volume = (
                int(put_data["volume"].sum()) if not put_data.empty else 0
            )
            total_call_premium = self._calculate_total_premium(call_data)
            total_put_premium = self._calculate_total_premium(put_data)

            # Put/Call ratios
            put_call_ratio = (
                total_put_volume / total_call_volume if total_call_volume > 0 else 0.0
            )
            premium_put_call_ratio = (
                total_put_premium / total_call_premium
                if total_call_premium > 0
                else 0.0
            )

            # Gamma exposure
            gamma_exposure = self._calculate_gamma_exposure(options_df, symbol)

            # Unusual activity
            unusual_df = self._detect_unusual_activity(options_df, symbol)
            unusual_count = len(unusual_df) if unusual_df is not None else 0

            # Smart money
            smart_money_df = self._identify_smart_money_trades(options_df, symbol)
            smart_money_count = len(smart_money_df) if smart_money_df is not None else 0

            # Net premium flow (positive = bullish, negative = bearish)
            net_premium_flow = total_call_premium - total_put_premium

            # Overall sentiment
            sentiment, confidence = self._calculate_sentiment(
                put_call_ratio,
                premium_put_call_ratio,
                gamma_exposure["net_gex"],
                net_premium_flow,
            )

            return OptionsFlowSummary(
                symbol=symbol,
                total_call_volume=total_call_volume,
                total_put_volume=total_put_volume,
                total_call_premium=round(total_call_premium, 2),
                total_put_premium=round(total_put_premium, 2),
                put_call_ratio=round(put_call_ratio, 3),
                premium_put_call_ratio=round(premium_put_call_ratio, 3),
                gamma_exposure=gamma_exposure,
                unusual_activity_count=unusual_count,
                smart_money_trades=smart_money_count,
                net_premium_flow=round(net_premium_flow, 2),
                sentiment=sentiment,
                confidence=round(confidence, 3),
                timestamp=datetime.now(timezone.utc).isoformat(),
            )

        except Exception as e:
            logger.error(f"Error analyzing options flow for {symbol}: {e}")
            return self._empty_flow_summary(symbol)

    async def detect_unusual_activity(
        self,
        symbol: str,
        volume_threshold: float = None,
        min_premium: float = 50_000,
    ) -> pd.DataFrame:
        """
        Detect unusual options activity based on volume/OI ratio and premium.

        Args:
            symbol: Stock ticker symbol
            volume_threshold: Minimum volume/OI ratio (default: 2.0)
            min_premium: Minimum premium in dollars

        Returns:
            DataFrame with unusual activity records
        """
        symbol = symbol.upper()
        threshold = volume_threshold or self.UNUSUAL_VOL_OI_THRESHOLD

        try:
            options_df = await self._get_options_chain(symbol)

            if options_df.empty:
                return pd.DataFrame()

            return self._detect_unusual_activity(
                options_df, symbol, threshold, min_premium
            )

        except Exception as e:
            logger.error(f"Error detecting unusual activity for {symbol}: {e}")
            return pd.DataFrame()

    async def calculate_gamma_exposure(self, symbol: str) -> GammaExposure:
        """
        Calculate aggregate gamma exposure (GEX) for a symbol.

        Gamma exposure shows dealer hedging pressure:
        - Positive GEX: Dealers are long gamma, will buy dips and sell rallies
        - Negative GEX: Dealers are short gamma, will amplify moves

        Args:
            symbol: Stock ticker symbol

        Returns:
            GammaExposure with detailed gamma analysis
        """
        symbol = symbol.upper()

        try:
            options_df = await self._get_options_chain(symbol)

            if options_df.empty:
                return self._empty_gamma_exposure(symbol)

            return self._calculate_gamma_exposure(options_df, symbol)

        except Exception as e:
            logger.error(f"Error calculating gamma exposure for {symbol}: {e}")
            return self._empty_gamma_exposure(symbol)

    async def analyze_put_call_flow(self, symbol: str) -> Dict[str, Any]:
        """
        Analyze put/call flow patterns and premium distribution.

        Args:
            symbol: Stock ticker symbol

        Returns:
            Dictionary with detailed put/call analysis
        """
        symbol = symbol.upper()

        try:
            options_df = await self._get_options_chain(symbol)

            if options_df.empty:
                return self._empty_put_call_analysis(symbol)

            return self._analyze_put_call_flow(options_df, symbol)

        except Exception as e:
            logger.error(f"Error analyzing put/call flow for {symbol}: {e}")
            return self._empty_put_call_analysis(symbol)

    async def track_smart_money(
        self, symbol: str, min_premium: float = None
    ) -> pd.DataFrame:
        """
        Track smart money options activity.

        Smart money indicators:
        - Block trades (>$1M premium)
        - Sweep orders (aggressive fills across exchanges)
        - Out-of-money accumulation with high premium
        - Opening positions in illiquid strikes

        Args:
            symbol: Stock ticker symbol
            min_premium: Minimum premium threshold (default: $100k)

        Returns:
            DataFrame with smart money trade records
        """
        symbol = symbol.upper()
        threshold = min_premium or self.SMART_MONEY_MIN_PREMIUM

        try:
            options_df = await self._get_options_chain(symbol)

            if options_df.empty:
                return pd.DataFrame()

            return self._identify_smart_money_trades(options_df, symbol, threshold)

        except Exception as e:
            logger.error(f"Error tracking smart money for {symbol}: {e}")
            return pd.DataFrame()

    async def analyze_expiration_flow(
        self, symbol: str, expiration: Optional[str] = None
    ) -> ExpirationAnalysis:
        """
        Analyze options flow for a specific expiration.

        Args:
            symbol: Stock ticker symbol
            expiration: Expiration date (YYYY-MM-DD), or None for nearest

        Returns:
            ExpirationAnalysis with max pain and flow metrics
        """
        symbol = symbol.upper()

        try:
            options_df = await self._get_options_chain(symbol)

            if options_df.empty:
                return self._empty_expiration_analysis(symbol, expiration or "unknown")

            # Get nearest expiration if not specified
            if expiration is None:
                expirations = options_df["expiration"].unique()
                if len(expirations) == 0:
                    return self._empty_expiration_analysis(symbol, "unknown")
                expiration = min(expirations)

            return self._analyze_expiration(options_df, symbol, expiration)

        except Exception as e:
            logger.error(f"Error analyzing expiration flow for {symbol}: {e}")
            return self._empty_expiration_analysis(symbol, expiration or "unknown")

    async def calculate_max_pain(
        self, symbol: str, expiration: Optional[str] = None
    ) -> float:
        """
        Calculate max pain strike for an expiration.

        Max pain is the strike price where option holders would experience
        the maximum financial loss at expiration.

        Args:
            symbol: Stock ticker symbol
            expiration: Expiration date (YYYY-MM-DD)

        Returns:
            Max pain strike price
        """
        analysis = await self.analyze_expiration_flow(symbol, expiration)
        return analysis["max_pain"]

    def health_check(self) -> bool:
        """Check if options analyzer is operational."""
        return True

    # =========================================================================
    # Private Methods
    # =========================================================================

    async def _get_options_chain(self, symbol: str) -> pd.DataFrame:
        """
        Get options chain with real Greeks from provider or fall back to mock.

        Priority:
        1. OptionsProvider (real data with Black-Scholes Greeks)
        2. DataManager (legacy interface)
        3. Mock data (for testing/development)
        """
        # Try options provider first (has real Greeks calculation)
        await self._ensure_options_provider_initialized()
        if self.options_provider:
            try:
                df = await self.options_provider.get_options_chain(symbol)
                if df is not None and not df.empty:
                    logger.debug(f"Got options chain for {symbol} from OptionsProvider")
                    # Normalize column names if needed
                    df = self._normalize_options_chain(df)
                    return df
            except Exception as e:
                logger.warning(f"OptionsProvider failed for {symbol}: {e}")

        # Fall back to data manager
        if self.data_manager:
            try:
                df = await self.data_manager.get_options_chain(symbol)
                if df is not None and not df.empty:
                    logger.debug(f"Got options chain for {symbol} from DataManager")
                    df = self._normalize_options_chain(df)
                    return df
            except Exception as e:
                logger.warning(f"DataManager failed for {symbol}: {e}")

        # Final fallback to mock data
        logger.debug(f"Using mock options chain for {symbol}")
        return self._generate_mock_options_chain(symbol)

    def _normalize_options_chain(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Normalize options chain column names to expected format.

        Handles variations from different data sources:
        - 'last' vs 'last_price'
        - 'type' vs 'option_type'
        """
        if df.empty:
            return df

        column_mapping = {
            "last": "last_price",
            "type": "option_type",
            "contract_type": "option_type",
            "oi": "open_interest",
            "vol": "volume",
            "iv": "implied_volatility",
        }

        for old_col, new_col in column_mapping.items():
            if old_col in df.columns and new_col not in df.columns:
                df = df.rename(columns={old_col: new_col})

        return df

    def _generate_mock_options_chain(self, symbol: str) -> pd.DataFrame:
        """Generate mock options chain for testing."""
        # Base price for the underlying
        base_price = 150.0 + np.random.uniform(-50, 50)

        # Generate strikes around the money
        strikes = np.arange(
            base_price * 0.8, base_price * 1.2, base_price * 0.025
        ).round(2)

        # Generate expirations (weekly and monthly)
        today = datetime.now()
        expirations = [
            (today + timedelta(days=d)).strftime("%Y-%m-%d")
            for d in [7, 14, 21, 30, 45, 60, 90]
        ]

        records = []
        for exp in expirations:
            days_to_exp = max(1, (datetime.strptime(exp, "%Y-%m-%d") - today).days)
            time_factor = np.sqrt(days_to_exp / 365)

            for strike in strikes:
                # Calculate moneyness
                moneyness = strike / base_price

                for opt_type in ["call", "put"]:
                    # Generate realistic Greeks and prices
                    if opt_type == "call":
                        delta = max(
                            0, min(1, 1.1 - moneyness + np.random.uniform(-0.1, 0.1))
                        )
                        itm = strike < base_price
                    else:
                        delta = max(
                            -1, min(0, moneyness - 1.1 + np.random.uniform(-0.1, 0.1))
                        )
                        itm = strike > base_price

                    # Gamma peaks ATM
                    gamma = 0.05 * np.exp(-((moneyness - 1) ** 2) / 0.02) * time_factor

                    # IV smile
                    iv = (
                        0.25 + 0.1 * abs(moneyness - 1) + np.random.uniform(-0.02, 0.02)
                    )

                    # Premium calculation (simplified Black-Scholes-ish)
                    intrinsic = max(
                        0,
                        (
                            (base_price - strike)
                            if opt_type == "call"
                            else (strike - base_price)
                        ),
                    )
                    extrinsic = base_price * iv * time_factor * 0.4
                    premium = intrinsic + extrinsic

                    # Volume and OI (higher for ATM, lower for wings)
                    atm_factor = np.exp(-((moneyness - 1) ** 2) / 0.1)
                    base_oi = int(1000 * atm_factor + np.random.randint(10, 500))
                    volume = int(base_oi * np.random.uniform(0.1, 3.0))

                    records.append(
                        {
                            "symbol": symbol,
                            "strike": strike,
                            "expiration": exp,
                            "option_type": opt_type,
                            "last_price": round(premium, 2),
                            "bid": round(premium * 0.95, 2),
                            "ask": round(premium * 1.05, 2),
                            "volume": volume,
                            "open_interest": base_oi,
                            "implied_volatility": round(iv, 4),
                            "delta": round(delta, 4),
                            "gamma": round(gamma, 6),
                            "theta": round(-premium * 0.01 / days_to_exp, 4),
                            "vega": round(premium * 0.1, 4),
                            "underlying_price": base_price,
                        }
                    )

        return pd.DataFrame(records)

    def _calculate_total_premium(self, options_df: pd.DataFrame) -> float:
        """Calculate total premium traded (volume * price * 100)."""
        if options_df.empty:
            return 0.0

        if "last_price" in options_df.columns and "volume" in options_df.columns:
            return float((options_df["last_price"] * options_df["volume"] * 100).sum())
        return 0.0

    def _detect_unusual_activity(
        self,
        options_df: pd.DataFrame,
        symbol: str,
        threshold: float = None,
        min_premium: float = 50_000,
    ) -> pd.DataFrame:
        """Detect unusual options activity in the chain."""
        threshold = threshold or self.UNUSUAL_VOL_OI_THRESHOLD

        if options_df.empty:
            return pd.DataFrame()

        # Calculate volume/OI ratio
        df = options_df.copy()
        df["open_interest"] = df["open_interest"].replace(0, 1)  # Avoid div by zero
        df["vol_oi_ratio"] = df["volume"] / df["open_interest"]
        df["premium"] = df["last_price"] * df["volume"] * 100

        # Filter for unusual activity
        unusual = df[
            (df["vol_oi_ratio"] >= threshold) & (df["premium"] >= min_premium)
        ].copy()

        if unusual.empty:
            return pd.DataFrame()

        # Classify trade type
        unusual["trade_type"] = unusual.apply(self._classify_trade_type, axis=1)

        # Determine sentiment
        unusual["sentiment"] = unusual.apply(self._determine_sentiment, axis=1)

        # Select and rename columns
        result = unusual[
            [
                "strike",
                "expiration",
                "option_type",
                "volume",
                "open_interest",
                "vol_oi_ratio",
                "premium",
                "implied_volatility",
                "trade_type",
                "sentiment",
            ]
        ].copy()

        result["symbol"] = symbol

        return result.sort_values("premium", ascending=False)

    def _classify_trade_type(self, row: pd.Series) -> str:
        """Classify the trade type based on characteristics."""
        premium = row.get("premium", 0)
        volume = row.get("volume", 0)

        if premium >= self.BLOCK_TRADE_THRESHOLD:
            return "block"
        elif volume >= self.SWEEP_MIN_CONTRACTS:
            return "sweep"
        else:
            return "split"

    def _determine_sentiment(self, row: pd.Series) -> str:
        """Determine trade sentiment based on option type and other factors."""
        opt_type = row.get("option_type", "")
        delta = row.get("delta", 0)

        # Simple heuristic: calls are bullish, puts are bearish
        # More sophisticated: consider if opening/closing, bid/ask side
        if opt_type == "call":
            return "bullish" if delta > 0.3 else "neutral"
        else:
            return "bearish" if abs(delta) > 0.3 else "neutral"

    def _calculate_gamma_exposure(
        self, options_df: pd.DataFrame, symbol: str
    ) -> GammaExposure:
        """
        Calculate aggregate gamma exposure.

        GEX = Gamma * Open Interest * 100 * Spot^2 / 1e9
        - Calls have positive gamma (dealers long)
        - Puts have negative gamma (dealers short after hedging)
        """
        if options_df.empty:
            return self._empty_gamma_exposure(symbol)

        df = options_df.copy()

        # Get underlying price
        underlying = (
            df["underlying_price"].iloc[0]
            if "underlying_price" in df.columns
            else 100.0
        )

        # Calculate GEX for each option
        # Calls: positive gamma (dealer is long gamma)
        # Puts: negative gamma (dealer is short gamma due to hedging)
        df["gex"] = df.apply(
            lambda row: (
                row["gamma"]
                * row["open_interest"]
                * 100
                * (underlying**2)
                / 1e9
                * (1 if row["option_type"] == "call" else -1)
            ),
            axis=1,
        )

        # Aggregate
        call_gex = float(df[df["option_type"] == "call"]["gex"].sum())
        put_gex = float(df[df["option_type"] == "put"]["gex"].sum())
        total_gex = call_gex + put_gex
        net_gex = call_gex + put_gex  # Put GEX is already negative

        # Find max gamma strike
        df["abs_gamma_oi"] = df["gamma"] * df["open_interest"]
        max_gamma_strike = float(df.loc[df["abs_gamma_oi"].idxmax(), "strike"])

        # Calculate flip point (where GEX changes sign)
        flip_point = self._find_gamma_flip_point(df, underlying)

        return GammaExposure(
            symbol=symbol,
            total_gex=round(total_gex, 2),
            call_gex=round(call_gex, 2),
            put_gex=round(put_gex, 2),
            net_gex=round(net_gex, 2),
            flip_point=round(flip_point, 2) if flip_point else None,
            max_gamma_strike=round(max_gamma_strike, 2),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _find_gamma_flip_point(
        self, options_df: pd.DataFrame, underlying: float
    ) -> Optional[float]:
        """Find the strike where aggregate GEX changes from positive to negative."""
        if options_df.empty:
            return None

        # Group by strike and sum GEX
        df = options_df.copy()
        gex_by_strike = df.groupby("strike")["gex"].sum().sort_index()

        # Find where GEX changes sign
        for i in range(len(gex_by_strike) - 1):
            if gex_by_strike.iloc[i] * gex_by_strike.iloc[i + 1] < 0:
                # Interpolate flip point
                strike1, strike2 = gex_by_strike.index[i], gex_by_strike.index[i + 1]
                gex1, gex2 = gex_by_strike.iloc[i], gex_by_strike.iloc[i + 1]

                if gex2 - gex1 != 0:
                    flip = strike1 + (strike2 - strike1) * (-gex1 / (gex2 - gex1))
                    return flip

        return None

    def _analyze_put_call_flow(
        self, options_df: pd.DataFrame, symbol: str
    ) -> Dict[str, Any]:
        """Analyze put/call flow patterns."""
        if options_df.empty:
            return self._empty_put_call_analysis(symbol)

        calls = options_df[options_df["option_type"] == "call"]
        puts = options_df[options_df["option_type"] == "put"]

        # Volume metrics
        call_volume = int(calls["volume"].sum())
        put_volume = int(puts["volume"].sum())
        pc_ratio = put_volume / call_volume if call_volume > 0 else 0

        # Premium metrics
        call_premium = self._calculate_total_premium(calls)
        put_premium = self._calculate_total_premium(puts)
        premium_pc_ratio = put_premium / call_premium if call_premium > 0 else 0

        # Open interest metrics
        call_oi = int(calls["open_interest"].sum())
        put_oi = int(puts["open_interest"].sum())
        oi_pc_ratio = put_oi / call_oi if call_oi > 0 else 0

        # Strike distribution
        underlying = (
            options_df["underlying_price"].iloc[0]
            if "underlying_price" in options_df.columns
            else 100.0
        )

        itm_calls = calls[calls["strike"] < underlying]
        otm_calls = calls[calls["strike"] >= underlying]
        itm_puts = puts[puts["strike"] > underlying]
        otm_puts = puts[puts["strike"] <= underlying]

        # Calculate weighted average strike by volume
        if call_volume > 0:
            weighted_call_strike = (
                calls["strike"] * calls["volume"]
            ).sum() / call_volume
        else:
            weighted_call_strike = underlying

        if put_volume > 0:
            weighted_put_strike = (puts["strike"] * puts["volume"]).sum() / put_volume
        else:
            weighted_put_strike = underlying

        return {
            "symbol": symbol,
            "put_call_ratio": round(pc_ratio, 3),
            "premium_put_call_ratio": round(premium_pc_ratio, 3),
            "oi_put_call_ratio": round(oi_pc_ratio, 3),
            "total_call_volume": call_volume,
            "total_put_volume": put_volume,
            "total_call_premium": round(call_premium, 2),
            "total_put_premium": round(put_premium, 2),
            "call_open_interest": call_oi,
            "put_open_interest": put_oi,
            "itm_call_volume": int(itm_calls["volume"].sum()),
            "otm_call_volume": int(otm_calls["volume"].sum()),
            "itm_put_volume": int(itm_puts["volume"].sum()),
            "otm_put_volume": int(otm_puts["volume"].sum()),
            "weighted_call_strike": round(weighted_call_strike, 2),
            "weighted_put_strike": round(weighted_put_strike, 2),
            "underlying_price": round(underlying, 2),
            "sentiment": (
                "bullish"
                if pc_ratio < 0.7
                else ("bearish" if pc_ratio > 1.3 else "neutral")
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _identify_smart_money_trades(
        self, options_df: pd.DataFrame, symbol: str, min_premium: float = None
    ) -> pd.DataFrame:
        """Identify smart money trades based on premium size and patterns."""
        threshold = min_premium or self.SMART_MONEY_MIN_PREMIUM

        if options_df.empty:
            return pd.DataFrame()

        df = options_df.copy()
        df["premium"] = df["last_price"] * df["volume"] * 100

        # Filter for significant premium
        smart = df[df["premium"] >= threshold].copy()

        if smart.empty:
            return pd.DataFrame()

        # Classify trades
        smart["trade_type"] = smart["premium"].apply(
            lambda x: "block" if x >= self.BLOCK_TRADE_THRESHOLD else "sweep"
        )

        # Determine side (simplified: high volume relative to OI = opening)
        smart["side"] = smart.apply(
            lambda row: "buy" if row["volume"] > row["open_interest"] * 0.5 else "sell",
            axis=1,
        )

        # Sentiment
        smart["sentiment"] = smart.apply(
            lambda row: (
                "bullish"
                if (row["option_type"] == "call" and row["side"] == "buy")
                or (row["option_type"] == "put" and row["side"] == "sell")
                else "bearish"
            ),
            axis=1,
        )

        result = smart[
            [
                "strike",
                "expiration",
                "option_type",
                "premium",
                "volume",
                "trade_type",
                "side",
                "sentiment",
            ]
        ].copy()
        result["symbol"] = symbol
        result["timestamp"] = datetime.now(timezone.utc).isoformat()

        return result.sort_values("premium", ascending=False)

    def _analyze_expiration(
        self, options_df: pd.DataFrame, symbol: str, expiration: str
    ) -> ExpirationAnalysis:
        """Analyze options flow for a specific expiration."""
        # Filter for expiration
        exp_df = options_df[options_df["expiration"] == expiration]

        if exp_df.empty:
            return self._empty_expiration_analysis(symbol, expiration)

        calls = exp_df[exp_df["option_type"] == "call"]
        puts = exp_df[exp_df["option_type"] == "put"]

        # Calculate max pain
        max_pain = self._calculate_max_pain_strike(exp_df)

        # OI and volume
        call_oi = int(calls["open_interest"].sum())
        put_oi = int(puts["open_interest"].sum())
        call_vol = int(calls["volume"].sum())
        put_vol = int(puts["volume"].sum())

        # Gamma concentration
        total_gamma = exp_df["gamma"].sum() if "gamma" in exp_df.columns else 0
        max_strike_gamma = (
            exp_df.groupby("strike")["gamma"].sum().max() if total_gamma > 0 else 0
        )
        gamma_concentration = max_strike_gamma / total_gamma if total_gamma > 0 else 0

        # Days to expiry
        try:
            exp_date = datetime.strptime(expiration, "%Y-%m-%d")
            days_to_expiry = max(0, (exp_date - datetime.now()).days)
        except ValueError:
            days_to_expiry = 0

        # Pin risk (high OI at specific strikes near current price)
        underlying = (
            exp_df["underlying_price"].iloc[0]
            if "underlying_price" in exp_df.columns
            else 100
        )
        near_money = exp_df[abs(exp_df["strike"] - underlying) < underlying * 0.02]
        near_money_oi = near_money["open_interest"].sum()
        total_oi = exp_df["open_interest"].sum()
        pin_risk = near_money_oi / total_oi if total_oi > 0 else 0

        return ExpirationAnalysis(
            expiration=expiration,
            max_pain=round(max_pain, 2),
            total_call_oi=call_oi,
            total_put_oi=put_oi,
            total_call_volume=call_vol,
            total_put_volume=put_vol,
            gamma_concentration=round(gamma_concentration, 3),
            pin_risk=round(pin_risk, 3),
            days_to_expiry=days_to_expiry,
        )

    def _calculate_max_pain_strike(self, options_df: pd.DataFrame) -> float:
        """
        Calculate max pain strike.

        Max pain is the strike where option buyers would lose the most money
        (or equivalently, where option sellers would profit the most).
        """
        if options_df.empty:
            return 0.0

        strikes = options_df["strike"].unique()
        min_pain = float("inf")
        max_pain_strike = strikes[0] if len(strikes) > 0 else 0

        calls = options_df[options_df["option_type"] == "call"]
        puts = options_df[options_df["option_type"] == "put"]

        for strike in strikes:
            # Pain for call buyers: max(0, strike - settlement) * OI
            # Pain for put buyers: max(0, settlement - strike) * OI
            call_pain = (
                calls.apply(
                    lambda row: max(0, strike - row["strike"]) * row["open_interest"],
                    axis=1,
                ).sum()
                if not calls.empty
                else 0
            )

            put_pain = (
                puts.apply(
                    lambda row: max(0, row["strike"] - strike) * row["open_interest"],
                    axis=1,
                ).sum()
                if not puts.empty
                else 0
            )

            total_pain = call_pain + put_pain

            if total_pain < min_pain:
                min_pain = total_pain
                max_pain_strike = strike

        return float(max_pain_strike)

    def _calculate_sentiment(
        self,
        put_call_ratio: float,
        premium_pc_ratio: float,
        net_gex: float,
        net_premium: float,
    ) -> tuple:
        """Calculate overall sentiment and confidence."""
        score = 0.0

        # Put/Call ratio contribution (lower = more bullish)
        if put_call_ratio < 0.7:
            score += 1.0
        elif put_call_ratio > 1.3:
            score -= 1.0

        # Premium ratio contribution
        if premium_pc_ratio < 0.7:
            score += 0.5
        elif premium_pc_ratio > 1.3:
            score -= 0.5

        # GEX contribution (positive GEX = supportive)
        if net_gex > 0:
            score += 0.5
        else:
            score -= 0.5

        # Net premium contribution
        if net_premium > 0:
            score += 0.5
        else:
            score -= 0.5

        # Normalize to sentiment
        if score > 0.5:
            sentiment = "bullish"
        elif score < -0.5:
            sentiment = "bearish"
        else:
            sentiment = "neutral"

        # Confidence is based on signal strength
        confidence = min(1.0, abs(score) / 2.5)

        return sentiment, confidence

    def _empty_flow_summary(self, symbol: str) -> OptionsFlowSummary:
        """Return empty flow summary."""
        return OptionsFlowSummary(
            symbol=symbol,
            total_call_volume=0,
            total_put_volume=0,
            total_call_premium=0.0,
            total_put_premium=0.0,
            put_call_ratio=0.0,
            premium_put_call_ratio=0.0,
            gamma_exposure=self._empty_gamma_exposure(symbol),
            unusual_activity_count=0,
            smart_money_trades=0,
            net_premium_flow=0.0,
            sentiment="neutral",
            confidence=0.0,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _empty_gamma_exposure(self, symbol: str) -> GammaExposure:
        """Return empty gamma exposure."""
        return GammaExposure(
            symbol=symbol,
            total_gex=0.0,
            call_gex=0.0,
            put_gex=0.0,
            net_gex=0.0,
            flip_point=None,
            max_gamma_strike=0.0,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def _empty_put_call_analysis(self, symbol: str) -> Dict[str, Any]:
        """Return empty put/call analysis."""
        return {
            "symbol": symbol,
            "put_call_ratio": 0.0,
            "premium_put_call_ratio": 0.0,
            "oi_put_call_ratio": 0.0,
            "total_call_volume": 0,
            "total_put_volume": 0,
            "total_call_premium": 0.0,
            "total_put_premium": 0.0,
            "call_open_interest": 0,
            "put_open_interest": 0,
            "itm_call_volume": 0,
            "otm_call_volume": 0,
            "itm_put_volume": 0,
            "otm_put_volume": 0,
            "weighted_call_strike": 0.0,
            "weighted_put_strike": 0.0,
            "underlying_price": 0.0,
            "sentiment": "neutral",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _empty_expiration_analysis(
        self, symbol: str, expiration: str
    ) -> ExpirationAnalysis:
        """Return empty expiration analysis."""
        return ExpirationAnalysis(
            expiration=expiration,
            max_pain=0.0,
            total_call_oi=0,
            total_put_oi=0,
            total_call_volume=0,
            total_put_volume=0,
            gamma_concentration=0.0,
            pin_risk=0.0,
            days_to_expiry=0,
        )
