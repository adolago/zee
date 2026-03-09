"""
Investing Error Handling Module

Comprehensive error handling with structured error codes, user-friendly messages,
retry logic, circuit breakers, and graceful degradation.
"""

import asyncio
import functools
import logging
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum, auto
from typing import Any, Callable, Dict, List, Optional, Type, TypeVar, Union

logger = logging.getLogger(__name__)

# =============================================================================
# Error Code Taxonomy
# =============================================================================


class ErrorCategory(Enum):
    """Top-level error categories."""

    NETWORK = "NETWORK"
    DATA = "DATA"
    AUTH = "AUTH"
    VALIDATION = "VALIDATION"
    SERVICE = "SERVICE"
    SYSTEM = "SYSTEM"
    EXTERNAL = "EXTERNAL"
    USER = "USER"


class ErrorSeverity(Enum):
    """Error severity levels for monitoring and alerting."""

    DEBUG = auto()
    INFO = auto()
    WARNING = auto()
    ERROR = auto()
    CRITICAL = auto()


@dataclass
class ErrorCode:
    """Structured error code with metadata."""

    code: str
    category: ErrorCategory
    severity: ErrorSeverity
    message: str
    user_message: str
    http_status: int
    retryable: bool = False
    recovery_hint: str = ""

    def __str__(self) -> str:
        return f"{self.category.value}_{self.code}"


