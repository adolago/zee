import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

# Ensure secret key is set before importing app
os.environ["STANLEY_AUTH_JWT_SECRET_KEY"] = (
    "test_secret_key_at_least_32_chars_long_12345"
)

from stanley.api.main_new import app


@pytest.fixture
def client():
    return TestClient(app)


def test_news_digest_error_leak(client):
    secret_msg = "Database connection failed: user=admin password=SUPER_SECRET_PASSWORD host=10.0.0.1"

    # Patch mock_generate_digest in the router
    # Since news_digest module is missing, the router uses mock_generate_digest
    with patch(
        "stanley.api.routers.news.mock_generate_digest",
        side_effect=Exception(secret_msg),
    ):
        response = client.get("/api/news/digest/AAPL")

        # The API catches Exception and returns 200 OK with success=False
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is False

        # Security check: The error message should NOT contain the secret
        error_msg = data.get("error", "")
        if "SUPER_SECRET_PASSWORD" in error_msg:
            pytest.fail(
                f"SECURITY VULNERABILITY: Sensitive info leaked in error message: {error_msg}"
            )

        assert "An internal error occurred" in error_msg


def test_symbol_news_error_leak(client):
    secret_msg = "API Key INVALID: KEY=sk_live_12345_SECRET"

    with patch(
        "stanley.api.routers.news.mock_generate_digest",
        side_effect=Exception(secret_msg),
    ):
        response = client.get("/api/news/AAPL")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False

        error_msg = data.get("error", "")
        if "sk_live_12345_SECRET" in error_msg:
            pytest.fail(
                f"SECURITY VULNERABILITY: Sensitive info leaked in error message: {error_msg}"
            )

        assert "An internal error occurred" in error_msg
