"""
Tests for Investing Rate Limiting Middleware.

Tests cover:
- RateLimiter class with sliding window algorithm
- Rate limit key extraction
- Endpoint category detection
- Custom rate limits via decorator
- Rate limit headers
- 429 responses when exceeded
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

# Import the rate limiting module components directly to avoid auth module dependencies
import sys
import os
import importlib.util

# Load the rate_limit module directly without going through __init__.py
# This avoids import errors from other auth dependencies (jose, passlib, etc.)
_module_path = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "..",
    "investing",
    "api",
    "auth",
    "rate_limit.py",
)
_module_path = os.path.normpath(_module_path)

spec = importlib.util.spec_from_file_location("rate_limit", _module_path)
rate_limit_module = importlib.util.module_from_spec(spec)
sys.modules["rate_limit"] = rate_limit_module
spec.loader.exec_module(rate_limit_module)

# Import from the loaded module
RateLimiter = rate_limit_module.RateLimiter
RateLimitMiddleware = rate_limit_module.RateLimitMiddleware
RateLimitExceeded = rate_limit_module.RateLimitExceeded
RateLimitConfig = rate_limit_module.RateLimitConfig
RateLimitDependency = rate_limit_module.RateLimitDependency
rate_limit = rate_limit_module.rate_limit
get_rate_limit_key = rate_limit_module.get_rate_limit_key
get_rate_limiter = rate_limit_module.get_rate_limiter
get_endpoint_category = rate_limit_module.get_endpoint_category
configure_rate_limits = rate_limit_module.configure_rate_limits
RATE_LIMIT_CONFIGS = rate_limit_module.RATE_LIMIT_CONFIGS
ENDPOINT_CATEGORIES = rate_limit_module.ENDPOINT_CATEGORIES


# =============================================================================
# RateLimitConfig Tests
# =============================================================================


class TestRateLimitConfig:
    """Tests for RateLimitConfig dataclass."""

    def test_config_creation(self):
        """Test creating a rate limit config."""
        config = RateLimitConfig(requests=100, window_seconds=60, category="test")
        assert config.requests == 100
        assert config.window_seconds == 60
        assert config.category == "test"

    def test_requests_per_second(self):
        """Test requests_per_second property calculation."""
        config = RateLimitConfig(requests=60, window_seconds=60)
        assert config.requests_per_second == 1.0

        config2 = RateLimitConfig(requests=100, window_seconds=60)
        assert abs(config2.requests_per_second - 1.667) < 0.01

    def test_default_category(self):
        """Test default category value."""
        config = RateLimitConfig(requests=10, window_seconds=60)
        assert config.category == "default"


# =============================================================================
# Rate Limit Configs Tests
# =============================================================================


class TestRateLimitConfigs:
    """Tests for predefined rate limit configurations."""

    def test_market_data_limit(self):
        """Test market_data rate limit (100/min)."""
        config = RATE_LIMIT_CONFIGS["market_data"]
        assert config.requests == 100
        assert config.window_seconds == 60

    def test_analytics_limit(self):
        """Test analytics rate limit (30/min)."""
        config = RATE_LIMIT_CONFIGS["analytics"]
        assert config.requests == 30
        assert config.window_seconds == 60

    def test_research_limit(self):
        """Test research rate limit (20/min)."""
        config = RATE_LIMIT_CONFIGS["research"]
        assert config.requests == 20
        assert config.window_seconds == 60

    def test_accounting_limit(self):
        """Test accounting rate limit (10/min - SEC EDGAR courtesy)."""
        config = RATE_LIMIT_CONFIGS["accounting"]
        assert config.requests == 10
        assert config.window_seconds == 60

    def test_signals_limit(self):
        """Test signals rate limit (50/min)."""
        config = RATE_LIMIT_CONFIGS["signals"]
        assert config.requests == 50
        assert config.window_seconds == 60

    def test_default_limit(self):
        """Test default rate limit (60/min)."""
        config = RATE_LIMIT_CONFIGS["default"]
        assert config.requests == 60
        assert config.window_seconds == 60

    def test_all_categories_defined(self):
        """Test all expected categories are defined."""
        expected = [
            "market_data",
            "analytics",
            "research",
            "accounting",
            "signals",
            "options",
            "etf",
            "macro",
            "commodities",
            "portfolio",
            "notes",
            "settings",
            "default",
        ]
        for category in expected:
            assert category in RATE_LIMIT_CONFIGS


# =============================================================================
# Endpoint Categories Tests
# =============================================================================


class TestEndpointCategories:
    """Tests for endpoint to category mapping."""

    def test_market_endpoint(self):
        """Test /api/market maps to market_data."""
        assert get_endpoint_category("/api/market/AAPL") == "market_data"

    def test_accounting_endpoint(self):
        """Test /api/accounting maps to accounting."""
        assert get_endpoint_category("/api/accounting/AAPL/filings") == "accounting"

    def test_signals_endpoint(self):
        """Test /api/signals maps to signals."""
        assert get_endpoint_category("/api/signals/generate") == "signals"

    def test_research_endpoint(self):
        """Test /api/research maps to research."""
        assert get_endpoint_category("/api/research/MSFT") == "research"

    def test_unknown_endpoint(self):
        """Test unknown endpoint maps to default."""
        assert get_endpoint_category("/api/unknown/path") == "default"
        assert get_endpoint_category("/other/path") == "default"

    def test_analytics_endpoints(self):
        """Test analytics-related endpoints."""
        assert get_endpoint_category("/api/institutional/AAPL") == "analytics"
        assert get_endpoint_category("/api/money-flow") == "analytics"
        assert get_endpoint_category("/api/dark-pool/AAPL") == "analytics"

    def test_notes_endpoints(self):
        """Test notes-related endpoints."""
        assert get_endpoint_category("/api/notes") == "notes"
        assert get_endpoint_category("/api/theses") == "notes"
        assert get_endpoint_category("/api/trades") == "notes"


# =============================================================================
# RateLimiter Tests
# =============================================================================


class TestRateLimiter:
    """Tests for RateLimiter class."""

    @pytest.fixture
    def limiter(self):
        """Create a fresh rate limiter for each test."""
        return RateLimiter(default_requests=5, default_window=60)

    @pytest.mark.asyncio
    async def test_allow_within_limit(self, limiter):
        """Test requests within limit are allowed."""
        key = "test:user:1"

        for i in range(5):
            allowed, remaining, _ = await limiter.check_rate_limit(
                key, requests=5, window=60
            )
            assert allowed is True
            assert remaining == 5 - i - 1

    @pytest.mark.asyncio
    async def test_deny_over_limit(self, limiter):
        """Test requests over limit are denied."""
        key = "test:user:2"

        # Use up the limit
        for _ in range(5):
            await limiter.check_rate_limit(key, requests=5, window=60)

        # Next request should be denied
        allowed, remaining, retry_after = await limiter.check_rate_limit(
            key, requests=5, window=60
        )
        assert allowed is False
        assert remaining == 0
        assert retry_after > 0

    @pytest.mark.asyncio
    async def test_separate_keys(self, limiter):
        """Test different keys have separate limits."""
        key1 = "test:user:3"
        key2 = "test:user:4"

        # Use up limit for key1
        for _ in range(5):
            await limiter.check_rate_limit(key1, requests=5, window=60)

        # key2 should still have quota
        allowed, remaining, _ = await limiter.check_rate_limit(
            key2, requests=5, window=60
        )
        assert allowed is True
        assert remaining == 4

    @pytest.mark.asyncio
    async def test_is_allowed(self, limiter):
        """Test is_allowed helper method."""
        key = "test:user:5"

        assert await limiter.is_allowed(key, requests=2, window=60) is True
        assert await limiter.is_allowed(key, requests=2, window=60) is True
        assert await limiter.is_allowed(key, requests=2, window=60) is False

    @pytest.mark.asyncio
    async def test_get_remaining(self, limiter):
        """Test get_remaining returns correct count without consuming."""
        key = "test:user:6"

        # Initial remaining should be full
        assert await limiter.get_remaining(key, window=60) == 5

        # Make 2 requests
        await limiter.check_rate_limit(key, requests=5, window=60)
        await limiter.check_rate_limit(key, requests=5, window=60)

        # Should have 3 remaining
        assert await limiter.get_remaining(key, window=60) == 3

    @pytest.mark.asyncio
    async def test_reset_key(self, limiter):
        """Test resetting a specific key."""
        key = "test:user:7"

        # Use up the limit
        for _ in range(5):
            await limiter.check_rate_limit(key, requests=5, window=60)

        # Verify denied
        allowed, _, _ = await limiter.check_rate_limit(key, requests=5, window=60)
        assert allowed is False

        # Reset the key
        await limiter.reset(key)

        # Should be allowed again
        allowed, _, _ = await limiter.check_rate_limit(key, requests=5, window=60)
        assert allowed is True

    @pytest.mark.asyncio
    async def test_reset_all(self, limiter):
        """Test resetting all keys."""
        keys = ["test:user:8", "test:user:9", "test:user:10"]

        # Use up limits
        for key in keys:
            for _ in range(5):
                await limiter.check_rate_limit(key, requests=5, window=60)

        # Reset all
        await limiter.reset_all()

        # All should be allowed
        for key in keys:
            allowed, _, _ = await limiter.check_rate_limit(key, requests=5, window=60)
            assert allowed is True

    @pytest.mark.asyncio
    async def test_custom_limits(self, limiter):
        """Test setting custom limits per key pattern."""
        limiter.set_custom_limit(":premium", 100, 60)

        requests, window = limiter.get_limit_for_key("user:123:premium")
        assert requests == 100
        assert window == 60

    def test_get_stats(self, limiter):
        """Test getting rate limiter stats."""
        stats = limiter.get_stats()

        assert "total_keys" in stats
        assert "total_tracked_requests" in stats
        assert "custom_limits_count" in stats
        assert "last_cleanup" in stats


# =============================================================================
# Rate Limit Key Extraction Tests
# =============================================================================


class TestGetRateLimitKey:
    """Tests for rate limit key extraction from requests."""

    def _create_mock_request(
        self,
        user_id=None,
        api_key_header=None,
        api_key_query=None,
        client_ip="127.0.0.1",
        forwarded_for=None,
    ):
        """Create a mock request for testing."""
        request = MagicMock(spec=Request)

        # Set up state
        request.state = MagicMock()
        if user_id:
            request.state.user_id = user_id
        else:
            request.state.user_id = None

        # Set up headers
        headers = {}
        if api_key_header:
            headers["X-API-Key"] = api_key_header
        if forwarded_for:
            headers["X-Forwarded-For"] = forwarded_for
        request.headers = Headers(headers)

        # Set up query params
        query_params = {}
        if api_key_query:
            query_params["api_key"] = api_key_query
        request.query_params = query_params

        # Set up client
        request.client = MagicMock()
        request.client.host = client_ip

        return request

    def test_authenticated_user(self):
        """Test key extraction for authenticated user."""
        request = self._create_mock_request(user_id="user_12345")
        key = get_rate_limit_key(request)
        assert key == "user:user_12345"

    def test_api_key_header(self):
        """Test key extraction from X-API-Key header."""
        request = self._create_mock_request(api_key_header="sk_live_abcdefgh12345678")
        key = get_rate_limit_key(request)
        # Code truncates to 16 chars for privacy
        assert key == "apikey:sk_live_abcdefgh"

    def test_api_key_query(self):
        """Test key extraction from query parameter."""
        request = self._create_mock_request(api_key_query="key_xyz12345678")
        key = get_rate_limit_key(request)
        # Key is 15 chars (< 16), so full key is used
        assert key == "apikey:key_xyz12345678"

    def test_ip_address(self):
        """Test key extraction for unauthenticated request."""
        request = self._create_mock_request(client_ip="192.168.1.100")
        key = get_rate_limit_key(request)
        assert key == "ip:192.168.1.100"

    def test_forwarded_for_header(self):
        """Test key extraction with X-Forwarded-For header."""
        request = self._create_mock_request(
            client_ip="10.0.0.1",
            forwarded_for="203.0.113.50, 70.41.3.18, 150.172.238.178",
        )
        key = get_rate_limit_key(request)
        assert key == "ip:203.0.113.50"

    def test_priority_user_over_api_key(self):
        """Test user_id takes priority over API key."""
        request = self._create_mock_request(
            user_id="user_99", api_key_header="sk_test_123"
        )
        key = get_rate_limit_key(request)
        assert key == "user:user_99"

    def test_priority_header_over_query(self):
        """Test header API key takes priority over query."""
        request = self._create_mock_request(
            api_key_header="header_key_12345678", api_key_query="query_key_12345678"
        )
        key = get_rate_limit_key(request)
        # Code truncates to 16 chars for privacy
        assert key == "apikey:header_key_12345"


# =============================================================================
# RateLimitExceeded Exception Tests
# =============================================================================


class TestRateLimitExceeded:
    """Tests for RateLimitExceeded exception."""

    def test_exception_properties(self):
        """Test exception has correct properties."""
        exc = RateLimitExceeded(limit=100, window=60, retry_after=30)

        assert exc.status_code == 429
        assert exc.limit == 100
        assert exc.window == 60
        assert exc.retry_after == 30

    def test_exception_headers(self):
        """Test exception has correct headers."""
        exc = RateLimitExceeded(limit=50, window=60, retry_after=45)

        assert exc.headers["Retry-After"] == "45"
        assert exc.headers["X-RateLimit-Limit"] == "50"
        assert exc.headers["X-RateLimit-Remaining"] == "0"
        assert "X-RateLimit-Reset" in exc.headers

    def test_custom_detail(self):
        """Test exception with custom detail message."""
        exc = RateLimitExceeded(
            limit=10, window=60, retry_after=55, detail="Custom rate limit message"
        )
        assert exc.detail == "Custom rate limit message"

    def test_default_detail(self):
        """Test exception with default detail message."""
        exc = RateLimitExceeded(limit=100, window=60, retry_after=30)
        assert "100 requests per 60 seconds" in exc.detail


# =============================================================================
# RateLimitDependency Tests
# =============================================================================


class TestRateLimitDependency:
    """Tests for RateLimitDependency class."""

    @pytest.mark.asyncio
    async def test_dependency_allows_request(self):
        """Test dependency allows request within limit."""
        # Reset the global limiter for clean test
        rate_limit_module._rate_limiter = RateLimiter()

        dep = RateLimitDependency(requests=10, window=60)

        request = MagicMock(spec=Request)
        request.state = MagicMock()
        request.state.user_id = "dep_test_user"
        request.headers = Headers({})
        request.url = MagicMock()
        request.url.path = "/api/test"

        # Should not raise
        await dep(request)

        # Check state was set
        assert hasattr(request.state, "rate_limit_remaining")

    @pytest.mark.asyncio
    async def test_dependency_denies_request(self):
        """Test dependency denies request over limit."""
        rate_limit_module._rate_limiter = RateLimiter()

        dep = RateLimitDependency(requests=2, window=60)

        request = MagicMock(spec=Request)
        request.state = MagicMock()
        request.state.user_id = "dep_test_user_2"
        request.headers = Headers({})
        request.url = MagicMock()
        request.url.path = "/api/test"

        # First two should pass
        await dep(request)
        await dep(request)

        # Third should fail
        with pytest.raises(RateLimitExceeded):
            await dep(request)


# =============================================================================
# Global Rate Limiter Tests
# =============================================================================


class TestGlobalRateLimiter:
    """Tests for global rate limiter instance."""

    def test_get_rate_limiter_returns_instance(self):
        """Test get_rate_limiter returns a RateLimiter instance."""
        limiter = get_rate_limiter()
        assert isinstance(limiter, RateLimiter)

    def test_get_rate_limiter_singleton(self):
        """Test get_rate_limiter returns same instance."""
        limiter1 = get_rate_limiter()
        limiter2 = get_rate_limiter()
        assert limiter1 is limiter2


# =============================================================================
# Integration Tests
# =============================================================================


class TestRateLimitIntegration:
    """Integration tests for rate limiting with FastAPI."""

    @pytest.fixture
    def app(self):
        """Create a test FastAPI app with rate limiting."""
        rate_limit_module._rate_limiter = RateLimiter()

        app = FastAPI()
        configure_rate_limits(app)

        @app.get("/api/market/test")
        async def test_market():
            return {"status": "ok"}

        @app.get("/api/accounting/test")
        async def test_accounting():
            return {"status": "ok"}

        @app.get("/api/health")
        async def health():
            return {"status": "healthy"}

        return app

    def test_rate_limit_headers_in_response(self, app):
        """Test rate limit headers are included in response."""
        client = TestClient(app)
        response = client.get("/api/market/test")

        assert response.status_code == 200
        assert "X-RateLimit-Limit" in response.headers
        assert "X-RateLimit-Remaining" in response.headers
        assert "X-RateLimit-Reset" in response.headers
        assert "X-RateLimit-Category" in response.headers
        assert response.headers["X-RateLimit-Category"] == "market_data"

    def test_health_endpoint_excluded(self, app):
        """Test health endpoint is excluded from rate limiting."""
        client = TestClient(app)

        # Make many requests - should not be rate limited
        for _ in range(200):
            response = client.get("/api/health")
            assert response.status_code == 200

    def test_different_limits_per_category(self, app):
        """Test different endpoints have different limits."""
        client = TestClient(app)

        # Check market (100/min)
        response = client.get("/api/market/test")
        assert response.headers["X-RateLimit-Limit"] == "100"

        # Check accounting (10/min)
        response = client.get("/api/accounting/test")
        assert response.headers["X-RateLimit-Limit"] == "10"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
