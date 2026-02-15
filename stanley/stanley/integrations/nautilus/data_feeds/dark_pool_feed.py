"""
Dark Pool Data Feed for NautilusTrader

Provides real-time dark pool activity data that feeds into
Stanley's SmartMoneyIndicator and trading strategies.

Data Sources:
1. Primary: FINRA ATS weekly data (official)
2. Secondary: Real-time estimates from trade reporting
3. Fallback: Simulated data based on historical patterns
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class DarkPoolPrint:
    """Represents a single dark pool print/trade."""

    symbol: str
    timestamp: datetime
    price: float
    size: int
    venue: str  # UBSS, CROS, SGMT, etc.
    is_block: bool  # True if >= 10,000 shares
    estimated_side: str  # BUY, SELL, UNKNOWN


@dataclass
class DarkPoolDataFeedConfig:
    """Configuration for DarkPoolDataFeed."""

    symbols: List[str] = field(default_factory=list)
    update_interval_seconds: float = 60.0
    block_trade_threshold: int = 10000
    use_real_data: bool = True
    fallback_to_simulation: bool = True

    # Data source priorities
    primary_source: str = "finra"
    secondary_source: str = "tape"

    # Callbacks
    on_dark_pool_print: Optional[Callable[[DarkPoolPrint], None]] = None
    on_activity_update: Optional[Callable[[str, Dict[str, Any]], None]] = None


class DarkPoolDataFeed:
    """
    Real-time dark pool data feed.

    Aggregates dark pool activity from multiple sources and
    provides updates to indicators and strategies.

    Features:
    - Real-time dark pool prints when available
    - Periodic aggregated activity updates
    - Block trade detection
    - Venue-level breakdown
    - Fallback to simulation when real data unavailable
    """

    # Major dark pool venues
    VENUES = {
        "UBSS": "UBS ATS",
        "CROS": "Credit Suisse Crossfinder",
        "SGMT": "Goldman Sachs Sigma X",
        "JPMX": "JPMorgan JPM-X",
        "MSPL": "Morgan Stanley MS Pool",
        "DBAX": "Deutsche Bank SuperX",
        "BIDS": "BIDS Trading",
        "LQFI": "Liquidnet",
        "IEGX": "IEX",
        "MEMX": "MEMX",
    }

    def __init__(self, config: DarkPoolDataFeedConfig):
        self.config = config

        # State
        self._running = False
        self._task: Optional[asyncio.Task] = None

        # Caches
        self._activity_cache: Dict[str, Dict[str, Any]] = {}
        self._prints_cache: Dict[str, List[DarkPoolPrint]] = {}

        # Data source adapters (injected)
        self._finra_adapter = None
        self._tape_adapter = None

    async def start(self) -> None:
        """Start the data feed."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"DarkPoolDataFeed started for {len(self.config.symbols)} symbols")

    async def stop(self) -> None:
        """Stop the data feed."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("DarkPoolDataFeed stopped")

    def set_finra_adapter(self, adapter: Any) -> None:
        """Set the FINRA data adapter."""
        self._finra_adapter = adapter

    def set_tape_adapter(self, adapter: Any) -> None:
        """Set the tape data adapter."""
        self._tape_adapter = adapter

    async def _run_loop(self) -> None:
        """Main data feed loop."""
        while self._running:
            try:
                for symbol in self.config.symbols:
                    await self._update_symbol(symbol)

                await asyncio.sleep(self.config.update_interval_seconds)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in data feed loop: {e}")
                await asyncio.sleep(5.0)

    async def _update_symbol(self, symbol: str) -> None:
        """Update dark pool data for a symbol."""
        activity = None

        # Try primary source
        if self.config.use_real_data and self._finra_adapter:
            try:
                activity = await self._fetch_finra_data(symbol)
            except Exception as e:
                logger.debug(f"FINRA fetch failed for {symbol}: {e}")

        # Try secondary source
        if activity is None and self._tape_adapter:
            try:
                activity = await self._fetch_tape_data(symbol)
            except Exception as e:
                logger.debug(f"Tape fetch failed for {symbol}: {e}")

        # Fallback to simulation
        if activity is None and self.config.fallback_to_simulation:
            activity = self._generate_simulated_activity(symbol)

        if activity:
            self._activity_cache[symbol] = activity

            # Trigger callback
            if self.config.on_activity_update:
                self.config.on_activity_update(symbol, activity)

    async def _fetch_finra_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch data from FINRA ATS reports."""
        if not self._finra_adapter:
            return None

        # FINRA provides weekly aggregated data
        data = await self._finra_adapter.get_ats_data(symbol)
        if not data:
            return None

        return {
            "symbol": symbol,
            "timestamp": datetime.now(timezone.utc),
            "source": "finra",
            "dark_pool_volume": data.get("total_volume", 0),
            "dark_pool_pct": data.get("dark_pool_pct", 0.0),
            "venue_breakdown": data.get("venues", {}),
            "block_trades": data.get("block_trades", 0),
            "avg_trade_size": data.get("avg_trade_size", 0),
        }

    async def _fetch_tape_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch real-time estimates from trade reporting facility."""
        if not self._tape_adapter:
            return None

        # TRF data provides more real-time estimates
        data = await self._tape_adapter.get_off_exchange_data(symbol)
        if not data:
            return None

        return {
            "symbol": symbol,
            "timestamp": datetime.now(timezone.utc),
            "source": "tape",
            "dark_pool_volume": data.get("off_exchange_volume", 0),
            "dark_pool_pct": data.get("off_exchange_pct", 0.0),
            "venue_breakdown": {},  # TRF doesn't provide venue breakdown
            "block_trades": data.get("block_count", 0),
            "avg_trade_size": data.get("avg_size", 0),
        }

    def _generate_simulated_activity(self, symbol: str) -> Dict[str, Any]:
        """Generate simulated dark pool activity based on historical patterns."""
        import random

        # Realistic distributions based on market data
        dark_pool_pct = random.gauss(0.38, 0.08)  # ~38% average with variation
        dark_pool_pct = max(0.15, min(0.55, dark_pool_pct))

        # Generate venue breakdown
        venues = list(self.VENUES.keys())
        venue_breakdown = {}
        remaining = 1.0

        for i, venue in enumerate(venues[:-1]):
            if remaining <= 0:
                break
            pct = random.uniform(0.05, 0.25) * remaining
            venue_breakdown[venue] = pct
            remaining -= pct

        if remaining > 0:
            venue_breakdown[venues[-1]] = remaining

        # Normalize to 100%
        total = sum(venue_breakdown.values())
        venue_breakdown = {k: v / total for k, v in venue_breakdown.items()}

        # Block trades (realistic range)
        block_trades = random.randint(2, 15)
        avg_trade_size = random.randint(500, 5000)

        return {
            "symbol": symbol,
            "timestamp": datetime.now(timezone.utc),
            "source": "simulation",
            "dark_pool_volume": 0,  # Unknown in simulation
            "dark_pool_pct": dark_pool_pct,
            "venue_breakdown": venue_breakdown,
            "block_trades": block_trades,
            "avg_trade_size": avg_trade_size,
        }

    def get_activity(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get cached activity for a symbol."""
        return self._activity_cache.get(symbol)

    def get_all_activity(self) -> Dict[str, Dict[str, Any]]:
        """Get all cached activity."""
        return self._activity_cache.copy()

    def process_dark_pool_print(self, print_data: Dict[str, Any]) -> None:
        """
        Process an incoming dark pool print.

        Args:
            print_data: Raw print data from data source
        """
        try:
            dp_print = DarkPoolPrint(
                symbol=print_data["symbol"],
                timestamp=print_data.get("timestamp", datetime.now(timezone.utc)),
                price=float(print_data["price"]),
                size=int(print_data["size"]),
                venue=print_data.get("venue", "UNKNOWN"),
                is_block=int(print_data["size"]) >= self.config.block_trade_threshold,
                estimated_side=print_data.get("side", "UNKNOWN"),
            )

            # Cache print
            symbol = dp_print.symbol
            if symbol not in self._prints_cache:
                self._prints_cache[symbol] = []

            self._prints_cache[symbol].append(dp_print)

            # Keep last 1000 prints per symbol
            if len(self._prints_cache[symbol]) > 1000:
                self._prints_cache[symbol] = self._prints_cache[symbol][-1000:]

            # Trigger callback
            if self.config.on_dark_pool_print:
                self.config.on_dark_pool_print(dp_print)

        except Exception as e:
            logger.error(f"Error processing dark pool print: {e}")

    def get_recent_prints(
        self,
        symbol: str,
        limit: int = 100,
    ) -> List[DarkPoolPrint]:
        """Get recent prints for a symbol."""
        prints = self._prints_cache.get(symbol, [])
        return prints[-limit:]

    def get_block_trades(
        self,
        symbol: str,
        limit: int = 50,
    ) -> List[DarkPoolPrint]:
        """Get recent block trades for a symbol."""
        prints = self._prints_cache.get(symbol, [])
        blocks = [p for p in prints if p.is_block]
        return blocks[-limit:]
