"""
Stanley Rate Limiting Middleware

Implements sliding window rate limiting for the Stanley API with:
- Per-user rate limiting (by user_id or API key)
- Per-IP rate limiting for unauthenticated requests
- Endpoint category-based limits
- Custom limits via decorator
- Standard rate limit headers

Rate Limits by Endpoint Category:
- market_data: 100/minute
- analytics: 30/minute
- research: 20/minute
- accounting: 10/minute (SEC EDGAR courtesy limit)
- signals: 50/minute
- default: 60/minute
"""

import asyncio
import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from functools import wraps
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

logger = logging.getLogger(__name__)


# =============================================================================
# Rate Limit Configuration
# =============================================================================


@dataclass
class RateLimitConfig:
    """Configuration for a rate limit."""

    requests: int
    window_seconds: int
    category: str = "default"

    @property
    def requests_per_second(self) -> float:
        """Calculate requests per second for logging."""
        return self.requests / self.window_seconds


# Endpoint category rate limits (from roadmap)
RATE_LIMIT_CONFIGS: Dict[str, RateLimitConfig] = {
    "market_data": RateLimitConfig(
        requests=100, window_seconds=60, category="market_data"
    ),
    "analytics": RateLimitConfig(requests=30, window_seconds=60, category="analytics"),
    "research": RateLimitConfig(requests=20, window_seconds=60, category="research"),
    "accounting": RateLimitConfig(
        requests=10, window_seconds=60, category="accounting"
    ),
    "signals": RateLimitConfig(requests=50, window_seconds=60, category="signals"),
    "options": RateLimitConfig(requests=30, window_seconds=60, category="options"),
    "etf": RateLimitConfig(requests=30, window_seconds=60, category="etf"),
    "macro": RateLimitConfig(requests=20, window_seconds=60, category="macro"),
    "commodities": RateLimitConfig(
        requests=30, window_seconds=60, category="commodities"
    ),
    "portfolio": RateLimitConfig(requests=30, window_seconds=60, category="portfolio"),
    "notes": RateLimitConfig(requests=50, window_seconds=60, category="notes"),
    "settings": RateLimitConfig(requests=30, window_seconds=60, category="settings"),
    "default": RateLimitConfig(requests=60, window_seconds=60, category="default"),
}

# Endpoint path to category mapping
ENDPOINT_CATEGORIES: Dict[str, str] = {
    "/api/market": "market_data",
    "/api/prediction-markets": "market_data",
    "/api/institutional": "analytics",
    "/api/money-flow": "analytics",
    "/api/dark-pool": "analytics",
    "/api/equity-flow": "analytics",
    "/api/sector-rotation": "analytics",
    "/api/research": "research",
    "/api/valuation": "research",
    "/api/earnings": "research",
    "/api/peers": "research",
    "/api/accounting": "accounting",
    "/api/signals": "signals",
    "/api/options": "options",
    "/api/etf": "etf",
    "/api/macro": "macro",
    "/api/commodities": "commodities",
    "/api/portfolio": "portfolio",
    "/api/notes": "notes",
    "/api/theses": "notes",
    "/api/trades": "notes",
    "/api/settings": "settings",
}


# =============================================================================
# Exceptions
# =============================================================================


class RateLimitExceeded(HTTPException):
    """Exception raised when rate limit is exceeded."""

    def __init__(
        self,
        limit: int,
        window: int,
        retry_after: int,
        detail: Optional[str] = None,
    ):
        self.limit = limit
        self.window = window
        self.retry_after = retry_after
        message = (
            detail or f"Rate limit exceeded: {limit} requests per {window} seconds"
        )
        super().__init__(
            status_code=429,
            detail=message,
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(int(time.time()) + retry_after),
            },
        )


# =============================================================================
# Sliding Window Rate Limiter
# =============================================================================


