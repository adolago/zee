import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock

# Ensure secret key is set before importing app
os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
    "test_secret_key_at_least_32_chars_long_12345"
)

from investing.api.main_new import app
from investing.api.auth.dependencies import require_admin, User, Role


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.asyncio
async def test_system_status_leaks_secrets(client):
    """
    Test that sensitive information contained in exceptions is leaked
    via the /api/status endpoint (confirming vulnerability).
    """
    # Create a mock app state with a data_manager that raises an exception with a secret
    mock_app_state = MagicMock()
    mock_data_manager = MagicMock()

    # Configure the health_check to raise an exception with a secret
    secret_message = (
        "Connection failed to postgres://user:SECRET_DB_PASSWORD@localhost:5432/db"
    )
    mock_data_manager.health_check = AsyncMock(side_effect=Exception(secret_message))

    mock_app_state.data_manager = mock_data_manager

    # Mock other analyzers to be None or healthy to avoid noise
    mock_app_state.money_flow_analyzer = None
    mock_app_state.institutional_analyzer = None
    mock_app_state.portfolio_analyzer = None
    mock_app_state.research_analyzer = None
    mock_app_state.commodities_analyzer = None
    mock_app_state.options_analyzer = None
    mock_app_state.etf_analyzer = None
    mock_app_state.accounting_analyzer = None
    mock_app_state.earnings_quality_analyzer = None
    mock_app_state.red_flag_scorer = None
    mock_app_state.anomaly_aggregator = None
    mock_app_state.signal_generator = None

    # Inject the mock state into the app
    app.state.app_state = mock_app_state

    # Override auth to allow access
    mock_admin = User(
        id="admin_1",
        email="admin@example.com",
        roles=[Role.ADMIN],
        is_active=True
    )
    app.dependency_overrides[require_admin] = lambda: mock_admin

    try:
        # Make the request
        response = client.get("/api/status")
    finally:
        app.dependency_overrides = {}

    # Verify response structure
    assert response.status_code == 200
    data = response.json()["data"]

    # Find the data_manager component
    data_manager_status = next(
        (c for c in data["components"] if c["name"] == "data_manager"), None
    )

    assert data_manager_status is not None
    assert data_manager_status["healthy"] is False

    # Verify the secret is NOT leaked in the details
    assert "SECRET_DB_PASSWORD" not in data_manager_status["details"]
    # Verify we get the sanitized message
    assert "An internal error occurred" in data_manager_status["details"]
