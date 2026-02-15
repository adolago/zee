"""
Stanley Institutional Analytics Router

Provides endpoints for institutional ownership data, 13F filings, and smart money analysis.

Endpoints:
- GET /api/institutional/{symbol} - 13F holdings for a symbol
- GET /api/institutional/{symbol}/ownership - Ownership breakdown
- GET /api/institutional/{symbol}/changes - Recent position changes
- GET /api/institutional/{symbol}/whales - Whale accumulation detection
- GET /api/institutional/{symbol}/sentiment - Multi-factor sentiment score
- GET /api/institutional/{symbol}/clusters - Position clustering analysis
- GET /api/institutional/{symbol}/cross-filing - Cross-filing pattern analysis
- GET /api/institutional/{symbol}/momentum - Smart money momentum tracking
- GET /api/institutional/{symbol}/smart-money-flow - Net smart money buying/selling
- GET /api/institutional/alerts/new-positions - New position alerts
- GET /api/institutional/alerts/coordinated-buying - Coordinated buying alerts
- GET /api/institutional/conviction-picks - High conviction positions
- GET /api/institutional/filing-calendar - 13F filing deadlines
"""

import importlib.util
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from stanley.api.auth.dependencies import get_optional_user, User
from stanley.api.auth.rate_limit import rate_limit, RateLimitDependency
from stanley.api.routers.base import (
    ApiResponse,
    InstitutionalHolding,
    create_response,
    get_app_state,
    get_institutional_analyzer,
)

logger = logging.getLogger(__name__)


# =============================================================================
# News Integration
# =============================================================================


