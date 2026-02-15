"""
Stanley Authentication Module
=============================

Comprehensive authentication and authorization system for the Stanley
institutional investment analysis platform.


Architecture Overview
---------------------

This module implements a layered security architecture:

    +------------------------------------------------------------------+
    |                         API Gateway                               |
    |  (FastAPI middleware - authenticates all incoming requests)       |
    +------------------------------------------------------------------+
                                    |
                    +---------------+---------------+
                    |                               |
            +-------v--------+             +--------v-------+
            |  JWT Auth      |             |  API Key Auth  |
            |  (Web Sessions)|             |  (Programmatic)|
            +-------+--------+             +--------+-------+
                    |                               |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
                    |     Token Validation &        |
                    |     User Resolution           |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
                    |     RBAC Permission Check     |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
                    |     Rate Limiting             |
                    +---------------+---------------+
                                    |
                    +---------------v---------------+
                    |     Endpoint Execution        |
                    +-------------------------------+


Authentication Methods
----------------------

1. **JWT Token Authentication** (Web Sessions)
   - Access tokens: Short-lived (15 minutes default), stateless
   - Refresh tokens: Long-lived (7 days default), with token rotation
   - Supports Authorization: Bearer header
   - Token blacklisting for immediate revocation
   - JTI (JWT ID) for unique token identification

2. **API Key Authentication** (Programmatic Access)
   - Format: `sk_live_<32-char-alphanumeric>` or `sk_test_<32-char-alphanumeric>`
   - Stored as SHA-256 hashes in database
   - Supports key rotation and revocation
   - Scope-based permissions (read, write, trade, admin)
   - Rate limiting per key


Role-Based Access Control (RBAC)
--------------------------------

Roles hierarchy (from dependencies.py):

    SUPER_ADMIN (level 6) - Unrestricted access, system configuration
    ADMIN (level 5) - User management, API key admin
    PORTFOLIO_MANAGER (level 4) - Trader + team management
    TRADER (level 3) - Analyst + trading signals, portfolio management
    ANALYST (level 2) - Read all analytics + write notes/theses
    VIEWER (level 1) - Read-only access to public data

Roles from rbac.py (simpler 3-tier):

    ADMIN - Full access
    ANALYST - Read/write to analysis features
    VIEWER - Read-only access


Permission Categories
---------------------

Permissions follow the pattern: <domain>:<action>

- market:read/write - Market data access
- portfolio:read/write - Portfolio analytics
- research:read/write - Research reports and notes
- signals:read/write - Signal generation
- accounting:read - SEC filings (read-only)
- institutional:read - 13F data (read-only)
- options:read/write - Options analytics
- etf:read/write - ETF analytics
- commodities:read/write - Commodities data
- macro:read/write - Macro indicators
- notes:read/write - Research vault
- dark_pool:read - Dark pool data
- admin:read/write - System settings


Token Configuration
-------------------

Access Token:
    - Algorithm: HS256 (default, configurable via JWT_ALGORITHM env var)
    - Expiry: 15 minutes (configurable via ACCESS_TOKEN_EXPIRE_MINUTES)
    - Claims: user_id, email, roles, exp, iat, jti, token_type, iss, aud

Refresh Token:
    - Algorithm: HS256
    - Expiry: 7 days (configurable via REFRESH_TOKEN_EXPIRE_DAYS)
    - Rotation on refresh (old token invalidated via blacklist)

API Key:
    - Format: `sk_{env}_{32_alphanumeric_chars}`
    - Production: stanley_live_EXAMPLE_KEY_REPLACE_ME_1234
    - Test/Dev: stanley_test_EXAMPLE_KEY_REPLACE_ME_5678


Rate Limiting
-------------

Category-based limits per minute:
- market_data: 100/min - analytics: 30/min - research: 20/min
- accounting: 10/min (SEC EDGAR courtesy) - signals: 50/min
- options/etf/commodities: 30/min - macro: 20/min
- portfolio: 30/min - notes: 50/min - default: 60/min


Environment Variables
---------------------

Required (for production):
    JWT_SECRET_KEY - JWT signing key (min 32 chars, use secrets.token_hex(32))

Optional (with defaults):
    ACCESS_TOKEN_EXPIRE_MINUTES=15
    REFRESH_TOKEN_EXPIRE_DAYS=7
    JWT_ALGORITHM=HS256
    JWT_ISSUER=stanley-api
    JWT_AUDIENCE=stanley-client


Usage Examples
--------------

1. Protecting an endpoint with authentication::

    from stanley.api.auth import get_current_user, AuthUser

    @app.get("/api/portfolio")
    async def get_portfolio(user: AuthUser = Depends(get_current_user)):
        return await portfolio_service.get(user.id)

2. Requiring specific roles::

    from stanley.api.auth import require_roles, Role

    @app.post("/api/admin/users")
    async def create_user(user = Depends(require_roles(Role.ADMIN))):
        return await user_service.create()

3. Creating JWT tokens::

    from stanley.api.auth import create_token_pair

    token_pair = create_token_pair(
        user_id="user_123",
        email="user@example.com",
        roles=["analyst"]
    )
    # Returns TokenPair with access_token, refresh_token, expires_in

4. API key management::

    from stanley.api.auth import get_api_key_manager, APIKeyScope

    manager = get_api_key_manager()
    result = manager.create_key(
        user_id="user_123",
        name="Trading Bot",
        scopes=[APIKeyScope.READ, APIKeyScope.TRADE],
        expires_in_days=90
    )
    # Save result.full_key - only shown once!

5. Password hashing::

    from stanley.api.auth import hash_password, verify_password

    hashed = hash_password("SecureP@ss123")
    is_valid = verify_password("SecureP@ss123", hashed)


Module Structure
----------------

stanley/api/auth/
    __init__.py       - This file, unified public API
    config.py         - AuthSettings, RateLimitSettings (pydantic-settings)
    models.py         - User, APIKey dataclasses + Pydantic schemas
    jwt.py            - JWT token creation, validation, refresh, blacklisting
    api_keys.py       - API key generation, hashing, verification, management
    rbac.py           - Permission/Role enums, RBAC checks, dependencies
    dependencies.py   - FastAPI auth dependencies (JWT/API key validation)
    passwords.py      - bcrypt password hashing, policy validation
    rate_limit.py     - Sliding window rate limiting middleware


Author: Stanley Development Team
Version: 0.2.0
"""

