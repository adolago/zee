"""
Signals Router

Investment signal generation, backtesting, and performance tracking endpoints.
Multi-factor analysis combining money flow, institutional positioning,
and fundamental research.
"""

import importlib.util
import logging
import os
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from stanley.api.routers.base import get_app_state

logger = logging.getLogger(__name__)


# =============================================================================
# News Integration
# =============================================================================


async def _get_signal_news(
    symbols: List[str], max_articles_per_symbol: int = 3
) -> List[Dict[str, Any]]:
    """Fetch recent news for signal symbols using news_digest skill."""
    try:
        # Find the news_digest module - check multiple locations
        possible_paths = [
            # Stanley project location
            Path(__file__).parent.parent.parent.parent
            / ".claude"
            / "skills"
            / "news-digest"
            / "scripts"
            / "news_digest.py",
            # User home .claude location
            Path.home()
            / ".claude"
            / "skills"
            / "news-digest"
            / "scripts"
            / "news_digest.py",
            # agent-core location
            Path.home()
            / "Repositories"
            / "agent-core"
            / ".claude"
            / "skills"
            / "news-digest"
            / "scripts"
            / "news_digest.py",
        ]

        news_module_path = None
        for path in possible_paths:
            if path.exists():
                news_module_path = path
                break

        if news_module_path is None:
            logger.warning("news_digest module not found in any location")
            return []

        # Load the module
        spec = importlib.util.spec_from_file_location("news_digest", news_module_path)
        if spec is None or spec.loader is None:
            return []

        news_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(news_module)
        generate_digest = news_module.generate_digest

        # Get news for signal-relevant categories
        digest = await generate_digest(
            tickers=symbols,
            range_str="7d",
            categories=["earnings", "analyst", "macro"],
            max_articles=max_articles_per_symbol * len(symbols),
        )

        # Digest is a dataclass with articles attribute, convert to list of dicts
        return [article.to_dict() for article in digest.articles]
    except Exception as e:
        logger.warning(f"Failed to fetch signal news: {e}")
        return []


# =============================================================================
# Rate Limiting
# =============================================================================

_rate_limit_store: Dict[str, List[float]] = {}
RATE_LIMIT_REQUESTS = 50
RATE_LIMIT_WINDOW = 60  # seconds


def check_rate_limit(client_id: str = "default") -> bool:
    """Check if request is within rate limit."""
    now = datetime.now().timestamp()
    window_start = now - RATE_LIMIT_WINDOW

    if client_id not in _rate_limit_store:
        _rate_limit_store[client_id] = []

    _rate_limit_store[client_id] = [
        t for t in _rate_limit_store[client_id] if t > window_start
    ]

    if len(_rate_limit_store[client_id]) >= RATE_LIMIT_REQUESTS:
        return False

    _rate_limit_store[client_id].append(now)
    return True


def rate_limit_dependency():
    """FastAPI dependency for rate limiting."""
    if not check_rate_limit():
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Signal requests limited to 50/minute.",
        )
    return True


# =============================================================================
# Enums and Models
# =============================================================================


class SignalType(str, Enum):
    """Investment signal direction."""

    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


class SignalStrength(str, Enum):
    """Signal conviction strength."""

    WEAK = "weak"
    MODERATE = "moderate"
    STRONG = "strong"
    VERY_STRONG = "very_strong"


class SignalRequest(BaseModel):
    """Request for signal generation."""

    symbols: List[str] = Field(
        ..., description="List of stock symbols to generate signals for"
    )
    min_conviction: float = Field(
        default=0.3, ge=0, le=1, description="Minimum conviction threshold"
    )
    include_news: bool = Field(
        default=True, description="Include recent news for signal symbols"
    )


class BacktestRequest(BaseModel):
    """Request for signal backtesting."""

    symbols: List[str] = Field(..., description="Symbols to backtest")
    start_date: Optional[str] = Field(
        default=None, description="Start date (YYYY-MM-DD)"
    )
    end_date: Optional[str] = Field(default=None, description="End date (YYYY-MM-DD)")
    holding_period_days: int = Field(
        default=30, ge=1, le=365, description="Holding period in days"
    )
    initial_capital: float = Field(
        default=100000, ge=1000, description="Initial capital for backtest"
    )
    position_size_pct: float = Field(
        default=0.10, ge=0.01, le=1.0, description="Position size as percentage"
    )


