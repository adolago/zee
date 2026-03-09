"""
Investing API Authentication Dependencies

FastAPI dependency injection for JWT and API key authentication with RBAC.

This module provides:
- JWT token validation via Authorization: Bearer <token>
- API key validation via X-API-Key header
- Role-based access control with customizable permissions
- Optional authentication for public endpoints

Example usage:
    @app.get("/api/portfolio")
    async def get_portfolio(user: User = Depends(get_current_user)):
        ...

    @app.post("/api/admin/users")
    async def create_user(user: User = Depends(require_roles(Role.ADMIN))):
        ...
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader, OAuth2PasswordBearer

from investing.api.auth.jwt import (
    decode_token,
    TokenExpiredError,
    TokenInvalidError,
    TokenRevokedError,
)
from investing.api.auth.api_keys import (
    get_api_key_manager,
    APIKeyScope,
    hash_api_key,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Role Definitions
# =============================================================================


class Role(str, Enum):
    """
    User roles for role-based access control.

    Roles are hierarchical in permissions:
    - VIEWER: Read-only access to public data
    - ANALYST: Read access to all analytics and research
    - TRADER: Analyst permissions + trading signals and portfolio management
    - PORTFOLIO_MANAGER: Trader permissions + team management
    - ADMIN: Full system access including user management
    - SUPER_ADMIN: Unrestricted access, system configuration
    """

    VIEWER = "viewer"
    ANALYST = "analyst"
    TRADER = "trader"
    PORTFOLIO_MANAGER = "portfolio_manager"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"


# Role hierarchy for permission checking
ROLE_HIERARCHY: dict[Role, int] = {
    Role.VIEWER: 1,
    Role.ANALYST: 2,
    Role.TRADER: 3,
    Role.PORTFOLIO_MANAGER: 4,
    Role.ADMIN: 5,
    Role.SUPER_ADMIN: 6,
}


# =============================================================================
# User Model
# =============================================================================


@dataclass
class User:
    """
    Authenticated user representation.

    This dataclass represents a user extracted from either JWT or API key
    authentication. It contains the essential user information needed for
    authorization decisions.

    Attributes:
        id: Unique user identifier (UUID string)
        email: User's email address
        roles: List of roles assigned to the user
        is_active: Whether the user account is active
        api_key_id: ID of the API key used for auth (None if JWT auth)
        name: Optional display name
        metadata: Additional user metadata
    """

    id: str
    email: str
    roles: List[Role]
    is_active: bool = True
    api_key_id: Optional[str] = None
    name: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    def has_role(self, role: Role) -> bool:
        """Check if user has a specific role."""
        return role in self.roles

    def has_any_role(self, roles: List[Role]) -> bool:
        """Check if user has any of the specified roles."""
        return any(role in self.roles for role in roles)

    def has_permission_level(self, required_role: Role) -> bool:
        """
        Check if user has at least the permission level of the required role.

        Uses role hierarchy to determine if user's highest role meets or
        exceeds the required permission level.
        """
        if not self.roles:
            return False

        required_level = ROLE_HIERARCHY.get(required_role, 0)
        user_max_level = max(ROLE_HIERARCHY.get(role, 0) for role in self.roles)
        return user_max_level >= required_level

    @property
    def is_admin(self) -> bool:
        """Check if user has admin privileges."""
        return self.has_any_role([Role.ADMIN, Role.SUPER_ADMIN])

    @property
    def highest_role(self) -> Optional[Role]:
        """Get the user's highest-level role."""
        if not self.roles:
            return None
        return max(self.roles, key=lambda r: ROLE_HIERARCHY.get(r, 0))


# =============================================================================
# Security Schemes
# =============================================================================

# OAuth2 password bearer for JWT tokens - used by Swagger UI
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/auth/token",
    scheme_name="JWT",
    description="JWT Bearer token authentication",
    auto_error=False,  # Don't auto-error, we handle it manually for multi-auth
)

# API Key header scheme
api_key_header = APIKeyHeader(
    name="X-API-Key",
    scheme_name="API Key",
    description="API key authentication",
    auto_error=False,  # Don't auto-error, we handle it manually for multi-auth
)


# =============================================================================
# Scope to Role Mapping
# =============================================================================

# Map API key scopes to user roles
SCOPE_TO_ROLES: Dict[APIKeyScope, List[Role]] = {
    APIKeyScope.READ: [Role.VIEWER],
    APIKeyScope.WRITE: [Role.ANALYST],
    APIKeyScope.TRADE: [Role.TRADER],
    APIKeyScope.ADMIN: [Role.ADMIN],
}


