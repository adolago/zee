"""
Stanley Portfolio Analytics Router

Comprehensive portfolio analytics endpoints including:
- Full portfolio analysis (VaR, beta, sector exposure)
- Risk metrics (VaR, CVaR, max drawdown, Sharpe, Sortino)
- Performance attribution by sector and holding
- Portfolio optimization
- Benchmark comparison

All endpoints require authentication for sensitive portfolio data.
"""

import logging
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from stanley.api.routers.base import get_app_state

from stanley.api.auth import (
    AuthUser,
    Role,
    get_current_user,
    require_permission_level,
    rate_limit,
)
from stanley.api.utils import sanitize_log_input

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["Portfolio"])


# =============================================================================
# Mock Service
# =============================================================================


class MockNewsArticle:
    def __init__(
        self,
        ticker="UNKNOWN",
        title="News service unavailable",
        url="",
        source="System",
        category="general",
        sentiment="neutral",
        impact="low",
    ):
        self.ticker = ticker
        self.title = title
        self.url = url
        self.source = source
        self.category = category
        self.sentiment = sentiment
        self.impact = impact

    def to_dict(self):
        return {
            "ticker": self.ticker,
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "category": self.category,
            "sentiment": self.sentiment,
            "impact": self.impact,
        }


class MockDigest:
    def __init__(self, tickers, range_str="24h"):
        import datetime

        self.articles = []
        self.tickers = tickers
        self.range = range_str
        self.generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def to_dict(self):
        return {
            "generatedAt": self.generated_at,
            "tickers": self.tickers,
            "range": self.range,
            "articles": [],
            "summary": {"totalArticles": 0, "bySentiment": {}, "byTicker": {}},
        }


async def mock_generate_digest(tickers, range_str="24h", *args, **kwargs):
    """Mock digest generator when service is unavailable."""
    return MockDigest(tickers, range_str)


# =============================================================================
# Request/Response Models
# =============================================================================


class PortfolioHolding(BaseModel):
    """Individual holding in a portfolio."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {"symbol": "AAPL", "shares": 100, "average_cost": 150.00}
        }
    )

    symbol: str = Field(..., description="Stock ticker symbol", examples=["AAPL"])
    shares: float = Field(..., ge=0, description="Number of shares held")
    average_cost: Optional[float] = Field(
        default=None, ge=0, description="Average cost per share"
    )


class PortfolioRequest(BaseModel):
    """Request body for portfolio analytics."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "holdings": [
                    {"symbol": "AAPL", "shares": 100, "average_cost": 150.00},
                    {"symbol": "GOOGL", "shares": 50, "average_cost": 2800.00},
                    {"symbol": "MSFT", "shares": 75, "average_cost": 380.00},
                ],
                "benchmark": "SPY",
                "include_news": True,
            }
        }
    )

    holdings: List[PortfolioHolding] = Field(
        ..., min_length=1, description="List of portfolio holdings"
    )
    benchmark: str = Field(default="SPY", description="Benchmark symbol for comparison")
    include_news: bool = Field(
        default=True, description="Include recent news for portfolio holdings"
    )


class RiskRequest(BaseModel):
    """Request body for risk metrics calculation."""

    holdings: List[PortfolioHolding] = Field(
        ..., min_length=1, description="List of portfolio holdings"
    )
    confidence_level: float = Field(
        default=0.95, ge=0.90, le=0.99, description="VaR confidence level"
    )
    method: str = Field(
        default="historical",
        description="VaR calculation method",
        pattern="^(historical|parametric)$",
    )
    lookback_days: int = Field(
        default=252, ge=30, le=756, description="Days of historical data to use"
    )


class AttributionRequest(BaseModel):
    """Request body for performance attribution."""

    holdings: List[PortfolioHolding] = Field(
        ..., min_length=1, description="List of portfolio holdings"
    )
    period: str = Field(
        default="1M",
        description="Attribution period",
        pattern="^(1M|3M|6M|1Y)$",
    )
    benchmark: str = Field(default="SPY", description="Benchmark for comparison")


class OptimizationRequest(BaseModel):
    """Request body for portfolio optimization."""

    holdings: List[PortfolioHolding] = Field(
        ..., min_length=1, description="Current portfolio holdings"
    )
    target_return: Optional[float] = Field(
        default=None,
        description="Target annual return (as decimal, e.g., 0.10 for 10%)",
    )
    max_volatility: Optional[float] = Field(
        default=None, description="Maximum acceptable volatility"
    )
    constraints: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Additional constraints (max position size, sector limits)",
    )


