"""
Investing Role-Based Access Control (RBAC)

Provides fine-grained permission control for Investing's 80+ API endpoints.
Supports extensible custom roles for future expansion.

Roles hierarchy:
    1. admin - Full access to everything
    2. analyst - Read/write access to analysis, read-only to admin functions
    3. viewer - Read-only access

Permission categories align with Investing's domain modules:
    - market:read/write - Market data access
    - portfolio:read/write - Portfolio analytics
    - research:read/write - Research reports and notes
    - signals:read/write - Signal generation
    - accounting:read - SEC filings (read-only, external data)
    - institutional:read - 13F data (read-only, external data)
    - admin:read/write - System settings
"""

import logging
from enum import Enum
from functools import lru_cache
from typing import Callable, Dict, FrozenSet, List, Optional, Set, Union

from fastapi import Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


# =============================================================================
# Permission Definitions
# =============================================================================


class Permission(str, Enum):
    """
    All available permissions in Investing.

    Permissions follow the pattern: <domain>:<action>
    where action is typically 'read' or 'write'.
    """

    # Market data permissions
    MARKET_READ = "market:read"
    MARKET_WRITE = "market:write"  # Reserved for future features

    # Portfolio permissions
    PORTFOLIO_READ = "portfolio:read"
    PORTFOLIO_WRITE = "portfolio:write"

    # Research permissions
    RESEARCH_READ = "research:read"
    RESEARCH_WRITE = "research:write"

    # Signal permissions
    SIGNALS_READ = "signals:read"
    SIGNALS_WRITE = "signals:write"

    # Accounting permissions (SEC filings - read-only by nature)
    ACCOUNTING_READ = "accounting:read"

    # Institutional permissions (13F data - read-only by nature)
    INSTITUTIONAL_READ = "institutional:read"

    # Options permissions
    OPTIONS_READ = "options:read"
    OPTIONS_WRITE = "options:write"

    # ETF permissions
    ETF_READ = "etf:read"
    ETF_WRITE = "etf:write"

    # Commodities permissions
    COMMODITIES_READ = "commodities:read"
    COMMODITIES_WRITE = "commodities:write"

    # Macro permissions
    MACRO_READ = "macro:read"
    MACRO_WRITE = "macro:write"

    # Notes/Research Vault permissions
    NOTES_READ = "notes:read"
    NOTES_WRITE = "notes:write"

    # Dark pool permissions
    DARK_POOL_READ = "dark_pool:read"

    # Admin permissions
    ADMIN_READ = "admin:read"
    ADMIN_WRITE = "admin:write"


# =============================================================================
# Role Definitions
# =============================================================================


class Role(str, Enum):
    """
    Built-in roles with predefined permission sets.

    Hierarchy: ADMIN > ANALYST > VIEWER
    Each higher role includes all permissions of lower roles.
    """

    ADMIN = "admin"
    ANALYST = "analyst"
    VIEWER = "viewer"


# =============================================================================
# Role-Permission Mappings
# =============================================================================

# Viewer: Read-only access to all data
_VIEWER_PERMISSIONS: FrozenSet[Permission] = frozenset(
    [
        Permission.MARKET_READ,
        Permission.PORTFOLIO_READ,
        Permission.RESEARCH_READ,
        Permission.SIGNALS_READ,
        Permission.ACCOUNTING_READ,
        Permission.INSTITUTIONAL_READ,
        Permission.OPTIONS_READ,
        Permission.ETF_READ,
        Permission.COMMODITIES_READ,
        Permission.MACRO_READ,
        Permission.NOTES_READ,
        Permission.DARK_POOL_READ,
    ]
)

# Analyst: Read/write to analysis features, read-only to admin
_ANALYST_PERMISSIONS: FrozenSet[Permission] = frozenset(
    [
        # All viewer permissions
        *_VIEWER_PERMISSIONS,
        # Write permissions for analysis features
        Permission.PORTFOLIO_WRITE,
        Permission.RESEARCH_WRITE,
        Permission.SIGNALS_WRITE,
        Permission.OPTIONS_WRITE,
        Permission.ETF_WRITE,
        Permission.COMMODITIES_WRITE,
        Permission.MACRO_WRITE,
        Permission.NOTES_WRITE,
        # Read-only admin access
        Permission.ADMIN_READ,
    ]
)

# Admin: Full access to everything
_ADMIN_PERMISSIONS: FrozenSet[Permission] = frozenset(
    [
        *_ANALYST_PERMISSIONS,
        Permission.MARKET_WRITE,
        Permission.ADMIN_WRITE,
    ]
)

