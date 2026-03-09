import os
import pytest
from fastapi.testclient import TestClient

# Set required env vars before importing app to ensure settings load correctly
os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
    "test_secret_key_at_least_32_chars_long_12345"
)

from investing.api.main_new import app


@pytest.fixture
def client():
    return TestClient(app)


def test_security_headers(client):
    response = client.get("/bonds/health")
    assert response.status_code == 200
    headers = response.headers

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "Strict-Transport-Security" in headers
    assert "max-age=31536000" in headers["Strict-Transport-Security"]
    assert "Content-Security-Policy" in headers
    assert "default-src 'self'" in headers["Content-Security-Policy"]
    assert "Permissions-Policy" in headers
    assert "geolocation=()" in headers["Permissions-Policy"]
