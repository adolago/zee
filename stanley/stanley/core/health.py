"""
Health Monitoring System for Stanley

Provides comprehensive health monitoring for all components:
- API endpoints
- Data providers
- External services
- Circuit breakers
- System resources

Inspired by Tiara's AgentHealth monitoring patterns.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class HealthStatus(Enum):
    """Component health status."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class ComponentType(Enum):
    """Types of monitored components."""

    API = "api"
    DATA_PROVIDER = "data_provider"
    DATABASE = "database"
    CACHE = "cache"
    EXTERNAL_SERVICE = "external_service"
    CIRCUIT_BREAKER = "circuit_breaker"
    SYSTEM = "system"


@dataclass
class HealthIssue:
    """Represents a health issue detected."""

    component: str
    issue_type: str  # performance, reliability, resource, communication
    severity: str  # low, medium, high, critical
    message: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resolved: bool = False
    recommended_action: Optional[str] = None


@dataclass
class ComponentHealth:
    """Health status for a single component."""

    name: str
    component_type: ComponentType
    status: HealthStatus
    last_check: datetime
    response_time_ms: Optional[float] = None
    error_rate: float = 0.0
    message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    issues: List[HealthIssue] = field(default_factory=list)


@dataclass
class HealthCheckConfig:
    """Configuration for health checks."""

    name: str
    component_type: ComponentType
    check_interval_seconds: float = 30.0
    timeout_seconds: float = 5.0
    healthy_threshold: int = 2  # Consecutive successes to be healthy
    unhealthy_threshold: int = 3  # Consecutive failures to be unhealthy
    check_function: Optional[Callable[[], bool]] = None
    async_check_function: Optional[Callable[[], Any]] = None


@dataclass
class SystemHealth:
    """Overall system health summary."""

    status: HealthStatus
    timestamp: datetime
    components: Dict[str, ComponentHealth]
    issues: List[HealthIssue]
    uptime_seconds: float
    degraded_components: List[str]
    unhealthy_components: List[str]


