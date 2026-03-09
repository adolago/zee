import os
import pytest
from unittest.mock import patch, MagicMock
from pydantic_settings import BaseSettings

# We need to set a dummy secret key so that the module-level import of create_app doesn't crash
# when pytest collects the file.
# investing.api.main_new creates 'app = create_app()' at module level.
os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
    "dummy_secret_key_for_testing_purposes_must_be_long"
)

from investing.api.main_new import create_app
from investing.api.auth.config import AuthSettings


def test_app_fails_closed_without_auth_config():
    """
    Test that the application refuses to start if authentication configuration is missing.
    This enforces the 'Fail Closed' security principle.
    """
    # We remove the env var to simulate missing config
    if "ZEE_INVESTING_AUTH_JWT_SECRET_KEY" in os.environ:
        del os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"]

    # We also need to clear the lru_cache of get_auth_settings
    from investing.api.auth.config import get_auth_settings

    get_auth_settings.cache_clear()

    # Now when we call create_app, it should fail
    # Note: create_app calls get_auth_settings internally

    with pytest.raises(Exception) as excinfo:
        create_app()

    # We expect pydantic ValidationError or similar because the field is missing
    # OR our critical log message if we caught it, but we removed the try-except
    # wait, we removed the try-except in main_new.py BUT get_auth_settings itself
    # raises ValidationError if env var is missing.
    # main_new.py used to catch Exception, now it lets it propagate (or we might have added a new try/except re-raise).

    # In my patch:
    # try:
    #    settings = get_auth_settings()
    # except Exception as e:
    #    logger.critical(...)
    #    raise

    # So we expect the re-raised exception.

    # Restore env var for other tests
    os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
        "dummy_secret_key_for_testing_purposes_must_be_long"
    )
    get_auth_settings.cache_clear()


def test_app_starts_with_valid_auth_config():
    """
    Test that the application starts correctly when auth is configured.
    """
    # Ensure env var is set
    os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
        "dummy_secret_key_for_testing_purposes_must_be_long"
    )

    from investing.api.auth.config import get_auth_settings

    get_auth_settings.cache_clear()

    app = create_app()
    assert app is not None
    assert app.title == "Investing API"
