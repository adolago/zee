
from fastapi.testclient import TestClient
from unittest.mock import MagicMock
from stanley.api.main_new import app
from stanley.api.auth.dependencies import require_admin, User, Role

client = TestClient(app)

def test_system_metrics_unauthorized_access():
    """
    Verify that sensitive system metrics are protected (require auth).
    """
    response = client.get("/api/system/metrics")
    assert response.status_code == 401

def test_system_circuit_breakers_unauthorized_access():
    """
    Verify that circuit breaker states are protected (require auth).
    """
    response = client.get("/api/system/circuit-breakers")
    assert response.status_code == 401

def test_system_component_health_unauthorized_access():
    """
    Verify that detailed component health is protected (require auth).
    """
    response = client.get("/api/system/component-health")
    assert response.status_code == 401

def test_system_status_unauthorized_access():
    """
    Verify that system status is protected (require auth).
    """
    response = client.get("/api/status")
    assert response.status_code == 401

def test_system_metrics_admin_access():
    """
    Verify that admins can access sensitive metrics.
    """
    # Create a mock admin user
    mock_admin = User(
        id="admin_1",
        email="admin@example.com",
        roles=[Role.ADMIN],
        is_active=True
    )

    # Override the dependency
    app.dependency_overrides[require_admin] = lambda: mock_admin

    try:
        response = client.get("/api/system/metrics")
        assert response.status_code == 200
        assert response.json()["success"] is True
    finally:
        # Clean up
        app.dependency_overrides = {}
