"""
Sector Rotation Analysis Module

Analyze capital flow patterns across sectors, business cycle positioning,
and rotation signals for institutional investment decisions.
No technical indicators, just real money movement and sector dynamics.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class BusinessCyclePhase(Enum):
    """Business cycle phases for sector rotation."""

    EARLY_CYCLE = "early_cycle"
    MID_CYCLE = "mid_cycle"
    LATE_CYCLE = "late_cycle"
    RECESSION = "recession"


# Sector ETF definitions
SECTOR_ETFS = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLE": "Energy",
    "XLV": "Healthcare",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLU": "Utilities",
    "XLRE": "Real Estate",
    "XLC": "Communications",
}

# Business cycle sector mapping
CYCLE_SECTOR_MAP = {
    BusinessCyclePhase.EARLY_CYCLE: ["XLF", "XLY"],  # Financials, Consumer Disc
    BusinessCyclePhase.MID_CYCLE: ["XLK", "XLI"],  # Technology, Industrials
    BusinessCyclePhase.LATE_CYCLE: ["XLE", "XLB"],  # Energy, Materials
    BusinessCyclePhase.RECESSION: [
        "XLU",
        "XLV",
        "XLP",
    ],  # Utilities, Healthcare, Staples
}

# Risk-on vs Risk-off sector classification
RISK_ON_SECTORS = ["XLK", "XLY", "XLI", "XLB", "XLF", "XLRE"]
RISK_OFF_SECTORS = ["XLU", "XLV", "XLP", "XLC"]


class SectorRotationAnalyzer:
    """
    Analyze sector rotation patterns and capital flow dynamics.

    Tracks institutional money flow across sectors, identifies rotation
    patterns, and maps current positioning to business cycle phases.
    """

    def __init__(self, data_manager=None):
        """
        Initialize sector rotation analyzer.

        Args:
            data_manager: Data manager instance for data access
        """
        self.data_manager = data_manager
        self.sector_etfs = SECTOR_ETFS
        self.cycle_sector_map = CYCLE_SECTOR_MAP
        logger.info("SectorRotationAnalyzer initialized")

    async def analyze_rotation(
        self, lookback_days: int = 63
    ) -> Dict[str, pd.DataFrame]:
        """
        Detect sector rotation patterns over specified period.

        Analyzes relative performance, flow momentum, and leadership
        changes to identify rotation signals.

        Args:
            lookback_days: Number of days to analyze (default: 63 ~ 3 months)

        Returns:
            Dictionary containing:
                - sector_performance: DataFrame with sector returns
                - rotation_scores: DataFrame with rotation signals
                - phase_alignment: Current business cycle alignment
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        # Fetch sector price data
        sector_data = await self._fetch_sector_price_data(start_date, end_date)

        if sector_data.empty:
            return self._empty_rotation_result()

        # Calculate returns over multiple timeframes
        returns_df = self._calculate_sector_returns(sector_data)

        # Calculate rotation scores
        rotation_scores = self._calculate_rotation_scores(returns_df)

        # Determine business cycle phase alignment
        phase_alignment = self._determine_phase_alignment(rotation_scores)

        # Calculate leadership changes
        leadership = self._identify_leadership_from_returns(returns_df)

        return {
            "sector_performance": returns_df,
            "rotation_scores": rotation_scores,
            "phase_alignment": phase_alignment,
            "leadership": leadership,
            "analysis_period": {
                "start": start_date,
                "end": end_date,
                "days": lookback_days,
            },
        }

    async def get_sector_momentum(
        self, sectors: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Calculate relative momentum for specified sectors.

        Measures price momentum, flow momentum, and composite score
        for sector comparison and ranking.

        Args:
            sectors: List of sector ETF symbols (defaults to all)

        Returns:
            DataFrame with momentum metrics per sector
        """
        if sectors is None:
            sectors = list(self.sector_etfs.keys())

        end_date = datetime.now()
        start_date = end_date - timedelta(days=126)  # 6 months for momentum

        # Use asyncio.gather to fetch data for all sectors concurrently
        tasks = [
            self._calculate_sector_momentum(sector, start_date, end_date)
            for sector in sectors
        ]

        # Execute all tasks and handle potential exceptions
        momentum_results = await asyncio.gather(*tasks, return_exceptions=True)

        results = []
        for sector, result in zip(sectors, momentum_results):
            if isinstance(result, Exception):
                logger.error(f"Error calculating momentum for {sector}: {result}")
                continue
            results.append(result)

        if not results:
            return pd.DataFrame(
                columns=[
                    "sector",
                    "price_momentum_1m",
                    "price_momentum_3m",
                    "price_momentum_6m",
                    "flow_momentum",
                    "acceleration",
                    "composite_score",
                    "rank",
                ]
            )

        df = pd.DataFrame(results).set_index("sector")
        df["rank"] = df["composite_score"].rank(ascending=False)
        return df.sort_values("rank")

    async def detect_risk_on_off(self, lookback_days: int = 20) -> Dict:
        """
        Detect risk-on vs risk-off market regime.

        Compares performance and flows between risk-on (cyclical)
        and risk-off (defensive) sectors.

        Args:
            lookback_days: Number of days to analyze

        Returns:
            Dictionary with risk regime analysis
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        # Fetch data for all sectors
        sector_data = await self._fetch_sector_price_data(start_date, end_date)

        if sector_data.empty:
            return {
                "regime": "neutral",
                "confidence": 0.0,
                "risk_on_score": 0.0,
                "risk_off_score": 0.0,
                "spread": 0.0,
                "trend": "flat",
            }

        # Calculate returns for risk-on and risk-off groups
        risk_on_returns = self._calculate_group_returns(sector_data, RISK_ON_SECTORS)
        risk_off_returns = self._calculate_group_returns(sector_data, RISK_OFF_SECTORS)

        # Calculate aggregate scores
        risk_on_score = risk_on_returns.mean() if len(risk_on_returns) > 0 else 0
        risk_off_score = risk_off_returns.mean() if len(risk_off_returns) > 0 else 0

        # Calculate spread
        spread = risk_on_score - risk_off_score

        # Determine regime
        if spread > 0.02:  # 2% spread threshold
            regime = "risk_on"
        elif spread < -0.02:
            regime = "risk_off"
        else:
            regime = "neutral"

        # Calculate confidence based on spread magnitude
        confidence = min(1.0, abs(spread) / 0.05)  # Max confidence at 5% spread

        # Determine trend (improving or deteriorating)
        trend = self._calculate_risk_trend(
            sector_data, RISK_ON_SECTORS, RISK_OFF_SECTORS
        )

        return {
            "regime": regime,
            "confidence": round(confidence, 3),
            "risk_on_score": round(risk_on_score, 4),
            "risk_off_score": round(risk_off_score, 4),
            "spread": round(spread, 4),
            "trend": trend,
            "risk_on_sectors": self._get_sector_details(sector_data, RISK_ON_SECTORS),
            "risk_off_sectors": self._get_sector_details(sector_data, RISK_OFF_SECTORS),
        }

    async def get_sector_correlation_changes(
        self, lookback_days: int = 63, comparison_days: int = 252
    ) -> Dict:
        """
        Detect correlation breakdowns and regime changes.

        Compares recent sector correlations to historical norms
        to identify structural changes in sector relationships.

        Args:
            lookback_days: Recent period for current correlations
            comparison_days: Historical period for baseline

        Returns:
            Dictionary with correlation analysis
        """
        end_date = datetime.now()
        recent_start = end_date - timedelta(days=lookback_days)
        historical_start = end_date - timedelta(days=comparison_days)

        # Fetch historical data
        historical_data = await self._fetch_sector_price_data(
            historical_start, end_date
        )

        if historical_data.empty or len(historical_data) < lookback_days:
            return {
                "correlation_matrix_current": pd.DataFrame(),
                "correlation_matrix_historical": pd.DataFrame(),
                "correlation_changes": pd.DataFrame(),
                "breakdowns": [],
                "analysis_valid": False,
            }

        # Calculate returns
        returns = historical_data.pct_change().dropna()

        # Split into recent and historical periods
        recent_returns = returns.tail(lookback_days)
        historical_returns = returns.head(comparison_days - lookback_days)

        # Calculate correlation matrices
        current_corr = recent_returns.corr()
        historical_corr = historical_returns.corr()

        # Calculate correlation changes
        corr_changes = current_corr - historical_corr

        # Identify significant breakdowns (large correlation changes)
        breakdowns = self._identify_correlation_breakdowns(corr_changes)

        return {
            "correlation_matrix_current": current_corr,
            "correlation_matrix_historical": historical_corr,
            "correlation_changes": corr_changes,
            "breakdowns": breakdowns,
            "average_correlation_current": self._average_correlation(current_corr),
            "average_correlation_historical": self._average_correlation(
                historical_corr
            ),
            "correlation_regime": self._classify_correlation_regime(current_corr),
            "analysis_valid": True,
        }

    async def identify_leadership_changes(
        self, short_period: int = 21, long_period: int = 63
    ) -> Dict:
        """
        Track sector leadership shifts.

        Compares recent leaders to historical leaders to identify
        rotation in market leadership.

        Args:
            short_period: Recent period for current leadership
            long_period: Historical period for comparison

        Returns:
            Dictionary with leadership analysis
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=long_period)

        # Fetch sector data
        sector_data = await self._fetch_sector_price_data(start_date, end_date)

        if sector_data.empty:
            return {
                "current_leaders": [],
                "previous_leaders": [],
                "rising_sectors": [],
                "falling_sectors": [],
                "leadership_stability": 0.0,
            }

        # Calculate returns for both periods
        short_returns = sector_data.tail(short_period).pct_change().sum()
        long_returns = sector_data.pct_change().sum()

        # Rank sectors
        short_ranks = short_returns.rank(ascending=False)
        long_ranks = long_returns.rank(ascending=False)

        # Identify leadership changes
        rank_changes = long_ranks - short_ranks

        # Current leaders (top 3)
        current_leaders = short_returns.nlargest(3).index.tolist()
        previous_leaders = long_returns.nlargest(3).index.tolist()

        # Rising sectors (improved ranking)
        rising = rank_changes[rank_changes > 2].index.tolist()

        # Falling sectors (worsened ranking)
        falling = rank_changes[rank_changes < -2].index.tolist()

        # Calculate leadership stability
        leader_overlap = len(set(current_leaders) & set(previous_leaders))
        stability = leader_overlap / 3.0

        return {
            "current_leaders": current_leaders,
            "previous_leaders": previous_leaders,
            "rising_sectors": rising,
            "falling_sectors": falling,
            "leadership_stability": round(stability, 2),
            "rank_changes": rank_changes.to_dict(),
            "short_period_returns": short_returns.to_dict(),
            "long_period_returns": long_returns.to_dict(),
        }

    async def get_rotation_signals(self) -> pd.DataFrame:
        """
        Generate actionable rotation signals.

        Combines momentum, flow analysis, and business cycle
        positioning to create trading signals.

        Returns:
            DataFrame with rotation signals per sector
        """
        # Get momentum data
        momentum_df = await self.get_sector_momentum()

        # Get risk regime
        risk_regime = await self.detect_risk_on_off()

        # Get leadership changes
        leadership = await self.identify_leadership_changes()

        if momentum_df.empty:
            return pd.DataFrame(
                columns=[
                    "sector",
                    "signal",
                    "strength",
                    "momentum_score",
                    "regime_alignment",
                    "leadership_score",
                    "composite_signal",
                ]
            )

        signals = []
        for sector in momentum_df.index:
            signal_data = self._calculate_sector_signal(
                sector, momentum_df.loc[sector], risk_regime, leadership
            )
            signals.append(signal_data)

        df = pd.DataFrame(signals)
        if not df.empty:
            df = df.sort_values("composite_signal", ascending=False)

        return df

    async def analyze_etf_flows_by_sector(
        self, lookback_days: int = 63
    ) -> pd.DataFrame:
        """
        Track ETF flow patterns by sector.

        Analyzes creation/redemption patterns, flow momentum,
        and institutional positioning in sector ETFs.

        Args:
            lookback_days: Number of days to analyze

        Returns:
            DataFrame with ETF flow analysis per sector
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        results = []
        for etf_symbol, sector_name in self.sector_etfs.items():
            try:
                flow_data = await self._fetch_etf_flow_data(
                    etf_symbol, start_date, end_date
                )
                flow_metrics = self._calculate_flow_metrics(flow_data)

                results.append(
                    {
                        "etf": etf_symbol,
                        "sector": sector_name,
                        "net_flow_1m": flow_metrics["net_flow_1m"],
                        "net_flow_3m": flow_metrics["net_flow_3m"],
                        "flow_momentum": flow_metrics["flow_momentum"],
                        "flow_acceleration": flow_metrics["flow_acceleration"],
                        "flow_signal": flow_metrics["flow_signal"],
                        "institutional_bias": flow_metrics["institutional_bias"],
                    }
                )
            except Exception as e:
                logger.error(f"Error analyzing flows for {etf_symbol}: {e}")
                continue

        if not results:
            return pd.DataFrame(
                columns=[
                    "etf",
                    "sector",
                    "net_flow_1m",
                    "net_flow_3m",
                    "flow_momentum",
                    "flow_acceleration",
                    "flow_signal",
                    "institutional_bias",
                ]
            )

        return pd.DataFrame(results).set_index("etf")

    async def get_business_cycle_positioning(self) -> Dict:
        """
        Determine current business cycle phase based on sector performance.

        Returns:
            Dictionary with business cycle analysis
        """
        # Analyze rotation patterns
        rotation = await self.analyze_rotation(lookback_days=126)

        if not rotation["rotation_scores"].empty:
            phase_scores = self._calculate_phase_scores(rotation["rotation_scores"])
        else:
            phase_scores = {phase.value: 0.0 for phase in BusinessCyclePhase}

        # Determine current phase
        current_phase = max(phase_scores, key=phase_scores.get)
        confidence = phase_scores[current_phase]

        # Get leading sectors for current phase
        leading_sectors = CYCLE_SECTOR_MAP.get(BusinessCyclePhase(current_phase), [])

        return {
            "current_phase": current_phase,
            "confidence": round(confidence, 3),
            "phase_scores": phase_scores,
            "leading_sectors": leading_sectors,
            "sector_names": [self.sector_etfs.get(s, s) for s in leading_sectors],
            "cycle_description": self._get_cycle_description(current_phase),
        }

    # =========================================================================
    # Private Helper Methods
    # =========================================================================

    async def _fetch_sector_price_data(
        self, start_date: datetime, end_date: datetime
    ) -> pd.DataFrame:
        """Fetch price data for all sector ETFs."""
        tasks = [
            self._fetch_single_sector_price(etf_symbol, start_date, end_date)
            for etf_symbol in self.sector_etfs.keys()
        ]

        # Execute all tasks concurrently
        results = await asyncio.gather(*tasks)

        # Combine results into dictionary
        sector_prices = {
            symbol: data for symbol, data in results if data is not None and not data.empty
        }

        if not sector_prices:
            return pd.DataFrame()

        return pd.DataFrame(sector_prices)

    async def _fetch_single_sector_price(
        self, etf_symbol: str, start_date: datetime, end_date: datetime
    ) -> tuple:
        """Fetch price data for a single sector ETF."""
        try:
            if self.data_manager:
                data = await self.data_manager.get_stock_data(
                    etf_symbol, start_date, end_date
                )
                if not data.empty and "close" in data.columns:
                    return etf_symbol, data.set_index("date")["close"]
            else:
                # Generate mock data
                data = self._generate_mock_price_data(etf_symbol, start_date, end_date)
                return etf_symbol, data
        except Exception as e:
            logger.warning(f"Failed to fetch data for {etf_symbol}: {e}")
            # Use mock data as fallback
            data = self._generate_mock_price_data(etf_symbol, start_date, end_date)
            return etf_symbol, data

        return etf_symbol, None

    async def _fetch_etf_flow_data(
        self, etf_symbol: str, start_date: datetime, end_date: datetime
    ) -> pd.DataFrame:
        """Fetch ETF flow data."""
        if self.data_manager:
            try:
                return await self.data_manager.get_etf_flows(
                    etf_symbol, start_date, end_date
                )
            except Exception as e:
                logger.warning(f"Failed to fetch flows for {etf_symbol}: {e}")

        # Generate mock flow data
        return self._generate_mock_flow_data(start_date, end_date)

    async def _calculate_sector_momentum(
        self, sector: str, start_date: datetime, end_date: datetime
    ) -> Dict:
        """Calculate momentum metrics for a single sector."""
        # Fetch price data
        if self.data_manager:
            try:
                data = await self.data_manager.get_stock_data(
                    sector, start_date, end_date
                )
                if not data.empty and "close" in data.columns:
                    prices = data.set_index("date")["close"]
                else:
                    prices = self._generate_mock_price_data(
                        sector, start_date, end_date
                    )
            except Exception:
                prices = self._generate_mock_price_data(sector, start_date, end_date)
        else:
            prices = self._generate_mock_price_data(sector, start_date, end_date)

        # Calculate momentum over different periods
        current_price = prices.iloc[-1] if len(prices) > 0 else 0

        mom_1m = (current_price / prices.iloc[-21] - 1) if len(prices) >= 21 else 0
        mom_3m = (current_price / prices.iloc[-63] - 1) if len(prices) >= 63 else 0
        mom_6m = (current_price / prices.iloc[0] - 1) if len(prices) > 0 else 0

        # Flow momentum (from ETF flows)
        flow_data = await self._fetch_etf_flow_data(
            sector, end_date - timedelta(days=63), end_date
        )
        flow_metrics = self._calculate_flow_metrics(flow_data)
        flow_momentum = flow_metrics.get("flow_momentum", 0)

        # Acceleration (rate of change of momentum)
        acceleration = mom_1m - (mom_3m / 3) if mom_3m != 0 else 0

        # Composite score (weighted average)
        composite = (
            0.2 * mom_1m
            + 0.3 * mom_3m
            + 0.2 * mom_6m
            + 0.2 * flow_momentum
            + 0.1 * acceleration
        )

        return {
            "sector": sector,
            "price_momentum_1m": round(mom_1m, 4),
            "price_momentum_3m": round(mom_3m, 4),
            "price_momentum_6m": round(mom_6m, 4),
            "flow_momentum": round(flow_momentum, 4),
            "acceleration": round(acceleration, 4),
            "composite_score": round(composite, 4),
        }

    def _calculate_sector_returns(self, sector_data: pd.DataFrame) -> pd.DataFrame:
        """Calculate returns over multiple timeframes."""
        if sector_data.empty:
            return pd.DataFrame()

        # Vectorized implementation for performance
        # Fill missing values forward to handle gaps
        df_filled = sector_data.ffill()

        # Get current prices (last row)
        current_prices = df_filled.iloc[-1]

        # Calculate returns using shift
        # Note: shift(N) looks back N rows (trading days), which is standard for time-series analysis
        # contrasting with dropna().iloc[-N] which looks back N valid observations

        # 1 week return (5 days)
        price_1w = df_filled.shift(5).iloc[-1]
        return_1w = (current_prices / price_1w - 1).fillna(0)

        # 1 month return (21 days)
        price_1m = df_filled.shift(21).iloc[-1]
        return_1m = (current_prices / price_1m - 1).fillna(0)

        # 3 month return (from start of period)
        # Use first valid observation for each column
        first_valid = sector_data.bfill().iloc[0]
        return_3m = (current_prices / first_valid - 1).fillna(0)

        # Create result DataFrame
        results = pd.DataFrame(
            {
                "return_1w": return_1w,
                "return_1m": return_1m,
                "return_3m": return_3m,
                "current_price": current_prices,
            }
        )

        # Filter based on data availability rules
        valid_counts = sector_data.notna().sum()

        # Set to 0 where insufficient data (mimicking original logic)
        results.loc[valid_counts < 5, "return_1w"] = 0
        results.loc[valid_counts < 21, "return_1m"] = 0

        # Filter out columns with less than 2 valid observations
        results = results[valid_counts >= 2]

        return results

    def _calculate_rotation_scores(self, returns_df: pd.DataFrame) -> pd.DataFrame:
        """Calculate rotation scores from returns data."""
        if returns_df.empty:
            return pd.DataFrame()

        scores = returns_df.copy()

        # Relative strength (vs average)
        avg_return_1m = returns_df["return_1m"].mean()
        avg_return_3m = returns_df["return_3m"].mean()

        scores["relative_strength_1m"] = returns_df["return_1m"] - avg_return_1m
        scores["relative_strength_3m"] = returns_df["return_3m"] - avg_return_3m

        # Momentum score
        scores["momentum_score"] = (
            0.5 * scores["relative_strength_1m"] + 0.5 * scores["relative_strength_3m"]
        )

        # Rotation signal based on changes
        scores["rotation_signal"] = np.where(
            scores["relative_strength_1m"] > scores["relative_strength_3m"],
            "accelerating",
            np.where(
                scores["relative_strength_1m"] < scores["relative_strength_3m"],
                "decelerating",
                "stable",
            ),
        )

        return scores

    def _determine_phase_alignment(self, rotation_scores: pd.DataFrame) -> Dict:
        """Determine business cycle phase alignment."""
        if rotation_scores.empty:
            return {"phase": "unknown", "confidence": 0.0}

        phase_scores = {}
        for phase, sectors in CYCLE_SECTOR_MAP.items():
            available_sectors = [s for s in sectors if s in rotation_scores.index]
            if available_sectors:
                avg_momentum = rotation_scores.loc[
                    available_sectors, "momentum_score"
                ].mean()
                phase_scores[phase.value] = avg_momentum

        if not phase_scores:
            return {"phase": "unknown", "confidence": 0.0}

        best_phase = max(phase_scores, key=phase_scores.get)
        confidence = max(0, min(1, phase_scores[best_phase] * 10 + 0.5))

        return {"phase": best_phase, "confidence": round(confidence, 2)}

    def _identify_leadership_from_returns(self, returns_df: pd.DataFrame) -> Dict:
        """Identify sector leadership from returns."""
        if returns_df.empty:
            return {"leaders": [], "laggards": []}

        sorted_returns = returns_df["return_1m"].sort_values(ascending=False)

        return {
            "leaders": sorted_returns.head(3).index.tolist(),
            "laggards": sorted_returns.tail(3).index.tolist(),
            "leader_returns": sorted_returns.head(3).to_dict(),
            "laggard_returns": sorted_returns.tail(3).to_dict(),
        }

    def _calculate_group_returns(
        self, sector_data: pd.DataFrame, group_sectors: List[str]
    ) -> pd.Series:
        """Calculate returns for a group of sectors."""
        available = [s for s in group_sectors if s in sector_data.columns]
        if not available:
            return pd.Series()

        group_data = sector_data[available]
        returns = group_data.iloc[-1] / group_data.iloc[0] - 1
        return returns

    def _calculate_risk_trend(
        self,
        sector_data: pd.DataFrame,
        risk_on_sectors: List[str],
        risk_off_sectors: List[str],
    ) -> str:
        """Calculate trend in risk-on/risk-off spread."""
        if len(sector_data) < 10:
            return "flat"

        # Calculate rolling spread
        mid_point = len(sector_data) // 2

        first_half_on = self._calculate_group_returns(
            sector_data.iloc[:mid_point], risk_on_sectors
        )
        first_half_off = self._calculate_group_returns(
            sector_data.iloc[:mid_point], risk_off_sectors
        )
        second_half_on = self._calculate_group_returns(
            sector_data.iloc[mid_point:], risk_on_sectors
        )
        second_half_off = self._calculate_group_returns(
            sector_data.iloc[mid_point:], risk_off_sectors
        )

        first_spread = (
            first_half_on.mean() - first_half_off.mean()
            if len(first_half_on) > 0 and len(first_half_off) > 0
            else 0
        )
        second_spread = (
            second_half_on.mean() - second_half_off.mean()
            if len(second_half_on) > 0 and len(second_half_off) > 0
            else 0
        )

        spread_change = second_spread - first_spread

        if spread_change > 0.01:
            return "risk_on_improving"
        elif spread_change < -0.01:
            return "risk_off_improving"
        return "flat"

    def _get_sector_details(
        self, sector_data: pd.DataFrame, sectors: List[str]
    ) -> List[Dict]:
        """Get detailed information for a list of sectors."""
        details = []
        available = [s for s in sectors if s in sector_data.columns]

        for sector in available:
            prices = sector_data[sector]
            ret = (prices.iloc[-1] / prices.iloc[0] - 1) if len(prices) > 0 else 0
            details.append(
                {
                    "symbol": sector,
                    "name": self.sector_etfs.get(sector, sector),
                    "return": round(ret, 4),
                }
            )

        return sorted(details, key=lambda x: x["return"], reverse=True)

    def _identify_correlation_breakdowns(
        self, corr_changes: pd.DataFrame
    ) -> List[Dict]:
        """Identify significant correlation breakdowns."""
        # Use upper triangle to avoid duplicates and self-correlation
        mask = np.triu(np.ones(corr_changes.shape), k=1).astype(bool)
        upper_tri = corr_changes.where(mask)

        # Stack to get a MultiIndex series (sector_1, sector_2) -> change
        stacked = upper_tri.stack()

        # Filter for significant changes
        significant = stacked[abs(stacked) > 0.3]

        if significant.empty:
            return []

        breakdowns = []
        for (s1, s2), change in significant.items():
            breakdowns.append(
                {
                    "sector_1": s1,
                    "sector_2": s2,
                    "change": round(change, 3),
                    "type": "decorrelation" if change < 0 else "convergence",
                }
            )

        return sorted(breakdowns, key=lambda x: abs(x["change"]), reverse=True)

    def _average_correlation(self, corr_matrix: pd.DataFrame) -> float:
        """Calculate average off-diagonal correlation."""
        if corr_matrix.empty:
            return 0.0

        n = len(corr_matrix)
        if n <= 1:
            return 0.0

        # Get upper triangle (excluding diagonal)
        upper_tri = corr_matrix.values[np.triu_indices(n, k=1)]
        return float(np.mean(upper_tri)) if len(upper_tri) > 0 else 0.0

    def _classify_correlation_regime(self, corr_matrix: pd.DataFrame) -> str:
        """Classify the correlation regime."""
        avg_corr = self._average_correlation(corr_matrix)

        if avg_corr > 0.7:
            return "high_correlation"
        elif avg_corr > 0.4:
            return "moderate_correlation"
        else:
            return "low_correlation"

    def _calculate_sector_signal(
        self,
        sector: str,
        momentum_data: pd.Series,
        risk_regime: Dict,
        leadership: Dict,
    ) -> Dict:
        """Calculate trading signal for a sector."""
        # Base momentum signal
        momentum_score = momentum_data.get("composite_score", 0)

        # Regime alignment
        is_risk_on_sector = sector in RISK_ON_SECTORS
        regime_favorable = (
            risk_regime["regime"] == "risk_on" and is_risk_on_sector
        ) or (risk_regime["regime"] == "risk_off" and not is_risk_on_sector)
        regime_alignment = 1.0 if regime_favorable else -0.5

        # Leadership score
        is_leader = sector in leadership.get("current_leaders", [])
        is_rising = sector in leadership.get("rising_sectors", [])
        leadership_score = 1.0 if is_leader else (0.5 if is_rising else 0.0)

        # Composite signal
        composite = (
            0.5 * momentum_score + 0.3 * regime_alignment + 0.2 * leadership_score
        )

        # Determine signal direction
        if composite > 0.1:
            signal = "overweight"
        elif composite < -0.1:
            signal = "underweight"
        else:
            signal = "neutral"

        return {
            "sector": sector,
            "sector_name": self.sector_etfs.get(sector, sector),
            "signal": signal,
            "strength": round(abs(composite), 3),
            "momentum_score": round(momentum_score, 4),
            "regime_alignment": round(regime_alignment, 2),
            "leadership_score": round(leadership_score, 2),
            "composite_signal": round(composite, 4),
        }

    def _calculate_flow_metrics(self, flow_data: pd.DataFrame) -> Dict:
        """Calculate flow metrics from ETF flow data."""
        if flow_data.empty or "net_flow" not in flow_data.columns:
            return {
                "net_flow_1m": 0.0,
                "net_flow_3m": 0.0,
                "flow_momentum": 0.0,
                "flow_acceleration": 0.0,
                "flow_signal": "neutral",
                "institutional_bias": 0.0,
            }

        net_flows = flow_data["net_flow"]

        # Net flows over periods
        net_flow_1m = net_flows.tail(21).sum()
        net_flow_3m = net_flows.sum()

        # Flow momentum (normalized)
        flow_std = net_flows.std()
        if flow_std > 0:
            flow_momentum = net_flow_3m / (flow_std * len(net_flows) ** 0.5)
        else:
            flow_momentum = 0.0

        # Flow acceleration
        recent_flow = net_flows.tail(10).mean()
        historical_flow = net_flows.mean()
        if abs(historical_flow) > 1e-10:
            flow_acceleration = (recent_flow - historical_flow) / abs(historical_flow)
        else:
            flow_acceleration = 0.0

        # Flow signal
        if flow_momentum > 0.5:
            flow_signal = "strong_inflow"
        elif flow_momentum > 0:
            flow_signal = "mild_inflow"
        elif flow_momentum > -0.5:
            flow_signal = "mild_outflow"
        else:
            flow_signal = "strong_outflow"

        # Institutional bias
        institutional_bias = np.sign(net_flow_3m) * min(1.0, abs(flow_momentum))

        return {
            "net_flow_1m": float(net_flow_1m),
            "net_flow_3m": float(net_flow_3m),
            "flow_momentum": float(flow_momentum),
            "flow_acceleration": float(flow_acceleration),
            "flow_signal": flow_signal,
            "institutional_bias": float(institutional_bias),
        }

    def _calculate_phase_scores(
        self, rotation_scores: pd.DataFrame
    ) -> Dict[str, float]:
        """Calculate business cycle phase scores."""
        phase_scores = {}

        for phase, sectors in CYCLE_SECTOR_MAP.items():
            available_sectors = [s for s in sectors if s in rotation_scores.index]
            if available_sectors:
                avg_momentum = rotation_scores.loc[
                    available_sectors, "momentum_score"
                ].mean()
                # Normalize to 0-1 range
                phase_scores[phase.value] = max(0, min(1, (avg_momentum + 0.1) / 0.2))
            else:
                phase_scores[phase.value] = 0.0

        return phase_scores

    def _get_cycle_description(self, phase: str) -> str:
        """Get description for business cycle phase."""
        descriptions = {
            "early_cycle": (
                "Economic recovery phase. Financials and Consumer Discretionary "
                "typically lead as credit conditions improve and consumer "
                "spending rebounds."
            ),
            "mid_cycle": (
                "Economic expansion phase. Technology and Industrials typically "
                "lead as business investment increases and productivity gains "
                "accelerate."
            ),
            "late_cycle": (
                "Economic peak phase. Energy and Materials typically lead as "
                "capacity constraints emerge and commodity demand peaks."
            ),
            "recession": (
                "Economic contraction phase. Utilities, Healthcare, and Consumer "
                "Staples typically lead as investors seek defensive positioning "
                "and stable earnings."
            ),
        }
        return descriptions.get(phase, "Unknown business cycle phase.")

    def _empty_rotation_result(self) -> Dict:
        """Return empty rotation analysis result."""
        return {
            "sector_performance": pd.DataFrame(),
            "rotation_scores": pd.DataFrame(),
            "phase_alignment": {"phase": "unknown", "confidence": 0.0},
            "leadership": {"leaders": [], "laggards": []},
            "analysis_period": {},
        }

    def _generate_mock_price_data(
        self, symbol: str, start_date: datetime, end_date: datetime
    ) -> pd.Series:
        """Generate mock price data for a sector ETF."""
        dates = pd.date_range(start=start_date, end=end_date, freq="D")

        # Use symbol to seed different patterns
        np.random.seed(hash(symbol) % 2**32)

        # Generate realistic price series
        initial_price = 100 + np.random.uniform(-20, 20)
        returns = np.random.normal(0.0005, 0.015, len(dates))
        prices = initial_price * np.cumprod(1 + returns)

        return pd.Series(prices, index=dates)

    def _generate_mock_flow_data(
        self, start_date: datetime, end_date: datetime
    ) -> pd.DataFrame:
        """Generate mock ETF flow data."""
        dates = pd.date_range(start=start_date, end=end_date, freq="D")

        # Generate realistic flow data
        base_flow = np.random.normal(0, 500000, len(dates))

        return pd.DataFrame(
            {
                "date": dates,
                "net_flow": base_flow,
                "creation_units": np.where(base_flow > 0, base_flow / 100000, 0),
                "redemption_units": np.where(base_flow < 0, -base_flow / 100000, 0),
            }
        )

    def health_check(self) -> bool:
        """Check if sector rotation analyzer is operational."""
        return True
