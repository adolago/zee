"""
Macro Router

API endpoints for macroeconomic analysis including:
- Economic indicators (GDP, inflation, unemployment)
- Market regime detection
- Yield curve analysis
- Recession probability models
- Fed watch and policy expectations
- Cross-asset correlations
"""

import logging
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from stanley.api.routers.base import get_app_state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/macro", tags=["Macro"])


# =============================================================================
# Enums and Models
# =============================================================================


class MarketRegime(str, Enum):
    """Market regime classification."""

    GOLDILOCKS = "goldilocks"  # Low vol, growth, low inflation
    REFLATION = "reflation"  # Rising growth, rising inflation
    STAGFLATION = "stagflation"  # Weak growth, high inflation
    DEFLATION = "deflation"  # Weak growth, falling prices
    RISK_ON = "risk_on"  # Strong risk appetite
    RISK_OFF = "risk_off"  # Flight to safety
    CRISIS = "crisis"  # Acute stress
    TRANSITION = "transition"  # Regime change underway


class EconomicRegime(str, Enum):
    """Economic cycle regime."""

    EXPANSION = "expansion"
    PEAK = "peak"
    CONTRACTION = "contraction"
    TROUGH = "trough"
    RECOVERY = "recovery"
    STAGFLATION = "stagflation"
    GOLDILOCKS = "goldilocks"
    REFLATION = "reflation"


class YieldCurveShape(str, Enum):
    """Yield curve shape classification."""

    NORMAL = "normal"
    FLAT = "flat"
    INVERTED = "inverted"
    STEEP = "steep"


class CorrelationRegime(str, Enum):
    """Cross-asset correlation regime."""

    RISK_ON = "risk_on"
    RISK_OFF = "risk_off"
    DISLOCATED = "dislocated"
    TRANSITIONING = "transitioning"


# =============================================================================
# Response Models
# =============================================================================


class EconomicIndicator(BaseModel):
    """Single economic indicator value."""

    code: str
    name: str
    value: float
    previousValue: Optional[float] = None
    change: Optional[float] = None
    unit: str
    frequency: str
    lastUpdate: str
    source: str


class CountrySnapshot(BaseModel):
    """Economic snapshot for a country."""

    country: str
    gdpGrowth: Optional[float] = None
    inflation: Optional[float] = None
    unemployment: Optional[float] = None
    policyRate: Optional[float] = None
    currentAccount: Optional[float] = None
    regime: Optional[str] = None
    timestamp: str


class IndicatorsResponse(BaseModel):
    """Economic indicators response."""

    country: str
    indicators: List[EconomicIndicator]
    snapshot: CountrySnapshot
    timestamp: str


class RegimeSignal(BaseModel):
    """Individual regime signal from component."""

    source: str
    signal: str
    strength: float
    confidence: float
    details: Dict[str, Any] = Field(default_factory=dict)


class RegimePositioning(BaseModel):
    """Asset class positioning signals."""

    equity: str  # overweight, neutral, underweight
    duration: str  # long, neutral, short
    credit: str  # overweight, neutral, underweight
    volatility: str  # buy, neutral, sell


class RegimeResponse(BaseModel):
    """Comprehensive regime detection response."""

    currentRegime: MarketRegime
    confidence: str  # high, medium, low
    regimeScore: float
    components: Dict[str, str]
    metrics: Dict[str, Optional[float]]
    risk: Dict[str, Any]
    positioning: RegimePositioning
    signals: List[RegimeSignal]
    regimeDurationDays: int
    timestamp: str


class YieldCurveData(BaseModel):
    """Yield curve data point."""

    tenor: str
    yield_pct: float = Field(alias="yield")
    priorYield: Optional[float] = None
    change: Optional[float] = None


class YieldCurveResponse(BaseModel):
    """Yield curve analysis response."""

    country: str
    shape: YieldCurveShape
    spread2y10y: Optional[float] = None
    spread3m10y: Optional[float] = None
    recessionSignal: str  # strong, moderate, weak, none
    recessionProbability12m: float
    inversionDurationDays: int
    curve: List[YieldCurveData]
    dynamic: str  # flattening, steepening, stable
    timestamp: str


class RecessionFactor(BaseModel):
    """Individual recession risk factor."""

    factor: str
    severity: str  # high, medium, low
    description: str
    contribution: float


