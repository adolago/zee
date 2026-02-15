"""
Stanley Authentication Models

User models, Pydantic schemas, and in-memory user store for authentication.
"""

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4


def _utcnow() -> datetime:
    """Get current UTC time as timezone-aware datetime."""
    return datetime.now(timezone.utc)


from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

try:
    import email_validator
    from pydantic import EmailStr
except ImportError:
    EmailStr = str

from stanley.api.auth.passwords import validate_password_strength as _validate_password


def _check_password_strength(password: str) -> str:
    """
    Validate password meets security requirements.

    Wrapper around passwords.validate_password_strength for use in Pydantic validators.

    Args:
        password: The password to validate

    Returns:
        The validated password

    Raises:
        ValueError: If password does not meet requirements
    """
    is_valid, errors = _validate_password(password)
    if not is_valid:
        raise ValueError("; ".join(errors))
    return password


# =============================================================================
# Database Model (Dataclass for development)
# =============================================================================


@dataclass
class User:
    """
    User database model.

    Represents a user in the system with authentication and authorization data.
    Uses dataclass for development; can be replaced with SQLAlchemy/other ORM.
    """

    id: str = field(default_factory=lambda: str(uuid4()))
    email: str = ""
    hashed_password: str = ""
    full_name: Optional[str] = None
    roles: list[str] = field(default_factory=lambda: ["user"])
    is_active: bool = True
    is_verified: bool = False
    created_at: datetime = field(default_factory=_utcnow)
    updated_at: datetime = field(default_factory=_utcnow)
    last_login: Optional[datetime] = None

    def has_role(self, role: str) -> bool:
        """Check if user has a specific role."""
        return role in self.roles

    def has_any_role(self, roles: list[str]) -> bool:
        """Check if user has any of the specified roles."""
        return any(role in self.roles for role in roles)

    def to_dict(self) -> dict:
        """Convert user to dictionary representation."""
        return {
            "id": self.id,
            "email": self.email,
            "hashed_password": self.hashed_password,
            "full_name": self.full_name,
            "roles": self.roles,
            "is_active": self.is_active,
            "is_verified": self.is_verified,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }


@dataclass
class APIKey:
    """
    API Key database model.

    Represents an API key for programmatic access.
    """

    id: str = field(default_factory=lambda: str(uuid4()))
    user_id: str = ""
    name: str = ""
    key_hash: str = ""
    key_prefix: str = ""  # First 8 chars for identification
    scopes: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=_utcnow)
    expires_at: Optional[datetime] = None
    last_used: Optional[datetime] = None
    is_active: bool = True


# =============================================================================
# Pydantic Schemas - User Management
# =============================================================================


class UserCreate(BaseModel):
    """Schema for creating a new user."""

    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr = Field(
        ..., description="User email address", examples=["user@example.com"]
    )
    password: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="User password (min 8 chars, must include uppercase, lowercase, digit, special char)",
        examples=["SecureP@ss123"],
    )
    full_name: Optional[str] = Field(
        None,
        min_length=1,
        max_length=255,
        description="User full name",
        examples=["John Doe"],
    )

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        """Validate password meets strength requirements."""
        return _check_password_strength(v)


class UserUpdate(BaseModel):
    """Schema for updating user profile."""

    model_config = ConfigDict(str_strip_whitespace=True)

    email: Optional[EmailStr] = Field(
        None, description="Updated email address", examples=["newemail@example.com"]
    )
    full_name: Optional[str] = Field(
        None,
        min_length=1,
        max_length=255,
        description="Updated full name",
        examples=["Jane Doe"],
    )

    @model_validator(mode="after")
    def check_at_least_one_field(self) -> "UserUpdate":
        """Ensure at least one field is provided for update."""
        if self.email is None and self.full_name is None:
            raise ValueError("At least one field must be provided for update")
        return self