class HealthMonitor:
    """
    Centralized health monitoring for all Stanley components.

    Features:
    - Periodic health checks for all registered components
    - Automatic status transitions based on thresholds
    - Issue tracking and alerting
    - Recovery detection
    - Metrics collection
    """

    def __init__(
        self,
        check_interval: float = 30.0,
        on_status_change: Optional[
            Callable[[str, HealthStatus, HealthStatus], None]
        ] = None,
        on_issue_detected: Optional[Callable[[HealthIssue], None]] = None,
    ):
        self._check_interval = check_interval
        self._on_status_change = on_status_change
        self._on_issue_detected = on_issue_detected

        # Component tracking
        self._components: Dict[str, HealthCheckConfig] = {}
        self._health_states: Dict[str, ComponentHealth] = {}
        self._consecutive_successes: Dict[str, int] = {}
        self._consecutive_failures: Dict[str, int] = {}

        # Issues
        self._active_issues: List[HealthIssue] = []

        # System state
        self._start_time = time.time()
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def register_component(self, config: HealthCheckConfig) -> None:
        """Register a component for health monitoring."""
        self._components[config.name] = config
        self._health_states[config.name] = ComponentHealth(
            name=config.name,
            component_type=config.component_type,
            status=HealthStatus.UNKNOWN,
            last_check=datetime.now(timezone.utc),
        )
        self._consecutive_successes[config.name] = 0
        self._consecutive_failures[config.name] = 0

        logger.info(f"Registered health check for component: {config.name}")

    def unregister_component(self, name: str) -> None:
        """Unregister a component from health monitoring."""
        self._components.pop(name, None)
        self._health_states.pop(name, None)
        self._consecutive_successes.pop(name, None)
        self._consecutive_failures.pop(name, None)

    async def start(self) -> None:
        """Start the health monitoring loop."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        logger.info("Health monitor started")

    async def stop(self) -> None:
        """Stop the health monitoring loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Health monitor stopped")

    async def _monitor_loop(self) -> None:
        """Main monitoring loop."""
        while self._running:
            try:
                await self._check_all_components()
                await asyncio.sleep(self._check_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health monitor loop: {e}")
                await asyncio.sleep(5.0)

    async def _check_all_components(self) -> None:
        """Check health of all registered components."""
        for name, config in self._components.items():
            try:
                await self._check_component(name, config)
            except Exception as e:
                logger.error(f"Error checking component {name}: {e}")
                self._record_failure(name, str(e))

    async def _check_component(
        self,
        name: str,
        config: HealthCheckConfig,
    ) -> None:
        """Check health of a single component."""
        start_time = time.time()
        success = False
        error_message = None

        try:
            if config.async_check_function:
                result = await asyncio.wait_for(
                    config.async_check_function(),
                    timeout=config.timeout_seconds,
                )
                success = bool(result)
            elif config.check_function:
                result = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(
                        None, config.check_function
                    ),
                    timeout=config.timeout_seconds,
                )
                success = bool(result)
            else:
                # No check function, assume healthy
                success = True

        except asyncio.TimeoutError:
            error_message = f"Health check timed out after {config.timeout_seconds}s"
        except Exception as e:
            error_message = str(e)

        response_time = (time.time() - start_time) * 1000  # ms

        if success:
            self._record_success(name, response_time)
        else:
            self._record_failure(name, error_message)

    def _record_success(self, name: str, response_time_ms: float) -> None:
        """Record a successful health check."""
        config = self._components.get(name)
        state = self._health_states.get(name)
        if not config or not state:
            return

        self._consecutive_successes[name] += 1
        self._consecutive_failures[name] = 0

        old_status = state.status
        state.response_time_ms = response_time_ms
        state.last_check = datetime.now(timezone.utc)
        state.message = None

        # Transition to healthy if threshold met
        if self._consecutive_successes[name] >= config.healthy_threshold:
            state.status = HealthStatus.HEALTHY

            # Resolve any active issues for this component
            self._resolve_component_issues(name)

        if state.status != old_status and self._on_status_change:
            self._on_status_change(name, old_status, state.status)

    def _record_failure(self, name: str, error_message: Optional[str]) -> None:
        """Record a failed health check."""
        config = self._components.get(name)
        state = self._health_states.get(name)
        if not config or not state:
            return

        self._consecutive_failures[name] += 1
        self._consecutive_successes[name] = 0

        old_status = state.status
        state.last_check = datetime.now(timezone.utc)
        state.message = error_message

        # Calculate error rate
        total = self._consecutive_successes[name] + self._consecutive_failures[name]
        state.error_rate = self._consecutive_failures[name] / max(1, total)

        # Transition based on failure count
        if self._consecutive_failures[name] >= config.unhealthy_threshold:
            state.status = HealthStatus.UNHEALTHY

            # Create issue
            issue = HealthIssue(
                component=name,
                issue_type="reliability",
                severity="high",
                message=error_message or "Component health check failed",
                recommended_action="Check component logs and connectivity",
            )
            self._add_issue(issue)

        elif self._consecutive_failures[name] >= 1:
            state.status = HealthStatus.DEGRADED

        if state.status != old_status and self._on_status_change:
            self._on_status_change(name, old_status, state.status)

    def _add_issue(self, issue: HealthIssue) -> None:
        """Add an active issue."""
        self._active_issues.append(issue)

        if self._on_issue_detected:
            self._on_issue_detected(issue)

        logger.warning(
            f"Health issue detected: {issue.component} - "
            f"{issue.severity}: {issue.message}"
        )

    def _resolve_component_issues(self, name: str) -> None:
        """Resolve all issues for a component."""
        for issue in self._active_issues:
            if issue.component == name and not issue.resolved:
                issue.resolved = True
                logger.info(f"Health issue resolved: {name} - {issue.message}")

    def get_component_health(self, name: str) -> Optional[ComponentHealth]:
        """Get health status for a specific component."""
        return self._health_states.get(name)

    def get_system_health(self) -> SystemHealth:
        """Get overall system health summary."""
        components = self._health_states.copy()

        # Determine overall status
        statuses = [c.status for c in components.values()]

        if HealthStatus.UNHEALTHY in statuses:
            overall_status = HealthStatus.UNHEALTHY
        elif HealthStatus.DEGRADED in statuses:
            overall_status = HealthStatus.DEGRADED
        elif all(s == HealthStatus.HEALTHY for s in statuses):
            overall_status = HealthStatus.HEALTHY
        else:
            overall_status = HealthStatus.UNKNOWN

        # Collect unhealthy/degraded components
        degraded = [
            name for name, c in components.items() if c.status == HealthStatus.DEGRADED
        ]
        unhealthy = [
            name for name, c in components.items() if c.status == HealthStatus.UNHEALTHY
        ]

        # Active issues
        active_issues = [i for i in self._active_issues if not i.resolved]

        return SystemHealth(
            status=overall_status,
            timestamp=datetime.now(timezone.utc),
            components=components,
            issues=active_issues,
            uptime_seconds=time.time() - self._start_time,
            degraded_components=degraded,
            unhealthy_components=unhealthy,
        )

    def heartbeat(self, name: str) -> None:
        """
        Record a heartbeat for a component.

        Use this for components that self-report health
        rather than being actively checked.
        """
        state = self._health_states.get(name)
        if state:
            state.last_check = datetime.now(timezone.utc)
            self._record_success(name, 0.0)

    def report_issue(
        self,
        component: str,
        issue_type: str,
        severity: str,
        message: str,
        recommended_action: Optional[str] = None,
    ) -> None:
        """
        Manually report an issue.

        Use this for issues detected by components themselves.
        """
        issue = HealthIssue(
            component=component,
            issue_type=issue_type,
            severity=severity,
            message=message,
            recommended_action=recommended_action,
        )
        self._add_issue(issue)


# Global health monitor instance
_health_monitor: Optional[HealthMonitor] = None


def get_health_monitor() -> HealthMonitor:
    """Get the global health monitor instance."""
    global _health_monitor
    if _health_monitor is None:
        _health_monitor = HealthMonitor()
    return _health_monitor


def register_health_check(
    name: str,
    component_type: ComponentType,
    check_function: Optional[Callable[[], bool]] = None,
    async_check_function: Optional[Callable[[], Any]] = None,
    check_interval: float = 30.0,
) -> None:
    """Register a component for health monitoring."""
    monitor = get_health_monitor()
    config = HealthCheckConfig(
        name=name,
        component_type=component_type,
        check_function=check_function,
        async_check_function=async_check_function,
        check_interval_seconds=check_interval,
    )
    monitor.register_component(config)