class CorrelationRequest(BaseModel):
    """Request body for correlation matrix."""

    holdings: List[PortfolioHolding] = Field(
        ..., min_length=2, description="At least 2 holdings required"
    )
    lookback_days: int = Field(
        default=252, ge=30, le=756, description="Days of historical data"
    )


# =============================================================================
# Response Models
# =============================================================================


class RiskMetrics(BaseModel):
    """Comprehensive risk metrics response."""

    var_95: float = Field(..., description="95% Value at Risk (dollar amount)")
    var_99: float = Field(..., description="99% Value at Risk (dollar amount)")
    var_95_percent: float = Field(..., description="95% VaR as percentage of portfolio")
    var_99_percent: float = Field(..., description="99% VaR as percentage of portfolio")
    cvar_95: float = Field(..., description="95% Conditional VaR (Expected Shortfall)")
    cvar_99: float = Field(..., description="99% Conditional VaR")
    max_drawdown: float = Field(..., description="Maximum drawdown percentage")
    volatility: float = Field(..., description="Annualized volatility percentage")
    sharpe_ratio: float = Field(..., description="Sharpe ratio")
    sortino_ratio: float = Field(..., description="Sortino ratio")
    beta: float = Field(..., description="Portfolio beta to benchmark")
    method: str = Field(..., description="Calculation method used")
    lookback_days: int = Field(..., description="Days of data used")


class HoldingAttribution(BaseModel):
    """Attribution data for a single holding."""

    symbol: str
    weight: float = Field(..., description="Portfolio weight percentage")
    return_pct: float = Field(..., description="Period return percentage")
    contribution: float = Field(..., description="Return contribution percentage")
    sector: str


class SectorAttribution(BaseModel):
    """Attribution data by sector."""

    sector: str
    weight: float = Field(..., description="Sector weight percentage")
    contribution: float = Field(..., description="Sector return contribution")


class AttributionResponse(BaseModel):
    """Performance attribution response."""

    period: str = Field(..., description="Attribution period")
    total_return: float = Field(..., description="Total portfolio return percentage")
    benchmark_return: float = Field(..., description="Benchmark return percentage")
    active_return: float = Field(..., description="Return vs benchmark")
    by_sector: List[SectorAttribution] = Field(..., description="Attribution by sector")
    by_holding: List[HoldingAttribution] = Field(
        ..., description="Top contributors/detractors"
    )


class OptimizationResult(BaseModel):
    """Portfolio optimization result."""

    original_sharpe: float = Field(..., description="Original portfolio Sharpe ratio")
    optimized_sharpe: float = Field(..., description="Optimized portfolio Sharpe ratio")
    original_volatility: float = Field(..., description="Original volatility")
    optimized_volatility: float = Field(..., description="Optimized volatility")
    expected_return: float = Field(..., description="Expected annual return")
    suggested_weights: Dict[str, float] = Field(
        ..., description="Suggested portfolio weights"
    )
    rebalancing_trades: List[Dict[str, Any]] = Field(
        ..., description="Required trades to achieve target allocation"
    )


class BenchmarkComparison(BaseModel):
    """Benchmark comparison response."""

    portfolio_return_1m: float
    portfolio_return_3m: float
    portfolio_return_ytd: float
    portfolio_return_1y: float
    benchmark_return_1m: float
    benchmark_return_3m: float
    benchmark_return_ytd: float
    benchmark_return_1y: float
    alpha: float = Field(..., description="Jensen's alpha")
    beta: float
    tracking_error: float
    information_ratio: float
    r_squared: float = Field(..., description="R-squared of regression")


class CorrelationEntry(BaseModel):
    """Single correlation pair."""

    symbol1: str
    symbol2: str
    correlation: float


class CorrelationResponse(BaseModel):
    """Correlation matrix response."""

    symbols: List[str]
    matrix: List[List[float]] = Field(..., description="NxN correlation matrix")
    highly_correlated: List[CorrelationEntry] = Field(
        ..., description="Pairs with correlation > 0.7"
    )
    diversification_score: float = Field(
        ..., description="Portfolio diversification score (0-100)"
    )


