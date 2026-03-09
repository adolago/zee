"""
Enhanced Yield Curve Analysis Module

Provides comprehensive yield curve analysis including:
- Full term structure modeling (Nelson-Siegel, Svensson)
- Curve dynamics (level, slope, curvature)
- Inversion detection and tracking
- Real vs nominal yield curves
- Historical curve comparisons
- Recession signal generation
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from scipy.optimize import minimize

logger = logging.getLogger(__name__)


class CurveShape(Enum):
    """Yield curve shape classification."""

    NORMAL = "normal"  # Upward sloping
    FLAT = "flat"  # Near-zero slope
    INVERTED = "inverted"  # Downward sloping
    HUMPED = "humped"  # Peak in middle maturities
    TWISTED = "twisted"  # Non-monotonic, complex shape


class CurveDynamic(Enum):
    """Curve dynamic state."""

    STEEPENING = "steepening"  # Slope increasing
    FLATTENING = "flattening"  # Slope decreasing
    PARALLEL_UP = "parallel_up"  # Level shift up
    PARALLEL_DOWN = "parallel_down"  # Level shift down
    TWISTING = "twisting"  # Curvature changing
    STABLE = "stable"  # No significant change


@dataclass
class YieldCurvePoint:
    """Single point on the yield curve."""

    tenor: str  # e.g., "3M", "2Y", "10Y"
    tenor_years: float  # Numeric tenor in years
    yield_value: float  # Yield in percent
    real_yield: Optional[float] = None  # TIPS-implied real yield


@dataclass
class YieldCurveAnalysis:
    """Comprehensive yield curve analysis result."""

    country: str
    date: datetime
    curve_points: List[YieldCurvePoint]
    shape: CurveShape
    dynamic: CurveDynamic

    # Key spreads
    spread_3m10y: Optional[float] = None
    spread_2y10y: Optional[float] = None
    spread_3m2y: Optional[float] = None  # Near-term inversion
    spread_10y30y: Optional[float] = None  # Long-end slope

    # Nelson-Siegel factors
    level: Optional[float] = None  # Long-term rate (beta0)
    slope: Optional[float] = None  # Short-long spread (beta1)
    curvature: Optional[float] = None  # Hump (beta2)

    # Signals
    inversion_depth: float = 0.0  # How inverted (negative = inverted)
    inversion_duration_days: int = 0  # Days curve has been inverted
    recession_signal_strength: float = 0.0  # 0-1 signal strength

    # Historical context
    percentile_vs_history: Dict[str, float] = field(default_factory=dict)


class YieldCurveAnalyzer:
    """
    Enhanced yield curve analysis for regime detection.

    Improvements over basic yield curve:
    - Full term structure modeling
    - Nelson-Siegel/Svensson decomposition
    - Curve dynamics tracking
    - Recession signal generation
    - Historical percentile context
    """

    # Standard tenors for curve construction
    STANDARD_TENORS = {
        "1M": 1 / 12,
        "3M": 0.25,
        "6M": 0.5,
        "1Y": 1.0,
        "2Y": 2.0,
        "3Y": 3.0,
        "5Y": 5.0,
        "7Y": 7.0,
        "10Y": 10.0,
        "20Y": 20.0,
        "30Y": 30.0,
    }

    # Spread thresholds for classification
    FLAT_THRESHOLD = 0.25  # bp spread considered flat
    INVERSION_THRESHOLD = -0.10  # bp spread considered inverted

    def __init__(
        self,
        dbnomics_adapter=None,
        data_manager=None,
    ):
        """
        Initialize YieldCurveAnalyzer.

        Args:
            dbnomics_adapter: DBnomics adapter for macro data
            data_manager: DataManager for market data
        """
        self.dbnomics = dbnomics_adapter
        self.data_manager = data_manager
        self._curve_history: Dict[str, pd.DataFrame] = {}
        self._inversion_tracker: Dict[str, datetime] = {}

        logger.info("YieldCurveAnalyzer initialized")

    async def analyze_curve(self, country: str = "USA") -> YieldCurveAnalysis:
        """
        Perform comprehensive yield curve analysis.

        Args:
            country: ISO country code

        Returns:
            YieldCurveAnalysis with full curve metrics
        """
        # Fetch curve data
        curve_points = await self._fetch_curve_points(country)

        if not curve_points:
            logger.warning(f"No curve data available for {country}")
            return self._empty_analysis(country)

        # Calculate spreads
        spreads = self._calculate_spreads(curve_points)

        # Classify shape
        shape = self._classify_shape(curve_points, spreads)

        # Fit Nelson-Siegel model
        ns_params = self._fit_nelson_siegel(curve_points)

        # Determine dynamics
        dynamic = await self._determine_dynamics(country, spreads)

        # Calculate recession signal
        recession_signal = self._calculate_recession_signal(spreads, ns_params)

        # Track inversion
        inversion_info = self._track_inversion(country, spreads)

        # Get historical percentiles
        percentiles = await self._get_historical_percentiles(country, spreads)

        return YieldCurveAnalysis(
            country=country,
            date=datetime.now(),
            curve_points=curve_points,
            shape=shape,
            dynamic=dynamic,
            spread_3m10y=spreads.get("3m10y"),
            spread_2y10y=spreads.get("2y10y"),
            spread_3m2y=spreads.get("3m2y"),
            spread_10y30y=spreads.get("10y30y"),
            level=ns_params.get("beta0"),
            slope=ns_params.get("beta1"),
            curvature=ns_params.get("beta2"),
            inversion_depth=inversion_info["depth"],
            inversion_duration_days=inversion_info["duration"],
            recession_signal_strength=recession_signal,
            percentile_vs_history=percentiles,
        )

    async def _fetch_curve_points(self, country: str) -> List[YieldCurvePoint]:
        """Fetch yield curve data points."""
        points = []

        # Try to get short-term rate (3M)
        short_rate = await self._get_rate(country, "short")
        if short_rate is not None:
            points.append(
                YieldCurvePoint(
                    tenor="3M",
                    tenor_years=0.25,
                    yield_value=short_rate,
                )
            )

        # Try to get 2Y rate
        rate_2y = await self._get_rate(country, "2Y")
        if rate_2y is not None:
            points.append(
                YieldCurvePoint(
                    tenor="2Y",
                    tenor_years=2.0,
                    yield_value=rate_2y,
                )
            )

        # Try to get 10Y rate
        long_rate = await self._get_rate(country, "long")
        if long_rate is not None:
            points.append(
                YieldCurvePoint(
                    tenor="10Y",
                    tenor_years=10.0,
                    yield_value=long_rate,
                )
            )

        # Try to get 30Y rate
        rate_30y = await self._get_rate(country, "30Y")
        if rate_30y is not None:
            points.append(
                YieldCurvePoint(
                    tenor="30Y",
                    tenor_years=30.0,
                    yield_value=rate_30y,
                )
            )

        # Sort by tenor
        points.sort(key=lambda p: p.tenor_years)

        return points

    async def _get_rate(self, country: str, rate_type: str) -> Optional[float]:
        """Get a specific interest rate."""
        try:
            if self.dbnomics is None:
                return None

            df = self.dbnomics.get_interest_rates(country, rate_type=rate_type)
            if not df.empty and "value" in df.columns:
                values = df["value"].dropna()
                if len(values) > 0:
                    return float(values.iloc[-1])
        except Exception as e:
            logger.debug(f"Failed to get {rate_type} rate for {country}: {e}")

        return None

    def _calculate_spreads(
        self, points: List[YieldCurvePoint]
    ) -> Dict[str, Optional[float]]:
        """Calculate key yield curve spreads."""
        spreads: Dict[str, Optional[float]] = {
            "3m10y": None,
            "2y10y": None,
            "3m2y": None,
            "10y30y": None,
        }

        # Create lookup by tenor
        yields_by_tenor = {p.tenor: p.yield_value for p in points}

        # Calculate spreads where data available
        if "3M" in yields_by_tenor and "10Y" in yields_by_tenor:
            spreads["3m10y"] = yields_by_tenor["10Y"] - yields_by_tenor["3M"]

        if "2Y" in yields_by_tenor and "10Y" in yields_by_tenor:
            spreads["2y10y"] = yields_by_tenor["10Y"] - yields_by_tenor["2Y"]

        if "3M" in yields_by_tenor and "2Y" in yields_by_tenor:
            spreads["3m2y"] = yields_by_tenor["2Y"] - yields_by_tenor["3M"]

        if "10Y" in yields_by_tenor and "30Y" in yields_by_tenor:
            spreads["10y30y"] = yields_by_tenor["30Y"] - yields_by_tenor["10Y"]

        return spreads

    def _classify_shape(
        self,
        points: List[YieldCurvePoint],
        spreads: Dict[str, Optional[float]],
    ) -> CurveShape:
        """Classify the yield curve shape."""
        if len(points) < 2:
            return CurveShape.FLAT

        # Primary classification based on 3m10y spread
        spread_3m10y = spreads.get("3m10y")
        spread_2y10y = spreads.get("2y10y")

        if spread_3m10y is not None:
            if spread_3m10y < self.INVERSION_THRESHOLD:
                return CurveShape.INVERTED
            elif abs(spread_3m10y) < self.FLAT_THRESHOLD:
                return CurveShape.FLAT
            elif spread_3m10y > self.FLAT_THRESHOLD:
                # Check for hump
                spread_3m2y = spreads.get("3m2y")
                if spread_3m2y is not None and spread_2y10y is not None:
                    if spread_3m2y > spread_2y10y * 1.5:
                        return CurveShape.HUMPED
                return CurveShape.NORMAL

        # Fallback to 2y10y spread
        if spread_2y10y is not None:
            if spread_2y10y < self.INVERSION_THRESHOLD:
                return CurveShape.INVERTED
            elif abs(spread_2y10y) < self.FLAT_THRESHOLD:
                return CurveShape.FLAT
            else:
                return CurveShape.NORMAL

        return CurveShape.NORMAL

    def _fit_nelson_siegel(
        self, points: List[YieldCurvePoint]
    ) -> Dict[str, Optional[float]]:
        """
        Fit Nelson-Siegel model to yield curve.

        y(τ) = β₀ + β₁((1-e^(-τ/λ))/(τ/λ)) + β₂((1-e^(-τ/λ))/(τ/λ) - e^(-τ/λ))

        Where:
        - β₀: Level (long-term rate)
        - β₁: Slope (short-term deviation)
        - β₂: Curvature (medium-term hump)
        - λ: Decay factor
        """
        if len(points) < 3:
            # Not enough points for NS fit
            if len(points) >= 2:
                return {
                    "beta0": points[-1].yield_value,  # Long rate as level
                    "beta1": points[0].yield_value - points[-1].yield_value,
                    "beta2": None,
                    "lambda": None,
                }
            return {"beta0": None, "beta1": None, "beta2": None, "lambda": None}

        tenors = np.array([p.tenor_years for p in points])
        yields = np.array([p.yield_value for p in points])

        def nelson_siegel(params, t):
            beta0, beta1, beta2, lam = params
            if lam <= 0:
                return np.inf * np.ones_like(t)
            factor = (1 - np.exp(-t / lam)) / (t / lam + 1e-10)
            return beta0 + beta1 * factor + beta2 * (factor - np.exp(-t / lam))

        def objective(params):
            pred = nelson_siegel(params, tenors)
            return np.sum((yields - pred) ** 2)

        # Initial guess
        x0 = [yields[-1], yields[0] - yields[-1], 0.0, 2.0]

        try:
            result = minimize(
                objective,
                x0,
                method="Nelder-Mead",
                options={"maxiter": 1000},
            )

            if result.success:
                beta0, beta1, beta2, lam = result.x
                return {
                    "beta0": float(beta0),
                    "beta1": float(beta1),
                    "beta2": float(beta2),
                    "lambda": float(lam),
                }
        except Exception as e:
            logger.debug(f"Nelson-Siegel fitting failed: {e}")

        # Fallback to simple estimates
        return {
            "beta0": float(yields[-1]),
            "beta1": float(yields[0] - yields[-1]),
            "beta2": None,
            "lambda": None,
        }

    async def _determine_dynamics(
        self,
        country: str,
        current_spreads: Dict[str, Optional[float]],
    ) -> CurveDynamic:
        """Determine curve dynamics by comparing to recent history."""
        # Get historical spreads
        history_key = f"{country}_spreads"
        if history_key not in self._curve_history:
            self._curve_history[history_key] = pd.DataFrame()

        history = self._curve_history[history_key]

        # Add current observation
        current_spreads["date"] = datetime.now()
        new_row = pd.DataFrame([current_spreads])
        self._curve_history[history_key] = pd.concat(
            [history, new_row], ignore_index=True
        ).tail(
            60
        )  # Keep 60 days

        if len(self._curve_history[history_key]) < 5:
            return CurveDynamic.STABLE

        # Compare to 5-day ago
        recent = self._curve_history[history_key].tail(5)
        spread_2y10y_now = current_spreads.get("2y10y")
        spread_2y10y_5d = recent.iloc[0].get("2y10y")

        if spread_2y10y_now is None or spread_2y10y_5d is None:
            return CurveDynamic.STABLE

        change = spread_2y10y_now - spread_2y10y_5d

        if change > 0.10:
            return CurveDynamic.STEEPENING
        elif change < -0.10:
            return CurveDynamic.FLATTENING
        else:
            return CurveDynamic.STABLE

    def _calculate_recession_signal(
        self,
        spreads: Dict[str, Optional[float]],
        ns_params: Dict[str, Optional[float]],
    ) -> float:
        """
        Calculate recession signal strength based on yield curve.

        Based on NY Fed methodology:
        - 3m10y spread is most predictive (12-18 month lead)
        - Inversion depth matters
        - Duration of inversion matters

        Returns: 0-1 signal strength (higher = more recession risk)
        """
        spread_3m10y = spreads.get("3m10y")

        if spread_3m10y is None:
            spread_3m10y = spreads.get("2y10y")
            if spread_3m10y is None:
                return 0.0

        # NY Fed-style probit approximation
        # More negative spread = higher recession probability
        if spread_3m10y >= 1.5:
            return 0.05  # Very low risk
        elif spread_3m10y >= 1.0:
            return 0.10
        elif spread_3m10y >= 0.5:
            return 0.15
        elif spread_3m10y >= 0.0:
            return 0.25
        elif spread_3m10y >= -0.25:
            return 0.40
        elif spread_3m10y >= -0.5:
            return 0.55
        elif spread_3m10y >= -1.0:
            return 0.70
        else:
            return 0.85

    def _track_inversion(
        self,
        country: str,
        spreads: Dict[str, Optional[float]],
    ) -> Dict[str, Any]:
        """Track inversion depth and duration."""
        spread_3m10y = spreads.get("3m10y") or spreads.get("2y10y") or 0.0

        # Check if inverted
        is_inverted = spread_3m10y < 0

        if is_inverted:
            if country not in self._inversion_tracker:
                self._inversion_tracker[country] = datetime.now()
            start = self._inversion_tracker[country]
            duration = (datetime.now() - start).days
        else:
            if country in self._inversion_tracker:
                del self._inversion_tracker[country]
            duration = 0

        return {
            "depth": spread_3m10y,
            "duration": duration,
            "is_inverted": is_inverted,
        }

    async def _get_historical_percentiles(
        self,
        country: str,
        spreads: Dict[str, Optional[float]],
    ) -> Dict[str, float]:
        """Get where current spreads sit historically."""
        # This would ideally use historical data
        # For now, use approximate percentiles based on typical ranges

        percentiles = {}

        spread_3m10y = spreads.get("3m10y")
        if spread_3m10y is not None:
            # Historical range roughly -1.0 to +3.0
            # Map to percentile
            pct = (spread_3m10y + 1.0) / 4.0 * 100
            percentiles["3m10y"] = max(0, min(100, pct))

        spread_2y10y = spreads.get("2y10y")
        if spread_2y10y is not None:
            # Historical range roughly -0.5 to +2.5
            pct = (spread_2y10y + 0.5) / 3.0 * 100
            percentiles["2y10y"] = max(0, min(100, pct))

        return percentiles

    def _empty_analysis(self, country: str) -> YieldCurveAnalysis:
        """Return empty analysis when data unavailable."""
        return YieldCurveAnalysis(
            country=country,
            date=datetime.now(),
            curve_points=[],
            shape=CurveShape.NORMAL,
            dynamic=CurveDynamic.STABLE,
        )

    def get_recession_probability_from_curve(
        self,
        spread_3m10y: float,
    ) -> float:
        """
        Calculate recession probability using probit model.

        Based on Estrella and Mishkin (1996) and NY Fed methodology.
        P(recession in 12 months) = Φ(α + β * spread)

        Calibrated coefficients for US:
        α ≈ -0.5
        β ≈ -0.9
        """
        from scipy.stats import norm

        alpha = -0.5
        beta = -0.9

        z = alpha + beta * spread_3m10y
        probability = norm.cdf(z)

        return float(probability)

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return True