class SignalConfigRequest(BaseModel):
    """Request for signal configuration."""

    min_conviction: Optional[float] = Field(
        None, ge=0, le=1, description="Minimum conviction threshold"
    )
    factor_weights: Optional[Dict[str, float]] = Field(
        None, description="Custom factor weights"
    )
    risk_tolerance: Optional[str] = Field(
        None, description="Risk tolerance: conservative, moderate, aggressive"
    )
    holding_period: Optional[int] = Field(
        None, ge=1, le=365, description="Target holding period in days"
    )


class Signal(BaseModel):
    """Investment signal response model."""

    signalId: str
    symbol: str
    signalType: SignalType
    strength: SignalStrength
    conviction: float
    factors: Dict[str, float]
    priceAtSignal: Optional[float] = None
    targetPrice: Optional[float] = None
    stopLoss: Optional[float] = None
    holdingPeriodDays: Optional[int] = None
    reasoning: Optional[str] = None
    timestamp: str


class BacktestResult(BaseModel):
    """Backtest result response model."""

    totalReturn: float
    sharpeRatio: float
    maxDrawdown: float
    winRate: float
    trades: int
    profitFactor: Optional[float] = None
    avgHoldingDays: Optional[float] = None


class PerformanceStats(BaseModel):
    """Performance statistics response model."""

    totalSignals: int
    completedSignals: int
    winRate: float
    avgReturn: float
    avgWin: float
    avgLoss: float
    profitFactor: float
    factorPerformance: Dict[str, float]


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Router Setup
# =============================================================================

router = APIRouter(prefix="/api/signals", tags=["Signals"])


def get_timestamp() -> str:
    """Get current ISO timestamp."""
    return datetime.utcnow().isoformat() + "Z"


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> ApiResponse:
    """Create a standardized API response."""
    return ApiResponse(
        success=success and error is None,
        data=data,
        error=error,
        timestamp=get_timestamp(),
    )


# =============================================================================
# Signal Generation Endpoints
# =============================================================================


