import os
import pytest
import tempfile
from fastapi.testclient import TestClient

# Ensure secret key is set before importing app
os.environ["ZEE_INVESTING_AUTH_JWT_SECRET_KEY"] = (
    "test_secret_key_at_least_32_chars_long_12345"
)

from investing.api.main_new import app
from investing.api.dependencies import get_note_manager
from investing.notes import NoteManager


# Fixture to provide a NoteManager with a temporary vault
@pytest.fixture
def mock_note_manager():
    with tempfile.TemporaryDirectory() as tmpdir:
        manager = NoteManager(vault_path=tmpdir)
        yield manager


# Fixture to provide the TestClient with the dependency override
@pytest.fixture
def client(mock_note_manager):
    app.dependency_overrides[get_note_manager] = lambda: mock_note_manager
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_create_note_stored_xss(client):
    """
    Test that creating a note with malicious script content results in Stored XSS.
    """

    xss_payload = "<script>alert('XSS')</script>"

    # Using create_company (query params)
    response = client.post(
        "/api/companies",
        params={"symbol": "XSS", "company_name": "XSS Corp", "content": xss_payload},
    )

    assert response.status_code == 200
    data = response.json()["data"]

    # Verify payload is REMOVED (Fix verification)
    # The sanitizer removes script tags and their content
    assert xss_payload not in data["content_preview"]
    assert "<script>" not in data["content_preview"]

    # Verify by retrieving
    get_response = client.get(f"/api/notes/{data['name']}")
    assert get_response.status_code == 200
    get_data = get_response.json()["data"]
    assert xss_payload not in get_data["content"]
    assert "<script>" not in get_data["content"]


def test_update_note_stored_xss(client):
    """
    Test that updating a note with malicious script content results in Stored XSS.
    """
    # Create a benign note first
    create_response = client.post(
        "/api/companies", params={"symbol": "SAFE", "company_name": "Safe Corp"}
    )
    note_name = create_response.json()["data"]["name"]

    xss_payload = "<script>alert('UpdateXSS')</script>"

    # Update with malicious content
    response = client.put(f"/api/notes/{note_name}", json={"content": xss_payload})

    assert response.status_code == 200
    data = response.json()["data"]

    # Verify payload is REMOVED
    assert xss_payload not in data["content_preview"]
    assert "<script>" not in data["content_preview"]


def test_sanitizer_edge_cases():
    """Test sanitizer edge cases directly."""
    from investing.api.utils import sanitize_html

    # 1. Entity decoding check
    # Input is explicitly encoded safe HTML. It should stay encoded.
    safe_input = "&lt;script&gt;alert(1)&lt;/script&gt;"
    output = sanitize_html(safe_input)
    # If it was decoded to <script>..., output would be empty or <script>... depending on parser
    # We want it to remain "&lt;script&gt;..."
    assert "&lt;script&gt;" in output or "&#60;script&#62;" in output
    assert "<script>" not in output

    # 2. Javascript bypass check (newlines/tabs)
    bypass_input = '<a href="java\nscript:alert(1)">Click</a>'
    output = sanitize_html(bypass_input)
    # The href should be stripped or sanitized
    assert "javascript:" not in output.replace("\n", "").replace(" ", "")
    # Check that the alert is not in a position to execute (e.g. href is gone)
    # Our sanitizer removes the attribute if it contains javascript:
    assert "href" not in output or "alert(1)" not in output

    bypass_input_tab = '<a href="java\tscript:alert(1)">Click</a>'
    output_tab = sanitize_html(bypass_input_tab)
    assert "javascript:" not in output_tab.replace("\t", "").replace(" ", "")