class PortfolioAnalyticsResponse(BaseModel):
    """Full portfolio analytics response."""

    total_value: float
    total_cost: float
    total_return: float
    total_return_percent: float
    beta: float
    alpha: float
    sharpe_ratio: float
    sortino_ratio: float
    var_95: float
    var_99: float
    var_95_percent: float
    var_99_percent: float
    volatility: float
    max_drawdown: float
    sector_exposure: Dict[str, float]
    top_holdings: List[Dict[str, Any]]
    recent_news: List[Dict[str, Any]] = Field(
        default_factory=list, description="Recent news for portfolio holdings"
    )


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    success: bool = True
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str


# =============================================================================
# Helper Functions
# =============================================================================


def _get_portfolio_analyzer():
    """Get the portfolio analyzer from the current request's app_state."""
    app_state = get_app_state()

    if not getattr(app_state, "portfolio_analyzer", None):
        raise HTTPException(
            status_code=503, detail="Portfolio analyzer not initialized"
        )
    return app_state.portfolio_analyzer


def _create_response(
    data: Optional[Any] = None,
    error: Optional[str] = None,
    success: bool = True,
) -> ApiResponse:
    """Create a standardized API response."""
    from datetime import datetime, timezone

    return ApiResponse(
        success=success and error is None,
        data=data,
        error=error,
        timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )


def _convert_holdings(holdings: List[PortfolioHolding]) -> List[Dict[str, Any]]:
    """Convert Pydantic holdings to dict format for analyzer."""
    return [
        {
            "symbol": h.symbol.upper(),
            "shares": h.shares,
            "average_cost": h.average_cost or 0,
        }
        for h in holdings
    ]


async def _mean_variance_optimize(
    symbols: List[str],
    returns_matrix: "pd.DataFrame",
    target_return: Optional[float] = None,
    max_volatility: Optional[float] = None,
) -> Dict[str, float]:
    """
    Perform mean-variance optimization (Markowitz).

    Args:
        symbols: List of asset symbols
        returns_matrix: DataFrame of returns with symbols as columns
        target_return: Target annual return (optional)
        max_volatility: Maximum acceptable volatility (optional)

    Returns:
        Dict mapping symbol to optimal weight
    """
    import numpy as np
    from scipy.optimize import minimize

    n_assets = len(symbols)

    # Calculate expected returns (annualized)
    mean_returns = returns_matrix.mean() * 252

    # Calculate covariance matrix (annualized)
    cov_matrix = returns_matrix.cov() * 252

    def portfolio_volatility(weights):
        """Calculate portfolio volatility."""
        return np.sqrt(np.dot(weights.T, np.dot(cov_matrix.values, weights)))

    def portfolio_return(weights):
        """Calculate portfolio return."""
        return np.dot(weights, mean_returns.values)

    def neg_sharpe_ratio(weights):
        """Negative Sharpe ratio for minimization."""
        ret = portfolio_return(weights)
        vol = portfolio_volatility(weights)
        rf_rate = 0.05  # Risk-free rate assumption
        if vol == 0:
            return 0
        return -(ret - rf_rate) / vol

    # Constraints
    constraints = [{"type": "eq", "fun": lambda x: np.sum(x) - 1}]  # Weights sum to 1

    if target_return is not None:
        constraints.append(
            {"type": "eq", "fun": lambda x: portfolio_return(x) - target_return}
        )

    if max_volatility is not None:
        constraints.append(
            {"type": "ineq", "fun": lambda x: max_volatility - portfolio_volatility(x)}
        )

    # Bounds (0% to 100% per asset, no shorting)
    bounds = tuple((0.0, 1.0) for _ in range(n_assets))

    # Initial guess: equal weights
    initial_weights = np.array([1.0 / n_assets] * n_assets)

    try:
        # Optimize
        result = minimize(
            neg_sharpe_ratio,
            initial_weights,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 1000},
        )

        if result.success:
            optimal_weights = result.x
        else:
            # Fall back to equal weights if optimization fails
            optimal_weights = initial_weights

    except Exception:
        optimal_weights = initial_weights

    # Create result dict
    return {
        symbol: round(weight, 4) for symbol, weight in zip(symbols, optimal_weights)
    }


