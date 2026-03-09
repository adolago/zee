
import pytest
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch

# Try to import the new app factory
try:
    from investing.api.main_new import app
except ImportError:
    app = None

@pytest.fixture
def client():
    return TestClient(app)

@pytest.mark.skipif(app is None, reason="investing.api.main_new not available")
def test_system_metrics_unauthorized_access(client):
    """
    Test that sensitive system metrics endpoint is NOT accessible without authentication.
    """
    with patch("investing.core.circuit_breaker.get_all_circuit_breaker_stats", return_value=[]), \
         patch("investing.core.health.get_health_monitor") as mock_health:

        mock_health.return_value.get_system_health.return_value = Mock(components=[])

        response = client.get("/api/system/metrics")

        # Expect 403 Forbidden or 401 Unauthorized
        assert response.status_code in [401, 403]

@pytest.mark.skipif(app is None, reason="investing.api.main_new not available")
def test_circuit_breakers_unauthorized_access(client):
    """Test accessing circuit breakers without auth."""
    with patch("investing.core.circuit_breaker.get_all_circuit_breaker_stats", return_value=[]):
        response = client.get("/api/system/circuit-breakers")
        assert response.status_code in [401, 403]

@pytest.mark.skipif(app is None, reason="investing.api.main_new not available")
def test_component_health_unauthorized_access(client):
    """Test accessing component health without auth."""
    with patch("investing.core.health.get_health_monitor") as mock_health:
        mock_health.return_value.get_system_health.return_value = Mock(components=[])
        response = client.get("/api/system/component-health")
        assert response.status_code in [401, 403]
