"""
Stanley API Key Management

Provides secure API key generation, hashing, verification, and lifecycle management
for programmatic access to the Stanley investment platform.

API Key Format:
- Production: sk_live_[32 random alphanumeric chars]
- Testing: sk_test_[32 random alphanumeric chars]

Security Notes:
- Keys are hashed using SHA-256 before storage
- Full key is only shown once at creation time
- Key rotation creates new key and deprecates old one
"""

import hashlib
import logging
import secrets
import string
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# =============================================================================
# Constants
# =============================================================================

API_KEY_PREFIX_LIVE = "sk_live_"
API_KEY_PREFIX_TEST = "sk_test_"
API_KEY_RANDOM_LENGTH = 32
API_KEY_ALPHABET = string.ascii_letters + string.digits


# =============================================================================
# Enums
# =============================================================================


class APIKeyScope(str, Enum):
    """Available API key permission scopes."""

    READ = "read"  # Read-only access to market data, analytics
    WRITE = "write"  # Write access to notes, watchlists, settings
    TRADE = "trade"  # Access to trading signals and execution
    ADMIN = "admin"  # Full administrative access

    @classmethod
    def all_scopes(cls) -> List["APIKeyScope"]:
        """Return all available scopes."""
        return list(cls)

    @classmethod
    def default_scopes(cls) -> List["APIKeyScope"]:
        """Return default scopes for new keys."""
        return [cls.READ]


# =============================================================================
# Core Functions
# =============================================================================


def generate_api_key(prefix: str = "live") -> Tuple[str, str]:
    """
    Generate a new API key and its hash.

    Args:
        prefix: Key environment prefix - "live" for production, "test" for testing

    Returns:
        Tuple of (full_key, key_hash)
        - full_key: The complete API key to give to the user (only shown once)
        - key_hash: SHA-256 hash of the key for storage

    Example:
        >>> full_key, key_hash = generate_api_key("live")
        >>> full_key
        'stanley_live_EXAMPLE_KEY_REPLACE_ME_1234'
        >>> len(key_hash)
        64
    """
    if prefix not in ("live", "test"):
        raise ValueError("Prefix must be 'live' or 'test'")

    key_prefix = API_KEY_PREFIX_LIVE if prefix == "live" else API_KEY_PREFIX_TEST
    random_part = "".join(
        secrets.choice(API_KEY_ALPHABET) for _ in range(API_KEY_RANDOM_LENGTH)
    )
    full_key = f"{key_prefix}{random_part}"
    key_hash = hash_api_key(full_key)

    logger.info("Generated new API key with prefix: %s", key_prefix)
    return full_key, key_hash


def hash_api_key(key: str) -> str:
    """
    Hash an API key using SHA-256.

    Args:
        key: The full API key to hash

    Returns:
        Hexadecimal string of the SHA-256 hash (64 characters)

    Note:
        Uses SHA-256 which is sufficient for API key hashing since keys
        are already high-entropy random strings.
    """
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def verify_api_key(key: str, key_hash: str) -> bool:
    """
    Verify an API key against its stored hash.

    Args:
        key: The API key provided by the client
        key_hash: The stored hash to verify against

    Returns:
        True if the key matches the hash, False otherwise

    Note:
        Uses constant-time comparison to prevent timing attacks.
    """
    computed_hash = hash_api_key(key)
    return secrets.compare_digest(computed_hash, key_hash)


def validate_api_key_format(key: str) -> bool:
    """
    Validate the format of an API key.

    Args:
        key: The API key to validate

    Returns:
        True if the key has valid format, False otherwise
    """
    if not key:
        return False

    valid_prefixes = (API_KEY_PREFIX_LIVE, API_KEY_PREFIX_TEST)
    if not key.startswith(valid_prefixes):
        return False

    # Extract random part and validate length and characters
    prefix_len = len(API_KEY_PREFIX_LIVE)  # Both prefixes are same length
    random_part = key[prefix_len:]

    if len(random_part) != API_KEY_RANDOM_LENGTH:
        return False

    return all(c in API_KEY_ALPHABET for c in random_part)


