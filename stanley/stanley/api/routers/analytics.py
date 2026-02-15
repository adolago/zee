"""
Stanley Analytics Router

Handles money flow, dark pool, equity flow, sector rotation, and market breadth endpoints.
Extracted from main.py for modular API organization.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from stanley.api.auth.dependencies import get_optional_user, User
from stanley.api.auth.rate_limit import RateLimitDependency
from stanley.api.routers.base import get_app_state

logger = logging.getLogger(__name__)

# =============================================================================
# Router Configuration
# =============================================================================

router = APIRouter(prefix="/api", tags=["Analytics"])

# Rate limiting: 30 requests per minute for analytics endpoints
analytics_rate_limit = RateLimitDependency(requests=30, window=60)


# =============================================================================
# Pydantic Models - Request Types
# =============================================================================


class MoneyFlowRequest(BaseModel):
    """Request body for money flow analysis."""

    sectors: List[str] = Field(
        default=["XLK", "XLF", "XLE", "XLV", "XLI"],
        description="List of sector ETF symbols (e.g., ['XLK', 'XLF', 'XLE'])",
    )
    lookback_days: int = Field(
        default=63, ge=1, le=365, description="Number of days to analyze"
    )
    period: str = Field(
        default="1M",
        description="Analysis period (1W, 1M, 3M, 6M)",
        pattern="^(1W|1M|3M|6M)$",
    )


class SectorRotationRequest(BaseModel):
    """Request body for sector rotation analysis."""

    sectors: Optional[List[str]] = Field(
        default=None,
        description="List of sector ETF symbols (defaults to all major sectors)",
    )
    lookback_days: int = Field(
        default=63, ge=1, le=252, description="Number of days for momentum calculation"
    )


# =============================================================================
# Pydantic Models - Response Types
# =============================================================================


class MoneyFlowData(BaseModel):
    """Money flow analysis data for a single sector."""

    symbol: str = Field(..., description="Sector ETF symbol")
    netFlow1m: float = Field(..., description="Net flow over 1 month")
    netFlow3m: float = Field(..., description="Net flow over 3 months")
    institutionalChange: float = Field(
        ..., description="Change in institutional ownership"
    )
    smartMoneySentiment: float = Field(
        ..., description="Smart money sentiment indicator (-1 to 1)"
    )
    flowAcceleration: float = Field(..., description="Rate of change in money flow")
    confidenceScore: float = Field(
        ..., description="Confidence score for the analysis (-1 to 1)"
    )


class MoneyFlowResponse(BaseModel):
    """Response for money flow analysis."""

    sectors: Dict[str, MoneyFlowData] = Field(
        ..., description="Money flow data by sector"
    )
    net_flows: Dict[str, float] = Field(..., description="Net flows by sector (1M)")
    momentum: Dict[str, float] = Field(..., description="Flow momentum by sector")
    timestamp: str = Field(..., description="Analysis timestamp")


class DarkPoolData(BaseModel):
    """Dark pool activity data for a single day."""

    symbol: str = Field(..., description="Stock symbol")
    date: Optional[str] = Field(None, description="Date in ISO format")
    darkPoolVolume: int = Field(..., description="Dark pool volume")
    totalVolume: int = Field(..., description="Total volume")
    darkPoolPercentage: float = Field(
        ..., description="Dark pool volume as percentage of total"
    )
    largeBlockActivity: float = Field(
        ..., description="Large block trade activity indicator"
    )
    darkPoolSignal: int = Field(
        ..., description="Dark pool signal (-1: bearish, 0: neutral, 1: bullish)"
    )


class DarkPoolResponse(BaseModel):
    """Response for dark pool activity analysis."""

    symbol: str = Field(..., description="Stock symbol")
    data: List[DarkPoolData] = Field(..., description="Dark pool data by date")
    summary: Dict[str, Any] = Field(..., description="Summary statistics")
    timestamp: str = Field(..., description="Analysis timestamp")


class EquityFlowData(BaseModel):
    """Equity-specific money flow data."""

    symbol: str = Field(..., description="Stock symbol")
    moneyFlowScore: float = Field(..., description="Overall money flow score (-1 to 1)")
    institutionalSentiment: float = Field(
        ..., description="Institutional sentiment indicator"
    )
    smartMoneyActivity: float = Field(..., description="Smart money activity level")
    shortPressure: float = Field(..., description="Short interest pressure indicator")
    accumulationDistribution: float = Field(
        ..., description="Accumulation/distribution indicator"
    )
    confidence: float = Field(..., description="Confidence score (0 to 1)")


class SectorRotationData(BaseModel):
    """Sector rotation signal data."""

    sector: str = Field(..., description="Sector ETF symbol")
    sectorName: str = Field(..., description="Sector name")
    relativeStrength: float = Field(..., description="Relative strength score")
    momentumScore: float = Field(..., description="Momentum score")
    flowScore: float = Field(..., description="Flow momentum score")
    rotationPhase: str = Field(
        ..., description="Rotation phase (leading, weakening, lagging, improving)"
    )
    recommendation: str = Field(
        ..., description="Recommendation (overweight, neutral, underweight)"
    )
    oneMonthReturn: float = Field(..., description="1-month return")
    threeMonthReturn: float = Field(..., description="3-month return")


class MarketBreadthData(BaseModel):
    """Market breadth indicators."""

    advanceDeclineRatio: float = Field(..., description="Advance/decline ratio")
    advancingVolume: float = Field(..., description="Advancing volume percentage")
    decliningVolume: float = Field(..., description="Declining volume percentage")
    newHighsNewLows: float = Field(..., description="New highs minus new lows")
    percentAbove50DMA: float = Field(
        ..., description="Percent of stocks above 50-day MA"
    )
    percentAbove200DMA: float = Field(
        ..., description="Percent of stocks above 200-day MA"
    )
    mcclellanOscillator: float = Field(..., description="McClellan Oscillator value")
    breadthThrust: float = Field(..., description="Breadth thrust indicator")
    interpretation: str = Field(
        ..., description="Market breadth interpretation (bullish, neutral, bearish)"
    )
    timestamp: str = Field(..., description="Analysis timestamp")


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool = Field(..., description="Whether the request succeeded")
    data: Optional[Any] = Field(None, description="Response data")
    error: Optional[str] = Field(None, description="Error message if failed")
    timestamp: str = Field(..., description="Response timestamp")


# =============================================================================
# Helper Functions
# =============================================================================


def get_timestamp() -> str:
    """Get current timestamp in ISO format."""
    import datetime as dt_module

    return (
        dt_module.datetime.now(dt_module.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _convert_numpy_types(obj: Any) -> Any:
    """Convert numpy types to native Python types for JSON serialization."""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {k: _convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_convert_numpy_types(item) for item in obj]
    elif pd.isna(obj):
        return None
    return obj


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> ApiResponse:
    """Create a standardized API response."""
    converted_data = _convert_numpy_types(data) if data is not None else None

    return ApiResponse(
        success=success and error is None,
        data=converted_data,
        error=error,
        timestamp=get_timestamp(),
    )


# =============================================================================
# Endpoints
# =============================================================================


@router.post("/money-flow", response_model=ApiResponse)
async def analyze_money_flow(
    request: MoneyFlowRequest,
    http_request: Request,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Analyze money flow across sectors.

    Returns money flow metrics for each sector including net flows,
    institutional changes, and smart money sentiment.

    Rate limit: 30 requests per minute.

    Args:
        request: MoneyFlowRequest with list of sector ETFs and parameters
        user: Optional authenticated user for enhanced features
    """
    try:
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        if not request.sectors:
            return create_response(data=[])

        # Analyze sector flow
        flow_df = await app_state.money_flow_analyzer.analyze_sector_flow(
            sectors=request.sectors, lookback_days=request.lookback_days
        )

        # Convert DataFrame to list of MoneyFlowData
        flow_list = []

        if flow_df.empty:
            return create_response(data=[])

        for sector in flow_df.index:
            row = flow_df.loc[sector]
            flow_data = MoneyFlowData(
                symbol=sector,
                netFlow1m=round(float(row.get("net_flow_1m", 0)), 2),
                netFlow3m=round(float(row.get("net_flow_3m", 0)), 2),
                institutionalChange=round(float(row.get("institutional_change", 0)), 4),
                smartMoneySentiment=round(
                    float(row.get("smart_money_sentiment", 0)), 3
                ),
                flowAcceleration=round(float(row.get("flow_acceleration", 0)), 4),
                confidenceScore=round(float(row.get("confidence_score", 0)), 3),
            )
            flow_list.append(flow_data.model_dump())

        # Build enhanced response
        sectors_dict = {item["symbol"]: item for item in flow_list}
        net_flows = {item["symbol"]: item["netFlow1m"] for item in flow_list}
        momentum = {item["symbol"]: item["flowAcceleration"] for item in flow_list}

        response_data = MoneyFlowResponse(
            sectors=sectors_dict,
            net_flows=net_flows,
            momentum=momentum,
            timestamp=get_timestamp(),
        )

        return create_response(data=response_data.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing money flow: {e}")
        return create_response(error=str(e), success=False)


@router.get("/dark-pool/{symbol}", response_model=ApiResponse)
async def get_dark_pool_activity(
    symbol: str,
    lookback_days: int = Query(default=20, ge=1, le=90),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Get dark pool activity for a symbol.

    Returns dark pool volume and large block activity data for
    institutional positioning analysis.

    Rate limit: 30 requests per minute.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days to analyze (default: 20, max: 90)
        user: Optional authenticated user for enhanced features
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        dark_pool_df = app_state.money_flow_analyzer.get_dark_pool_activity(
            symbol, lookback_days
        )

        # Convert to response format
        dark_pool_data = []
        for _, row in dark_pool_df.iterrows():
            dp_entry = DarkPoolData(
                symbol=symbol,
                date=row["date"].isoformat() if pd.notna(row["date"]) else None,
                darkPoolVolume=int(row.get("dark_pool_volume", 0)),
                totalVolume=int(row.get("total_volume", 0)),
                darkPoolPercentage=round(float(row.get("dark_pool_percentage", 0)), 4),
                largeBlockActivity=round(float(row.get("large_block_activity", 0)), 4),
                darkPoolSignal=int(row.get("dark_pool_signal", 0)),
            )
            dark_pool_data.append(dp_entry.model_dump())

        # Calculate summary statistics
        avg_dp_pct = dark_pool_df["dark_pool_percentage"].mean()
        avg_block = dark_pool_df["large_block_activity"].mean()
        total_dp_volume = dark_pool_df["dark_pool_volume"].sum()

        summary = {
            "averageDarkPoolPercentage": round(float(avg_dp_pct), 4),
            "averageBlockActivity": round(float(avg_block), 4),
            "totalDarkPoolVolume": int(total_dp_volume),
            "signalBias": int(dark_pool_df["dark_pool_signal"].sum()),
        }

        response_data = DarkPoolResponse(
            symbol=symbol,
            data=dark_pool_data,
            summary=summary,
            timestamp=get_timestamp(),
        )

        return create_response(data=response_data.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching dark pool activity for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/equity-flow/{symbol}", response_model=ApiResponse)
async def get_equity_flow(
    symbol: str,
    lookback_days: int = Query(default=20, ge=1, le=90),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Get money flow analysis for a specific equity.

    Returns money flow score, institutional sentiment, and smart money activity
    for individual stock analysis.

    Rate limit: 30 requests per minute.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days to analyze (default: 20, max: 90)
        user: Optional authenticated user for enhanced features
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        flow_data = app_state.money_flow_analyzer.analyze_equity_flow(
            symbol, lookback_days
        )

        equity_flow = EquityFlowData(
            symbol=flow_data.get("symbol", symbol),
            moneyFlowScore=round(float(flow_data.get("money_flow_score", 0)), 3),
            institutionalSentiment=round(
                float(flow_data.get("institutional_sentiment", 0)), 3
            ),
            smartMoneyActivity=round(
                float(flow_data.get("smart_money_activity", 0)), 3
            ),
            shortPressure=round(float(flow_data.get("short_pressure", 0)), 3),
            accumulationDistribution=round(
                float(flow_data.get("accumulation_distribution", 0)), 3
            ),
            confidence=round(float(flow_data.get("confidence", 0)), 3),
        )

        return create_response(data=equity_flow.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching equity flow for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/sector-rotation", response_model=ApiResponse)
async def get_sector_rotation(
    lookback_days: int = Query(default=63, ge=21, le=252),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Get sector rotation analysis and signals.

    Returns momentum rankings, relative strength, and rotation recommendations
    for sector allocation decisions.

    Rate limit: 30 requests per minute.

    Args:
        lookback_days: Days for momentum calculation (default: 63 ~ 3 months)
        user: Optional authenticated user for enhanced features
    """
    try:
        app_state = get_app_state()

        # Try money flow analyzer first for sector rotation
        if app_state.money_flow_analyzer:
            rotation_signal = app_state.money_flow_analyzer.detect_sector_rotation(
                lookback_days=lookback_days
            )

            # Convert to response format
            rotation_data = []
            sector_names = {
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

            for sector, score in rotation_signal.sector_scores.items():
                momentum = rotation_signal.momentum_scores.get(sector, 0)

                # Determine rotation phase
                if sector in rotation_signal.leaders:
                    if sector in rotation_signal.rotating_into:
                        phase = "leading"
                    else:
                        phase = "weakening"
                elif sector in rotation_signal.laggards:
                    if sector in rotation_signal.rotating_out_of:
                        phase = "lagging"
                    else:
                        phase = "improving"
                else:
                    phase = "neutral"

                # Determine recommendation
                if score > 0.2:
                    recommendation = "overweight"
                elif score < -0.2:
                    recommendation = "underweight"
                else:
                    recommendation = "neutral"

                rotation_entry = SectorRotationData(
                    sector=sector,
                    sectorName=sector_names.get(sector, sector),
                    relativeStrength=round(score, 4),
                    momentumScore=round(momentum, 4),
                    flowScore=round(score * 0.8, 4),  # Derived from score
                    rotationPhase=phase,
                    recommendation=recommendation,
                    oneMonthReturn=round(momentum * 0.05, 4),  # Approximation
                    threeMonthReturn=round(score * 0.08, 4),  # Approximation
                )
                rotation_data.append(rotation_entry.model_dump())

            # Sort by relative strength descending
            rotation_data.sort(key=lambda x: x["relativeStrength"], reverse=True)

            return create_response(data=rotation_data)

        raise HTTPException(
            status_code=503, detail="Money flow analyzer not initialized"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching sector rotation: {e}")
        return create_response(error=str(e), success=False)


@router.get("/market-breadth", response_model=ApiResponse)
async def get_market_breadth(
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Get market breadth indicators.

    Returns advance/decline ratio, volume distribution, and breadth
    thrust indicators for market health assessment.

    Rate limit: 30 requests per minute.

    Args:
        user: Optional authenticated user for enhanced features
    """
    try:
        app_state = get_app_state()

        # Market breadth is typically derived from broad market data
        # Using money flow analyzer to derive approximate metrics
        if app_state.money_flow_analyzer:
            # Analyze major sector ETFs for breadth
            sectors = ["XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU"]
            flow_df = app_state.money_flow_analyzer.analyze_sector_flow(
                sectors=sectors, lookback_days=21
            )

            if not flow_df.empty:
                # Calculate breadth metrics from sector flows
                advancing = (flow_df["confidence_score"] > 0).sum()
                declining = (flow_df["confidence_score"] < 0).sum()
                total = len(flow_df)

                ad_ratio = advancing / max(declining, 1)
                adv_pct = advancing / total if total > 0 else 0.5
                dec_pct = declining / total if total > 0 else 0.5

                # Calculate flow-based breadth metrics
                avg_sentiment = flow_df["smart_money_sentiment"].mean()
                avg_confidence = flow_df["confidence_score"].mean()

                # McClellan Oscillator approximation
                mcclellan = (adv_pct - dec_pct) * 100

                # Breadth thrust (momentum)
                breadth_thrust = flow_df["flow_acceleration"].mean()

                # Interpret overall market breadth
                if avg_confidence > 0.2 and ad_ratio > 1.5:
                    interpretation = "bullish"
                elif avg_confidence < -0.2 and ad_ratio < 0.67:
                    interpretation = "bearish"
                else:
                    interpretation = "neutral"

                breadth_data = MarketBreadthData(
                    advanceDeclineRatio=round(ad_ratio, 3),
                    advancingVolume=round(adv_pct * 100, 2),
                    decliningVolume=round(dec_pct * 100, 2),
                    newHighsNewLows=round(avg_sentiment * 50, 2),
                    percentAbove50DMA=round((0.5 + avg_confidence * 0.3) * 100, 2),
                    percentAbove200DMA=round((0.5 + avg_confidence * 0.2) * 100, 2),
                    mcclellanOscillator=round(mcclellan, 2),
                    breadthThrust=round(breadth_thrust * 100, 4),
                    interpretation=interpretation,
                    timestamp=get_timestamp(),
                )

                return create_response(data=breadth_data.model_dump())

        # Fallback to placeholder data
        breadth_data = MarketBreadthData(
            advanceDeclineRatio=1.0,
            advancingVolume=50.0,
            decliningVolume=50.0,
            newHighsNewLows=0.0,
            percentAbove50DMA=50.0,
            percentAbove200DMA=50.0,
            mcclellanOscillator=0.0,
            breadthThrust=0.0,
            interpretation="neutral",
            timestamp=get_timestamp(),
        )

        return create_response(data=breadth_data.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching market breadth: {e}")
        return create_response(error=str(e), success=False)


@router.get("/smart-money/{symbol}", response_model=ApiResponse)
async def get_smart_money_tracking(
    symbol: str,
    lookback_days: int = Query(default=21, ge=5, le=63),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Track smart money activity for a symbol.

    Returns institutional flow tracking, accumulation/distribution signals,
    and smart money sentiment indicators.

    Rate limit: 30 requests per minute.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days to analyze (default: 21, max: 63)
        user: Optional authenticated user for enhanced features
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        smart_money = app_state.money_flow_analyzer.track_smart_money(
            symbol, lookback_days
        )

        return create_response(data=smart_money.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error tracking smart money for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/unusual-volume/{symbol}", response_model=ApiResponse)
async def get_unusual_volume(
    symbol: str,
    lookback_days: int = Query(default=20, ge=5, le=60),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Detect unusual volume activity for a symbol.

    Returns volume anomaly analysis including z-scores, percentiles,
    and likely direction interpretation.

    Rate limit: 30 requests per minute.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days for baseline calculation (default: 20)
        user: Optional authenticated user for enhanced features
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        unusual_volume = app_state.money_flow_analyzer.detect_unusual_volume(
            symbol, lookback_days
        )

        return create_response(data=unusual_volume.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error detecting unusual volume for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/flow-momentum/{symbol}", response_model=ApiResponse)
async def get_flow_momentum(
    symbol: str,
    lookback_days: int = Query(default=21, ge=10, le=63),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Calculate flow momentum indicators for a symbol.

    Returns flow momentum, acceleration, trend direction, and
    moving average crossover signals.

    Rate limit: 30 requests per minute.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days for momentum analysis (default: 21)
        user: Optional authenticated user for enhanced features
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        flow_momentum = app_state.money_flow_analyzer.calculate_flow_momentum(
            symbol, lookback_days
        )

        return create_response(data=flow_momentum.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating flow momentum for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/comprehensive/{symbol}", response_model=ApiResponse)
async def get_comprehensive_analysis(
    symbol: str,
    lookback_days: int = Query(default=21, ge=5, le=63),
    http_request: Request = None,
    _: None = Depends(analytics_rate_limit),
    user: Optional[User] = Depends(get_optional_user),
) -> ApiResponse:
    """
    Get comprehensive money flow analysis for a symbol.

    Returns all enhanced analytics in a single response including:
    - Basic money flow metrics
    - Dark pool alerts
    - Block trades detected
    - Smart money tracking
    - Unusual volume signals
    - Flow momentum indicators
    - All active alerts

    Rate limit: 30 requests per minute.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days to analyze (default: 21)
        user: Optional authenticated user for enhanced features
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.money_flow_analyzer:
            raise HTTPException(
                status_code=503, detail="Money flow analyzer not initialized"
            )

        comprehensive = app_state.money_flow_analyzer.get_comprehensive_analysis(
            symbol, lookback_days
        )

        return create_response(data=comprehensive)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting comprehensive analysis for {symbol}: {e}")
        return create_response(error=str(e), success=False)
