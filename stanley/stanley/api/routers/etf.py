"""
ETF Router

FastAPI router for ETF analytics endpoints including:
- ETF fund flows
- Sector rotation signals
- Smart beta factor analysis
- Thematic ETF trends
- Institutional ETF positioning
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from stanley.api.routers.base import get_app_state

logger = logging.getLogger(__name__)


# =============================================================================
# Pydantic Response Models
# =============================================================================


class ETFFlowResponse(BaseModel):
    """ETF flow summary response."""

    symbol: str
    name: str
    category: str
    aum: float
    price: float
    change1d: float
    change1w: float
    change1m: float
    netFlow1d: float
    netFlow1w: float
    netFlow1m: float
    netFlow3m: float
    creationUnits1w: int
    redemptionUnits1w: int
    flowMomentum: float
    institutionalFlowPct: float
    flowSignal: str
    timestamp: str


class SectorRotationResponse(BaseModel):
    """Sector rotation signal response."""

    sector: str
    etfSymbol: str
    currentRank: int
    previousRank: int
    rankChange: int
    flowScore: float
    relativeStrength: float
    trend: str
    signal: str
    confidence: float


class SmartBetaFlowResponse(BaseModel):
    """Smart beta factor flow response."""

    factor: str
    etfSymbols: List[str]
    totalAum: float
    netFlow1m: float
    netFlow3m: float
    flowPercentile: float
    performance1m: float
    performance3m: float
    crowdingScore: float
    relativeValue: str
    signal: str


class ThematicFlowResponse(BaseModel):
    """Thematic ETF flow response."""

    theme: str
    description: str
    etfSymbols: List[str]
    totalAum: float
    netFlow1m: float
    netFlow3m: float
    netFlowYtd: float
    flowTrend: str
    topHoldingsOverlap: float
    performance1m: float
    performance3m: float
    performanceYtd: float
    momentumScore: float
    institutionalInterest: str


class ETFDetailResponse(BaseModel):
    """ETF detail with creation/redemption activity."""

    symbol: str
    name: str
    period: str
    creationUnits: int
    redemptionUnits: int
    netUnits: int
    dailyCreationAvg: float
    dailyRedemptionAvg: float
    unusualCreationDays: int
    unusualRedemptionDays: int
    flowTrend: float
    interpretation: str


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Router Configuration
# =============================================================================

router = APIRouter(prefix="/api/etf", tags=["ETF Analytics"])


# Dependency to get app state (will be injected from main app)
def get_etf_analyzer():
    """Get ETF analyzer from the current request's app_state."""
    app_state = get_app_state()

    if not getattr(app_state, "etf_analyzer", None):
        raise HTTPException(status_code=503, detail="ETF analyzer not initialized")
    return app_state.etf_analyzer


def get_timestamp() -> str:
    """Get current ISO timestamp."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> ApiResponse:
    """Create a standardized API response."""
    import numpy as np

    def _convert_numpy_types(obj: Any) -> Any:
        """Convert numpy types to native Python types for JSON serialization."""
        if isinstance(obj, dict):
            return {k: _convert_numpy_types(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_convert_numpy_types(v) for v in obj]
        elif isinstance(obj, np.bool_):
            return bool(obj)
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj) if not np.isnan(obj) else None
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj

    converted_data = _convert_numpy_types(data) if data is not None else None

    return ApiResponse(
        success=success and error is None,
        data=converted_data,
        error=error,
        timestamp=get_timestamp(),
    )


# =============================================================================
# ETF Flow Endpoints
# =============================================================================


@router.get("/flows", response_model=ApiResponse)
async def get_etf_flows(
    symbols: Optional[str] = Query(
        default=None, description="Comma-separated list of ETF symbols"
    ),
    lookback_days: int = Query(default=90, ge=1, le=365, description="Days to analyze"),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get comprehensive ETF flow analysis.

    Returns creation/redemption flows, momentum, and institutional activity.
    Tracks major sector, smart beta, and thematic ETFs.

    Args:
        symbols: Comma-separated list of ETF symbols (all tracked if not specified)
        lookback_days: Number of days to analyze (default: 90)
    """
    try:
        symbol_list = [s.strip() for s in symbols.split(",")] if symbols else None
        flows = await etf_analyzer.get_etf_flows(
            symbols=symbol_list, lookback_days=lookback_days
        )

        return create_response(data=[f.to_dict() for f in flows])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ETF flows: {e}")
        return create_response(error=str(e), success=False)