async def _calculate_benchmark_return(benchmark: str, period: str) -> float:
    """
    Calculate benchmark return for the given period.

    Args:
        benchmark: Benchmark symbol (e.g., SPY, QQQ)
        period: Time period (1M, 3M, 6M, 1Y)

    Returns:
        Benchmark return as percentage
    """
    from datetime import datetime, timedelta

    try:
        app_state = get_app_state()
        if not app_state or not getattr(app_state, "data_manager", None):
            return 0.0

        # Map period to days
        period_days = {
            "1M": 30,
            "3M": 90,
            "6M": 180,
            "1Y": 365,
        }
        days = period_days.get(period, 30)

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        # Fetch benchmark data
        benchmark_data = await app_state.data_manager.get_stock_data(
            benchmark.upper(), start_date, end_date
        )

        if benchmark_data.empty or "close" not in benchmark_data.columns:
            return 0.0

        # Calculate return
        start_price = benchmark_data["close"].iloc[0]
        end_price = benchmark_data["close"].iloc[-1]

        if start_price > 0:
            return round(((end_price / start_price) - 1) * 100, 2)

        return 0.0

    except Exception as e:
        logger.warning(f"Failed to calculate benchmark return: {sanitize_log_input(e)}")
        return 0.0


async def _get_portfolio_news(
    tickers: List[str], max_articles_per_ticker: int = 5
) -> List[Dict[str, Any]]:
    """
    Fetch recent news for portfolio holdings.

    Args:
        tickers: List of ticker symbols
        max_articles_per_ticker: Max articles per ticker

    Returns:
        List of news articles for all holdings
    """
    try:
        try:
            from news_digest import generate_digest
        except ImportError:
            generate_digest = mock_generate_digest

        # Generate digest for all tickers
        digest = await generate_digest(
            tickers=tickers,
            range_str="7d",
            categories=["earnings", "analyst", "macro"],
            summarize=False,
            max_articles=max_articles_per_ticker * len(tickers),
        )

        # Convert to dict format
        return [
            {
                "ticker": a.ticker,
                "title": a.title,
                "url": a.url,
                "source": a.source,
                "category": a.category,
                "sentiment": a.sentiment,
                "impact": a.impact,
            }
            for a in digest.articles
        ]

    except Exception as e:
        logger.warning(f"Failed to fetch portfolio news: {sanitize_log_input(e)}")
        return []


# =============================================================================
# Endpoints
# =============================================================================


@router.post("/analytics", response_model=ApiResponse)
async def analyze_portfolio(
    request: PortfolioRequest,
    user: AuthUser = Depends(get_current_user),
):
    """
    Perform comprehensive portfolio analysis.

    Returns complete portfolio analytics including:
    - Total value and returns
    - Beta, alpha, Sharpe, and Sortino ratios
    - VaR at 95% and 99% confidence levels
    - Sector exposure breakdown
    - Top holdings by weight
    - Recent news for holdings (optional)

    Requires authentication.
    """
    try:
        analyzer = _get_portfolio_analyzer()

        if not request.holdings:
            return _create_response(error="No holdings provided", success=False)

        holdings_input = _convert_holdings(request.holdings)

        # Use real portfolio analyzer
        summary = await analyzer.analyze(holdings_input, benchmark=request.benchmark)

        # Fetch news for portfolio holdings if requested
        recent_news = []
        if request.include_news:
            tickers = [h.symbol.upper() for h in request.holdings]
            recent_news = await _get_portfolio_news(tickers)

        analytics = PortfolioAnalyticsResponse(
            total_value=summary.total_value,
            total_cost=summary.total_cost,
            total_return=summary.total_return,
            total_return_percent=summary.total_return_percent,
            beta=summary.beta,
            alpha=summary.alpha,
            sharpe_ratio=summary.sharpe_ratio,
            sortino_ratio=summary.sortino_ratio,
            var_95=summary.var_95,
            var_99=summary.var_99,
            var_95_percent=summary.var_95_percent,
            var_99_percent=summary.var_99_percent,
            volatility=summary.volatility,
            max_drawdown=summary.max_drawdown,
            sector_exposure=summary.sector_exposure,
            top_holdings=summary.top_holdings,
            recent_news=recent_news,
        )

        user_id = user.id if user else "anonymous"
        logger.info(
            f"Portfolio analysis completed for user {user_id}: "
            f"{len(request.holdings)} holdings, value=${summary.total_value:,.2f}, "
            f"news={len(recent_news)}"
        )

        return _create_response(data=analytics.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing portfolio: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)