class RecessionResponse(BaseModel):
    """Recession probability model response."""

    country: str
    probability12m: float
    probability6m: float
    riskLevel: str  # high, elevated, moderate, low
    riskScore: float
    factors: List[RecessionFactor]
    modelVersion: str
    confidence: float
    timestamp: str


class FedMeeting(BaseModel):
    """Fed meeting and rate expectations."""

    date: str
    probNoChange: float
    probHike25bp: float
    probCut25bp: float
    probCut50bp: float
    impliedRate: float
    priorRate: float


class FedWatchResponse(BaseModel):
    """Fed watch probabilities response."""

    currentRate: float
    targetRange: str
    nextMeeting: FedMeeting
    upcomingMeetings: List[FedMeeting]
    terminalRate: float
    marketExpectation: str  # hawkish, neutral, dovish
    timestamp: str


class AssetCorrelation(BaseModel):
    """Asset class correlation data."""

    asset1: str
    asset2: str
    correlation60d: float
    correlation252d: float
    trend: str  # increasing, stable, decreasing


class CrossAssetResponse(BaseModel):
    """Cross-asset correlation analysis response."""

    regime: CorrelationRegime
    stockBondCorrelation: float
    stockCommodityCorrelation: float
    usdRiskCorrelation: float
    riskOnOffScore: float
    correlationStability: float
    confidence: float
    assetMomentum: Dict[str, float]
    correlationMatrix: Dict[str, Dict[str, float]]
    timestamp: str


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool = True
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: Optional[str] = None


def create_response(
    data: Any = None, error: str = None, success: bool = True
) -> ApiResponse:
    """Create standardized API response."""
    return ApiResponse(
        success=success if error is None else False,
        data=data,
        error=error,
        timestamp=datetime.now().isoformat(),
    )


def get_macro_analyzer():
    """Get or create macro analyzer instance."""
    from ...macro import MacroAnalyzer, DBnomicsAdapter

    app_state = get_app_state()

    # Check if macro analyzer exists in app state
    if hasattr(app_state, "macro_analyzer") and app_state.macro_analyzer:
        return app_state.macro_analyzer

    # Create new instance
    dbnomics = DBnomicsAdapter()
    return MacroAnalyzer(
        dbnomics_adapter=dbnomics,
        data_manager=app_state.data_manager if app_state else None,
    )


def get_regime_detector():
    """Get or create macro regime detector instance."""
    from ...macro.regime_detector import MacroRegimeDetector
    from ...macro import DBnomicsAdapter

    app_state = get_app_state()

    # Check if regime detector exists in app state
    if hasattr(app_state, "regime_detector") and app_state.regime_detector:
        return app_state.regime_detector

    # Create new instance
    dbnomics = DBnomicsAdapter()
    return MacroRegimeDetector(
        dbnomics_adapter=dbnomics,
        data_manager=app_state.data_manager if app_state else None,
    )


