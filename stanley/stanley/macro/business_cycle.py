"""
Business Cycle Analyzer Module

NBER-style business cycle phase detection with:
- Peak/trough identification using Bry-Boschan algorithm
- Leading Economic Indicators (LEI) composite
- Sahm Rule recession indicator
- Growth-Inflation quadrant classification
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .dbnomics_adapter import DBnomicsAdapter

logger = logging.getLogger(__name__)


class CyclePhase(Enum):
    """Business cycle phases."""

    EXPANSION = "expansion"
    PEAK = "peak"
    CONTRACTION = "contraction"
    TROUGH = "trough"
    EARLY_RECOVERY = "early_recovery"
    LATE_CYCLE = "late_cycle"


class GrowthInflationQuadrant(Enum):
    """Growth-inflation regime quadrants."""

    GOLDILOCKS = "goldilocks"  # Above-trend growth, below-trend inflation
    REFLATION = "reflation"  # Above-trend growth, above-trend inflation
    STAGFLATION = "stagflation"  # Below-trend growth, above-trend inflation
    DEFLATION = "deflation"  # Below-trend growth, below-trend inflation


@dataclass
class CycleState:
    """Current business cycle state."""

    phase: CyclePhase
    phase_duration_months: int
    phase_start_date: Optional[datetime]
    confidence: float  # 0-1
    leading_indicators: Dict[str, float]
    sahm_indicator: Optional[float]
    growth_inflation_quadrant: str  # goldilocks, reflation, stagflation, deflation


@dataclass
class TurningPoint:
    """A cycle turning point (peak or trough)."""

    date: datetime
    point_type: str  # "peak" or "trough"
    value: float
    confirmed: bool = True


@dataclass
class LEIComponent:
    """Leading Economic Indicator component."""

    name: str
    weight: float
    current_value: Optional[float] = None
    contribution: Optional[float] = None
    signal: Optional[str] = None  # "positive", "negative", "neutral"


class BusinessCycleAnalyzer:
    """
    Analyze business cycle phases using multiple methodologies.

    Implements:
    - NBER-style cycle dating
    - Bry-Boschan turning point algorithm
    - Sahm Rule recession indicator
    - Leading Economic Indicators (LEI) composite
    - Growth-inflation quadrant classification
    """

    # LEI component weights (based on Conference Board methodology)
    LEI_WEIGHTS: Dict[str, float] = {
        "yield_spread": 0.20,  # 10Y-3M Treasury spread
        "building_permits": 0.10,  # New private housing permits
        "stock_prices": 0.10,  # S&P 500
        "initial_claims": 0.10,  # Initial unemployment claims
        "consumer_expectations": 0.10,  # Consumer expectations index
        "ism_new_orders": 0.10,  # ISM new orders index
        "credit_conditions": 0.10,  # Credit conditions
        "manufacturing_hours": 0.10,  # Average weekly hours manufacturing
        "vendor_performance": 0.05,  # Supplier delivery times
        "new_orders_consumer": 0.05,  # New orders consumer goods
    }

    # Sahm Rule threshold
    SAHM_THRESHOLD: float = 0.5  # 0.5 percentage points

    def __init__(
        self,
        dbnomics_adapter: Optional[DBnomicsAdapter] = None,
        data_manager: Optional[Any] = None,
    ):
        """
        Initialize BusinessCycleAnalyzer.

        Args:
            dbnomics_adapter: DBnomics adapter instance for data fetching
            data_manager: Optional DataManager for additional data sources
        """
        self.dbnomics = dbnomics_adapter or DBnomicsAdapter()
        self.data_manager = data_manager

        logger.info("BusinessCycleAnalyzer initialized")

    def get_cycle_state(self, country: str = "USA") -> CycleState:
        """
        Get current business cycle state for a country.

        Args:
            country: ISO country code (default: USA)

        Returns:
            CycleState with current phase, indicators, and confidence
        """
        logger.info(f"Analyzing business cycle state for {country}")

        # Calculate individual components
        sahm = self.calculate_sahm_rule(country)
        lei_composite = self.calculate_lei_composite(country)
        leading_indicators = self._get_leading_indicators(country)

        # Get growth and inflation for quadrant
        gdp_growth = self._get_gdp_growth(country)
        inflation = self._get_inflation_rate(country)
        quadrant = self.get_growth_inflation_quadrant(gdp_growth, inflation)

        # Determine phase based on multiple signals
        phase, confidence, phase_start = self._determine_phase(
            country=country,
            sahm=sahm,
            lei_composite=lei_composite,
            gdp_growth=gdp_growth,
            leading_indicators=leading_indicators,
        )

        # Calculate phase duration
        phase_duration = self._calculate_phase_duration(phase_start)

        return CycleState(
            phase=phase,
            phase_duration_months=phase_duration,
            phase_start_date=phase_start,
            confidence=confidence,
            leading_indicators=leading_indicators,
            sahm_indicator=sahm,
            growth_inflation_quadrant=quadrant,
        )

    def calculate_lei_composite(self, country: str = "USA") -> float:
        """
        Calculate Leading Economic Indicators composite.

        The LEI is a weighted composite of multiple leading indicators
        designed to signal turning points in the business cycle.

        Args:
            country: ISO country code

        Returns:
            LEI composite value (100 = trend)
        """
        logger.debug(f"Calculating LEI composite for {country}")

        components = self._get_lei_components(country)
        weighted_sum = 0.0
        total_weight = 0.0

        for component in components:
            if component.current_value is not None:
                # Normalize to index (100 = neutral/trend)
                normalized = self._normalize_indicator(
                    component.name, component.current_value
                )
                contribution = normalized * component.weight
                weighted_sum += contribution
                total_weight += component.weight

                component.contribution = contribution
                component.signal = self._get_signal_from_value(
                    component.name, component.current_value
                )

        if total_weight > 0:
            return weighted_sum / total_weight
        else:
            logger.warning(f"No LEI components available for {country}")
            return 100.0  # Neutral default

    def calculate_sahm_rule(self, country: str = "USA") -> Optional[float]:
        """
        Calculate Sahm Rule recession indicator.

        The Sahm Rule signals recession when the 3-month moving average
        of the national unemployment rate rises by 0.5 percentage points
        or more relative to its low during the previous 12 months.

        Args:
            country: ISO country code

        Returns:
            Sahm indicator value (>0.5 signals recession), or None if unavailable
        """
        logger.debug(f"Calculating Sahm Rule for {country}")

        try:
            unemp_df = self.dbnomics.get_unemployment(country)
            if unemp_df.empty or "value" not in unemp_df.columns:
                logger.warning(f"No unemployment data for {country}")
                return None

            values = unemp_df["value"].dropna()
            if len(values) < 15:  # Need at least 15 months
                logger.warning(f"Insufficient unemployment data for {country}")
                return None

            # Calculate 3-month moving average
            ma3 = values.rolling(window=3).mean()

            # Find 12-month low of the 3-month MA
            low_12m = ma3.iloc[-12:].min()

            # Sahm indicator: current MA minus 12-month low
            sahm_value = ma3.iloc[-1] - low_12m

            logger.debug(f"Sahm indicator for {country}: {sahm_value:.2f}")
            return float(sahm_value)

        except Exception as e:
            logger.error(f"Failed to calculate Sahm Rule for {country}: {e}")
            return None

    def identify_turning_points(
        self,
        series: pd.Series,
        window: int = 5,
        min_phase_length: int = 6,
        min_cycle_length: int = 15,
    ) -> pd.DataFrame:
        """
        Identify turning points using Bry-Boschan algorithm.

        The Bry-Boschan algorithm identifies peaks and troughs in
        economic time series with constraints on minimum durations.

        Args:
            series: Time series data (index should be datetime)
            window: Local extremum window size (months)
            min_phase_length: Minimum duration of expansion/contraction (months)
            min_cycle_length: Minimum duration of full cycle (months)

        Returns:
            DataFrame with columns: date, type (peak/trough), value
        """
        logger.debug(f"Identifying turning points with window={window}")

        if len(series) < window * 2 + 1:
            logger.warning("Series too short for turning point analysis")
            return pd.DataFrame(columns=["date", "type", "value"])

        # Step 1: Find local extrema
        peaks = []
        troughs = []

        for i in range(window, len(series) - window):
            local_window = series.iloc[i - window : i + window + 1]
            center_value = series.iloc[i]

            if center_value == local_window.max():
                peaks.append((series.index[i], center_value))
            elif center_value == local_window.min():
                troughs.append((series.index[i], center_value))

        # Step 2: Enforce alternation (peak must follow trough and vice versa)
        turning_points = self._enforce_alternation(peaks, troughs)

        # Step 3: Apply minimum phase length constraint
        turning_points = self._apply_phase_constraints(turning_points, min_phase_length)

        # Step 4: Apply minimum cycle length constraint
        turning_points = self._apply_cycle_constraints(turning_points, min_cycle_length)

        # Convert to DataFrame
        if turning_points:
            df = pd.DataFrame(turning_points, columns=["date", "type", "value"])
            df = df.sort_values("date").reset_index(drop=True)
            return df
        else:
            return pd.DataFrame(columns=["date", "type", "value"])

    def get_growth_inflation_quadrant(
        self,
        gdp_growth: Optional[float],
        inflation: Optional[float],
        growth_trend: float = 2.0,
        inflation_trend: float = 2.5,
    ) -> str:
        """
        Classify current state into growth-inflation quadrant.

        Args:
            gdp_growth: Year-over-year GDP growth rate
            inflation: Year-over-year inflation rate
            growth_trend: Long-term trend growth (default 2.0%)
            inflation_trend: Trend inflation (default 2.5%)

        Returns:
            Quadrant name: goldilocks, reflation, stagflation, or deflation
        """
        if gdp_growth is None or inflation is None:
            logger.warning("Missing growth or inflation data for quadrant")
            return "unknown"

        above_trend_growth = gdp_growth > growth_trend
        above_trend_inflation = inflation > inflation_trend

        if above_trend_growth and not above_trend_inflation:
            return GrowthInflationQuadrant.GOLDILOCKS.value
        elif above_trend_growth and above_trend_inflation:
            return GrowthInflationQuadrant.REFLATION.value
        elif not above_trend_growth and above_trend_inflation:
            return GrowthInflationQuadrant.STAGFLATION.value
        else:
            return GrowthInflationQuadrant.DEFLATION.value

    def get_cycle_history(
        self,
        country: str = "USA",
        start_date: Optional[datetime] = None,
    ) -> pd.DataFrame:
        """
        Get historical business cycle dates.

        Args:
            country: ISO country code
            start_date: Start date for history

        Returns:
            DataFrame with cycle dates and durations
        """
        logger.debug(f"Fetching cycle history for {country}")

        try:
            # Get GDP or industrial production for cycle dating
            gdp_df = self.dbnomics.get_gdp(country, frequency="Q", real=True)
            if gdp_df.empty:
                return pd.DataFrame()

            if "value" not in gdp_df.columns:
                return pd.DataFrame()

            values = gdp_df["value"].dropna()
            if "period" in gdp_df.columns:
                values.index = pd.to_datetime(gdp_df["period"])

            # Identify turning points
            turning_points = self.identify_turning_points(values)

            if turning_points.empty:
                return pd.DataFrame()

            # Calculate durations
            turning_points["duration_months"] = (
                turning_points["date"].diff().dt.days / 30
            ).round()

            return turning_points

        except Exception as e:
            logger.error(f"Failed to get cycle history for {country}: {e}")
            return pd.DataFrame()

    def analyze_recession_probability(self, country: str = "USA") -> Dict[str, Any]:
        """
        Estimate recession probability using multiple indicators.

        Args:
            country: ISO country code

        Returns:
            Dictionary with probability and contributing factors
        """
        logger.debug(f"Analyzing recession probability for {country}")

        factors = {}
        weights = {}

        # Sahm Rule (heavy weight if triggered)
        sahm = self.calculate_sahm_rule(country)
        if sahm is not None:
            if sahm >= self.SAHM_THRESHOLD:
                factors["sahm_rule"] = 0.9  # High probability if triggered
                weights["sahm_rule"] = 0.35
            else:
                # Scale probability based on proximity to threshold
                factors["sahm_rule"] = min(1.0, sahm / self.SAHM_THRESHOLD * 0.5)
                weights["sahm_rule"] = 0.25

        # Yield curve
        yield_spread = self._get_yield_spread(country)
        if yield_spread is not None:
            if yield_spread < 0:
                # Inverted curve - high recession signal
                factors["yield_curve"] = min(1.0, 0.5 + abs(yield_spread) * 0.2)
            else:
                factors["yield_curve"] = max(0, 0.3 - yield_spread * 0.1)
            weights["yield_curve"] = 0.25

        # LEI composite
        lei = self.calculate_lei_composite(country)
        if lei < 100:
            factors["lei_composite"] = min(1.0, (100 - lei) * 0.02)
        else:
            factors["lei_composite"] = 0.0
        weights["lei_composite"] = 0.20

        # GDP growth momentum
        gdp_growth = self._get_gdp_growth(country)
        if gdp_growth is not None:
            if gdp_growth < 0:
                factors["gdp_momentum"] = min(1.0, 0.5 + abs(gdp_growth) * 0.1)
            elif gdp_growth < 1:
                factors["gdp_momentum"] = 0.3
            else:
                factors["gdp_momentum"] = max(0, 0.2 - gdp_growth * 0.05)
            weights["gdp_momentum"] = 0.20

        # Calculate weighted probability
        total_weight = sum(weights.values())
        if total_weight > 0:
            probability = (
                sum(factors.get(k, 0) * w for k, w in weights.items()) / total_weight
            )
        else:
            probability = 0.0

        return {
            "country": country,
            "timestamp": datetime.now(),
            "recession_probability": round(probability, 3),
            "factors": factors,
            "weights": weights,
            "sahm_indicator": sahm,
            "lei_composite": lei,
            "interpretation": self._interpret_probability(probability),
        }

    # =========================================================================
    # Private Helper Methods
    # =========================================================================

    def _get_leading_indicators(self, country: str) -> Dict[str, float]:
        """Get current values of leading indicators."""
        indicators = {}

        # Yield spread
        spread = self._get_yield_spread(country)
        if spread is not None:
            indicators["yield_spread"] = spread

        # Unemployment
        try:
            unemp_df = self.dbnomics.get_unemployment(country)
            if not unemp_df.empty and "value" in unemp_df.columns:
                indicators["unemployment_rate"] = float(
                    unemp_df["value"].dropna().iloc[-1]
                )
        except Exception:
            pass

        # GDP growth
        gdp_growth = self._get_gdp_growth(country)
        if gdp_growth is not None:
            indicators["gdp_growth"] = gdp_growth

        # Inflation
        inflation = self._get_inflation_rate(country)
        if inflation is not None:
            indicators["inflation"] = inflation

        return indicators

    def _get_lei_components(self, country: str) -> List[LEIComponent]:
        """Get LEI component values for a country."""
        components = []

        for name, weight in self.LEI_WEIGHTS.items():
            value = self._fetch_lei_component(country, name)
            components.append(
                LEIComponent(name=name, weight=weight, current_value=value)
            )

        return components

    def _fetch_lei_component(
        self, country: str, component_name: str
    ) -> Optional[float]:
        """Fetch individual LEI component value."""
        try:
            if component_name == "yield_spread":
                return self._get_yield_spread(country)
            elif component_name == "initial_claims":
                return self._get_initial_claims(country)
            # Additional components would be implemented here
            # For now, return None for unavailable components
            return None
        except Exception as e:
            logger.debug(f"Failed to fetch {component_name} for {country}: {e}")
            return None

    def _get_yield_spread(self, country: str) -> Optional[float]:
        """Get 10Y-3M yield spread."""
        try:
            short_df = self.dbnomics.get_interest_rates(country, rate_type="short")
            long_df = self.dbnomics.get_interest_rates(country, rate_type="long")

            if (
                not short_df.empty
                and not long_df.empty
                and "value" in short_df.columns
                and "value" in long_df.columns
            ):
                short_rate = short_df["value"].dropna().iloc[-1]
                long_rate = long_df["value"].dropna().iloc[-1]
                return float(long_rate - short_rate)
        except Exception as e:
            logger.debug(f"Failed to get yield spread for {country}: {e}")
        return None

    def _get_initial_claims(self, country: str) -> Optional[float]:
        """Get initial unemployment claims (US only)."""
        if country != "USA":
            return None

        # Would need FRED data source
        # Placeholder for future implementation
        return None

    def _get_gdp_growth(self, country: str) -> Optional[float]:
        """Get year-over-year GDP growth."""
        try:
            gdp_df = self.dbnomics.get_gdp(country, frequency="Q", real=True)
            if not gdp_df.empty and "value" in gdp_df.columns:
                values = gdp_df["value"].dropna()
                if len(values) >= 4:
                    return float((values.iloc[-1] / values.iloc[-4] - 1) * 100)
        except Exception as e:
            logger.debug(f"Failed to get GDP growth for {country}: {e}")
        return None

    def _get_inflation_rate(self, country: str) -> Optional[float]:
        """Get year-over-year inflation rate."""
        try:
            cpi_df = self.dbnomics.get_inflation(country, measure="CPI")
            if not cpi_df.empty and "value" in cpi_df.columns:
                values = cpi_df["value"].dropna()
                if len(values) >= 12:
                    return float((values.iloc[-1] / values.iloc[-12] - 1) * 100)
        except Exception as e:
            logger.debug(f"Failed to get inflation for {country}: {e}")
        return None

    def _normalize_indicator(self, name: str, value: float) -> float:
        """Normalize indicator to 100=trend scale."""
        # Default normalization - specific indicators may need custom logic
        if name == "yield_spread":
            # Positive spread = good, scale around 100
            return 100 + value * 10
        elif name in ["initial_claims"]:
            # Higher claims = bad
            # Would need historical average for proper normalization
            return 100.0
        else:
            return 100.0

    def _get_signal_from_value(self, name: str, value: float) -> str:
        """Determine signal from indicator value."""
        if name == "yield_spread":
            if value < 0:
                return "negative"
            elif value > 1:
                return "positive"
            else:
                return "neutral"
        return "neutral"

    def _determine_phase(
        self,
        country: str,
        sahm: Optional[float],
        lei_composite: float,
        gdp_growth: Optional[float],
        leading_indicators: Dict[str, float],
    ) -> Tuple[CyclePhase, float, Optional[datetime]]:
        """Determine current cycle phase from indicators."""
        signals = []

        # Sahm Rule signal
        if sahm is not None:
            if sahm >= self.SAHM_THRESHOLD:
                signals.append(("contraction", 0.9))
            elif sahm > 0.3:
                signals.append(("late_cycle", 0.6))
            else:
                signals.append(("expansion", 0.5))

        # LEI signal
        if lei_composite < 98:
            signals.append(("contraction", 0.7))
        elif lei_composite < 100:
            signals.append(("late_cycle", 0.5))
        elif lei_composite > 102:
            signals.append(("expansion", 0.7))
        else:
            signals.append(("expansion", 0.5))

        # GDP growth signal
        if gdp_growth is not None:
            if gdp_growth < -1:
                signals.append(("contraction", 0.8))
            elif gdp_growth < 0:
                signals.append(("contraction", 0.6))
            elif gdp_growth < 1:
                signals.append(("early_recovery", 0.5))
            elif gdp_growth > 3:
                signals.append(("expansion", 0.7))
            else:
                signals.append(("expansion", 0.5))

        # Aggregate signals
        phase_scores: Dict[str, float] = {}
        for phase, confidence in signals:
            phase_scores[phase] = phase_scores.get(phase, 0) + confidence

        if phase_scores:
            best_phase = max(phase_scores.items(), key=lambda x: x[1])
            phase = CyclePhase(best_phase[0])
            # Normalize confidence
            confidence = min(1.0, best_phase[1] / len(signals))
        else:
            phase = CyclePhase.EXPANSION
            confidence = 0.3

        # Phase start date estimation (simplified)
        phase_start = self._estimate_phase_start(country, phase)

        return phase, confidence, phase_start

    def _estimate_phase_start(
        self, country: str, phase: CyclePhase
    ) -> Optional[datetime]:
        """Estimate when the current phase started."""
        # Simplified estimation - would need more sophisticated logic
        # for production use
        try:
            gdp_df = self.dbnomics.get_gdp(country, frequency="Q", real=True)
            if not gdp_df.empty and "period" in gdp_df.columns:
                # Find last turning point
                values = gdp_df["value"].dropna()
                periods = pd.to_datetime(gdp_df["period"])

                # Very simplified: look for sign change in growth
                if len(values) >= 8:
                    growth = values.pct_change(4)  # YoY
                    sign_changes = (growth > 0).diff()
                    last_change = sign_changes[sign_changes].index[-1:]

                    if len(last_change) > 0:
                        idx = last_change[0]
                        if idx < len(periods):
                            return periods.iloc[idx].to_pydatetime()

        except Exception as e:
            logger.debug(f"Failed to estimate phase start: {e}")

        return None

    def _calculate_phase_duration(self, phase_start: Optional[datetime]) -> int:
        """Calculate months since phase start."""
        if phase_start is None:
            return 0

        delta = datetime.now() - phase_start
        return int(delta.days / 30)

    def _enforce_alternation(
        self, peaks: List[Tuple], troughs: List[Tuple]
    ) -> List[Tuple]:
        """Ensure peaks and troughs alternate properly."""
        all_points = []

        for date, value in peaks:
            all_points.append((date, "peak", value))
        for date, value in troughs:
            all_points.append((date, "trough", value))

        all_points.sort(key=lambda x: x[0])

        if not all_points:
            return []

        # Keep only alternating points
        result = [all_points[0]]
        for point in all_points[1:]:
            if point[1] != result[-1][1]:
                result.append(point)
            else:
                # Same type - keep the more extreme
                if point[1] == "peak" and point[2] > result[-1][2]:
                    result[-1] = point
                elif point[1] == "trough" and point[2] < result[-1][2]:
                    result[-1] = point

        return result

    def _apply_phase_constraints(
        self, points: List[Tuple], min_phase_length: int
    ) -> List[Tuple]:
        """Apply minimum phase length constraint."""
        if len(points) < 2:
            return points

        result = [points[0]]
        for point in points[1:]:
            if hasattr(point[0], "month"):
                prev_date = result[-1][0]
                curr_date = point[0]
                months = (
                    (curr_date.year - prev_date.year) * 12
                    + curr_date.month
                    - prev_date.month
                )
                if months >= min_phase_length:
                    result.append(point)
            else:
                result.append(point)

        return result

    def _apply_cycle_constraints(
        self, points: List[Tuple], min_cycle_length: int
    ) -> List[Tuple]:
        """Apply minimum cycle length constraint."""
        # A full cycle is peak-to-peak or trough-to-trough
        if len(points) < 3:
            return points

        result = [points[0]]
        for i, point in enumerate(points[1:], 1):
            # Check if this completes a cycle
            same_type_indices = [j for j, p in enumerate(result) if p[1] == point[1]]
            if same_type_indices:
                last_same = result[same_type_indices[-1]]
                if hasattr(point[0], "month"):
                    months = (
                        (point[0].year - last_same[0].year) * 12
                        + point[0].month
                        - last_same[0].month
                    )
                    if months >= min_cycle_length:
                        result.append(point)
                else:
                    result.append(point)
            else:
                result.append(point)

        return result

    def _interpret_probability(self, probability: float) -> str:
        """Interpret recession probability."""
        if probability >= 0.7:
            return "High recession risk - multiple indicators signaling contraction"
        elif probability >= 0.5:
            return "Elevated recession risk - caution warranted"
        elif probability >= 0.3:
            return "Moderate recession risk - mixed signals"
        elif probability >= 0.15:
            return "Low recession risk - economy appears healthy"
        else:
            return "Very low recession risk - strong expansion"

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return self.dbnomics.health_check()
