"""
Stanley Data Feeds Module

Provides real-time market data streaming from multiple sources:
- Alpaca (WebSocket for trades and quotes)
- Polygon (WebSocket for aggregates)
- IEX Cloud (streaming quotes)

Components:
- LiveFeedProvider: Manages WebSocket connections to data providers
- BarAggregator: Aggregates tick data into OHLCV bars
"""

from stanley.data.feeds.live_feed import LiveFeedProvider, LiveFeedConfig
from stanley.data.feeds.bar_aggregator import BarAggregator, Bar, BarTimeframe

__all__ = [
    "LiveFeedProvider",
    "LiveFeedConfig",
    "BarAggregator",
    "Bar",
    "BarTimeframe",
]
