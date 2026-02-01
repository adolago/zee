"""
News Digest module for Stanley.

Provides functions to generate news digests for portfolio holdings.
"""

from .news_digest import (
    Article,
    Digest,
    generate_digest,
    search_ticker_news,
    analyze_sentiment,
    format_json,
    format_markdown,
    format_email,
    CATEGORIES,
)

__all__ = [
    "Article",
    "Digest",
    "generate_digest",
    "search_ticker_news",
    "analyze_sentiment",
    "format_json",
    "format_markdown",
    "format_email",
    "CATEGORIES",
]
