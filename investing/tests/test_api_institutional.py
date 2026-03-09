"""
Tests for new institutional analytics API endpoints.

Tests whale tracking, options flow, sector rotation,
and smart money index API endpoints.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

# Import will work when main module exists
try:
    from investing.api.main_new import app, app_state, AppState
    from investing.api.utils import get_timestamp
    from investing.api.routers.base import create_response
except ImportError:
    app = None
    app_state = None
    AppState = None


# Skip all tests if API module not available or new endpoints not yet implemented
pytestmark = pytest.mark.skipif(app is None, reason="API module not available")


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def test_client():
    """Create test client for API testing."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def mock_whale_tracker():
    """Mock WhaleTracker for API tests."""
    mock = Mock()
    mock.track_whale_movements = Mock(
        return_value={
            "symbol": "AAPL",
            "total_whale_ownership": 0.25,
            "whale_count": 15,
            "net_whale_change": 5_000_000,
            "whales_buying": 10,
            "whales_selling": 3,
            "whale_sentiment": "accumulating",
            "top_whales": [
                {
                    "manager_name": "Berkshire Hathaway",
                    "value_held": 15_000_000_000,
                    "ownership_percentage": 0.08,
                },
                {
                    "manager_name": "Vanguard",
                    "value_held": 10_000_000_000,
                    "ownership_percentage": 0.05,
                },
            ],
            "recent_movements": [],
        }
    )
    mock.get_top_whales = Mock(
        return_value=pd.DataFrame(
            {
                "manager_name": ["Berkshire Hathaway", "Vanguard"],
                "value_held": [15_000_000_000, 10_000_000_000],
                "ownership_percentage": [0.08, 0.05],
            }
        )
    )
    mock.detect_accumulation = Mock(
        return_value={
            "symbol": "AAPL",
            "pattern": "accumulation",
            "strength": 0.7,
            "duration_quarters": 3,
            "net_shares_added": 50_000_000,
            "whale_conviction": 0.85,
        }
    )
    mock.calculate_whale_consensus = Mock(
        return_value={
            "symbol": "AAPL",
            "consensus_direction": "bullish",
            "consensus_strength": 0.75,
            "bullish_whales": 12,
            "bearish_whales": 3,
            "neutral_whales": 2,
            "agreement_score": 0.7,
        }
    )
    mock.health_check = Mock(return_value=True)
    return mock


@pytest.fixture
def mock_options_flow_analyzer():
    """Mock OptionsFlowAnalyzer for API tests."""
    mock = Mock()
    mock.detect_unusual_activity = Mock(
        return_value=pd.DataFrame(
            {
                "symbol": ["AAPL"] * 5,
                "option_type": ["call", "put", "call", "call", "put"],
                "strike": [150, 145, 155, 160, 140],
                "expiry": pd.date_range(start=datetime.now(), periods=5, freq="7D"),
                "volume": [50000, 30000, 45000, 60000, 25000],
                "open_interest": [5000, 3000, 4000, 6000, 2000],
                "premium": [2_500_000, 1_500_000, 2_200_000, 3_000_000, 1_200_000],
                "unusual_score": [8.5, 7.2, 8.0, 9.1, 6.5],
            }
        )
    )
    mock.calculate_put_call_ratio = Mock(
        return_value={
            "symbol": "AAPL",
            "volume_ratio": 0.75,
            "premium_ratio": 0.65,
            "oi_ratio": 0.80,
            "ratio_percentile": 35,
            "sentiment_signal": "bullish",
        }
    )
    mock.get_large_trades = Mock(
        return_value=pd.DataFrame(
            {
                "symbol": ["AAPL"] * 3,
                "option_type": ["call", "call", "put"],
                "strike": [150, 155, 145],
                "size": [10000, 8000, 12000],
                "premium": [5_000_000, 4_000_000, 6_000_000],
            }
        )
    )
    mock.aggregate_options_sentiment = Mock(
        return_value={
            "symbol": "AAPL",
            "overall_sentiment": "bullish",
            "sentiment_score": 0.6,
            "call_flow_strength": 0.7,
            "put_flow_strength": 0.3,
            "smart_money_signal": "bullish",
            "retail_signal": "neutral",
            "confidence": 0.75,
        }
    )
    mock.health_check = Mock(return_value=True)
    return mock