# =============================================================================
# Data Classes
# =============================================================================


@dataclass
class ManagedAPIKey:
    """
    Represents an API key with metadata for the API Key Manager.

    This is a more feature-rich version compared to the basic APIKey in models.py,
    with additional tracking and management capabilities.

    Attributes:
        id: Unique identifier for the key
        name: Human-readable name for the key
        key_hash: SHA-256 hash of the actual key
        user_id: ID of the user who owns this key
        scopes: List of permission scopes
        created_at: Timestamp when key was created
        expires_at: Optional expiration timestamp
        last_used: Timestamp of last API call using this key
        request_count: Total number of requests made with this key
        is_active: Whether the key is currently active
        description: Optional description of key purpose
        allowed_ips: Optional list of allowed IP addresses
        rate_limit: Optional custom rate limit (requests per minute)
    """

    id: str
    name: str
    key_hash: str
    user_id: str
    scopes: List[APIKeyScope] = field(default_factory=lambda: [APIKeyScope.READ])
    created_at: datetime = field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None
    last_used: Optional[datetime] = None
    request_count: int = 0
    is_active: bool = True
    description: Optional[str] = None
    allowed_ips: Optional[List[str]] = None
    rate_limit: Optional[int] = None  # requests per minute

    def is_expired(self) -> bool:
        """Check if the key has expired."""
        if self.expires_at is None:
            return False
        return datetime.utcnow() > self.expires_at

    def is_valid(self) -> bool:
        """Check if the key is valid (active and not expired)."""
        return self.is_active and not self.is_expired()

    def has_scope(self, scope: APIKeyScope) -> bool:
        """Check if the key has a specific scope."""
        if APIKeyScope.ADMIN in self.scopes:
            return True  # Admin has all permissions
        return scope in self.scopes

    def has_any_scope(self, scopes: List[APIKeyScope]) -> bool:
        """Check if the key has any of the specified scopes."""
        return any(self.has_scope(scope) for scope in scopes)

    def has_all_scopes(self, scopes: List[APIKeyScope]) -> bool:
        """Check if the key has all of the specified scopes."""
        return all(self.has_scope(scope) for scope in scopes)

    def to_dict(self, include_hash: bool = False) -> Dict:
        """
        Convert to dictionary representation.

        Args:
            include_hash: Whether to include the key hash (for internal use only)

        Returns:
            Dictionary representation of the API key
        """
        result = {
            "id": self.id,
            "name": self.name,
            "user_id": self.user_id,
            "scopes": [s.value for s in self.scopes],
            "created_at": self.created_at.isoformat() + "Z",
            "expires_at": (
                self.expires_at.isoformat() + "Z" if self.expires_at else None
            ),
            "last_used": self.last_used.isoformat() + "Z" if self.last_used else None,
            "request_count": self.request_count,
            "is_active": self.is_active,
            "is_expired": self.is_expired(),
            "is_valid": self.is_valid(),
            "description": self.description,
            "allowed_ips": self.allowed_ips,
            "rate_limit": self.rate_limit,
        }
        if include_hash:
            result["key_hash"] = self.key_hash
        return result

    @classmethod
    def from_dict(cls, data: Dict) -> "ManagedAPIKey":
        """Create a ManagedAPIKey from a dictionary."""
        scopes = [APIKeyScope(s) for s in data.get("scopes", ["read"])]
        return cls(
            id=data["id"],
            name=data["name"],
            key_hash=data["key_hash"],
            user_id=data["user_id"],
            scopes=scopes,
            created_at=datetime.fromisoformat(data["created_at"].rstrip("Z")),
            expires_at=(
                datetime.fromisoformat(data["expires_at"].rstrip("Z"))
                if data.get("expires_at")
                else None
            ),
            last_used=(
                datetime.fromisoformat(data["last_used"].rstrip("Z"))
                if data.get("last_used")
                else None
            ),
            request_count=data.get("request_count", 0),
            is_active=data.get("is_active", True),
            description=data.get("description"),
            allowed_ips=data.get("allowed_ips"),
            rate_limit=data.get("rate_limit"),
        )