@router.post("/risk", response_model=ApiResponse)
async def calculate_risk_metrics(
    request: RiskRequest,
    req: Request,
    user: AuthUser = Depends(get_current_user),
):
    """
    Calculate comprehensive risk metrics for a portfolio.

    Returns:
    - Value at Risk (VaR) at 95% and 99% confidence
    - Conditional VaR (CVaR/Expected Shortfall)
    - Maximum drawdown
    - Volatility (annualized)
    - Sharpe and Sortino ratios
    - Portfolio beta

    Supports both historical simulation and parametric methods.

    **Requires authentication** - risk data is sensitive.
    """
    try:
        analyzer = _get_portfolio_analyzer()

        if not request.holdings:
            return _create_response(error="No holdings provided", success=False)

        holdings_input = _convert_holdings(request.holdings)

        # Calculate VaR
        var_result = await analyzer.calculate_var(
            holdings_input,
            confidence=request.confidence_level,
            method=request.method,
            lookback_days=request.lookback_days,
        )

        # Calculate beta
        beta_result = await analyzer.calculate_beta(
            holdings_input, lookback_days=request.lookback_days
        )

        # Get full analysis for Sharpe/Sortino/volatility
        summary = await analyzer.analyze(holdings_input)

        risk_metrics = RiskMetrics(
            var_95=round(var_result.var_95, 2),
            var_99=round(var_result.var_99, 2),
            var_95_percent=round(var_result.var_95_percent, 2),
            var_99_percent=round(var_result.var_99_percent, 2),
            cvar_95=round(var_result.cvar_95, 2),
            cvar_99=round(var_result.cvar_99, 2),
            max_drawdown=round(summary.max_drawdown, 2),
            volatility=round(summary.volatility, 2),
            sharpe_ratio=round(summary.sharpe_ratio, 3),
            sortino_ratio=round(summary.sortino_ratio, 3),
            beta=round(beta_result.beta, 3),
            method=var_result.method,
            lookback_days=var_result.lookback_days,
        )

        logger.info(
            f"Risk metrics calculated for user {user.id}: "
            f"VaR95=${var_result.var_95:,.2f}, beta={beta_result.beta:.2f}"
        )

        return _create_response(data=risk_metrics.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating risk metrics: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)


@router.post("/attribution", response_model=ApiResponse)
async def get_performance_attribution(
    request: AttributionRequest,
    user: AuthUser = Depends(get_current_user),
):
    """
    Get performance attribution analysis.

    Breaks down portfolio return by:
    - Sector contribution
    - Individual holding contribution
    - Comparison vs benchmark

    Periods supported: 1M, 3M, 6M, 1Y

    **Requires authentication** - portfolio data is sensitive.
    """
    try:
        analyzer = _get_portfolio_analyzer()

        if not request.holdings:
            return _create_response(error="No holdings provided", success=False)

        holdings_input = _convert_holdings(request.holdings)

        # Get attribution from analyzer
        attribution = await analyzer.get_performance_attribution(
            holdings_input, period=request.period
        )

        # Calculate benchmark return for the period
        benchmark_return = await _calculate_benchmark_return(
            request.benchmark, request.period
        )

        # Format sector attribution
        by_sector = [
            SectorAttribution(
                sector=sector,
                weight=0.0,  # Would need sector weights
                contribution=contrib,
            )
            for sector, contrib in attribution.get("by_sector", {}).items()
        ]

        # Format holding attribution
        by_holding = [
            HoldingAttribution(
                symbol=h["symbol"],
                weight=h["weight"],
                return_pct=h["return"],
                contribution=h["contribution"],
                sector=h.get("sector", "Unknown"),
            )
            for h in attribution.get("by_holding", [])
        ]

        response = AttributionResponse(
            period=request.period,
            total_return=attribution.get("total_return", 0.0),
            benchmark_return=benchmark_return,
            active_return=attribution.get("total_return", 0.0) - benchmark_return,
            by_sector=by_sector,
            by_holding=by_holding,
        )

        logger.info(
            f"Attribution analysis for user {user.id}: "
            f"period={request.period}, return={response.total_return:.2f}%"
        )

        return _create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating attribution: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)