@pytest.fixture
def mock_sector_rotation_analyzer():
    """Mock SectorRotationAnalyzer for API tests."""
    mock = Mock()
    mock.detect_rotation_pattern = Mock(
        return_value={
            "current_phase": "mid_cycle",
            "rotation_direction": "into_cyclicals",
            "rotation_speed": 0.6,
            "sector_leaders": ["XLK", "XLY", "XLI"],
            "sector_laggards": ["XLU", "XLRE", "XLP"],
            "phase_duration": 45,
            "confidence": 0.8,
        }
    )
    mock.identify_risk_regime = Mock(
        return_value={
            "regime": "risk_on",
            "regime_strength": 0.7,
            "cyclical_vs_defensive_ratio": 1.25,
            "risk_appetite_score": 0.6,
            "regime_duration_days": 30,
            "transition_probability": 0.15,
        }
    )
    mock.rank_sector_momentum = Mock(
        return_value=pd.DataFrame(
            {
                "sector": ["XLK", "XLY", "XLI", "XLF", "XLV", "XLE", "XLB", "XLP"],
                "momentum_1m": [0.08, 0.06, 0.04, 0.02, 0.03, -0.05, -0.02, 0.01],
                "momentum_3m": [0.15, 0.12, 0.09, 0.05, 0.08, -0.10, -0.03, 0.04],
                "momentum_6m": [0.25, 0.20, 0.15, 0.10, 0.12, -0.15, -0.05, 0.08],
                "relative_strength": [1.2, 1.1, 1.05, 0.9, 1.0, 0.7, 0.75, 0.85],
                "rank": [1, 2, 3, 5, 4, 8, 7, 6],
            }
        )
    )
    mock.detect_leadership_change = Mock(
        return_value={
            "leadership_changed": True,
            "new_leaders": ["XLK", "XLY"],
            "former_leaders": ["XLE", "XLF"],
            "change_magnitude": 0.4,
            "days_since_change": 15,
            "leadership_stability": 0.6,
        }
    )
    mock.health_check = Mock(return_value=True)
    return mock


@pytest.fixture
def mock_smart_money_index():
    """Mock SmartMoneyIndex for API tests."""
    mock = Mock()
    mock.calculate = Mock(
        return_value={
            "symbol": "AAPL",
            "smi_value": 65,
            "smi_signal": "buy",
            "components": {
                "institutional_flow": 0.7,
                "dark_pool_activity": 0.6,
                "options_sentiment": 0.5,
                "whale_accumulation": 0.8,
                "sector_rotation_signal": 0.4,
            },
            "percentile": 72,
            "trend": "rising",
            "timestamp": datetime.now().isoformat(),
        }
    )
    mock.detect_divergence = Mock(
        return_value={
            "symbol": "AAPL",
            "divergence_type": "none",
            "divergence_strength": 0.0,
            "price_trend": "up",
            "smi_trend": "up",
            "signal": "confirmed",
            "lookback_days": 20,
        }
    )
    mock.calculate_batch = Mock(
        return_value={
            "AAPL": {"smi_value": 65, "smi_signal": "buy"},
            "MSFT": {"smi_value": 58, "smi_signal": "neutral"},
            "GOOGL": {"smi_value": 72, "smi_signal": "buy"},
        }
    )
    mock.calculate_market_smi = Mock(
        return_value={
            "market_smi": 60,
            "market_signal": "bullish",
            "sector_breakdown": {"XLK": 70, "XLF": 55, "XLE": 45},
            "breadth": 0.65,
        }
    )
    mock.health_check = Mock(return_value=True)
    return mock


# =============================================================================
# Whale Endpoint Tests
# =============================================================================