@router.get("/flows/{symbol}", response_model=ApiResponse)
async def get_etf_flow_detail(
    symbol: str,
    lookback_days: int = Query(default=30, ge=1, le=180, description="Days to analyze"),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get detailed creation/redemption activity for a specific ETF.

    Analyzes creation unit patterns to detect institutional accumulation
    or distribution behavior.

    Args:
        symbol: ETF symbol
        lookback_days: Number of days to analyze (default: 30)
    """
    try:
        symbol = symbol.upper()

        activity = await etf_analyzer.get_creation_redemption_activity(
            symbol, lookback_days
        )

        return create_response(data=activity)

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ETF flow detail for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/sector-rotation", response_model=ApiResponse)
async def get_sector_rotation(
    lookback_days: int = Query(
        default=63, ge=21, le=252, description="Days for momentum calculation"
    ),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get sector ETF rotation signals.

    Returns momentum rankings, relative strength vs SPY, and rotation recommendations.
    Uses sector SPDR ETFs (XLK, XLF, XLE, etc.) for analysis.

    Args:
        lookback_days: Days for momentum calculation (default: 63 ~ 3 months)
    """
    try:
        signals = await etf_analyzer.get_sector_rotation(lookback_days)

        return create_response(data=[s.to_dict() for s in signals])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching sector rotation: {e}")
        return create_response(error=str(e), success=False)


@router.get("/sector-heatmap", response_model=ApiResponse)
async def get_sector_heatmap(
    period: str = Query(
        default="1m",
        description="Time period (1d, 1w, 1m, 3m, ytd)",
        pattern="^(1d|1w|1m|3m|ytd)$",
    ),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get sector performance heatmap data.

    Returns sector ETF performance and flow signals for visualization.

    Args:
        period: Time period (1d, 1w, 1m, 3m, ytd)
    """
    try:
        heatmap = await etf_analyzer.get_sector_heatmap(period)

        return create_response(data=heatmap)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching sector heatmap: {e}")
        return create_response(error=str(e), success=False)


@router.get("/smart-beta", response_model=ApiResponse)
async def get_smart_beta_flows(
    lookback_days: int = Query(
        default=63, ge=21, le=252, description="Days for flow analysis"
    ),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get smart beta factor flow analysis.

    Analyzes flows into factor ETFs:
    - Value (VTV, IWD)
    - Growth (VUG, IWF)
    - Momentum (MTUM)
    - Quality (QUAL)
    - Low Volatility (USMV)
    - Size/Small Cap (IJR, IWM)

    Args:
        lookback_days: Days for flow analysis (default: 63)
    """
    try:
        flows = await etf_analyzer.get_smart_beta_flows(lookback_days)

        return create_response(data=[f.to_dict() for f in flows])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching smart beta flows: {e}")
        return create_response(error=str(e), success=False)


@router.get("/factor-rotation", response_model=ApiResponse)
async def get_factor_rotation(
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get factor rotation signals for tactical allocation.

    Returns recommendations for rotating between value, growth, and other factors.
    Includes value-growth spread indicator for regime detection.
    """
    try:
        signals = await etf_analyzer.get_factor_rotation_signals()

        return create_response(data=signals)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching factor rotation: {e}")
        return create_response(error=str(e), success=False)


@router.get("/thematic", response_model=ApiResponse)
async def get_thematic_flows(
    lookback_days: int = Query(
        default=90, ge=30, le=365, description="Days for flow analysis"
    ),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get thematic ETF flow analysis.

    Analyzes flows into thematic ETFs:
    - Disruptive Innovation (ARKK)
    - Clean Energy (ICLN)
    - Robotics & AI (BOTZ)
    - Cybersecurity (HACK)
    - Cloud Computing (SKYY)
    - Lithium & Battery (LIT)
    - Gaming & eSports (ESPO)
    - Cryptocurrency (BITO)

    Args:
        lookback_days: Days for flow analysis (default: 90)
    """
    try:
        flows = await etf_analyzer.get_thematic_flows(lookback_days)

        return create_response(data=[f.to_dict() for f in flows])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching thematic flows: {e}")
        return create_response(error=str(e), success=False)


@router.get("/theme-dashboard", response_model=ApiResponse)
async def get_theme_dashboard(
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get thematic investment dashboard.

    Returns comprehensive thematic overview:
    - Hot themes (momentum > 0.3)
    - Cooling themes (momentum < -0.2)
    - Total thematic AUM
    - Aggregate inflows/outflows
    """
    try:
        dashboard = await etf_analyzer.get_theme_dashboard()

        return create_response(data=dashboard)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching theme dashboard: {e}")
        return create_response(error=str(e), success=False)


@router.get("/institutional", response_model=ApiResponse)
async def get_institutional_etf_positioning(
    symbols: Optional[str] = Query(
        default=None, description="Comma-separated list of ETF symbols"
    ),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get institutional ETF positioning analysis.

    Analyzes 13F institutional holdings in major ETFs.
    Tracks quarterly changes in institutional ownership.

    Args:
        symbols: Comma-separated list of ETF symbols (major ETFs if not specified)
    """
    try:
        symbol_list = symbols.split(",") if symbols else None
        positioning = await etf_analyzer.get_institutional_etf_positioning(symbol_list)

        return create_response(data=positioning)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching institutional positioning: {e}")
        return create_response(error=str(e), success=False)


@router.get("/overview", response_model=ApiResponse)
async def get_etf_flow_overview(
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get comprehensive ETF flow market overview.

    Returns aggregate flows, sentiment, top inflows/outflows, and rotation signals.
    Useful for understanding overall market positioning.
    """
    try:
        overview = await etf_analyzer.get_flow_overview()

        return create_response(data=overview)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ETF overview: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}", response_model=ApiResponse)
async def get_etf_detail(
    symbol: str,
    lookback_days: int = Query(default=90, ge=1, le=365, description="Days to analyze"),
    etf_analyzer=Depends(get_etf_analyzer),
):
    """
    Get detailed ETF information including holdings and flow analysis.

    Args:
        symbol: ETF symbol
        lookback_days: Number of days to analyze (default: 90)
    """
    try:
        symbol = symbol.upper()

        # Get flow summary for this ETF
        flows = await etf_analyzer.get_etf_flows(
            symbols=[symbol], lookback_days=lookback_days
        )

        if not flows:
            raise HTTPException(status_code=404, detail=f"ETF not found: {symbol}")

        flow_data = flows[0].to_dict()

        # Get creation/redemption activity
        try:
            activity = await etf_analyzer.get_creation_redemption_activity(
                symbol, min(lookback_days, 30)
            )
            flow_data["creationRedemptionActivity"] = activity
        except ValueError:
            flow_data["creationRedemptionActivity"] = None

        return create_response(data=flow_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ETF detail for {symbol}: {e}")
        return create_response(error=str(e), success=False)