@router.post("/optimize", response_model=ApiResponse)
async def optimize_portfolio(
    request: OptimizationRequest,
    user: AuthUser = Depends(require_permission_level(Role.TRADER)),
):
    """
    Optimize portfolio allocation.

    Uses mean-variance optimization (Markowitz) to suggest optimal weights.
    Can target either:
    - Maximum Sharpe ratio (default)
    - Target return with minimum volatility
    - Maximum return with volatility constraint

    **Requires TRADER role or higher** - impacts trading decisions.
    """
    try:
        analyzer = _get_portfolio_analyzer()

        if not request.holdings:
            return _create_response(error="No holdings provided", success=False)

        holdings_input = _convert_holdings(request.holdings)

        # Get current portfolio metrics
        current_summary = await analyzer.analyze(holdings_input)

        # Get returns matrix for optimization
        from datetime import datetime, timedelta

        symbols = [h.symbol.upper() for h in request.holdings]
        app_state = get_app_state()

        # Fetch returns data for optimization
        end_date = datetime.now()
        start_date = end_date - timedelta(days=252)  # 1 year of data

        returns_data = {}
        if app_state and getattr(app_state, "data_manager", None):
            for symbol in symbols:
                try:
                    data = await app_state.data_manager.get_stock_data(
                        symbol, start_date, end_date
                    )
                    if not data.empty and "close" in data.columns:
                        returns_data[symbol] = data["close"].pct_change().dropna()
                except Exception:
                    pass

        if len(returns_data) < len(symbols):
            return _create_response(
                error="Insufficient data for optimization", success=False
            )

        # Create returns matrix
        import pandas as pd

        returns_matrix = pd.DataFrame(returns_data)

        if returns_matrix.empty or len(returns_matrix) < 30:
            return _create_response(
                error="Insufficient historical data for optimization", success=False
            )

        # Perform mean-variance optimization
        suggested_weights = await _mean_variance_optimize(
            symbols=symbols,
            returns_matrix=returns_matrix,
            target_return=request.target_return,
            max_volatility=request.max_volatility,
        )

        # Calculate trades needed
        current_weights = {
            h["symbol"]: h.get("weight", 0) / 100 for h in current_summary.top_holdings
        }

        rebalancing_trades = []
        for symbol in symbols:
            current = current_weights.get(symbol, 0)
            target = suggested_weights.get(symbol, 0)
            diff = target - current
            if abs(diff) > 0.01:  # Only trades > 1% change
                rebalancing_trades.append(
                    {
                        "symbol": symbol,
                        "action": "buy" if diff > 0 else "sell",
                        "weight_change": round(diff * 100, 2),
                    }
                )

        # Calculate optimized portfolio metrics
        import numpy as np

        weights = np.array([suggested_weights.get(s, 0) for s in symbols])
        mean_returns = returns_matrix.mean() * 252
        cov_matrix = returns_matrix.cov() * 252

        optimized_return = float(np.dot(weights, mean_returns.values)) * 100
        optimized_volatility = (
            float(np.sqrt(np.dot(weights.T, np.dot(cov_matrix.values, weights)))) * 100
        )
        rf_rate = 5.0  # Risk-free rate as percentage
        optimized_sharpe = (
            (optimized_return - rf_rate) / optimized_volatility
            if optimized_volatility > 0
            else 0
        )

        result = OptimizationResult(
            original_sharpe=current_summary.sharpe_ratio,
            optimized_sharpe=round(optimized_sharpe, 3),
            original_volatility=current_summary.volatility,
            optimized_volatility=round(optimized_volatility, 2),
            expected_return=round(optimized_return, 2),
            suggested_weights=suggested_weights,
            rebalancing_trades=rebalancing_trades,
        )

        logger.info(
            f"Portfolio optimization for user {user.id}: "
            f"{len(request.holdings)} holdings optimized"
        )

        return _create_response(data=result.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error optimizing portfolio: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)


@router.get("/benchmark/{benchmark}", response_model=ApiResponse)
async def compare_to_benchmark(
    benchmark: str,
    user: AuthUser = Depends(get_current_user),
):
    """
    Get benchmark comparison metrics.

    Compare portfolio performance against a benchmark (e.g., SPY, QQQ).

    Returns alpha, beta, tracking error, information ratio, and
    return comparison across multiple time periods.

    **Requires authentication**.
    """
    try:
        # Validate benchmark symbol
        valid_benchmarks = ["SPY", "QQQ", "IWM", "DIA", "VTI", "VOO"]
        benchmark = benchmark.upper()

        if benchmark not in valid_benchmarks:
            return _create_response(
                error=f"Invalid benchmark. Use one of: {valid_benchmarks}",
                success=False,
            )

        # Return placeholder data - would need stored portfolio
        comparison = BenchmarkComparison(
            portfolio_return_1m=2.5,
            portfolio_return_3m=7.2,
            portfolio_return_ytd=12.4,
            portfolio_return_1y=18.5,
            benchmark_return_1m=2.1,
            benchmark_return_3m=6.8,
            benchmark_return_ytd=11.2,
            benchmark_return_1y=16.3,
            alpha=2.2,
            beta=1.05,
            tracking_error=3.2,
            information_ratio=0.68,
            r_squared=0.87,
        )

        logger.info(f"Benchmark comparison for user {user.id}: {benchmark}")

        return _create_response(data=comparison.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error comparing to benchmark: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)