class UserResponse(BaseModel):
    """Schema for user response (public data only)."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(..., description="User unique identifier")
    email: EmailStr = Field(..., description="User email address")
    full_name: Optional[str] = Field(None, description="User full name")
    roles: list[str] = Field(default=["user"], description="User roles")
    is_active: bool = Field(default=True, description="Whether user account is active")
    is_verified: bool = Field(default=False, description="Whether email is verified")
    created_at: datetime = Field(..., description="Account creation timestamp")


class UserInDB(UserResponse):
    """Schema for user with hashed password (internal use only)."""

    hashed_password: str = Field(..., description="Hashed password")
    updated_at: datetime = Field(..., description="Last update timestamp")
    last_login: Optional[datetime] = Field(None, description="Last login timestamp")


# =============================================================================
# Pydantic Schemas - Authentication
# =============================================================================


class LoginRequest(BaseModel):
    """Schema for login request."""

    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr = Field(
        ..., description="User email address", examples=["user@example.com"]
    )
    password: str = Field(
        ..., min_length=1, description="User password", examples=["SecureP@ss123"]
    )


class LoginResponse(BaseModel):
    """Schema for successful login response."""

    access_token: str = Field(..., description="JWT access token")
    refresh_token: str = Field(
        ..., description="JWT refresh token for obtaining new access tokens"
    )
    token_type: str = Field(
        default="bearer", description="Token type (always 'bearer')"
    )
    expires_in: int = Field(..., description="Access token expiration time in seconds")
    user: UserResponse = Field(..., description="Authenticated user data")


class TokenRefreshRequest(BaseModel):
    """Schema for token refresh request."""

    refresh_token: str = Field(
        ...,
        min_length=1,
        description="Refresh token obtained from login",
        examples=["eyJhbGciOiJIUzI1NiIs..."],
    )


class TokenRefreshResponse(BaseModel):
    """Schema for token refresh response."""

    access_token: str = Field(..., description="New JWT access token")
    token_type: str = Field(default="bearer", description="Token type")
    expires_in: int = Field(..., description="Access token expiration time in seconds")


# =============================================================================
# Pydantic Schemas - Password Reset
# =============================================================================


class PasswordResetRequest(BaseModel):
    """Schema for password reset request."""

    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr = Field(
        ...,
        description="Email address for password reset",
        examples=["user@example.com"],
    )


class PasswordResetConfirm(BaseModel):
    """Schema for confirming password reset with new password."""

    model_config = ConfigDict(str_strip_whitespace=True)

    token: str = Field(..., min_length=1, description="Password reset token from email")
    new_password: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="New password",
        examples=["NewSecureP@ss456"],
    )

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """Validate new password meets strength requirements."""
        return _check_password_strength(v)


# =============================================================================
# Pydantic Schemas - API Keys
# =============================================================================


class APIKeyCreate(BaseModel):
    """Schema for creating a new API key."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="API key name/description",
        examples=["Production API Key"],
    )
    scopes: list[str] = Field(
        default=["read"],
        description="Permissions for this API key",
        examples=[["read", "write", "admin"]],
    )
    expires_at: Optional[datetime] = Field(
        None, description="Optional expiration date for the key"
    )

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: list[str]) -> list[str]:
        """Validate scopes are from allowed list."""
        allowed_scopes = {"read", "write", "admin", "trading", "research", "portfolio"}
        invalid = set(v) - allowed_scopes
        if invalid:
            raise ValueError(f"Invalid scopes: {invalid}. Allowed: {allowed_scopes}")
        return v


