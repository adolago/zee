"""
Secure password hashing and validation module for Investing API.

This module provides:
- Password hashing using bcrypt via passlib
- Configurable password policies
- Secure password reset token generation
- Timing-attack resistant verification
"""

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass, field
from typing import Optional

import os as _os

try:
    from passlib.context import CryptContext

    _PASSLIB_AVAILABLE = True
except ImportError:
    _PASSLIB_AVAILABLE = False
    CryptContext = None  # type: ignore


def _get_crypt_context(schemes=None, deprecated=None, bcrypt__rounds=None):
    """
    Get a CryptContext, using a mock only if ZEE_INVESTING_DEV_MODE is explicitly set.

    Raises ImportError in production if passlib is not installed.
    """
    if _PASSLIB_AVAILABLE:
        return CryptContext(
            schemes=schemes, deprecated=deprecated, bcrypt__rounds=bcrypt__rounds
        )

    import logging

    dev_mode = _os.getenv("ZEE_INVESTING_DEV_MODE", "").lower() in ("true", "1", "yes")
    if not dev_mode:
        raise ImportError(
            "passlib is required for production. Install with: pip install passlib[bcrypt]\n"
            "To use mock password hashing for development, set ZEE_INVESTING_DEV_MODE=true"
        )

    logging.getLogger(__name__).warning(
        "ZEE_INVESTING_DEV_MODE=true: Using INSECURE mock password hashing. "
        "Do NOT use in production!"
    )

    class MockCryptContext:
        def __init__(self, schemes=None, deprecated=None, bcrypt__rounds=None):
            pass

        def hash(self, secret):
            return "mock_hash_" + secret

        def verify(self, secret, hash_value):
            return hash_value == "mock_hash_" + secret

        def dummy_verify(self):
            pass

    return MockCryptContext()


# Common passwords list (top 100 most common)
# In production, this should be loaded from a file or external source
COMMON_PASSWORDS: frozenset[str] = frozenset(
    [
        "password",
        "123456",
        "12345678",
        "qwerty",
        "abc123",
        "monkey",
        "1234567",
        "letmein",
        "trustno1",
        "dragon",
        "baseball",
        "iloveyou",
        "master",
        "sunshine",
        "ashley",
        "bailey",
        "passw0rd",
        "shadow",
        "123123",
        "654321",
        "superman",
        "qazwsx",
        "michael",
        "football",
        "password1",
        "password123",
        "welcome",
        "welcome1",
        "admin",
        "admin123",
        "root",
        "toor",
        "pass",
        "test",
        "guest",
        "master",
        "changeme",
        "12345",
        "123456789",
        "1234567890",
        "0987654321",
        "111111",
        "000000",
        "121212",
        "123321",
        "666666",
        "696969",
        "7777777",
        "88888888",
        "qwerty123",
        "qwerty1",
        "qwertyuiop",
        "password!",
        "password1!",
        "p@ssw0rd",
        "p@ssword",
        "pa$$word",
        "passw0rd!",
        "letmein!",
        "welcome!",
        "hello",
        "hello123",
        "hello1",
        "charlie",
        "donald",
        "loveme",
        "hockey",
        "ranger",
        "harley",
        "thomas",
        "robert",
        "jordan",
        "anthony",
        "daniel",
        "access",
        "maggie",
        "ginger",
        "joshua",
        "pepper",
        "jennifer",
        "hunter",
        "austin",
        "amanda",
        "jessica",
        "buster",
        "cowboy",
        "cheese",
        "killer",
        "george",
        "summer",
        "taylor",
        "batman",
        "soccer",
        "princess",
        "starwars",
        "whatever",
        "nicole",
        "matthew",
        "yankees",
        "dallas",
        "austin",
        "thunder",
    ]
)


@dataclass(frozen=True)
class PasswordPolicy:
    """
    Configurable password policy rules.

    Attributes:
        min_length: Minimum password length (default: 8)
        max_length: Maximum password length (default: 128)
        require_uppercase: Require at least one uppercase letter (default: True)
        require_lowercase: Require at least one lowercase letter (default: True)
        require_digit: Require at least one digit (default: True)
        require_special: Require at least one special character (default: True)
        check_common_passwords: Check against common passwords list (default: True)
        special_characters: Set of allowed special characters
    """

    min_length: int = 8
    max_length: int = 128
    require_uppercase: bool = True
    require_lowercase: bool = True
    require_digit: bool = True
    require_special: bool = True
    check_common_passwords: bool = True
    special_characters: str = field(default="!@#$%^&*()_+-=[]{}|;':\",./<>?`~")


