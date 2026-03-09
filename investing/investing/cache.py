"""
Investing Cache Manager
=====================

Redis-based caching layer for Investing API endpoints.
Provides TTL-based caching for expensive operations like:
- Market data fetching
- Institutional holdings analysis
- Money flow calculations
- SEC filings data

Usage:
    from investing.cache import cache_manager, cached

    # Use decorator for automatic caching
    @cached(ttl=300)
    async def get_expensive_data(symbol: str):
        ...

    # Or use cache manager directly
    result = await cache_manager.get_or_set("key", fetch_func, ttl=300)
"""

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timedelta
from functools import wraps
from typing import Any, Callable, Dict, Optional, TypeVar, Union

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CacheEntry:
    """In-memory cache entry with TTL support."""

    def __init__(self, value: Any, ttl_seconds: int):
        self.value = value
        self.expires_at = datetime.now() + timedelta(seconds=ttl_seconds)

    def is_expired(self) -> bool:
        return datetime.now() > self.expires_at


class CacheManager:
    """
    Unified cache manager supporting both Redis and in-memory fallback.

    Automatically uses Redis if configured, otherwise falls back to
    an in-memory LRU cache with TTL support.
    """

    def __init__(self, max_memory_entries: int = 1000):
        self._redis_client = None
        self._memory_cache: Dict[str, CacheEntry] = {}
        self._max_memory_entries = max_memory_entries
        self._initialized = False
        self._use_redis = False

    async def initialize(self) -> bool:
        """
        Initialize the cache manager.

        Returns:
            True if Redis connection was established, False for memory-only.
        """
        if self._initialized:
            return self._use_redis

        redis_url = os.environ.get("ZEE_INVESTING_REDIS_URL") or os.environ.get("REDIS_URL")

        if redis_url:
            try:
                import redis.asyncio as aioredis

                self._redis_client = aioredis.from_url(
                    redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                )
                # Test connection
                await self._redis_client.ping()
                self._use_redis = True
                logger.info(f"Redis cache initialized: {redis_url}")
            except ImportError:
                logger.warning("redis package not installed, using memory cache")
                self._use_redis = False
            except Exception as e:
                logger.warning(f"Redis connection failed ({e}), using memory cache")
                self._use_redis = False
        else:
            logger.info("No Redis URL configured, using memory cache")
            self._use_redis = False

        self._initialized = True
        return self._use_redis

    def _make_key(self, *args, **kwargs) -> str:
        """Create a cache key from arguments.

        Handles non-JSON-serializable types (datetime, numpy, etc.) by falling
        back to string representation.
        """

        def _serializer(obj):
            # Handle common non-serializable types
            if hasattr(obj, "isoformat"):  # datetime, date
                return obj.isoformat()
            if hasattr(obj, "tolist"):  # numpy arrays
                return obj.tolist()
            # Fallback to string representation
            return repr(obj)

        try:
            key_data = json.dumps(
                {"args": args, "kwargs": kwargs},
                sort_keys=True,
                default=_serializer,
            )
        except (TypeError, ValueError):
            # Ultimate fallback: use repr of everything
            key_data = repr((args, sorted(kwargs.items()) if kwargs else ()))

        return hashlib.sha256(key_data.encode()).hexdigest()[:32]

    async def get(self, key: str) -> Optional[Any]:
        """Get a value from cache."""
        await self.initialize()

        if self._use_redis:
            try:
                value = await self._redis_client.get(f"investing:{key}")
                if value:
                    return json.loads(value)
            except Exception as e:
                logger.warning(f"Redis get failed: {e}")

        # Memory fallback
        entry = self._memory_cache.get(key)
        if entry and not entry.is_expired():
            return entry.value
        elif entry:
            del self._memory_cache[key]

        return None

    async def set(self, key: str, value: Any, ttl: int = 300) -> bool:
        """
        Set a value in cache with TTL.

        Args:
            key: Cache key
            value: Value to cache (must be JSON serializable)
            ttl: Time to live in seconds (default: 5 minutes)

        Returns:
            True if successful
        """
        await self.initialize()

        if self._use_redis:
            try:
                await self._redis_client.setex(
                    f"investing:{key}", ttl, json.dumps(value, default=str)
                )
                return True
            except Exception as e:
                logger.warning(f"Redis set failed: {e}")

        # Memory fallback with LRU eviction
        if len(self._memory_cache) >= self._max_memory_entries:
            # Evict oldest entries
            sorted_entries = sorted(
                self._memory_cache.items(), key=lambda x: x[1].expires_at
            )
            for old_key, _ in sorted_entries[:100]:
                del self._memory_cache[old_key]

        self._memory_cache[key] = CacheEntry(value, ttl)
        return True

    async def delete(self, key: str) -> bool:
        """Delete a key from cache."""
        await self.initialize()

        deleted = False
        if self._use_redis:
            try:
                await self._redis_client.delete(f"investing:{key}")
                deleted = True
            except Exception as e:
                logger.warning(f"Redis delete failed: {e}")

        if key in self._memory_cache:
            del self._memory_cache[key]
            deleted = True

        return deleted

    async def clear_pattern(self, pattern: str) -> int:
        """
        Clear all keys matching a pattern.

        Args:
            pattern: Pattern to match (e.g., "market:*")

        Returns:
            Number of keys deleted
        """
        await self.initialize()
        count = 0

        if self._use_redis:
            try:
                cursor = 0
                while True:
                    cursor, keys = await self._redis_client.scan(
                        cursor=cursor, match=f"investing:{pattern}", count=100
                    )
                    if keys:
                        await self._redis_client.delete(*keys)
                        count += len(keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.warning(f"Redis pattern clear failed: {e}")

        # Memory cache pattern matching
        pattern_prefix = pattern.replace("*", "")
        keys_to_delete = [
            k for k in self._memory_cache.keys() if k.startswith(pattern_prefix)
        ]
        for key in keys_to_delete:
            del self._memory_cache[key]
            count += 1

        return count

    async def get_or_set(
        self, key: str, fetch_func: Callable[[], T], ttl: int = 300
    ) -> T:
        """
        Get from cache or fetch and cache.

        Args:
            key: Cache key
            fetch_func: Async or sync function to call on cache miss
            ttl: Time to live in seconds

        Returns:
            Cached or freshly fetched value
        """
        cached = await self.get(key)
        if cached is not None:
            return cached

        # Fetch fresh data
        if asyncio.iscoroutinefunction(fetch_func):
            value = await fetch_func()
        else:
            value = fetch_func()

        await self.set(key, value, ttl)
        return value

    async def stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        await self.initialize()

        stats = {
            "backend": "redis" if self._use_redis else "memory",
            "memory_entries": len(self._memory_cache),
            "max_memory_entries": self._max_memory_entries,
        }

        if self._use_redis:
            try:
                info = await self._redis_client.info("memory")
                stats["redis_used_memory"] = info.get("used_memory_human")
                stats["redis_keys"] = await self._redis_client.dbsize()
            except Exception:
                pass

        return stats

    async def close(self):
        """Close connections."""
        if self._redis_client:
            await self._redis_client.close()
        self._memory_cache.clear()
        self._initialized = False


# Global cache manager instance
cache_manager = CacheManager()


def cached(ttl: int = 300, key_prefix: Optional[str] = None, skip_none: bool = True):
    """
    Decorator for caching async function results.

    Args:
        ttl: Cache TTL in seconds (default: 5 minutes)
        key_prefix: Optional prefix for cache keys
        skip_none: Don't cache None results (default: True)

    Example:
        @cached(ttl=600, key_prefix="market")
        async def get_market_data(symbol: str) -> dict:
            ...
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key
            prefix = key_prefix or func.__name__
            key_content = cache_manager._make_key(*args, **kwargs)
            cache_key = f"{prefix}:{key_content}"

            # Try cache
            cached_value = await cache_manager.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache hit: {cache_key}")
                return cached_value

            # Fetch fresh
            logger.debug(f"Cache miss: {cache_key}")
            result = await func(*args, **kwargs)

            # Cache result
            if result is not None or not skip_none:
                await cache_manager.set(cache_key, result, ttl)

            return result

        return wrapper

    return decorator


# Cache TTL presets for different data types
class CacheTTL:
    """Standard TTL values for different data types."""

    REAL_TIME = 30  # 30 seconds - quotes, prices
    SHORT = 60  # 1 minute - active market data
    MEDIUM = 300  # 5 minutes - money flow, dark pool
    LONG = 900  # 15 minutes - institutional data
    EXTENDED = 3600  # 1 hour - SEC filings, research
    DAILY = 86400  # 24 hours - historical data
    WEEKLY = 604800  # 1 week - reference data
