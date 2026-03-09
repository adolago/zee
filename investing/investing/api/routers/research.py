"""
Investing Research Router

Provides fundamental research endpoints including valuation analysis,
earnings analysis, peer comparison, and comprehensive research reports.

Rate limited to 20 requests/minute (compute intensive).
"""

import logging
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from investing.api.auth.dependencies import get_optional_user, User
from investing.api.auth.rate_limit import rate_limit, RateLimitDependency
from investing.api.routers.base import get_app_state
from investing.research import (
    ResearchAnalyzer,
    ResearchReport,
    ValuationMetrics,
    DCFResult,
    EarningsAnalysis,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Research"])


# =============================================================================
# Enums
# =============================================================================


class ValuationMethod(str, Enum):
    """Valuation methodology for analysis."""

    DCF = "dcf"
    MULTIPLES = "multiples"
    SUM_OF_PARTS = "sum_of_parts"


class EarningsPeriod(str, Enum):
    """Time period for earnings analysis."""

    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    TTM = "ttm"


# =============================================================================
# Response Models
# =============================================================================


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool = True
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str = Field(
        default_factory=lambda: __import__("datetime")
        .datetime.now(__import__("datetime").timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


class ValuationMultiplesResponse(BaseModel):
    """Trading multiples valuation response."""

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    price: float
    market_cap: float = Field(alias="marketCap")
    enterprise_value: float = Field(alias="enterpriseValue")
    pe_ratio: Optional[float] = Field(alias="peRatio")
    forward_pe: Optional[float] = Field(alias="forwardPe")
    peg_ratio: Optional[float] = Field(alias="pegRatio")
    price_to_sales: Optional[float] = Field(alias="priceToSales")
    ev_to_sales: Optional[float] = Field(alias="evToSales")
    price_to_book: Optional[float] = Field(alias="priceToBook")
    ev_to_ebitda: Optional[float] = Field(alias="evToEbitda")
    price_to_fcf: Optional[float] = Field(alias="priceToFcf")
    earnings_yield: Optional[float] = Field(alias="earningsYield")
    fcf_yield: Optional[float] = Field(alias="fcfYield")
    dividend_yield: Optional[float] = Field(alias="dividendYield")


class DCFValuationResponse(BaseModel):
    """DCF valuation response."""

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    intrinsic_value: float = Field(alias="intrinsicValue")
    current_price: float = Field(alias="currentPrice")
    upside_percentage: float = Field(alias="upsidePercentage")
    margin_of_safety: float = Field(alias="marginOfSafety")
    discount_rate: float = Field(alias="discountRate")
    terminal_growth_rate: float = Field(alias="terminalGrowthRate")
    projection_years: int = Field(alias="projectionYears")
    pv_cash_flows: float = Field(alias="pvCashFlows")
    pv_terminal_value: float = Field(alias="pvTerminalValue")
    net_debt: float = Field(alias="netDebt")
    shares_outstanding: float = Field(alias="sharesOutstanding")
    sensitivity_matrix: Optional[Dict[str, Any]] = Field(
        alias="sensitivityMatrix", default=None
    )


class ValuationResponse(BaseModel):
    """Combined valuation analysis response."""

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    method: ValuationMethod
    valuation: Dict[str, Any]
    dcf: Optional[Dict[str, Any]] = None
    sensitivity: Optional[Dict[str, Any]] = None
    fair_value: Optional[float] = Field(alias="fairValue", default=None)
    current_price: Optional[float] = Field(alias="currentPrice", default=None)
    upside_percent: Optional[float] = Field(alias="upsidePercent", default=None)
    assumptions: Optional[Dict[str, Any]] = None


class EarningsQuarterResponse(BaseModel):
    """Single quarter earnings data."""

    model_config = ConfigDict(populate_by_name=True)

    fiscal_quarter: str = Field(alias="fiscalQuarter")
    fiscal_year: int = Field(alias="fiscalYear")
    eps_actual: float = Field(alias="epsActual")
    eps_estimate: float = Field(alias="epsEstimate")
    eps_surprise: float = Field(alias="epsSurprise")
    eps_surprise_percent: float = Field(alias="epsSurprisePercent")
    revenue_actual: float = Field(alias="revenueActual")
    revenue_estimate: float = Field(alias="revenueEstimate")


class EarningsResponse(BaseModel):
    """Earnings analysis response."""

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    quarters: List[Dict[str, Any]]
    eps_growth_yoy: float = Field(alias="epsGrowthYoy")
    eps_growth_3yr_cagr: float = Field(alias="epsGrowth3yrCagr")
    avg_eps_surprise_percent: float = Field(alias="avgEpsSurprisePercent")
    beat_rate: float = Field(alias="beatRate")
    consecutive_beats: int = Field(alias="consecutiveBeats")
    earnings_volatility: float = Field(alias="earningsVolatility")
    earnings_consistency: float = Field(alias="earningsConsistency")


class PeerComparisonResponse(BaseModel):
    """Peer comparison analysis response."""

    model_config = ConfigDict(populate_by_name=True)

    target: Dict[str, Any]
    peer_averages: Dict[str, Any] = Field(alias="peerAverages")
    premium_discount: Dict[str, Any] = Field(alias="premiumDiscount")
    peers: List[Dict[str, Any]]
    fair_value_range: Optional[Dict[str, Any]] = Field(
        alias="fairValueRange", default=None
    )


class ResearchReportResponse(BaseModel):
    """Comprehensive research report response."""

    model_config = ConfigDict(populate_by_name=True)

    symbol: str
    company_name: str = Field(alias="companyName")
    sector: str
    industry: str
    current_price: float = Field(alias="currentPrice")
    market_cap: float = Field(alias="marketCap")
    valuation: Dict[str, Any]
    dcf: Optional[Dict[str, Any]] = None
    fair_value_range: Dict[str, float] = Field(alias="fairValueRange")
    valuation_rating: str = Field(alias="valuationRating")
    earnings: Dict[str, Any]
    earnings_quality_score: float = Field(alias="earningsQualityScore")
    revenue_growth_5yr: float = Field(alias="revenueGrowth5yr")
    eps_growth_5yr: float = Field(alias="epsGrowth5yr")
    gross_margin: float = Field(alias="grossMargin")
    operating_margin: float = Field(alias="operatingMargin")
    net_margin: float = Field(alias="netMargin")
    roe: float
    roic: float
    debt_to_equity: float = Field(alias="debtToEquity")
    current_ratio: float = Field(alias="currentRatio")
    overall_score: float = Field(alias="overallScore")
    strengths: List[str]
    weaknesses: List[str]
    catalysts: List[str]
    risks: List[str]
    recent_news: List[Dict[str, Any]] = Field(alias="recentNews", default_factory=list)


# =============================================================================
# Application State (will be set by main.py)
# =============================================================================


class RouterState:
    """State container for router dependencies."""

    research_analyzer: Optional[ResearchAnalyzer] = None


_state = RouterState()


def set_research_analyzer(analyzer: ResearchAnalyzer) -> None:
    """Set the research analyzer instance for the router."""
    _state.research_analyzer = analyzer


def get_research_analyzer() -> ResearchAnalyzer:
    """Get the research analyzer, raising if not initialized."""
    # Try app_state first (from Container), then fall back to local state
    app_state = get_app_state()
    analyzer = getattr(app_state, "research_analyzer", None) or _state.research_analyzer
    if analyzer is None:
        raise HTTPException(status_code=503, detail="Research analyzer not initialized")
    return analyzer


# =============================================================================
# Helper Functions
# =============================================================================


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> Dict[str, Any]:
    """Create a standardized API response."""
    import datetime

    return {
        "success": success if error is None else False,
        "data": data,
        "error": error,
        "timestamp": datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }


# =============================================================================
# Research Endpoints
# =============================================================================


# Rate limit dependency for research endpoints (20/min - compute intensive)
research_rate_limit = RateLimitDependency(requests=20, window=60, category="research")


@router.get(
    "/research/{symbol}",
    response_model=ApiResponse,
    summary="Get comprehensive research report",
    description="Generate a full research report including valuation, earnings, "
    "financial health, investment thesis, and recent news for a symbol.",
)
async def get_research(
    symbol: str,
    request: Request,
    include_news: bool = Query(
        default=True, description="Include recent news in the report"
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get comprehensive research analysis for a symbol.

    Returns valuation, earnings analysis, fundamental metrics, and recent news.

    Args:
        symbol: Stock ticker symbol
        request: FastAPI request object
        include_news: Whether to include recent news (default: True)
        user: Optional authenticated user
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        report = await analyzer.generate_report(symbol, include_news=include_news)

        return create_response(data=report.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating research for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/valuation/{symbol}",
    response_model=ApiResponse,
    summary="Get valuation analysis",
    description="Comprehensive valuation analysis including multiples and DCF.",
)
async def get_valuation(
    symbol: str,
    request: Request,
    include_dcf: bool = Query(default=True, description="Include DCF analysis"),
    method: ValuationMethod = Query(
        default=ValuationMethod.DCF, description="Primary valuation method"
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get valuation analysis for a symbol.

    Returns valuation multiples and optional DCF analysis.

    Args:
        symbol: Stock ticker symbol
        include_dcf: Whether to include DCF analysis
        method: Primary valuation methodology
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        valuation = await analyzer.get_valuation(symbol, include_dcf)

        # Add method to response
        valuation["method"] = method.value
        valuation["symbol"] = symbol

        # Calculate fair value and upside if DCF available
        if valuation.get("dcf"):
            dcf = valuation["dcf"]
            valuation["fairValue"] = dcf.get("intrinsicValue")
            valuation["currentPrice"] = dcf.get("currentPrice")
            valuation["upsidePercent"] = dcf.get("upsidePercentage")

        return create_response(data=valuation)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching valuation for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/earnings/{symbol}",
    response_model=ApiResponse,
    summary="Get earnings analysis",
    description="Earnings history, trends, surprises, and quality metrics.",
)
async def get_earnings(
    symbol: str,
    request: Request,
    quarters: int = Query(
        default=12, ge=1, le=40, description="Number of quarters to analyze"
    ),
    period: EarningsPeriod = Query(
        default=EarningsPeriod.QUARTERLY, description="Analysis period type"
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get earnings analysis for a symbol.

    Returns earnings history, trends, and surprise metrics.

    Args:
        symbol: Stock ticker symbol
        quarters: Number of quarters to analyze
        period: Period type for analysis
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        earnings = await analyzer.analyze_earnings(symbol, quarters)

        return create_response(data=earnings.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing earnings for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/peers/{symbol}",
    response_model=ApiResponse,
    summary="Get peer comparison",
    description="Compare valuation metrics against peer group.",
)
async def get_peer_comparison(
    symbol: str,
    request: Request,
    peers: Optional[str] = Query(
        default=None,
        description="Comma-separated list of peer symbols (auto-detected if not provided)",
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get peer comparison analysis for a symbol.

    Returns relative valuation vs peer group.

    Args:
        symbol: Stock ticker symbol
        peers: Optional comma-separated peer symbols
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        # Parse peer list if provided
        peer_list = None
        if peers:
            peer_list = [p.strip().upper() for p in peers.split(",") if p.strip()]

        comparison = await analyzer.get_peer_comparison(symbol, peer_list)

        return create_response(data=comparison)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching peer comparison for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/research/{symbol}/dcf",
    response_model=ApiResponse,
    summary="Get detailed DCF model",
    description="Detailed discounted cash flow valuation with sensitivity analysis.",
)
async def get_dcf_model(
    symbol: str,
    request: Request,
    discount_rate: Optional[float] = Query(
        default=None,
        ge=0.01,
        le=0.30,
        description="Discount rate (WACC). Auto-calculated if not provided.",
    ),
    terminal_growth: float = Query(
        default=0.025, ge=0.0, le=0.05, description="Terminal growth rate"
    ),
    projection_years: int = Query(
        default=5, ge=3, le=10, description="Number of projection years"
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get detailed DCF valuation model.

    Returns intrinsic value calculation with full sensitivity analysis.

    Args:
        symbol: Stock ticker symbol
        discount_rate: Optional WACC override
        terminal_growth: Long-term growth rate
        projection_years: Forecast horizon
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        # Get full valuation with DCF
        valuation = await analyzer.get_valuation(symbol, include_dcf=True)

        if not valuation.get("dcf"):
            return create_response(
                error="DCF analysis not available for this symbol", success=False
            )

        dcf_result = {
            "symbol": symbol,
            "dcf": valuation["dcf"],
            "sensitivity": valuation.get("sensitivity"),
            "assumptions": {
                "discountRate": discount_rate
                or valuation["dcf"].get("discountRate", 0.10),
                "terminalGrowthRate": terminal_growth,
                "projectionYears": projection_years,
            },
        }

        return create_response(data=dcf_result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating DCF for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/research/{symbol}/multiples",
    response_model=ApiResponse,
    summary="Get trading multiples",
    description="Comprehensive trading multiples and relative valuation metrics.",
)
async def get_trading_multiples(
    symbol: str,
    request: Request,
    include_peers: bool = Query(
        default=True, description="Include peer comparison for context"
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get trading multiples for a symbol.

    Returns P/E, EV/EBITDA, P/S, and other valuation multiples.

    Args:
        symbol: Stock ticker symbol
        include_peers: Whether to include peer averages for comparison
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        # Get valuation without DCF (just multiples)
        valuation = await analyzer.get_valuation(symbol, include_dcf=False)

        result = {
            "symbol": symbol,
            "multiples": valuation.get("valuation", {}),
        }

        # Add peer comparison if requested
        if include_peers:
            try:
                peer_comparison = await analyzer.get_peer_comparison(symbol)
                result["peerAverages"] = peer_comparison.get("peerAverages", {})
                result["premiumDiscount"] = peer_comparison.get("premiumDiscount", {})
            except Exception as peer_error:
                logger.warning(f"Could not fetch peer comparison: {peer_error}")
                result["peerAverages"] = None
                result["premiumDiscount"] = None

        return create_response(data=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching multiples for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/research/{symbol}/summary",
    response_model=ApiResponse,
    summary="Get research summary",
    description="Quick investment summary with key metrics and rating.",
)
async def get_research_summary(
    symbol: str,
    request: Request,
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(research_rate_limit),
) -> Dict[str, Any]:
    """
    Get a quick research summary for a symbol.

    Returns key metrics, valuation rating, and investment thesis summary.

    Args:
        symbol: Stock ticker symbol
    """
    try:
        symbol = symbol.upper()
        analyzer = get_research_analyzer()

        report = await analyzer.generate_report(symbol)
        report_dict = report.to_dict()

        # Create summary from full report
        summary = {
            "symbol": report_dict["symbol"],
            "companyName": report_dict["companyName"],
            "sector": report_dict["sector"],
            "industry": report_dict["industry"],
            "currentPrice": report_dict["currentPrice"],
            "marketCap": report_dict["marketCap"],
            "valuationRating": report_dict["valuationRating"],
            "overallScore": report_dict["overallScore"],
            "keyMetrics": {
                "peRatio": report_dict.get("valuation", {}).get("peRatio"),
                "forwardPe": report_dict.get("valuation", {}).get("forwardPe"),
                "evToEbitda": report_dict.get("valuation", {}).get("evToEbitda"),
                "roe": report_dict["roe"],
                "roic": report_dict["roic"],
                "debtToEquity": report_dict["debtToEquity"],
            },
            "growth": {
                "revenueGrowth5yr": report_dict["revenueGrowth5yr"],
                "epsGrowth5yr": report_dict["epsGrowth5yr"],
            },
            "margins": {
                "grossMargin": report_dict["grossMargin"],
                "operatingMargin": report_dict["operatingMargin"],
                "netMargin": report_dict["netMargin"],
            },
            "fairValueRange": report_dict["fairValueRange"],
            "topStrengths": (
                report_dict["strengths"][:3] if report_dict["strengths"] else []
            ),
            "topRisks": report_dict["risks"][:3] if report_dict["risks"] else [],
        }

        return create_response(data=summary)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating research summary for {symbol}: {e}")
        return create_response(error=str(e), success=False)