# Immutable role-permission mapping
ROLE_PERMISSIONS: Dict[Role, FrozenSet[Permission]] = {
    Role.ADMIN: _ADMIN_PERMISSIONS,
    Role.ANALYST: _ANALYST_PERMISSIONS,
    Role.VIEWER: _VIEWER_PERMISSIONS,
}


# =============================================================================
# Custom Role Support
# =============================================================================


class CustomRole(BaseModel):
    """
    Custom role definition for extensibility.

    Allows creation of specialized roles with custom permission sets
    beyond the built-in ADMIN/ANALYST/VIEWER hierarchy.
    """

    name: str = Field(..., min_length=1, max_length=50, description="Role name")
    description: str = Field(default="", max_length=200, description="Role description")
    permissions: Set[Permission] = Field(
        default_factory=set, description="Permissions granted to this role"
    )
    inherits_from: Optional[Role] = Field(
        default=None, description="Built-in role to inherit permissions from"
    )

    def get_all_permissions(self) -> Set[Permission]:
        """Get all permissions including inherited ones."""
        permissions = set(self.permissions)
        if self.inherits_from:
            permissions.update(ROLE_PERMISSIONS.get(self.inherits_from, set()))
        return permissions


class RBACConfig(BaseModel):
    """
    RBAC configuration with custom role support.

    Allows runtime configuration of additional roles beyond built-in ones.
    """

    custom_roles: Dict[str, CustomRole] = Field(
        default_factory=dict, description="Custom role definitions"
    )
    default_role: Role = Field(
        default=Role.VIEWER, description="Default role for new users"
    )
    strict_mode: bool = Field(
        default=True,
        description="If True, missing permissions raise 403. If False, log warning only.",
    )


# Global configuration (can be modified at runtime)
_rbac_config = RBACConfig()


def configure_rbac(config: RBACConfig) -> None:
    """
    Configure RBAC settings at runtime.

    Args:
        config: RBAC configuration object
    """
    global _rbac_config
    _rbac_config = config
    logger.info(
        "RBAC configuration updated with %d custom roles", len(config.custom_roles)
    )


def get_rbac_config() -> RBACConfig:
    """Get current RBAC configuration."""
    return _rbac_config


def register_custom_role(role: CustomRole) -> None:
    """
    Register a custom role.

    Args:
        role: Custom role definition

    Raises:
        ValueError: If role name conflicts with built-in role
    """
    if role.name.lower() in [r.value for r in Role]:
        raise ValueError(f"Cannot override built-in role: {role.name}")
    _rbac_config.custom_roles[role.name] = role
    logger.info("Registered custom role: %s", role.name)


# =============================================================================
# Permission Checking Functions
# =============================================================================


def has_permission(role: Union[Role, str], permission: Permission) -> bool:
    """
    Check if a role has a specific permission.

    Args:
        role: Role enum or custom role name
        permission: Permission to check

    Returns:
        True if the role has the permission, False otherwise
    """
    if isinstance(role, Role):
        return permission in ROLE_PERMISSIONS.get(role, frozenset())

    # Check custom roles
    custom_role = _rbac_config.custom_roles.get(role)
    if custom_role:
        return permission in custom_role.get_all_permissions()

    return False


def get_user_permissions(roles: List[Union[Role, str]]) -> Set[Permission]:
    """
    Get all permissions for a user with multiple roles.

    Args:
        roles: List of role enums or custom role names

    Returns:
        Set of all permissions granted by the user's roles
    """
    permissions: Set[Permission] = set()

    for role in roles:
        if isinstance(role, Role):
            permissions.update(ROLE_PERMISSIONS.get(role, frozenset()))
        else:
            custom_role = _rbac_config.custom_roles.get(role)
            if custom_role:
                permissions.update(custom_role.get_all_permissions())

    return permissions


@lru_cache(maxsize=128)
def _get_role_permissions_cached(role_key: str) -> FrozenSet[Permission]:
    """
    Cached permission lookup for performance.

    Args:
        role_key: Role value as string

    Returns:
        Frozen set of permissions
    """
    try:
        role = Role(role_key)
        return ROLE_PERMISSIONS.get(role, frozenset())
    except ValueError:
        custom_role = _rbac_config.custom_roles.get(role_key)
        if custom_role:
            return frozenset(custom_role.get_all_permissions())
        return frozenset()


# =============================================================================
# User Context (for integration with authentication)
# =============================================================================