async def _get_institutional_news(
    symbols: List[str], max_articles: int = 10
) -> List[Dict[str, Any]]:
    """Fetch recent institutional/insider news for symbols using news_digest skill."""
    try:
        # Find the news_digest module
        possible_paths = [
            Path(__file__).parent.parent.parent.parent
            / ".claude"
            / "skills"
            / "news-digest"
            / "scripts"
            / "news_digest.py",
            Path.home()
            / ".claude"
            / "skills"
            / "news-digest"
            / "scripts"
            / "news_digest.py",
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
            logger.warning("news_digest module not found")
            return []

        # Load the module
        spec = importlib.util.spec_from_file_location("news_digest", news_module_path)
        if spec is None or spec.loader is None:
            return []

        news_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(news_module)
        generate_digest = news_module.generate_digest

        # Get institutional-relevant news categories
        digest = await generate_digest(
            tickers=symbols,
            range_str="30d",  # Longer range for 13F filing cycles
            categories=["insider", "sec_filings", "analyst"],
            max_articles=max_articles,
        )

        # Convert Digest object to list of article dicts
        return [article.to_dict() for article in digest.articles]
    except Exception as e:
        logger.warning(f"Failed to fetch institutional news: {e}")
        return []


router = APIRouter(
    prefix="/api/institutional",
    tags=["Institutional"],
    responses={404: {"description": "Symbol not found"}},
)


# =============================================================================
# Endpoints - Symbol-Specific
# =============================================================================


@router.get("/{symbol}", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_institutional_holdings(
    symbol: str,
    request: Request,
    include_news: bool = Query(
        default=True, description="Include recent institutional news"
    ),
    user=Depends(get_optional_user),
):
    """
    Get institutional holdings data for a symbol.

    Returns 13F institutional holdings including top holders and ownership percentages.

    Args:
        symbol: Stock ticker symbol (e.g., AAPL, MSFT)
        include_news: Include recent institutional/insider news

    Returns:
        List of institutional holdings with manager names, shares, and ownership
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        # Get holdings data from the analyzer
        holdings_data = await app_state.institutional_analyzer.async_get_holdings(
            symbol
        )

        # Convert top holders DataFrame to list of InstitutionalHolding
        holdings_list = []
        top_holders = holdings_data.get("top_holders", pd.DataFrame())

        if isinstance(top_holders, pd.DataFrame) and not top_holders.empty:
            for _, row in top_holders.iterrows():
                holdings_list.append(
                    InstitutionalHolding(
                        managerName=str(row.get("manager_name", "Unknown")),
                        managerCik=str(row.get("manager_cik", "0000000000")),
                        sharesHeld=int(row.get("shares_held", 0)),
                        valueHeld=float(row.get("value_held", 0)),
                        ownershipPercentage=float(
                            row.get("ownership_percentage", 0) * 100
                        ),
                        changeFromLastQuarter=None,
                    ).model_dump()
                )
        else:
            # Use the 13F holdings data directly
            holdings_df = await app_state.institutional_analyzer._get_13f_holdings(
                symbol
            )
            for _, row in holdings_df.iterrows():
                holdings_list.append(
                    InstitutionalHolding(
                        managerName=str(row.get("manager_name", "Unknown")),
                        managerCik=str(row.get("manager_cik", "0000000000")),
                        sharesHeld=int(row.get("shares_held", 0)),
                        valueHeld=float(row.get("value_held", 0)),
                        ownershipPercentage=float(
                            row.get("ownership_percentage", 0) * 100
                        ),
                        changeFromLastQuarter=None,
                    ).model_dump()
                )

        # Fetch news if requested
        recent_news = []
        if include_news:
            recent_news = await _get_institutional_news([symbol], max_articles=10)
            logger.info(
                f"Institutional holdings for {symbol}: {len(holdings_list)} holders, "
                f"{len(recent_news)} news articles"
            )

        return create_response(
            data={
                "symbol": symbol,
                "holdings": holdings_list,
                "holdingsCount": len(holdings_list),
                "recent_news": recent_news,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching institutional holdings for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/ownership", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_ownership_breakdown(
    symbol: str,
    request: Request,
    user=Depends(get_optional_user),
):
    """
    Get ownership breakdown for a symbol.

    Returns detailed ownership metrics including institutional vs retail,
    insider ownership, and concentration metrics.

    Args:
        symbol: Stock ticker symbol (e.g., AAPL, MSFT)

    Returns:
        Ownership breakdown with institutional, retail, and insider percentages
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        holdings_data = await app_state.institutional_analyzer.async_get_holdings(
            symbol
        )

        # Calculate ownership metrics
        summary = holdings_data.get("summary", {})
        top_holders = holdings_data.get("top_holders", pd.DataFrame())

        # Calculate concentration (top 10 holders)
        top_10_ownership = 0.0
        if isinstance(top_holders, pd.DataFrame) and not top_holders.empty:
            top_10 = top_holders.head(10)
            top_10_ownership = float(top_10["ownership_percentage"].sum()) * 100

        ownership = {
            "symbol": symbol,
            "institutionalOwnership": float(
                summary.get("total_institutional_ownership", 0)
            )
            * 100,
            "retailOwnership": max(
                0, 100 - float(summary.get("total_institutional_ownership", 0)) * 100
            ),
            "insiderOwnership": float(summary.get("insider_ownership", 0)) * 100,
            "top10Concentration": round(top_10_ownership, 2),
            "totalHolders": int(summary.get("total_holders", 0)),
            "sharesOutstanding": int(summary.get("shares_outstanding", 0)),
            "floatShares": int(summary.get("float_shares", 0)),
        }

        return create_response(data=ownership)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching ownership breakdown for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/changes", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_13f_changes(
    symbol: str,
    request: Request,
    conviction_threshold: float = Query(
        default=0.05,
        ge=0.0,
        le=1.0,
        description="Minimum change to consider significant (default: 5%)",
    ),
    user=Depends(get_optional_user),
):
    """
    Get enhanced 13F change detection with conviction scoring.

    Compares current vs previous quarter to detect new/closed positions,
    significant changes, and calculates conviction scores.

    Args:
        symbol: Stock ticker symbol
        conviction_threshold: Minimum change to consider significant (default: 5%)

    Returns:
        List of position changes with change type, magnitude, and conviction score
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        changes_df = await app_state.institutional_analyzer.detect_13f_changes(
            symbol, conviction_threshold
        )

        if changes_df.empty:
            return create_response(data=[])

        changes_list = []
        for _, row in changes_df.iterrows():
            changes_list.append(
                {
                    "managerName": str(row.get("manager_name", "")),
                    "changeType": str(row.get("change_type", "")),
                    "sharesCurrent": int(row.get("shares_current", 0)),
                    "sharesPrevious": int(row.get("shares_previous", 0)),
                    "changeMagnitude": int(row.get("change_magnitude", 0)),
                    "changePercentage": round(
                        float(row.get("change_percentage", 0)), 4
                    ),
                    "convictionScore": round(float(row.get("conviction_score", 0)), 4),
                }
            )

        return create_response(data=changes_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching 13F changes for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/whales", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_whale_accumulation(
    symbol: str,
    request: Request,
    min_position_change: float = Query(
        default=0.10,
        ge=0.0,
        le=1.0,
        description="Minimum position change to trigger alert (default: 10%)",
    ),
    min_aum: float = Query(
        default=1e9,
        ge=0,
        description="Minimum AUM in dollars to consider 'whale' (default: $1B)",
    ),
    user=Depends(get_optional_user),
):
    """
    Detect whale activity alerts for large institutional position changes.

    Focuses on "smart money" by filtering institutions by AUM and
    detecting significant position changes.

    Args:
        symbol: Stock ticker symbol
        min_position_change: Minimum position change to trigger alert (default: 10%)
        min_aum: Minimum AUM in dollars to consider "whale" (default: $1B)

    Returns:
        List of whale activity alerts with institution details and change magnitude
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        whales_df = await app_state.institutional_analyzer.detect_whale_accumulation(
            symbol, min_position_change, min_aum
        )

        if whales_df.empty:
            return create_response(data=[])

        whales_list = []
        for _, row in whales_df.iterrows():
            whales_list.append(
                {
                    "institutionName": str(row.get("institution_name", "")),
                    "changeType": str(row.get("change_type", "")),
                    "magnitude": round(float(row.get("magnitude", 0)), 4),
                    "estimatedAum": float(row.get("estimated_aum", 0)),
                    "alertLevel": str(row.get("alert_level", "")),
                    "sharesChanged": int(row.get("shares_changed", 0)),
                }
            )

        return create_response(data=whales_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error detecting whale accumulation for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/sentiment", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_institutional_sentiment_score(
    symbol: str,
    request: Request,
    include_news: bool = Query(
        default=True, description="Include recent institutional news"
    ),
    user=Depends(get_optional_user),
):
    """
    Calculate multi-factor institutional sentiment score.

    Combines ownership_trend, buyer_seller_ratio, concentration_change,
    and filing_momentum into a unified sentiment score.

    Args:
        symbol: Stock ticker symbol
        include_news: Include recent institutional/insider news

    Returns:
        Sentiment score with classification, confidence, and contributing factors
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        sentiment = await app_state.institutional_analyzer.calculate_sentiment_score(
            symbol
        )

        # Fetch news if requested
        recent_news = []
        if include_news:
            recent_news = await _get_institutional_news([symbol], max_articles=10)
            logger.info(
                f"Sentiment for {symbol}: {sentiment['classification']}, {len(recent_news)} news"
            )

        return create_response(
            data={
                "symbol": symbol,
                "score": sentiment["score"],
                "classification": sentiment["classification"],
                "confidence": sentiment["confidence"],
                "contributingFactors": sentiment["contributing_factors"],
                "weightsUsed": sentiment["weights_used"],
                "recent_news": recent_news,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating sentiment for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/clusters", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_position_clusters(
    symbol: str,
    request: Request,
    n_clusters: int = Query(
        default=4,
        ge=2,
        le=10,
        description="Number of clusters (default: 4 for quartiles)",
    ),
    user=Depends(get_optional_user),
):
    """
    Position clustering analysis for institutional holdings.

    Groups institutions by position sizes using quartile-based clustering
    to identify smart money accumulation/distribution patterns.

    Args:
        symbol: Stock ticker symbol
        n_clusters: Number of clusters (default: 4 for quartiles)

    Returns:
        Cluster analysis with labels, stats, and smart money direction
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        clusters = await app_state.institutional_analyzer.cluster_positions(
            symbol, n_clusters
        )

        # Convert cluster_labels DataFrame to list if not empty
        cluster_labels = []
        if not clusters["cluster_labels"].empty:
            for _, row in clusters["cluster_labels"].iterrows():
                cluster_labels.append(
                    {
                        "managerName": str(row.get("manager_name", "")),
                        "cluster": int(row.get("cluster", 0)),
                        "clusterName": str(row.get("cluster_name", "")),
                    }
                )

        return create_response(
            data={
                "symbol": symbol,
                "clusterLabels": cluster_labels,
                "clusterStats": clusters["cluster_stats"],
                "smartMoneyDirection": clusters["smart_money_direction"],
                "clusterSummary": clusters["cluster_summary"],
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clustering positions for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/cross-filing", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_cross_filing_analysis(
    symbol: str,
    request: Request,
    min_filers: int = Query(
        default=3,
        ge=1,
        description="Minimum number of filers required for analysis (default: 3)",
    ),
    user=Depends(get_optional_user),
):
    """
    Cross-filing pattern analysis across multiple 13F filers.

    Analyzes the same stock across multiple institutional filers to detect
    coordinated buying/selling patterns.

    Args:
        symbol: Stock ticker symbol
        min_filers: Minimum number of filers required for analysis (default: 3)

    Returns:
        Cross-filing analysis with consensus direction and agreement score
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        cross_analysis = await app_state.institutional_analyzer.analyze_cross_filing(
            symbol, min_filers
        )

        return create_response(
            data={
                "symbol": symbol,
                "institutionCount": cross_analysis["institution_count"],
                "institutionAgreement": cross_analysis["institution_agreement"],
                "consensusDirection": cross_analysis["consensus_direction"],
                "crossFilingScore": cross_analysis["cross_filing_score"],
                "filingBreakdown": cross_analysis["filing_breakdown"],
                "buyersCount": cross_analysis.get("buyers_count", 0),
                "sellersCount": cross_analysis.get("sellers_count", 0),
                "holdersCount": cross_analysis.get("holders_count", 0),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing cross-filing for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/momentum", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_smart_money_momentum(
    symbol: str,
    request: Request,
    window_quarters: int = Query(
        default=4,
        ge=1,
        le=12,
        description="Number of quarters for momentum calculation (default: 4)",
    ),
    weight_by_performance: bool = Query(
        default=True,
        description="Weight by manager performance scores (default: True)",
    ),
    user=Depends(get_optional_user),
):
    """
    Track smart money momentum with rolling calculations.

    Tracks institutional momentum over configurable windows and detects
    momentum acceleration/deceleration patterns.

    Args:
        symbol: Stock ticker symbol
        window_quarters: Number of quarters for momentum calculation (default: 4)
        weight_by_performance: Weight by manager performance scores (default: True)

    Returns:
        Momentum analysis with score, trend direction, and acceleration
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        momentum = await app_state.institutional_analyzer.track_smart_money_momentum(
            symbol, window_quarters, weight_by_performance
        )

        return create_response(
            data={
                "symbol": symbol,
                "momentumScore": momentum["momentum_score"],
                "trendDirection": momentum["trend_direction"],
                "acceleration": momentum["acceleration"],
                "quarterlyMomentum": momentum["quarterly_momentum"],
                "topMovers": momentum["top_movers"],
                "signalStrength": momentum["signal_strength"],
                "windowQuarters": momentum["window_quarters"],
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error tracking momentum for {symbol}: {e}")
        return create_response(error=str(e), success=False)


@router.get("/{symbol}/smart-money-flow", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_smart_money_flow(
    symbol: str,
    request: Request,
    include_news: bool = Query(
        default=True, description="Include recent institutional news"
    ),
    user=Depends(get_optional_user),
):
    """
    Calculate net buying/selling by top-performing managers.

    Analyzes flow patterns weighted by manager performance to identify
    coordinated smart money activity.

    Args:
        symbol: Stock ticker symbol
        include_news: Include recent institutional/insider news

    Returns:
        Smart money flow with net flow, signal, and activity breakdown
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        flow = await app_state.institutional_analyzer.calculate_smart_money_flow(symbol)

        # Convert DataFrames to lists
        buying_list = []
        if not flow["buying_activity"].empty:
            for _, row in flow["buying_activity"].iterrows():
                buying_list.append(
                    {
                        "managerName": str(row.get("manager_name", "")),
                        "managerCik": str(row.get("manager_cik", "")),
                        "sharesAdded": int(row.get("shares_added", 0)),
                        "valueAdded": float(row.get("value_added", 0)),
                        "performanceScore": float(row.get("performance_score", 0)),
                    }
                )

        selling_list = []
        if not flow["selling_activity"].empty:
            for _, row in flow["selling_activity"].iterrows():
                selling_list.append(
                    {
                        "managerName": str(row.get("manager_name", "")),
                        "managerCik": str(row.get("manager_cik", "")),
                        "sharesSold": int(row.get("shares_sold", 0)),
                        "valueSold": float(row.get("value_sold", 0)),
                        "performanceScore": float(row.get("performance_score", 0)),
                    }
                )

        # Fetch news if requested
        recent_news = []
        if include_news:
            recent_news = await _get_institutional_news([symbol], max_articles=10)
            logger.info(
                f"Smart money flow for {symbol}: signal={flow['signal']}, {len(recent_news)} news"
            )

        return create_response(
            data={
                "symbol": symbol,
                "netFlow": flow["net_flow"],
                "weightedFlow": flow["weighted_flow"],
                "signal": flow["signal"],
                "signalStrength": flow["signal_strength"],
                "buyersCount": flow["buyers_count"],
                "sellersCount": flow["sellers_count"],
                "buyingActivity": buying_list,
                "sellingActivity": selling_list,
                "coordinatedBuying": flow["coordinated_buying"],
                "coordinatedSelling": flow["coordinated_selling"],
                "recent_news": recent_news,
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating smart money flow for {symbol}: {e}")
        return create_response(error=str(e), success=False)


# =============================================================================
# Endpoints - Aggregate/Alerts
# =============================================================================


@router.get("/alerts/new-positions", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_new_positions_alerts(
    request: Request,
    lookback_days: int = Query(
        default=45,
        ge=1,
        le=365,
        description="Days to look back for new positions (default: 45)",
    ),
    min_value: float = Query(
        default=1e7,
        ge=0,
        description="Minimum position value to report (default: $10M)",
    ),
    user=Depends(get_optional_user),
):
    """
    Alert on new institutional positions initiated recently.

    Args:
        lookback_days: Days to look back for new positions (default: 45)
        min_value: Minimum position value to report (default: $10M)

    Returns:
        List of new position alerts with manager details and significance
    """
    try:
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        alerts_df = await app_state.institutional_analyzer.get_new_positions_alert(
            lookback_days, min_value
        )

        if alerts_df.empty:
            return create_response(data=[])

        alerts_list = []
        for _, row in alerts_df.iterrows():
            alerts_list.append(
                {
                    "symbol": str(row.get("symbol", "")),
                    "managerName": str(row.get("manager_name", "")),
                    "managerCik": str(row.get("manager_cik", "")),
                    "positionValue": float(row.get("position_value", 0)),
                    "shares": int(row.get("shares", 0)),
                    "weight": round(float(row.get("weight", 0)), 4),
                    "managerPerformanceScore": float(
                        row.get("manager_performance_score", 0)
                    ),
                    "alertType": str(row.get("alert_type", "")),
                    "significance": round(float(row.get("significance", 0)), 4),
                }
            )

        return create_response(data=alerts_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching new position alerts: {e}")
        return create_response(error=str(e), success=False)


@router.get("/alerts/coordinated-buying", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_coordinated_buying_alerts(
    request: Request,
    min_buyers: int = Query(
        default=3,
        ge=2,
        description="Minimum number of coordinated buyers to report (default: 3)",
    ),
    lookback_days: int = Query(
        default=45,
        ge=1,
        le=365,
        description="Days to look back for coordinated activity (default: 45)",
    ),
    user=Depends(get_optional_user),
):
    """
    Alert on stocks being bought by multiple top managers.

    Args:
        min_buyers: Minimum number of coordinated buyers to report (default: 3)
        lookback_days: Days to look back for coordinated activity (default: 45)

    Returns:
        List of coordinated buying alerts with buyer details and signal strength
    """
    try:
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        alerts_df = await app_state.institutional_analyzer.get_coordinated_buying_alert(
            min_buyers, lookback_days
        )

        if alerts_df.empty:
            return create_response(data=[])

        alerts_list = []
        for _, row in alerts_df.iterrows():
            alerts_list.append(
                {
                    "symbol": str(row.get("symbol", "")),
                    "buyersCount": int(row.get("buyers_count", 0)),
                    "totalValueAdded": float(row.get("total_value_added", 0)),
                    "avgBuyerPerformance": round(
                        float(row.get("avg_buyer_performance", 0)), 4
                    ),
                    "signalStrength": round(float(row.get("signal_strength", 0)), 4),
                    "buyers": row.get("buyers", []),
                }
            )

        return create_response(data=alerts_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching coordinated buying alerts: {e}")
        return create_response(error=str(e), success=False)


@router.get("/conviction-picks", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_conviction_picks(
    request: Request,
    min_weight: float = Query(
        default=0.05,
        ge=0.0,
        le=1.0,
        description="Minimum portfolio weight to consider (default: 5%)",
    ),
    top_n_managers: int = Query(
        default=50,
        ge=1,
        le=500,
        description="Number of top managers to analyze (default: 50)",
    ),
    user=Depends(get_optional_user),
):
    """
    Get high-conviction positions (stocks with significant portfolio weight).

    Args:
        min_weight: Minimum portfolio weight to consider (default: 5%)
        top_n_managers: Number of top managers to analyze (default: 50)

    Returns:
        List of conviction picks with holder details and average weight
    """
    try:
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        picks_df = await app_state.institutional_analyzer.get_conviction_picks(
            min_weight, top_n_managers
        )

        if picks_df.empty:
            return create_response(data=[])

        picks_list = []
        for _, row in picks_df.iterrows():
            picks_list.append(
                {
                    "symbol": str(row.get("symbol", "")),
                    "holders": row.get("holders", []),
                    "avgWeight": round(float(row.get("avg_weight", 0)), 4),
                    "maxWeight": round(float(row.get("max_weight", 0)), 4),
                    "holderCount": int(row.get("holder_count", 0)),
                    "totalValue": float(row.get("total_value", 0)),
                    "avgManagerScore": round(float(row.get("avg_manager_score", 0)), 4),
                }
            )

        return create_response(data=picks_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching conviction picks: {e}")
        return create_response(error=str(e), success=False)


@router.get("/filing-calendar", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_13f_filing_calendar(
    request: Request,
    quarters_ahead: int = Query(
        default=4,
        ge=1,
        le=8,
        description="Number of quarters to look ahead (default: 4)",
    ),
    user=Depends(get_optional_user),
):
    """
    Get upcoming 13F filing deadlines.

    Args:
        quarters_ahead: Number of quarters to look ahead (default: 4)

    Returns:
        List of upcoming 13F filing deadlines with quarter details
    """
    try:
        app_state = get_app_state()

        if not app_state or not app_state.institutional_analyzer:
            raise HTTPException(
                status_code=503, detail="Institutional analyzer not initialized"
            )

        # Helper method, remains synchronous as it doesn't do I/O
        calendar_df = app_state.institutional_analyzer.get_13f_filing_calendar(
            quarters_ahead
        )

        if calendar_df.empty:
            return create_response(data=[])

        calendar_list = []
        for _, row in calendar_df.iterrows():
            calendar_list.append(
                {
                    "quarter": str(row.get("quarter", "")),
                    "quarterEnd": (
                        row["quarter_end"].isoformat()
                        if pd.notna(row.get("quarter_end"))
                        else None
                    ),
                    "filingDeadline": (
                        row["filing_deadline"].isoformat()
                        if pd.notna(row.get("filing_deadline"))
                        else None
                    ),
                    "status": str(row.get("status", "")),
                    "daysUntilDeadline": int(row.get("days_until_deadline", 0)),
                }
            )

        return create_response(data=calendar_list)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching filing calendar: {e}")
        return create_response(error=str(e), success=False)