# Error Code Registry - All Investing error codes
class ErrorCodes:
    """Central registry of all Investing error codes."""

    # Network Errors (1xxx)
    NETWORK_TIMEOUT = ErrorCode(
        code="1001",
        category=ErrorCategory.NETWORK,
        severity=ErrorSeverity.WARNING,
        message="Network request timed out",
        user_message="The request took too long. Please try again.",
        http_status=504,
        retryable=True,
        recovery_hint="Check your internet connection or try again later.",
    )

    NETWORK_UNREACHABLE = ErrorCode(
        code="1002",
        category=ErrorCategory.NETWORK,
        severity=ErrorSeverity.ERROR,
        message="Network unreachable",
        user_message="Unable to connect to the service.",
        http_status=503,
        retryable=True,
        recovery_hint="Verify network connectivity and firewall settings.",
    )

    NETWORK_CONNECTION_REFUSED = ErrorCode(
        code="1003",
        category=ErrorCategory.NETWORK,
        severity=ErrorSeverity.ERROR,
        message="Connection refused by remote host",
        user_message="The service is not accepting connections.",
        http_status=503,
        retryable=True,
        recovery_hint="The API server may be down. Try again in a few minutes.",
    )

    NETWORK_SSL_ERROR = ErrorCode(
        code="1004",
        category=ErrorCategory.NETWORK,
        severity=ErrorSeverity.CRITICAL,
        message="SSL/TLS certificate verification failed",
        user_message="Secure connection could not be established.",
        http_status=502,
        retryable=False,
        recovery_hint="Check system date/time or contact support.",
    )

    # Data Errors (2xxx)
    DATA_NOT_FOUND = ErrorCode(
        code="2001",
        category=ErrorCategory.DATA,
        severity=ErrorSeverity.INFO,
        message="Requested data not found",
        user_message="The requested data is not available.",
        http_status=404,
        retryable=False,
        recovery_hint="Verify the symbol or identifier is correct.",
    )

    DATA_PARSE_ERROR = ErrorCode(
        code="2002",
        category=ErrorCategory.DATA,
        severity=ErrorSeverity.ERROR,
        message="Failed to parse data response",
        user_message="Unable to process the received data.",
        http_status=500,
        retryable=True,
        recovery_hint="The data format may have changed. Try again or contact support.",
    )

    DATA_INVALID_FORMAT = ErrorCode(
        code="2003",
        category=ErrorCategory.DATA,
        severity=ErrorSeverity.WARNING,
        message="Data format is invalid or unexpected",
        user_message="The data format is not as expected.",
        http_status=422,
        retryable=False,
        recovery_hint="Check if the data source API has changed.",
    )

    DATA_STALE = ErrorCode(
        code="2004",
        category=ErrorCategory.DATA,
        severity=ErrorSeverity.INFO,
        message="Data is stale or outdated",
        user_message="The data may not be current.",
        http_status=200,
        retryable=True,
        recovery_hint="Refresh to get the latest data.",
    )

    DATA_INCOMPLETE = ErrorCode(
        code="2005",
        category=ErrorCategory.DATA,
        severity=ErrorSeverity.WARNING,
        message="Data is incomplete",
        user_message="Some data fields are missing.",
        http_status=206,
        retryable=True,
        recovery_hint="Some data may not be available for this symbol.",
    )

    # Authentication Errors (3xxx)
    AUTH_INVALID_CREDENTIALS = ErrorCode(
        code="3001",
        category=ErrorCategory.AUTH,
        severity=ErrorSeverity.ERROR,
        message="Invalid API credentials",
        user_message="Authentication failed.",
        http_status=401,
        retryable=False,
        recovery_hint="Check your API key configuration.",
    )

    AUTH_EXPIRED_TOKEN = ErrorCode(
        code="3002",
        category=ErrorCategory.AUTH,
        severity=ErrorSeverity.WARNING,
        message="Authentication token expired",
        user_message="Your session has expired.",
        http_status=401,
        retryable=True,
        recovery_hint="Please log in again.",
    )

    AUTH_INSUFFICIENT_PERMISSIONS = ErrorCode(
        code="3003",
        category=ErrorCategory.AUTH,
        severity=ErrorSeverity.WARNING,
        message="Insufficient permissions for this operation",
        user_message="You don't have permission for this action.",
        http_status=403,
        retryable=False,
        recovery_hint="Contact your administrator for access.",
    )

    AUTH_RATE_LIMITED = ErrorCode(
        code="3004",
        category=ErrorCategory.AUTH,
        severity=ErrorSeverity.WARNING,
        message="API rate limit exceeded",
        user_message="Too many requests. Please wait before trying again.",
        http_status=429,
        retryable=True,
        recovery_hint="Wait a few minutes before making more requests.",
    )

    # Validation Errors (4xxx)
    VALIDATION_INVALID_SYMBOL = ErrorCode(
        code="4001",
        category=ErrorCategory.VALIDATION,
        severity=ErrorSeverity.INFO,
        message="Invalid stock symbol format",
        user_message="The symbol format is not valid.",
        http_status=400,
        retryable=False,
        recovery_hint="Enter a valid stock ticker symbol (e.g., AAPL, MSFT).",
    )

    VALIDATION_INVALID_DATE_RANGE = ErrorCode(
        code="4002",
        category=ErrorCategory.VALIDATION,
        severity=ErrorSeverity.INFO,
        message="Invalid date range",
        user_message="The date range is not valid.",
        http_status=400,
        retryable=False,
        recovery_hint="Ensure start date is before end date.",
    )

    VALIDATION_REQUIRED_FIELD = ErrorCode(
        code="4003",
        category=ErrorCategory.VALIDATION,
        severity=ErrorSeverity.INFO,
        message="Required field is missing",
        user_message="A required field is missing.",
        http_status=400,
        retryable=False,
        recovery_hint="Provide all required fields.",
    )

    VALIDATION_INVALID_VALUE = ErrorCode(
        code="4004",
        category=ErrorCategory.VALIDATION,
        severity=ErrorSeverity.INFO,
        message="Field value is invalid",
        user_message="One of the values is not valid.",
        http_status=400,
        retryable=False,
        recovery_hint="Check the allowed values for this field.",
    )

    # Service Errors (5xxx)
    SERVICE_UNAVAILABLE = ErrorCode(
        code="5001",
        category=ErrorCategory.SERVICE,
        severity=ErrorSeverity.ERROR,
        message="Service is currently unavailable",
        user_message="This feature is temporarily unavailable.",
        http_status=503,
        retryable=True,
        recovery_hint="The service is being updated. Try again shortly.",
    )

    SERVICE_NOT_INITIALIZED = ErrorCode(
        code="5002",
        category=ErrorCategory.SERVICE,
        severity=ErrorSeverity.ERROR,
        message="Service not properly initialized",
        user_message="The service is not ready.",
        http_status=503,
        retryable=True,
        recovery_hint="Wait for the system to initialize fully.",
    )

    SERVICE_CIRCUIT_OPEN = ErrorCode(
        code="5003",
        category=ErrorCategory.SERVICE,
        severity=ErrorSeverity.WARNING,
        message="Circuit breaker is open - service calls blocked",
        user_message="This service is temporarily disabled due to errors.",
        http_status=503,
        retryable=True,
        recovery_hint="The system is recovering. Try again in a minute.",
    )

    SERVICE_DEGRADED = ErrorCode(
        code="5004",
        category=ErrorCategory.SERVICE,
        severity=ErrorSeverity.INFO,
        message="Service is running in degraded mode",
        user_message="Some features may be limited.",
        http_status=200,
        retryable=False,
        recovery_hint="Full functionality will be restored shortly.",
    )

    # External API Errors (6xxx)
    EXTERNAL_SEC_API_ERROR = ErrorCode(
        code="6001",
        category=ErrorCategory.EXTERNAL,
        severity=ErrorSeverity.ERROR,
        message="SEC EDGAR API error",
        user_message="Unable to retrieve SEC filing data.",
        http_status=502,
        retryable=True,
        recovery_hint="The SEC API may be experiencing issues.",
    )

    EXTERNAL_OPENBB_ERROR = ErrorCode(
        code="6002",
        category=ErrorCategory.EXTERNAL,
        severity=ErrorSeverity.ERROR,
        message="OpenBB data provider error",
        user_message="Unable to retrieve market data.",
        http_status=502,
        retryable=True,
        recovery_hint="Check OpenBB provider status.",
    )

    EXTERNAL_DBNOMICS_ERROR = ErrorCode(
        code="6003",
        category=ErrorCategory.EXTERNAL,
        severity=ErrorSeverity.ERROR,
        message="DBnomics API error",
        user_message="Unable to retrieve economic data.",
        http_status=502,
        retryable=True,
        recovery_hint="The DBnomics API may be temporarily unavailable.",
    )

    EXTERNAL_DEPENDENCY_MISSING = ErrorCode(
        code="6004",
        category=ErrorCategory.EXTERNAL,
        severity=ErrorSeverity.ERROR,
        message="External dependency not installed",
        user_message="A required component is not installed.",
        http_status=501,
        retryable=False,
        recovery_hint="Install the required dependency using pip.",
    )

    # System Errors (7xxx)
    SYSTEM_INTERNAL_ERROR = ErrorCode(
        code="7001",
        category=ErrorCategory.SYSTEM,
        severity=ErrorSeverity.CRITICAL,
        message="Internal system error",
        user_message="An unexpected error occurred.",
        http_status=500,
        retryable=False,
        recovery_hint="Please try again. If the problem persists, contact support.",
    )

    SYSTEM_OUT_OF_MEMORY = ErrorCode(
        code="7002",
        category=ErrorCategory.SYSTEM,
        severity=ErrorSeverity.CRITICAL,
        message="System out of memory",
        user_message="The system is overloaded.",
        http_status=503,
        retryable=True,
        recovery_hint="Try a smaller data request or wait for resources.",
    )

    SYSTEM_RESOURCE_EXHAUSTED = ErrorCode(
        code="7003",
        category=ErrorCategory.SYSTEM,
        severity=ErrorSeverity.ERROR,
        message="System resources exhausted",
        user_message="System resources are temporarily unavailable.",
        http_status=503,
        retryable=True,
        recovery_hint="Wait a moment and try again.",
    )

    SYSTEM_CONFIG_ERROR = ErrorCode(
        code="7004",
        category=ErrorCategory.SYSTEM,
        severity=ErrorSeverity.CRITICAL,
        message="System configuration error",
        user_message="System is misconfigured.",
        http_status=500,
        retryable=False,
        recovery_hint="Contact system administrator.",
    )


