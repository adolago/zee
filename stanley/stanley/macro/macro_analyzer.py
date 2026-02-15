"""
Macro Analyzer Module

High-level interface for macroeconomic analysis.
Provides country analysis, cross-country comparisons,
economic cycle detection, and regime identification.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .dbnomics_adapter import DBnomicsAdapter
from .indicators import (
    IndicatorCategory,
    Transformation,
    get_indicators_by_category,
    get_indicator,
)

logger = logging.getLogger(__name__)


class EconomicRegime(Enum):
    """Economic regime classification."""

    EXPANSION = "expansion"
    PEAK = "peak"
    CONTRACTION = "contraction"
    TROUGH = "trough"
    RECOVERY = "recovery"
    STAGFLATION = "stagflation"
    GOLDILOCKS = "goldilocks"  # Low inflation, solid growth
    REFLATION = "reflation"  # Rising growth and inflation


@dataclass
class CountrySnapshot:
    """Current economic snapshot for a country."""

    country: str
    timestamp: datetime
    gdp_growth: Optional[float] = None
    inflation: Optional[float] = None
    unemployment: Optional[float] = None
    policy_rate: Optional[float] = None
    current_account: Optional[float] = None
    pmi: Optional[float] = None
    regime: Optional[EconomicRegime] = None
    additional_indicators: Dict[str, float] = field(default_factory=dict)


@dataclass
class EconomicForecast:
    """Economic forecast data."""

    country: str
    indicator: str
    horizon_months: int
    forecast_value: float
    confidence_lower: Optional[float] = None
    confidence_upper: Optional[float] = None
    model: str = "naive"


@dataclass
class YieldCurve:
    """Yield curve data and analysis."""

    country: str
    date: datetime
    tenors: List[str]  # e.g., ['3M', '2Y', '5Y', '10Y', '30Y']
    yields: List[float]
    spread_2y10y: Optional[float] = None
    spread_3m10y: Optional[float] = None
    curve_shape: Optional[str] = None  # 'normal', 'flat', 'inverted'


class MacroAnalyzer:
    """
    Comprehensive macroeconomic analysis.

    Provides:
    - Country economic snapshots
    - Cross-country comparisons
    - Economic cycle/regime detection
    - Yield curve analysis
    - Leading indicator analysis
    """

    # Major economies for default analysis
    G7_COUNTRIES = ["USA", "JPN", "DEU", "GBR", "FRA", "ITA", "CAN"]
    G20_COUNTRIES = G7_COUNTRIES + [
        "CHN",
        "IND",
        "BRA",
        "RUS",
        "AUS",
        "KOR",
        "MEX",
        "IDN",
        "TUR",
        "SAU",
        "ARG",
        "ZAF",
    ]

    def __init__(
        self,
        dbnomics_adapter: Optional[DBnomicsAdapter] = None,
        data_manager: Optional[Any] = None,
    ):
        """
        Initialize MacroAnalyzer.

        Args:
            dbnomics_adapter: DBnomics adapter instance
            data_manager: Optional DataManager for additional data
        """
        self.dbnomics = dbnomics_adapter or DBnomicsAdapter()
        self.data_manager = data_manager

        logger.info("MacroAnalyzer initialized")

    def get_country_snapshot(
        self,
        country: str,
        include_regime: bool = True,
    ) -> CountrySnapshot:
        """
        Get current economic snapshot for a country.

        Args:
            country: ISO country code (e.g., 'USA', 'DEU')
            include_regime: Include regime classification

        Returns:
            CountrySnapshot with key indicators
        """
        snapshot = CountrySnapshot(
            country=country,
            timestamp=datetime.now(),
        )

        # GDP growth
        try:
            gdp_df = self.dbnomics.get_gdp(country, frequency="Q", real=True)
            if not gdp_df.empty and "value" in gdp_df.columns:
                values = gdp_df["value"].dropna()
                if len(values) >= 4:
                    snapshot.gdp_growth = (values.iloc[-1] / values.iloc[-4] - 1) * 100
        except Exception as e:
            logger.debug(f"Failed to get GDP for {country}: {e}")

        # Inflation
        try:
            cpi_df = self.dbnomics.get_inflation(country, measure="CPI")
            if not cpi_df.empty and "value" in cpi_df.columns:
                values = cpi_df["value"].dropna()
                if len(values) >= 12:
                    snapshot.inflation = (values.iloc[-1] / values.iloc[-12] - 1) * 100
        except Exception as e:
            logger.debug(f"Failed to get inflation for {country}: {e}")

        # Unemployment
        try:
            unemp_df = self.dbnomics.get_unemployment(country)
            if not unemp_df.empty and "value" in unemp_df.columns:
                snapshot.unemployment = unemp_df["value"].dropna().iloc[-1]
        except Exception as e:
            logger.debug(f"Failed to get unemployment for {country}: {e}")

        # Policy rate
        try:
            rate_df = self.dbnomics.get_interest_rates(country, rate_type="policy")
            if not rate_df.empty and "value" in rate_df.columns:
                snapshot.policy_rate = rate_df["value"].dropna().iloc[-1]
        except Exception as e:
            logger.debug(f"Failed to get policy rate for {country}: {e}")

        # Current account
        try:
            ca_df = self.dbnomics.get_current_account(country)
            if not ca_df.empty and "value" in ca_df.columns:
                snapshot.current_account = ca_df["value"].dropna().iloc[-1]
        except Exception as e:
            logger.debug(f"Failed to get current account for {country}: {e}")

        # Classify regime
        if include_regime:
            snapshot.regime = self._classify_regime(
                gdp_growth=snapshot.gdp_growth,
                inflation=snapshot.inflation,
                unemployment=snapshot.unemployment,
            )

        return snapshot

    def compare_countries(
        self,
        countries: Optional[List[str]] = None,
        indicators: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Compare economic indicators across countries.

        Args:
            countries: List of country codes (default: G7)
            indicators: List of indicator codes (default: key indicators)

        Returns:
            DataFrame with country comparison
        """
        if countries is None:
            countries = self.G7_COUNTRIES

        if indicators is None:
            indicators = [
                "GDP_REAL",
                "CPI",
                "UNEMPLOYMENT_RATE",
                "POLICY_RATE",
                "CURRENT_ACCOUNT",
            ]

        comparison = {}

        for country in countries:
            snapshot = self.get_country_snapshot(country, include_regime=True)
            comparison[country] = {
                "gdp_growth": snapshot.gdp_growth,
                "inflation": snapshot.inflation,
                "unemployment": snapshot.unemployment,
                "policy_rate": snapshot.policy_rate,
                "current_account": snapshot.current_account,
                "regime": snapshot.regime.value if snapshot.regime else None,
            }

        return pd.DataFrame(comparison).T

    def get_indicator_data(
        self,
        indicator_code: str,
        country: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        transform: Optional[Transformation] = None,
    ) -> pd.DataFrame:
        """
        Get time series data for an indicator.

        Args:
            indicator_code: Indicator code from registry
            country: ISO country code
            start_date: Start date
            end_date: End date
            transform: Data transformation to apply

        Returns:
            DataFrame with indicator data
        """
        indicator = get_indicator(indicator_code)
        if indicator is None:
            logger.warning(f"Unknown indicator: {indicator_code}")
            return pd.DataFrame()

        # Try each source until one works
        for source in indicator.sources:
            try:
                series_code = source.series_template.format(country=country)
                df = self.dbnomics.fetch_series(
                    provider_code=source.provider,
                    dataset_code=source.dataset,
                    series_code=series_code,
                )

                if not df.empty:
                    # Apply transformation
                    transform = transform or indicator.default_transform
                    df = self._apply_transform(df, transform)

                    # Filter by date
                    if "period" in df.columns:
                        df["date"] = pd.to_datetime(df["period"])
                        if start_date:
                            df = df[df["date"] >= start_date]
                        if end_date:
                            df = df[df["date"] <= end_date]

                    return df

            except Exception as e:
                logger.debug(
                    f"Failed to fetch {indicator_code} from {source.provider}: {e}"
                )
                continue

        return pd.DataFrame()

    def get_multiple_indicators(
        self,
        indicator_codes: List[str],
        country: str,
    ) -> Dict[str, pd.DataFrame]:
        """
        Get multiple indicators for a country.

        Args:
            indicator_codes: List of indicator codes
            country: ISO country code

        Returns:
            Dictionary mapping indicator codes to DataFrames
        """
        results = {}
        for code in indicator_codes:
            df = self.get_indicator_data(code, country)
            if not df.empty:
                results[code] = df
        return results

    def get_yield_curve(self, country: str) -> Optional[YieldCurve]:
        """
        Get current yield curve for a country.

        Args:
            country: ISO country code

        Returns:
            YieldCurve object
        """
        yields_data = {}

        # Get short-term rate
        try:
            short_df = self.dbnomics.get_interest_rates(country, rate_type="short")
            if not short_df.empty and "value" in short_df.columns:
                yields_data["3M"] = short_df["value"].dropna().iloc[-1]
        except Exception:
            pass

        # Get long-term rate
        try:
            long_df = self.dbnomics.get_interest_rates(country, rate_type="long")
            if not long_df.empty and "value" in long_df.columns:
                yields_data["10Y"] = long_df["value"].dropna().iloc[-1]
        except Exception:
            pass

        if not yields_data:
            return None

        # Calculate spreads
        spread_3m10y = None
        if "3M" in yields_data and "10Y" in yields_data:
            spread_3m10y = yields_data["10Y"] - yields_data["3M"]

        # Determine curve shape
        curve_shape = "normal"
        if spread_3m10y is not None:
            if spread_3m10y < 0:
                curve_shape = "inverted"
            elif spread_3m10y < 0.5:
                curve_shape = "flat"

        return YieldCurve(
            country=country,
            date=datetime.now(),
            tenors=list(yields_data.keys()),
            yields=list(yields_data.values()),
            spread_3m10y=spread_3m10y,
            curve_shape=curve_shape,
        )

    def analyze_leading_indicators(
        self,
        country: str,
    ) -> Dict[str, Any]:
        """
        Analyze leading indicators for a country.

        Args:
            country: ISO country code

        Returns:
            Dictionary with leading indicator analysis
        """
        leading_indicators = get_indicators_by_category(IndicatorCategory.SENTIMENT)

        analysis = {
            "country": country,
            "timestamp": datetime.now(),
            "indicators": {},
            "overall_signal": "neutral",
        }

        bullish_count = 0
        bearish_count = 0

        for indicator in leading_indicators:
            try:
                df = self.get_indicator_data(indicator.code, country)
                if df.empty or "value" not in df.columns:
                    continue

                values = df["value"].dropna()
                if len(values) < 3:
                    continue

                current = values.iloc[-1]
                prev = values.iloc[-2]
                momentum = current - prev

                # For PMI-type indicators, 50 is the neutral level
                if "PMI" in indicator.code or "confidence" in indicator.name.lower():
                    if current > 50:
                        signal = "expansion"
                        bullish_count += 1
                    else:
                        signal = "contraction"
                        bearish_count += 1
                else:
                    # For CLI, 100 is trend
                    if current > 100:
                        signal = "above_trend"
                        bullish_count += 1
                    else:
                        signal = "below_trend"
                        bearish_count += 1

                analysis["indicators"][indicator.code] = {
                    "name": indicator.name,
                    "current": current,
                    "previous": prev,
                    "momentum": momentum,
                    "signal": signal,
                }

            except Exception as e:
                logger.debug(f"Failed to analyze {indicator.code}: {e}")

        # Overall signal
        if bullish_count > bearish_count * 2:
            analysis["overall_signal"] = "bullish"
        elif bearish_count > bullish_count * 2:
            analysis["overall_signal"] = "bearish"
        else:
            analysis["overall_signal"] = "neutral"

        return analysis

    def detect_recession_risk(
        self,
        country: str,
    ) -> Dict[str, Any]:
        """
        Assess recession risk for a country.

        Args:
            country: ISO country code

        Returns:
            Dictionary with recession risk assessment
        """
        risk_factors = {
            "country": country,
            "timestamp": datetime.now(),
            "risk_score": 0,  # 0-100
            "factors": [],
        }

        risk_score = 0

        # Check yield curve
        yield_curve = self.get_yield_curve(country)
        if yield_curve:
            if yield_curve.curve_shape == "inverted":
                risk_score += 30
                risk_factors["factors"].append(
                    {
                        "factor": "inverted_yield_curve",
                        "severity": "high",
                        "description": f"Yield curve inverted: {yield_curve.spread_3m10y:.2f}%",
                    }
                )
            elif yield_curve.curve_shape == "flat":
                risk_score += 15
                risk_factors["factors"].append(
                    {
                        "factor": "flat_yield_curve",
                        "severity": "medium",
                        "description": "Yield curve is flat",
                    }
                )

        # Check leading indicators
        leading = self.analyze_leading_indicators(country)
        if leading["overall_signal"] == "bearish":
            risk_score += 20
            risk_factors["factors"].append(
                {
                    "factor": "leading_indicators_bearish",
                    "severity": "medium",
                    "description": "Leading indicators pointing down",
                }
            )

        # Check snapshot for specific risks
        snapshot = self.get_country_snapshot(country, include_regime=False)

        if snapshot.gdp_growth is not None and snapshot.gdp_growth < 0:
            risk_score += 25
            risk_factors["factors"].append(
                {
                    "factor": "negative_gdp_growth",
                    "severity": "high",
                    "description": f"GDP growth: {snapshot.gdp_growth:.1f}%",
                }
            )
        elif snapshot.gdp_growth is not None and snapshot.gdp_growth < 1:
            risk_score += 10
            risk_factors["factors"].append(
                {
                    "factor": "slow_gdp_growth",
                    "severity": "low",
                    "description": f"GDP growth: {snapshot.gdp_growth:.1f}%",
                }
            )

        if snapshot.unemployment is not None:
            # Rising unemployment is a risk factor
            try:
                unemp_df = self.dbnomics.get_unemployment(country)
                if not unemp_df.empty and "value" in unemp_df.columns:
                    values = unemp_df["value"].dropna()
                    if len(values) >= 12:
                        unemp_change = values.iloc[-1] - values.iloc[-12]
                        if unemp_change > 1:
                            risk_score += 15
                            risk_factors["factors"].append(
                                {
                                    "factor": "rising_unemployment",
                                    "severity": "medium",
                                    "description": f"Unemployment up {unemp_change:.1f}pp YoY",
                                }
                            )
            except Exception:
                pass

        risk_factors["risk_score"] = min(100, risk_score)

        # Classify risk level
        if risk_score >= 50:
            risk_factors["risk_level"] = "high"
        elif risk_score >= 25:
            risk_factors["risk_level"] = "elevated"
        else:
            risk_factors["risk_level"] = "low"

        return risk_factors

    def get_global_overview(self) -> Dict[str, Any]:
        """
        Get global economic overview.

        Returns:
            Dictionary with global economic summary
        """
        overview = {
            "timestamp": datetime.now(),
            "regions": {},
            "global_growth": None,
            "global_inflation": None,
            "risk_assessment": [],
        }

        # Analyze major economies
        major_economies = {
            "North America": ["USA", "CAN"],
            "Europe": ["DEU", "FRA", "GBR", "ITA"],
            "Asia Pacific": ["JPN", "CHN", "KOR", "AUS"],
        }

        for region, countries in major_economies.items():
            region_data = {
                "countries": {},
                "avg_growth": None,
                "avg_inflation": None,
            }

            growth_values = []
            inflation_values = []

            for country in countries:
                try:
                    snapshot = self.get_country_snapshot(country)
                    region_data["countries"][country] = {
                        "gdp_growth": snapshot.gdp_growth,
                        "inflation": snapshot.inflation,
                        "regime": snapshot.regime.value if snapshot.regime else None,
                    }

                    if snapshot.gdp_growth is not None:
                        growth_values.append(snapshot.gdp_growth)
                    if snapshot.inflation is not None:
                        inflation_values.append(snapshot.inflation)

                except Exception as e:
                    logger.debug(f"Failed to get snapshot for {country}: {e}")

            if growth_values:
                region_data["avg_growth"] = np.mean(growth_values)
            if inflation_values:
                region_data["avg_inflation"] = np.mean(inflation_values)

            overview["regions"][region] = region_data

        # Calculate global averages (GDP-weighted would be better)
        all_growth = []
        all_inflation = []
        for region_data in overview["regions"].values():
            if region_data["avg_growth"] is not None:
                all_growth.append(region_data["avg_growth"])
            if region_data["avg_inflation"] is not None:
                all_inflation.append(region_data["avg_inflation"])

        if all_growth:
            overview["global_growth"] = np.mean(all_growth)
        if all_inflation:
            overview["global_inflation"] = np.mean(all_inflation)

        return overview

    def _classify_regime(
        self,
        gdp_growth: Optional[float],
        inflation: Optional[float],
        unemployment: Optional[float],
    ) -> Optional[EconomicRegime]:
        """Classify economic regime based on key indicators."""
        if gdp_growth is None or inflation is None:
            return None

        # Simple regime classification
        if gdp_growth > 2 and inflation < 3:
            return EconomicRegime.GOLDILOCKS
        elif gdp_growth > 2 and inflation > 4:
            return EconomicRegime.REFLATION
        elif gdp_growth < 0 and inflation > 4:
            return EconomicRegime.STAGFLATION
        elif gdp_growth < 0:
            return EconomicRegime.CONTRACTION
        elif gdp_growth > 3:
            return EconomicRegime.EXPANSION
        elif 0 < gdp_growth < 2 and inflation < 2:
            return EconomicRegime.RECOVERY
        else:
            return EconomicRegime.EXPANSION

    def _apply_transform(
        self,
        df: pd.DataFrame,
        transform: Transformation,
    ) -> pd.DataFrame:
        """Apply transformation to data."""
        if "value" not in df.columns:
            return df

        if transform == Transformation.YOY:
            df["value"] = df["value"].pct_change(periods=12) * 100
        elif transform == Transformation.QOQ:
            df["value"] = df["value"].pct_change(periods=1) * 100
        elif transform == Transformation.MOM:
            df["value"] = df["value"].pct_change(periods=1) * 100
        elif transform == Transformation.DIFF:
            df["value"] = df["value"].diff()
        elif transform == Transformation.LOG:
            df["value"] = np.log(df["value"])
        elif transform == Transformation.LOG_DIFF:
            df["value"] = np.log(df["value"]).diff() * 100

        return df

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return self.dbnomics.health_check()