@dataclass
class SlidingWindowEntry:
    """Entry in the sliding window for rate limiting."""

    timestamps: List[float] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RateLimiter:
    """
    Sliding window rate limiter with in-memory storage.

    Implements a sliding window algorithm that provides more accurate
    rate limiting compared to fixed window approaches.

    Structured for future Redis backend migration:
    - All state access goes through _get_window and _set_window
    - Async-compatible with lock-based concurrency control
    - TTL-aware cleanup to prevent memory leaks
    """

    def __init__(
        self,
        default_requests: int = 60,
        default_window: int = 60,
        cleanup_interval: int = 300,
    ):
        """
        Initialize the rate limiter.

        Args:
            default_requests: Default number of requests allowed per window
            default_window: Default window size in seconds
            cleanup_interval: Interval for cleaning up expired entries (seconds)
        """
        self.default_requests = default_requests
        self.default_window = default_window
        self.cleanup_interval = cleanup_interval

        # In-memory storage: key -> SlidingWindowEntry
        self._windows: Dict[str, SlidingWindowEntry] = defaultdict(SlidingWindowEntry)
        self._global_lock = asyncio.Lock()
        self._last_cleanup = time.time()

        # Custom limits per key pattern (for decorator-based limits)
        self._custom_limits: Dict[str, Tuple[int, int]] = {}

    def set_custom_limit(self, key_pattern: str, requests: int, window: int) -> None:
        """
        Set a custom rate limit for a specific key pattern.

        Args:
            key_pattern: Key pattern to match (e.g., "endpoint:/api/market")
            requests: Number of requests allowed
            window: Window size in seconds
        """
        self._custom_limits[key_pattern] = (requests, window)

    def get_limit_for_key(self, key: str) -> Tuple[int, int]:
        """
        Get the rate limit configuration for a key.

        Args:
            key: The rate limit key

        Returns:
            Tuple of (requests, window_seconds)
        """
        # Check for exact match in custom limits
        if key in self._custom_limits:
            return self._custom_limits[key]

        # Check for pattern match (e.g., endpoint category)
        for pattern, limits in self._custom_limits.items():
            if key.startswith(pattern) or pattern in key:
                return limits

        return (self.default_requests, self.default_window)

    async def _cleanup_expired(self, force: bool = False) -> None:
        """
        Clean up expired window entries to prevent memory leaks.

        Args:
            force: Force cleanup regardless of interval
        """
        now = time.time()
        if not force and (now - self._last_cleanup) < self.cleanup_interval:
            return

        async with self._global_lock:
            self._last_cleanup = now
            keys_to_remove = []

            for key, entry in self._windows.items():
                async with entry.lock:
                    # Get the limit for this key to determine expiry
                    _, window = self.get_limit_for_key(key)
                    cutoff = now - window

                    # Remove expired timestamps
                    entry.timestamps = [ts for ts in entry.timestamps if ts > cutoff]

                    # Mark for removal if empty
                    if not entry.timestamps:
                        keys_to_remove.append(key)

            # Remove empty entries
            for key in keys_to_remove:
                del self._windows[key]

            if keys_to_remove:
                logger.debug(
                    "Cleaned up %d expired rate limit entries", len(keys_to_remove)
                )

    async def check_rate_limit(
        self,
        key: str,
        requests: Optional[int] = None,
        window: Optional[int] = None,
    ) -> Tuple[bool, int, int]:
        """
        Check if a request is allowed under rate limits.

        Args:
            key: Unique identifier for the rate limit bucket
            requests: Number of requests allowed (uses default if None)
            window: Window size in seconds (uses default if None)

        Returns:
            Tuple of (allowed, remaining, reset_timestamp)
        """
        # Trigger cleanup periodically
        await self._cleanup_expired()

        # Get limits
        if requests is None or window is None:
            default_requests, default_window = self.get_limit_for_key(key)
            requests = requests or default_requests
            window = window or default_window

        now = time.time()
        cutoff = now - window

        entry = self._windows[key]

        async with entry.lock:
            # Remove expired timestamps (sliding window)
            entry.timestamps = [ts for ts in entry.timestamps if ts > cutoff]

            # Check if under limit
            current_count = len(entry.timestamps)
            remaining = max(0, requests - current_count - 1)
            reset_time = int(now) + window

            if current_count >= requests:
                # Calculate retry-after based on oldest timestamp
                if entry.timestamps:
                    retry_after = int(entry.timestamps[0] + window - now) + 1
                else:
                    retry_after = window
                return (False, 0, retry_after)

            # Add current request timestamp
            entry.timestamps.append(now)
            return (True, remaining, reset_time)

    async def is_allowed(
        self,
        key: str,
        requests: Optional[int] = None,
        window: Optional[int] = None,
    ) -> bool:
        """
        Simple check if request is allowed.

        Args:
            key: Unique identifier for the rate limit bucket
            requests: Number of requests allowed
            window: Window size in seconds

        Returns:
            True if allowed, False otherwise
        """
        allowed, _, _ = await self.check_rate_limit(key, requests, window)
        return allowed

    async def get_remaining(self, key: str, window: Optional[int] = None) -> int:
        """
        Get remaining requests for a key without consuming.

        Args:
            key: Unique identifier for the rate limit bucket
            window: Window size in seconds

        Returns:
            Number of remaining requests
        """
        if window is None:
            _, window = self.get_limit_for_key(key)

        now = time.time()
        cutoff = now - window

        entry = self._windows.get(key)
        if not entry:
            requests, _ = self.get_limit_for_key(key)
            return requests

        async with entry.lock:
            valid_timestamps = [ts for ts in entry.timestamps if ts > cutoff]
            requests, _ = self.get_limit_for_key(key)
            return max(0, requests - len(valid_timestamps))

    async def reset(self, key: str) -> None:
        """
        Reset rate limit for a specific key.

        Args:
            key: Unique identifier for the rate limit bucket
        """
        async with self._global_lock:
            if key in self._windows:
                del self._windows[key]

    async def reset_all(self) -> None:
        """Reset all rate limits."""
        async with self._global_lock:
            self._windows.clear()

    def get_stats(self) -> Dict[str, Any]:
        """
        Get rate limiter statistics.

        Returns:
            Dictionary with stats about current rate limit state
        """
        total_keys = len(self._windows)
        total_requests = sum(len(entry.timestamps) for entry in self._windows.values())

        return {
            "total_keys": total_keys,
            "total_tracked_requests": total_requests,
            "custom_limits_count": len(self._custom_limits),
            "last_cleanup": self._last_cleanup,
        }