# =============================================================================
# Base Exception Classes
# =============================================================================


class InvestingError(Exception):
    """
    Base exception for all Investing errors.

    Provides structured error information including error codes,
    user-friendly messages, and recovery suggestions.
    """

    def __init__(
        self,
        error_code: ErrorCode,
        detail: Optional[str] = None,
        original_error: Optional[Exception] = None,
        context: Optional[Dict[str, Any]] = None,
        debug_info: Optional[Dict[str, Any]] = None,
    ):
        self.error_code = error_code
        self.detail = detail
        self.original_error = original_error
        self.context = context or {}
        self.debug_info = debug_info or {}
        self.timestamp = datetime.utcnow()

        # Capture stack trace for debugging
        if original_error:
            self.debug_info["original_traceback"] = traceback.format_exception(
                type(original_error), original_error, original_error.__traceback__
            )

        super().__init__(self.technical_message)

    @property
    def code(self) -> str:
        """Full error code string."""
        return str(self.error_code)

    @property
    def category(self) -> ErrorCategory:
        """Error category."""
        return self.error_code.category

    @property
    def severity(self) -> ErrorSeverity:
        """Error severity."""
        return self.error_code.severity

    @property
    def http_status(self) -> int:
        """HTTP status code to return."""
        return self.error_code.http_status

    @property
    def is_retryable(self) -> bool:
        """Whether the operation can be retried."""
        return self.error_code.retryable

    @property
    def user_message(self) -> str:
        """User-friendly error message."""
        msg = self.error_code.user_message
        if self.detail:
            msg = f"{msg} ({self.detail})"
        return msg

    @property
    def technical_message(self) -> str:
        """Technical error message for logging."""
        msg = f"[{self.code}] {self.error_code.message}"
        if self.detail:
            msg = f"{msg}: {self.detail}"
        return msg

    @property
    def recovery_hint(self) -> str:
        """Suggestion for recovering from the error."""
        return self.error_code.recovery_hint

    def to_dict(self, include_debug: bool = False) -> Dict[str, Any]:
        """
        Convert error to dictionary for API responses.

        Args:
            include_debug: Include debug information (for dev mode only)
        """
        result = {
            "code": self.code,
            "category": self.category.value,
            "message": self.user_message,
            "recovery_hint": self.recovery_hint,
            "retryable": self.is_retryable,
            "timestamp": self.timestamp.isoformat(),
        }

        if include_debug:
            result["debug"] = {
                "technical_message": self.technical_message,
                "context": self.context,
                "debug_info": self.debug_info,
            }

        return result

    def log(self) -> None:
        """Log the error with appropriate severity."""
        log_method = getattr(logger, self.severity.name.lower(), logger.error)
        log_method(
            f"{self.technical_message}",
            extra={
                "error_code": self.code,
                "context": self.context,
                "retryable": self.is_retryable,
            },
        )


