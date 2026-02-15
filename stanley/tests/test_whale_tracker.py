"""
Tests for WhaleTracker module.
"""

import pytest
import pandas as pd
from unittest.mock import Mock, patch

from stanley.analytics.whale_tracker import WhaleTracker


class TestWhaleTrackerInit:
    """Tests for WhaleTracker initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data manager."""
        tracker = WhaleTracker()
        assert tracker is not None
        assert tracker.data_manager is None

    def test_init_with_data_manager(self):
        """Test initialization with data manager."""
        mock_dm = Mock()
        tracker = WhaleTracker(data_manager=mock_dm)
        assert tracker.data_manager is mock_dm


class TestTrackWhaleMovements:
    """Tests for track_whale_movements method."""

    def test_returns_dataframe(self):
        """Test that method returns a DataFrame."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("AAPL")
        assert isinstance(result, pd.DataFrame)

    def test_empty_holdings(self):
        """Test with empty holdings data."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("AAPL")
        assert len(result) == 0

    def test_threshold_parameter(self):
        """Test threshold_pct parameter."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("AAPL", threshold_pct=5.0)
        assert isinstance(result, pd.DataFrame)

    def test_lookback_quarters_parameter(self):
        """Test lookback_quarters parameter."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("AAPL", lookback_quarters=8)
        assert isinstance(result, pd.DataFrame)


class TestWhaleTrackerMethods:
    """Tests for WhaleTracker helper methods."""

    def test_has_get_holdings_method(self):
        """Test that _get_holdings method exists."""
        tracker = WhaleTracker()
        assert hasattr(tracker, "_get_holdings")

    def test_has_calculate_movements_method(self):
        """Test that _calculate_movements method exists."""
        tracker = WhaleTracker()
        assert hasattr(tracker, "_calculate_movements")


class TestWhaleTrackerEdgeCases:
    """Edge case tests for WhaleTracker."""

    def test_invalid_symbol(self):
        """Test with invalid symbol."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("INVALID")
        assert isinstance(result, pd.DataFrame)

    def test_zero_threshold(self):
        """Test with zero threshold."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("AAPL", threshold_pct=0)
        assert isinstance(result, pd.DataFrame)

    def test_single_quarter_lookback(self):
        """Test with single quarter lookback."""
        tracker = WhaleTracker()
        with patch.object(tracker, "_get_holdings", return_value=pd.DataFrame()):
            result = tracker.track_whale_movements("AAPL", lookback_quarters=1)
        assert isinstance(result, pd.DataFrame)
