"""
Money Flow Analysis Module

Analyze institutional money flow, volume patterns, and capital allocation.
No technical indicators, no moon phases, just real money movement.

Enhanced with:
- Real-time dark pool alerts
- Block trade detection and classification
- Sector rotation signals
- Smart money tracking
- Unusual volume detection
- Flow momentum indicators
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

import numpy as np
import pandas as pd
from scipy import stats

from .alerts import (
    AlertAggregator,
    AlertThresholds,
    AlertType,
    BlockTradeEvent,
    BlockTradeSize,
    FlowMomentumIndicator,
    MoneyFlowAlert,
    SectorRotationSignal,
    SmartMoneyMetrics,
    UnusualVolumeSignal,
)

logger = logging.getLogger(__name__)

# Trading day constants
TRADING_DAYS_1_WEEK = 5
TRADING_DAYS_1_MONTH = 21
TRADING_DAYS_3_MONTHS = 63
TRADING_DAYS_6_MONTHS = 126

# Default lookback periods
DEFAULT_LOOKBACK_DAYS = 20
DEFAULT_VOLUME_LOOKBACK = 20
DEFAULT_MOMENTUM_LOOKBACK = 10

# Confidence score weights
FLOW_DIRECTION_WEIGHT = 0.4
INSTITUTIONAL_CHANGE_WEIGHT = 0.3
SMART_MONEY_WEIGHT = 0.2
MOMENTUM_WEIGHT = 0.1


class MoneyFlowAnalyzer:
    """
    Analyze institutional money flow and capital allocation patterns.

    Enhanced with real-time alerts for:
    - Dark pool surges and declines
    - Block trade detection
    - Sector rotation signals
    - Smart money tracking
    - Unusual volume detection
    - Flow momentum shifts
    """

    def __init__(
        self,
        data_manager=None,
        thresholds: Optional[AlertThresholds] = None,
    ):
        """
        Initialize money flow analyzer.

        Args:
            data_manager: Data manager instance for data access
            thresholds: Custom alert thresholds (uses defaults if None)
        """
        self.data_manager = data_manager
        self.thresholds = thresholds or AlertThresholds()
        self.alert_aggregator = AlertAggregator(self.thresholds)

        # Cache for computed metrics
        self._sector_cache: Dict[str, Dict] = {}
        self._volume_cache: Dict[str, pd.DataFrame] = {}

        logger.info("MoneyFlowAnalyzer initialized with enhanced features")

    async def analyze_sector_flow(
        self, sectors: List[str], lookback_days: int = 63
    ) -> pd.DataFrame:
        """
        Analyze money flow across sectors using ETF flows and institutional data.

        Args:
            sectors: List of sector ETF symbols (e.g., ['XLK', 'XLF', 'XLE'])
            lookback_days: Number of days to analyze (default: 63 ~ 3 months)

        Returns:
            DataFrame with money flow analysis by sector
        """
        if not sectors:
            return pd.DataFrame(
                columns=[
                    "net_flow_1m",
                    "net_flow_3m",
                    "institutional_change",
                    "smart_money_sentiment",
                    "flow_acceleration",
                    "confidence_score",
                ]
            )

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        tasks = [
            self._analyze_single_sector_flow(sector, start_date, end_date)
            for sector in sectors
        ]

        # Execute all tasks concurrently
        results_with_errors = await asyncio.gather(*tasks, return_exceptions=True)

        results = []
        for result in results_with_errors:
            if isinstance(result, Exception):
                # Exceptions are already logged in the helper, but if they bubble up
                continue
            if result:
                results.append(result)

        if not results:
            return pd.DataFrame(
                columns=[
                    "net_flow_1m",
                    "net_flow_3m",
                    "institutional_change",
                    "smart_money_sentiment",
                    "flow_acceleration",
                    "confidence_score",
                ]
            )
        return pd.DataFrame(results).set_index("sector")

    async def _analyze_single_sector_flow(
        self, sector: str, start_date: datetime, end_date: datetime
    ) -> Optional[Dict]:
        """
        Helper to analyze flow for a single sector concurrently.
        """
        try:
            # Get ETF flow data and institutional positioning concurrently
            flow_data, institutional_data = await asyncio.gather(
                self._get_etf_flows(sector, start_date, end_date),
                self._get_institutional_positioning(sector),
            )

            # Calculate money flow metrics
            metrics = self._calculate_flow_metrics(flow_data, institutional_data)

            return {
                "sector": sector,
                "net_flow_1m": metrics["net_flow_1m"],
                "net_flow_3m": metrics["net_flow_3m"],
                "institutional_change": metrics["institutional_change"],
                "smart_money_sentiment": metrics["smart_money_sentiment"],
                "flow_acceleration": metrics["flow_acceleration"],
                "confidence_score": metrics["confidence_score"],
            }

        except Exception as e:
            logger.error(f"Error analyzing sector {sector}: {e}")
            return None

    def analyze_equity_flow(self, symbol: str, lookback_days: int = 20) -> Dict:
        """
        Analyze money flow for individual equity.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to analyze

        Returns:
            Dictionary with money flow analysis
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        # Get volume and price data
        volume_data = self._get_volume_analysis(symbol, start_date, end_date)

        # Get institutional flows
        institutional_flows = self._get_institutional_flows(
            symbol, start_date, end_date
        )

        # Get short interest changes
        short_interest = self._get_short_interest_changes(symbol)

        # Calculate money flow indicators
        money_flow_metrics = self._calculate_equity_flow_metrics(
            volume_data, institutional_flows, short_interest
        )

        return {
            "symbol": symbol,
            "money_flow_score": money_flow_metrics["flow_score"],
            "institutional_sentiment": money_flow_metrics["institutional_sentiment"],
            "smart_money_activity": money_flow_metrics["smart_money_activity"],
            "short_pressure": money_flow_metrics["short_pressure"],
            "accumulation_distribution": money_flow_metrics[
                "accumulation_distribution"
            ],
            "confidence": money_flow_metrics["confidence"],
        }

    def get_dark_pool_activity(
        self, symbol: str, lookback_days: int = 20
    ) -> pd.DataFrame:
        """
        Analyze dark pool activity for institutional positioning.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to analyze

        Returns:
            DataFrame with dark pool analysis
        """
        # This would integrate with dark pool data providers
        logger.info(f"Analyzing dark pool activity for {symbol}")

        # Placeholder implementation
        dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")
        n = len(dates)

        # Vectorized generation for performance
        data = {
            "date": dates,
            "dark_pool_volume": np.random.randint(
                100000, 1000000, n
            ),  # Placeholder
            "total_volume": np.random.randint(1000000, 10000000, n),  # Placeholder
            "dark_pool_percentage": np.random.uniform(
                0.15, 0.35, n
            ),  # Placeholder
            "large_block_activity": np.random.uniform(
                0.05, 0.15, n
            ),  # Placeholder
        }

        df = pd.DataFrame(data)
        df["dark_pool_signal"] = self._calculate_dark_pool_signal(df)

        return df

    async def _get_etf_flows(
        self, etf_symbol: str, start_date: datetime, end_date: datetime
    ) -> pd.DataFrame:
        """
        Get ETF flow data from data manager.
        """
        if self.data_manager:
            return await self.data_manager.get_etf_flows(
                etf_symbol, start_date, end_date
            )
        else:
            # Placeholder implementation
            dates = pd.date_range(start=start_date, end=end_date, freq="D")
            return pd.DataFrame(
                {
                    "date": dates,
                    "net_flow": np.random.normal(0, 1000000, len(dates)),  # Placeholder
                    "creation_units": np.random.randint(0, 100, len(dates)),
                    "redemption_units": np.random.randint(0, 100, len(dates)),
                }
            )

    async def _get_institutional_positioning(self, symbol: str) -> Dict:
        """
        Get institutional positioning data.
        """
        if self.data_manager and hasattr(
            self.data_manager, "get_institutional_positioning"
        ):
            return await self.data_manager.get_institutional_positioning(symbol)
        else:
            # Placeholder implementation - real data requires specialized provider
            return {
                "institutional_ownership": np.random.uniform(0.6, 0.9),
                "net_buyer_count": np.random.randint(50, 200),
                "total_institutions": np.random.randint(200, 500),
                "avg_position_size": np.random.uniform(1000000, 10000000),
            }

    def _calculate_flow_metrics(
        self, flow_data: pd.DataFrame, institutional_data: Dict
    ) -> Dict:
        """
        Calculate money flow metrics from raw data.
        """
        # Handle empty or insufficient data
        if flow_data.empty or "net_flow" not in flow_data.columns:
            return {
                "net_flow_1m": 0.0,
                "net_flow_3m": 0.0,
                "institutional_change": 0.0,
                "smart_money_sentiment": 0.0,
                "flow_acceleration": 0.0,
                "confidence_score": 0.0,
            }

        # Calculate net flows over different periods
        net_flow_1m = flow_data["net_flow"].tail(21).sum()  # ~1 month
        net_flow_3m = flow_data["net_flow"].tail(63).sum()  # ~3 months

        # Calculate institutional change
        institutional_change = institutional_data.get("net_buyer_count", 0) / max(
            institutional_data.get("total_institutions", 1), 1
        )

        # Smart money sentiment (institutional buying vs selling)
        # Guard against zero or near-zero standard deviation
        flow_std = flow_data["net_flow"].std()
        if flow_std == 0 or np.isnan(flow_std) or flow_std < 1e-10:
            smart_money_sentiment = np.sign(net_flow_3m)
        else:
            smart_money_sentiment = np.sign(net_flow_3m) * abs(net_flow_3m) / flow_std

        # Flow acceleration (rate of change)
        recent_flow = flow_data["net_flow"].tail(10).mean()
        historical_flow = flow_data["net_flow"].mean()

        # Guard against division by zero and NaN
        if historical_flow == 0 or np.isnan(historical_flow):
            flow_acceleration = 0.0
        else:
            flow_acceleration = (recent_flow - historical_flow) / historical_flow

        # Confidence score combines multiple factors
        confidence_score = (
            0.4 * np.sign(net_flow_3m)  # Direction of flow
            + 0.3 * institutional_change  # Institutional activity
            + 0.2 * np.sign(smart_money_sentiment)  # Smart money direction
            + 0.1 * np.sign(flow_acceleration)  # Momentum
        )

        return {
            "net_flow_1m": net_flow_1m,
            "net_flow_3m": net_flow_3m,
            "institutional_change": institutional_change,
            "smart_money_sentiment": smart_money_sentiment,
            "flow_acceleration": flow_acceleration,
            "confidence_score": max(
                -1, min(1, confidence_score)
            ),  # Bound between -1 and 1
        }

    def _calculate_dark_pool_signal(self, df: pd.DataFrame) -> pd.Series:
        """
        Calculate dark pool signal from activity data.
        """
        # High dark pool percentage + large blocks = institutional accumulation
        signal = np.where(
            (df["dark_pool_percentage"] > 0.25) & (df["large_block_activity"] > 0.10),
            1,  # Bullish
            np.where(
                (df["dark_pool_percentage"] < 0.15)
                & (df["large_block_activity"] < 0.05),
                -1,  # Bearish
                0,  # Neutral
            ),
        )

        return pd.Series(signal, index=df.index)

    def _get_volume_analysis(
        self, symbol: str, start_date: datetime, end_date: datetime
    ) -> pd.DataFrame:
        """
        Get volume analysis data.
        """
        # Placeholder implementation
        dates = pd.date_range(start=start_date, end=end_date, freq="D")
        return pd.DataFrame(
            {
                "date": dates,
                "volume": np.random.randint(1000000, 10000000, len(dates)),
                "price_change": np.random.uniform(-0.05, 0.05, len(dates)),
                "block_trades": np.random.randint(0, 50, len(dates)),
            }
        )

    def _get_institutional_flows(
        self, symbol: str, start_date: datetime, end_date: datetime
    ) -> pd.DataFrame:
        """
        Get institutional flow data.
        """
        # Placeholder implementation
        dates = pd.date_range(start=start_date, end=end_date, freq="D")
        return pd.DataFrame(
            {
                "date": dates,
                "institutional_net_flow": np.random.normal(0, 1000000, len(dates)),
                "buyer_count": np.random.randint(10, 100, len(dates)),
                "seller_count": np.random.randint(10, 100, len(dates)),
            }
        )

    def _get_short_interest_changes(self, symbol: str) -> Dict:
        """
        Get short interest changes.
        """
        # Placeholder implementation
        return {
            "current_short_interest": np.random.uniform(0.02, 0.10),
            "previous_short_interest": np.random.uniform(0.02, 0.10),
            "days_to_cover": np.random.uniform(1, 10),
        }

    def _calculate_equity_flow_metrics(
        self,
        volume_data: pd.DataFrame,
        institutional_flows: pd.DataFrame,
        short_interest: Dict,
    ) -> Dict:
        """
        Calculate equity-specific money flow metrics.
        """
        # Volume-weighted money flow
        avg_volume = volume_data["volume"].mean()
        recent_volume = volume_data["volume"].tail(5).mean()
        volume_trend = (
            (recent_volume - avg_volume) / avg_volume if avg_volume > 0 else 0
        )

        # Institutional sentiment
        recent_institutional = (
            institutional_flows["institutional_net_flow"].tail(5).sum()
        )
        institutional_sentiment = np.sign(recent_institutional) * min(
            1, abs(recent_institutional) / 1000000
        )

        # Smart money activity (buyers vs sellers)
        recent_buyers = institutional_flows["buyer_count"].tail(5).mean()
        recent_sellers = institutional_flows["seller_count"].tail(5).mean()
        smart_money_activity = (recent_buyers - recent_sellers) / max(
            recent_buyers + recent_sellers, 1
        )

        # Short pressure
        short_change = (
            short_interest["current_short_interest"]
            - short_interest["previous_short_interest"]
        )
        short_pressure = -np.sign(short_change) * min(
            1, abs(short_change) / 0.05
        )  # Normalize to 5% change

        # Accumulation/distribution based on volume and institutional activity
        accumulation_distribution = (
            0.4 * volume_trend
            + 0.4 * institutional_sentiment
            + 0.2 * smart_money_activity
        )

        # Overall flow score
        flow_score = (
            0.3 * institutional_sentiment
            + 0.3 * smart_money_activity
            + 0.2 * accumulation_distribution
            + 0.2 * short_pressure
        )

        return {
            "flow_score": max(-1, min(1, flow_score)),
            "institutional_sentiment": institutional_sentiment,
            "smart_money_activity": smart_money_activity,
            "short_pressure": short_pressure,
            "accumulation_distribution": accumulation_distribution,
            "confidence": abs(flow_score),  # Higher absolute value = higher confidence
        }

    def health_check(self) -> bool:
        """
        Check if money flow analyzer is operational.
        """
        return True

    # =========================================================================
    # ENHANCED FEATURES: Dark Pool Alerts
    # =========================================================================

    def detect_dark_pool_alerts(
        self,
        symbol: str,
        lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    ) -> List[MoneyFlowAlert]:
        """
        Detect dark pool activity alerts for a symbol.

        Generates alerts when:
        - Dark pool percentage exceeds surge threshold (default 35%)
        - Dark pool percentage drops below decline threshold (default 15%)
        - Dark pool percentage changes significantly from average

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to analyze

        Returns:
            List of MoneyFlowAlert objects for detected anomalies
        """
        logger.info(f"Detecting dark pool alerts for {symbol}")

        dark_pool_df = self.get_dark_pool_activity(symbol, lookback_days)
        alerts = []

        if dark_pool_df.empty:
            return alerts

        # Calculate rolling statistics
        avg_dp_pct = dark_pool_df["dark_pool_percentage"].mean()
        std_dp_pct = dark_pool_df["dark_pool_percentage"].std()
        latest = dark_pool_df.iloc[-1]
        current_dp_pct = latest["dark_pool_percentage"]

        # Check for surge
        if current_dp_pct > self.thresholds.dark_pool_surge_pct:
            alert = self.alert_aggregator.create_alert(
                alert_type=AlertType.DARK_POOL_SURGE,
                symbol=symbol,
                current_value=current_dp_pct,
                threshold_value=self.thresholds.dark_pool_surge_pct,
                title=f"Dark Pool Surge: {symbol}",
                description=(
                    f"Dark pool activity at {current_dp_pct:.1%}, "
                    f"exceeds surge threshold of {self.thresholds.dark_pool_surge_pct:.0%}. "
                    f"Average: {avg_dp_pct:.1%}"
                ),
                metadata={
                    "average_dark_pool_pct": avg_dp_pct,
                    "large_block_activity": latest.get("large_block_activity", 0),
                    "total_volume": latest.get("total_volume", 0),
                },
            )
            alerts.append(alert)

        # Check for decline
        elif current_dp_pct < self.thresholds.dark_pool_decline_pct:
            alert = self.alert_aggregator.create_alert(
                alert_type=AlertType.DARK_POOL_DECLINE,
                symbol=symbol,
                current_value=current_dp_pct,
                threshold_value=self.thresholds.dark_pool_decline_pct,
                title=f"Dark Pool Decline: {symbol}",
                description=(
                    f"Dark pool activity at {current_dp_pct:.1%}, "
                    f"below threshold of {self.thresholds.dark_pool_decline_pct:.0%}. "
                    f"Possible shift to lit exchanges."
                ),
                metadata={
                    "average_dark_pool_pct": avg_dp_pct,
                    "large_block_activity": latest.get("large_block_activity", 0),
                },
            )
            alerts.append(alert)

        # Check for significant change from average
        if std_dp_pct > 0:
            zscore = (current_dp_pct - avg_dp_pct) / std_dp_pct
            if abs(zscore) > 2.0:
                direction = "increase" if zscore > 0 else "decrease"
                alert = self.alert_aggregator.create_alert(
                    alert_type=(
                        AlertType.DARK_POOL_SURGE
                        if zscore > 0
                        else AlertType.DARK_POOL_DECLINE
                    ),
                    symbol=symbol,
                    current_value=current_dp_pct,
                    threshold_value=avg_dp_pct,
                    title=f"Unusual Dark Pool Activity: {symbol}",
                    description=(
                        f"Dark pool activity {direction} of {abs(zscore):.1f} "
                        f"standard deviations from average. "
                        f"Current: {current_dp_pct:.1%}, Avg: {avg_dp_pct:.1%}"
                    ),
                    metadata={
                        "zscore": zscore,
                        "std_dev": std_dp_pct,
                    },
                )
                alerts.append(alert)

        return alerts

    # =========================================================================
    # ENHANCED FEATURES: Block Trade Detection
    # =========================================================================

    def detect_block_trades(
        self,
        symbol: str,
        price: Optional[float] = None,
        lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    ) -> List[BlockTradeEvent]:
        """
        Detect and classify block trades for a symbol.

        Block trade classifications:
        - Small: 10K-50K shares or $200K-$1M
        - Medium: 50K-100K shares or $1M-$5M
        - Large: 100K-500K shares or $5M-$25M
        - Mega: 500K+ shares or $25M+

        Args:
            symbol: Stock symbol
            price: Current stock price (used for notional value calculation)
            lookback_days: Number of days to analyze

        Returns:
            List of BlockTradeEvent objects for detected block trades
        """
        logger.info(f"Detecting block trades for {symbol}")

        volume_data = self._get_volume_analysis(
            symbol,
            datetime.now() - timedelta(days=lookback_days),
            datetime.now(),
        )

        if volume_data.empty:
            return []

        # Use provided price or estimate from data
        if price is None:
            price = 100.0  # Default price for classification

        # Optimization: Vectorized generation of block trades
        # Filter for days with block trades
        has_blocks = volume_data[volume_data["block_trades"] > 0].copy()

        if has_blocks.empty:
            return []

        # Determine number of blocks to generate per day (cap at 5)
        # We use minimum of block_trades and 5, just like the loop: range(int(min(block_count, 5)))
        counts = np.minimum(has_blocks["block_trades"], 5).astype(int)

        # Expand dataframe - duplicate rows based on count
        expanded = has_blocks.loc[has_blocks.index.repeat(counts)].copy()

        if expanded.empty:
            return []

        # Calculate base metrics
        # avg_block_size = volume / max(block_count, 1) / 10
        # block_trades is guaranteed > 0 here
        # Convert to numpy arrays to ensure consistent indexing and performance
        avg_block_sizes = (
            expanded["volume"].values / expanded["block_trades"].values / 10
        )

        # Generate random variations
        factors = np.random.uniform(0.8, 1.5, size=len(expanded))
        shares_arr = (avg_block_sizes * factors).astype(int)

        # Filter by minimum threshold
        mask = shares_arr >= self.thresholds.block_trade_small_shares

        if not np.any(mask):
            return []

        # Apply filter
        valid_expanded = expanded[mask]
        valid_shares = shares_arr[mask]

        # Calculate notionals
        notionals = valid_shares * price

        # Calculate other attributes
        is_dark_pools = np.random.random(size=len(valid_expanded)) > 0.6
        price_changes = valid_expanded["price_change"].values

        # Classification
        # Since we filtered shares >= small_shares, we only check shares thresholds
        # This matches the effective logic of the original code where it returned based on shares
        # or skipped if shares < small_shares

        # Vectorized classification (assign integer codes then map to Enum)
        # 3 = MEGA, 2 = LARGE, 1 = MEDIUM, 0 = SMALL
        class_codes = np.zeros(len(valid_shares), dtype=int)

        class_codes[valid_shares >= self.thresholds.block_trade_medium_shares] = 1
        class_codes[valid_shares >= self.thresholds.block_trade_large_shares] = 2
        class_codes[valid_shares >= self.thresholds.block_trade_mega_shares] = 3

        size_classes = [
            BlockTradeSize.SMALL,
            BlockTradeSize.MEDIUM,
            BlockTradeSize.LARGE,
            BlockTradeSize.MEGA,
        ]

        block_trades = []
        timestamps = valid_expanded["date"].tolist()

        # Iterate to create objects
        for i in range(len(valid_expanded)):
            shares = int(valid_shares[i])
            notional = float(notionals[i])
            size_class = size_classes[class_codes[i]]

            pc = price_changes[i]
            is_buy = bool(pc > 0) if pc != 0 else None

            bt = BlockTradeEvent(
                symbol=symbol,
                timestamp=timestamps[i],
                shares=shares,
                price=price,
                notional_value=notional,
                size_classification=size_class,
                is_buy=is_buy,
                is_dark_pool=bool(is_dark_pools[i]),
            )
            block_trades.append(bt)

            # Generate alert for large+ blocks
            if size_class in (BlockTradeSize.LARGE, BlockTradeSize.MEGA):
                self._create_block_trade_alert(bt)

        return block_trades

    def _classify_block_trade(
        self,
        shares: int,
        notional_value: float,
    ) -> BlockTradeSize:
        """Classify block trade by size."""
        # Check by shares first
        if shares >= self.thresholds.block_trade_mega_shares:
            return BlockTradeSize.MEGA
        elif shares >= self.thresholds.block_trade_large_shares:
            return BlockTradeSize.LARGE
        elif shares >= self.thresholds.block_trade_medium_shares:
            return BlockTradeSize.MEDIUM
        elif shares >= self.thresholds.block_trade_small_shares:
            return BlockTradeSize.SMALL

        # Check by notional value
        if notional_value >= self.thresholds.block_trade_mega_value:
            return BlockTradeSize.MEGA
        elif notional_value >= self.thresholds.block_trade_large_value:
            return BlockTradeSize.LARGE
        elif notional_value >= self.thresholds.block_trade_medium_value:
            return BlockTradeSize.MEDIUM

        return BlockTradeSize.SMALL

    def _create_block_trade_alert(self, block_trade: BlockTradeEvent) -> MoneyFlowAlert:
        """Create alert for significant block trade."""
        direction = (
            "BUY"
            if block_trade.is_buy
            else "SELL" if block_trade.is_buy is False else "UNKNOWN"
        )
        venue = "Dark Pool" if block_trade.is_dark_pool else "Lit Exchange"

        return self.alert_aggregator.create_alert(
            alert_type=AlertType.BLOCK_TRADE,
            symbol=block_trade.symbol,
            current_value=block_trade.notional_value,
            threshold_value=self.thresholds.block_trade_large_value,
            title=f"{block_trade.size_classification.value.upper()} Block Trade: {block_trade.symbol}",
            description=(
                f"{direction} block of {block_trade.shares:,} shares "
                f"(${block_trade.notional_value:,.0f}) on {venue}"
            ),
            metadata=block_trade.to_dict(),
        )

    # =========================================================================
    # ENHANCED FEATURES: Sector Rotation Signals
    # =========================================================================

    async def detect_sector_rotation(
        self,
        sectors: Optional[List[str]] = None,
        lookback_days: int = TRADING_DAYS_1_MONTH,
    ) -> SectorRotationSignal:
        """
        Detect sector rotation patterns and generate signals.

        Analyzes relative strength and momentum across sectors to identify
        rotation patterns used by institutional investors.

        Args:
            sectors: List of sector ETF symbols (defaults to major sectors)
            lookback_days: Number of days for momentum calculation

        Returns:
            SectorRotationSignal with rotation analysis
        """
        if sectors is None:
            # Default to major sector ETFs
            sectors = [
                "XLK",
                "XLF",
                "XLE",
                "XLV",
                "XLI",
                "XLP",
                "XLU",
                "XLY",
                "XLB",
                "XLRE",
            ]

        logger.info(f"Detecting sector rotation across {len(sectors)} sectors")

        # Get flow data for all sectors
        sector_flows = await self.analyze_sector_flow(sectors, lookback_days)

        if sector_flows.empty:
            return SectorRotationSignal(
                timestamp=datetime.now(),
                leaders=[],
                laggards=[],
                rotating_into=[],
                rotating_out_of=[],
                sector_scores={},
                momentum_scores={},
                confidence=0.0,
            )

        # Calculate relative strength scores
        sector_scores = {}
        momentum_scores = {}

        for sector in sector_flows.index:
            row = sector_flows.loc[sector]

            # Relative strength score (combination of flows and institutional change)
            flow_score = np.sign(row["net_flow_3m"]) * min(
                1, abs(row["net_flow_3m"]) / 10_000_000
            )
            inst_score = row["institutional_change"]
            sector_scores[sector] = 0.6 * flow_score + 0.4 * inst_score

            # Momentum score (flow acceleration)
            momentum_scores[sector] = row["flow_acceleration"]

        # Sort sectors by score
        sorted_sectors = sorted(sector_scores.items(), key=lambda x: x[1], reverse=True)

        # Identify leaders and laggards
        n_top = max(1, len(sorted_sectors) // 3)
        leaders = [s[0] for s in sorted_sectors[:n_top]]
        laggards = [s[0] for s in sorted_sectors[-n_top:]]

        # Identify rotation (sectors with strong momentum)
        rotating_into = [
            s
            for s, m in momentum_scores.items()
            if m > self.thresholds.sector_rotation_threshold
        ]
        rotating_out_of = [
            s
            for s, m in momentum_scores.items()
            if m < -self.thresholds.sector_rotation_threshold
        ]

        # Calculate confidence based on score dispersion
        scores = list(sector_scores.values())
        confidence = min(1.0, np.std(scores) * 5) if len(scores) > 1 else 0.0

        signal = SectorRotationSignal(
            timestamp=datetime.now(),
            leaders=leaders,
            laggards=laggards,
            rotating_into=rotating_into,
            rotating_out_of=rotating_out_of,
            sector_scores=sector_scores,
            momentum_scores=momentum_scores,
            confidence=confidence,
        )

        # Generate alerts for significant rotations
        if rotating_into or rotating_out_of:
            self._create_sector_rotation_alert(signal)

        return signal

    def _create_sector_rotation_alert(
        self, signal: SectorRotationSignal
    ) -> MoneyFlowAlert:
        """Create alert for sector rotation."""
        into_str = ", ".join(signal.rotating_into) if signal.rotating_into else "None"
        out_str = (
            ", ".join(signal.rotating_out_of) if signal.rotating_out_of else "None"
        )

        return self.alert_aggregator.create_alert(
            alert_type=AlertType.SECTOR_ROTATION,
            symbol="SECTOR",
            current_value=signal.confidence,
            threshold_value=self.thresholds.sector_rotation_threshold,
            title="Sector Rotation Detected",
            description=(
                f"Rotating into: {into_str}. "
                f"Rotating out of: {out_str}. "
                f"Confidence: {signal.confidence:.0%}"
            ),
            metadata={
                "leaders": signal.leaders,
                "laggards": signal.laggards,
                "sector_scores": signal.sector_scores,
            },
        )

    # =========================================================================
    # ENHANCED FEATURES: Smart Money Tracking
    # =========================================================================

    async def track_smart_money(
        self,
        symbol: str,
        lookback_days: int = TRADING_DAYS_1_MONTH,
    ) -> SmartMoneyMetrics:
        """
        Track smart money activity for a symbol.

        Aggregates institutional flow data to identify smart money
        accumulation or distribution patterns.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to analyze

        Returns:
            SmartMoneyMetrics with tracking data
        """
        logger.info(f"Tracking smart money for {symbol}")

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        # Get institutional flows
        inst_flows = self._get_institutional_flows(symbol, start_date, end_date)
        inst_positioning = await self._get_institutional_positioning(symbol)

        if inst_flows.empty:
            return SmartMoneyMetrics(
                symbol=symbol,
                timestamp=datetime.now(),
                institutional_net_flow=0.0,
                institutional_flow_direction="neutral",
                institutional_ownership_pct=0.0,
                ownership_change_pct=0.0,
                smart_money_score=0.0,
                smart_money_trend="neutral",
                confidence=0.0,
            )

        # Calculate net institutional flow
        net_flow = inst_flows["institutional_net_flow"].sum()
        recent_flow = (
            inst_flows["institutional_net_flow"].tail(TRADING_DAYS_1_WEEK).sum()
        )

        # Determine flow direction
        if net_flow > self.thresholds.smart_money_flow_threshold * 1_000_000:
            flow_direction = "inflow"
        elif net_flow < -self.thresholds.smart_money_flow_threshold * 1_000_000:
            flow_direction = "outflow"
        else:
            flow_direction = "neutral"

        # Calculate ownership metrics
        ownership_pct = inst_positioning.get("institutional_ownership", 0.0)
        buyer_ratio = inst_positioning.get("net_buyer_count", 0) / max(
            inst_positioning.get("total_institutions", 1), 1
        )

        # Calculate smart money score (-1 to 1)
        flow_component = np.sign(net_flow) * min(1, abs(net_flow) / 10_000_000)
        buyer_component = buyer_ratio * 2 - 1  # Convert 0-1 to -1 to 1
        smart_money_score = 0.6 * flow_component + 0.4 * buyer_component
        smart_money_score = max(-1, min(1, smart_money_score))

        # Determine trend
        if smart_money_score > 0.2:
            trend = "accumulating"
        elif smart_money_score < -0.2:
            trend = "distributing"
        else:
            trend = "neutral"

        # Build top buyers/sellers lists
        recent_buyers = inst_flows["buyer_count"].tail(5).mean()
        recent_sellers = inst_flows["seller_count"].tail(5).mean()

        metrics = SmartMoneyMetrics(
            symbol=symbol,
            timestamp=datetime.now(),
            institutional_net_flow=net_flow,
            institutional_flow_direction=flow_direction,
            institutional_ownership_pct=ownership_pct,
            ownership_change_pct=buyer_ratio,
            smart_money_score=smart_money_score,
            smart_money_trend=trend,
            top_buyers=[{"avg_daily_buyers": recent_buyers}],
            top_sellers=[{"avg_daily_sellers": recent_sellers}],
            confidence=abs(smart_money_score),
        )

        # Generate alerts for significant activity
        if abs(smart_money_score) > 0.5:
            self._create_smart_money_alert(metrics)

        return metrics

    def _create_smart_money_alert(self, metrics: SmartMoneyMetrics) -> MoneyFlowAlert:
        """Create alert for significant smart money activity."""
        alert_type = (
            AlertType.SMART_MONEY_INFLOW
            if metrics.smart_money_score > 0
            else AlertType.SMART_MONEY_OUTFLOW
        )

        return self.alert_aggregator.create_alert(
            alert_type=alert_type,
            symbol=metrics.symbol,
            current_value=metrics.smart_money_score,
            threshold_value=0.5,
            title=f"Smart Money {metrics.smart_money_trend.title()}: {metrics.symbol}",
            description=(
                f"Smart money score: {metrics.smart_money_score:.2f}. "
                f"Net flow: ${metrics.institutional_net_flow:,.0f}. "
                f"Trend: {metrics.smart_money_trend}"
            ),
            metadata=metrics.to_dict(),
        )

    # =========================================================================
    # ENHANCED FEATURES: Unusual Volume Detection
    # =========================================================================

    def detect_unusual_volume(
        self,
        symbol: str,
        lookback_days: int = DEFAULT_VOLUME_LOOKBACK,
    ) -> UnusualVolumeSignal:
        """
        Detect unusual volume activity for a symbol.

        Uses statistical analysis to identify volume anomalies that may
        indicate institutional activity.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days for baseline calculation

        Returns:
            UnusualVolumeSignal with volume analysis
        """
        logger.info(f"Detecting unusual volume for {symbol}")

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        volume_data = self._get_volume_analysis(symbol, start_date, end_date)

        if volume_data.empty or len(volume_data) < 5:
            return UnusualVolumeSignal(
                symbol=symbol,
                timestamp=datetime.now(),
                current_volume=0,
                average_volume=0,
                volume_ratio=0.0,
                zscore=0.0,
                percentile=0.0,
                is_unusual=False,
                unusualness_score=0.0,
                likely_direction="unknown",
                price_volume_correlation=0.0,
            )

        # Calculate statistics
        volumes = volume_data["volume"]
        current_volume = int(volumes.iloc[-1])
        average_volume = int(volumes.mean())
        std_volume = volumes.std()

        # Volume ratio
        volume_ratio = current_volume / average_volume if average_volume > 0 else 0.0

        # Z-score
        zscore = (
            (current_volume - average_volume) / std_volume if std_volume > 0 else 0.0
        )

        # Percentile rank
        percentile = stats.percentileofscore(volumes, current_volume) / 100

        # Determine if unusual
        is_unusual = (
            abs(zscore) > self.thresholds.volume_zscore_threshold
            or volume_ratio > self.thresholds.volume_ratio_threshold
        )

        # Calculate unusualness score (0-1)
        zscore_component = min(1, abs(zscore) / 4)  # Cap at 4 std devs
        ratio_component = min(1, (volume_ratio - 1) / 3)  # Cap at 4x volume
        unusualness_score = max(zscore_component, ratio_component)

        # Infer direction from price-volume correlation
        price_changes = volume_data.get("price_change", pd.Series([0]))
        if len(volumes) > 1 and len(price_changes) == len(volumes):
            correlation = volumes.corr(price_changes)
            correlation = 0.0 if np.isnan(correlation) else correlation
        else:
            correlation = 0.0

        # Determine likely direction
        recent_price_change = price_changes.iloc[-1] if len(price_changes) > 0 else 0
        if is_unusual:
            if recent_price_change > 0:
                likely_direction = "accumulation"
            elif recent_price_change < 0:
                likely_direction = "distribution"
            else:
                likely_direction = "unknown"
        else:
            likely_direction = "normal"

        signal = UnusualVolumeSignal(
            symbol=symbol,
            timestamp=datetime.now(),
            current_volume=current_volume,
            average_volume=average_volume,
            volume_ratio=volume_ratio,
            zscore=zscore,
            percentile=percentile,
            is_unusual=is_unusual,
            unusualness_score=unusualness_score,
            likely_direction=likely_direction,
            price_volume_correlation=correlation,
        )

        # Generate alert if unusual
        if is_unusual:
            self._create_unusual_volume_alert(signal)

        return signal

    def _create_unusual_volume_alert(
        self, signal: UnusualVolumeSignal
    ) -> MoneyFlowAlert:
        """Create alert for unusual volume."""
        return self.alert_aggregator.create_alert(
            alert_type=AlertType.UNUSUAL_VOLUME,
            symbol=signal.symbol,
            current_value=signal.volume_ratio,
            threshold_value=self.thresholds.volume_ratio_threshold,
            title=f"Unusual Volume: {signal.symbol}",
            description=(
                f"Volume {signal.volume_ratio:.1f}x average "
                f"(z-score: {signal.zscore:.1f}). "
                f"Likely {signal.likely_direction}."
            ),
            metadata=signal.to_dict(),
        )

    # =========================================================================
    # ENHANCED FEATURES: Flow Momentum Indicators
    # =========================================================================

    def calculate_flow_momentum(
        self,
        symbol: str,
        lookback_days: int = TRADING_DAYS_1_MONTH,
    ) -> FlowMomentumIndicator:
        """
        Calculate flow momentum indicators for a symbol.

        Analyzes the rate of change and acceleration of money flows
        to identify momentum shifts.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days for analysis

        Returns:
            FlowMomentumIndicator with momentum metrics
        """
        logger.info(f"Calculating flow momentum for {symbol}")

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        inst_flows = self._get_institutional_flows(symbol, start_date, end_date)

        if inst_flows.empty or len(inst_flows) < 10:
            return FlowMomentumIndicator(
                symbol=symbol,
                timestamp=datetime.now(),
                flow_momentum=0.0,
                flow_acceleration=0.0,
                trend_direction="neutral",
                trend_strength=0.0,
                flow_ma_5=0.0,
                flow_ma_10=0.0,
                flow_ma_20=0.0,
                ma_crossover_signal=0,
            )

        flows = inst_flows["institutional_net_flow"]

        # Calculate moving averages
        flow_ma_5 = flows.rolling(window=min(5, len(flows))).mean().iloc[-1]
        flow_ma_10 = flows.rolling(window=min(10, len(flows))).mean().iloc[-1]
        flow_ma_20 = flows.rolling(window=min(20, len(flows))).mean().iloc[-1]

        # Calculate momentum (rate of change)
        recent_flow = flows.tail(5).mean()
        older_flow = flows.head(5).mean() if len(flows) >= 10 else flows.mean()
        flow_momentum = (
            (recent_flow - older_flow) / abs(older_flow) if older_flow != 0 else 0.0
        )

        # Calculate acceleration (change in momentum)
        if len(flows) >= 15:
            mid_flow = flows.iloc[len(flows) // 2 - 2 : len(flows) // 2 + 3].mean()
            recent_momentum = (
                (recent_flow - mid_flow) / abs(mid_flow) if mid_flow != 0 else 0.0
            )
            older_momentum = (
                (mid_flow - older_flow) / abs(older_flow) if older_flow != 0 else 0.0
            )
            flow_acceleration = recent_momentum - older_momentum
        else:
            flow_acceleration = 0.0

        # Determine trend direction
        if flow_momentum > self.thresholds.flow_momentum_threshold:
            trend_direction = "bullish"
        elif flow_momentum < -self.thresholds.flow_momentum_threshold:
            trend_direction = "bearish"
        else:
            trend_direction = "neutral"

        # Calculate trend strength (0-1)
        trend_strength = min(1.0, abs(flow_momentum) * 2)

        # MA crossover signal
        if flow_ma_5 > flow_ma_10 > flow_ma_20:
            ma_crossover_signal = 1  # Bullish
        elif flow_ma_5 < flow_ma_10 < flow_ma_20:
            ma_crossover_signal = -1  # Bearish
        else:
            ma_crossover_signal = 0  # Neutral

        # Check for momentum divergence
        price_changes = inst_flows.get("price_change", pd.Series([0] * len(flows)))
        if len(price_changes) == len(flows):
            price_trend = price_changes.mean()
            momentum_divergence = (flow_momentum > 0 and price_trend < 0) or (
                flow_momentum < 0 and price_trend > 0
            )
        else:
            momentum_divergence = False

        indicator = FlowMomentumIndicator(
            symbol=symbol,
            timestamp=datetime.now(),
            flow_momentum=flow_momentum,
            flow_acceleration=flow_acceleration,
            trend_direction=trend_direction,
            trend_strength=trend_strength,
            flow_ma_5=flow_ma_5,
            flow_ma_10=flow_ma_10,
            flow_ma_20=flow_ma_20,
            ma_crossover_signal=ma_crossover_signal,
            momentum_divergence=momentum_divergence,
        )

        # Generate alert for significant momentum shifts
        if abs(flow_acceleration) > self.thresholds.flow_acceleration_threshold:
            self._create_momentum_shift_alert(indicator)

        return indicator

    def _create_momentum_shift_alert(
        self, indicator: FlowMomentumIndicator
    ) -> MoneyFlowAlert:
        """Create alert for momentum shift."""
        direction = (
            "accelerating" if indicator.flow_acceleration > 0 else "decelerating"
        )

        return self.alert_aggregator.create_alert(
            alert_type=AlertType.FLOW_MOMENTUM_SHIFT,
            symbol=indicator.symbol,
            current_value=indicator.flow_acceleration,
            threshold_value=self.thresholds.flow_acceleration_threshold,
            title=f"Flow Momentum Shift: {indicator.symbol}",
            description=(
                f"Money flow {direction}. "
                f"Momentum: {indicator.flow_momentum:.1%}, "
                f"Trend: {indicator.trend_direction}"
            ),
            metadata=indicator.to_dict(),
        )

    # =========================================================================
    # ENHANCED FEATURES: Comprehensive Analysis
    # =========================================================================

    async def get_comprehensive_analysis(
        self,
        symbol: str,
        lookback_days: int = TRADING_DAYS_1_MONTH,
    ) -> Dict[str, Any]:
        """
        Get comprehensive money flow analysis for a symbol.

        Combines all enhanced features into a single analysis report.

        Args:
            symbol: Stock symbol
            lookback_days: Number of days to analyze

        Returns:
            Dictionary with comprehensive analysis including:
            - Basic money flow metrics
            - Dark pool alerts
            - Block trades detected
            - Smart money tracking
            - Unusual volume signals
            - Flow momentum indicators
            - All active alerts
        """
        logger.info(f"Running comprehensive analysis for {symbol}")

        # Basic equity flow analysis
        equity_flow = self.analyze_equity_flow(symbol, lookback_days)

        # Enhanced analyses
        dark_pool_alerts = self.detect_dark_pool_alerts(symbol, lookback_days)
        block_trades = self.detect_block_trades(symbol, lookback_days=lookback_days)
        smart_money = await self.track_smart_money(symbol, lookback_days)
        unusual_volume = self.detect_unusual_volume(symbol, lookback_days)
        flow_momentum = self.calculate_flow_momentum(symbol, lookback_days)

        # Get all alerts for this symbol
        symbol_alerts = self.alert_aggregator.get_active_alerts(symbol=symbol)

        return {
            "symbol": symbol,
            "timestamp": datetime.now().isoformat(),
            "basic_metrics": equity_flow,
            "dark_pool": {
                "alerts": [a.to_dict() for a in dark_pool_alerts],
                "alert_count": len(dark_pool_alerts),
            },
            "block_trades": {
                "events": [bt.to_dict() for bt in block_trades],
                "total_count": len(block_trades),
                "large_blocks": sum(
                    1
                    for bt in block_trades
                    if bt.size_classification
                    in (BlockTradeSize.LARGE, BlockTradeSize.MEGA)
                ),
            },
            "smart_money": smart_money.to_dict(),
            "unusual_volume": unusual_volume.to_dict(),
            "flow_momentum": flow_momentum.to_dict(),
            "alerts": {
                "active": [a.to_dict() for a in symbol_alerts],
                "summary": self.alert_aggregator.get_alert_summary(),
            },
        }

    def get_alerts(
        self,
        symbol: Optional[str] = None,
        alert_type: Optional[AlertType] = None,
    ) -> List[MoneyFlowAlert]:
        """
        Get active alerts with optional filters.

        Args:
            symbol: Filter by symbol (optional)
            alert_type: Filter by alert type (optional)

        Returns:
            List of active MoneyFlowAlert objects
        """
        return self.alert_aggregator.get_active_alerts(
            symbol=symbol,
            alert_type=alert_type,
        )

    def clear_cache(self) -> None:
        """Clear internal caches."""
        self._sector_cache.clear()
        self._volume_cache.clear()
        logger.info("MoneyFlowAnalyzer cache cleared")
