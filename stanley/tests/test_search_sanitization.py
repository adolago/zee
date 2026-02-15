import os
import pytest
from fastapi.testclient import TestClient

# Ensure secret key is set
os.environ["STANLEY_AUTH_JWT_SECRET_KEY"] = (
    "test_secret_key_at_least_32_chars_long_12345"
)

from stanley.api.main_new import app
from stanley.api.routers.search import get_indexer, get_vector_store


# Mock classes to avoid full vector store initialization
class MockVectorStore:
    def __init__(self):
        self.dimension = 1536

    async def initialize(self):
        pass

    async def close(self):
        pass


class MockIndexer:
    def __init__(self):
        self.store = MockVectorStore()
        self.last_content = None

    async def index_note(self, note_id, content, **kwargs):
        self.last_content = content
        return 1


# Fixture to provide the TestClient with the dependency override
@pytest.fixture
def client():
    mock_indexer = MockIndexer()

    # Override both get_indexer and get_vector_store to avoid qdrant init
    app.dependency_overrides[get_indexer] = lambda: mock_indexer
    app.dependency_overrides[get_vector_store] = lambda: mock_indexer.store

    # We need to access the mock_indexer instance to check assertions
    # So we attach it to the client for this test
    c = TestClient(app)
    c.mock_indexer = mock_indexer
    yield c

    app.dependency_overrides.clear()


def test_index_note_sanitization(client):
    """
    Test that the index_note endpoint correctly sanitizes HTML input.
    """
    # Payload with mixed safe and unsafe content
    unsafe_payload = """
    <h2>Valid Title</h2>
    <script>alert('XSS')</script>
    <p>Valid content</p>
    <img src=x onerror=alert(1)>
    """

    response = client.post(
        "/search/index/note",
        params={"note_id": "test_sanitization", "content": unsafe_payload},
    )

    assert response.status_code == 200

    indexed_content = client.mock_indexer.last_content
    assert indexed_content is not None

    # Verify unsafe tags are removed
    assert "<script>" not in indexed_content
    assert "onerror" not in indexed_content

    # Verify safe tags are preserved
    assert "<h2>Valid Title</h2>" in indexed_content
    assert "<p>Valid content</p>" in indexed_content

    # Verify data content is preserved (minus scripts)
    assert "Valid Title" in indexed_content
    assert "Valid content" in indexed_content