@dataclass
class APIKeyCreateResult:
    """Result of creating a new API key."""

    api_key: ManagedAPIKey
    full_key: str  # Only available at creation time

    def to_dict(self) -> Dict:
        """Convert to dictionary with full key shown."""
        result = self.api_key.to_dict()
        result["key"] = self.full_key
        result["key_prefix"] = self.full_key[:12] + "..."  # Show prefix for reference
        return result


# =============================================================================
# API Key Manager
# =============================================================================


class APIKeyManager:
    """
    Manages API key lifecycle including creation, rotation, and revocation.

    This implementation uses in-memory storage. For production, extend this
    class to use database persistence.

    Usage:
        manager = APIKeyManager()
        result = manager.create_key(
            user_id="user_123",
            name="My Trading Bot",
            scopes=[APIKeyScope.READ, APIKeyScope.TRADE]
        )
        print(f"Save this key: {result.full_key}")

        # Later, verify a key
        api_key = manager.verify_and_get_key("sk_live_...")
        if api_key and api_key.has_scope(APIKeyScope.TRADE):
            # Allow trading operations
            pass
    """

    def __init__(self):
        """Initialize the API key manager with in-memory storage."""
        # Storage: key_hash -> ManagedAPIKey
        self._keys: Dict[str, ManagedAPIKey] = {}
        # Index: user_id -> list of key_hashes
        self._user_keys: Dict[str, List[str]] = {}
        # Index: key_id -> key_hash
        self._id_to_hash: Dict[str, str] = {}

    def create_key(
        self,
        user_id: str,
        name: str,
        scopes: Optional[List[APIKeyScope]] = None,
        expires_in_days: Optional[int] = None,
        description: Optional[str] = None,
        allowed_ips: Optional[List[str]] = None,
        rate_limit: Optional[int] = None,
        prefix: str = "live",
    ) -> APIKeyCreateResult:
        """
        Create a new API key.

        Args:
            user_id: ID of the user creating the key
            name: Human-readable name for the key
            scopes: List of permission scopes (defaults to READ only)
            expires_in_days: Optional number of days until expiration
            description: Optional description of key purpose
            allowed_ips: Optional list of allowed IP addresses
            rate_limit: Optional rate limit in requests per minute
            prefix: Key prefix - "live" or "test"

        Returns:
            APIKeyCreateResult containing the key metadata and the full key
            (only shown once at creation)

        Raises:
            ValueError: If invalid parameters are provided
        """
        if not user_id:
            raise ValueError("user_id is required")
        if not name:
            raise ValueError("name is required")

        # Generate key and hash
        full_key, key_hash = generate_api_key(prefix)

        # Generate unique ID
        key_id = f"key_{secrets.token_hex(8)}"

        # Calculate expiration
        expires_at = None
        if expires_in_days is not None:
            if expires_in_days <= 0:
                raise ValueError("expires_in_days must be positive")
            expires_at = datetime.utcnow() + timedelta(days=expires_in_days)

        # Create API key object
        api_key = ManagedAPIKey(
            id=key_id,
            name=name,
            key_hash=key_hash,
            user_id=user_id,
            scopes=scopes or APIKeyScope.default_scopes(),
            expires_at=expires_at,
            description=description,
            allowed_ips=allowed_ips,
            rate_limit=rate_limit,
        )

        # Store the key
        self._keys[key_hash] = api_key
        self._id_to_hash[key_id] = key_hash

        # Update user index
        if user_id not in self._user_keys:
            self._user_keys[user_id] = []
        self._user_keys[user_id].append(key_hash)

        logger.info(
            "Created API key %s for user %s with scopes %s",
            key_id,
            user_id,
            [s.value for s in api_key.scopes],
        )

        return APIKeyCreateResult(api_key=api_key, full_key=full_key)

    def revoke_key(self, key_id: str) -> bool:
        """
        Revoke an API key by marking it as inactive.

        Args:
            key_id: The ID of the key to revoke

        Returns:
            True if the key was revoked, False if not found
        """
        key_hash = self._id_to_hash.get(key_id)
        if not key_hash:
            logger.warning("Attempted to revoke non-existent key: %s", key_id)
            return False

        api_key = self._keys.get(key_hash)
        if not api_key:
            return False

        api_key.is_active = False
        logger.info("Revoked API key %s for user %s", key_id, api_key.user_id)
        return True

    def delete_key(self, key_id: str) -> bool:
        """
        Permanently delete an API key.

        Args:
            key_id: The ID of the key to delete

        Returns:
            True if the key was deleted, False if not found
        """
        key_hash = self._id_to_hash.get(key_id)
        if not key_hash:
            return False

        api_key = self._keys.get(key_hash)
        if not api_key:
            return False

        # Remove from all indexes
        del self._keys[key_hash]
        del self._id_to_hash[key_id]

        if api_key.user_id in self._user_keys:
            self._user_keys[api_key.user_id] = [
                h for h in self._user_keys[api_key.user_id] if h != key_hash
            ]

        logger.info("Deleted API key %s for user %s", key_id, api_key.user_id)
        return True

    def rotate_key(
        self,
        key_id: str,
        expires_in_days: Optional[int] = None,
    ) -> Optional[APIKeyCreateResult]:
        """
        Rotate an API key by creating a new one and revoking the old one.

        Args:
            key_id: The ID of the key to rotate
            expires_in_days: Optional new expiration period

        Returns:
            APIKeyCreateResult for the new key, or None if old key not found
        """
        key_hash = self._id_to_hash.get(key_id)
        if not key_hash:
            logger.warning("Attempted to rotate non-existent key: %s", key_id)
            return None

        old_key = self._keys.get(key_hash)
        if not old_key:
            return None

        # Create new key with same properties
        result = self.create_key(
            user_id=old_key.user_id,
            name=f"{old_key.name} (rotated)",
            scopes=old_key.scopes,
            expires_in_days=expires_in_days,
            description=old_key.description,
            allowed_ips=old_key.allowed_ips,
            rate_limit=old_key.rate_limit,
            prefix="live" if old_key.key_hash.startswith("sk_live_") else "test",
        )

        # Revoke old key
        self.revoke_key(key_id)

        logger.info(
            "Rotated API key %s -> %s for user %s",
            key_id,
            result.api_key.id,
            old_key.user_id,
        )
        return result

    def get_key_by_hash(self, key_hash: str) -> Optional[ManagedAPIKey]:
        """
        Get an API key by its hash.

        Args:
            key_hash: The SHA-256 hash of the key

        Returns:
            The ManagedAPIKey if found, None otherwise
        """
        return self._keys.get(key_hash)

    def get_key_by_id(self, key_id: str) -> Optional[ManagedAPIKey]:
        """
        Get an API key by its ID.

        Args:
            key_id: The unique ID of the key

        Returns:
            The ManagedAPIKey if found, None otherwise
        """
        key_hash = self._id_to_hash.get(key_id)
        if not key_hash:
            return None
        return self._keys.get(key_hash)

    def verify_and_get_key(self, full_key: str) -> Optional[ManagedAPIKey]:
        """
        Verify an API key and return its metadata if valid.

        This is the primary method for authenticating API requests.

        Args:
            full_key: The full API key provided by the client

        Returns:
            The ManagedAPIKey if valid and active, None otherwise
        """
        if not validate_api_key_format(full_key):
            logger.debug("Invalid API key format")
            return None

        key_hash = hash_api_key(full_key)
        api_key = self._keys.get(key_hash)

        if not api_key:
            logger.debug("API key not found")
            return None

        if not api_key.is_valid():
            logger.debug("API key is not valid (inactive or expired)")
            return None

        return api_key

    def update_last_used(self, key_hash: str) -> bool:
        """
        Update the last_used timestamp and increment request_count.

        Should be called on each successful API request.

        Args:
            key_hash: The hash of the key that was used

        Returns:
            True if the key was updated, False if not found
        """
        api_key = self._keys.get(key_hash)
        if not api_key:
            return False

        api_key.last_used = datetime.utcnow()
        api_key.request_count += 1
        return True

    def get_user_keys(
        self, user_id: str, include_inactive: bool = False
    ) -> List[ManagedAPIKey]:
        """
        Get all API keys for a user.

        Args:
            user_id: The user ID to get keys for
            include_inactive: Whether to include revoked/inactive keys

        Returns:
            List of ManagedAPIKey objects for the user
        """
        key_hashes = self._user_keys.get(user_id, [])
        keys = []
        for key_hash in key_hashes:
            api_key = self._keys.get(key_hash)
            if api_key:
                if include_inactive or api_key.is_active:
                    keys.append(api_key)
        return keys

    def get_all_keys(self, include_inactive: bool = False) -> List[ManagedAPIKey]:
        """
        Get all API keys (admin function).

        Args:
            include_inactive: Whether to include revoked/inactive keys

        Returns:
            List of all ManagedAPIKey objects
        """
        if include_inactive:
            return list(self._keys.values())
        return [k for k in self._keys.values() if k.is_active]

    def update_key_scopes(self, key_id: str, scopes: List[APIKeyScope]) -> bool:
        """
        Update the scopes for an API key.

        Args:
            key_id: The ID of the key to update
            scopes: New list of scopes

        Returns:
            True if updated, False if key not found
        """
        api_key = self.get_key_by_id(key_id)
        if not api_key:
            return False

        api_key.scopes = scopes
        logger.info(
            "Updated scopes for key %s: %s",
            key_id,
            [s.value for s in scopes],
        )
        return True

    def set_key_expiration(self, key_id: str, expires_at: Optional[datetime]) -> bool:
        """
        Set or clear the expiration for an API key.

        Args:
            key_id: The ID of the key to update
            expires_at: New expiration datetime, or None to remove expiration

        Returns:
            True if updated, False if key not found
        """
        api_key = self.get_key_by_id(key_id)
        if not api_key:
            return False

        api_key.expires_at = expires_at
        logger.info("Updated expiration for key %s: %s", key_id, expires_at)
        return True

    def get_usage_stats(self) -> Dict:
        """
        Get overall API key usage statistics.

        Returns:
            Dictionary with usage statistics
        """
        total_keys = len(self._keys)
        active_keys = sum(1 for k in self._keys.values() if k.is_active)
        expired_keys = sum(1 for k in self._keys.values() if k.is_expired())
        total_requests = sum(k.request_count for k in self._keys.values())

        return {
            "total_keys": total_keys,
            "active_keys": active_keys,
            "inactive_keys": total_keys - active_keys,
            "expired_keys": expired_keys,
            "total_users": len(self._user_keys),
            "total_requests": total_requests,
        }


# =============================================================================
# Global Manager Instance
# =============================================================================

# Singleton instance for the application
_api_key_manager: Optional[APIKeyManager] = None


def get_api_key_manager() -> APIKeyManager:
    """
    Get the global API key manager instance.

    Returns:
        The global APIKeyManager instance
    """
    global _api_key_manager
    if _api_key_manager is None:
        _api_key_manager = APIKeyManager()
    return _api_key_manager


def reset_api_key_manager() -> None:
    """
    Reset the global API key manager (primarily for testing).
    """
    global _api_key_manager
    _api_key_manager = None