def _scopes_to_roles(scopes: List[APIKeyScope]) -> List[Role]:
    """
    Convert API key scopes to user roles.

    Args:
        scopes: List of API key scopes

    Returns:
        List of equivalent roles based on highest scope
    """
    roles: List[Role] = []
    for scope in scopes:
        scope_roles = SCOPE_TO_ROLES.get(scope, [])
        for role in scope_roles:
            if role not in roles:
                roles.append(role)

    # If no roles mapped, default to viewer
    if not roles:
        roles = [Role.VIEWER]

    return roles


# =============================================================================
# Token and API Key Validation
# =============================================================================


async def _validate_jwt_token(token: str) -> Optional[User]:
    """
    Validate a JWT token and extract user information.

    Uses the jwt module to decode and validate the token.

    Args:
        token: The JWT token string

    Returns:
        User object if token is valid, None otherwise

    Raises:
        HTTPException: If token is malformed or expired
    """
    try:
        # Decode and validate the JWT token
        payload = decode_token(token, expected_type="access")

        user_id = payload.get("user_id")
        email = payload.get("email")
        roles_str = payload.get("roles", [])

        if not user_id:
            logger.warning("JWT token missing user_id claim")
            return None

        # Convert role strings to Role enums, filtering invalid roles
        roles: List[Role] = []
        for role_str in roles_str:
            try:
                role = Role(role_str)
                roles.append(role)
            except ValueError:
                logger.debug(f"Unknown role in JWT: {role_str}")

        # Default to viewer if no valid roles
        if not roles:
            roles = [Role.VIEWER]

        return User(
            id=user_id,
            email=email or "",
            roles=roles,
            is_active=True,  # If token is valid, user is considered active
            name=payload.get("name"),
            metadata={
                "jti": payload.get("jti"),
                "iat": payload.get("iat"),
                "exp": payload.get("exp"),
            },
        )

    except TokenExpiredError:
        logger.debug("JWT token has expired")
        return None

    except TokenRevokedError:
        logger.debug("JWT token has been revoked")
        return None

    except TokenInvalidError as e:
        logger.warning(f"JWT token is invalid: {e}")
        return None

    except Exception as e:
        logger.warning(f"JWT validation failed: {e}")
        return None


async def _validate_api_key(api_key: str) -> Optional[User]:
    """
    Validate an API key and retrieve associated user information.

    Uses the api_keys module to verify and look up the key.

    Args:
        api_key: The API key string

    Returns:
        User object if API key is valid, None otherwise
    """
    try:
        manager = get_api_key_manager()

        # Verify and get the API key record
        api_key_record = manager.verify_and_get_key(api_key)

        if not api_key_record:
            logger.debug("API key not found or invalid")
            return None

        if not api_key_record.is_valid():
            logger.debug(
                f"API key {api_key_record.id} is not valid "
                f"(active={api_key_record.is_active}, expired={api_key_record.is_expired()})"
            )
            return None

        # Update last used timestamp
        key_hash = hash_api_key(api_key)
        manager.update_last_used(key_hash)

        # Convert API key scopes to user roles
        roles = _scopes_to_roles(api_key_record.scopes)

        return User(
            id=api_key_record.user_id,
            email="",  # API keys don't store email directly
            roles=roles,
            is_active=True,
            api_key_id=api_key_record.id,
            name=api_key_record.name,
            metadata={
                "api_key_name": api_key_record.name,
                "scopes": [s.value for s in api_key_record.scopes],
                "request_count": api_key_record.request_count,
            },
        )

    except Exception as e:
        logger.warning(f"API key validation failed: {e}")
        return None


# =============================================================================
# Authentication Dependencies
# =============================================================================


