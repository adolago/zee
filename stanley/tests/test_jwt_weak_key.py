import os
import pytest
from stanley.api.auth.jwt import JWTSettings, get_jwt_settings
from stanley.api.auth.config import get_auth_settings, clear_settings_cache


def test_jwt_settings_rejects_weak_key_via_env_var():
    """
    Test that JWTSettings rejects a short secret key even when loaded via
    fallback environment variable mechanism.
    """
    # Set a weak key
    weak_key = "weak_secret_less_than_32_chars"
    os.environ["STANLEY_AUTH_JWT_SECRET_KEY"] = weak_key

    # Clear caches
    clear_settings_cache()
    get_jwt_settings.cache_clear()

    # We expect ValueError because of the length check we added
    with pytest.raises(ValueError, match="JWT secret key is too short"):
        get_jwt_settings()

    # Cleanup
    del os.environ["STANLEY_AUTH_JWT_SECRET_KEY"]
    clear_settings_cache()
    get_jwt_settings.cache_clear()


def test_jwt_settings_accepts_strong_key():
    """
    Test that JWTSettings accepts a strong secret key.
    """
    strong_key = "this_is_a_very_strong_secret_key_that_is_long_enough_12345"
    os.environ["STANLEY_AUTH_JWT_SECRET_KEY"] = strong_key

    clear_settings_cache()
    get_jwt_settings.cache_clear()

    settings = get_jwt_settings()
    assert settings.secret_key == strong_key

    # Cleanup
    del os.environ["STANLEY_AUTH_JWT_SECRET_KEY"]
    clear_settings_cache()
    get_jwt_settings.cache_clear()
