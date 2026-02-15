"""
Live Data Feeds for NautilusTrader Integration

Provides real-time data feeds that bridge external data sources
with NautilusTrader's data infrastructure.

Available Feeds:
- DarkPoolDataFeed: Real-time dark pool activity from FINRA/providers
- OptionsFlowFeed: Options flow data for smart money detection
"""

from stanley.integrations.nautilus.data_feeds.dark_pool_feed import (
    DarkPoolDataFeed,
    DarkPoolDataFeedConfig,
)

__all__ = [
    "DarkPoolDataFeed",
    "DarkPoolDataFeedConfig",
]