# Global rate limiter instance
_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """Get or create the global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter


# =============================================================================
# Key Extraction
# =============================================================================


def get_rate_limit_key(request: Request) -> str:
    """
    Extract rate limit key from request.

    Priority:
    1. Authenticated user_id from request state
    2. API key from header or query param
    3. Client IP address

    Args:
        request: FastAPI request object

    Returns:
        Unique key for rate limiting
    """
    # Check for authenticated user
    if hasattr(request.state, "user_id") and request.state.user_id:
        return f"user:{request.state.user_id}"

    # Check for API key in header
    api_key = request.headers.get("X-API-Key")
    if api_key:
        # Truncate API key for privacy in logs (16 chars provides sufficient uniqueness)
        key_prefix = api_key[:16] if len(api_key) >= 16 else api_key
        return f"apikey:{key_prefix}"

    # Check for API key in query params
    api_key = request.query_params.get("api_key")
    if api_key:
        key_prefix = api_key[:16] if len(api_key) >= 16 else api_key
        return f"apikey:{key_prefix}"

    # Fall back to IP address
    # Handle X-Forwarded-For for reverse proxy setups
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take the first IP in the chain (original client)
        client_ip = forwarded_for.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"

    return f"ip:{client_ip}"


def get_endpoint_category(path: str) -> str:
    """
    Determine the rate limit category for an endpoint path.

    Args:
        path: Request path

    Returns:
        Category name for rate limiting
    """
    # Check for exact or prefix matches
    for prefix, category in ENDPOINT_CATEGORIES.items():
        if path.startswith(prefix):
            return category

    return "default"


# =============================================================================
# Middleware
# =============================================================================


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware for rate limiting.

    Applies rate limits based on:
    - Endpoint category (from path)
    - Client identifier (user_id, API key, or IP)

    Adds standard rate limit headers to responses.
    """

    def __init__(
        self,
        app: FastAPI,
        rate_limiter: Optional[RateLimiter] = None,
        exclude_paths: Optional[List[str]] = None,
    ):
        """
        Initialize the middleware.

        Args:
            app: FastAPI application
            rate_limiter: RateLimiter instance (uses global if None)
            exclude_paths: List of paths to exclude from rate limiting
        """
        super().__init__(app)
        self.limiter = rate_limiter or get_rate_limiter()
        self.exclude_paths = exclude_paths or [
            "/api/health",
            "/docs",
            "/redoc",
            "/openapi.json",
        ]

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        """Process request through rate limiting."""
        path = request.url.path

        # Skip excluded paths
        if any(path.startswith(excluded) for excluded in self.exclude_paths):
            return await call_next(request)

        # Bypass rate limiting in test mode
        if os.getenv("STANLEY_TEST_MODE"):
            return await call_next(request)

        # Get client identifier
        client_key = get_rate_limit_key(request)

        # Get endpoint category and limits
        category = get_endpoint_category(path)
        config = RATE_LIMIT_CONFIGS.get(category, RATE_LIMIT_CONFIGS["default"])

        # Create composite key: client + category
        rate_key = f"{client_key}:{category}"

        try:
            # Check rate limit
            allowed, remaining, reset_time = await self.limiter.check_rate_limit(
                rate_key,
                requests=config.requests,
                window=config.window_seconds,
            )

            if not allowed:
                # Rate limit exceeded
                retry_after = reset_time
                logger.warning(
                    "Rate limit exceeded for %s on %s (category: %s, limit: %d/%ds)",
                    client_key,
                    path,
                    category,
                    config.requests,
                    config.window_seconds,
                )
                return JSONResponse(
                    status_code=429,
                    content={
                        "success": False,
                        "error": f"Rate limit exceeded: {config.requests} requests per {config.window_seconds} seconds",
                        "detail": {
                            "limit": config.requests,
                            "window_seconds": config.window_seconds,
                            "category": category,
                            "retry_after": retry_after,
                        },
                    },
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Limit": str(config.requests),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(int(time.time()) + retry_after),
                    },
                )

            # Process request
            response = await call_next(request)

            # Add rate limit headers to response
            response.headers["X-RateLimit-Limit"] = str(config.requests)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(reset_time)
            response.headers["X-RateLimit-Category"] = category

            return response

        except Exception as e:
            logger.error("Rate limiting error: %s", e)
            # On error, allow request but log the issue
            return await call_next(request)