async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    api_key: Optional[str] = Depends(api_key_header),
) -> User:
    """
    Extract and validate user from JWT or API key.

    This dependency checks for authentication in the following order:
    1. Authorization header with Bearer token (JWT)
    2. X-API-Key header (API key)

    Args:
        request: The FastAPI request object
        token: JWT token from Authorization header (via oauth2_scheme)
        api_key: API key from X-API-Key header (via api_key_header)

    Returns:
        Authenticated User object

    Raises:
        HTTPException 401: If no valid authentication is provided
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Try JWT authentication first
    if token:
        user = await _validate_jwt_token(token)
        if user:
            logger.debug(f"User {user.id} authenticated via JWT")
            return user

    # Fall back to API key authentication
    if api_key:
        user = await _validate_api_key(api_key)
        if user:
            logger.debug(f"User {user.id} authenticated via API key")
            return user

    # No valid authentication found
    logger.warning(f"Authentication failed for request to {request.url.path}")
    raise credentials_exception


async def get_current_active_user(
    user: User = Depends(get_current_user),
) -> User:
    """
    Ensure the authenticated user is active.

    This dependency builds on get_current_user and adds an active status check.
    Use this when you need to ensure the user account has not been deactivated.

    Args:
        user: The authenticated user from get_current_user

    Returns:
        Active User object

    Raises:
        HTTPException 401: If user account is inactive
    """
    if not user.is_active:
        logger.warning(f"Inactive user {user.id} attempted access")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_optional_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    api_key: Optional[str] = Depends(api_key_header),
) -> Optional[User]:
    """
    Return user if authenticated, None otherwise.

    This dependency is for public endpoints that can optionally use
    authentication to provide enhanced functionality or personalization.

    Args:
        request: The FastAPI request object
        token: JWT token from Authorization header (optional)
        api_key: API key from X-API-Key header (optional)

    Returns:
        User object if authenticated, None if no valid auth provided
    """
    # No credentials provided
    if not token and not api_key:
        return None

    # Try JWT authentication
    if token:
        user = await _validate_jwt_token(token)
        if user:
            return user

    # Try API key authentication
    if api_key:
        user = await _validate_api_key(api_key)
        if user:
            return user

    # Invalid credentials provided but not required
    return None


async def require_auth(
    user: User = Depends(get_current_active_user),
) -> User:
    """
    Simple authentication check dependency.

    Alias for get_current_active_user for semantic clarity.
    Use this when you just need to ensure the user is authenticated
    and active, without any role requirements.

    Args:
        user: The authenticated active user

    Returns:
        Authenticated active User object
    """
    return user


# =============================================================================
# Role-Based Access Control Dependencies
# =============================================================================


def require_roles(*roles: Role) -> Callable:
    """
    Create a dependency that requires user to have one of the specified roles.

    This is a dependency factory that returns a dependency function.
    The user must have at least one of the specified roles to pass.

    Args:
        *roles: Variable number of Role enum values

    Returns:
        Dependency function that validates roles

    Example:
        @app.post("/api/admin/users")
        async def create_user(user: User = Depends(require_roles(Role.ADMIN))):
            ...

        @app.get("/api/research")
        async def get_research(
            user: User = Depends(require_roles(Role.ANALYST, Role.TRADER))
        ):
            ...
    """
    allowed_roles = list(roles)

    async def role_checker(
        user: User = Depends(get_current_active_user),
    ) -> User:
        """Check if user has any of the required roles."""
        if not user.has_any_role(allowed_roles):
            logger.warning(
                f"User {user.id} with roles {user.roles} denied access "
                f"(required: {allowed_roles})"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {[r.value for r in allowed_roles]}",
            )
        return user

    return role_checker


def require_permission_level(minimum_role: Role) -> Callable:
    """
    Create a dependency that requires minimum permission level.

    Unlike require_roles which requires exact role match, this uses
    the role hierarchy to check if user's highest role meets or
    exceeds the required level.

    Args:
        minimum_role: Minimum required role level

    Returns:
        Dependency function that validates permission level

    Example:
        @app.get("/api/trading/signals")
        async def get_signals(
            user: User = Depends(require_permission_level(Role.TRADER))
        ):
            # TRADER, PORTFOLIO_MANAGER, ADMIN, and SUPER_ADMIN can access
            ...
    """

    async def permission_checker(
        user: User = Depends(get_current_active_user),
    ) -> User:
        """Check if user has minimum permission level."""
        if not user.has_permission_level(minimum_role):
            user_level = user.highest_role.value if user.highest_role else "none"
            logger.warning(
                f"User {user.id} with level {user_level} denied access "
                f"(required minimum: {minimum_role.value})"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permission level. Minimum required: {minimum_role.value}",
            )
        return user

    return permission_checker


def require_admin(
    user: User = Depends(get_current_active_user),
) -> User:
    """
    Shorthand dependency for requiring admin privileges.

    Equivalent to require_roles(Role.ADMIN, Role.SUPER_ADMIN).

    Args:
        user: The authenticated active user

    Returns:
        User with admin privileges

    Raises:
        HTTPException 403: If user is not an admin
    """
    if not user.is_admin:
        logger.warning(f"Non-admin user {user.id} attempted admin action")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return user


def require_super_admin(
    user: User = Depends(get_current_active_user),
) -> User:
    """
    Dependency for requiring super admin privileges.

    Use this for system configuration and other critical operations.

    Args:
        user: The authenticated active user

    Returns:
        User with super admin privileges

    Raises:
        HTTPException 403: If user is not a super admin
    """
    if not user.has_role(Role.SUPER_ADMIN):
        logger.warning(
            f"User {user.id} attempted super admin action without privileges"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super administrator privileges required",
        )
    return user


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Models
    "User",
    "Role",
    "ROLE_HIERARCHY",
    # Security schemes
    "oauth2_scheme",
    "api_key_header",
    # Core auth dependencies
    "get_current_user",
    "get_current_active_user",
    "get_optional_user",
    "require_auth",
    # Role-based dependencies
    "require_roles",
    "require_permission_level",
    "require_admin",
    "require_super_admin",
]
