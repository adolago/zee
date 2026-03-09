import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from unittest.mock import MagicMock, patch
from investing.api.settings import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_settings_leak_prevention():
    # Mock settings_manager to raise an exception with sensitive info
    with patch("investing.api.settings.settings_manager.load") as mock_load:
        sensitive_info = "/home/user/secret/path/failed"
        mock_load.side_effect = Exception(f"File not found: {sensitive_info}")

        response = client.get("/api/settings")

        assert response.status_code == 500
        # Check that sensitive info is NOT in the response
        assert sensitive_info not in response.json()["detail"]
        assert "An internal error occurred" in response.json()["detail"]


def test_save_settings_leak_prevention():
    with patch("investing.api.settings.settings_manager.update") as mock_update:
        sensitive_info = "database_password=super_secret"
        mock_update.side_effect = Exception(f"DB Error: {sensitive_info}")

        response = client.put("/api/settings", json={"theme": {"mode": "dark"}})

        assert response.status_code == 500
        assert sensitive_info not in response.json()["detail"]
        assert "An internal error occurred" in response.json()["detail"]