def get_cross_asset_analyzer():
    """Get or create cross-asset analyzer instance."""
    from ...macro import CrossAssetAnalyzer

    app_state = get_app_state()

    # Check if cross-asset analyzer exists in app state
    if hasattr(app_state, "cross_asset_analyzer") and app_state.cross_asset_analyzer:
        return app_state.cross_asset_analyzer

    # Create new instance
    return CrossAssetAnalyzer(
        data_manager=app_state.data_manager if app_state else None
    )


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/indicators", response_model=ApiResponse)
async def get_economic_indicators(
    country: str = Query("USA", description="ISO country code (e.g., USA, DEU, JPN)"),
    include_snapshot: bool = Query(True, description="Include economic snapshot"),
):
    """
    Get key economic indicators for a country.

    Returns major economic metrics including:
    - GDP growth (real, year-over-year)
    - Inflation (CPI, year-over-year)
    - Unemployment rate
    - Policy interest rate
    - Current account balance

    Data sourced from DBnomics (central banks, statistical offices).

    Args:
        country: ISO 3-letter country code
        include_snapshot: Include summary snapshot with regime classification
    """
    try:
        macro_analyzer = get_macro_analyzer()

        # Get country snapshot which includes key indicators
        snapshot = macro_analyzer.get_country_snapshot(country, include_regime=True)

        # Build indicators list
        indicators = []

        if snapshot.gdp_growth is not None:
            indicators.append(
                EconomicIndicator(
                    code="GDP_REAL",
                    name="Real GDP Growth",
                    value=round(snapshot.gdp_growth, 2),
                    previousValue=None,
                    change=None,
                    unit="%",
                    frequency="quarterly",
                    lastUpdate=snapshot.timestamp.isoformat(),
                    source="DBnomics",
                )
            )

        if snapshot.inflation is not None:
            indicators.append(
                EconomicIndicator(
                    code="CPI",
                    name="Consumer Price Index (YoY)",
                    value=round(snapshot.inflation, 2),
                    previousValue=None,
                    change=None,
                    unit="%",
                    frequency="monthly",
                    lastUpdate=snapshot.timestamp.isoformat(),
                    source="DBnomics",
                )
            )

        if snapshot.unemployment is not None:
            indicators.append(
                EconomicIndicator(
                    code="UNEMPLOYMENT",
                    name="Unemployment Rate",
                    value=round(snapshot.unemployment, 2),
                    previousValue=None,
                    change=None,
                    unit="%",
                    frequency="monthly",
                    lastUpdate=snapshot.timestamp.isoformat(),
                    source="DBnomics",
                )
            )

        if snapshot.policy_rate is not None:
            indicators.append(
                EconomicIndicator(
                    code="POLICY_RATE",
                    name="Policy Interest Rate",
                    value=round(snapshot.policy_rate, 2),
                    previousValue=None,
                    change=None,
                    unit="%",
                    frequency="as announced",
                    lastUpdate=snapshot.timestamp.isoformat(),
                    source="DBnomics",
                )
            )

        if snapshot.current_account is not None:
            indicators.append(
                EconomicIndicator(
                    code="CURRENT_ACCOUNT",
                    name="Current Account Balance",
                    value=round(snapshot.current_account, 2),
                    previousValue=None,
                    change=None,
                    unit="% GDP",
                    frequency="quarterly",
                    lastUpdate=snapshot.timestamp.isoformat(),
                    source="DBnomics",
                )
            )

        response_data = {
            "country": country,
            "indicators": [i.model_dump() for i in indicators],
            "timestamp": datetime.now().isoformat(),
        }

        if include_snapshot:
            response_data["snapshot"] = {
                "country": country,
                "gdpGrowth": snapshot.gdp_growth,
                "inflation": snapshot.inflation,
                "unemployment": snapshot.unemployment,
                "policyRate": snapshot.policy_rate,
                "currentAccount": snapshot.current_account,
                "regime": snapshot.regime.value if snapshot.regime else None,
                "timestamp": snapshot.timestamp.isoformat(),
            }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error fetching economic indicators for {country}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/regime", response_model=ApiResponse)
async def get_market_regime(
    country: str = Query("USA", description="ISO country code"),
):
    """
    Detect current market regime.

    Combines multiple signals to classify the macro environment:
    - Business cycle phase (expansion, contraction, etc.)
    - Volatility regime (low, normal, elevated, crisis)
    - Credit conditions (spreads, default risk)
    - Yield curve signals
    - Cross-asset correlations

    Returns positioning recommendations for each asset class.

    Args:
        country: Primary country for analysis
    """
    try:
        regime_detector = get_regime_detector()

        # Get comprehensive regime state
        regime_state = await regime_detector.get_regime_state(country)

        # Format response
        response_data = regime_state.to_dict()

        # Rename keys to camelCase for frontend
        formatted_response = {
            "currentRegime": response_data["regime"],
            "confidence": response_data["regime_confidence"],
            "regimeScore": response_data["regime_score"],
            "components": response_data["components"],
            "metrics": response_data["metrics"],
            "risk": response_data["risk"],
            "positioning": {
                "equity": response_data["positioning"]["equity"],
                "duration": response_data["positioning"]["duration"],
                "credit": response_data["positioning"]["credit"],
                "volatility": response_data["positioning"]["volatility"],
            },
            "signals": response_data["signals"],
            "regimeDurationDays": response_data["context"]["regime_duration_days"],
            "timestamp": response_data["timestamp"],
        }

        return create_response(data=formatted_response)

    except Exception as e:
        logger.error(f"Error detecting market regime: {e}")
        return create_response(error=str(e), success=False)