# =============================================================================
# Configuration
# =============================================================================

from stanley.api.auth.config import (
    AuthSettings,
    RateLimitSettings,
    get_auth_settings,
    get_rate_limit_settings,
    clear_settings_cache,
)

# =============================================================================
# JWT Token Management (optional - requires python-jose)
# =============================================================================

_JWT_AVAILABLE = False
try:
    from stanley.api.auth.jwt import (
        # Token creation
        create_access_token,
        create_refresh_token,
        create_token_pair,
        # Token validation
        decode_token,
        get_token_payload,
        # Token refresh
        refresh_access_token,
        # Token revocation
        revoke_token,
        is_token_revoked,
        revoke_all_user_tokens,
        cleanup_blacklist,
        get_blacklist_size,
        # Utilities
        extract_jti_from_token,
        get_jwt_settings,
        # Models
        TokenPayload,
        TokenPair,
        # Exceptions
        TokenError,
        TokenExpiredError,
        TokenInvalidError,
        TokenRevokedError,
    )

    _JWT_AVAILABLE = True
except ImportError:
    import logging

    logging.getLogger(__name__).warning(
        "JWT authentication not available - install python-jose[cryptography]"
    )
    # Define placeholder classes/functions for type hints
    create_access_token = None
    create_refresh_token = None
    create_token_pair = None
    decode_token = None
    get_token_payload = None
    refresh_access_token = None
    revoke_token = None
    is_token_revoked = None
    revoke_all_user_tokens = None
    cleanup_blacklist = None
    get_blacklist_size = None
    extract_jti_from_token = None
    get_jwt_settings = None
    TokenPayload = None
    TokenPair = None
    TokenError = Exception
    TokenExpiredError = Exception
    TokenInvalidError = Exception
    TokenRevokedError = Exception


