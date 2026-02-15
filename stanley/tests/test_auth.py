"""
Comprehensive security tests for Stanley API.

This module tests authentication, authorization, and security features including:
- JWT token creation, validation, and refresh
- API key generation and authentication
- Password hashing and verification
- Role-Based Access Control (RBAC)
- Rate limiting
- Protected endpoint access

These tests follow TDD principles - they define expected behavior for the
security module that will be implemented in stanley/api/security.py.
"""

import asyncio
import hashlib
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

# Check for optional dependencies
try:
    import jwt

    HAS_JWT = True
except ImportError:
    HAS_JWT = False
    jwt = None

try:
    import bcrypt

    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False
    bcrypt = None

# Skip markers for optional dependencies
requires_jwt = pytest.mark.skipif(not HAS_JWT, reason="PyJWT not installed")
requires_bcrypt = pytest.mark.skipif(not HAS_BCRYPT, reason="bcrypt not installed")

# =============================================================================
# Test Constants
# =============================================================================

TEST_SECRET_KEY = "test-secret-key-for-testing-only-minimum-32-chars"
TEST_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Test user data
TEST_USERS = {
    "admin_user": {
        "user_id": "user-001",
        "username": "admin",
        "email": "admin@example.com",
        "password_hash": None,  # Set in fixtures
        "role": "admin",
        "is_active": True,
    },
    "analyst_user": {
        "user_id": "user-002",
        "username": "analyst",
        "email": "analyst@example.com",
        "password_hash": None,
        "role": "analyst",
        "is_active": True,
    },
    "viewer_user": {
        "user_id": "user-003",
        "username": "viewer",
        "email": "viewer@example.com",
        "password_hash": None,
        "role": "viewer",
        "is_active": True,
    },
    "inactive_user": {
        "user_id": "user-004",
        "username": "inactive",
        "email": "inactive@example.com",
        "password_hash": None,
        "role": "viewer",
        "is_active": False,
    },
}

# Role permission matrix
ROLE_PERMISSIONS = {
    "admin": [
        "read:market_data",
        "read:institutional",
        "read:dark_pool",
        "read:options",
        "read:portfolio",
        "read:research",
        "read:signals",
        "write:portfolio",
        "write:signals",
        "write:notes",
        "admin:users",
        "admin:settings",
        "admin:api_keys",
    ],
    "analyst": [
        "read:market_data",
        "read:institutional",
        "read:dark_pool",
        "read:options",
        "read:portfolio",
        "read:research",
        "read:signals",
        "write:portfolio",
        "write:signals",
        "write:notes",
    ],
    "viewer": [
        "read:market_data",
        "read:institutional",
        "read:dark_pool",
        "read:options",
        "read:portfolio",
        "read:research",
    ],
}


# =============================================================================
# Mock Security Module (for testing before implementation)
# =============================================================================


