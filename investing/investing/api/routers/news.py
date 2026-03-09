"""
Investing News Router

Provides news digest endpoints for portfolio holdings and watchlist.
Uses agent-core infrastructure for web search via Exa MCP.

Rate limited to 10 requests/minute (external API calls).
"""

import logging
import sys
from enum import Enum
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from investing.api.auth.dependencies import get_optional_user, User
from investing.api.auth.rate_limit import RateLimitDependency
from investing.api.utils import sanitize_error, sanitize_log_input

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["News"])


# =============================================================================
# Enums
# =============================================================================


class NewsRange(str, Enum):
    """Time range for news search."""

    DAY = "24h"
    WEEK = "7d"
    MONTH = "30d"


class NewsCategory(str, Enum):
    """News category types."""

    GENERAL = "general"
    EARNINGS = "earnings"
    SEC_FILINGS = "sec_filings"
    ANALYST = "analyst"
    INSIDER = "insider"
    MA = "ma"
    MACRO = "macro"


class NewsFormat(str, Enum):
    """Output format for news digest."""

    JSON = "json"
    MARKDOWN = "markdown"
    EMAIL = "email"


# =============================================================================
# Response Models
# =============================================================================


class NewsArticle(BaseModel):
    """Single news article."""

    model_config = ConfigDict(populate_by_name=True)

    ticker: str
    category: str
    title: str
    url: str
    source: str
    description: Optional[str] = None
    published: Optional[str] = None
    summary: Optional[str] = None
    sentiment: str = "neutral"
    impact: str = "medium"

    def to_dict(self):
        return self.model_dump(by_alias=True)


class NewsSummary(BaseModel):
    """News digest summary statistics."""

    model_config = ConfigDict(populate_by_name=True)

    total_articles: int = Field(alias="totalArticles")
    by_sentiment: Dict[str, int] = Field(alias="bySentiment")
    by_ticker: Dict[str, int] = Field(alias="byTicker")


class NewsDigestResponse(BaseModel):
    """Complete news digest response."""

    model_config = ConfigDict(populate_by_name=True)

    generated_at: str = Field(alias="generatedAt")
    tickers: List[str]
    range: str
    articles: List[NewsArticle]
    summary: NewsSummary

    def to_dict(self):
        return self.model_dump(by_alias=True)


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
# Mock Service
# =============================================================================


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
    logger.warning(
        "News digest service is unavailable (module not found). Returning empty response."
    )
    return MockDigest(tickers, range_str)


# =============================================================================
# News Endpoints
# =============================================================================


# Rate limit dependency for news endpoints (10/min - external API calls)
news_rate_limit = RateLimitDependency(requests=10, window=60, category="news")


