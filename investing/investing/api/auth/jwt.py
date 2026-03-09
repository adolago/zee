"""
Investing JWT Authentication Module

Provides JWT token creation, validation, refresh, and revocation for secure API access.
Uses PyJWT for JWT encoding/decoding with HS256 algorithm by default.

Token Types:
- Access Token: Short-lived (15 min default), contains user identity and roles
- Refresh Token: Long-lived (7 days default), used to obtain new access tokens

Security Features:
- Token blacklisting for immediate revocation
- JTI (JWT ID) for unique token identification
- Configurable expiration times via environment variables
"""

import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Dict, List, Optional, Set

try:
    import jwt
    from jwt.exceptions import ExpiredSignatureError, PyJWTError as JWTError
except ImportError as e:
    raise ImportError(
        "PyJWT is required for Investing authentication. "
        "Install with: pip install PyJWT"
    ) from e


def _get_jwt_module():
    """Get the JWT module."""
    return jwt


from pydantic import BaseModel, ConfigDict, Field, field_serializer

logger = logging.getLogger(__name__)


# =============================================================================
# Custom Exceptions
# =============================================================================


class TokenError(Exception):
    """Base exception for all token-related errors."""

    def __init__(
        self,
        message: str,
        code: str = "TOKEN_ERROR",
        detail: Optional[str] = None,
    ):
        self.message = message
        self.code = code
        self.detail = detail
        super().__init__(self.message)

    def to_dict(self) -> Dict[str, Any]:
        """Convert exception to dictionary for API responses."""
        return {
            "code": self.code,
            "message": self.message,
            "detail": self.detail,
        }


class TokenExpiredError(TokenError):
    """Raised when a token has expired."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            message="Token has expired",
            code="TOKEN_EXPIRED",
            detail=detail or "Please refresh your token or log in again.",
        )


class TokenInvalidError(TokenError):
    """Raised when a token is malformed or has an invalid signature."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            message="Token is invalid",
            code="TOKEN_INVALID",
            detail=detail or "The provided token could not be validated.",
        )


class TokenRevokedError(TokenError):
    """Raised when a token has been revoked."""

    def __init__(self, detail: Optional[str] = None):
        super().__init__(
            message="Token has been revoked",
            code="TOKEN_REVOKED",
            detail=detail or "This token is no longer valid. Please log in again.",
        )


# =============================================================================
# Configuration
# =============================================================================


@dataclass
class JWTSettings:
    """
    JWT configuration settings.

    Tries to load from AuthSettings first (unified config), falling back to
    environment variables for backwards compatibility.
    """

    secret_key: str = field(default="")
    algorithm: str = field(default="HS256")
    access_token_expire_minutes: int = field(default=15)
    refresh_token_expire_days: int = field(default=7)
    issuer: str = field(default="investing-api")
    audience: str = field(default="investing-client")

    def __post_init__(self):
        """Load settings from AuthSettings or environment with validation."""
        # Try to get settings from the unified AuthSettings first
        try:
            from investing.api.auth.config import get_auth_settings

            auth_settings = get_auth_settings()
            self.secret_key = auth_settings.JWT_SECRET_KEY
            self.algorithm = auth_settings.JWT_ALGORITHM
            self.access_token_expire_minutes = auth_settings.ACCESS_TOKEN_EXPIRE_MINUTES
            self.refresh_token_expire_days = auth_settings.REFRESH_TOKEN_EXPIRE_DAYS
            logger.debug("JWT settings loaded from AuthSettings")
            return
        except Exception as e:
            logger.debug(f"Could not load AuthSettings ({e}), falling back to env vars")

        # Fallback to direct environment variables
        self.secret_key = os.getenv(
            "ZEE_INVESTING_AUTH_JWT_SECRET_KEY",
            os.getenv("JWT_SECRET_KEY", ""),
        )
        self.algorithm = os.getenv("JWT_ALGORITHM", "HS256")
        self.access_token_expire_minutes = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
        )
        self.refresh_token_expire_days = int(
            os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7")
        )
        self.issuer = os.getenv("JWT_ISSUER", "investing-api")
        self.audience = os.getenv("JWT_AUDIENCE", "investing-client")

        # Validate
        if not self.secret_key:
            raise ValueError(
                "JWT secret key not configured. Set ZEE_INVESTING_AUTH_JWT_SECRET_KEY "
                "environment variable (minimum 32 characters recommended)."
            )

        if len(self.secret_key) < 32:
            raise ValueError(
                "JWT secret key must be at least 32 characters long for security. "
                f"Got {len(self.secret_key)} characters. Please generate a secure key."
            )

        if self.access_token_expire_minutes <= 0:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be positive")

        if self.refresh_token_expire_days <= 0:
            raise ValueError("REFRESH_TOKEN_EXPIRE_DAYS must be positive")