# =============================================================================
# Rate Limiting
# =============================================================================

from stanley.api.auth.rate_limit import (
    RateLimiter,
    RateLimitMiddleware,
    RateLimitExceeded,
    RateLimitConfig,
    RateLimitDependency,
    rate_limit,
    get_rate_limit_key,
    get_rate_limiter,
    get_endpoint_category,
    get_rate_limit_status,
    configure_rate_limits,
    RATE_LIMIT_CONFIGS,
    ENDPOINT_CATEGORIES,
)

from stanley.api.auth.rbac import (
    Permission,
    Role as RBACRole,  # Renamed to avoid conflict with dependencies.Role
    ROLE_PERMISSIONS,
    ENDPOINT_PERMISSIONS,
    has_permission,
    get_user_permissions,
    require_permission,
    require_any_permission,
    require_all_permissions,
    require_role,
    get_current_user as rbac_get_current_user,  # Renamed to avoid conflict
    RBACConfig,
    CustomRole,
    UserContext,
    configure_rbac,
    get_rbac_config,
    register_custom_role,
    list_all_permissions,
    list_role_permissions,
    validate_permission_string,
    get_endpoint_permission,
)

# =============================================================================
# FastAPI Authentication Dependencies
# =============================================================================

from stanley.api.auth.dependencies import (
    User as AuthUser,  # Authenticated user from JWT/API key
    Role,  # Role enum with VIEWER, ANALYST, TRADER, etc.
    ROLE_HIERARCHY,
    oauth2_scheme,
    api_key_header,
    get_current_user,  # Primary auth dependency (JWT/API key)
    get_current_active_user,
    get_optional_user,
    require_auth,
    require_roles,
    require_permission_level,
    require_admin,
    require_super_admin,
)

# =============================================================================
# Password Utilities (Lazy Loaded)
# =============================================================================


# Lazy imports for password utilities to avoid import errors when passlib not installed
def _get_password_utils():
    from stanley.api.auth.passwords import (
        PasswordPolicy,
        hash_password,
        verify_password,
        validate_password_strength,
        generate_reset_token,
        hash_reset_token,
        verify_reset_token,
    )

    return {
        "PasswordPolicy": PasswordPolicy,
        "hash_password": hash_password,
        "verify_password": verify_password,
        "validate_password_strength": validate_password_strength,
        "generate_reset_token": generate_reset_token,
        "hash_reset_token": hash_reset_token,
        "verify_reset_token": verify_reset_token,
    }


# User models and schemas
from stanley.api.auth.models import (
    # Database models
    User,
    APIKey,
    # User schemas
    UserCreate,
    UserUpdate,
    UserResponse,
    UserInDB,
    # Auth schemas
    LoginRequest,
    LoginResponse,
    TokenRefreshRequest,
    TokenRefreshResponse,
    PasswordResetRequest,
    PasswordResetConfirm,
    # API key schemas
    APIKeyCreate,
    APIKeyResponse,
    # Store
    UserStore,
    get_user_store,
    reset_user_store,
)

# API Key Management (advanced features with secure key generation)
from stanley.api.auth.api_keys import (
    # Core functions
    generate_api_key,
    hash_api_key,
    verify_api_key,
    validate_api_key_format,
    # Scope enum
    APIKeyScope,
    # Data classes
    ManagedAPIKey,
    APIKeyCreateResult,
    # Manager class
    APIKeyManager,
    get_api_key_manager,
    reset_api_key_manager,
)

