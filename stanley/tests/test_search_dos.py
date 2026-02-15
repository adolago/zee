import os
import pytest
from fastapi.testclient import TestClient

# Ensure secret key is set
os.environ["STANLEY_AUTH_JWT_SECRET_KEY"] = "test_secret_key_at_least_32_chars_long_12345"

from stanley.api.main_new import app
from stanley.api.routers.search import get_indexer, get_vector_store, VectorStore

# Mock classes to avoid full vector store initialization
class MockVectorStore:
    def __init__(self):
        self.dimension = 1536
        self.DEFAULT_COLLECTIONS = ["research_notes", "sec_filings"]

    async def initialize(self):
        pass

    async def close(self):
        pass

    async def search(self, **kwargs):
        # Return empty list or basic result for any search
        return []

    async def get_document_vector(self, **kwargs):
        return [0.1] * 1536

    async def search_by_vector(self, **kwargs):
        return []

    async def get_collection_stats(self, name):
        from stanley.search import CollectionStats
        return CollectionStats(
            name=name,
            vectors_count=100,
            points_count=100,
            segments_count=1,
            status="green"
        )

    async def health_check(self):
        return True

class MockIndexer:
    def __init__(self):
        self.store = MockVectorStore()

# Fixture to provide the TestClient with the dependency override
@pytest.fixture
def client():
    mock_indexer = MockIndexer()

    # Override both get_indexer and get_vector_store
    app.dependency_overrides[get_indexer] = lambda: mock_indexer
    app.dependency_overrides[get_vector_store] = lambda: mock_indexer.store

    c = TestClient(app)
    yield c

    app.dependency_overrides.clear()

def test_search_notes_dos_query_length(client):
    """
    Test that sending a very long query to search_notes fails with 422 (DoS protection).
    """
    long_query = "a" * 5000  # 5000 characters

    response = client.get(
        "/search/notes",
        params={
            "query": long_query,
            "limit": 10
        }
    )

    assert response.status_code == 422, f"Expected 422 for long query, got {response.status_code}"

def test_semantic_search_dos_query_length(client):
    """
    Test that sending a very long query to semantic_search fails with 422.
    """
    long_query = "a" * 5000

    response = client.post(
        "/search/semantic",
        json={
            "query": long_query,
            "limit": 10
        }
    )

    assert response.status_code == 422, f"Expected 422 for long query, got {response.status_code}"

def test_search_filings_dos_symbol_length(client):
    """
    Test that sending a very long symbol to search_filings fails with 422.
    """
    long_symbol = "A" * 100
    query = "test"

    response = client.get(
        f"/search/filings/{long_symbol}",
        params={
            "query": query,
            "limit": 10
        }
    )

    assert response.status_code == 422, f"Expected 422 for long symbol, got {response.status_code}"
