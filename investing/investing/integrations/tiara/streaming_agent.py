"""
Streaming Agent - Tiara Integration

A specialized agent for real-time market data streaming that integrates
with Tiara's hive-mind for coordinated analysis.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from investing.integrations.tiara.orchestrator import (
    AgentType,
    InvestingOrchestrator,
    get_orchestrator,
)

logger = logging.getLogger(__name__)


@dataclass
class StreamEvent:
    """Real-time streaming event."""

    event_type: str  # bar, options_flow, dark_pool
    symbol: str
    data: Dict[str, Any]
    timestamp: datetime


class StreamingAgent:
    """
    Tiara-integrated streaming agent for real-time market data.

    Coordinates with other agents in the swarm to:
    - Detect unusual activity patterns
    - Generate consensus-based signals
    - Share discovered patterns via swarm memory
    """

    def __init__(
        self,
        symbols: List[str],
        orchestrator: Optional[InvestingOrchestrator] = None,
    ):
        """
        Initialize streaming agent.

        Args:
            symbols: Symbols to monitor
            orchestrator: Tiara orchestrator (uses global if not provided)
        """
        self._symbols = [s.upper() for s in symbols]
        self._orchestrator = orchestrator or get_orchestrator()
        self._agent_id: Optional[str] = None
        self._running = False

        # Event buffers for pattern detection
        self._bar_buffer: Dict[str, List[Dict[str, Any]]] = {
            s: [] for s in self._symbols
        }
        self._flow_buffer: Dict[str, List[Dict[str, Any]]] = {
            s: [] for s in self._symbols
        }
        self._dark_pool_buffer: Dict[str, List[Dict[str, Any]]] = {
            s: [] for s in self._symbols
        }

        # Pattern detection thresholds
        self._volume_spike_threshold = 2.0  # 2x average
        self._flow_premium_threshold = 100_000  # $100K
        self._dark_pool_size_threshold = 50_000  # 50K shares

        # Callbacks
        self._on_pattern: Optional[Callable[[str, Dict[str, Any]], None]] = None
        self._on_signal: Optional[Callable[[Dict[str, Any]], None]] = None

    async def start(self) -> None:
        """Start the streaming agent."""
        if self._running:
            return

        # Register with orchestrator
        self._agent_id = await self._orchestrator.spawn_market_agent(
            AgentType.MARKET_MONITOR,
            self._symbols,
            {
                "thresholds": {
                    "volume_spike": self._volume_spike_threshold,
                    "flow_premium": self._flow_premium_threshold,
                    "dark_pool_size": self._dark_pool_size_threshold,
                }
            },
        )

        self._running = True
        logger.info(f"Streaming agent started: {self._agent_id}")

    async def stop(self) -> None:
        """Stop the streaming agent."""
        self._running = False
        self._agent_id = None
        logger.info("Streaming agent stopped")

    async def process_bar(self, bar: Dict[str, Any]) -> None:
        """
        Process a bar update.

        Args:
            bar: Bar data (symbol, open, high, low, close, volume, etc.)
        """
        if not self._running:
            return

        symbol = bar.get("symbol", "").upper()
        if symbol not in self._symbols:
            return

        # Add to buffer
        self._bar_buffer[symbol].append(bar)

        # Keep buffer size manageable
        if len(self._bar_buffer[symbol]) > 100:
            self._bar_buffer[symbol] = self._bar_buffer[symbol][-100:]

        # Detect patterns
        await self._detect_bar_patterns(symbol, bar)

        # Broadcast to swarm
        await self._orchestrator.broadcast_market_event("bar", bar)

    async def process_options_flow(self, flow: Dict[str, Any]) -> None:
        """
        Process an options flow update.

        Args:
            flow: Options flow data
        """
        if not self._running:
            return

        symbol = flow.get("symbol", "").upper()
        if symbol not in self._symbols:
            return

        # Add to buffer
        self._flow_buffer[symbol].append(flow)

        # Keep buffer size manageable
        if len(self._flow_buffer[symbol]) > 50:
            self._flow_buffer[symbol] = self._flow_buffer[symbol][-50:]

        # Detect unusual flow
        await self._detect_flow_patterns(symbol, flow)

        # Broadcast to swarm
        await self._orchestrator.broadcast_market_event("options_flow", flow)

    async def process_dark_pool(self, print_data: Dict[str, Any]) -> None:
        """
        Process a dark pool print.

        Args:
            print_data: Dark pool print data
        """
        if not self._running:
            return

        symbol = print_data.get("symbol", "").upper()
        if symbol not in self._symbols:
            return

        # Add to buffer
        self._dark_pool_buffer[symbol].append(print_data)

        # Keep buffer size manageable
        if len(self._dark_pool_buffer[symbol]) > 50:
            self._dark_pool_buffer[symbol] = self._dark_pool_buffer[symbol][-50:]

        # Detect unusual activity
        await self._detect_dark_pool_patterns(symbol, print_data)

        # Broadcast to swarm
        await self._orchestrator.broadcast_market_event("dark_pool", print_data)

    async def _detect_bar_patterns(self, symbol: str, bar: Dict[str, Any]) -> None:
        """Detect patterns in bar data."""
        buffer = self._bar_buffer[symbol]

        if len(buffer) < 10:
            return

        # Calculate average volume
        avg_volume = (
            sum(b.get("volume", 0) for b in buffer[-20:-1]) / 19
            if len(buffer) > 20
            else 0
        )

        current_volume = bar.get("volume", 0)

        # Volume spike detection
        if (
            avg_volume > 0
            and current_volume > avg_volume * self._volume_spike_threshold
        ):
            pattern = {
                "type": "volume_spike",
                "symbol": symbol,
                "current_volume": current_volume,
                "avg_volume": avg_volume,
                "ratio": current_volume / avg_volume,
                "price": bar.get("close", 0),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            logger.info(f"Volume spike detected: {symbol} {pattern['ratio']:.1f}x")

            # Store pattern in swarm memory
            await self._orchestrator.store_pattern(
                "patterns",
                f"volume_spike:{symbol}:{datetime.now().timestamp()}",
                pattern,
                ttl=3600,  # 1 hour TTL
            )

            if self._on_pattern:
                self._on_pattern("volume_spike", pattern)

    async def _detect_flow_patterns(self, symbol: str, flow: Dict[str, Any]) -> None:
        """Detect patterns in options flow."""
        premium = flow.get("premium", 0)

        # Large premium detection
        if premium >= self._flow_premium_threshold:
            trade_type = flow.get("trade_type", "unknown")
            sentiment = flow.get("sentiment", "neutral")

            pattern = {
                "type": "unusual_options_flow",
                "symbol": symbol,
                "premium": premium,
                "strike": flow.get("strike", 0),
                "expiration": flow.get("expiration", ""),
                "option_type": flow.get("option_type", ""),
                "trade_type": trade_type,
                "sentiment": sentiment,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            logger.info(
                f"Unusual options flow: {symbol} ${premium:,.0f} {trade_type} ({sentiment})"
            )

            # Store pattern
            await self._orchestrator.store_pattern(
                "patterns",
                f"options_flow:{symbol}:{datetime.now().timestamp()}",
                pattern,
                ttl=3600,
            )

            if self._on_pattern:
                self._on_pattern("unusual_options_flow", pattern)

            # Generate signal if sweep or block with high conviction
            if (
                trade_type in ["sweep", "block"]
                and premium >= self._flow_premium_threshold * 2
            ):
                await self._generate_signal(symbol, "options_flow", pattern)

    async def _detect_dark_pool_patterns(
        self, symbol: str, print_data: Dict[str, Any]
    ) -> None:
        """Detect patterns in dark pool activity."""
        size = print_data.get("size", 0)

        # Large block detection
        if size >= self._dark_pool_size_threshold:
            notional = print_data.get("notional", 0)
            price = print_data.get("price", 0)

            pattern = {
                "type": "large_dark_pool",
                "symbol": symbol,
                "size": size,
                "price": price,
                "notional": notional,
                "venue": print_data.get("venue", "unknown"),
                "side": print_data.get("side"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            logger.info(
                f"Large dark pool print: {symbol} {size:,} shares @ ${price:.2f}"
            )

            # Store pattern
            await self._orchestrator.store_pattern(
                "patterns",
                f"dark_pool:{symbol}:{datetime.now().timestamp()}",
                pattern,
                ttl=3600,
            )

            if self._on_pattern:
                self._on_pattern("large_dark_pool", pattern)

    async def _generate_signal(
        self,
        symbol: str,
        source: str,
        data: Dict[str, Any],
    ) -> None:
        """Generate a trading signal based on detected patterns."""
        signal = {
            "symbol": symbol,
            "source": source,
            "signal_type": (
                "momentum" if data.get("sentiment") == "bullish" else "reversal"
            ),
            "conviction": 0.7 if source == "options_flow" else 0.5,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": self._agent_id,
        }

        logger.info(f"Signal generated: {symbol} {signal['signal_type']} from {source}")

        # Store signal in swarm memory
        await self._orchestrator.store_pattern(
            "signals",
            f"signal:{symbol}:{datetime.now().timestamp()}",
            signal,
            ttl=1800,  # 30 minute TTL
        )

        # Submit analysis task for consensus
        await self._orchestrator.submit_analysis_task(
            symbol,
            f"verify_signal_{source}",
            priority="high",
            require_consensus=True,
        )

        if self._on_signal:
            self._on_signal(signal)

    def on_pattern(self, callback: Callable[[str, Dict[str, Any]], None]) -> None:
        """Set callback for detected patterns."""
        self._on_pattern = callback

    def on_signal(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        """Set callback for generated signals."""
        self._on_signal = callback

    @property
    def symbols(self) -> List[str]:
        """Get monitored symbols."""
        return self._symbols

    @property
    def is_running(self) -> bool:
        """Check if agent is running."""
        return self._running
