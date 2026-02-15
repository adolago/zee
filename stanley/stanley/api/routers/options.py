"""
Options Router

FastAPI router for options flow analysis endpoints including:
- Options flow analysis
- Gamma exposure (GEX)
- Unusual activity detection
- Put/call ratio analysis
- Smart money tracking
- Max pain calculation
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


class OptionsFlowResponse(BaseModel):
    """Options flow analysis response."""

    symbol: str
    totalCallVolume: int
    totalPutVolume: int
    totalCallPremium: float
    totalPutPremium: float
    putCallRatio: float
    premiumPutCallRatio: float
    netPremiumFlow: float
    unusualActivityCount: int
    smartMoneyTrades: int
    sentiment: str
    confidence: float
    timestamp: str


class GammaExposureResponse(BaseModel):
    """Gamma exposure response."""

    symbol: str
    totalGex: float
    callGex: float
    putGex: float
    netGex: float
    flipPoint: Optional[float]
    maxGammaStrike: float
    timestamp: str


class UnusualActivityResponse(BaseModel):
    """Unusual options activity response."""

    symbol: str
    strike: float
    expiration: str
    optionType: str
    volume: int
    openInterest: int
    volOiRatio: float
    premium: float
    impliedVolatility: float
    tradeType: str
    sentiment: str


class SmartMoneyTradeResponse(BaseModel):
    """Smart money trade response."""

    symbol: str
    strike: float
    expiration: str
    optionType: str
    premium: float
    volume: int
    tradeType: str
    side: str
    sentiment: str
    timestamp: str


class MaxPainResponse(BaseModel):
    """Max pain analysis response."""

    symbol: str
    expiration: str
    maxPain: float
    totalCallOI: int
    totalPutOI: int
    totalCallVolume: int
    totalPutVolume: int
    gammaConcentration: float
    pinRisk: float
    daysToExpiry: int


class PutCallAnalysisResponse(BaseModel):
    """Put/call flow analysis response."""

    symbol: str
    putCallRatio: float
    premiumPutCallRatio: float
    oiPutCallRatio: float
    totalCallVolume: int
    totalPutVolume: int
    totalCallPremium: float
    totalPutPremium: float
    callOpenInterest: int
    putOpenInterest: int
    itmCallVolume: int
    otmCallVolume: int
    itmPutVolume: int
    otmPutVolume: int
    weightedCallStrike: float
    weightedPutStrike: float
    underlyingPrice: float
    sentiment: str
    timestamp: str


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Router Configuration
# =============================================================================

router = APIRouter(prefix="/api/options", tags=["Options"])


# Dependency to get app state (will be injected from main app)
def get_options_analyzer():
    """Get options analyzer from the current request's app_state."""
    app_state = get_app_state()

    if not getattr(app_state, "options_analyzer", None):
        raise HTTPException(status_code=503, detail="Options analyzer not initialized")
    return app_state.options_analyzer


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
# Options Flow Endpoints
# =============================================================================