# =============================================================================
# Decorator for Custom Rate Limits
# =============================================================================


def rate_limit(
    requests: int,
    window: int = 60,
    key_func: Optional[Callable[[Request], str]] = None,
) -> Callable:
    """
    Decorator for applying custom rate limits to specific endpoints.

    Usage:
        @app.get("/api/market/{symbol}")
        @rate_limit(requests=100, window=60)
        async def get_market(symbol: str, request: Request):
            ...

    Args:
        requests: Number of requests allowed in window
        window: Window size in seconds (default: 60)
        key_func: Optional function to generate rate limit key

    Returns:
        Decorated function with rate limiting
    """

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            # Find request in args or kwargs
            request: Optional[Request] = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            if request is None:
                request = kwargs.get("request")

            if request is None:
                # No request found, execute without rate limiting
                logger.warning(
                    "rate_limit decorator used but no Request object found in %s",
                    func.__name__,
                )
                return await func(*args, **kwargs)

            # Get rate limit key
            if key_func:
                client_key = key_func(request)
            else:
                client_key = get_rate_limit_key(request)

            # Create unique key for this endpoint
            endpoint_key = f"endpoint:{func.__name__}:{client_key}"

            # Check rate limit
            limiter = get_rate_limiter()
            allowed, remaining, reset_time = await limiter.check_rate_limit(
                endpoint_key,
                requests=requests,
                window=window,
            )

            if not allowed:
                raise RateLimitExceeded(
                    limit=requests,
                    window=window,
                    retry_after=reset_time,
                )

            # Execute function
            result = await func(*args, **kwargs)

            # If result is a Response, add headers
            if isinstance(result, Response):
                result.headers["X-RateLimit-Limit"] = str(requests)
                result.headers["X-RateLimit-Remaining"] = str(remaining)
                result.headers["X-RateLimit-Reset"] = str(reset_time)

            return result

        return wrapper

    return decorator