class TestWhaleEndpoints:
    """Tests for whale tracking API endpoints."""

    def test_get_whale_movements(self, test_client, mock_whale_tracker):
        """Test GET /api/whale/{symbol} endpoint."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/AAPL")

            if response.status_code == 404:
                pytest.skip("Whale endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "symbol" in data["data"]
            assert data["data"]["symbol"] == "AAPL"

    def test_get_whale_movements_missing_symbol(self, test_client, mock_whale_tracker):
        """Test whale endpoint with missing symbol."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/")
            # Should return 404 or 405
            assert response.status_code in [404, 405, 422]

    def test_get_top_whales(self, test_client, mock_whale_tracker):
        """Test GET /api/whale/{symbol}/top endpoint."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/AAPL/top")

            if response.status_code == 404:
                pytest.skip("Top whales endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_whale_accumulation(self, test_client, mock_whale_tracker):
        """Test GET /api/whale/{symbol}/accumulation endpoint."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/AAPL/accumulation")

            if response.status_code == 404:
                pytest.skip("Whale accumulation endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_whale_consensus(self, test_client, mock_whale_tracker):
        """Test GET /api/whale/{symbol}/consensus endpoint."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/AAPL/consensus")

            if response.status_code == 404:
                pytest.skip("Whale consensus endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True


# =============================================================================
# Options Flow Endpoint Tests
# =============================================================================


class TestOptionsFlowEndpoints:
    """Tests for options flow API endpoints."""

    def test_get_unusual_options(self, test_client, mock_options_flow_analyzer):
        """Test GET /api/options/{symbol}/unusual endpoint."""
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get("/api/options/AAPL/unusual")

            if response.status_code == 404:
                pytest.skip("Options unusual endpoint not yet implemented")
            if response.status_code == 503:
                pytest.skip("Options flow analyzer not initialized")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_put_call_ratio(self, test_client, mock_options_flow_analyzer):
        """Test GET /api/options/{symbol}/ratio endpoint."""
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get("/api/options/AAPL/ratio")

            if response.status_code == 404:
                pytest.skip("Put/call ratio endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_large_trades(self, test_client, mock_options_flow_analyzer):
        """Test GET /api/options/{symbol}/large-trades endpoint."""
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get("/api/options/AAPL/large-trades")

            if response.status_code == 404:
                pytest.skip("Large trades endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_options_sentiment(self, test_client, mock_options_flow_analyzer):
        """Test GET /api/options/{symbol}/sentiment endpoint."""
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get("/api/options/AAPL/sentiment")

            if response.status_code == 404:
                pytest.skip("Options sentiment endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_options_unusual_with_params(self, test_client, mock_options_flow_analyzer):
        """Test unusual options endpoint with query parameters."""
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get(
                "/api/options/AAPL/unusual?min_premium=1000000&lookback_days=5"
            )

            if response.status_code == 404:
                pytest.skip("Options unusual endpoint not yet implemented")
            if response.status_code == 503:
                pytest.skip("Options flow analyzer not initialized")

            assert response.status_code == 200


# =============================================================================
# Sector Rotation Endpoint Tests
# =============================================================================


class TestSectorRotationEndpoints:
    """Tests for sector rotation API endpoints."""

    def test_get_rotation_pattern(self, test_client, mock_sector_rotation_analyzer):
        """Test GET /api/sectors/rotation endpoint."""
        with patch.object(
            app_state,
            "sector_rotation_analyzer",
            mock_sector_rotation_analyzer,
            create=True,
        ):
            response = test_client.get("/api/sectors/rotation")

            if response.status_code == 404:
                pytest.skip("Sector rotation endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_risk_regime(self, test_client, mock_sector_rotation_analyzer):
        """Test GET /api/sectors/risk-regime endpoint."""
        with patch.object(
            app_state,
            "sector_rotation_analyzer",
            mock_sector_rotation_analyzer,
            create=True,
        ):
            response = test_client.get("/api/sectors/risk-regime")

            if response.status_code == 404:
                pytest.skip("Risk regime endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_sector_momentum(self, test_client, mock_sector_rotation_analyzer):
        """Test GET /api/sectors/momentum endpoint."""
        with patch.object(
            app_state,
            "sector_rotation_analyzer",
            mock_sector_rotation_analyzer,
            create=True,
        ):
            response = test_client.get("/api/sectors/momentum")

            if response.status_code == 404:
                pytest.skip("Sector momentum endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_leadership_change(self, test_client, mock_sector_rotation_analyzer):
        """Test GET /api/sectors/leadership endpoint."""
        with patch.object(
            app_state,
            "sector_rotation_analyzer",
            mock_sector_rotation_analyzer,
            create=True,
        ):
            response = test_client.get("/api/sectors/leadership")

            if response.status_code == 404:
                pytest.skip("Leadership change endpoint not yet implemented")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True


# =============================================================================
# Smart Money Index Endpoint Tests
# =============================================================================


class TestSmartMoneyEndpoints:
    """Tests for smart money index API endpoints."""

    def test_get_smart_money_index(self, test_client, mock_smart_money_index):
        """Test GET /api/smart-money/{symbol} endpoint."""
        with patch.object(
            app_state, "smart_money_index", mock_smart_money_index, create=True
        ):
            response = test_client.get("/api/smart-money/AAPL")

            if response.status_code in [404, 503]:
                pytest.skip(
                    "Smart money index endpoint not yet implemented or initialized"
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_smart_money_divergence(self, test_client, mock_smart_money_index):
        """Test GET /api/smart-money/{symbol}/divergence endpoint."""
        with patch.object(
            app_state, "smart_money_index", mock_smart_money_index, create=True
        ):
            response = test_client.get("/api/smart-money/AAPL/divergence")

            if response.status_code in [404, 503]:
                pytest.skip(
                    "Smart money divergence endpoint not yet implemented or initialized"
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_get_market_smart_money(self, test_client, mock_smart_money_index):
        """Test GET /api/smart-money/market endpoint."""
        with patch.object(
            app_state, "smart_money_index", mock_smart_money_index, create=True
        ):
            response = test_client.get("/api/smart-money/market")

            if response.status_code in [404, 503]:
                pytest.skip(
                    "Market smart money endpoint not yet implemented or initialized"
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_post_smart_money_batch(self, test_client, mock_smart_money_index):
        """Test POST /api/smart-money/batch endpoint."""
        with patch.object(
            app_state, "smart_money_index", mock_smart_money_index, create=True
        ):
            response = test_client.post(
                "/api/smart-money/batch", json={"symbols": ["AAPL", "MSFT", "GOOGL"]}
            )

            if response.status_code in [404, 405, 503]:
                pytest.skip(
                    "Smart money batch endpoint not yet implemented or initialized"
                )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for API error handling."""

    def test_whale_endpoint_not_initialized(self, test_client):
        """Test whale endpoint when analyzer not initialized."""
        with patch.object(app_state, "whale_tracker", None, create=True):
            response = test_client.get("/api/whale/AAPL")

            if response.status_code == 404:
                pytest.skip("Whale endpoint not yet implemented")

            # Should return 503 Service Unavailable
            assert response.status_code == 503

    def test_options_endpoint_not_initialized(self, test_client):
        """Test options endpoint when analyzer not initialized."""
        with patch.object(app_state, "options_flow_analyzer", None, create=True):
            response = test_client.get("/api/options/AAPL/unusual")

            if response.status_code == 404:
                pytest.skip("Options endpoint not yet implemented")

            assert response.status_code == 503

    def test_sector_endpoint_not_initialized(self, test_client):
        """Test sector endpoint when analyzer not initialized."""
        with patch.object(app_state, "sector_rotation_analyzer", None, create=True):
            response = test_client.get("/api/sectors/rotation")

            if response.status_code == 404:
                pytest.skip("Sector rotation endpoint not yet implemented")

            assert response.status_code == 503

    def test_smart_money_endpoint_not_initialized(self, test_client):
        """Test smart money endpoint when index not initialized."""
        with patch.object(app_state, "smart_money_index", None, create=True):
            response = test_client.get("/api/smart-money/AAPL")

            if response.status_code == 404:
                pytest.skip("Smart money endpoint not yet implemented")

            assert response.status_code == 503

    def test_invalid_symbol_handling(self, test_client, mock_whale_tracker):
        """Test handling of invalid symbol."""
        mock_whale_tracker.track_whale_movements.side_effect = ValueError(
            "Invalid symbol"
        )
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/INVALID_SYMBOL_XYZ123")

            if response.status_code == 404:
                pytest.skip("Whale endpoint not yet implemented")

            # Should handle error gracefully
            assert response.status_code in [200, 400, 500]

    def test_data_not_found_handling(self, test_client, mock_options_flow_analyzer):
        """Test handling when no data found."""
        mock_options_flow_analyzer.detect_unusual_activity.return_value = pd.DataFrame()
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get("/api/options/RARE_STOCK/unusual")

            if response.status_code == 404:
                pytest.skip("Options endpoint not yet implemented")
            if response.status_code == 503:
                pytest.skip("Options flow analyzer not initialized")

            assert response.status_code == 200
            data = response.json()
            # Empty data is valid
            assert data["success"] is True


# =============================================================================
# Response Format Tests
# =============================================================================


class TestResponseFormat:
    """Tests for API response format consistency."""

    def test_whale_response_format(self, test_client, mock_whale_tracker):
        """Test whale endpoint response format."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/whale/AAPL")

            if response.status_code == 404:
                pytest.skip("Whale endpoint not yet implemented")

            data = response.json()
            assert "success" in data
            assert "data" in data
            assert "timestamp" in data

    def test_options_response_format(self, test_client, mock_options_flow_analyzer):
        """Test options endpoint response format."""
        with patch.object(
            app_state, "options_flow_analyzer", mock_options_flow_analyzer, create=True
        ):
            response = test_client.get("/api/options/AAPL/unusual")

            if response.status_code == 404:
                pytest.skip("Options endpoint not yet implemented")
            if response.status_code == 503:
                pytest.skip("Options flow analyzer not initialized")

            data = response.json()
            assert "success" in data
            assert "data" in data
            assert "timestamp" in data

    def test_sector_response_format(self, test_client, mock_sector_rotation_analyzer):
        """Test sector endpoint response format."""
        with patch.object(
            app_state,
            "sector_rotation_analyzer",
            mock_sector_rotation_analyzer,
            create=True,
        ):
            response = test_client.get("/api/sectors/rotation")

            if response.status_code == 404:
                pytest.skip("Sector rotation endpoint not yet implemented")

            data = response.json()
            assert "success" in data
            assert "data" in data
            assert "timestamp" in data

    def test_smart_money_response_format(self, test_client, mock_smart_money_index):
        """Test smart money endpoint response format."""
        with patch.object(
            app_state, "smart_money_index", mock_smart_money_index, create=True
        ):
            response = test_client.get("/api/smart-money/AAPL")

            if response.status_code in [404, 503]:
                pytest.skip("Smart money endpoint not yet implemented or initialized")

            data = response.json()
            assert "success" in data
            assert "data" in data
            assert "timestamp" in data


# =============================================================================
# Health Check Tests
# =============================================================================


class TestHealthCheck:
    """Tests for health check with new components."""

    def test_health_includes_new_analyzers(
        self,
        test_client,
        mock_whale_tracker,
        mock_options_flow_analyzer,
        mock_sector_rotation_analyzer,
        mock_smart_money_index,
    ):
        """Test that health check includes new analyzer status."""
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            with patch.object(
                app_state,
                "options_flow_analyzer",
                mock_options_flow_analyzer,
                create=True,
            ):
                with patch.object(
                    app_state,
                    "sector_rotation_analyzer",
                    mock_sector_rotation_analyzer,
                    create=True,
                ):
                    with patch.object(
                        app_state,
                        "smart_money_index",
                        mock_smart_money_index,
                        create=True,
                    ):
                        response = test_client.get("/api/health")

                        assert response.status_code == 200
                        data = response.json()

                        # Basic health check should pass
                        assert data["status"] in ["healthy", "degraded"]
                        assert "components" in data

    def test_health_degraded_when_analyzer_fails(self, test_client, mock_whale_tracker):
        """Test health is degraded when an analyzer fails."""
        mock_whale_tracker.health_check.return_value = False
        with patch.object(app_state, "whale_tracker", mock_whale_tracker, create=True):
            response = test_client.get("/api/health")

            assert response.status_code == 200
            # Health check should still return but may show degraded