@lru_cache(maxsize=1)
def get_jwt_settings() -> JWTSettings:
    """
    Get JWT settings singleton.

    Uses LRU cache to ensure settings are only loaded once.
    Call get_jwt_settings.cache_clear() to reload settings.
    """
    return JWTSettings()


# =============================================================================
# Token Blacklist
# =============================================================================


class TokenBlacklist:
    """
    In-memory token blacklist for revoked tokens.

    NOTE: This is suitable for development and single-instance deployments.
    For production with multiple instances, replace with Redis-backed storage.
    """

    def __init__(self):
        self._revoked_jtis: Set[str] = set()
        self._revocation_times: Dict[str, datetime] = {}

    def add(self, jti: str) -> None:
        """Add a token JTI to the blacklist."""
        self._revoked_jtis.add(jti)
        self._revocation_times[jti] = datetime.now(timezone.utc)
        logger.info(f"Token revoked: {jti[:8]}...")

    def is_revoked(self, jti: str) -> bool:
        """Check if a token JTI is in the blacklist."""
        return jti in self._revoked_jtis

    def cleanup_expired(self, max_age_days: int = 8) -> int:
        """
        Remove old entries from the blacklist.

        Args:
            max_age_days: Maximum age of entries to keep (should be > refresh token lifetime)

        Returns:
            Number of entries removed
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        expired = [
            jti
            for jti, revoked_at in self._revocation_times.items()
            if revoked_at < cutoff
        ]

        for jti in expired:
            self._revoked_jtis.discard(jti)
            del self._revocation_times[jti]

        if expired:
            logger.info(f"Cleaned up {len(expired)} expired blacklist entries")

        return len(expired)

    def size(self) -> int:
        """Return the number of revoked tokens in the blacklist."""
        return len(self._revoked_jtis)


# Global blacklist instance
_token_blacklist = TokenBlacklist()


# =============================================================================
# Pydantic Models
# =============================================================================


class TokenPayload(BaseModel):
    """Decoded JWT token payload."""

    model_config = ConfigDict(ser_json_timedelta="iso8601")

    user_id: str = Field(..., description="Unique user identifier")
    email: Optional[str] = Field(None, description="User email address")
    roles: List[str] = Field(default_factory=list, description="User roles")
    exp: datetime = Field(..., description="Token expiration timestamp")
    iat: datetime = Field(..., description="Token issued at timestamp")
    jti: str = Field(..., description="JWT unique identifier")
    token_type: str = Field(..., description="Token type (access or refresh)")
    iss: Optional[str] = Field(None, description="Token issuer")
    aud: Optional[str] = Field(None, description="Token audience")

    @field_serializer("exp", "iat")
    def serialize_datetime(self, v: datetime) -> str:
        return v.isoformat()


class TokenPair(BaseModel):
    """Access and refresh token pair returned after authentication."""

    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(..., description="JWT refresh token")
    token_type: str = Field(default="bearer", description="Token type")
    expires_in: int = Field(..., description="Access token lifetime in seconds")
    refresh_expires_in: int = Field(
        ..., description="Refresh token lifetime in seconds"
    )


# =============================================================================
# Token Creation Functions
# =============================================================================


def create_access_token(
    user_id: str,
    email: Optional[str] = None,
    roles: Optional[List[str]] = None,
    additional_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Create a JWT access token.

    Args:
        user_id: Unique identifier for the user
        email: User's email address
        roles: List of user roles for authorization
        additional_claims: Optional additional claims to include in the token

    Returns:
        Encoded JWT access token string

    Raises:
        TokenError: If token creation fails
    """
    settings = get_jwt_settings()

    try:
        now = datetime.now(timezone.utc)
        expire = now + timedelta(minutes=settings.access_token_expire_minutes)
        jti = str(uuid.uuid4())

        payload = {
            "user_id": user_id,
            "email": email,
            "roles": roles or [],
            "exp": expire,
            "iat": now,
            "jti": jti,
            "token_type": "access",
            "iss": settings.issuer,
            "aud": settings.audience,
        }

        if additional_claims:
            # Prevent overwriting core claims
            protected_claims = {"user_id", "exp", "iat", "jti", "token_type"}
            for key in additional_claims:
                if key not in protected_claims:
                    payload[key] = additional_claims[key]

        token = _get_jwt_module().encode(
            payload, settings.secret_key, algorithm=settings.algorithm
        )

        logger.debug(
            f"Created access token for user {user_id}, expires at {expire.isoformat()}"
        )

        return token

    except Exception as e:
        logger.error(f"Failed to create access token: {e}")
        raise TokenError(
            message="Failed to create access token",
            code="TOKEN_CREATION_FAILED",
            detail=str(e),
        )