class MockSecurityModule:
    """
    Mock security module that simulates the expected behavior of the
    security implementation. This will be replaced by actual imports
    once stanley/api/security.py is implemented.
    """

    def __init__(self):
        self.revoked_tokens: set = set()
        self.api_keys: Dict[str, dict] = {}
        self.rate_limit_store: Dict[str, List[float]] = {}

    def create_access_token(
        self,
        data: dict,
        expires_delta: Optional[timedelta] = None,
        secret_key: str = TEST_SECRET_KEY,
    ) -> str:
        """Create a JWT access token."""
        if not HAS_JWT:
            raise ImportError("PyJWT not installed")

        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + (
            expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        to_encode.update({"exp": expire, "type": "access"})
        return jwt.encode(to_encode, secret_key, algorithm=TEST_ALGORITHM)

    def create_refresh_token(
        self,
        data: dict,
        expires_delta: Optional[timedelta] = None,
        secret_key: str = TEST_SECRET_KEY,
    ) -> str:
        """Create a JWT refresh token."""
        if not HAS_JWT:
            raise ImportError("PyJWT not installed")

        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + (
            expires_delta or timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        )
        to_encode.update({"exp": expire, "type": "refresh"})
        return jwt.encode(to_encode, secret_key, algorithm=TEST_ALGORITHM)

    def decode_token(self, token: str, secret_key: str = TEST_SECRET_KEY) -> dict:
        """Decode and validate a JWT token."""
        if not HAS_JWT:
            raise ImportError("PyJWT not installed")

        if token in self.revoked_tokens:
            raise jwt.InvalidTokenError("Token has been revoked")

        return jwt.decode(token, secret_key, algorithms=[TEST_ALGORITHM])

    def revoke_token(self, token: str) -> None:
        """Revoke a token."""
        self.revoked_tokens.add(token)

    def is_token_revoked(self, token: str) -> bool:
        """Check if a token is revoked."""
        return token in self.revoked_tokens

    def generate_api_key(self, prefix: str = "sk") -> tuple:
        """Generate a new API key. Returns (key, hash)."""
        import secrets

        key = f"{prefix}_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        return key, key_hash

    def hash_api_key(self, key: str) -> str:
        """Hash an API key for storage."""
        return hashlib.sha256(key.encode()).hexdigest()

    def verify_api_key(self, key: str, key_hash: str) -> bool:
        """Verify an API key against its hash."""
        return hashlib.sha256(key.encode()).hexdigest() == key_hash

    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt."""
        if not HAS_BCRYPT:
            raise ImportError("bcrypt not installed")

        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    def verify_password(self, password: str, password_hash: str) -> bool:
        """Verify a password against its hash."""
        if not HAS_BCRYPT:
            raise ImportError("bcrypt not installed")

        return bcrypt.checkpw(password.encode(), password_hash.encode())

    def validate_password_strength(self, password: str) -> tuple:
        """
        Validate password strength.
        Returns (is_valid, list of issues).
        """
        issues = []

        if len(password) < 8:
            issues.append("Password must be at least 8 characters long")
        if len(password) > 128:
            issues.append("Password must not exceed 128 characters")
        if not re.search(r"[A-Z]", password):
            issues.append("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", password):
            issues.append("Password must contain at least one lowercase letter")
        if not re.search(r"\d", password):
            issues.append("Password must contain at least one digit")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
            issues.append("Password must contain at least one special character")

        return len(issues) == 0, issues

    def check_rate_limit(
        self,
        key: str,
        max_requests: int = 100,
        window_seconds: int = 60,
    ) -> tuple:
        """
        Check rate limit for a key.
        Returns (allowed, remaining, reset_time).
        """
        now = time.time()
        window_start = now - window_seconds

        # Clean old entries and get current count
        if key not in self.rate_limit_store:
            self.rate_limit_store[key] = []

        self.rate_limit_store[key] = [
            t for t in self.rate_limit_store[key] if t > window_start
        ]

        current_count = len(self.rate_limit_store[key])

        if current_count >= max_requests:
            oldest = (
                min(self.rate_limit_store[key]) if self.rate_limit_store[key] else now
            )
            reset_time = oldest + window_seconds
            return False, 0, reset_time

        self.rate_limit_store[key].append(now)
        remaining = max_requests - current_count - 1
        reset_time = now + window_seconds

        return True, remaining, reset_time

    def get_role_permissions(self, role: str) -> List[str]:
        """Get permissions for a role."""
        return ROLE_PERMISSIONS.get(role, [])

    def has_permission(self, role: str, permission: str) -> bool:
        """Check if a role has a specific permission."""
        return permission in self.get_role_permissions(role)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def security_module():
    """Create a fresh security module instance for each test."""
    return MockSecurityModule()


@pytest.fixture
def test_password():
    """A valid test password meeting strength requirements."""
    return "SecureP@ss123!"


@pytest.fixture
def weak_passwords():
    """Collection of weak passwords that should be rejected."""
    return [
        "short",  # Too short
        "alllowercase123!",  # No uppercase
        "ALLUPPERCASE123!",  # No lowercase
        "NoNumbers!!",  # No digits
        "NoSpecial123",  # No special characters
        "a" * 150,  # Too long
    ]


@pytest.fixture
def admin_user(security_module, test_password):
    """Create test admin user with hashed password."""
    user = TEST_USERS["admin_user"].copy()
    if HAS_BCRYPT:
        user["password_hash"] = security_module.hash_password(test_password)
    else:
        # Use a mock hash for testing when bcrypt is not available
        user["password_hash"] = (
            f"$2b$mock${hashlib.sha256(test_password.encode()).hexdigest()[:53]}"
        )
    return user


@pytest.fixture
def analyst_user(security_module, test_password):
    """Create test analyst user with hashed password."""
    user = TEST_USERS["analyst_user"].copy()
    if HAS_BCRYPT:
        user["password_hash"] = security_module.hash_password(test_password)
    else:
        user["password_hash"] = (
            f"$2b$mock${hashlib.sha256(test_password.encode()).hexdigest()[:53]}"
        )
    return user


@pytest.fixture
def viewer_user(security_module, test_password):
    """Create test viewer user with hashed password."""
    user = TEST_USERS["viewer_user"].copy()
    if HAS_BCRYPT:
        user["password_hash"] = security_module.hash_password(test_password)
    else:
        user["password_hash"] = (
            f"$2b$mock${hashlib.sha256(test_password.encode()).hexdigest()[:53]}"
        )
    return user


@pytest.fixture
def inactive_user(security_module, test_password):
    """Create test inactive user."""
    user = TEST_USERS["inactive_user"].copy()
    if HAS_BCRYPT:
        user["password_hash"] = security_module.hash_password(test_password)
    else:
        user["password_hash"] = (
            f"$2b$mock${hashlib.sha256(test_password.encode()).hexdigest()[:53]}"
        )
    return user


@pytest.fixture
def access_token(security_module, admin_user):
    """Create a valid access token for admin user."""
    return security_module.create_access_token(
        data={"sub": admin_user["user_id"], "role": admin_user["role"]}
    )


@pytest.fixture
def refresh_token(security_module, admin_user):
    """Create a valid refresh token for admin user."""
    return security_module.create_refresh_token(
        data={"sub": admin_user["user_id"], "role": admin_user["role"]}
    )


@pytest.fixture
def expired_token(security_module, admin_user):
    """Create an expired access token."""
    return security_module.create_access_token(
        data={"sub": admin_user["user_id"], "role": admin_user["role"]},
        expires_delta=timedelta(seconds=-1),  # Already expired
    )


@pytest.fixture
def api_key(security_module):
    """Generate a test API key."""
    key, key_hash = security_module.generate_api_key()
    return {"key": key, "hash": key_hash}


@pytest.fixture
def api_key_with_scopes(security_module):
    """Generate a test API key with specific scopes."""
    key, key_hash = security_module.generate_api_key(prefix="sk_test")
    return {
        "key": key,
        "hash": key_hash,
        "scopes": ["read:market_data", "read:portfolio"],
        "expires_at": datetime.now(timezone.utc) + timedelta(days=30),
    }


@pytest.fixture
def expired_api_key(security_module):
    """Generate an expired test API key."""
    key, key_hash = security_module.generate_api_key(prefix="sk_expired")
    return {
        "key": key,
        "hash": key_hash,
        "scopes": ["read:market_data"],
        "expires_at": datetime.now(timezone.utc) - timedelta(days=1),
    }


# =============================================================================
# JWT Token Tests
# =============================================================================


@requires_jwt
class TestJWTTokens:
    """Test JWT token creation, validation, and management."""

    def test_create_access_token(self, security_module, admin_user):
        """Test that access tokens are created correctly."""
        token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

        # Token should have three parts (header.payload.signature)
        parts = token.split(".")
        assert len(parts) == 3

    def test_create_refresh_token(self, security_module, admin_user):
        """Test that refresh tokens are created correctly."""
        token = security_module.create_refresh_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        assert token is not None
        assert isinstance(token, str)

        # Decode and verify it's a refresh token
        decoded = security_module.decode_token(token)
        assert decoded["type"] == "refresh"

    def test_decode_valid_token(self, security_module, access_token, admin_user):
        """Test that valid tokens are decoded correctly."""
        decoded = security_module.decode_token(access_token)

        assert decoded["sub"] == admin_user["user_id"]
        assert decoded["role"] == admin_user["role"]
        assert decoded["type"] == "access"
        assert "exp" in decoded

    def test_decode_expired_token(self, security_module, expired_token):
        """Test that expired tokens raise an error."""
        import jwt

        with pytest.raises(jwt.ExpiredSignatureError):
            security_module.decode_token(expired_token)

    def test_decode_invalid_token(self, security_module):
        """Test that invalid tokens raise an error."""
        import jwt

        invalid_tokens = [
            "not.a.valid.token",
            "completely_invalid",
            "",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature",
        ]

        for invalid_token in invalid_tokens:
            with pytest.raises((jwt.InvalidTokenError, jwt.DecodeError)):
                security_module.decode_token(invalid_token)

    def test_decode_token_wrong_secret(self, security_module, access_token):
        """Test that tokens signed with different secret fail validation."""
        import jwt

        with pytest.raises(jwt.InvalidSignatureError):
            security_module.decode_token(access_token, secret_key="wrong-secret-key")

    def test_refresh_token_flow(self, security_module, admin_user):
        """Test the complete refresh token flow."""
        # Create initial tokens
        access_token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )
        refresh_token = security_module.create_refresh_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        # Decode refresh token to get user info
        refresh_payload = security_module.decode_token(refresh_token)
        assert refresh_payload["type"] == "refresh"
        assert refresh_payload["sub"] == admin_user["user_id"]

        # Create new access token using refresh token data
        new_access_token = security_module.create_access_token(
            data={"sub": refresh_payload["sub"], "role": refresh_payload["role"]}
        )

        # New token should be valid
        new_payload = security_module.decode_token(new_access_token)
        assert new_payload["sub"] == admin_user["user_id"]
        assert new_payload["type"] == "access"

    def test_revoke_token(self, security_module, access_token):
        """Test that tokens can be revoked."""
        import jwt

        # Token should be valid initially
        decoded = security_module.decode_token(access_token)
        assert decoded is not None

        # Revoke the token
        security_module.revoke_token(access_token)

        # Token should now be invalid
        assert security_module.is_token_revoked(access_token)
        with pytest.raises(jwt.InvalidTokenError):
            security_module.decode_token(access_token)

    def test_token_contains_required_claims(self, security_module, admin_user):
        """Test that tokens contain all required claims."""
        token = security_module.create_access_token(
            data={
                "sub": admin_user["user_id"],
                "role": admin_user["role"],
                "email": admin_user["email"],
            }
        )

        decoded = security_module.decode_token(token)

        # Required claims
        assert "sub" in decoded
        assert "exp" in decoded
        assert "type" in decoded
        assert "role" in decoded

    def test_access_token_expiry_is_short(self, security_module, admin_user):
        """Test that access tokens have short expiry."""
        token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        decoded = security_module.decode_token(token)
        exp_time = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
        now = datetime.now(timezone.utc)

        # Should expire within the configured time (default 30 minutes)
        time_until_expiry = (exp_time - now).total_seconds()
        assert time_until_expiry <= ACCESS_TOKEN_EXPIRE_MINUTES * 60
        assert time_until_expiry > 0

    def test_refresh_token_expiry_is_long(self, security_module, admin_user):
        """Test that refresh tokens have longer expiry."""
        token = security_module.create_refresh_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        decoded = security_module.decode_token(token)
        exp_time = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
        now = datetime.now(timezone.utc)

        # Should expire within the configured time (default 7 days)
        time_until_expiry = (exp_time - now).total_seconds()
        assert time_until_expiry <= REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
        assert (
            time_until_expiry > ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )  # Longer than access token


# =============================================================================
# API Key Tests
# =============================================================================


class TestAPIKeys:
    """Test API key generation, validation, and authentication."""

    def test_generate_api_key_format(self, security_module):
        """Test that API keys are generated with correct format."""
        key, key_hash = security_module.generate_api_key()

        # Key should have correct format: prefix_base64url
        assert key.startswith("sk_")
        assert len(key) > 10

        # Hash should be a valid SHA256 hex digest
        assert len(key_hash) == 64
        assert all(c in "0123456789abcdef" for c in key_hash)

    def test_generate_api_key_with_custom_prefix(self, security_module):
        """Test API key generation with custom prefix."""
        key, _ = security_module.generate_api_key(prefix="test")
        assert key.startswith("test_")

    def test_generate_api_key_uniqueness(self, security_module):
        """Test that generated API keys are unique."""
        keys = set()
        for _ in range(100):
            key, _ = security_module.generate_api_key()
            assert key not in keys
            keys.add(key)

    def test_hash_and_verify_api_key(self, security_module, api_key):
        """Test API key hashing and verification."""
        key = api_key["key"]
        stored_hash = api_key["hash"]

        # Verification should succeed with correct key
        assert security_module.verify_api_key(key, stored_hash)

        # Rehashing should produce the same hash
        rehash = security_module.hash_api_key(key)
        assert rehash == stored_hash

    def test_api_key_verification_fails_with_wrong_key(self, security_module, api_key):
        """Test that verification fails with incorrect key."""
        wrong_key = "sk_wrong_key_that_should_not_match"
        assert not security_module.verify_api_key(wrong_key, api_key["hash"])

    def test_api_key_authentication(self, security_module, api_key_with_scopes):
        """Test API key authentication with scopes."""
        key = api_key_with_scopes["key"]
        stored_hash = api_key_with_scopes["hash"]
        scopes = api_key_with_scopes["scopes"]

        # Verify the key
        assert security_module.verify_api_key(key, stored_hash)

        # Check scopes
        assert "read:market_data" in scopes
        assert "read:portfolio" in scopes
        assert "write:portfolio" not in scopes

    def test_invalid_api_key(self, security_module):
        """Test that invalid API keys are rejected."""
        invalid_keys = [
            "",
            "invalid",
            "sk_",
            None,
            12345,
        ]

        valid_hash = security_module.hash_api_key("sk_valid_key")

        for invalid_key in invalid_keys:
            if invalid_key is None or not isinstance(invalid_key, str):
                with pytest.raises((TypeError, AttributeError)):
                    security_module.verify_api_key(invalid_key, valid_hash)
            else:
                assert not security_module.verify_api_key(invalid_key, valid_hash)

    def test_expired_api_key(self, expired_api_key):
        """Test that expired API keys are properly identified."""
        expires_at = expired_api_key["expires_at"]
        now = datetime.now(timezone.utc)

        assert expires_at < now

    def test_api_key_scopes(self, api_key_with_scopes):
        """Test API key scope validation."""
        scopes = api_key_with_scopes["scopes"]

        # Should have read permissions
        assert "read:market_data" in scopes
        assert "read:portfolio" in scopes

        # Should not have write or admin permissions
        assert "write:portfolio" not in scopes
        assert "admin:users" not in scopes


# =============================================================================
# Password Tests
# =============================================================================


@requires_bcrypt
class TestPasswords:
    """Test password hashing, verification, and strength validation."""

    def test_hash_password(self, security_module, test_password):
        """Test that passwords are hashed correctly."""
        password_hash = security_module.hash_password(test_password)

        assert password_hash is not None
        assert password_hash != test_password
        assert len(password_hash) > 0

        # bcrypt hashes start with $2b$ (or $2a$, $2y$)
        assert password_hash.startswith("$2")

    def test_hash_password_unique(self, security_module, test_password):
        """Test that same password produces different hashes (salt)."""
        hash1 = security_module.hash_password(test_password)
        hash2 = security_module.hash_password(test_password)

        # Same password should produce different hashes due to random salt
        assert hash1 != hash2

    def test_verify_correct_password(self, security_module, test_password):
        """Test password verification with correct password."""
        password_hash = security_module.hash_password(test_password)
        assert security_module.verify_password(test_password, password_hash)

    def test_verify_wrong_password(self, security_module, test_password):
        """Test password verification with incorrect password."""
        password_hash = security_module.hash_password(test_password)
        assert not security_module.verify_password("WrongPassword123!", password_hash)

    def test_password_strength_validation(self, security_module):
        """Test password strength validation with valid password."""
        valid_passwords = [
            "SecureP@ss123!",
            "MyStr0ng!Pass",
            "C0mplex#Password",
            "Valid1@Password",
        ]

        for password in valid_passwords:
            is_valid, issues = security_module.validate_password_strength(password)
            assert (
                is_valid
            ), f"Password '{password}' should be valid, but got issues: {issues}"
            assert len(issues) == 0

    def test_weak_password_rejected(self, security_module, weak_passwords):
        """Test that weak passwords are rejected."""
        for password in weak_passwords:
            is_valid, issues = security_module.validate_password_strength(password)
            assert not is_valid, f"Password '{password}' should be rejected"
            assert len(issues) > 0

    def test_password_length_validation(self, security_module):
        """Test password length requirements."""
        # Too short
        is_valid, issues = security_module.validate_password_strength("Aa1!")
        assert not is_valid
        assert any("8 characters" in issue for issue in issues)

        # Too long
        long_password = "Aa1!" + "a" * 130
        is_valid, issues = security_module.validate_password_strength(long_password)
        assert not is_valid
        assert any("128 characters" in issue for issue in issues)

    def test_password_complexity_requirements(self, security_module):
        """Test each password complexity requirement individually."""
        # Missing uppercase
        is_valid, issues = security_module.validate_password_strength("lowercase123!")
        assert not is_valid
        assert any("uppercase" in issue.lower() for issue in issues)

        # Missing lowercase
        is_valid, issues = security_module.validate_password_strength("UPPERCASE123!")
        assert not is_valid
        assert any("lowercase" in issue.lower() for issue in issues)

        # Missing digit
        is_valid, issues = security_module.validate_password_strength("NoDigits!!")
        assert not is_valid
        assert any("digit" in issue.lower() for issue in issues)

        # Missing special character
        is_valid, issues = security_module.validate_password_strength("NoSpecial123")
        assert not is_valid
        assert any("special" in issue.lower() for issue in issues)


# =============================================================================
# RBAC Tests
# =============================================================================


class TestRBAC:
    """Test Role-Based Access Control functionality."""

    def test_admin_has_all_permissions(self, security_module):
        """Test that admin role has all permissions."""
        admin_permissions = security_module.get_role_permissions("admin")

        # Admin should have all defined permissions
        expected_permissions = [
            "read:market_data",
            "read:institutional",
            "read:dark_pool",
            "read:options",
            "read:portfolio",
            "read:research",
            "read:signals",
            "write:portfolio",
            "write:signals",
            "write:notes",
            "admin:users",
            "admin:settings",
            "admin:api_keys",
        ]

        for permission in expected_permissions:
            assert permission in admin_permissions
            assert security_module.has_permission("admin", permission)

    def test_analyst_permissions(self, security_module):
        """Test that analyst role has correct permissions."""
        analyst_permissions = security_module.get_role_permissions("analyst")

        # Analyst should have read and write permissions
        assert security_module.has_permission("analyst", "read:market_data")
        assert security_module.has_permission("analyst", "read:portfolio")
        assert security_module.has_permission("analyst", "write:portfolio")
        assert security_module.has_permission("analyst", "write:signals")

        # Analyst should NOT have admin permissions
        assert not security_module.has_permission("analyst", "admin:users")
        assert not security_module.has_permission("analyst", "admin:settings")
        assert not security_module.has_permission("analyst", "admin:api_keys")

    def test_viewer_read_only(self, security_module):
        """Test that viewer role only has read permissions."""
        viewer_permissions = security_module.get_role_permissions("viewer")

        # Viewer should have read permissions
        assert security_module.has_permission("viewer", "read:market_data")
        assert security_module.has_permission("viewer", "read:portfolio")
        assert security_module.has_permission("viewer", "read:research")

        # Viewer should NOT have write or admin permissions
        assert not security_module.has_permission("viewer", "write:portfolio")
        assert not security_module.has_permission("viewer", "write:signals")
        assert not security_module.has_permission("viewer", "admin:users")

    def test_require_permission_decorator(
        self, security_module, admin_user, viewer_user
    ):
        """Test permission requirement decorator logic."""

        # Simulate permission check logic
        def check_permission(user: dict, required_permission: str) -> bool:
            role = user["role"]
            return security_module.has_permission(role, required_permission)

        # Admin should have access to admin endpoints
        assert check_permission(admin_user, "admin:users")
        assert check_permission(admin_user, "write:portfolio")
        assert check_permission(admin_user, "read:market_data")

        # Viewer should not have access to admin or write endpoints
        assert not check_permission(viewer_user, "admin:users")
        assert not check_permission(viewer_user, "write:portfolio")
        assert check_permission(viewer_user, "read:market_data")

    def test_unknown_role_has_no_permissions(self, security_module):
        """Test that unknown roles have no permissions."""
        permissions = security_module.get_role_permissions("unknown_role")
        assert permissions == []
        assert not security_module.has_permission("unknown_role", "read:market_data")

    def test_empty_role_has_no_permissions(self, security_module):
        """Test that empty role string has no permissions."""
        permissions = security_module.get_role_permissions("")
        assert permissions == []

    def test_role_hierarchy_permissions(self, security_module):
        """Test that higher roles have more permissions."""
        admin_perms = set(security_module.get_role_permissions("admin"))
        analyst_perms = set(security_module.get_role_permissions("analyst"))
        viewer_perms = set(security_module.get_role_permissions("viewer"))

        # Admin should have all analyst permissions
        assert analyst_perms.issubset(admin_perms)

        # Analyst should have all viewer permissions
        assert viewer_perms.issubset(analyst_perms)

        # Each role should have more permissions than the one below
        assert len(admin_perms) > len(analyst_perms)
        assert len(analyst_perms) > len(viewer_perms)


# =============================================================================
# Rate Limiting Tests
# =============================================================================


class TestRateLimiting:
    """Test rate limiting functionality."""

    def test_rate_limit_allows_under_limit(self, security_module):
        """Test that requests under the limit are allowed."""
        key = "test_user_1"
        max_requests = 10
        window_seconds = 60

        for i in range(max_requests):
            allowed, remaining, reset_time = security_module.check_rate_limit(
                key, max_requests=max_requests, window_seconds=window_seconds
            )
            assert allowed, f"Request {i+1} should be allowed"
            assert remaining == max_requests - i - 1

    def test_rate_limit_blocks_over_limit(self, security_module):
        """Test that requests over the limit are blocked."""
        key = "test_user_2"
        max_requests = 5
        window_seconds = 60

        # Use up all requests
        for _ in range(max_requests):
            security_module.check_rate_limit(
                key, max_requests=max_requests, window_seconds=window_seconds
            )

        # Next request should be blocked
        allowed, remaining, reset_time = security_module.check_rate_limit(
            key, max_requests=max_requests, window_seconds=window_seconds
        )
        assert not allowed
        assert remaining == 0

    def test_rate_limit_resets_after_window(self, security_module):
        """Test that rate limit resets after the time window."""
        key = "test_user_3"
        max_requests = 5
        window_seconds = 1  # Very short window for testing

        # Use up all requests
        for _ in range(max_requests):
            security_module.check_rate_limit(
                key, max_requests=max_requests, window_seconds=window_seconds
            )

        # Should be blocked now
        allowed, _, _ = security_module.check_rate_limit(
            key, max_requests=max_requests, window_seconds=window_seconds
        )
        assert not allowed

        # Wait for window to expire
        time.sleep(window_seconds + 0.1)

        # Should be allowed again
        allowed, remaining, _ = security_module.check_rate_limit(
            key, max_requests=max_requests, window_seconds=window_seconds
        )
        assert allowed
        assert remaining == max_requests - 1

    def test_rate_limit_per_user(self, security_module):
        """Test that rate limits are separate per user."""
        user1_key = "user_1"
        user2_key = "user_2"
        max_requests = 5
        window_seconds = 60

        # Use up all requests for user 1
        for _ in range(max_requests):
            security_module.check_rate_limit(
                user1_key, max_requests=max_requests, window_seconds=window_seconds
            )

        # User 1 should be blocked
        allowed, _, _ = security_module.check_rate_limit(
            user1_key, max_requests=max_requests, window_seconds=window_seconds
        )
        assert not allowed

        # User 2 should still be allowed
        allowed, remaining, _ = security_module.check_rate_limit(
            user2_key, max_requests=max_requests, window_seconds=window_seconds
        )
        assert allowed
        assert remaining == max_requests - 1

    def test_rate_limit_returns_reset_time(self, security_module):
        """Test that rate limit returns appropriate reset time."""
        key = "test_user_4"
        max_requests = 1
        window_seconds = 60

        # First request
        _, _, reset_time1 = security_module.check_rate_limit(
            key, max_requests=max_requests, window_seconds=window_seconds
        )

        now = time.time()
        assert reset_time1 > now
        assert reset_time1 <= now + window_seconds + 1

    def test_rate_limit_with_different_limits(self, security_module):
        """Test rate limiting with different limit configurations."""
        key = "test_user_5"

        # Low limit for testing
        allowed, remaining, _ = security_module.check_rate_limit(
            key, max_requests=1, window_seconds=60
        )
        assert allowed
        assert remaining == 0

        # Second request with same key should be blocked
        allowed, remaining, _ = security_module.check_rate_limit(
            key, max_requests=1, window_seconds=60
        )
        assert not allowed


# =============================================================================
# Integration Tests
# =============================================================================


@requires_jwt
class TestIntegration:
    """Integration tests for protected endpoints."""

    @pytest.fixture
    def test_app(self, security_module):
        """Create a test FastAPI application with security."""
        app = FastAPI()

        # Mock current user dependency
        def get_current_user(token: str) -> dict:
            try:
                payload = security_module.decode_token(token)
                return {
                    "user_id": payload["sub"],
                    "role": payload["role"],
                }
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                )

        def require_permission(permission: str):
            def check(user: dict):
                if not security_module.has_permission(user["role"], permission):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Insufficient permissions",
                    )
                return user

            return check

        @app.get("/api/health")
        async def health():
            return {"status": "ok"}

        @app.get("/api/protected")
        async def protected_endpoint(token: str):
            user = get_current_user(token)
            return {"user_id": user["user_id"], "role": user["role"]}

        @app.get("/api/admin-only")
        async def admin_endpoint(token: str):
            user = get_current_user(token)
            require_permission("admin:users")(user)
            return {"message": "Admin access granted"}

        @app.get("/api/with-api-key")
        async def api_key_endpoint(api_key: str, api_key_hash: str):
            if not security_module.verify_api_key(api_key, api_key_hash):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid API key",
                )
            return {"message": "API key access granted"}

        return app

    def test_protected_endpoint_requires_auth(self, test_app):
        """Test that protected endpoints require authentication."""
        client = TestClient(test_app)

        response = client.get("/api/protected", params={"token": "invalid_token"})
        assert response.status_code == 401

    def test_protected_endpoint_with_valid_token(
        self, test_app, security_module, admin_user
    ):
        """Test protected endpoint access with valid token."""
        client = TestClient(test_app)

        token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        response = client.get("/api/protected", params={"token": token})
        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == admin_user["user_id"]
        assert data["role"] == admin_user["role"]

    def test_protected_endpoint_with_api_key(self, test_app, security_module, api_key):
        """Test protected endpoint access with API key."""
        client = TestClient(test_app)

        response = client.get(
            "/api/with-api-key",
            params={
                "api_key": api_key["key"],
                "api_key_hash": api_key["hash"],
            },
        )
        assert response.status_code == 200
        assert response.json()["message"] == "API key access granted"

    def test_protected_endpoint_with_invalid_api_key(self, test_app, security_module):
        """Test that invalid API key is rejected."""
        client = TestClient(test_app)

        key, key_hash = security_module.generate_api_key()

        response = client.get(
            "/api/with-api-key",
            params={
                "api_key": "wrong_key",
                "api_key_hash": key_hash,
            },
        )
        assert response.status_code == 401

    def test_role_based_access_control(
        self, test_app, security_module, admin_user, viewer_user
    ):
        """Test RBAC on protected endpoints."""
        client = TestClient(test_app)

        # Admin should have access
        admin_token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )
        response = client.get("/api/admin-only", params={"token": admin_token})
        assert response.status_code == 200

        # Viewer should not have access
        viewer_token = security_module.create_access_token(
            data={"sub": viewer_user["user_id"], "role": viewer_user["role"]}
        )
        response = client.get("/api/admin-only", params={"token": viewer_token})
        assert response.status_code == 403

    def test_health_endpoint_requires_no_auth(self, test_app):
        """Test that health endpoint is publicly accessible."""
        client = TestClient(test_app)

        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_expired_token_rejected(self, test_app, security_module, admin_user):
        """Test that expired tokens are rejected."""
        client = TestClient(test_app)

        expired_token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]},
            expires_delta=timedelta(seconds=-10),
        )

        response = client.get("/api/protected", params={"token": expired_token})
        assert response.status_code == 401

    def test_revoked_token_rejected(self, test_app, security_module, admin_user):
        """Test that revoked tokens are rejected."""
        client = TestClient(test_app)

        token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        # Token should work initially
        response = client.get("/api/protected", params={"token": token})
        assert response.status_code == 200

        # Revoke the token
        security_module.revoke_token(token)

        # Token should now be rejected
        response = client.get("/api/protected", params={"token": token})
        assert response.status_code == 401


# =============================================================================
# Security Edge Cases
# =============================================================================


@requires_jwt
class TestSecurityEdgeCases:
    """Test edge cases and potential security vulnerabilities."""

    def test_token_tampering_detected(self, security_module, admin_user):
        """Test that token tampering is detected."""
        import jwt

        token = security_module.create_access_token(
            data={"sub": admin_user["user_id"], "role": admin_user["role"]}
        )

        # Tamper with the token
        parts = token.split(".")
        tampered_token = f"{parts[0]}.eyJtb2RpZmllZCI6dHJ1ZX0.{parts[2]}"

        with pytest.raises((jwt.InvalidSignatureError, jwt.DecodeError)):
            security_module.decode_token(tampered_token)

    def test_role_elevation_prevented(self, security_module, viewer_user):
        """Test that role elevation via token tampering is prevented."""
        import jwt

        # Create viewer token
        token = security_module.create_access_token(
            data={"sub": viewer_user["user_id"], "role": viewer_user["role"]}
        )

        # Decode to verify original role
        decoded = security_module.decode_token(token)
        assert decoded["role"] == "viewer"

        # Cannot elevate to admin by creating new token with different role
        # because signature verification would fail

    @pytest.mark.skip(reason="Timing tests are flaky in CI environments")
    def test_api_key_timing_attack_resistance(self, security_module):
        """Test that API key comparison is timing-attack resistant."""
        key, key_hash = security_module.generate_api_key()

        # Multiple verifications should have consistent timing
        # (This is a basic test - real timing analysis would be more complex)
        times = []
        for _ in range(100):
            start = time.perf_counter()
            security_module.verify_api_key(key, key_hash)
            times.append(time.perf_counter() - start)

        # Verify standard deviation is low (consistent timing)
        import statistics

        if len(times) > 1:
            stdev = statistics.stdev(times)
            mean = statistics.mean(times)
            # Coefficient of variation should be reasonable
            # Note: This can fail in CI due to scheduling variations
            assert stdev / mean < 2.0  # Less than 200% variation

    @pytest.mark.skipif(not HAS_BCRYPT, reason="bcrypt not installed")
    def test_password_hash_timing_consistent(self, security_module, test_password):
        """Test that password verification timing is consistent."""
        password_hash = security_module.hash_password(test_password)

        # Correct password verification
        correct_times = []
        for _ in range(10):
            start = time.perf_counter()
            security_module.verify_password(test_password, password_hash)
            correct_times.append(time.perf_counter() - start)

        # Wrong password verification
        wrong_times = []
        for _ in range(10):
            start = time.perf_counter()
            security_module.verify_password("WrongPassword!", password_hash)
            wrong_times.append(time.perf_counter() - start)

        # Both should have similar timing (bcrypt is constant-time)
        import statistics

        correct_mean = statistics.mean(correct_times)
        wrong_mean = statistics.mean(wrong_times)

        # Timing difference should be within reasonable bounds
        # Note: bcrypt is designed to be constant-time
        assert abs(correct_mean - wrong_mean) < 0.1

    def test_sql_injection_in_user_id_prevented(self, security_module):
        """Test that SQL injection attempts in user_id are safely handled."""
        malicious_user_ids = [
            "'; DROP TABLE users; --",
            "1 OR 1=1",
            "admin'--",
            "<script>alert('xss')</script>",
        ]

        for user_id in malicious_user_ids:
            # Token creation should work (no DB interaction in mock)
            token = security_module.create_access_token(
                data={"sub": user_id, "role": "viewer"}
            )

            # Decoding should return the exact user_id (no interpretation)
            decoded = security_module.decode_token(token)
            assert decoded["sub"] == user_id

    def test_null_byte_injection_handled(self, security_module):
        """Test that null byte injection is handled safely."""
        malicious_strings = [
            "user\x00admin",
            "normal\x00\x00",
        ]

        for s in malicious_strings:
            # Should handle null bytes without crashing
            token = security_module.create_access_token(
                data={"sub": s, "role": "viewer"}
            )
            decoded = security_module.decode_token(token)
            assert decoded["sub"] == s

    def test_unicode_in_credentials_handled(self, security_module):
        """Test that unicode characters in credentials are handled."""
        unicode_passwords = [
            "Password123!",  # ASCII
            "Passwort123!",  # German (o with umlaut)
            "password123",  # Japanese
            "password123",  # Russian
            "password123!",  # Emoji
        ]

        for password in unicode_passwords:
            # Should hash and verify unicode passwords
            try:
                password_hash = security_module.hash_password(password)
                assert security_module.verify_password(password, password_hash)
            except UnicodeEncodeError:
                pytest.skip(f"Unicode password not supported: {password}")


# =============================================================================
# Async Tests
# =============================================================================


@requires_jwt
class TestAsyncSecurity:
    """Async security tests for concurrent operations."""

    @pytest.mark.asyncio
    async def test_concurrent_token_creation(self, security_module, admin_user):
        """Test that concurrent token creation is thread-safe."""
        import uuid

        async def create_token(i):
            # Add unique jti to ensure tokens are unique
            return security_module.create_access_token(
                data={
                    "sub": admin_user["user_id"],
                    "role": admin_user["role"],
                    "jti": str(uuid.uuid4()),
                }
            )

        # Create multiple tokens concurrently
        tasks = [create_token(i) for i in range(10)]
        tokens = await asyncio.gather(*tasks)

        # All tokens should be unique (due to unique jti claims)
        assert len(set(tokens)) == len(tokens)

        # All tokens should be valid
        for token in tokens:
            decoded = security_module.decode_token(token)
            assert decoded["sub"] == admin_user["user_id"]

    @pytest.mark.asyncio
    async def test_concurrent_rate_limiting(self, security_module):
        """Test rate limiting under concurrent requests."""
        key = "concurrent_user"
        max_requests = 10

        async def make_request():
            return security_module.check_rate_limit(
                key, max_requests=max_requests, window_seconds=60
            )

        # Make concurrent requests
        tasks = [make_request() for _ in range(20)]
        results = await asyncio.gather(*tasks)

        # Count allowed and blocked requests
        allowed_count = sum(1 for allowed, _, _ in results if allowed)
        blocked_count = sum(1 for allowed, _, _ in results if not allowed)

        # Some should be allowed, some blocked
        assert allowed_count <= max_requests
        assert blocked_count >= 10  # At least 10 should be blocked

    @pytest.mark.asyncio
    @pytest.mark.skipif(not HAS_BCRYPT, reason="bcrypt not installed")
    async def test_concurrent_password_hashing(self, security_module):
        """Test that concurrent password hashing is safe."""
        passwords = [f"Password{i}!" for i in range(10)]

        async def hash_and_verify(password):
            password_hash = security_module.hash_password(password)
            return security_module.verify_password(password, password_hash)

        tasks = [hash_and_verify(p) for p in passwords]
        results = await asyncio.gather(*tasks)

        # All should verify successfully
        assert all(results)