# Specific Exception Classes
class NetworkError(InvestingError):
    """Network-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.NETWORK_TIMEOUT,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


class DataError(InvestingError):
    """Data-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.DATA_NOT_FOUND,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


class AuthenticationError(InvestingError):
    """Authentication-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.AUTH_INVALID_CREDENTIALS,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


class ValidationError(InvestingError):
    """Validation-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.VALIDATION_INVALID_VALUE,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


class ServiceError(InvestingError):
    """Service-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.SERVICE_UNAVAILABLE,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


class ExternalAPIError(InvestingError):
    """External API-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.EXTERNAL_OPENBB_ERROR,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


class SystemError(InvestingError):
    """System-related errors."""

    def __init__(
        self,
        error_code: ErrorCode = ErrorCodes.SYSTEM_INTERNAL_ERROR,
        **kwargs,
    ):
        super().__init__(error_code, **kwargs)


# =============================================================================
# Retry Logic with Exponential Backoff
# =============================================================================


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_attempts: int = 3
    base_delay: float = 1.0
    max_delay: float = 60.0
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_exceptions: tuple = (NetworkError, ServiceError)
    retryable_error_codes: tuple = ()


class RetryExhaustedError(InvestingError):
    """Raised when all retry attempts are exhausted."""

    def __init__(self, attempts: int, last_error: Exception, **kwargs):
        super().__init__(
            ErrorCodes.SERVICE_UNAVAILABLE,
            detail=f"All {attempts} retry attempts failed",
            original_error=last_error,
            **kwargs,
        )
        self.attempts = attempts
        self.last_error = last_error


def calculate_backoff(
    attempt: int,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
) -> float:
    """
    Calculate backoff delay with exponential increase and optional jitter.

    Args:
        attempt: Current attempt number (0-indexed)
        base_delay: Base delay in seconds
        max_delay: Maximum delay in seconds
        exponential_base: Base for exponential calculation
        jitter: Add random jitter to prevent thundering herd
    """
    import random

    delay = min(base_delay * (exponential_base**attempt), max_delay)

    if jitter:
        delay = delay * (0.5 + random.random())

    return delay


