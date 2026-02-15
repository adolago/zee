import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

# Set required env vars
os.environ["STANLEY_AUTH_JWT_SECRET_KEY"] = "test_secret_key_at_least_32_chars_long_12345"

from stanley.api.main_new import app
from stanley.api.settings import UserSettings, DataSourceSettings, DataSourceConfig, REDACTED_MASK

@pytest.fixture
def client():
    return TestClient(app)

def test_data_sources_security(client):
    # Setup a mock settings with a secret API key
    mock_settings = UserSettings()
    original_key = "SUPER_SECRET_KEY_123"

    mock_settings.data_sources = DataSourceSettings(
        sources=[
            DataSourceConfig(
                name="vulnerable_source",
                enabled=True,
                api_key=original_key
            )
        ]
    )

    # Use a real instance for update testing, but mock the save/load to persistence
    with patch("stanley.api.settings.settings_manager.load", return_value=mock_settings) as mock_load, \
         patch("stanley.api.settings.settings_manager.save") as mock_save:

        # 1. Check redaction on GET
        response = client.get("/api/settings/data-sources")
        assert response.status_code == 200
        data = response.json()["data"]

        sources = data["sources"]
        vulnerable = next(s for s in sources if s["name"] == "vulnerable_source")
        assert vulnerable["api_key"] == REDACTED_MASK, "API Key should be redacted in GET response"

        # 2. Check smart update on PUT (sending back the redacted mask)

        # Payload sends back the redacted key
        update_payload = {
            "sources": [
                {
                    "name": "vulnerable_source",
                    "enabled": True,
                    "api_key": REDACTED_MASK,  # Sending ******
                    "priority": 1
                }
            ],
            "cache_enabled": True
        }

        response = client.put("/api/settings/data-sources", json=update_payload)
        assert response.status_code == 200

        # Check what was passed to save()
        # mock_save is called with the UserSettings object
        args, _ = mock_save.call_args
        saved_settings = args[0]
        saved_source = next(s for s in saved_settings.data_sources.sources if s.name == "vulnerable_source")

        assert saved_source.api_key == original_key, "Original API Key should be preserved when updating with mask"

        # 3. Check update with NEW key
        new_key = "NEW_API_KEY_456"
        update_payload["sources"][0]["api_key"] = new_key

        response = client.put("/api/settings/data-sources", json=update_payload)

        args, _ = mock_save.call_args
        saved_settings = args[0]
        saved_source = next(s for s in saved_settings.data_sources.sources if s.name == "vulnerable_source")

        assert saved_source.api_key == new_key, "New API Key should be saved when provided"
