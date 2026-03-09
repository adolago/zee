import os
import pytest
import logging
from unittest.mock import MagicMock
from fastapi.testclient import TestClient

# Ensure secret key is set
os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = "test_secret_key_at_least_32_chars_long_12345"

from investing.api.main_new import app
from investing.api.routers.search import get_vector_store, VectorStoreError

# Setup Logger for capturing logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("investing.api.routers.search")

class MockVectorStore:
    def __init__(self):
        self.dimension = 1536

    async def initialize(self):
        pass

    async def close(self):
        pass

    async def search(self, *args, **kwargs):
        # Simulate an error with newlines (Log Injection payload)
        raise VectorStoreError("Connection failed\nUser: admin\nRole: superuser")

@pytest.fixture
def client(caplog):
    mock_store = MockVectorStore()
    app.dependency_overrides[get_vector_store] = lambda: mock_store

    # Capture logs
    caplog.set_level(logging.ERROR, logger="investing.api.routers.search")

    with TestClient(app) as c:
        yield c, caplog

    app.dependency_overrides.clear()

def test_semantic_search_log_injection(client):
    """
    Test that exceptions in semantic search are logged.
    If vulnerable, the log will contain newlines.
    """
    c, caplog = client

    response = c.post(
        "/search/semantic",
        json={"query": "test query"}
    )

    # Expect 500 error because we raised VectorStoreError
    assert response.status_code == 500

    # Check if the error was logged
    assert len(caplog.records) > 0
    record = caplog.records[0]

    # The fix ensures newlines are replaced (e.g. with underscores or filtered out)
    # So we assert that the original malicious payload is NOT present as-is
    assert "Connection failed\nUser: admin\nRole: superuser" not in record.message

    # Verify that it IS present in the sanitized form (which typically replaces whitespace with underscores or similar)
    # Based on previous failure output: "Semantic search failed: Connection failed_User: admin_Role: superuser"
    assert "Connection failed_User: admin_Role: superuser" in record.message

def test_search_query_length_limit(client):
    """
    Test that search queries strictly enforce length limits (DoS prevention).
    """
    c, caplog = client

    # 1. Test query that is too long (1001 chars)
    long_query = "a" * 1001
    response = c.post(
        "/search/semantic",
        json={"query": long_query}
    )
    assert response.status_code == 422  # Unprocessable Entity (Validation Error)

    # 2. Test query that is valid (1000 chars)
    valid_long_query = "a" * 1000
    response = c.post(
        "/search/semantic",
        json={"query": valid_long_query}
    )
    # Should result in 500 because mock raises Error, but NOT 422
    assert response.status_code == 500
