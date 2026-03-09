"""
Investing Persistence Module

Local SQLite database for storing user data:
- Watchlists
- User settings
- Alert configurations
- Cached market data
- Historical analysis
- Portfolio holdings
- Trade journal
"""

from .models import (
    Alert,
    AlertConfiguration,
    AnalysisRecord,
    CachedMarketData,
    PortfolioHolding,
    TradeEntry,
    UserSettings,
    Watchlist,
    WatchlistItem,
)

# NOTE: The following modules are planned but not yet implemented:
# - database.py: InvestingDatabase main interface
# - encryption.py: DataEncryptor for sensitive data
# - migration.py: MigrationManager for schema migrations
# - backup.py: BackupManager for data backups
# - sync.py: SyncManager for cloud synchronization

__all__ = [
    "Watchlist",
    "WatchlistItem",
    "UserSettings",
    "Alert",
    "AlertConfiguration",
    "CachedMarketData",
    "AnalysisRecord",
    "PortfolioHolding",
    "TradeEntry",
]