def create_refresh_token(
    user_id: str,
    additional_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Create a JWT refresh token.

    Refresh tokens have a longer lifetime and are used to obtain new access tokens.
    They contain minimal claims for security.

    Args:
        user_id: Unique identifier for the user
        additional_claims: Optional additional claims to include in the token

    Returns:
        Encoded JWT refresh token string

    Raises:
        TokenError: If token creation fails
    """
    settings = get_jwt_settings()

    try:
        now = datetime.now(timezone.utc)
        expire = now + timedelta(days=settings.refresh_token_expire_days)
        jti = str(uuid.uuid4())

        payload = {
            "user_id": user_id,
            "exp": expire,
            "iat": now,
            "jti": jti,
            "token_type": "refresh",
            "iss": settings.issuer,
            "aud": settings.audience,
        }

        if additional_claims:
            protected_claims = {"user_id", "exp", "iat", "jti", "token_type"}
            for key in additional_claims:
                if key not in protected_claims:
                    payload[key] = additional_claims[key]

        token = _get_jwt_module().encode(
            payload, settings.secret_key, algorithm=settings.algorithm
        )

        logger.debug(
            f"Created refresh token for user {user_id}, expires at {expire.isoformat()}"
        )

        return token

    except Exception as e:
        logger.error(f"Failed to create refresh token: {e}")
        raise TokenError(
            message="Failed to create refresh token",
            code="TOKEN_CREATION_FAILED",
            detail=str(e),
        )


# =============================================================================
# Token Validation Functions
# =============================================================================


def decode_token(
    token: str,
    verify_exp: bool = True,
    expected_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Decode and validate a JWT token.

    Args:
        token: The JWT token string to decode
        verify_exp: Whether to verify token expiration
        expected_type: Expected token type ("access" or "refresh")

    Returns:
        Dictionary containing the decoded token payload

    Raises:
        TokenExpiredError: If the token has expired
        TokenRevokedError: If the token has been revoked
        TokenInvalidError: If the token is malformed or has invalid signature
    """
    settings = get_jwt_settings()

    try:
        payload = _get_jwt_module().decode(
            token,
            settings.secret_key,
            algorithms=[settings.algorithm],
            options={"verify_exp": verify_exp},
            audience=settings.audience,
            issuer=settings.issuer,
        )

        # Check if token is revoked
        jti = payload.get("jti")
        if jti and is_token_revoked(jti):
            raise TokenRevokedError()

        # Verify token type if specified
        token_type = payload.get("token_type")
        if expected_type and token_type != expected_type:
            raise TokenInvalidError(
                detail=f"Expected {expected_type} token, got {token_type}"
            )

        return payload

    except ExpiredSignatureError:
        logger.debug("Token has expired")
        raise TokenExpiredError()

    except TokenRevokedError:
        raise

    except TokenInvalidError:
        raise

    except JWTError as e:
        logger.warning(f"JWT validation failed: {e}")
        raise TokenInvalidError(detail=str(e))

    except Exception as e:
        logger.error(f"Unexpected error decoding token: {e}")
        raise TokenInvalidError(detail="Token validation failed")


# =============================================================================
# Token Refresh Functions
# =============================================================================


def refresh_access_token(
    refresh_token: str,
    email: Optional[str] = None,
    roles: Optional[List[str]] = None,
) -> tuple[str, str]:
    """
    Refresh an access token using a valid refresh token.

    This function validates the refresh token, revokes it (rotation),
    and issues a new token pair.

    Args:
        refresh_token: The refresh token to use
        email: User's email to include in new access token
        roles: User's roles to include in new access token

    Returns:
        Tuple of (new_access_token, new_refresh_token)

    Raises:
        TokenExpiredError: If the refresh token has expired
        TokenRevokedError: If the refresh token has been revoked
        TokenInvalidError: If the refresh token is invalid
    """
    # Decode and validate the refresh token
    payload = decode_token(refresh_token, expected_type="refresh")

    user_id = payload.get("user_id")
    if not user_id:
        raise TokenInvalidError(detail="Refresh token missing user_id claim")

    # Revoke the old refresh token (token rotation for security)
    old_jti = payload.get("jti")
    if old_jti:
        revoke_token(old_jti)

    # Create new token pair
    new_access_token = create_access_token(
        user_id=user_id,
        email=email,
        roles=roles,
    )
    new_refresh_token = create_refresh_token(user_id=user_id)

    logger.info(f"Refreshed tokens for user {user_id}")

    return new_access_token, new_refresh_token


# =============================================================================
# Token Revocation Functions
# =============================================================================


def revoke_token(jti: str) -> None:
    """
    Revoke a token by adding its JTI to the blacklist.

    Args:
        jti: The unique JWT identifier to revoke
    """
    _token_blacklist.add(jti)


def is_token_revoked(jti: str) -> bool:
    """
    Check if a token has been revoked.

    Args:
        jti: The unique JWT identifier to check

    Returns:
        True if the token is revoked, False otherwise
    """
    return _token_blacklist.is_revoked(jti)


def revoke_all_user_tokens(user_id: str, token: str) -> None:
    """
    Revoke the current token for a user.

    Note: For full user token revocation, implement a user-to-tokens mapping
    or use short-lived tokens with a user-version claim.

    Args:
        user_id: The user whose token to revoke
        token: The current token to revoke
    """
    try:
        payload = decode_token(token, verify_exp=False)
        jti = payload.get("jti")
        if jti:
            revoke_token(jti)
            logger.info(f"Revoked token for user {user_id}")
    except TokenError:
        pass  # Token already invalid


def cleanup_blacklist(max_age_days: int = 8) -> int:
    """
    Clean up expired entries from the token blacklist.

    Should be called periodically (e.g., via a scheduled task).

    Args:
        max_age_days: Maximum age of entries to keep

    Returns:
        Number of entries removed
    """
    return _token_blacklist.cleanup_expired(max_age_days)


def get_blacklist_size() -> int:
    """Get the current size of the token blacklist."""
    return _token_blacklist.size()


# =============================================================================
# Utility Functions
# =============================================================================


def create_token_pair(
    user_id: str,
    email: Optional[str] = None,
    roles: Optional[List[str]] = None,
) -> TokenPair:
    """
    Create a complete token pair for user authentication.

    Args:
        user_id: Unique identifier for the user
        email: User's email address
        roles: List of user roles

    Returns:
        TokenPair containing access and refresh tokens
    """
    settings = get_jwt_settings()

    access_token = create_access_token(user_id, email, roles)
    refresh_token = create_refresh_token(user_id)

    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
        refresh_expires_in=settings.refresh_token_expire_days * 24 * 60 * 60,
    )


def get_token_payload(token: str) -> TokenPayload:
    """
    Decode a token and return a validated TokenPayload model.

    Args:
        token: The JWT token to decode

    Returns:
        TokenPayload model with validated claims
    """
    payload = decode_token(token)
    return TokenPayload(**payload)


def extract_jti_from_token(token: str) -> Optional[str]:
    """
    Extract the JTI from a token without full validation.

    Useful for logging or blacklist operations when the token may be expired.

    Args:
        token: The JWT token

    Returns:
        The JTI if present, None otherwise
    """
    try:
        payload = decode_token(token, verify_exp=False)
        return payload.get("jti")
    except TokenError:
        return None