@router.get("/yield-curve", response_model=ApiResponse)
async def get_yield_curve(
    country: str = Query("USA", description="ISO country code"),
):
    """
    Analyze yield curve for a country.

    Provides:
    - Current yield curve shape (normal, flat, inverted)
    - Key spreads (2y-10y, 3m-10y)
    - Recession signal strength
    - Historical inversion tracking
    - Curve dynamics (flattening/steepening)

    The 3m-10y spread is a leading recession indicator with
    approximately 12-18 month lead time.

    Args:
        country: ISO country code
    """
    try:
        macro_analyzer = get_macro_analyzer()

        # Get yield curve data
        yield_curve = macro_analyzer.get_yield_curve(country)

        if yield_curve is None:
            return create_response(
                data={
                    "country": country,
                    "shape": "unknown",
                    "spread2y10y": None,
                    "spread3m10y": None,
                    "recessionSignal": "unknown",
                    "recessionProbability12m": None,
                    "inversionDurationDays": 0,
                    "curve": [],
                    "dynamic": "unknown",
                    "timestamp": datetime.now().isoformat(),
                }
            )

        # Calculate recession probability from spread
        recession_prob = 0.15  # Default
        recession_signal = "none"

        if yield_curve.spread_3m10y is not None:
            spread = yield_curve.spread_3m10y
            if spread < -0.5:
                recession_prob = 0.65
                recession_signal = "strong"
            elif spread < 0:
                recession_prob = 0.45
                recession_signal = "moderate"
            elif spread < 0.5:
                recession_prob = 0.25
                recession_signal = "weak"
            else:
                recession_prob = 0.15
                recession_signal = "none"

        # Build curve data
        curve_data = []
        for tenor, yield_val in zip(yield_curve.tenors, yield_curve.yields):
            curve_data.append(
                {
                    "tenor": tenor,
                    "yield": round(yield_val, 3),
                    "priorYield": None,
                    "change": None,
                }
            )

        response_data = {
            "country": country,
            "shape": yield_curve.curve_shape,
            "spread2y10y": yield_curve.spread_2y10y,
            "spread3m10y": yield_curve.spread_3m10y,
            "recessionSignal": recession_signal,
            "recessionProbability12m": round(recession_prob, 3),
            "inversionDurationDays": 0,  # Would need historical tracking
            "curve": curve_data,
            "dynamic": "stable",  # Would need historical comparison
            "timestamp": datetime.now().isoformat(),
        }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error analyzing yield curve for {country}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/recession-probability", response_model=ApiResponse)
async def get_recession_probability(
    country: str = Query("USA", description="ISO country code"),
):
    """
    Get recession probability model output.

    Multi-factor recession risk assessment including:
    - Yield curve inversion (3m-10y spread)
    - Leading economic indicators
    - GDP growth trajectory
    - Unemployment trends
    - Credit conditions

    Returns:
    - 6-month and 12-month recession probabilities
    - Individual risk factor contributions
    - Overall risk level classification

    Args:
        country: ISO country code
    """
    try:
        macro_analyzer = get_macro_analyzer()

        # Get recession risk assessment
        risk_data = macro_analyzer.detect_recession_risk(country)

        # Calculate 6-month probability (roughly 75% of 12-month)
        prob_12m = risk_data.get("risk_score", 25) / 100
        prob_6m = prob_12m * 0.75

        # Format factors
        factors = []
        for factor in risk_data.get("factors", []):
            # Estimate contribution based on severity
            if factor["severity"] == "high":
                contribution = 0.25
            elif factor["severity"] == "medium":
                contribution = 0.15
            else:
                contribution = 0.08

            factors.append(
                RecessionFactor(
                    factor=factor["factor"],
                    severity=factor["severity"],
                    description=factor["description"],
                    contribution=contribution,
                ).model_dump()
            )

        response_data = {
            "country": country,
            "probability12m": round(prob_12m, 3),
            "probability6m": round(prob_6m, 3),
            "riskLevel": risk_data.get("risk_level", "moderate"),
            "riskScore": risk_data.get("risk_score", 25),
            "factors": factors,
            "modelVersion": "v1.0",
            "confidence": 0.75,
            "timestamp": (
                risk_data["timestamp"].isoformat()
                if isinstance(risk_data.get("timestamp"), datetime)
                else datetime.now().isoformat()
            ),
        }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error calculating recession probability for {country}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/fed-watch", response_model=ApiResponse)
