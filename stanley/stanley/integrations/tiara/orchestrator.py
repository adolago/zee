"""
Stanley Orchestrator - Tiara Integration

Integrates Stanley's market data streaming and analysis with Tiara's
hive-mind orchestration for coordinated multi-agent market analysis.

Features:
- Spawn market monitor agents via Tiara
- Coordinate analysis across multiple symbols
- Consensus-based signal generation
- Memory sharing for pattern recognition
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class AgentType(Enum):
    """Stanley-specific agent types for Tiara."""

    MARKET_MONITOR = "market_monitor"
    OPTIONS_ANALYZER = "options_analyzer"
    DARK_POOL_TRACKER = "dark_pool_tracker"
    SIGNAL_GENERATOR = "signal_generator"
    RISK_ASSESSOR = "risk_assessor"
    NEWS_ANALYZER = "news_analyzer"


@dataclass
class MarketTask:
    """Task for market analysis."""

    task_id: str
    symbol: str
    task_type: str  # "monitor", "analyze", "signal"
    priority: str = "medium"  # low, medium, high, critical
    status: str = "pending"
    result: Optional[Dict[str, Any]] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class StanleyOrchestrator:
    """
    Orchestrates Stanley's market analysis using Tiara's hive-mind.

    Uses Tiara's swarm coordination for:
    - Parallel symbol monitoring
    - Coordinated options analysis
    - Consensus-based signal generation
    """

    def __init__(
        self,
        tiara_path: Optional[str] = None,
        max_agents: int = 10,
        topology: str = "mesh",
    ):
        """
        Initialize Stanley orchestrator.

        Args:
            tiara_path: Path to tiara CLI (default: npx tiara)
            max_agents: Maximum concurrent agents
            topology: Swarm topology (mesh, hierarchical, ring, star)
        """
        self._tiara_path = tiara_path or self._find_tiara()
        self._max_agents = max_agents
        self._topology = topology
        self._swarm_id: Optional[str] = None
        self._agents: Dict[str, Dict[str, Any]] = {}
        self._tasks: Dict[str, MarketTask] = {}
        self._running = False

        # Callbacks
        self._on_signal: Optional[Callable[[Dict[str, Any]], None]] = None
        self._on_alert: Optional[Callable[[Dict[str, Any]], None]] = None

    def _find_tiara(self) -> str:
        """Find tiara CLI path."""
        # Check if tiara is in PATH
        tiara_paths = [
            os.path.expanduser("~/.local/src/agent-core/vendor/tiara/bin/tiara"),
            "npx tiara",
        ]

        for path in tiara_paths:
            if os.path.exists(path.split()[0]):
                return path

        return "npx tiara"

    async def initialize_swarm(self) -> str:
        """
        Initialize a Tiara swarm for Stanley operations.

        Returns:
            Swarm ID
        """
        if self._swarm_id:
            logger.info(f"Swarm already initialized: {self._swarm_id}")
            return self._swarm_id

        try:
            # Initialize swarm via Tiara CLI
            result = await self._run_tiara_command(
                "swarm",
                "init",
                "--topology",
                self._topology,
                "--max-agents",
                str(self._max_agents),
                "--name",
                "stanley-market-swarm",
            )

            # Parse swarm ID from result
            self._swarm_id = result.get(
                "swarmId", f"stanley-{datetime.now().timestamp()}"
            )
            self._running = True

            logger.info(f"Initialized Stanley swarm: {self._swarm_id}")
            return self._swarm_id

        except Exception as e:
            logger.error(f"Failed to initialize swarm: {e}")
            # Fallback to local orchestration
            self._swarm_id = f"stanley-local-{datetime.now().timestamp()}"
            self._running = True
            return self._swarm_id

    async def spawn_market_agent(
        self,
        agent_type: AgentType,
        symbols: List[str],
        config: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Spawn a market analysis agent.

        Args:
            agent_type: Type of agent to spawn
            symbols: Symbols to monitor
            config: Agent-specific configuration

        Returns:
            Agent ID
        """
        if not self._swarm_id:
            await self.initialize_swarm()

        agent_id = f"{agent_type.value}-{len(self._agents)}"

        try:
            # Spawn via Tiara
            result = await self._run_tiara_command(
                "agent",
                "spawn",
                "--type",
                self._map_agent_type(agent_type),
                "--name",
                agent_id,
                "--swarm",
                self._swarm_id,
            )

            self._agents[agent_id] = {
                "id": agent_id,
                "type": agent_type,
                "symbols": symbols,
                "config": config or {},
                "status": "active",
                "created_at": datetime.now(timezone.utc),
            }

            logger.info(f"Spawned agent {agent_id} for symbols: {symbols}")
            return agent_id

        except Exception as e:
            logger.error(f"Failed to spawn agent: {e}")
            # Fallback to local agent
            self._agents[agent_id] = {
                "id": agent_id,
                "type": agent_type,
                "symbols": symbols,
                "config": config or {},
                "status": "local",
                "created_at": datetime.now(timezone.utc),
            }
            return agent_id

    def _map_agent_type(self, agent_type: AgentType) -> str:
        """Map Stanley agent type to Tiara agent type."""
        mapping = {
            AgentType.MARKET_MONITOR: "monitor",
            AgentType.OPTIONS_ANALYZER: "analyst",
            AgentType.DARK_POOL_TRACKER: "monitor",
            AgentType.SIGNAL_GENERATOR: "coordinator",
            AgentType.RISK_ASSESSOR: "analyst",
            AgentType.NEWS_ANALYZER: "researcher",
        }
        return mapping.get(agent_type, "specialist")

    async def submit_analysis_task(
        self,
        symbol: str,
        task_type: str,
        priority: str = "medium",
        require_consensus: bool = False,
    ) -> str:
        """
        Submit a market analysis task to the swarm.

        Args:
            symbol: Symbol to analyze
            task_type: Type of analysis (technical, fundamental, sentiment)
            priority: Task priority
            require_consensus: Whether to require consensus from multiple agents

        Returns:
            Task ID
        """
        task_id = f"task-{symbol}-{task_type}-{len(self._tasks)}"

        task = MarketTask(
            task_id=task_id,
            symbol=symbol,
            task_type=task_type,
            priority=priority,
        )
        self._tasks[task_id] = task

        try:
            # Submit via Tiara
            await self._run_tiara_command(
                "task",
                "submit",
                "--swarm",
                self._swarm_id or "local",
                "--description",
                f"Analyze {symbol}: {task_type}",
                "--priority",
                priority,
                "--require-consensus" if require_consensus else "",
            )

            logger.info(f"Submitted task {task_id}")
            return task_id

        except Exception as e:
            logger.error(f"Failed to submit task: {e}")
            return task_id

    async def broadcast_market_event(
        self,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """
        Broadcast market event to all agents in swarm.

        Args:
            event_type: Type of event (bar, options_flow, dark_pool)
            data: Event data
        """
        try:
            await self._run_tiara_command(
                "swarm",
                "broadcast",
                "--swarm",
                self._swarm_id or "local",
                "--type",
                event_type,
                "--data",
                str(data),
            )
        except Exception as e:
            logger.debug(f"Broadcast failed (may be running locally): {e}")

    async def store_pattern(
        self,
        namespace: str,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> None:
        """
        Store a pattern in swarm memory.

        Args:
            namespace: Memory namespace (e.g., "patterns", "signals")
            key: Storage key
            value: Value to store
            ttl: Time-to-live in seconds
        """
        try:
            await self._run_tiara_command(
                "memory",
                "store",
                "--swarm",
                self._swarm_id or "local",
                "--namespace",
                namespace,
                "--key",
                key,
                "--value",
                str(value),
                *(["--ttl", str(ttl)] if ttl else []),
            )
        except Exception as e:
            logger.debug(f"Memory store failed (may be running locally): {e}")

    async def get_swarm_status(self) -> Dict[str, Any]:
        """Get current swarm status."""
        return {
            "swarm_id": self._swarm_id,
            "running": self._running,
            "topology": self._topology,
            "agents": len(self._agents),
            "tasks": len(self._tasks),
            "agent_details": list(self._agents.values()),
            "pending_tasks": [t for t in self._tasks.values() if t.status == "pending"],
        }

    async def shutdown(self) -> None:
        """Shutdown the swarm."""
        self._running = False

        if self._swarm_id:
            try:
                await self._run_tiara_command(
                    "swarm",
                    "stop",
                    "--swarm",
                    self._swarm_id,
                )
            except Exception as e:
                logger.debug(f"Swarm stop failed: {e}")

        self._agents.clear()
        self._tasks.clear()
        self._swarm_id = None

        logger.info("Stanley orchestrator shutdown complete")

    async def _run_tiara_command(self, *args: str) -> Dict[str, Any]:
        """
        Run a Tiara CLI command.

        Args:
            *args: Command arguments

        Returns:
            Command result
        """
        cmd = [self._tiara_path, *[a for a in args if a]]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()

            if process.returncode != 0:
                raise RuntimeError(f"Tiara command failed: {stderr.decode()}")

            # Try to parse JSON output
            import json

            try:
                return json.loads(stdout.decode())
            except json.JSONDecodeError:
                return {"output": stdout.decode()}

        except FileNotFoundError:
            logger.warning("Tiara CLI not found, running in local mode")
            return {"local": True}

    # Callback setters

    def on_signal(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        """Set callback for trading signals."""
        self._on_signal = callback

    def on_alert(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        """Set callback for alerts."""
        self._on_alert = callback


# Global orchestrator instance
_orchestrator: Optional[StanleyOrchestrator] = None


def get_orchestrator() -> StanleyOrchestrator:
    """Get or create the global Stanley orchestrator."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = StanleyOrchestrator()
    return _orchestrator
