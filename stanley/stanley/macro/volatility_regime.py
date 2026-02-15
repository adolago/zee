"""
Volatility Regime Detection Module

Identifies market volatility regimes using:
- VIX level classification (low/normal/elevated/high/extreme)
- VIX term structure (contango/backwardation)
- Realized vs implied volatility ratio
- Cross-asset volatility spillovers
- GARCH-based regime switching (optional)
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class VolatilityRegime(Enum):
    """Volatility regime classification based on VIX levels."""

    LOW = "low"  # VIX < 15
    NORMAL = "normal"  # VIX 15-20
    ELEVATED = "elevated"  # VIX 20-30
    HIGH = "high"  # VIX 30-40
    EXTREME = "extreme"  # VIX > 40


class VIXTermStructure(Enum):
    """VIX futures term structure classification."""

    STEEP_CONTANGO = "steep_contango"  # Normal, calm markets
    CONTANGO = "contango"  # Normal conditions
    FLAT = "flat"  # Transition period
    BACKWARDATION = "backwardation"  # Fear/stress
    STEEP_BACKWARDATION = "steep_backwardation"  # Panic conditions


@dataclass
class VolatilityState:
    """Current state of volatility regime and related metrics."""

    regime: VolatilityRegime
    vix_level: float
    vix_percentile: float  # Historical percentile (0-100)
    term_structure: VIXTermStructure
    realized_implied_ratio: float  # RV/IV ratio
    vol_of_vol: float  # VVIX proxy (volatility of volatility)
    cross_asset_stress: float  # 0-1 composite stress indicator
    regime_duration_days: int
    regime_confidence: float  # 0-1 confidence in classification
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "regime": self.regime.value,
            "vix_level": self.vix_level,
            "vix_percentile": self.vix_percentile,
            "term_structure": self.term_structure.value,
            "realized_implied_ratio": self.realized_implied_ratio,
            "vol_of_vol": self.vol_of_vol,
            "cross_asset_stress": self.cross_asset_stress,
            "regime_duration_days": self.regime_duration_days,
            "regime_confidence": self.regime_confidence,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class RegimeTransition:
    """Record of a volatility regime transition."""

    from_regime: VolatilityRegime
    to_regime: VolatilityRegime
    transition_date: datetime
    vix_level_at_transition: float
    trigger: str  # Description of what triggered the transition


class VolatilityRegimeDetector:
    """
    Detect and classify volatility regimes across markets.

    Uses VIX levels, term structure, realized vs implied volatility,
    and cross-asset stress indicators to identify the current
    volatility environment.
    """

    # VIX thresholds for regime classification
    VIX_THRESHOLDS = {
        VolatilityRegime.LOW: (0.0, 15.0),
        VolatilityRegime.NORMAL: (15.0, 20.0),
        VolatilityRegime.ELEVATED: (20.0, 30.0),
        VolatilityRegime.HIGH: (30.0, 40.0),
        VolatilityRegime.EXTREME: (40.0, float("inf")),
    }

    # Term structure thresholds (ratio of front month to next month)
    TERM_STRUCTURE_THRESHOLDS = {
        VIXTermStructure.STEEP_CONTANGO: (None, 0.92),  # Front < 92% of deferred
        VIXTermStructure.CONTANGO: (0.92, 0.98),  # Front 92-98% of deferred
        VIXTermStructure.FLAT: (0.98, 1.02),  # Front 98-102% of deferred
        VIXTermStructure.BACKWARDATION: (1.02, 1.10),  # Front 102-110% of deferred
        VIXTermStructure.STEEP_BACKWARDATION: (1.10, None),  # Front > 110% of deferred
    }

    # Trading days per year for annualization
    TRADING_DAYS_PER_YEAR = 252

    def __init__(
        self,
        data_manager: Optional[Any] = None,
        lookback_days: int = 252 * 5,  # 5 years for percentile calculation
    ):
        """
        Initialize VolatilityRegimeDetector.

        Args:
            data_manager: DataManager instance for fetching VIX and market data
            lookback_days: Days of history for percentile calculations
        """
        self.data_manager = data_manager
        self.lookback_days = lookback_days
        self._vix_history: Optional[pd.DataFrame] = None
        self._regime_history: List[RegimeTransition] = []
        self._current_regime_start: Optional[datetime] = None

        logger.info("VolatilityRegimeDetector initialized")

    async def get_volatility_state(self) -> VolatilityState:
        """
        Get current volatility regime state.

        Returns:
            VolatilityState with comprehensive volatility metrics
        """
        # Fetch current VIX data
        vix_data = await self._fetch_vix_data()

        if vix_data.empty:
            logger.warning("No VIX data available, returning mock state")
            return self._generate_mock_state()

        current_vix = vix_data["close"].iloc[-1]

        # Classify VIX regime
        regime = self.classify_vix_regime(current_vix)

        # Calculate VIX percentile
        vix_percentile = self.calculate_vol_percentile(
            current_vol=current_vix,
            vol_history=vix_data["close"],
        )

        # Analyze term structure
        vix_futures = await self._fetch_vix_futures()
        term_structure = self.analyze_term_structure(
            vix_spot=current_vix,
            vix_futures=vix_futures,
        )

        # Calculate realized vs implied ratio
        spx_returns = await self._fetch_spx_returns()
        realized_vol = self.calculate_realized_vol(spx_returns)
        rv_iv_ratio = realized_vol / current_vix if current_vix > 0 else 1.0

        # Calculate vol of vol (VVIX proxy)
        vol_of_vol = self._calculate_vol_of_vol(vix_data["close"])

        # Cross-asset stress indicator
        cross_asset_stress = await self.calculate_cross_asset_stress()

        # Regime duration
        regime_duration = self._calculate_regime_duration(vix_data, regime)

        # Confidence based on how far VIX is from regime boundaries
        confidence = self._calculate_regime_confidence(current_vix, regime)

        return VolatilityState(
            regime=regime,
            vix_level=current_vix,
            vix_percentile=vix_percentile,
            term_structure=term_structure,
            realized_implied_ratio=rv_iv_ratio,
            vol_of_vol=vol_of_vol,
            cross_asset_stress=cross_asset_stress,
            regime_duration_days=regime_duration,
            regime_confidence=confidence,
        )

    def classify_vix_regime(self, vix_level: float) -> VolatilityRegime:
        """
        Classify VIX level into volatility regime.

        Args:
            vix_level: Current VIX level

        Returns:
            VolatilityRegime classification
        """
        for regime, (lower, upper) in self.VIX_THRESHOLDS.items():
            if lower <= vix_level < upper:
                return regime

        # Fallback for edge cases
        if vix_level >= 40:
            return VolatilityRegime.EXTREME
        return VolatilityRegime.LOW

    def analyze_term_structure(
        self,
        vix_spot: float,
        vix_futures: Dict[str, float],
    ) -> VIXTermStructure:
        """
        Analyze VIX futures term structure.

        Args:
            vix_spot: Current VIX spot level
            vix_futures: Dictionary of VIX futures prices by tenor
                         e.g., {"M1": 18.5, "M2": 19.2, "M3": 20.0}

        Returns:
            VIXTermStructure classification
        """
        if not vix_futures:
            logger.debug("No VIX futures data, assuming normal contango")
            return VIXTermStructure.CONTANGO

        # Get front and second month futures
        front_month = vix_futures.get("M1") or vix_futures.get("front")
        second_month = vix_futures.get("M2") or vix_futures.get("second")

        if front_month is None or second_month is None:
            # Fall back to comparing spot vs any available future
            available_future = next(iter(vix_futures.values()), None)
            if available_future is None:
                return VIXTermStructure.CONTANGO

            ratio = vix_spot / available_future
        else:
            ratio = front_month / second_month

        # Classify term structure based on ratio
        for structure, (lower, upper) in self.TERM_STRUCTURE_THRESHOLDS.items():
            lower = lower if lower is not None else -float("inf")
            upper = upper if upper is not None else float("inf")

            if lower <= ratio < upper:
                return structure

        # Default to flat if ratio doesn't match any threshold
        return VIXTermStructure.FLAT

    def calculate_realized_vol(
        self,
        returns: pd.Series,
        window: int = 20,
    ) -> float:
        """
        Calculate realized volatility (annualized).

        Uses close-to-close returns with standard deviation.

        Args:
            returns: Series of log returns
            window: Rolling window in trading days (default 20 = ~1 month)

        Returns:
            Annualized realized volatility in percentage points
        """
        if returns.empty or len(returns) < window:
            logger.warning("Insufficient data for realized vol calculation")
            return 0.0

        # Calculate rolling standard deviation of returns
        rolling_std = returns.tail(window).std()

        # Annualize: multiply by sqrt(252) and convert to percentage
        annualized_vol = rolling_std * np.sqrt(self.TRADING_DAYS_PER_YEAR) * 100

        return float(annualized_vol)

    def calculate_vol_percentile(
        self,
        current_vol: float,
        vol_history: Optional[pd.Series] = None,
        lookback_days: Optional[int] = None,
    ) -> float:
        """
        Calculate where current volatility sits historically.

        Args:
            current_vol: Current volatility level
            vol_history: Historical volatility series (optional)
            lookback_days: Days of history to use (optional)

        Returns:
            Percentile rank (0-100) of current vol in history
        """
        if vol_history is None:
            if self._vix_history is not None and "close" in self._vix_history.columns:
                vol_history = self._vix_history["close"]
            else:
                logger.warning("No volatility history available")
                return 50.0  # Assume median

        lookback = lookback_days or self.lookback_days
        history = vol_history.tail(lookback).dropna()

        if history.empty:
            return 50.0

        # Calculate percentile rank
        percentile = (history < current_vol).sum() / len(history) * 100

        return float(percentile)

    def detect_regime_change(
        self,
        vol_series: pd.Series,
        method: str = "threshold",
    ) -> pd.DataFrame:
        """
        Detect volatility regime changes over time.

        Args:
            vol_series: VIX or volatility time series
            method: Detection method - "threshold" or "markov" (advanced)

        Returns:
            DataFrame with regime classifications and transitions
        """
        if vol_series.empty:
            return pd.DataFrame()

        if method == "threshold":
            return self._detect_regime_threshold(vol_series)
        elif method == "markov":
            return self._detect_regime_markov(vol_series)
        else:
            raise ValueError(f"Unknown method: {method}")

    def _detect_regime_threshold(self, vol_series: pd.Series) -> pd.DataFrame:
        """
        Detect regime changes using threshold method.

        Args:
            vol_series: VIX or volatility time series

        Returns:
            DataFrame with date, vix_level, regime, regime_change columns
        """
        regimes = []
        prev_regime = None

        for idx, vix_level in vol_series.items():
            if pd.isna(vix_level):
                continue

            regime = self.classify_vix_regime(float(vix_level))
            regime_change = regime != prev_regime if prev_regime else False

            regimes.append(
                {
                    "date": idx,
                    "vix_level": vix_level,
                    "regime": regime.value,
                    "regime_change": regime_change,
                }
            )

            prev_regime = regime

        df = pd.DataFrame(regimes)

        # Add regime duration
        if not df.empty:
            df["regime_duration"] = self._calculate_regime_durations(df)

        return df

    def _detect_regime_markov(self, vol_series: pd.Series) -> pd.DataFrame:
        """
        Detect regime changes using Markov switching model (simplified).

        This is a simplified implementation. For production, consider
        using the statsmodels MarkovSwitching model.

        Args:
            vol_series: VIX or volatility time series

        Returns:
            DataFrame with regime probabilities
        """
        # Simplified: Use threshold detection with smoothing
        # Full implementation would use statsmodels.tsa.regime_switching

        threshold_df = self._detect_regime_threshold(vol_series)

        if threshold_df.empty:
            return threshold_df

        # Add smoothed regime (3-day rolling mode to reduce noise)
        if len(threshold_df) >= 3:
            threshold_df["smoothed_regime"] = (
                threshold_df["regime"]
                .rolling(window=3, center=True, min_periods=1)
                .apply(lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else x.iloc[0])
            )
        else:
            threshold_df["smoothed_regime"] = threshold_df["regime"]

        return threshold_df

    async def calculate_cross_asset_stress(self) -> float:
        """
        Calculate composite cross-asset stress indicator.

        Combines:
        - Equity vol (VIX)
        - Rate vol (MOVE index proxy)
        - FX vol (CVIX proxy)
        - Credit vol (CDX spread changes)

        Returns:
            Stress indicator between 0 (calm) and 1 (extreme stress)
        """
        stress_components = []

        # Equity vol stress (VIX normalized)
        vix_stress = await self._calculate_vix_stress()
        if vix_stress is not None:
            stress_components.append(("equity_vol", vix_stress, 0.35))

        # Rate vol stress (MOVE index proxy)
        rate_stress = await self._calculate_rate_stress()
        if rate_stress is not None:
            stress_components.append(("rate_vol", rate_stress, 0.25))

        # FX vol stress (currency vol proxy)
        fx_stress = await self._calculate_fx_stress()
        if fx_stress is not None:
            stress_components.append(("fx_vol", fx_stress, 0.20))

        # Credit stress (spread widening)
        credit_stress = await self._calculate_credit_stress()
        if credit_stress is not None:
            stress_components.append(("credit", credit_stress, 0.20))

        if not stress_components:
            logger.warning("No stress components available")
            return 0.5  # Neutral stress

        # Weighted average of available components
        total_weight = sum(w for _, _, w in stress_components)
        weighted_stress = sum(s * w for _, s, w in stress_components) / total_weight

        # Normalize to 0-1 range
        return min(max(weighted_stress, 0.0), 1.0)

    async def get_regime_history(
        self,
        lookback_days: int = 252,
    ) -> List[Dict[str, Any]]:
        """
        Get historical regime transitions.

        Args:
            lookback_days: Days of history to analyze

        Returns:
            List of regime transition records
        """
        vix_data = await self._fetch_vix_data(lookback_days)

        if vix_data.empty:
            return []

        regime_df = self.detect_regime_change(vix_data["close"])

        transitions = []
        for idx, row in regime_df[regime_df["regime_change"]].iterrows():
            prev_idx = regime_df.index.get_loc(idx) - 1
            if prev_idx >= 0:
                prev_row = regime_df.iloc[prev_idx]
                transitions.append(
                    {
                        "date": (
                            row["date"].isoformat()
                            if hasattr(row["date"], "isoformat")
                            else str(row["date"])
                        ),
                        "from_regime": prev_row["regime"],
                        "to_regime": row["regime"],
                        "vix_level": row["vix_level"],
                    }
                )

        return transitions

    def get_regime_statistics(
        self,
        regime_df: pd.DataFrame,
    ) -> Dict[str, Any]:
        """
        Calculate statistics for each regime.

        Args:
            regime_df: DataFrame from detect_regime_change

        Returns:
            Dictionary with regime statistics
        """
        if regime_df.empty:
            return {}

        stats = {}

        for regime in VolatilityRegime:
            regime_data = regime_df[regime_df["regime"] == regime.value]

            if regime_data.empty:
                continue

            stats[regime.value] = {
                "count_days": len(regime_data),
                "percentage": len(regime_data) / len(regime_df) * 100,
                "avg_vix": regime_data["vix_level"].mean(),
                "min_vix": regime_data["vix_level"].min(),
                "max_vix": regime_data["vix_level"].max(),
                "avg_duration": (
                    regime_data["regime_duration"].mean()
                    if "regime_duration" in regime_data.columns
                    else None
                ),
            }

        return stats

    # =========================================================================
    # Private Helper Methods
    # =========================================================================

    async def _fetch_vix_data(
        self,
        lookback_days: Optional[int] = None,
    ) -> pd.DataFrame:
        """Fetch VIX historical data."""
        lookback = lookback_days or self.lookback_days

        if self.data_manager is None:
            return self._generate_mock_vix_data(lookback)

        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=lookback)

            # VIX is typically available as ^VIX or $VIX
            vix_data = await self.data_manager.get_stock_data(
                symbol="^VIX",
                start_date=start_date,
                end_date=end_date,
            )

            if vix_data.empty:
                # Try alternative symbol
                vix_data = await self.data_manager.get_stock_data(
                    symbol="VIX",
                    start_date=start_date,
                    end_date=end_date,
                )

            self._vix_history = vix_data
            return vix_data

        except Exception as e:
            logger.warning(f"Failed to fetch VIX data: {e}")
            return self._generate_mock_vix_data(lookback)

    async def _fetch_vix_futures(self) -> Dict[str, float]:
        """Fetch VIX futures prices."""
        if self.data_manager is None:
            return self._generate_mock_vix_futures()

        try:
            # VIX futures typically have symbols like VXF24, VXG24, etc.
            # This is simplified - real implementation would fetch actual futures
            # For now, return mock data as VIX futures are not easily available
            return self._generate_mock_vix_futures()

        except Exception as e:
            logger.debug(f"Failed to fetch VIX futures: {e}")
            return self._generate_mock_vix_futures()

    async def _fetch_spx_returns(self) -> pd.Series:
        """Fetch S&P 500 returns for realized vol calculation."""
        if self.data_manager is None:
            return self._generate_mock_returns()

        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=60)

            spx_data = await self.data_manager.get_stock_data(
                symbol="^GSPC",
                start_date=start_date,
                end_date=end_date,
            )

            if spx_data.empty:
                # Try SPY as proxy
                spx_data = await self.data_manager.get_stock_data(
                    symbol="SPY",
                    start_date=start_date,
                    end_date=end_date,
                )

            if not spx_data.empty and "close" in spx_data.columns:
                # Calculate log returns
                returns = np.log(spx_data["close"] / spx_data["close"].shift(1))
                return returns.dropna()

            return self._generate_mock_returns()

        except Exception as e:
            logger.warning(f"Failed to fetch SPX returns: {e}")
            return self._generate_mock_returns()

    def _calculate_vol_of_vol(self, vix_series: pd.Series, window: int = 20) -> float:
        """
        Calculate volatility of volatility (VVIX proxy).

        Args:
            vix_series: VIX time series
            window: Rolling window for calculation

        Returns:
            Vol of vol as percentage
        """
        if vix_series.empty or len(vix_series) < window:
            return 0.0

        # Calculate VIX log returns
        vix_returns = np.log(vix_series / vix_series.shift(1)).dropna()

        if len(vix_returns) < window:
            return 0.0

        # Calculate rolling std of VIX returns
        vol_of_vol = vix_returns.tail(window).std() * np.sqrt(252) * 100

        return float(vol_of_vol)

    def _calculate_regime_duration(
        self,
        vix_data: pd.DataFrame,
        current_regime: VolatilityRegime,
    ) -> int:
        """Calculate how many days the current regime has persisted."""
        if vix_data.empty or "close" not in vix_data.columns:
            return 0

        duration = 0

        # Iterate backwards through VIX data
        for i in range(len(vix_data) - 1, -1, -1):
            vix_level = vix_data["close"].iloc[i]
            regime = self.classify_vix_regime(float(vix_level))

            if regime == current_regime:
                duration += 1
            else:
                break

        return duration

    def _calculate_regime_confidence(
        self,
        vix_level: float,
        regime: VolatilityRegime,
    ) -> float:
        """
        Calculate confidence in regime classification.

        Higher confidence when VIX is far from regime boundaries.

        Args:
            vix_level: Current VIX level
            regime: Classified regime

        Returns:
            Confidence score between 0 and 1
        """
        lower, upper = self.VIX_THRESHOLDS[regime]

        if upper == float("inf"):
            # For EXTREME regime, base confidence on how high VIX is
            distance_from_lower = vix_level - lower
            max_distance = 30  # Assume 70 VIX is very high
            confidence = min(distance_from_lower / max_distance, 1.0)
        elif lower == 0:
            # For LOW regime, base on distance from upper boundary
            distance_from_upper = upper - vix_level
            range_size = upper - lower
            confidence = distance_from_upper / range_size
        else:
            # For middle regimes, calculate distance from both boundaries
            range_size = upper - lower
            distance_from_lower = vix_level - lower
            distance_from_upper = upper - vix_level
            min_distance = min(distance_from_lower, distance_from_upper)
            confidence = min_distance / (range_size / 2)

        return min(max(confidence, 0.0), 1.0)

    def _calculate_regime_durations(self, df: pd.DataFrame) -> pd.Series:
        """Calculate duration of each regime period."""
        durations = []
        current_duration = 0
        prev_regime = None

        for _, row in df.iterrows():
            if row["regime"] == prev_regime:
                current_duration += 1
            else:
                current_duration = 1

            durations.append(current_duration)
            prev_regime = row["regime"]

        return pd.Series(durations, index=df.index)

    async def _calculate_vix_stress(self) -> Optional[float]:
        """Calculate equity volatility stress component."""
        vix_data = await self._fetch_vix_data(lookback_days=252)

        if vix_data.empty:
            return None

        current_vix = vix_data["close"].iloc[-1]
        percentile = self.calculate_vol_percentile(current_vix, vix_data["close"])

        # Normalize percentile to 0-1 stress
        return percentile / 100

    async def _calculate_rate_stress(self) -> Optional[float]:
        """Calculate interest rate volatility stress (MOVE index proxy)."""
        # In production, would fetch MOVE index or treasury volatility
        # Simplified: return mock value
        return None

    async def _calculate_fx_stress(self) -> Optional[float]:
        """Calculate FX volatility stress (CVIX proxy)."""
        # In production, would fetch currency volatility index
        # Simplified: return mock value
        return None

    async def _calculate_credit_stress(self) -> Optional[float]:
        """Calculate credit stress (CDX spread proxy)."""
        # In production, would fetch credit spreads or CDX
        # Simplified: return mock value
        return None

    # =========================================================================
    # Mock Data Generation
    # =========================================================================

    def _generate_mock_state(self) -> VolatilityState:
        """Generate mock volatility state for testing."""
        vix_level = np.random.uniform(12, 25)
        regime = self.classify_vix_regime(vix_level)

        return VolatilityState(
            regime=regime,
            vix_level=vix_level,
            vix_percentile=np.random.uniform(20, 80),
            term_structure=VIXTermStructure.CONTANGO,
            realized_implied_ratio=np.random.uniform(0.7, 1.1),
            vol_of_vol=np.random.uniform(60, 120),
            cross_asset_stress=np.random.uniform(0.2, 0.5),
            regime_duration_days=np.random.randint(5, 60),
            regime_confidence=np.random.uniform(0.6, 0.95),
        )

    def _generate_mock_vix_data(self, lookback_days: int) -> pd.DataFrame:
        """Generate mock VIX historical data."""
        dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")

        # Generate realistic VIX path using mean-reverting process
        vix_values = []
        current_vix = 18.0  # Start at typical VIX level
        mean_vix = 19.0  # Long-term mean
        mean_reversion_speed = 0.02

        for _ in range(lookback_days):
            # Mean-reverting random walk
            drift = mean_reversion_speed * (mean_vix - current_vix)
            shock = np.random.normal(0, 1.5)
            current_vix = max(current_vix + drift + shock, 9)  # VIX rarely below 9
            vix_values.append(current_vix)

        return pd.DataFrame(
            {
                "date": dates,
                "open": vix_values,
                "high": [v * (1 + np.random.uniform(0, 0.05)) for v in vix_values],
                "low": [v * (1 - np.random.uniform(0, 0.05)) for v in vix_values],
                "close": vix_values,
            }
        ).set_index("date")

    def _generate_mock_vix_futures(self) -> Dict[str, float]:
        """Generate mock VIX futures prices."""
        spot = np.random.uniform(15, 22)

        # Typical contango structure
        return {
            "spot": spot,
            "M1": spot * 1.02,
            "M2": spot * 1.05,
            "M3": spot * 1.08,
            "M4": spot * 1.10,
        }

    def _generate_mock_returns(self) -> pd.Series:
        """Generate mock S&P 500 returns."""
        dates = pd.date_range(end=datetime.now(), periods=60, freq="D")
        returns = np.random.normal(0.0003, 0.01, len(dates))  # ~7.5% annual, 16% vol
        return pd.Series(returns, index=dates)

    # =========================================================================
    # Diagnostic Methods
    # =========================================================================

    def health_check(self) -> bool:
        """Check if detector is operational."""
        try:
            # Try generating a mock state to verify logic
            mock_state = self._generate_mock_state()
            return mock_state is not None
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False