class UserContext(BaseModel):
    """
    User context containing identity and authorization info.

    This model is populated by the authentication layer and passed
    to authorization dependencies.
    """

    user_id: str = Field(..., description="Unique user identifier")
    username: str = Field(..., description="Username")
    roles: List[Union[Role, str]] = Field(
        default_factory=lambda: [Role.VIEWER], description="User's roles"
    )
    permissions: Optional[Set[Permission]] = Field(
        default=None, description="Cached permissions (computed from roles)"
    )

    model_config = ConfigDict(use_enum_values=True)

    def get_permissions(self) -> Set[Permission]:
        """Get all permissions for this user."""
        if self.permissions is None:
            self.permissions = get_user_permissions(self.roles)
        return self.permissions

    def has_permission(self, permission: Permission) -> bool:
        """Check if user has a specific permission."""
        return permission in self.get_permissions()

    def has_any_permission(self, permissions: List[Permission]) -> bool:
        """Check if user has any of the specified permissions."""
        user_perms = self.get_permissions()
        return any(p in user_perms for p in permissions)

    def has_all_permissions(self, permissions: List[Permission]) -> bool:
        """Check if user has all specified permissions."""
        user_perms = self.get_permissions()
        return all(p in user_perms for p in permissions)


# =============================================================================
# FastAPI Dependencies
# =============================================================================


async def get_current_user(request: Request) -> UserContext:
    """
    Extract current user from request.

    This is a placeholder that should be replaced with actual
    authentication logic (JWT, session, etc.).

    Args:
        request: FastAPI request object

    Returns:
        UserContext with user information

    Note:
        Override this dependency in your application to integrate
        with your authentication system.
    """
    # Placeholder: Check for user info in request state
    # In production, this would validate JWT, session, etc.
    user = getattr(request.state, "user", None)
    if user is None:
        # Default to anonymous viewer for development
        # In production, this should raise HTTPException(401)
        logger.debug("No user in request state, using default viewer role")
        return UserContext(
            user_id="anonymous",
            username="anonymous",
            roles=[Role.VIEWER],
        )
    return user


def require_permission(permission: Permission) -> Callable:
    """
    FastAPI dependency that requires a specific permission.

    Args:
        permission: Required permission

    Returns:
        Dependency function that validates permission

    Example:
        @app.get("/api/admin/settings")
        async def get_settings(
            user: UserContext = Depends(require_permission(Permission.ADMIN_READ))
        ):
            return {"settings": "..."}
    """

    async def permission_checker(
        user: UserContext = Depends(get_current_user),
    ) -> UserContext:
        if not user.has_permission(permission):
            logger.warning(
                "Permission denied: user=%s required=%s has=%s",
                user.username,
                permission.value,
                [p.value for p in user.get_permissions()],
            )
            if _rbac_config.strict_mode:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: requires {permission.value}",
                )
        return user

    return permission_checker


def require_any_permission(permissions: List[Permission]) -> Callable:
    """
    FastAPI dependency that requires at least one of the specified permissions.

    Args:
        permissions: List of acceptable permissions (OR logic)

    Returns:
        Dependency function that validates permissions

    Example:
        @app.get("/api/research/{symbol}")
        async def get_research(
            symbol: str,
            user: UserContext = Depends(
                require_any_permission([Permission.RESEARCH_READ, Permission.ADMIN_READ])
            )
        ):
            return {"symbol": symbol}
    """

    async def permission_checker(
        user: UserContext = Depends(get_current_user),
    ) -> UserContext:
        if not user.has_any_permission(permissions):
            logger.warning(
                "Permission denied: user=%s required_any=%s has=%s",
                user.username,
                [p.value for p in permissions],
                [p.value for p in user.get_permissions()],
            )
            if _rbac_config.strict_mode:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: requires one of {[p.value for p in permissions]}",
                )
        return user

    return permission_checker


def require_all_permissions(permissions: List[Permission]) -> Callable:
    """
    FastAPI dependency that requires all specified permissions.

    Args:
        permissions: List of required permissions (AND logic)

    Returns:
        Dependency function that validates permissions

    Example:
        @app.post("/api/signals/generate")
        async def generate_signals(
            user: UserContext = Depends(
                require_all_permissions([Permission.SIGNALS_READ, Permission.SIGNALS_WRITE])
            )
        ):
            return {"status": "generating"}
    """

    async def permission_checker(
        user: UserContext = Depends(get_current_user),
    ) -> UserContext:
        if not user.has_all_permissions(permissions):
            missing = [p.value for p in permissions if not user.has_permission(p)]
            logger.warning(
                "Permission denied: user=%s required_all=%s missing=%s",
                user.username,
                [p.value for p in permissions],
                missing,
            )
            if _rbac_config.strict_mode:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: missing permissions {missing}",
                )
        return user

    return permission_checker


