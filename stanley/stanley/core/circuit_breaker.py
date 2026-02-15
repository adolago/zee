"""
Circuit Breaker Pattern for Production Error Recovery

Implements the circuit breaker pattern to prevent cascading failures
when external services become unavailable or unreliable.

States:
- CLOSED: Normal operation, requests pass through
- OPEN: Service is failing, requests fail fast without trying
- HALF_OPEN: Testing if service has recovered

Based on Tiara's circuit breaker implementation, ported to Python
for use in Stanley's data providers and API endpoints.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Optional, TypeVar, Union

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing fast
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker."""

    name: str = "default"
    failure_threshold: int = 5  # Failures before opening
    success_threshold: int = 2  # Successes to close from half-open
    timeout: float = 30.0  # Seconds before trying half-open
    half_open_max_calls: int = 3  # Max calls in half-open state

    # Optional callbacks
    on_state_change: Optional[Callable[[str, CircuitState, CircuitState], None]] = None
    on_failure: Optional[Callable[[str, Exception], None]] = None
    on_success: Optional[Callable[[str], None]] = None


@dataclass
class CircuitBreakerStats:
    """Statistics for circuit breaker monitoring."""

    name: str
    state: CircuitState
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    total_failures: int = 0
    total_successes: int = 0
    total_rejected: int = 0
    state_changes: int = 0


class CircuitBreakerOpen(Exception):
    """Raised when circuit breaker is open."""

    def __init__(self, name: str, retry_after: float):
        self.name = name
        self.retry_after = retry_after
        super().__init__(
            f"Circuit breaker '{name}' is open. Retry after {retry_after:.1f}s"
        )


