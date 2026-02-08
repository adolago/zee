"""
Market data module - OpenBB Platform integration for quotes, charts, fundamentals, and segments.
"""

from stanley.market.quotes import get_quote, get_quotes
from stanley.market.charts import get_chart
from stanley.market.fundamentals import get_fundamentals
from stanley.market.segments import get_segments

__all__ = ["MarketData", "get_quote", "get_quotes", "get_chart", "get_fundamentals", "get_segments"]


class MarketData:
    """High-level interface for market data operations."""

    @staticmethod
    def quote(symbol: str) -> dict:
        """Get real-time quote for a symbol."""
        return get_quote(symbol)

    @staticmethod
    def quotes(symbols: list[str]) -> list[dict]:
        """Get real-time quotes for multiple symbols."""
        return get_quotes(symbols)

    @staticmethod
    def chart(symbol: str, period: str = "1m", interval: str = "1d") -> dict:
        """Get historical price chart."""
        return get_chart(symbol, period, interval)

    @staticmethod
    def fundamentals(symbol: str) -> dict:
        """Get fundamental data (P/E, market cap, etc.)."""
        return get_fundamentals(symbol)

    @staticmethod
    def segments(symbol: str, segment_type: str = "business") -> dict:
        """Get revenue by segment or geography."""
        return get_segments(symbol, segment_type)