# Default password policy
DEFAULT_POLICY = PasswordPolicy()


# Bcrypt password context with configurable work factor
# Work factor of 12 provides good security/performance balance
_pwd_context = _get_crypt_context(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)


def _create_context(rounds: int = 12):
    """
    Create a password context with the specified bcrypt work factor.

    Args:
        rounds: Bcrypt work factor (default: 12). Higher values are more secure
                but slower. Recommended range: 10-14 for production.

    Returns:
        Configured CryptContext instance.
    """
    return _get_crypt_context(
        schemes=["bcrypt"],
        deprecated="auto",
        bcrypt__rounds=rounds,
    )


def hash_password(password: str, rounds: int = 12) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: The plaintext password to hash.
        rounds: Bcrypt work factor (default: 12).

    Returns:
        The bcrypt hash of the password.

    Raises:
        ValueError: If password is empty or None.
    """
    if not password:
        raise ValueError("Password cannot be empty")

    if rounds != 12:
        context = _create_context(rounds)
        return context.hash(password)

    return _pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    """
    Verify a password against a bcrypt hash.

    This function is designed to be resistant to timing attacks by using
    passlib's built-in constant-time comparison.

    Args:
        password: The plaintext password to verify.
        hashed: The bcrypt hash to verify against.

    Returns:
        True if the password matches the hash, False otherwise.
    """
    if not password or not hashed:
        # Perform dummy operation to prevent timing leaks
        _pwd_context.dummy_verify()
        return False

    try:
        return _pwd_context.verify(password, hashed)
    except Exception:
        # Handle malformed hashes gracefully
        return False


def validate_password_strength(
    password: str,
    policy: Optional[PasswordPolicy] = None,
) -> tuple[bool, list[str]]:
    """
    Validate a password against the password policy.

    Args:
        password: The password to validate.
        policy: Optional custom password policy. Uses DEFAULT_POLICY if not provided.

    Returns:
        A tuple of (is_valid, list_of_errors).
        is_valid is True if the password meets all requirements.
        list_of_errors contains all validation failures.
    """
    if policy is None:
        policy = DEFAULT_POLICY

    errors: list[str] = []

    # Check for empty password
    if not password:
        return False, ["Password cannot be empty"]

    # Check minimum length
    if len(password) < policy.min_length:
        errors.append(f"Password must be at least {policy.min_length} characters long")

    # Check maximum length
    if len(password) > policy.max_length:
        errors.append(f"Password must be at most {policy.max_length} characters long")

    # Check for uppercase
    if policy.require_uppercase and not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter")

    # Check for lowercase
    if policy.require_lowercase and not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter")

    # Check for digit
    if policy.require_digit and not re.search(r"\d", password):
        errors.append("Password must contain at least one digit")

    # Check for special character
    if policy.require_special:
        # Escape special regex characters in the special_characters string
        escaped_special = re.escape(policy.special_characters)
        if not re.search(f"[{escaped_special}]", password):
            errors.append("Password must contain at least one special character")

    # Check against common passwords
    if policy.check_common_passwords:
        password_lower = password.lower()
        if password_lower in COMMON_PASSWORDS:
            errors.append("Password is too common and easily guessable")

    return len(errors) == 0, errors


def generate_reset_token(nbytes: int = 32) -> str:
    """
    Generate a cryptographically secure URL-safe reset token.

    Args:
        nbytes: Number of random bytes to generate (default: 32).
                The resulting token will be longer due to base64 encoding.

    Returns:
        A URL-safe base64-encoded token string.
    """
    return secrets.token_urlsafe(nbytes)


def hash_reset_token(token: str) -> str:
    """
    Hash a reset token for secure storage.

    Uses SHA-256 for fast hashing since tokens are already cryptographically
    random and don't need the slow hashing of bcrypt.

    Args:
        token: The plaintext reset token.

    Returns:
        The SHA-256 hash of the token (hex-encoded).

    Raises:
        ValueError: If token is empty or None.
    """
    if not token:
        raise ValueError("Token cannot be empty")

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_reset_token(token: str, hashed: str) -> bool:
    """
    Verify a reset token against its hash using constant-time comparison.

    This function is resistant to timing attacks.

    Args:
        token: The plaintext reset token to verify.
        hashed: The SHA-256 hash (hex-encoded) to verify against.

    Returns:
        True if the token matches the hash, False otherwise.
    """
    if not token or not hashed:
        return False

    try:
        computed_hash = hash_reset_token(token)
        # Use hmac.compare_digest for constant-time comparison
        return hmac.compare_digest(computed_hash, hashed)
    except Exception:
        return False