class CircuitBreaker:
    """
    Circuit breaker implementation for fault tolerance.

    Usage:
        cb = CircuitBreaker(CircuitBreakerConfig(name="api"))

        # Sync usage
        result = cb.execute(lambda: api_call())

        # Async usage
        result = await cb.execute_async(async_api_call())

        # Decorator usage
        @cb.protect
        def my_function():
            ...
    """

    def __init__(self, config: CircuitBreakerConfig):
        self.config = config

        # State
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: Optional[float] = None
        self._half_open_calls = 0

        # Stats
        self._total_failures = 0
        self._total_successes = 0
        self._total_rejected = 0
        self._state_changes = 0

        # Lock for thread safety
        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        """Get current circuit state."""
        return self._state

    @property
    def is_closed(self) -> bool:
        """Check if circuit is closed (normal operation)."""
        return self._state == CircuitState.CLOSED

    @property
    def is_open(self) -> bool:
        """Check if circuit is open (failing fast)."""
        return self._state == CircuitState.OPEN

    @property
    def is_half_open(self) -> bool:
        """Check if circuit is half-open (testing recovery)."""
        return self._state == CircuitState.HALF_OPEN

    def get_stats(self) -> CircuitBreakerStats:
        """Get current statistics."""
        return CircuitBreakerStats(
            name=self.config.name,
            state=self._state,
            failure_count=self._failure_count,
            success_count=self._success_count,
            last_failure_time=self._last_failure_time,
            last_success_time=time.time() if self._total_successes > 0 else None,
            total_failures=self._total_failures,
            total_successes=self._total_successes,
            total_rejected=self._total_rejected,
            state_changes=self._state_changes,
        )

    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state."""
        if new_state == self._state:
            return

        old_state = self._state
        self._state = new_state
        self._state_changes += 1

        logger.info(
            f"Circuit breaker '{self.config.name}': "
            f"{old_state.value} -> {new_state.value}"
        )

        if self.config.on_state_change:
            try:
                self.config.on_state_change(self.config.name, old_state, new_state)
            except Exception as e:
                logger.error(f"Error in state change callback: {e}")

    def _should_allow_request(self) -> bool:
        """Check if a request should be allowed."""
        if self._state == CircuitState.CLOSED:
            return True

        if self._state == CircuitState.OPEN:
            # Check if timeout has elapsed
            if self._last_failure_time:
                elapsed = time.time() - self._last_failure_time
                if elapsed >= self.config.timeout:
                    self._transition_to(CircuitState.HALF_OPEN)
                    self._half_open_calls = 0
                    return True
            return False

        if self._state == CircuitState.HALF_OPEN:
            # Allow limited calls in half-open state
            if self._half_open_calls < self.config.half_open_max_calls:
                self._half_open_calls += 1
                return True
            return False

        return False

    def _on_success(self) -> None:
        """Handle successful call."""
        self._total_successes += 1

        if self._state == CircuitState.HALF_OPEN:
            self._success_count += 1
            if self._success_count >= self.config.success_threshold:
                self._transition_to(CircuitState.CLOSED)
                self._failure_count = 0
                self._success_count = 0

        elif self._state == CircuitState.CLOSED:
            # Reset failure count on success
            self._failure_count = 0

        if self.config.on_success:
            try:
                self.config.on_success(self.config.name)
            except Exception as e:
                logger.error(f"Error in success callback: {e}")

    def _on_failure(self, error: Exception) -> None:
        """Handle failed call."""
        self._total_failures += 1
        self._failure_count += 1
        self._last_failure_time = time.time()

        if self._state == CircuitState.HALF_OPEN:
            # Any failure in half-open returns to open
            self._transition_to(CircuitState.OPEN)
            self._success_count = 0

        elif self._state == CircuitState.CLOSED:
            if self._failure_count >= self.config.failure_threshold:
                self._transition_to(CircuitState.OPEN)

        if self.config.on_failure:
            try:
                self.config.on_failure(self.config.name, error)
            except Exception as e:
                logger.error(f"Error in failure callback: {e}")

    def execute(self, func: Callable[[], T]) -> T:
        """
        Execute a function through the circuit breaker (sync).

        Args:
            func: Function to execute

        Returns:
            Result of the function

        Raises:
            CircuitBreakerOpen: If circuit is open
        """
        if not self._should_allow_request():
            self._total_rejected += 1
            retry_after = (
                self.config.timeout - (time.time() - (self._last_failure_time or 0))
                if self._last_failure_time
                else self.config.timeout
            )
            raise CircuitBreakerOpen(self.config.name, max(0, retry_after))

        try:
            result = func()
            self._on_success()
            return result
        except Exception as e:
            self._on_failure(e)
            raise

    async def execute_async(self, coro: Any) -> T:
        """
        Execute an async coroutine through the circuit breaker.

        Args:
            coro: Coroutine to execute

        Returns:
            Result of the coroutine

        Raises:
            CircuitBreakerOpen: If circuit is open
        """
        async with self._lock:
            if not self._should_allow_request():
                self._total_rejected += 1
                retry_after = (
                    self.config.timeout - (time.time() - (self._last_failure_time or 0))
                    if self._last_failure_time
                    else self.config.timeout
                )
                raise CircuitBreakerOpen(self.config.name, max(0, retry_after))

        try:
            result = await coro
            async with self._lock:
                self._on_success()
            return result
        except Exception as e:
            async with self._lock:
                self._on_failure(e)
            raise

    def protect(self, func: Callable[..., T]) -> Callable[..., T]:
        """
        Decorator to protect a function with circuit breaker.

        Usage:
            @circuit_breaker.protect
            def my_function():
                ...
        """

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            return self.execute(lambda: func(*args, **kwargs))

        return wrapper

    def protect_async(self, func: Callable[..., Any]) -> Callable[..., Any]:
        """
        Decorator to protect an async function with circuit breaker.

        Usage:
            @circuit_breaker.protect_async
            async def my_function():
                ...
        """

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            return await self.execute_async(func(*args, **kwargs))

        return wrapper

    def reset(self) -> None:
        """Reset the circuit breaker to closed state."""
        self._transition_to(CircuitState.CLOSED)
        self._failure_count = 0
        self._success_count = 0
        self._half_open_calls = 0
        logger.info(f"Circuit breaker '{self.config.name}' reset to closed")


class CircuitBreakerRegistry:
    """
    Registry for managing multiple circuit breakers.

    Usage:
        registry = CircuitBreakerRegistry()
        cb = registry.get_or_create("api", CircuitBreakerConfig(name="api"))
    """

    def __init__(self):
        self._breakers: Dict[str, CircuitBreaker] = {}
        self._lock = asyncio.Lock()

    def get(self, name: str) -> Optional[CircuitBreaker]:
        """Get a circuit breaker by name."""
        return self._breakers.get(name)

    def get_or_create(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None,
    ) -> CircuitBreaker:
        """Get or create a circuit breaker."""
        if name not in self._breakers:
            if config is None:
                config = CircuitBreakerConfig(name=name)
            self._breakers[name] = CircuitBreaker(config)
        return self._breakers[name]

    def get_all_stats(self) -> Dict[str, CircuitBreakerStats]:
        """Get stats for all circuit breakers."""
        return {name: cb.get_stats() for name, cb in self._breakers.items()}

    def reset_all(self) -> None:
        """Reset all circuit breakers."""
        for cb in self._breakers.values():
            cb.reset()


# Global registry instance
_registry = CircuitBreakerRegistry()


def get_circuit_breaker(
    name: str,
    config: Optional[CircuitBreakerConfig] = None,
) -> CircuitBreaker:
    """Get or create a circuit breaker from the global registry."""
    return _registry.get_or_create(name, config)


def get_all_circuit_breaker_stats() -> Dict[str, CircuitBreakerStats]:
    """Get stats for all circuit breakers in the global registry."""
    return _registry.get_all_stats()