@router.get("/{symbol}/flow", response_model=ApiResponse)
async def get_options_flow(
    symbol: str,
    lookback_days: int = Query(default=5, ge=1, le=30, description="Days to analyze"),
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get comprehensive options flow analysis for a symbol.

    Returns volume, premium, put/call ratios, gamma exposure, and sentiment.

    Args:
        symbol: Stock ticker symbol
        lookback_days: Number of days to analyze (1-30)
    """
    try:
        symbol = symbol.upper()

        flow_data = await options_analyzer.get_options_flow(symbol, lookback_days)

        response = OptionsFlowResponse(
            symbol=flow_data["symbol"],
            totalCallVolume=flow_data["total_call_volume"],
            totalPutVolume=flow_data["total_put_volume"],
            totalCallPremium=flow_data["total_call_premium"],
            totalPutPremium=flow_data["total_put_premium"],
            putCallRatio=flow_data["put_call_ratio"],
            premiumPutCallRatio=flow_data["premium_put_call_ratio"],
            netPremiumFlow=flow_data["net_premium_flow"],
            unusualActivityCount=flow_data["unusual_activity_count"],
            smartMoneyTrades=flow_data["smart_money_trades"],
            sentiment=flow_data["sentiment"],
            confidence=flow_data["confidence"],
            timestamp=flow_data["timestamp"],
        )

        return create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching options flow for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/gamma", response_model=ApiResponse)
async def get_gamma_exposure(
    symbol: str,
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get gamma exposure (GEX) analysis for a symbol.

    Returns aggregate gamma exposure, flip point, and dealer positioning.

    Gamma exposure shows dealer hedging pressure:
    - Positive GEX: Dealers are long gamma, will buy dips and sell rallies
    - Negative GEX: Dealers are short gamma, will amplify moves

    Args:
        symbol: Stock ticker symbol
    """
    try:
        symbol = symbol.upper()

        gex_data = await options_analyzer.calculate_gamma_exposure(symbol)

        response = GammaExposureResponse(
            symbol=gex_data["symbol"],
            totalGex=gex_data["total_gex"],
            callGex=gex_data["call_gex"],
            putGex=gex_data["put_gex"],
            netGex=gex_data["net_gex"],
            flipPoint=gex_data["flip_point"],
            maxGammaStrike=gex_data["max_gamma_strike"],
            timestamp=gex_data["timestamp"],
        )

        return create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating gamma exposure for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/unusual", response_model=ApiResponse)
async def get_unusual_options_activity(
    symbol: str,
    volume_threshold: float = Query(
        default=2.0, ge=1.0, le=10.0, description="Minimum volume/OI ratio"
    ),
    min_premium: float = Query(
        default=50000, ge=1000, description="Minimum premium in dollars"
    ),
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get unusual options activity for a symbol.

    Detects options with volume/OI ratio above threshold and significant premium.
    Unusual activity often indicates institutional or smart money positioning.

    Args:
        symbol: Stock ticker symbol
        volume_threshold: Minimum volume/OI ratio (default: 2.0)
        min_premium: Minimum premium in dollars (default: $50k)
    """
    try:
        symbol = symbol.upper()

        unusual_df = await options_analyzer.detect_unusual_activity(
            symbol, volume_threshold, min_premium
        )

        if unusual_df.empty:
            return create_response(data=[])

        unusual_list = []
        for _, row in unusual_df.iterrows():
            unusual_list.append(
                UnusualActivityResponse(
                    symbol=symbol,
                    strike=float(row["strike"]),
                    expiration=str(row["expiration"]),
                    optionType=str(row["option_type"]),
                    volume=int(row["volume"]),
                    openInterest=int(row["open_interest"]),
                    volOiRatio=round(float(row["vol_oi_ratio"]), 2),
                    premium=round(float(row["premium"]), 2),
                    impliedVolatility=round(float(row["implied_volatility"]), 4),
                    tradeType=str(row["trade_type"]),
                    sentiment=str(row["sentiment"]),
                ).model_dump()
            )

        return create_response(data=unusual_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error detecting unusual activity for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/put-call", response_model=ApiResponse)
async def get_put_call_analysis(
    symbol: str,
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get put/call flow analysis for a symbol.

    Returns volume and premium-weighted ratios with strike distribution.
    Useful for gauging market sentiment and positioning.

    Args:
        symbol: Stock ticker symbol
    """
    try:
        symbol = symbol.upper()

        pcr_data = await options_analyzer.analyze_put_call_flow(symbol)

        response = PutCallAnalysisResponse(
            symbol=pcr_data["symbol"],
            putCallRatio=pcr_data["put_call_ratio"],
            premiumPutCallRatio=pcr_data["premium_put_call_ratio"],
            oiPutCallRatio=pcr_data["oi_put_call_ratio"],
            totalCallVolume=pcr_data["total_call_volume"],
            totalPutVolume=pcr_data["total_put_volume"],
            totalCallPremium=pcr_data["total_call_premium"],
            totalPutPremium=pcr_data["total_put_premium"],
            callOpenInterest=pcr_data["call_open_interest"],
            putOpenInterest=pcr_data["put_open_interest"],
            itmCallVolume=pcr_data["itm_call_volume"],
            otmCallVolume=pcr_data["otm_call_volume"],
            itmPutVolume=pcr_data["itm_put_volume"],
            otmPutVolume=pcr_data["otm_put_volume"],
            weightedCallStrike=pcr_data["weighted_call_strike"],
            weightedPutStrike=pcr_data["weighted_put_strike"],
            underlyingPrice=pcr_data["underlying_price"],
            sentiment=pcr_data["sentiment"],
            timestamp=pcr_data["timestamp"],
        )

        return create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing put/call flow for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/smart-money", response_model=ApiResponse)
async def get_smart_money_trades(
    symbol: str,
    min_premium: float = Query(
        default=100000, ge=10000, description="Minimum premium threshold"
    ),
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get smart money options activity for a symbol.

    Tracks block trades, sweep orders, and other institutional activity.
    Smart money indicators include:
    - Block trades (>$1M premium)
    - Sweep orders (aggressive fills across exchanges)
    - Out-of-money accumulation with high premium

    Args:
        symbol: Stock ticker symbol
        min_premium: Minimum premium threshold (default: $100k)
    """
    try:
        symbol = symbol.upper()

        smart_money_df = await options_analyzer.track_smart_money(symbol, min_premium)

        if smart_money_df.empty:
            return create_response(data=[])

        trades_list = []
        for _, row in smart_money_df.iterrows():
            trades_list.append(
                SmartMoneyTradeResponse(
                    symbol=symbol,
                    strike=float(row["strike"]),
                    expiration=str(row["expiration"]),
                    optionType=str(row["option_type"]),
                    premium=round(float(row["premium"]), 2),
                    volume=int(row["volume"]),
                    tradeType=str(row["trade_type"]),
                    side=str(row["side"]),
                    sentiment=str(row["sentiment"]),
                    timestamp=str(row["timestamp"]),
                ).model_dump()
            )

        return create_response(data=trades_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error tracking smart money for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/max-pain", response_model=ApiResponse)
async def get_max_pain(
    symbol: str,
    expiration: Optional[str] = Query(
        default=None, description="Expiration date (YYYY-MM-DD)"
    ),
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get max pain analysis for a symbol.

    Returns the strike price where option holders would experience maximum loss.
    Max pain theory suggests price gravitates toward this strike at expiration.

    Args:
        symbol: Stock ticker symbol
        expiration: Optional expiration date (YYYY-MM-DD), nearest if not specified
    """
    try:
        symbol = symbol.upper()

        analysis = await options_analyzer.analyze_expiration_flow(symbol, expiration)

        response = MaxPainResponse(
            symbol=symbol,
            expiration=analysis["expiration"],
            maxPain=analysis["max_pain"],
            totalCallOI=analysis["total_call_oi"],
            totalPutOI=analysis["total_put_oi"],
            totalCallVolume=analysis["total_call_volume"],
            totalPutVolume=analysis["total_put_volume"],
            gammaConcentration=analysis["gamma_concentration"],
            pinRisk=analysis["pin_risk"],
            daysToExpiry=analysis["days_to_expiry"],
        )

        return create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating max pain for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/chain", response_model=ApiResponse)
async def get_options_chain(
    symbol: str,
    expiration: Optional[str] = Query(
        default=None, description="Filter by expiration date (YYYY-MM-DD)"
    ),
    options_analyzer=Depends(get_options_analyzer),
):
    """
    Get options chain data for a symbol.

    Returns the full options chain with strikes, prices, Greeks, and volume.

    Args:
        symbol: Stock ticker symbol
        expiration: Optional expiration date filter (YYYY-MM-DD)
    """
    try:
        symbol = symbol.upper()

        # Access private method for chain data
        options_df = await options_analyzer._get_options_chain(symbol)

        if options_df.empty:
            return create_response(data=[])

        # Filter by expiration if specified
        if expiration:
            options_df = options_df[options_df["expiration"] == expiration]

        # Convert to list of dicts with camelCase keys
        chain_data = []
        for _, row in options_df.iterrows():
            chain_data.append(
                {
                    "symbol": symbol,
                    "strike": float(row["strike"]),
                    "expiration": str(row["expiration"]),
                    "optionType": str(row["option_type"]),
                    "lastPrice": float(row["last_price"]),
                    "bid": float(row["bid"]),
                    "ask": float(row["ask"]),
                    "volume": int(row["volume"]),
                    "openInterest": int(row["open_interest"]),
                    "impliedVolatility": round(float(row["implied_volatility"]), 4),
                    "delta": round(float(row["delta"]), 4),
                    "gamma": round(float(row["gamma"]), 6),
                    "theta": round(float(row["theta"]), 4),
                    "vega": round(float(row["vega"]), 4),
                    "underlyingPrice": float(row["underlying_price"]),
                }
            )

        return create_response(data=chain_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching options chain for {symbol}: {e}")
        return create_response(error=str(e), success=False)