async def get_fed_watch():
    """
    Get Fed meeting probabilities and rate expectations.

    Simulates Fed funds futures-derived probabilities:
    - Current target rate
    - Probability distribution for next meeting
    - Terminal rate expectations
    - Market hawkish/dovish positioning

    Note: In production, this would integrate with CME FedWatch
    or similar data sources.
    """
    try:
        import numpy as np

        # Mock Fed watch data (in production, fetch from futures data)
        current_rate = 5.25
        target_range = "5.25% - 5.50%"

        # Generate upcoming meetings (FOMC meets ~8 times/year)
        meetings = []
        meeting_dates = [
            "2024-03-20",
            "2024-05-01",
            "2024-06-12",
            "2024-07-31",
            "2024-09-18",
            "2024-11-07",
            "2024-12-18",
        ]

        # Simulate rate expectations trending down
        expected_cuts = 0

        for i, date in enumerate(meeting_dates):
            # Probability distribution shifts toward cuts over time
            if i < 2:
                prob_no_change = 0.70
                prob_cut_25 = 0.25
                prob_cut_50 = 0.03
                prob_hike = 0.02
            elif i < 4:
                prob_no_change = 0.40
                prob_cut_25 = 0.45
                prob_cut_50 = 0.10
                prob_hike = 0.05
            else:
                prob_no_change = 0.20
                prob_cut_25 = 0.50
                prob_cut_50 = 0.25
                prob_hike = 0.05

            # Calculate implied rate
            expected_cuts += prob_cut_25 * 0.25 + prob_cut_50 * 0.50 - prob_hike * 0.25
            implied_rate = current_rate - expected_cuts

            meetings.append(
                FedMeeting(
                    date=date,
                    probNoChange=round(prob_no_change, 3),
                    probHike25bp=round(prob_hike, 3),
                    probCut25bp=round(prob_cut_25, 3),
                    probCut50bp=round(prob_cut_50, 3),
                    impliedRate=round(implied_rate, 2),
                    priorRate=current_rate if i == 0 else meetings[-1].impliedRate,
                ).model_dump()
            )

        # Terminal rate (end of cycle expectation)
        terminal_rate = current_rate - expected_cuts

        # Market expectation based on cumulative cuts
        if expected_cuts > 1.0:
            market_expectation = "dovish"
        elif expected_cuts > 0.25:
            market_expectation = "neutral"
        else:
            market_expectation = "hawkish"

        response_data = {
            "currentRate": current_rate,
            "targetRange": target_range,
            "nextMeeting": meetings[0] if meetings else None,
            "upcomingMeetings": meetings,
            "terminalRate": round(terminal_rate, 2),
            "marketExpectation": market_expectation,
            "timestamp": datetime.now().isoformat(),
        }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error fetching Fed watch data: {e}")
        return create_response(error=str(e), success=False)


@router.get("/cross-asset", response_model=ApiResponse)
async def get_cross_asset_correlations(
    correlation_window: int = Query(
        60, ge=20, le=252, description="Rolling window for correlations (days)"
    ),
    lookback_days: int = Query(252, ge=60, le=756, description="Total lookback period"),
):
    """
    Analyze cross-asset correlations and risk regimes.

    Examines relationships between major asset classes:
    - Stock-bond correlation (key regime indicator)
    - Stock-commodity correlation
    - USD-risk asset correlation
    - Risk-on/risk-off scoring

    Positive stock-bond correlation indicates:
    - Inflation concerns dominating
    - Potential liquidity stress
    - Reduced diversification benefit

    Args:
        correlation_window: Rolling window for correlation calculation
        lookback_days: Total historical period to analyze
    """
    try:
        cross_asset = get_cross_asset_analyzer()

        # Get cross-asset state
        state = await cross_asset.get_cross_asset_state(
            correlation_window=correlation_window,
            lookback_days=lookback_days,
        )

        # Get correlation matrix
        corr_matrix = await cross_asset.get_correlation_matrix(
            assets=None,  # All assets
            window=correlation_window,
            lookback_days=lookback_days,
        )

        # Format correlation matrix for JSON
        matrix_dict = {}
        if not corr_matrix.empty:
            matrix_dict = corr_matrix.round(3).to_dict()

        response_data = {
            "regime": state.regime.value,
            "stockBondCorrelation": round(state.stock_bond_correlation, 3),
            "stockCommodityCorrelation": round(state.stock_commodity_correlation, 3),
            "usdRiskCorrelation": round(state.usd_risk_correlation, 3),
            "riskOnOffScore": round(state.risk_on_off_score, 3),
            "correlationStability": round(state.correlation_stability, 3),
            "confidence": round(state.regime_confidence, 3),
            "assetMomentum": {k: round(v, 4) for k, v in state.asset_momentum.items()},
            "correlationMatrix": matrix_dict,
            "timestamp": state.timestamp.isoformat(),
        }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error analyzing cross-asset correlations: {e}")
        return create_response(error=str(e), success=False)