# =============================================================================
# Dependency for FastAPI
# =============================================================================


class RateLimitDependency:
    """
    FastAPI dependency for rate limiting.

    Usage:
        from fastapi import Depends

        rate_limit_dep = RateLimitDependency(requests=100, window=60)

        @app.get("/api/market/{symbol}")
        async def get_market(
            symbol: str,
            _: None = Depends(rate_limit_dep),
        ):
            ...
    """

    def __init__(
        self,
        requests: int,
        window: int = 60,
        category: Optional[str] = None,
    ):
        """
        Initialize the dependency.

        Args:
            requests: Number of requests allowed
            window: Window size in seconds
            category: Optional category override
        """
        self.requests = requests
        self.window = window
        self.category = category

    async def __call__(self, request: Request) -> None:
        """Check rate limit when dependency is called."""
        client_key = get_rate_limit_key(request)
        category = self.category or get_endpoint_category(request.url.path)

        rate_key = f"{client_key}:{category}"
        limiter = get_rate_limiter()

        allowed, remaining, reset_time = await limiter.check_rate_limit(
            rate_key,
            requests=self.requests,
            window=self.window,
        )

        if not allowed:
            raise RateLimitExceeded(
                limit=self.requests,
                window=self.window,
                retry_after=reset_time,
            )

        # Store rate limit info in request state for response headers
        request.state.rate_limit_remaining = remaining
        request.state.rate_limit_reset = reset_time
        request.state.rate_limit_limit = self.requests


# =============================================================================
# Utility Functions
# =============================================================================


def configure_rate_limits(app: FastAPI) -> RateLimiter:
    """
    Configure rate limiting for a FastAPI application.

    Args:
        app: FastAPI application instance

    Returns:
        Configured RateLimiter instance
    """
    limiter = get_rate_limiter()

    # Register custom limits for each category
    for category, config in RATE_LIMIT_CONFIGS.items():
        limiter.set_custom_limit(
            f":{category}",
            config.requests,
            config.window_seconds,
        )

    # Add middleware
    app.add_middleware(RateLimitMiddleware, rate_limiter=limiter)

    logger.info(
        "Rate limiting configured: %d categories, default %d req/%ds",
        len(RATE_LIMIT_CONFIGS),
        RATE_LIMIT_CONFIGS["default"].requests,
        RATE_LIMIT_CONFIGS["default"].window_seconds,
    )

    return limiter


async def get_rate_limit_status(request: Request) -> Dict[str, Any]:
    """
    Get current rate limit status for a request.

    Args:
        request: FastAPI request object

    Returns:
        Dictionary with rate limit status information
    """
    client_key = get_rate_limit_key(request)
    category = get_endpoint_category(request.url.path)
    config = RATE_LIMIT_CONFIGS.get(category, RATE_LIMIT_CONFIGS["default"])

    rate_key = f"{client_key}:{category}"
    limiter = get_rate_limiter()

    remaining = await limiter.get_remaining(rate_key, config.window_seconds)

    return {
        "client_key": client_key,
        "category": category,
        "limit": config.requests,
        "remaining": remaining,
        "window_seconds": config.window_seconds,
    }