@router.get(
    "/news/digest/{symbols}",
    response_model=ApiResponse,
    summary="Get news digest for symbols",
    description="Generate a comprehensive news digest for specified ticker symbols. "
    "Aggregates news from multiple categories including earnings, SEC filings, "
    "analyst ratings, insider trading, and M&A activity.",
)
async def get_news_digest(
    symbols: str,
    request: Request,
    range: NewsRange = Query(
        default=NewsRange.DAY, description="Time range for news search"
    ),
    categories: Optional[str] = Query(
        default=None,
        description="Comma-separated categories (general,earnings,sec_filings,analyst,insider,ma,macro)",
    ),
    max_articles: int = Query(
        default=50, ge=1, le=100, description="Maximum articles to return"
    ),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(news_rate_limit),
) -> Dict[str, Any]:
    """
    Generate news digest for specified symbols.

    Args:
        symbols: Comma-separated list of ticker symbols (e.g., "AAPL,NVDA,MSFT")
        range: Time range for news (24h, 7d, 30d)
        categories: Optional filter for news categories
        max_articles: Maximum number of articles to return
        user: Optional authenticated user
    """
    try:
        # Parse tickers
        tickers = [t.strip().upper() for t in symbols.split(",") if t.strip()]
        if not tickers:
            return create_response(error="No valid tickers provided", success=False)

        # Parse categories if provided
        category_list = None
        if categories:
            category_list = [c.strip().lower() for c in categories.split(",")]
            # Validate categories
            valid_categories = {e.value for e in NewsCategory}
            invalid = set(category_list) - valid_categories
            if invalid:
                return create_response(
                    error=f"Invalid categories: {', '.join(invalid)}. "
                    f"Valid: {', '.join(valid_categories)}",
                    success=False,
                )

        # Import and run news digest
        try:
            from news_digest import generate_digest
        except ImportError:
            generate_digest = mock_generate_digest

        digest = await generate_digest(
            tickers=tickers,
            range_str=range.value,
            categories=category_list,
            summarize=False,
            max_articles=max_articles,
        )

        return create_response(data=digest.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error generating news digest for {sanitize_log_input(symbols)}: {sanitize_log_input(e)}"
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get(
    "/news/{symbol}",
    response_model=ApiResponse,
    summary="Get news for single symbol",
    description="Get recent news for a single ticker symbol with sentiment analysis.",
)
async def get_symbol_news(
    symbol: str,
    request: Request,
    range: NewsRange = Query(
        default=NewsRange.DAY, description="Time range for news search"
    ),
    category: Optional[NewsCategory] = Query(
        default=None, description="Filter by specific category"
    ),
    limit: int = Query(default=20, ge=1, le=50, description="Maximum articles"),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(news_rate_limit),
) -> Dict[str, Any]:
    """
    Get news for a single symbol.

    Args:
        symbol: Stock ticker symbol
        range: Time range for news
        category: Optional specific category filter
        limit: Maximum number of articles
    """
    try:
        symbol = symbol.upper()

        # Build category list
        categories = [category.value] if category else None

        # Import and run news digest
        try:
            from news_digest import generate_digest
        except ImportError:
            generate_digest = mock_generate_digest

        digest = await generate_digest(
            tickers=[symbol],
            range_str=range.value,
            categories=categories,
            summarize=False,
            max_articles=limit,
        )

        # Return simplified response for single symbol
        result = {
            "symbol": symbol,
            "range": range.value,
            "totalArticles": len(digest.articles),
            "articles": [a.to_dict() for a in digest.articles],
            "sentiment": {
                "positive": sum(
                    1 for a in digest.articles if a.sentiment == "positive"
                ),
                "neutral": sum(1 for a in digest.articles if a.sentiment == "neutral"),
                "negative": sum(
                    1 for a in digest.articles if a.sentiment == "negative"
                ),
            },
        }

        return create_response(data=result)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error fetching news for {sanitize_log_input(symbol)}: {sanitize_log_input(e)}"
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get(
    "/news/{symbol}/earnings",
    response_model=ApiResponse,
    summary="Get earnings-related news",
    description="Get news specifically related to earnings reports and estimates.",
)
async def get_earnings_news(
    symbol: str,
    request: Request,
    range: NewsRange = Query(default=NewsRange.WEEK, description="Time range"),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(news_rate_limit),
) -> Dict[str, Any]:
    """Get earnings-specific news for a symbol."""
    try:
        symbol = symbol.upper()

        try:
            from news_digest import generate_digest
        except ImportError:
            generate_digest = mock_generate_digest

        digest = await generate_digest(
            tickers=[symbol],
            range_str=range.value,
            categories=["earnings"],
            summarize=False,
            max_articles=20,
        )

        return create_response(
            data={
                "symbol": symbol,
                "category": "earnings",
                "articles": [a.to_dict() for a in digest.articles],
            }
        )

    except Exception as e:
        logger.error(
            f"Error fetching earnings news for {sanitize_log_input(symbol)}: {sanitize_log_input(e)}"
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get(
    "/news/{symbol}/analyst",
    response_model=ApiResponse,
    summary="Get analyst activity news",
    description="Get news about analyst ratings, upgrades, downgrades, and price targets.",
)
async def get_analyst_news(
    symbol: str,
    request: Request,
    range: NewsRange = Query(default=NewsRange.WEEK, description="Time range"),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(news_rate_limit),
) -> Dict[str, Any]:
    """Get analyst-related news for a symbol."""
    try:
        symbol = symbol.upper()

        try:
            from news_digest import generate_digest
        except ImportError:
            generate_digest = mock_generate_digest

        digest = await generate_digest(
            tickers=[symbol],
            range_str=range.value,
            categories=["analyst"],
            summarize=False,
            max_articles=20,
        )

        return create_response(
            data={
                "symbol": symbol,
                "category": "analyst",
                "articles": [a.to_dict() for a in digest.articles],
            }
        )

    except Exception as e:
        logger.error(
            f"Error fetching analyst news for {sanitize_log_input(symbol)}: {sanitize_log_input(e)}"
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get(
    "/news/{symbol}/filings",
    response_model=ApiResponse,
    summary="Get SEC filing news",
    description="Get news about SEC filings including 10-K, 10-Q, and 8-K reports.",
)
async def get_filings_news(
    symbol: str,
    request: Request,
    range: NewsRange = Query(default=NewsRange.MONTH, description="Time range"),
    user: Optional[User] = Depends(get_optional_user),
    _rate_limit: None = Depends(news_rate_limit),
) -> Dict[str, Any]:
    """Get SEC filings news for a symbol."""
    try:
        symbol = symbol.upper()

        try:
            from news_digest import generate_digest
        except ImportError:
            generate_digest = mock_generate_digest

        digest = await generate_digest(
            tickers=[symbol],
            range_str=range.value,
            categories=["sec_filings"],
            summarize=False,
            max_articles=20,
        )

        return create_response(
            data={
                "symbol": symbol,
                "category": "sec_filings",
                "articles": [a.to_dict() for a in digest.articles],
            }
        )

    except Exception as e:
        logger.error(
            f"Error fetching filings news for {sanitize_log_input(symbol)}: {sanitize_log_input(e)}"
        )
        return create_response(error=sanitize_error(e), success=False)