T = TypeVar("T")


async def retry_async(
    func: Callable[..., T],
    *args,
    config: Optional[RetryConfig] = None,
    **kwargs,
) -> T:
    """
    Retry an async function with exponential backoff.

    Args:
        func: Async function to retry
        *args: Arguments to pass to func
        config: Retry configuration
        **kwargs: Keyword arguments to pass to func

    Returns:
        Result of successful function call

    Raises:
        RetryExhaustedError: If all retry attempts fail
    """
    config = config or RetryConfig()
    last_error: Optional[Exception] = None

    for attempt in range(config.max_attempts):
        try:
            return await func(*args, **kwargs)

        except config.retryable_exceptions as e:
            last_error = e
            if attempt < config.max_attempts - 1:
                delay = calculate_backoff(
                    attempt,
                    config.base_delay,
                    config.max_delay,
                    config.exponential_base,
                    config.jitter,
                )
                logger.warning(
                    f"Retry attempt {attempt + 1}/{config.max_attempts} "
                    f"after {delay:.2f}s: {e}"
                )
                await asyncio.sleep(delay)

        except InvestingError as e:
            if e.is_retryable and attempt < config.max_attempts - 1:
                last_error = e
                delay = calculate_backoff(
                    attempt,
                    config.base_delay,
                    config.max_delay,
                    config.exponential_base,
                    config.jitter,
                )
                logger.warning(
                    f"Retry attempt {attempt + 1}/{config.max_attempts} "
                    f"after {delay:.2f}s: {e}"
                )
                await asyncio.sleep(delay)
            else:
                raise

        except Exception as e:
            raise InvestingError(
                ErrorCodes.SYSTEM_INTERNAL_ERROR,
                detail=str(e),
                original_error=e,
            )

    raise RetryExhaustedError(config.max_attempts, last_error)


def retry(config: Optional[RetryConfig] = None):
    """
    Decorator for adding retry logic to async functions.

    Args:
        config: Retry configuration
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            return await retry_async(func, *args, config=config, **kwargs)

        return wrapper

    return decorator


# =============================================================================
# Circuit Breaker Pattern
# =============================================================================


class CircuitState(Enum):
    """Circuit breaker states."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker."""

    failure_threshold: int = 5
    success_threshold: int = 3
    timeout_seconds: float = 60.0
    half_open_max_calls: int = 3


class CircuitBreaker:
    """
    Circuit breaker implementation for fault tolerance.

    Prevents cascade failures by stopping calls to failing services.
    """

    def __init__(
        self,
        name: str,
        config: Optional[CircuitBreakerConfig] = None,
    ):
        self.name = name
        self.config = config or CircuitBreakerConfig()

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: Optional[datetime] = None
        self._half_open_calls = 0

        self._lock = asyncio.Lock()

    @property
    def state(self) -> CircuitState:
        """Current circuit state."""
        return self._state

    @property
    def is_open(self) -> bool:
        """Check if circuit is open."""
        return self._state == CircuitState.OPEN

    async def _check_timeout(self) -> None:
        """Check if circuit should transition from OPEN to HALF_OPEN."""
        if self._state == CircuitState.OPEN and self._last_failure_time:
            elapsed = (datetime.utcnow() - self._last_failure_time).total_seconds()
            if elapsed >= self.config.timeout_seconds:
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
                logger.info(f"Circuit '{self.name}' transitioned to HALF_OPEN")

    async def record_success(self) -> None:
        """Record a successful call."""
        async with self._lock:
            if self._state == CircuitState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.config.success_threshold:
                    self._state = CircuitState.CLOSED
                    self._failure_count = 0
                    self._success_count = 0
                    logger.info(f"Circuit '{self.name}' closed after recovery")
            else:
                self._failure_count = 0

    async def record_failure(self, error: Exception) -> None:
        """Record a failed call."""
        async with self._lock:
            self._failure_count += 1
            self._last_failure_time = datetime.utcnow()

            if self._state == CircuitState.HALF_OPEN:
                self._state = CircuitState.OPEN
                self._success_count = 0
                logger.warning(
                    f"Circuit '{self.name}' reopened after failure in HALF_OPEN"
                )
            elif self._failure_count >= self.config.failure_threshold:
                self._state = CircuitState.OPEN
                logger.warning(
                    f"Circuit '{self.name}' opened after {self._failure_count} failures"
                )

    async def can_execute(self) -> bool:
        """Check if a call is allowed."""
        async with self._lock:
            await self._check_timeout()

            if self._state == CircuitState.CLOSED:
                return True

            if self._state == CircuitState.HALF_OPEN:
                if self._half_open_calls < self.config.half_open_max_calls:
                    self._half_open_calls += 1
                    return True
                return False

            return False

    async def execute(
        self,
        func: Callable[..., T],
        *args,
        fallback: Optional[Callable[..., T]] = None,
        **kwargs,
    ) -> T:
        """
        Execute a function through the circuit breaker.

        Args:
            func: Function to execute
            *args: Arguments
            fallback: Fallback function if circuit is open
            **kwargs: Keyword arguments

        Returns:
            Result of function or fallback
        """
        if not await self.can_execute():
            if fallback:
                logger.info(f"Circuit '{self.name}' open, using fallback")
                return await fallback(*args, **kwargs)

            raise ServiceError(
                ErrorCodes.SERVICE_CIRCUIT_OPEN,
                detail=f"Circuit breaker '{self.name}' is open",
                context={"circuit_name": self.name, "state": self._state.value},
            )

        try:
            result = await func(*args, **kwargs)
            await self.record_success()
            return result
        except Exception as e:
            await self.record_failure(e)
            raise

    def get_status(self) -> Dict[str, Any]:
        """Get circuit breaker status."""
        return {
            "name": self.name,
            "state": self._state.value,
            "failure_count": self._failure_count,
            "success_count": self._success_count,
            "last_failure": (
                self._last_failure_time.isoformat() if self._last_failure_time else None
            ),
        }