@router.get("/global-overview", response_model=ApiResponse)
async def get_global_overview():
    """
    Get global economic overview across major regions.

    Aggregates economic data for:
    - North America (USA, Canada)
    - Europe (Germany, France, UK, Italy)
    - Asia Pacific (Japan, China, Korea, Australia)

    Returns regional averages for growth and inflation,
    with individual country snapshots.
    """
    try:
        macro_analyzer = get_macro_analyzer()

        # Get global overview
        overview = macro_analyzer.get_global_overview()

        # Format regions for response
        formatted_regions = {}
        for region, data in overview.get("regions", {}).items():
            formatted_regions[region] = {
                "avgGrowth": (
                    round(data["avg_growth"], 2) if data["avg_growth"] else None
                ),
                "avgInflation": (
                    round(data["avg_inflation"], 2) if data["avg_inflation"] else None
                ),
                "countries": {
                    country: {
                        "gdpGrowth": (
                            round(vals["gdp_growth"], 2)
                            if vals.get("gdp_growth")
                            else None
                        ),
                        "inflation": (
                            round(vals["inflation"], 2)
                            if vals.get("inflation")
                            else None
                        ),
                        "regime": vals.get("regime"),
                    }
                    for country, vals in data.get("countries", {}).items()
                },
            }

        response_data = {
            "globalGrowth": (
                round(overview["global_growth"], 2)
                if overview.get("global_growth")
                else None
            ),
            "globalInflation": (
                round(overview["global_inflation"], 2)
                if overview.get("global_inflation")
                else None
            ),
            "regions": formatted_regions,
            "timestamp": (
                overview["timestamp"].isoformat()
                if isinstance(overview.get("timestamp"), datetime)
                else datetime.now().isoformat()
            ),
        }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error fetching global overview: {e}")
        return create_response(error=str(e), success=False)


@router.get("/compare-countries", response_model=ApiResponse)
async def compare_countries(
    countries: str = Query(
        "USA,DEU,JPN,GBR,CHN",
        description="Comma-separated list of ISO country codes",
    ),
):
    """
    Compare economic indicators across countries.

    Returns a comparison matrix of key economic metrics
    for the specified countries, useful for:
    - Relative value analysis
    - Currency positioning
    - Regional allocation decisions

    Args:
        countries: Comma-separated ISO country codes
    """
    try:
        macro_analyzer = get_macro_analyzer()

        country_list = [c.strip().upper() for c in countries.split(",")]

        # Get comparison data
        comparison_df = macro_analyzer.compare_countries(
            countries=country_list, indicators=None
        )

        if comparison_df.empty:
            return create_response(data={"countries": [], "comparison": {}})

        # Format for JSON response
        comparison_dict = {}
        for country in comparison_df.index:
            row = comparison_df.loc[country]
            comparison_dict[country] = {
                "gdpGrowth": (
                    round(row["gdp_growth"], 2)
                    if row.get("gdp_growth") is not None
                    else None
                ),
                "inflation": (
                    round(row["inflation"], 2)
                    if row.get("inflation") is not None
                    else None
                ),
                "unemployment": (
                    round(row["unemployment"], 2)
                    if row.get("unemployment") is not None
                    else None
                ),
                "policyRate": (
                    round(row["policy_rate"], 2)
                    if row.get("policy_rate") is not None
                    else None
                ),
                "currentAccount": (
                    round(row["current_account"], 2)
                    if row.get("current_account") is not None
                    else None
                ),
                "regime": row.get("regime"),
            }

        response_data = {
            "countries": country_list,
            "comparison": comparison_dict,
            "timestamp": datetime.now().isoformat(),
        }

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"Error comparing countries: {e}")
        return create_response(error=str(e), success=False)
