"""
Stanley API Security Configuration

Configuration settings for authentication, authorization, and rate limiting
using pydantic-settings for environment variable management.
"""

import secrets
from functools import lru_cache
from typing import List, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthSettings(BaseSettings):
    """
    Authentication and security configuration settings.

    All sensitive values are loaded from environment variables.
    The JWT_SECRET_KEY must be at least 32 characters for security.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="STANLEY_AUTH_",
        case_sensitive=False,
        extra="ignore",
    )

    # JWT Configuration
    JWT_SECRET_KEY: str = Field(
        default_factory=lambda: secrets.token_urlsafe(32),
        description="Secret key for JWT token signing. Must be at least 32 characters. "
        "Auto-generated if not provided (for development/testing only).",
        min_length=32,
    )
    JWT_ALGORITHM: str = Field(
        default="HS256",
        description="Algorithm used for JWT token signing.",
    )
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(
        default=15,
        ge=1,
        le=60,
        description="Access token expiration time in minutes.",
    )
    REFRESH_TOKEN_EXPIRE_DAYS: int = Field(
        default=7,
        ge=1,
        le=30,
        description="Refresh token expiration time in days.",
    )

    # API Key Configuration
    API_KEY_PREFIX: str = Field(
        default="sk",
        min_length=2,
        max_length=10,
        description="Prefix for generated API keys.",
    )

    # Password Policy
    PASSWORD_MIN_LENGTH: int = Field(
        default=8,
        ge=8,
        le=128,
        description="Minimum password length.",
    )
    PASSWORD_REQUIRE_SPECIAL: bool = Field(
        default=True,
        description="Require special characters in passwords.",
    )
    BCRYPT_ROUNDS: int = Field(
        default=12,
        ge=10,
        le=15,
        description="Number of bcrypt hashing rounds.",
    )

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = Field(
        default=True,
        description="Enable rate limiting.",
    )

    # CORS Configuration
    CORS_ORIGINS: List[str] = Field(
        default=["http://localhost:3000"],
        description="Allowed CORS origins.",
    )

    # Cookie Configuration
    COOKIE_SECURE: bool = Field(
        default=True,
        description="Use secure cookies (HTTPS only). Set to False for local development.",
    )
    COOKIE_HTTPONLY: bool = Field(
        default=True,
        description="HttpOnly flag for cookies to prevent XSS.",
    )
    COOKIE_SAMESITE: Literal["strict", "lax", "none"] = Field(
        default="lax",
        description="SameSite attribute for cookies.",
    )

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_jwt_secret_key(cls, v: str) -> str:
        """Validate that JWT_SECRET_KEY is at least 32 characters."""
        if len(v) < 32:
            raise ValueError(
                "JWT_SECRET_KEY must be at least 32 characters long for security. "
                f"Got {len(v)} characters. Generate a secure key with: "
                'python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )
        return v

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        """Parse CORS origins from comma-separated string or list."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    def generate_api_key(self) -> str:
        """Generate a new API key with the configured prefix."""
        random_part = secrets.token_urlsafe(32)
        return f"{self.API_KEY_PREFIX}_{random_part}"


class RateLimitSettings(BaseSettings):
    """
    Rate limiting configuration for different endpoint categories.

    Each category has a limit (max requests) and window (time period in seconds).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="STANLEY_RATE_",
        case_sensitive=False,
        extra="ignore",
    )

    # Market Data Endpoints (high frequency allowed)
    MARKET_DATA_LIMIT: int = Field(
        default=100,
        ge=10,
        le=1000,
        description="Max requests per window for market data endpoints.",
    )
    MARKET_DATA_WINDOW: int = Field(
        default=60,
        ge=10,
        le=3600,
        description="Time window in seconds for market data rate limit.",
    )

    # Analytics Endpoints (moderate frequency)
    ANALYTICS_LIMIT: int = Field(
        default=30,
        ge=5,
        le=200,
        description="Max requests per window for analytics endpoints.",
    )
    ANALYTICS_WINDOW: int = Field(
        default=60,
        ge=10,
        le=3600,
        description="Time window in seconds for analytics rate limit.",
    )

    # Research Endpoints (lower frequency due to complexity)
    RESEARCH_LIMIT: int = Field(
        default=20,
        ge=5,
        le=100,
        description="Max requests per window for research endpoints.",
    )
    RESEARCH_WINDOW: int = Field(
        default=60,
        ge=10,
        le=3600,
        description="Time window in seconds for research rate limit.",
    )

    # Accounting Endpoints (SEC courtesy - lowest frequency)
    ACCOUNTING_LIMIT: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Max requests per window for accounting/SEC endpoints.",
    )
    ACCOUNTING_WINDOW: int = Field(
        default=60,
        ge=10,
        le=3600,
        description="Time window in seconds for accounting rate limit.",
    )

    # Default Rate Limit (for unlisted endpoints)
    DEFAULT_LIMIT: int = Field(
        default=60,
        ge=10,
        le=500,
        description="Default max requests per window for unlisted endpoints.",
    )
    DEFAULT_WINDOW: int = Field(
        default=60,
        ge=10,
        le=3600,
        description="Default time window in seconds for rate limit.",
    )

    def get_limit_for_category(self, category: str) -> tuple[int, int]:
        """
        Get rate limit and window for a specific category.

        Args:
            category: One of 'market_data', 'analytics', 'research', 'accounting', or 'default'

        Returns:
            Tuple of (limit, window_seconds)
        """
        category_map = {
            "market_data": (self.MARKET_DATA_LIMIT, self.MARKET_DATA_WINDOW),
            "analytics": (self.ANALYTICS_LIMIT, self.ANALYTICS_WINDOW),
            "research": (self.RESEARCH_LIMIT, self.RESEARCH_WINDOW),
            "accounting": (self.ACCOUNTING_LIMIT, self.ACCOUNTING_WINDOW),
            "default": (self.DEFAULT_LIMIT, self.DEFAULT_WINDOW),
        }
        return category_map.get(
            category.lower(), (self.DEFAULT_LIMIT, self.DEFAULT_WINDOW)
        )


@lru_cache()
def get_auth_settings() -> AuthSettings:
    """
    Get cached authentication settings instance.

    Uses lru_cache to ensure settings are loaded only once
    and reused throughout the application lifecycle.

    Returns:
        AuthSettings instance with values from environment.

    Raises:
        ValidationError: If required settings are missing or invalid.
    """
    return AuthSettings()


@lru_cache()
def get_rate_limit_settings() -> RateLimitSettings:
    """
    Get cached rate limit settings instance.

    Uses lru_cache to ensure settings are loaded only once
    and reused throughout the application lifecycle.

    Returns:
        RateLimitSettings instance with values from environment.
    """
    return RateLimitSettings()


def clear_settings_cache() -> None:
    """
    Clear the settings cache.

    Useful for testing or when environment variables change.
    """
    get_auth_settings.cache_clear()
    get_rate_limit_settings.cache_clear()