__all__ = [
    # =========================================================================
    # Configuration
    # =========================================================================
    "AuthSettings",
    "RateLimitSettings",
    "get_auth_settings",
    "get_rate_limit_settings",
    "clear_settings_cache",
    # =========================================================================
    # JWT Token Management
    # =========================================================================
    # Token creation
    "create_access_token",
    "create_refresh_token",
    "create_token_pair",
    # Token validation
    "decode_token",
    "get_token_payload",
    # Token refresh
    "refresh_access_token",
    # Token revocation
    "revoke_token",
    "is_token_revoked",
    "revoke_all_user_tokens",
    "cleanup_blacklist",
    "get_blacklist_size",
    # Utilities
    "extract_jti_from_token",
    "get_jwt_settings",
    # Models
    "TokenPayload",
    "TokenPair",
    # Exceptions
    "TokenError",
    "TokenExpiredError",
    "TokenInvalidError",
    "TokenRevokedError",
    # =========================================================================
    # Rate Limiting
    # =========================================================================
    "RateLimiter",
    "RateLimitMiddleware",
    "RateLimitExceeded",
    "RateLimitConfig",
    "RateLimitDependency",
    "rate_limit",
    "get_rate_limit_key",
    "get_rate_limiter",
    "get_endpoint_category",
    "get_rate_limit_status",
    "configure_rate_limits",
    "RATE_LIMIT_CONFIGS",
    "ENDPOINT_CATEGORIES",
    # =========================================================================
    # Password Utilities (lazy loaded)
    # =========================================================================
    "PasswordPolicy",
    "hash_password",
    "verify_password",
    "validate_password_strength",
    "generate_reset_token",
    "hash_reset_token",
    "verify_reset_token",
    # =========================================================================
    # Database/User Models
    # =========================================================================
    "User",
    "APIKey",
    # =========================================================================
    # User Schemas (Pydantic)
    # =========================================================================
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserInDB",
    # =========================================================================
    # Auth Schemas (Pydantic)
    # =========================================================================
    "LoginRequest",
    "LoginResponse",
    "TokenRefreshRequest",
    "TokenRefreshResponse",
    "PasswordResetRequest",
    "PasswordResetConfirm",
    # =========================================================================
    # API Key Schemas
    # =========================================================================
    "APIKeyCreate",
    "APIKeyResponse",
    # =========================================================================
    # User Store (development/testing)
    # =========================================================================
    "UserStore",
    "get_user_store",
    "reset_user_store",
    # =========================================================================
    # RBAC - Roles & Permissions
    # =========================================================================
    "Permission",
    "Role",
    "RBACRole",  # Original Role from rbac.py (admin/analyst/viewer)
    "ROLE_PERMISSIONS",
    "ENDPOINT_PERMISSIONS",
    # =========================================================================
    # RBAC - Permission Checking
    # =========================================================================
    "has_permission",
    "get_user_permissions",
    "require_permission",
    "require_any_permission",
    "require_all_permissions",
    "require_role",
    "rbac_get_current_user",
    # =========================================================================
    # RBAC - Configuration & Custom Roles
    # =========================================================================
    "RBACConfig",
    "CustomRole",
    "UserContext",
    "configure_rbac",
    "get_rbac_config",
    "register_custom_role",
    "list_all_permissions",
    "list_role_permissions",
    "validate_permission_string",
    "get_endpoint_permission",
    # =========================================================================
    # FastAPI Authentication Dependencies
    # =========================================================================
    "AuthUser",
    "ROLE_HIERARCHY",
    "oauth2_scheme",
    "api_key_header",
    "get_current_user",
    "get_current_active_user",
    "get_optional_user",
    "require_auth",
    "require_roles",
    "require_permission_level",
    "require_admin",
    "require_super_admin",
    # =========================================================================
    # API Key Management
    # =========================================================================
    "generate_api_key",
    "hash_api_key",
    "verify_api_key",
    "validate_api_key_format",
    "APIKeyScope",
    "ManagedAPIKey",
    "APIKeyCreateResult",
    "APIKeyManager",
    "get_api_key_manager",
    "reset_api_key_manager",
]


# =============================================================================
# Module Version
# =============================================================================

__version__ = "0.2.0"


def __getattr__(name):
    """Lazy loading for password utilities."""
    password_utils = [
        "PasswordPolicy",
        "hash_password",
        "verify_password",
        "validate_password_strength",
        "generate_reset_token",
        "hash_reset_token",
        "verify_reset_token",
    ]
    if name in password_utils:
        utils = _get_password_utils()
        return utils[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