def require_role(role: Role) -> Callable:
    """
    FastAPI dependency that requires a specific role.

    Args:
        role: Required role

    Returns:
        Dependency function that validates role

    Example:
        @app.delete("/api/admin/reset")
        async def reset_system(
            user: UserContext = Depends(require_role(Role.ADMIN))
        ):
            return {"status": "reset"}
    """

    async def role_checker(
        user: UserContext = Depends(get_current_user),
    ) -> UserContext:
        if role not in user.roles and role.value not in user.roles:
            logger.warning(
                "Role denied: user=%s required=%s has=%s",
                user.username,
                role.value,
                user.roles,
            )
            if _rbac_config.strict_mode:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role denied: requires {role.value}",
                )
        return user

    return role_checker


# =============================================================================
# Endpoint Permission Mapping
# =============================================================================

# Mapping of endpoint patterns to required permissions
# This can be used for automatic permission checking via middleware
ENDPOINT_PERMISSIONS: Dict[str, Permission] = {
    # Market endpoints
    "GET /api/market/*": Permission.MARKET_READ,
    # Portfolio endpoints
    "GET /api/portfolio*": Permission.PORTFOLIO_READ,
    "POST /api/portfolio*": Permission.PORTFOLIO_WRITE,
    # Research endpoints
    "GET /api/research/*": Permission.RESEARCH_READ,
    "GET /api/valuation/*": Permission.RESEARCH_READ,
    "GET /api/earnings/*": Permission.RESEARCH_READ,
    "GET /api/peers/*": Permission.RESEARCH_READ,
    # Signals endpoints
    "GET /api/signals/*": Permission.SIGNALS_READ,
    "POST /api/signals*": Permission.SIGNALS_WRITE,
    # Accounting endpoints
    "GET /api/accounting/*": Permission.ACCOUNTING_READ,
    # Institutional endpoints
    "GET /api/institutional/*": Permission.INSTITUTIONAL_READ,
    # Options endpoints
    "GET /api/options/*": Permission.OPTIONS_READ,
    # ETF endpoints
    "GET /api/etf/*": Permission.ETF_READ,
    # Commodities endpoints
    "GET /api/commodities*": Permission.COMMODITIES_READ,
    # Macro endpoints
    "GET /api/macro/*": Permission.MACRO_READ,
    # Notes endpoints
    "GET /api/notes*": Permission.NOTES_READ,
    "PUT /api/notes/*": Permission.NOTES_WRITE,
    "POST /api/notes*": Permission.NOTES_WRITE,
    "GET /api/theses*": Permission.NOTES_READ,
    "GET /api/trades*": Permission.NOTES_READ,
    # Dark pool endpoints
    "GET /api/dark-pool/*": Permission.DARK_POOL_READ,
    "POST /api/money-flow": Permission.DARK_POOL_READ,
    "GET /api/equity-flow/*": Permission.DARK_POOL_READ,
    # Admin endpoints
    "GET /api/settings*": Permission.ADMIN_READ,
    "PUT /api/settings*": Permission.ADMIN_WRITE,
    "POST /api/settings*": Permission.ADMIN_WRITE,
    "DELETE /api/settings*": Permission.ADMIN_WRITE,
}


def get_endpoint_permission(method: str, path: str) -> Optional[Permission]:
    """
    Get required permission for an endpoint.

    Args:
        method: HTTP method (GET, POST, etc.)
        path: Request path

    Returns:
        Required permission or None if not mapped
    """
    import fnmatch

    key = f"{method.upper()} {path}"
    for pattern, permission in ENDPOINT_PERMISSIONS.items():
        if fnmatch.fnmatch(key, pattern):
            return permission
    return None


# =============================================================================
# Utility Functions
# =============================================================================


def list_all_permissions() -> List[str]:
    """List all available permissions."""
    return [p.value for p in Permission]


def list_role_permissions(role: Union[Role, str]) -> List[str]:
    """
    List all permissions for a role.

    Args:
        role: Role enum or custom role name

    Returns:
        List of permission values
    """
    if isinstance(role, Role):
        perms = ROLE_PERMISSIONS.get(role, frozenset())
    else:
        custom_role = _rbac_config.custom_roles.get(role)
        if custom_role:
            perms = custom_role.get_all_permissions()
        else:
            perms = frozenset()
    return sorted([p.value for p in perms])


def validate_permission_string(permission_str: str) -> bool:
    """
    Validate if a string is a valid permission.

    Args:
        permission_str: Permission string to validate

    Returns:
        True if valid permission
    """
    try:
        Permission(permission_str)
        return True
    except ValueError:
        return False