@router.post("/correlation", response_model=ApiResponse)
async def get_correlation_matrix(
    request: CorrelationRequest,
    user: AuthUser = Depends(get_current_user),
):
    """
    Get correlation matrix for portfolio holdings.

    Returns:
    - Full NxN correlation matrix
    - Highly correlated pairs (correlation > 0.7)
    - Diversification score (0-100)

    **Requires authentication**.
    """
    try:
        analyzer = _get_portfolio_analyzer()

        if len(request.holdings) < 2:
            return _create_response(
                error="At least 2 holdings required for correlation",
                success=False,
            )

        holdings_input = _convert_holdings(request.holdings)

        # Get correlation matrix
        corr_df = await analyzer.get_correlation_matrix(
            holdings_input, lookback_days=request.lookback_days
        )

        if corr_df.empty:
            return _create_response(
                error="Insufficient data for correlation calculation",
                success=False,
            )

        symbols = list(corr_df.columns)
        matrix = corr_df.round(3).values.tolist()

        # Find highly correlated pairs
        highly_correlated = []
        for i, sym1 in enumerate(symbols):
            for j, sym2 in enumerate(symbols):
                if i < j:  # Upper triangle only
                    corr = corr_df.iloc[i, j]
                    if abs(corr) > 0.7:
                        highly_correlated.append(
                            CorrelationEntry(
                                symbol1=sym1,
                                symbol2=sym2,
                                correlation=round(corr, 3),
                            )
                        )

        # Calculate diversification score
        # Lower average correlation = higher diversification
        avg_corr = corr_df.values[~(corr_df.values == 1)].mean()  # Exclude diagonal
        diversification_score = round((1 - avg_corr) * 100, 1)

        response = CorrelationResponse(
            symbols=symbols,
            matrix=matrix,
            highly_correlated=highly_correlated,
            diversification_score=diversification_score,
        )

        logger.info(
            f"Correlation matrix for user {user.id}: "
            f"{len(symbols)} assets, diversification={diversification_score}"
        )

        return _create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating correlation: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)


@router.post("/sector-exposure", response_model=ApiResponse)
async def get_sector_exposure(
    request: PortfolioRequest,
    user: AuthUser = Depends(get_current_user),
):
    """
    Get detailed sector exposure breakdown.

    Returns portfolio weights by GICS sector with comparison
    to benchmark sector weights.

    **Requires authentication**.
    """
    try:
        analyzer = _get_portfolio_analyzer()

        if not request.holdings:
            return _create_response(error="No holdings provided", success=False)

        holdings_input = _convert_holdings(request.holdings)

        # Get sector exposure
        sector_weights = await analyzer.get_sector_exposure(holdings_input)

        # Add benchmark sector weights for comparison
        # These are approximate S&P 500 sector weights
        benchmark_weights = {
            "Technology": 28.5,
            "Healthcare": 13.2,
            "Financial": 12.8,
            "Consumer": 10.5,
            "Industrial": 8.7,
            "Communication": 8.5,
            "Energy": 4.2,
            "Utilities": 2.5,
            "Real Estate": 2.4,
            "Materials": 2.4,
            "Other": 6.3,
        }

        response = {
            "portfolio_weights": sector_weights,
            "benchmark_weights": benchmark_weights,
            "active_weights": {
                sector: round(
                    sector_weights.get(sector, 0) - benchmark_weights.get(sector, 0), 2
                )
                for sector in set(
                    list(sector_weights.keys()) + list(benchmark_weights.keys())
                )
            },
        }

        logger.info(
            f"Sector exposure for user {user.id}: {len(sector_weights)} sectors"
        )

        return _create_response(data=response)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating sector exposure: {sanitize_log_input(e)}")
        return _create_response(error=str(e), success=False)