@router.get(
    "/{symbol}",
    response_model=ApiResponse,
    summary="Generate signal for symbol",
    description="""
    Generate investment signal for a single symbol.

    Returns a multi-factor signal with:
    - Conviction indicators
    - Price targets
    - Factor breakdown
    - Risk levels
    - Recent news (optional)
    """,
)
async def get_signal(
    symbol: str,
    include_news: bool = Query(default=True, description="Include recent news"),
    _: bool = Depends(rate_limit_dependency),
):
    """Generate investment signal for a single symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.signal_generator:
            raise HTTPException(
                status_code=503, detail="Signal generator not initialized"
            )

        signal = await app_state.signal_generator.generate_signal(symbol)

        # Record for tracking
        if app_state.performance_tracker:
            app_state.performance_tracker.record_signal(signal)

        # Build response data
        response_data = signal.to_dict()

        # Fetch news if requested
        if include_news:
            news = await _get_signal_news([symbol], max_articles_per_symbol=5)
            response_data["recent_news"] = news
            logger.info(f"Signal generated for {symbol} with {len(news)} news articles")
        else:
            response_data["recent_news"] = []

        return create_response(data=response_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating signal for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.post(
    "",
    response_model=ApiResponse,
    summary="Generate signals for multiple symbols",
    description="""
    Generate signals for multiple symbols.

    Returns signals for all symbols that meet the conviction threshold,
    sorted by conviction score. Includes recent news for context.
    """,
)
async def generate_signals(
    request: SignalRequest,
    _: bool = Depends(rate_limit_dependency),
):
    """Generate signals for multiple symbols."""
    try:
        app_state = get_app_state()

        if not app_state.signal_generator:
            raise HTTPException(
                status_code=503, detail="Signal generator not initialized"
            )

        symbols = [s.upper() for s in request.symbols]

        result = await app_state.signal_generator.generate_universe_signals(
            universe=symbols,
            min_conviction=request.min_conviction,
        )

        # Convert DataFrame to list of dicts
        signals_data = result.to_dict(orient="records") if not result.empty else []

        # Fetch news if requested
        recent_news = []
        if request.include_news and symbols:
            recent_news = await _get_signal_news(symbols, max_articles_per_symbol=3)
            logger.info(
                f"Generated {len(signals_data)} signals for {len(symbols)} symbols "
                f"with {len(recent_news)} news articles"
            )

        return create_response(
            data={
                "signals": signals_data,
                "totalRequested": len(symbols),
                "signalsGenerated": len(signals_data),
                "filters": {
                    "minConviction": request.min_conviction,
                },
                "recent_news": recent_news,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating signals: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/{symbol}/composite",
    response_model=ApiResponse,
    summary="Get composite score breakdown",
    description="""
    Get detailed composite score breakdown for a symbol.

    Returns individual factor scores and their contributions
    to the overall signal. Includes recent news for context.
    """,
)
async def get_composite_score(
    symbol: str,
    include_news: bool = Query(default=True, description="Include recent news"),
    _: bool = Depends(rate_limit_dependency),
):
    """Get detailed composite score breakdown for a symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.signal_generator:
            raise HTTPException(
                status_code=503, detail="Signal generator not initialized"
            )

        composite = await app_state.signal_generator.get_composite_score(symbol)

        # Build response data
        response_data = composite.to_dict()

        # Fetch news if requested
        if include_news:
            news = await _get_signal_news([symbol], max_articles_per_symbol=5)
            response_data["recent_news"] = news
        else:
            response_data["recent_news"] = []

        return create_response(data=response_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting composite score for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Backtesting Endpoints
# =============================================================================


@router.post(
    "/backtest",
    response_model=ApiResponse,
    summary="Backtest signals",
    description="""
    Backtest investment signals against historical data.

    Returns performance metrics including:
    - Total return
    - Sharpe ratio
    - Maximum drawdown
    - Win rate
    - Trade statistics
    """,
)
async def backtest_signals(
    request: BacktestRequest,
    _: bool = Depends(rate_limit_dependency),
):
    """Backtest signals against historical data."""
    try:
        app_state = get_app_state()

        if not app_state.signal_backtester:
            raise HTTPException(
                status_code=503, detail="Signal backtester not initialized"
            )

        symbols = [s.upper() for s in request.symbols]

        # Parse dates if provided
        from datetime import datetime as dt

        start_date = (
            dt.fromisoformat(request.start_date) if request.start_date else None
        )
        end_date = dt.fromisoformat(request.end_date) if request.end_date else None

        result = await app_state.signal_backtester.backtest(
            symbols=symbols,
            start_date=start_date,
            end_date=end_date,
            holding_period_days=request.holding_period_days,
            initial_capital=request.initial_capital,
            position_size_pct=request.position_size_pct,
        )

        return create_response(data=result.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error backtesting signals: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/backtest/quick/{symbol}",
    response_model=ApiResponse,
    summary="Quick backtest for single symbol",
    description="Run a quick backtest for a single symbol with default parameters.",
)
async def quick_backtest(
    symbol: str,
    days: int = Query(90, ge=30, le=365, description="Lookback days"),
    _: bool = Depends(rate_limit_dependency),
):
    """Quick backtest for a single symbol."""
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state.signal_backtester:
            raise HTTPException(
                status_code=503, detail="Signal backtester not initialized"
            )

        from datetime import datetime as dt, timedelta

        end_date = dt.now()
        start_date = end_date - timedelta(days=days)

        result = await app_state.signal_backtester.backtest(
            symbols=[symbol],
            start_date=start_date,
            end_date=end_date,
        )

        return create_response(
            data={
                "symbol": symbol,
                "period": {
                    "start": start_date.isoformat(),
                    "end": end_date.isoformat(),
                },
                "result": result.to_dict(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error running quick backtest for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Performance Tracking Endpoints
# =============================================================================


@router.get(
    "/performance/stats",
    response_model=ApiResponse,
    summary="Get performance statistics",
    description="""
    Get aggregate performance statistics for tracked signals.

    Returns:
    - Win rate
    - Average return
    - Profit factor
    - Factor performance metrics
    """,
)
async def get_signal_performance_stats(
    _: bool = Depends(rate_limit_dependency),
):
    """Get aggregate performance statistics for tracked signals."""
    try:
        app_state = get_app_state()

        if not app_state.performance_tracker:
            raise HTTPException(
                status_code=503, detail="Performance tracker not initialized"
            )

        stats = app_state.performance_tracker.get_performance_stats()

        return create_response(data=stats.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting performance stats: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/performance/history",
    response_model=ApiResponse,
    summary="Get signal history",
    description="Get signal history with outcomes.",
)
async def get_signal_history(
    symbol: Optional[str] = Query(None, description="Filter by symbol"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
    _: bool = Depends(rate_limit_dependency),
):
    """Get signal history with outcomes."""
    try:
        app_state = get_app_state()

        if not app_state.performance_tracker:
            raise HTTPException(
                status_code=503, detail="Performance tracker not initialized"
            )

        history = app_state.performance_tracker.get_signal_history(
            symbol=symbol.upper() if symbol else None,
            limit=limit,
        )

        # Convert DataFrame to list of dicts
        history_data = history.to_dict(orient="records") if not history.empty else []

        return create_response(
            data={
                "history": history_data,
                "count": len(history_data),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting signal history: {e}")
        return create_response(error=str(e), success=False)


@router.post(
    "/{signal_id}/outcome",
    response_model=ApiResponse,
    summary="Record signal outcome",
    description="""
    Record the outcome of a signal.

    Used to track actual performance of generated signals.
    """,
)
async def record_signal_outcome(
    signal_id: str,
    exit_price: float = Query(..., description="Exit price"),
    exit_reason: str = Query(
        "manual",
        description="Reason for exit: target, stop_loss, manual, etc.",
    ),
    _: bool = Depends(rate_limit_dependency),
):
    """Record the outcome of a signal."""
    try:
        app_state = get_app_state()

        if not app_state.performance_tracker:
            raise HTTPException(
                status_code=503, detail="Performance tracker not initialized"
            )

        record = app_state.performance_tracker.record_outcome(
            signal_id=signal_id,
            exit_price=exit_price,
            exit_reason=exit_reason,
        )

        if record is None:
            raise HTTPException(status_code=404, detail=f"Signal {signal_id} not found")

        return create_response(data=record.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error recording outcome for {signal_id}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Signal Configuration Endpoints
# =============================================================================


@router.post(
    "/configure",
    response_model=ApiResponse,
    summary="Configure signal parameters",
    description="""
    Configure signal generation parameters.

    Allows customization of:
    - Conviction thresholds
    - Factor weights
    - Risk tolerance
    - Holding periods
    """,
)
async def configure_signals(
    request: SignalConfigRequest,
    _: bool = Depends(rate_limit_dependency),
):
    """Configure signal generation parameters."""
    try:
        app_state = get_app_state()

        if not app_state.signal_generator:
            raise HTTPException(
                status_code=503, detail="Signal generator not initialized"
            )

        # Apply configuration updates
        config_applied = {}

        if request.min_conviction is not None:
            app_state.signal_generator.min_conviction = request.min_conviction
            config_applied["min_conviction"] = request.min_conviction

        if request.factor_weights is not None:
            app_state.signal_generator.factor_weights = request.factor_weights
            config_applied["factor_weights"] = request.factor_weights

        if request.risk_tolerance is not None:
            app_state.signal_generator.risk_tolerance = request.risk_tolerance
            config_applied["risk_tolerance"] = request.risk_tolerance

        if request.holding_period is not None:
            app_state.signal_generator.default_holding_period = request.holding_period
            config_applied["holding_period"] = request.holding_period

        return create_response(
            data={
                "configApplied": config_applied,
                "message": "Signal configuration updated successfully",
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error configuring signals: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/configure",
    response_model=ApiResponse,
    summary="Get current signal configuration",
    description="Get the current signal generation configuration.",
)
async def get_signal_config(
    _: bool = Depends(rate_limit_dependency),
):
    """Get current signal configuration."""
    try:
        app_state = get_app_state()

        if not app_state.signal_generator:
            raise HTTPException(
                status_code=503, detail="Signal generator not initialized"
            )

        config = {
            "minConviction": getattr(app_state.signal_generator, "min_conviction", 0.3),
            "factorWeights": getattr(app_state.signal_generator, "factor_weights", {}),
            "riskTolerance": getattr(
                app_state.signal_generator, "risk_tolerance", "moderate"
            ),
            "holdingPeriod": getattr(
                app_state.signal_generator, "default_holding_period", 30
            ),
            "timestamp": get_timestamp(),
        }

        return create_response(data=config)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting signal config: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Factor Analysis Endpoints
# =============================================================================


@router.get(
    "/factors",
    response_model=ApiResponse,
    summary="List available signal factors",
    description="Get list of available factors used in signal generation.",
)
async def list_signal_factors(
    _: bool = Depends(rate_limit_dependency),
):
    """List available signal factors."""
    try:
        factors = [
            {
                "name": "money_flow",
                "description": "Sector and equity money flow analysis",
                "weight": 0.25,
            },
            {
                "name": "institutional",
                "description": "Institutional positioning from 13F filings",
                "weight": 0.25,
            },
            {
                "name": "fundamental",
                "description": "Fundamental research and valuation metrics",
                "weight": 0.20,
            },
            {
                "name": "technical",
                "description": "Technical analysis indicators",
                "weight": 0.15,
            },
            {
                "name": "sentiment",
                "description": "Market sentiment and options flow",
                "weight": 0.15,
            },
        ]

        return create_response(
            data={
                "factors": factors,
                "count": len(factors),
                "timestamp": get_timestamp(),
            }
        )

    except Exception as e:
        logger.error(f"Error listing signal factors: {e}")
        return create_response(error=str(e), success=False)


@router.get(
    "/factors/{factor_name}",
    response_model=ApiResponse,
    summary="Get factor details",
    description="Get detailed information about a specific signal factor.",
)
async def get_factor_details(
    factor_name: str,
    _: bool = Depends(rate_limit_dependency),
):
    """Get detailed information about a signal factor."""
    try:
        factor_details = {
            "money_flow": {
                "name": "Money Flow",
                "description": "Analyzes sector and equity money flow patterns",
                "subFactors": [
                    "netFlow1m",
                    "netFlow3m",
                    "flowAcceleration",
                    "smartMoneySentiment",
                ],
                "dataSource": "Market data and volume analysis",
                "updateFrequency": "Daily",
            },
            "institutional": {
                "name": "Institutional Positioning",
                "description": "13F filings analysis for institutional holdings",
                "subFactors": [
                    "ownershipChange",
                    "institutionalAccumulation",
                    "topHolderConviction",
                ],
                "dataSource": "SEC 13F filings",
                "updateFrequency": "Quarterly",
            },
            "fundamental": {
                "name": "Fundamental Research",
                "description": "Valuation and earnings quality metrics",
                "subFactors": [
                    "earningsQuality",
                    "valuationScore",
                    "growthProfile",
                    "profitability",
                ],
                "dataSource": "Financial statements and SEC filings",
                "updateFrequency": "Quarterly",
            },
            "technical": {
                "name": "Technical Analysis",
                "description": "Price and volume based indicators",
                "subFactors": [
                    "trendStrength",
                    "momentum",
                    "relativeStrength",
                    "volumeProfile",
                ],
                "dataSource": "Historical price data",
                "updateFrequency": "Daily",
            },
            "sentiment": {
                "name": "Market Sentiment",
                "description": "Options flow and market sentiment indicators",
                "subFactors": [
                    "putCallRatio",
                    "unusualOptionsActivity",
                    "darkPoolActivity",
                    "shortInterest",
                ],
                "dataSource": "Options and dark pool data",
                "updateFrequency": "Daily",
            },
        }

        factor_name_lower = factor_name.lower()
        if factor_name_lower not in factor_details:
            raise HTTPException(
                status_code=404,
                detail=f"Factor '{factor_name}' not found. Available: {list(factor_details.keys())}",
            )

        return create_response(
            data={
                "factor": factor_details[factor_name_lower],
                "timestamp": get_timestamp(),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting factor details for {factor_name}: {e}")
        return create_response(error=str(e), success=False)
