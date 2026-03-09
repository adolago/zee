import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock
from investing.api.main_new import app
from investing.api.routers import bonds, search
from investing.data.providers.terrapin_provider import TerrapinError
from investing.search import VectorStoreError

# Ensure secret key is set before importing app (if not already set)
if "ZEE_INVESTING_AUTH_JWT_SECRET_KEY" not in os.environ:
    os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
        "test_secret_key_at_least_32_chars_long_12345"
    )


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.asyncio
async def test_bonds_search_leaks_secrets(client):
    """
    Test that exceptions in bonds search endpoints do NOT leak sensitive info.
    """
    # Create a mock screener that raises an exception with a secret
    mock_screener = MagicMock()

    secret_message = "Connection failed to https://api.terrapin.com?key=SECRET_API_KEY"
    mock_screener.screen_from_request = AsyncMock(
        side_effect=TerrapinError(secret_message)
    )

    # Override the dependency
    app.dependency_overrides[bonds.get_screener] = lambda: mock_screener

    # Make the request
    response = client.post("/bonds/search", json={})

    # It currently fails with 500 and leaks the message
    assert response.status_code == 500

    # Verify the secret is NOT leaked
    assert "SECRET_API_KEY" not in response.json()["error"]
    assert "An internal error occurred" in response.json()["error"]


@pytest.mark.asyncio
async def test_bonds_yield_curve_leaks_secrets(client):
    """
    Test that exceptions in yield curve endpoints do NOT leak sensitive info.
    """
    mock_analyzer = MagicMock()
    secret_message = "Database error: postgres://user:SECRET_PASSWORD@db:5432/bonds"
    mock_analyzer.get_yield_curve = AsyncMock(side_effect=TerrapinError(secret_message))

    app.dependency_overrides[bonds.get_analyzer] = lambda: mock_analyzer

    response = client.get("/bonds/yield-curve")

    assert response.status_code == 500
    assert "SECRET_PASSWORD" not in response.json()["error"]
    assert "An internal error occurred" in response.json()["error"]


@pytest.mark.asyncio
async def test_search_leaks_secrets(client):
    """
    Test that exceptions in search endpoints do NOT leak sensitive info.
    """
    mock_store = MagicMock()
    secret_message = (
        "Qdrant connection failed: https://qdrant:SECRET_KEY@localhost:6333"
    )
    mock_store.search = AsyncMock(side_effect=VectorStoreError(secret_message))

    app.dependency_overrides[search.get_vector_store] = lambda: mock_store

    # Use /search/semantic path
    response = client.post("/search/semantic", json={"query": "test", "limit": 10})

    assert response.status_code == 500
    # Verify the secret is NOT leaked
    assert "SECRET_KEY" not in response.json()["error"]
    assert "An internal error occurred" in response.json()["error"]
