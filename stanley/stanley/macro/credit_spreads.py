"""
Credit Spread Monitoring Module

Monitors credit market conditions through:
- Investment Grade (IG) option-adjusted spreads
- High Yield (HY) spreads
- IG-HY spread differential
- Credit spread regimes
- Flight-to-quality indicators
- CDS index proxies
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import logging

logger = logging.getLogger(__name__)


class CreditRegime(Enum):
    """Credit market regime classification."""

    TIGHT = "tight"  # Spreads well below average
    NORMAL = "normal"  # Spreads near historical average
    WIDENING = "widening"  # Spreads above average, trending up
    STRESSED = "stressed"  # Spreads significantly elevated
    CRISIS = "crisis"  # Extreme spread levels


@dataclass
class CreditState:
    """Current state of credit markets."""

    regime: CreditRegime
    ig_spread: float  # IG OAS in bps
    hy_spread: float  # HY OAS in bps
    ig_hy_differential: float  # HY - IG spread
    ig_percentile: float  # Historical percentile (0-100)
    hy_percentile: float  # Historical percentile (0-100)
    spread_momentum: float  # Rate of change (z-score)
    flight_to_quality: float  # FTQ indicator 0-1
    stress_index: float  # Composite stress 0-100
    regime_confidence: float  # Confidence in regime classification (0-1)
    timestamp: datetime = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "regime": self.regime.value,
            "ig_spread_bps": self.ig_spread,
            "hy_spread_bps": self.hy_spread,
            "ig_hy_differential_bps": self.ig_hy_differential,
            "ig_percentile": self.ig_percentile,
            "hy_percentile": self.hy_percentile,
            "spread_momentum": self.spread_momentum,
            "flight_to_quality": self.flight_to_quality,
            "stress_index": self.stress_index,
            "regime_confidence": self.regime_confidence,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class CreditSpreadMonitor:
    """
    Monitor credit spreads and detect stress conditions.

    Tracks investment-grade and high-yield credit spreads to identify
    credit market regimes, stress conditions, and flight-to-quality events.
    """

    # Spread regime thresholds (basis points)
    # Based on historical ICE BofA index distributions
    IG_THRESHOLDS = {
        CreditRegime.TIGHT: (0, 80),
        CreditRegime.NORMAL: (80, 130),
        CreditRegime.WIDENING: (130, 180),
        CreditRegime.STRESSED: (180, 300),
        CreditRegime.CRISIS: (300, float("inf")),
    }

    HY_THRESHOLDS = {
        CreditRegime.TIGHT: (0, 300),
        CreditRegime.NORMAL: (300, 450),
        CreditRegime.WIDENING: (450, 600),
        CreditRegime.STRESSED: (600, 800),
        CreditRegime.CRISIS: (800, float("inf")),
    }

    # FRED series codes for credit spreads
    FRED_SERIES = {
        "ig_oas": "BAMLC0A0CM",  # ICE BofA US Corporate Index OAS
        "hy_oas": "BAMLH0A0HYM2",  # ICE BofA US High Yield Index OAS
        "bbb_oas": "BAMLC0A4CBBB",  # ICE BofA BBB US Corporate Index OAS
        "ccc_oas": "BAMLH0A3HYC",  # ICE BofA CCC & Lower US High Yield Index OAS
        "aa_oas": "BAMLC0A1CAA",  # ICE BofA AA US Corporate Index OAS
        "ted_spread": "TEDRATE",  # TED Spread (Treasury-Eurodollar)
    }

    # ETF proxies for spread estimation when primary data unavailable
    ETF_PROXIES = {
        "ig": ["LQD", "VCIT", "IGIB"],  # IG corporate bond ETFs
        "hy": ["HYG", "JNK", "USHY"],  # HY corporate bond ETFs
        "treasury": ["TLT", "IEF", "SHY"],  # Treasury ETFs
    }

    def __init__(
        self,
        dbnomics_adapter=None,
        data_manager=None,
        history_years: int = 10,
    ):
        """
        Initialize Credit Spread Monitor.

        Args:
            dbnomics_adapter: DBnomics adapter for economic data
            data_manager: Data manager for market data (ETF proxies)
            history_years: Years of history for percentile calculations
        """
        self.dbnomics = dbnomics_adapter
        self.data_manager = data_manager
        self.history_years = history_years
        self._spread_cache: Dict[str, pd.DataFrame] = {}
        self._cache_timestamp: Optional[datetime] = None
        self._cache_ttl_seconds = 3600  # 1 hour cache

    async def get_credit_state(self, country: str = "USA") -> CreditState:
        """
        Get current credit market state.

        Args:
            country: Country code (currently only USA supported)

        Returns:
            CreditState with current market conditions
        """
        # Get current spreads
        ig_spread = await self.get_ig_spread(country)
        hy_spread = await self.get_hy_spread(country)

        # Use fallback values if data unavailable
        if ig_spread is None:
            ig_spread = 120.0  # Approximate long-term average
            logger.warning("Using fallback IG spread value")
        if hy_spread is None:
            hy_spread = 400.0  # Approximate long-term average
            logger.warning("Using fallback HY spread value")

        # Calculate differential
        ig_hy_differential = hy_spread - ig_spread

        # Get historical data for percentile calculations
        ig_history = await self._get_spread_history("ig", country)
        hy_history = await self._get_spread_history("hy", country)

        # Calculate historical percentiles
        ig_percentile = self.get_historical_percentile(ig_spread, ig_history)
        hy_percentile = self.get_historical_percentile(hy_spread, hy_history)

        # Calculate spread momentum (rate of change)
        spread_momentum = self.calculate_spread_momentum(ig_history)

        # Estimate flight-to-quality indicator
        # Using spread momentum as proxy when flow data unavailable
        ftq = self._estimate_flight_to_quality(
            spread_change=spread_momentum,
            ig_percentile=ig_percentile,
            hy_percentile=hy_percentile,
        )

        # Calculate composite stress index
        stress_index = self.calculate_stress_index(
            ig_spread=ig_spread,
            hy_spread=hy_spread,
            spread_momentum=spread_momentum,
            ig_percentile=ig_percentile,
            hy_percentile=hy_percentile,
        )

        # Classify regime
        regime = self.classify_credit_regime(ig_spread, hy_spread)

        # Calculate confidence in regime classification
        regime_confidence = self._calculate_regime_confidence(
            ig_spread=ig_spread,
            hy_spread=hy_spread,
            spread_momentum=spread_momentum,
        )

        return CreditState(
            regime=regime,
            ig_spread=ig_spread,
            hy_spread=hy_spread,
            ig_hy_differential=ig_hy_differential,
            ig_percentile=ig_percentile,
            hy_percentile=hy_percentile,
            spread_momentum=spread_momentum,
            flight_to_quality=ftq,
            stress_index=stress_index,
            regime_confidence=regime_confidence,
        )

    def classify_credit_regime(
        self,
        ig_spread: float,
        hy_spread: float,
    ) -> CreditRegime:
        """
        Classify credit regime from spreads.

        Uses both IG and HY spreads to determine overall credit market regime.
        Takes the more severe classification when they disagree.

        Args:
            ig_spread: Investment grade spread in basis points
            hy_spread: High yield spread in basis points

        Returns:
            CreditRegime classification
        """
        # Classify based on IG spread
        ig_regime = CreditRegime.NORMAL
        for regime, (low, high) in self.IG_THRESHOLDS.items():
            if low <= ig_spread < high:
                ig_regime = regime
                break

        # Classify based on HY spread
        hy_regime = CreditRegime.NORMAL
        for regime, (low, high) in self.HY_THRESHOLDS.items():
            if low <= hy_spread < high:
                hy_regime = regime
                break

        # Order of severity
        severity = [
            CreditRegime.TIGHT,
            CreditRegime.NORMAL,
            CreditRegime.WIDENING,
            CreditRegime.STRESSED,
            CreditRegime.CRISIS,
        ]

        # Return the more severe of the two
        ig_idx = severity.index(ig_regime)
        hy_idx = severity.index(hy_regime)

        return severity[max(ig_idx, hy_idx)]

    async def get_ig_spread(self, country: str = "USA") -> Optional[float]:
        """
        Get Investment Grade OAS.

        Sources:
        - Primary: FRED BAMLC0A0CM (ICE BofA US Corporate Index OAS)
        - Fallback: DBnomics BIS credit data
        - ETF proxy: LQD vs Treasury spread estimation

        Args:
            country: Country code (currently only USA supported)

        Returns:
            IG spread in basis points, or None if unavailable
        """
        if country != "USA":
            logger.warning(f"IG spreads only available for USA, got {country}")
            return None

        # Try FRED via DBnomics
        if self.dbnomics:
            try:
                df = self.dbnomics.fetch_series(
                    provider_code="FRED",
                    dataset_code="FRED",
                    series_code=self.FRED_SERIES["ig_oas"],
                )
                if not df.empty and "value" in df.columns:
                    # Get the most recent value
                    latest = df.sort_values("period", ascending=False).iloc[0]
                    spread_pct = float(latest["value"])
                    # FRED stores as percentage, convert to bps
                    return spread_pct * 100
            except Exception as e:
                logger.debug(f"FRED IG spread fetch failed: {e}")

        # Try ETF proxy estimation
        try:
            spread = await self._estimate_spread_from_etf("ig")
            if spread is not None:
                return spread
        except Exception as e:
            logger.debug(f"ETF proxy IG spread estimation failed: {e}")

        return None

    async def get_hy_spread(self, country: str = "USA") -> Optional[float]:
        """
        Get High Yield OAS.

        Sources:
        - Primary: FRED BAMLH0A0HYM2 (ICE BofA US High Yield Index OAS)
        - Fallback: DBnomics BIS credit data
        - ETF proxy: HYG vs Treasury spread estimation

        Args:
            country: Country code (currently only USA supported)

        Returns:
            HY spread in basis points, or None if unavailable
        """
        if country != "USA":
            logger.warning(f"HY spreads only available for USA, got {country}")
            return None

        # Try FRED via DBnomics
        if self.dbnomics:
            try:
                df = self.dbnomics.fetch_series(
                    provider_code="FRED",
                    dataset_code="FRED",
                    series_code=self.FRED_SERIES["hy_oas"],
                )
                if not df.empty and "value" in df.columns:
                    latest = df.sort_values("period", ascending=False).iloc[0]
                    spread_pct = float(latest["value"])
                    return spread_pct * 100
            except Exception as e:
                logger.debug(f"FRED HY spread fetch failed: {e}")

        # Try ETF proxy estimation
        try:
            spread = await self._estimate_spread_from_etf("hy")
            if spread is not None:
                return spread
        except Exception as e:
            logger.debug(f"ETF proxy HY spread estimation failed: {e}")

        return None

    async def _estimate_spread_from_etf(
        self,
        spread_type: str,
    ) -> Optional[float]:
        """
        Estimate credit spread from ETF yield differential.

        Uses credit ETF vs Treasury ETF yield spread as proxy.

        Args:
            spread_type: "ig" or "hy"

        Returns:
            Estimated spread in basis points
        """
        if self.data_manager is None:
            return None

        # Get ETF symbols
        credit_etfs = self.ETF_PROXIES.get(spread_type, [])
        treasury_etfs = self.ETF_PROXIES.get("treasury", [])

        if not credit_etfs or not treasury_etfs:
            return None

        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)

            # Get credit ETF data
            credit_data = await self.data_manager.get_stock_data(
                symbol=credit_etfs[0],
                start_date=start_date,
                end_date=end_date,
            )

            # Get treasury ETF data
            treasury_data = await self.data_manager.get_stock_data(
                symbol=treasury_etfs[1],  # IEF - intermediate duration
                start_date=start_date,
                end_date=end_date,
            )

            if credit_data.empty or treasury_data.empty:
                return None

            # Estimate yield from price performance
            # This is a simplified proxy - actual yield would need dividend data
            credit_return = (
                credit_data["close"].iloc[-1] / credit_data["close"].iloc[0] - 1
            )
            treasury_return = (
                treasury_data["close"].iloc[-1] / treasury_data["close"].iloc[0] - 1
            )

            # Convert to annualized spread (rough approximation)
            # Negative return relative to treasuries indicates higher spread
            spread_estimate = (treasury_return - credit_return) * 12 * 100  # Annualize

            # Apply baseline spreads based on type
            if spread_type == "ig":
                # IG baseline around 100 bps
                baseline = 100
            else:
                # HY baseline around 400 bps
                baseline = 400

            # Combine baseline with relative performance
            spread = max(0, baseline + spread_estimate * 10)  # Scale factor

            return spread

        except Exception as e:
            logger.debug(f"ETF spread estimation failed: {e}")
            return None

    async def _get_spread_history(
        self,
        spread_type: str,
        country: str = "USA",
    ) -> pd.Series:
        """
        Get historical spread data for percentile calculations.

        Args:
            spread_type: "ig" or "hy"
            country: Country code

        Returns:
            Series of historical spread values
        """
        cache_key = f"{spread_type}_{country}"

        # Check cache
        if self._is_cache_valid() and cache_key in self._spread_cache:
            df = self._spread_cache[cache_key]
            if "value" in df.columns:
                return df["value"]

        if self.dbnomics and country == "USA":
            try:
                series_code = (
                    self.FRED_SERIES["ig_oas"]
                    if spread_type == "ig"
                    else self.FRED_SERIES["hy_oas"]
                )

                df = self.dbnomics.fetch_series(
                    provider_code="FRED",
                    dataset_code="FRED",
                    series_code=series_code,
                    max_results=500,
                )

                if not df.empty:
                    self._spread_cache[cache_key] = df
                    self._cache_timestamp = datetime.now()
                    if "value" in df.columns:
                        return df["value"] * 100  # Convert to bps

            except Exception as e:
                logger.debug(f"Historical spread fetch failed: {e}")

        # Return synthetic historical data as fallback
        return self._generate_synthetic_history(spread_type)

    def _generate_synthetic_history(
        self,
        spread_type: str,
        n_points: int = 2520,  # ~10 years of daily data
    ) -> pd.Series:
        """
        Generate synthetic historical spread data for percentile calculations.

        Based on typical spread distribution characteristics.

        Args:
            spread_type: "ig" or "hy"
            n_points: Number of historical points

        Returns:
            Series with synthetic spread history
        """
        np.random.seed(42)  # Reproducible

        if spread_type == "ig":
            # IG: mean ~110 bps, with occasional stress events
            base = np.random.lognormal(mean=np.log(110), sigma=0.3, size=n_points)
            # Add some stress spikes
            stress_mask = np.random.random(n_points) < 0.02
            base[stress_mask] *= 2
        else:
            # HY: mean ~400 bps, higher volatility
            base = np.random.lognormal(mean=np.log(400), sigma=0.4, size=n_points)
            stress_mask = np.random.random(n_points) < 0.02
            base[stress_mask] *= 2.5

        return pd.Series(base)

    def calculate_flight_to_quality(
        self,
        treasury_flows: float,
        credit_flows: float,
        spread_change: float,
    ) -> float:
        """
        Flight-to-quality indicator.

        Combines treasury inflows, credit outflows, and spread widening
        to measure flight-to-quality pressure.

        Args:
            treasury_flows: Treasury fund flows (positive = inflow)
            credit_flows: Credit fund flows (negative = outflow)
            spread_change: Recent spread change (positive = widening)

        Returns:
            FTQ indicator from 0 (no FTQ) to 1 (strong FTQ)
        """
        # Normalize each component to 0-1 range
        # Treasury inflows positive contributes to FTQ
        treasury_signal = min(1.0, max(0.0, treasury_flows / 1e9))  # Scale by $1B

        # Credit outflows negative contributes to FTQ
        credit_signal = min(1.0, max(0.0, -credit_flows / 1e9))  # Scale by $1B

        # Spread widening contributes to FTQ
        spread_signal = min(1.0, max(0.0, spread_change / 50))  # Scale by 50 bps

        # Weighted combination
        ftq = 0.4 * treasury_signal + 0.3 * credit_signal + 0.3 * spread_signal

        return min(1.0, max(0.0, ftq))

    def _estimate_flight_to_quality(
        self,
        spread_change: float,
        ig_percentile: float,
        hy_percentile: float,
    ) -> float:
        """
        Estimate FTQ when flow data is unavailable.

        Uses spread dynamics and percentile positions as proxies.

        Args:
            spread_change: Spread momentum (z-score)
            ig_percentile: IG spread percentile
            hy_percentile: HY spread percentile

        Returns:
            Estimated FTQ indicator 0-1
        """
        # Spread widening signal (positive z-score = widening)
        spread_signal = min(1.0, max(0.0, spread_change / 2))  # Normalize z-score

        # High percentiles indicate elevated spreads
        percentile_signal = (ig_percentile + hy_percentile) / 200

        # HY widening faster than IG indicates risk aversion
        hy_ig_divergence = max(0, (hy_percentile - ig_percentile) / 100)

        # Combine signals
        ftq = 0.4 * spread_signal + 0.3 * percentile_signal + 0.3 * hy_ig_divergence

        return min(1.0, max(0.0, ftq))

    def calculate_spread_momentum(
        self,
        spread_series: pd.Series,
        window: int = 20,
    ) -> float:
        """
        Calculate spread momentum (z-score of change).

        Measures how quickly spreads are changing relative to recent history.

        Args:
            spread_series: Historical spread values
            window: Lookback window for momentum calculation

        Returns:
            Momentum as z-score (positive = widening, negative = tightening)
        """
        if len(spread_series) < window + 1:
            return 0.0

        try:
            # Calculate rolling changes
            changes = spread_series.diff()

            # Get recent change
            recent_change = changes.iloc[-1]

            # Calculate z-score of recent change
            change_mean = changes.iloc[-window:].mean()
            change_std = changes.iloc[-window:].std()

            if change_std == 0 or np.isnan(change_std):
                return 0.0

            momentum = (recent_change - change_mean) / change_std

            return float(np.clip(momentum, -3, 3))

        except Exception as e:
            logger.debug(f"Momentum calculation failed: {e}")
            return 0.0

    def calculate_stress_index(
        self,
        ig_spread: float,
        hy_spread: float,
        spread_momentum: float,
        ig_percentile: float = None,
        hy_percentile: float = None,
    ) -> float:
        """
        Composite credit stress index 0-100.

        Components:
        - Current spread levels (40%)
        - Historical percentile (30%)
        - Rate of change/momentum (30%)

        Args:
            ig_spread: IG spread in bps
            hy_spread: HY spread in bps
            spread_momentum: Spread momentum z-score
            ig_percentile: Optional pre-calculated IG percentile
            hy_percentile: Optional pre-calculated HY percentile

        Returns:
            Stress index from 0 (relaxed) to 100 (crisis)
        """
        # Component 1: Current spread levels (40%)
        # Map spreads to 0-100 scale based on thresholds
        ig_level_score = self._spread_to_score(ig_spread, "ig")
        hy_level_score = self._spread_to_score(hy_spread, "hy")
        level_score = (ig_level_score + hy_level_score) / 2

        # Component 2: Historical percentile (30%)
        if ig_percentile is not None and hy_percentile is not None:
            percentile_score = (ig_percentile + hy_percentile) / 2
        else:
            percentile_score = 50.0  # Neutral if unavailable

        # Component 3: Momentum (30%)
        # Map z-score to 0-100, centered at 50
        momentum_score = 50 + (spread_momentum / 3) * 50  # Z-score of 3 = 100
        momentum_score = np.clip(momentum_score, 0, 100)

        # Weighted combination
        stress_index = 0.4 * level_score + 0.3 * percentile_score + 0.3 * momentum_score

        return float(np.clip(stress_index, 0, 100))

    def _spread_to_score(self, spread: float, spread_type: str) -> float:
        """
        Convert spread to 0-100 stress score.

        Args:
            spread: Spread in bps
            spread_type: "ig" or "hy"

        Returns:
            Score from 0 to 100
        """
        thresholds = self.IG_THRESHOLDS if spread_type == "ig" else self.HY_THRESHOLDS

        # Map regime to base score
        regime_scores = {
            CreditRegime.TIGHT: 0,
            CreditRegime.NORMAL: 25,
            CreditRegime.WIDENING: 50,
            CreditRegime.STRESSED: 75,
            CreditRegime.CRISIS: 100,
        }

        for regime, (low, high) in thresholds.items():
            if low <= spread < high:
                base_score = regime_scores[regime]
                # Interpolate within regime
                if high != float("inf"):
                    regime_range = high - low
                    position = (spread - low) / regime_range
                    score_range = 25  # Each regime spans 25 points
                    return base_score + position * score_range
                else:
                    return 100  # Crisis regime

        return 50.0  # Default

    def get_historical_percentile(
        self,
        current_spread: float,
        spread_history: pd.Series,
    ) -> float:
        """
        Get where current spread sits historically.

        Args:
            current_spread: Current spread value
            spread_history: Historical spread values

        Returns:
            Percentile from 0 to 100
        """
        if spread_history is None or len(spread_history) == 0:
            return 50.0  # Neutral if no history

        try:
            # Remove NaN values
            history = spread_history.dropna()

            if len(history) == 0:
                return 50.0

            # Calculate percentile
            percentile = (history < current_spread).sum() / len(history) * 100

            return float(np.clip(percentile, 0, 100))

        except Exception as e:
            logger.debug(f"Percentile calculation failed: {e}")
            return 50.0

    def _calculate_regime_confidence(
        self,
        ig_spread: float,
        hy_spread: float,
        spread_momentum: float,
    ) -> float:
        """
        Calculate confidence in regime classification.

        Higher confidence when:
        - Both IG and HY agree on regime
        - Spreads are well within regime boundaries (not on edges)
        - Momentum confirms regime direction

        Args:
            ig_spread: IG spread in bps
            hy_spread: HY spread in bps
            spread_momentum: Spread momentum

        Returns:
            Confidence from 0 to 1
        """
        # Classify each independently
        ig_regime = CreditRegime.NORMAL
        hy_regime = CreditRegime.NORMAL

        for regime, (low, high) in self.IG_THRESHOLDS.items():
            if low <= ig_spread < high:
                ig_regime = regime
                # Calculate distance from boundaries
                if high != float("inf"):
                    ig_boundary_distance = min(ig_spread - low, high - ig_spread) / (
                        high - low
                    )
                else:
                    ig_boundary_distance = min(1.0, (ig_spread - low) / low)
                break

        for regime, (low, high) in self.HY_THRESHOLDS.items():
            if low <= hy_spread < high:
                hy_regime = regime
                if high != float("inf"):
                    hy_boundary_distance = min(hy_spread - low, high - hy_spread) / (
                        high - low
                    )
                else:
                    hy_boundary_distance = min(1.0, (hy_spread - low) / low)
                break

        # Regime agreement bonus
        agreement_score = 1.0 if ig_regime == hy_regime else 0.6

        # Boundary distance score (0.5 max when in middle of regime)
        boundary_score = (
            (ig_boundary_distance + hy_boundary_distance) / 2
            if "ig_boundary_distance" in dir() and "hy_boundary_distance" in dir()
            else 0.3
        )

        # Momentum confirmation
        overall_regime = self.classify_credit_regime(ig_spread, hy_spread)
        momentum_confirms = False

        if overall_regime in [
            CreditRegime.WIDENING,
            CreditRegime.STRESSED,
            CreditRegime.CRISIS,
        ]:
            momentum_confirms = spread_momentum > 0
        elif overall_regime == CreditRegime.TIGHT:
            momentum_confirms = spread_momentum < 0
        else:
            momentum_confirms = abs(spread_momentum) < 1

        momentum_score = 0.2 if momentum_confirms else 0.0

        # Combine scores
        confidence = (
            0.4 * agreement_score
            + 0.4 * boundary_score
            + 0.2 * (1 if momentum_confirms else 0)
        )

        return float(np.clip(confidence, 0, 1))

    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid."""
        if self._cache_timestamp is None:
            return False
        elapsed = (datetime.now() - self._cache_timestamp).total_seconds()
        return elapsed < self._cache_ttl_seconds

    def clear_cache(self) -> None:
        """Clear the spread cache."""
        self._spread_cache.clear()
        self._cache_timestamp = None
        logger.info("Credit spread cache cleared")

    async def get_spread_term_structure(
        self,
        country: str = "USA",
    ) -> Dict[str, float]:
        """
        Get credit spread term structure across ratings.

        Returns spreads for different credit quality tiers.

        Args:
            country: Country code

        Returns:
            Dictionary with spreads by rating tier
        """
        if country != "USA" or self.dbnomics is None:
            return {}

        spreads = {}

        rating_series = {
            "AA": self.FRED_SERIES.get("aa_oas"),
            "BBB": self.FRED_SERIES.get("bbb_oas"),
            "HY": self.FRED_SERIES.get("hy_oas"),
            "CCC": self.FRED_SERIES.get("ccc_oas"),
        }

        for rating, series_code in rating_series.items():
            if series_code is None:
                continue

            try:
                df = self.dbnomics.fetch_series(
                    provider_code="FRED",
                    dataset_code="FRED",
                    series_code=series_code,
                )

                if not df.empty and "value" in df.columns:
                    latest = df.sort_values("period", ascending=False).iloc[0]
                    spreads[rating] = float(latest["value"]) * 100  # Convert to bps

            except Exception as e:
                logger.debug(f"Term structure fetch failed for {rating}: {e}")

        return spreads

    async def get_credit_risk_premium(
        self,
        country: str = "USA",
    ) -> Dict[str, float]:
        """
        Calculate credit risk premiums across tiers.

        Returns the incremental spread for moving down the credit spectrum.

        Args:
            country: Country code

        Returns:
            Dictionary with risk premiums
        """
        term_structure = await self.get_spread_term_structure(country)

        if len(term_structure) < 2:
            return {}

        premiums = {}

        # Calculate incremental risk premiums
        tiers = ["AA", "BBB", "HY", "CCC"]
        prev_spread = None
        prev_tier = None

        for tier in tiers:
            if tier in term_structure:
                if prev_spread is not None:
                    premiums[f"{prev_tier}_to_{tier}"] = (
                        term_structure[tier] - prev_spread
                    )
                prev_spread = term_structure[tier]
                prev_tier = tier

        return premiums