class APIKeyResponse(BaseModel):
    """Schema for API key response."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(..., description="API key unique identifier")
    name: str = Field(..., description="API key name")
    key: Optional[str] = Field(
        None, description="Full API key (only returned on creation)"
    )
    key_prefix: str = Field(
        ..., description="First 8 characters of key for identification"
    )
    scopes: list[str] = Field(default=[], description="API key permissions")
    created_at: datetime = Field(..., description="Key creation timestamp")
    expires_at: Optional[datetime] = Field(None, description="Key expiration timestamp")
    last_used: Optional[datetime] = Field(None, description="Last usage timestamp")
    is_active: bool = Field(default=True, description="Whether key is active")


# =============================================================================
# In-Memory User Store (Development Only)
# =============================================================================


class UserStore:
    """
    In-memory user store for development and testing.

    Provides CRUD operations for users without a database.
    Replace with a real database implementation for production.
    """

    def __init__(self) -> None:
        """Initialize empty user store."""
        self._users: dict[str, User] = {}
        self._email_index: dict[str, str] = {}  # email -> user_id
        self._api_keys: dict[str, APIKey] = {}
        self._api_key_hash_index: dict[str, str] = {}  # key_hash -> api_key_id

    def create_user(
        self,
        email: str,
        hashed_password: str,
        full_name: Optional[str] = None,
        roles: Optional[list[str]] = None,
    ) -> User:
        """
        Create a new user.

        Args:
            email: User email address
            hashed_password: Pre-hashed password
            full_name: Optional full name
            roles: Optional list of roles (defaults to ["user"])

        Returns:
            Created User object

        Raises:
            ValueError: If email already exists
        """
        if email.lower() in self._email_index:
            raise ValueError(f"User with email {email} already exists")

        user = User(
            email=email.lower(),
            hashed_password=hashed_password,
            full_name=full_name,
            roles=roles or ["user"],
        )

        self._users[user.id] = user
        self._email_index[email.lower()] = user.id

        return user

    def get_user_by_id(self, user_id: str) -> Optional[User]:
        """
        Get user by ID.

        Args:
            user_id: User unique identifier

        Returns:
            User object or None if not found
        """
        return self._users.get(user_id)

    def get_user_by_email(self, email: str) -> Optional[User]:
        """
        Get user by email address.

        Args:
            email: User email address

        Returns:
            User object or None if not found
        """
        user_id = self._email_index.get(email.lower())
        if user_id:
            return self._users.get(user_id)
        return None

    def update_user(
        self,
        user_id: str,
        email: Optional[str] = None,
        full_name: Optional[str] = None,
        hashed_password: Optional[str] = None,
        roles: Optional[list[str]] = None,
        is_active: Optional[bool] = None,
        is_verified: Optional[bool] = None,
        last_login: Optional[datetime] = None,
    ) -> Optional[User]:
        """
        Update user fields.

        Args:
            user_id: User unique identifier
            email: Optional new email
            full_name: Optional new full name
            hashed_password: Optional new hashed password
            roles: Optional new roles list
            is_active: Optional active status
            is_verified: Optional verified status
            last_login: Optional last login timestamp

        Returns:
            Updated User object or None if not found

        Raises:
            ValueError: If new email already exists for another user
        """
        user = self._users.get(user_id)
        if not user:
            return None

        # Handle email change
        if email is not None and email.lower() != user.email:
            if email.lower() in self._email_index:
                raise ValueError(f"Email {email} is already in use")
            # Update email index
            del self._email_index[user.email]
            self._email_index[email.lower()] = user_id
            user.email = email.lower()

        # Update other fields
        if full_name is not None:
            user.full_name = full_name
        if hashed_password is not None:
            user.hashed_password = hashed_password
        if roles is not None:
            user.roles = roles
        if is_active is not None:
            user.is_active = is_active
        if is_verified is not None:
            user.is_verified = is_verified
        if last_login is not None:
            user.last_login = last_login

        user.updated_at = _utcnow()

        return user

    def delete_user(self, user_id: str) -> bool:
        """
        Delete a user.

        Args:
            user_id: User unique identifier

        Returns:
            True if user was deleted, False if not found
        """
        user = self._users.get(user_id)
        if not user:
            return False

        del self._email_index[user.email]
        del self._users[user_id]

        # Also delete user's API keys
        keys_to_delete = [
            key_id for key_id, key in self._api_keys.items() if key.user_id == user_id
        ]
        for key_id in keys_to_delete:
            key = self._api_keys[key_id]
            if key.key_hash in self._api_key_hash_index:
                del self._api_key_hash_index[key.key_hash]
            del self._api_keys[key_id]

        return True

    def list_users(
        self,
        skip: int = 0,
        limit: int = 100,
        is_active: Optional[bool] = None,
    ) -> list[User]:
        """
        List users with pagination and optional filtering.

        Args:
            skip: Number of records to skip
            limit: Maximum records to return
            is_active: Optional filter by active status

        Returns:
            List of User objects
        """
        users = list(self._users.values())

        if is_active is not None:
            users = [u for u in users if u.is_active == is_active]

        # Sort by created_at descending
        users.sort(key=lambda u: u.created_at, reverse=True)

        return users[skip : skip + limit]

    def count_users(self, is_active: Optional[bool] = None) -> int:
        """
        Count total users.

        Args:
            is_active: Optional filter by active status

        Returns:
            Number of users
        """
        if is_active is None:
            return len(self._users)
        return sum(1 for u in self._users.values() if u.is_active == is_active)

    # API Key methods

    def create_api_key(
        self,
        user_id: str,
        name: str,
        scopes: list[str],
        expires_at: Optional[datetime] = None,
    ) -> tuple[APIKey, str]:
        """
        Create a new API key.

        Args:
            user_id: Owner user ID
            name: Key name/description
            scopes: Key permissions
            expires_at: Optional expiration date

        Returns:
            Tuple of (APIKey object, raw key string)

        Raises:
            ValueError: If user does not exist
        """
        if user_id not in self._users:
            raise ValueError(f"User {user_id} does not exist")

        # Generate raw key
        raw_key = f"sk_{secrets.token_urlsafe(32)}"
        key_prefix = raw_key[:10]
        # In production, this would be properly hashed
        key_hash = f"hash_{raw_key}"

        api_key = APIKey(
            user_id=user_id,
            name=name,
            key_hash=key_hash,
            key_prefix=key_prefix,
            scopes=scopes,
            expires_at=expires_at,
        )

        self._api_keys[api_key.id] = api_key
        self._api_key_hash_index[key_hash] = api_key.id

        return api_key, raw_key

    def get_api_key_by_id(self, key_id: str) -> Optional[APIKey]:
        """Get API key by ID."""
        return self._api_keys.get(key_id)

    def get_api_key_by_raw_key(self, raw_key: str) -> Optional[APIKey]:
        """Get API key by raw key value."""
        # In production, this would hash the raw key and lookup
        key_hash = f"hash_{raw_key}"
        key_id = self._api_key_hash_index.get(key_hash)
        if key_id:
            return self._api_keys.get(key_id)
        return None

    def list_user_api_keys(self, user_id: str) -> list[APIKey]:
        """List all API keys for a user."""
        return [key for key in self._api_keys.values() if key.user_id == user_id]

    def delete_api_key(self, key_id: str, user_id: str) -> bool:
        """Delete an API key (must belong to user)."""
        key = self._api_keys.get(key_id)
        if not key or key.user_id != user_id:
            return False

        if key.key_hash in self._api_key_hash_index:
            del self._api_key_hash_index[key.key_hash]
        del self._api_keys[key_id]

        return True

    def update_api_key_last_used(self, key_id: str) -> None:
        """Update the last_used timestamp for an API key."""
        key = self._api_keys.get(key_id)
        if key:
            key.last_used = _utcnow()


# Global store instance for development
_user_store: Optional[UserStore] = None


def get_user_store() -> UserStore:
    """
    Get or create the global user store instance.

    Returns:
        UserStore singleton instance
    """
    global _user_store
    if _user_store is None:
        _user_store = UserStore()
    return _user_store


def reset_user_store() -> None:
    """Reset the global user store (for testing)."""
    global _user_store
    _user_store = None