# Global circuit breaker registry
_circuit_breakers: Dict[str, CircuitBreaker] = {}


def get_circuit_breaker(
    name: str,
    config: Optional[CircuitBreakerConfig] = None,
) -> CircuitBreaker:
    """Get or create a circuit breaker by name."""
    if name not in _circuit_breakers:
        _circuit_breakers[name] = CircuitBreaker(name, config)
    return _circuit_breakers[name]


def circuit_breaker(
    name: str,
    config: Optional[CircuitBreakerConfig] = None,
    fallback: Optional[Callable] = None,
):
    """
    Decorator for adding circuit breaker to a function.

    Args:
        name: Circuit breaker name
        config: Circuit breaker configuration
        fallback: Fallback function if circuit is open
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        cb = get_circuit_breaker(name, config)

        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            return await cb.execute(func, *args, fallback=fallback, **kwargs)

        return wrapper

    return decorator


# =============================================================================
# Graceful Degradation
# =============================================================================


@dataclass
class DegradedResponse:
    """Response indicating degraded service."""

    data: Any
    is_degraded: bool = True
    degradation_reason: str = ""
    fallback_source: str = ""
    timestamp: datetime = field(default_factory=datetime.utcnow)


class GracefulDegradation:
    """
    Provides graceful degradation capabilities for services.

    When primary sources fail, falls back to cached data or mock data.
    """

    def __init__(self, service_name: str):
        self.service_name = service_name
        self._cache: Dict[str, Any] = {}
        self._cache_timestamps: Dict[str, datetime] = {}
        self._default_cache_ttl = timedelta(hours=1)

    def cache_result(
        self,
        key: str,
        data: Any,
        ttl: Optional[timedelta] = None,
    ) -> None:
        """Cache a successful result for fallback."""
        self._cache[key] = data
        self._cache_timestamps[key] = datetime.utcnow()

    def get_cached(
        self,
        key: str,
        max_age: Optional[timedelta] = None,
    ) -> Optional[Any]:
        """
        Get cached data if available and not expired.

        Args:
            key: Cache key
            max_age: Maximum age of cached data (None for any age)
        """
        if key not in self._cache:
            return None

        if max_age:
            cached_at = self._cache_timestamps.get(key)
            if cached_at and (datetime.utcnow() - cached_at) > max_age:
                return None

        return self._cache[key]

    async def with_fallback(
        self,
        primary_func: Callable[..., T],
        *args,
        cache_key: Optional[str] = None,
        fallback_func: Optional[Callable[..., T]] = None,
        mock_data: Optional[T] = None,
        **kwargs,
    ) -> Union[T, DegradedResponse]:
        """
        Execute primary function with fallback on failure.

        Args:
            primary_func: Primary function to try
            *args: Arguments
            cache_key: Key for caching successful results
            fallback_func: Fallback function to try
            mock_data: Mock data as last resort
            **kwargs: Keyword arguments

        Returns:
            Result from primary, fallback, or mock data
        """
        # Try primary source
        try:
            result = await primary_func(*args, **kwargs)
            if cache_key:
                self.cache_result(cache_key, result)
            return result

        except Exception as primary_error:
            logger.warning(
                f"Primary source failed for {self.service_name}: {primary_error}"
            )

            # Try cached data
            if cache_key:
                cached = self.get_cached(cache_key)
                if cached is not None:
                    return DegradedResponse(
                        data=cached,
                        is_degraded=True,
                        degradation_reason=str(primary_error),
                        fallback_source="cache",
                    )

            # Try fallback function
            if fallback_func:
                try:
                    result = await fallback_func(*args, **kwargs)
                    return DegradedResponse(
                        data=result,
                        is_degraded=True,
                        degradation_reason=str(primary_error),
                        fallback_source="fallback_function",
                    )
                except Exception as fallback_error:
                    logger.warning(f"Fallback function failed: {fallback_error}")

            # Return mock data as last resort
            if mock_data is not None:
                return DegradedResponse(
                    data=mock_data,
                    is_degraded=True,
                    degradation_reason=str(primary_error),
                    fallback_source="mock_data",
                )

            # All fallbacks exhausted
            raise ServiceError(
                ErrorCodes.SERVICE_UNAVAILABLE,
                detail=f"{self.service_name} unavailable and no fallback",
                original_error=primary_error,
            )


# =============================================================================
# Error Logging and Monitoring
# =============================================================================


@dataclass
class ErrorMetrics:
    """Metrics for error monitoring."""

    total_errors: int = 0
    errors_by_code: Dict[str, int] = field(default_factory=dict)
    errors_by_category: Dict[str, int] = field(default_factory=dict)
    last_error_time: Optional[datetime] = None
    error_rate_per_minute: float = 0.0


class ErrorMonitor:
    """
    Monitor and track errors for observability.

    Provides metrics and alerting capabilities.
    """

    def __init__(self, window_minutes: int = 5):
        self.window_minutes = window_minutes
        self._errors: List[tuple] = []
        self._metrics = ErrorMetrics()
        self._lock = asyncio.Lock()

    async def record_error(self, error: InvestingError) -> None:
        """Record an error occurrence."""
        async with self._lock:
            now = datetime.utcnow()

            # Update metrics
            self._metrics.total_errors += 1
            self._metrics.last_error_time = now

            code = error.code
            category = error.category.value

            self._metrics.errors_by_code[code] = (
                self._metrics.errors_by_code.get(code, 0) + 1
            )
            self._metrics.errors_by_category[category] = (
                self._metrics.errors_by_category.get(category, 0) + 1
            )

            # Track for rate calculation
            self._errors.append((now, error))

            # Clean old entries
            cutoff = now - timedelta(minutes=self.window_minutes)
            self._errors = [(t, e) for t, e in self._errors if t > cutoff]

            # Calculate rate
            if self._errors:
                self._metrics.error_rate_per_minute = (
                    len(self._errors) / self.window_minutes
                )

            # Log the error
            error.log()

    def get_metrics(self) -> ErrorMetrics:
        """Get current error metrics."""
        return self._metrics

    def get_top_errors(self, limit: int = 10) -> List[tuple]:
        """Get top errors by frequency."""
        return sorted(
            self._metrics.errors_by_code.items(),
            key=lambda x: x[1],
            reverse=True,
        )[:limit]


# Global error monitor instance
_error_monitor = ErrorMonitor()


async def report_error(error: InvestingError) -> None:
    """Report an error to the global monitor."""
    await _error_monitor.record_error(error)


def get_error_metrics() -> ErrorMetrics:
    """Get global error metrics."""
    return _error_monitor.get_metrics()


# =============================================================================
# FastAPI Exception Handler Integration
# =============================================================================


def create_error_response(
    error: InvestingError,
    debug_mode: bool = False,
) -> Dict[str, Any]:
    """
    Create a standardized error response for API endpoints.

    Args:
        error: The Investing error
        debug_mode: Include debug information
    """
    return {
        "success": False,
        "data": None,
        "error": error.to_dict(include_debug=debug_mode),
        "timestamp": datetime.utcnow().isoformat(),
    }


# =============================================================================
# Utility Functions
# =============================================================================


def wrap_exception(
    exception: Exception,
    default_code: ErrorCode = ErrorCodes.SYSTEM_INTERNAL_ERROR,
) -> InvestingError:
    """
    Wrap a generic exception in a InvestingError.

    Maps common exception types to appropriate error codes.
    """
    if isinstance(exception, InvestingError):
        return exception

    # Map common exception types
    exception_mapping = {
        TimeoutError: ErrorCodes.NETWORK_TIMEOUT,
        ConnectionError: ErrorCodes.NETWORK_UNREACHABLE,
        ConnectionRefusedError: ErrorCodes.NETWORK_CONNECTION_REFUSED,
        PermissionError: ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS,
        ValueError: ErrorCodes.VALIDATION_INVALID_VALUE,
        KeyError: ErrorCodes.DATA_NOT_FOUND,
        FileNotFoundError: ErrorCodes.DATA_NOT_FOUND,
        ImportError: ErrorCodes.EXTERNAL_DEPENDENCY_MISSING,
        MemoryError: ErrorCodes.SYSTEM_OUT_OF_MEMORY,
    }

    for exc_type, error_code in exception_mapping.items():
        if isinstance(exception, exc_type):
            return InvestingError(
                error_code,
                detail=str(exception),
                original_error=exception,
            )

    return InvestingError(
        default_code,
        detail=str(exception),
        original_error=exception,
    )


def validate_symbol(symbol: str) -> None:
    """
    Validate a stock symbol format.

    Raises:
        ValidationError: If symbol is invalid
    """
    import re

    if not symbol or not isinstance(symbol, str):
        raise ValidationError(
            ErrorCodes.VALIDATION_INVALID_SYMBOL,
            detail="Symbol cannot be empty",
        )

    symbol = symbol.strip().upper()

    # Basic US stock symbol pattern (1-5 letters)
    if not re.match(r"^[A-Z]{1,5}$", symbol):
        raise ValidationError(
            ErrorCodes.VALIDATION_INVALID_SYMBOL,
            detail=f"Invalid symbol format: {symbol}",
            context={"symbol": symbol},
        )


def validate_date_range(
    start_date: datetime,
    end_date: datetime,
    max_days: int = 365 * 10,
) -> None:
    """
    Validate a date range.

    Raises:
        ValidationError: If date range is invalid
    """
    if start_date >= end_date:
        raise ValidationError(
            ErrorCodes.VALIDATION_INVALID_DATE_RANGE,
            detail="Start date must be before end date",
            context={"start_date": str(start_date), "end_date": str(end_date)},
        )

    if (end_date - start_date).days > max_days:
        raise ValidationError(
            ErrorCodes.VALIDATION_INVALID_DATE_RANGE,
            detail=f"Date range cannot exceed {max_days} days",
            context={"max_days": max_days},
        )


# =============================================================================
# Export All
# =============================================================================

__all__ = [
    # Enums
    "ErrorCategory",
    "ErrorSeverity",
    "CircuitState",
    # Error Codes
    "ErrorCode",
    "ErrorCodes",
    # Exceptions
    "InvestingError",
    "NetworkError",
    "DataError",
    "AuthenticationError",
    "ValidationError",
    "ServiceError",
    "ExternalAPIError",
    "SystemError",
    "RetryExhaustedError",
    # Retry
    "RetryConfig",
    "retry_async",
    "retry",
    "calculate_backoff",
    # Circuit Breaker
    "CircuitBreaker",
    "CircuitBreakerConfig",
    "get_circuit_breaker",
    "circuit_breaker",
    # Degradation
    "DegradedResponse",
    "GracefulDegradation",
    # Monitoring
    "ErrorMetrics",
    "ErrorMonitor",
    "report_error",
    "get_error_metrics",
    # API Response
    "create_error_response",
    # Utilities
    "wrap_exception",
    "validate_symbol",
    "validate_date_range",
]
