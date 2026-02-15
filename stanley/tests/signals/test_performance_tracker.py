"""
Tests for PerformanceTracker module.

This module tests performance tracking functionality including:
- Signal recording
- Outcome recording
- Performance statistics calculation
- History retrieval
- Analysis by various dimensions
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

# Skip all tests if signals module doesn't exist yet
try:
    from stanley.signals import PerformanceTracker
    from stanley.signals.performance_tracker import (
        SignalRecord,
        OutcomeRecord,
        PerformanceStats,
        TrackingPeriod,
    )

    HAS_SIGNALS_MODULE = True
except ImportError:
    HAS_SIGNALS_MODULE = False
    PerformanceTracker = None
    SignalRecord = None
    OutcomeRecord = None
    PerformanceStats = None
    TrackingPeriod = None

pytestmark = pytest.mark.skipif(
    not HAS_SIGNALS_MODULE, reason="stanley.signals module not yet implemented"
)


# =============================================================================
# PerformanceTracker Initialization Tests
# =============================================================================


class TestPerformanceTrackerInit:
    """Tests for PerformanceTracker initialization."""

    def test_init_without_params(self):
        """Test initialization without parameters."""
        tracker = PerformanceTracker()
        assert tracker is not None

    def test_init_with_storage_path(self, tmp_path):
        """Test initialization with storage path."""
        storage_file = tmp_path / "performance.db"
        tracker = PerformanceTracker(storage_path=str(storage_file))
        assert tracker.storage_path == str(storage_file)

    def test_init_with_retention_days(self):
        """Test initialization with custom retention period."""
        tracker = PerformanceTracker(retention_days=90)
        assert tracker.retention_days == 90

    def test_init_creates_empty_history(self):
        """Test that initialization creates empty history."""
        tracker = PerformanceTracker()
        history = tracker.get_signal_history()
        assert isinstance(history, list)
        assert len(history) == 0


# =============================================================================
# Signal Recording Tests
# =============================================================================


class TestSignalRecording:
    """Tests for signal recording functionality."""

    def test_record_signal(self, sample_signal):
        """Test recording a single signal."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
            conviction=sample_signal["conviction"],
            factors=sample_signal["factors"],
        )

        assert record_id is not None
        assert isinstance(record_id, str)

    def test_record_signal_creates_record(self, sample_signal):
        """Test that record_signal creates a SignalRecord."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
        )

        record = tracker.get_signal(record_id)
        assert isinstance(record, SignalRecord)
        assert record.symbol == sample_signal["symbol"]
        assert record.direction == sample_signal["direction"]

    def test_record_multiple_signals(self, sample_signals_list):
        """Test recording multiple signals."""
        tracker = PerformanceTracker()

        record_ids = []
        for signal in sample_signals_list:
            record_id = tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )
            record_ids.append(record_id)

        assert len(record_ids) == len(sample_signals_list)
        assert len(set(record_ids)) == len(record_ids)  # All unique

    def test_record_signal_with_optional_fields(self, sample_signal):
        """Test recording signal with all optional fields."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
            conviction=sample_signal["conviction"],
            factors=sample_signal["factors"],
            entry_price=sample_signal["entry_price"],
            target_price=sample_signal["target_price"],
            stop_loss=sample_signal["stop_loss"],
            metadata={"source": "test", "version": "1.0"},
        )

        record = tracker.get_signal(record_id)
        assert record.entry_price == sample_signal["entry_price"]
        assert record.target_price == sample_signal["target_price"]
        assert record.metadata["source"] == "test"


# =============================================================================
# Outcome Recording Tests
# =============================================================================


class TestOutcomeRecording:
    """Tests for outcome recording functionality."""

    def test_record_outcome(self, sample_signal):
        """Test recording an outcome for a signal."""
        tracker = PerformanceTracker()

        # First record the signal
        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
        )

        # Then record the outcome
        outcome_id = tracker.record_outcome(
            signal_id=record_id,
            exit_time=datetime.now(),
            exit_price=195.00,
            pnl=1950.00,
            pnl_percent=11.11,
            holding_period_days=10,
        )

        assert outcome_id is not None

    def test_record_outcome_updates_signal(self, sample_signal):
        """Test that recording outcome updates the signal record."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
        )

        tracker.record_outcome(
            signal_id=record_id,
            exit_time=datetime.now(),
            exit_price=195.00,
            pnl=1950.00,
            pnl_percent=11.11,
        )

        record = tracker.get_signal(record_id)
        assert record.has_outcome is True
        assert record.outcome is not None
        assert record.outcome.pnl == 1950.00

    def test_record_outcome_invalid_signal(self):
        """Test recording outcome for non-existent signal."""
        tracker = PerformanceTracker()

        with pytest.raises(ValueError, match="Signal not found"):
            tracker.record_outcome(
                signal_id="nonexistent_id",
                exit_time=datetime.now(),
                exit_price=100.0,
                pnl=0.0,
                pnl_percent=0.0,
            )

    def test_record_losing_outcome(self, sample_signal):
        """Test recording a losing outcome."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction="BULLISH",
            strength=0.75,
            confidence=0.85,
        )

        tracker.record_outcome(
            signal_id=record_id,
            exit_time=datetime.now(),
            exit_price=165.00,  # Below entry
            pnl=-1050.00,  # Loss
            pnl_percent=-6.0,
        )

        record = tracker.get_signal(record_id)
        assert record.outcome.pnl < 0
        assert record.outcome.is_winner is False


# =============================================================================
# Performance Statistics Tests
# =============================================================================


class TestPerformanceStatistics:
    """Tests for performance statistics calculation."""

    def test_get_performance_stats(self, sample_trade_records):
        """Test retrieving performance statistics."""
        tracker = PerformanceTracker()

        # Add signals with outcomes
        for trade in sample_trade_records:
            record_id = tracker.record_signal(
                symbol=trade["symbol"],
                timestamp=trade["entry_time"],
                direction="BULLISH" if trade["direction"] == "LONG" else "BEARISH",
                strength=trade["signal_strength"],
                confidence=trade["signal_confidence"],
            )
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=trade["exit_time"],
                exit_price=trade["exit_price"],
                pnl=trade["pnl"],
                pnl_percent=trade["pnl_percent"],
            )

        stats = tracker.get_performance_stats()

        assert isinstance(stats, PerformanceStats)
        assert hasattr(stats, "total_signals")
        assert hasattr(stats, "win_rate")
        assert hasattr(stats, "average_pnl")

    def test_performance_stats_win_rate(self, sample_trade_records):
        """Test win rate calculation in stats."""
        tracker = PerformanceTracker()

        for trade in sample_trade_records:
            record_id = tracker.record_signal(
                symbol=trade["symbol"],
                timestamp=trade["entry_time"],
                direction="BULLISH",
                strength=trade["signal_strength"],
                confidence=trade["signal_confidence"],
            )
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=trade["exit_time"],
                exit_price=trade["exit_price"],
                pnl=trade["pnl"],
                pnl_percent=trade["pnl_percent"],
            )

        stats = tracker.get_performance_stats()

        # 2 winners out of 3 = 66.67%
        assert stats.win_rate == pytest.approx(0.6667, rel=0.01)

    def test_performance_stats_by_symbol(self, sample_trade_records):
        """Test performance stats grouped by symbol."""
        tracker = PerformanceTracker()

        for trade in sample_trade_records:
            record_id = tracker.record_signal(
                symbol=trade["symbol"],
                timestamp=trade["entry_time"],
                direction="BULLISH",
                strength=trade["signal_strength"],
                confidence=trade["signal_confidence"],
            )
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=trade["exit_time"],
                exit_price=trade["exit_price"],
                pnl=trade["pnl"],
                pnl_percent=trade["pnl_percent"],
            )

        stats_by_symbol = tracker.get_performance_stats(group_by="symbol")

        assert isinstance(stats_by_symbol, dict)
        assert "AAPL" in stats_by_symbol
        assert "MSFT" in stats_by_symbol

    def test_performance_stats_by_direction(self, sample_trade_records):
        """Test performance stats grouped by direction."""
        tracker = PerformanceTracker()

        for trade in sample_trade_records:
            direction = "BULLISH" if trade["direction"] == "LONG" else "BEARISH"
            record_id = tracker.record_signal(
                symbol=trade["symbol"],
                timestamp=trade["entry_time"],
                direction=direction,
                strength=trade["signal_strength"],
                confidence=trade["signal_confidence"],
            )
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=trade["exit_time"],
                exit_price=trade["exit_price"],
                pnl=trade["pnl"],
                pnl_percent=trade["pnl_percent"],
            )

        stats_by_direction = tracker.get_performance_stats(group_by="direction")

        assert isinstance(stats_by_direction, dict)
        assert "BULLISH" in stats_by_direction or "BEARISH" in stats_by_direction

    def test_performance_stats_by_time_period(self, sample_trade_records):
        """Test performance stats for specific time period."""
        tracker = PerformanceTracker()

        for trade in sample_trade_records:
            record_id = tracker.record_signal(
                symbol=trade["symbol"],
                timestamp=trade["entry_time"],
                direction="BULLISH",
                strength=trade["signal_strength"],
                confidence=trade["signal_confidence"],
            )
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=trade["exit_time"],
                exit_price=trade["exit_price"],
                pnl=trade["pnl"],
                pnl_percent=trade["pnl_percent"],
            )

        period = TrackingPeriod(
            start=datetime.now() - timedelta(days=60),
            end=datetime.now(),
        )
        stats = tracker.get_performance_stats(period=period)

        assert isinstance(stats, PerformanceStats)


# =============================================================================
# History Retrieval Tests
# =============================================================================


class TestHistoryRetrieval:
    """Tests for history retrieval functionality."""

    def test_get_signal_history(self, sample_signals_list):
        """Test retrieving signal history."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        history = tracker.get_signal_history()

        assert isinstance(history, list)
        assert len(history) == len(sample_signals_list)

    def test_get_signal_history_filtered_by_symbol(self, sample_signals_list):
        """Test retrieving history filtered by symbol."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        history = tracker.get_signal_history(symbol="AAPL")

        assert all(record.symbol == "AAPL" for record in history)

    def test_get_signal_history_filtered_by_direction(self, sample_signals_list):
        """Test retrieving history filtered by direction."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        history = tracker.get_signal_history(direction="BULLISH")

        assert all(record.direction == "BULLISH" for record in history)

    def test_get_signal_history_filtered_by_date_range(self, sample_signals_list):
        """Test retrieving history filtered by date range."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        start_date = datetime.now() - timedelta(days=7)
        end_date = datetime.now() + timedelta(days=1)
        history = tracker.get_signal_history(start_date=start_date, end_date=end_date)

        assert isinstance(history, list)
        for record in history:
            assert start_date <= record.timestamp <= end_date

    def test_get_signal_history_with_outcomes_only(self, sample_trade_records):
        """Test retrieving only signals with recorded outcomes."""
        tracker = PerformanceTracker()

        # Record some signals with outcomes
        for trade in sample_trade_records[:2]:
            record_id = tracker.record_signal(
                symbol=trade["symbol"],
                timestamp=trade["entry_time"],
                direction="BULLISH",
                strength=trade["signal_strength"],
                confidence=trade["signal_confidence"],
            )
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=trade["exit_time"],
                exit_price=trade["exit_price"],
                pnl=trade["pnl"],
                pnl_percent=trade["pnl_percent"],
            )

        # Record signal without outcome
        tracker.record_signal(
            symbol="TEST",
            timestamp=datetime.now(),
            direction="NEUTRAL",
            strength=0.1,
            confidence=0.5,
        )

        history = tracker.get_signal_history(with_outcomes_only=True)

        assert len(history) == 2
        assert all(record.has_outcome for record in history)

    def test_get_signal_history_as_dataframe(self, sample_signals_list):
        """Test retrieving history as pandas DataFrame."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        df = tracker.get_signal_history_df()

        assert isinstance(df, pd.DataFrame)
        assert "symbol" in df.columns
        assert "direction" in df.columns
        assert "strength" in df.columns
        assert len(df) == len(sample_signals_list)


# =============================================================================
# Signal Record Data Class Tests
# =============================================================================


class TestSignalRecord:
    """Tests for SignalRecord data class."""

    def test_signal_record_creation(self):
        """Test creating a SignalRecord instance."""
        record = SignalRecord(
            record_id="signal_001",
            symbol="AAPL",
            timestamp=datetime.now(),
            direction="BULLISH",
            strength=0.75,
            confidence=0.85,
        )
        assert record.symbol == "AAPL"
        assert record.direction == "BULLISH"
        assert record.has_outcome is False

    def test_signal_record_with_outcome(self):
        """Test SignalRecord with attached outcome."""
        outcome = OutcomeRecord(
            outcome_id="outcome_001",
            signal_id="signal_001",
            exit_time=datetime.now(),
            exit_price=195.00,
            pnl=1950.00,
            pnl_percent=11.11,
        )
        record = SignalRecord(
            record_id="signal_001",
            symbol="AAPL",
            timestamp=datetime.now(),
            direction="BULLISH",
            strength=0.75,
            confidence=0.85,
            outcome=outcome,
        )
        assert record.has_outcome is True
        assert record.outcome.pnl == 1950.00


class TestOutcomeRecord:
    """Tests for OutcomeRecord data class."""

    def test_outcome_record_creation(self):
        """Test creating an OutcomeRecord instance."""
        record = OutcomeRecord(
            outcome_id="outcome_001",
            signal_id="signal_001",
            exit_time=datetime.now(),
            exit_price=195.00,
            pnl=1950.00,
            pnl_percent=11.11,
        )
        assert record.pnl == 1950.00
        assert record.is_winner is True

    def test_outcome_record_losing_trade(self):
        """Test OutcomeRecord for losing trade."""
        record = OutcomeRecord(
            outcome_id="outcome_001",
            signal_id="signal_001",
            exit_time=datetime.now(),
            exit_price=165.00,
            pnl=-1050.00,
            pnl_percent=-6.0,
        )
        assert record.is_winner is False


# =============================================================================
# Edge Case Tests
# =============================================================================


class TestPerformanceTrackerEdgeCases:
    """Edge case tests for PerformanceTracker."""

    def test_empty_history_stats(self):
        """Test getting stats with no recorded signals."""
        tracker = PerformanceTracker()

        stats = tracker.get_performance_stats()

        assert stats.total_signals == 0
        assert stats.win_rate == 0.0
        assert stats.average_pnl == 0.0

    def test_signals_without_outcomes_stats(self, sample_signals_list):
        """Test stats when signals have no outcomes."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        stats = tracker.get_performance_stats()

        assert stats.total_signals == len(sample_signals_list)
        assert stats.signals_with_outcomes == 0

    def test_get_nonexistent_signal(self):
        """Test retrieving non-existent signal."""
        tracker = PerformanceTracker()

        record = tracker.get_signal("nonexistent_id")

        assert record is None

    def test_duplicate_outcome_recording(self, sample_signal):
        """Test recording outcome twice for same signal."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
        )

        # First outcome
        tracker.record_outcome(
            signal_id=record_id,
            exit_time=datetime.now(),
            exit_price=195.00,
            pnl=1950.00,
            pnl_percent=11.11,
        )

        # Second outcome should raise error
        with pytest.raises(ValueError, match="Outcome already recorded"):
            tracker.record_outcome(
                signal_id=record_id,
                exit_time=datetime.now(),
                exit_price=200.00,
                pnl=2450.00,
                pnl_percent=14.0,
            )

    def test_extreme_pnl_values(self, sample_signal):
        """Test handling of extreme PnL values."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
        )

        # Very large gain
        tracker.record_outcome(
            signal_id=record_id,
            exit_time=datetime.now(),
            exit_price=1750.00,  # 10x gain
            pnl=1575000.00,
            pnl_percent=900.0,
        )

        record = tracker.get_signal(record_id)
        assert record.outcome.pnl == 1575000.00

    def test_zero_pnl_outcome(self, sample_signal):
        """Test outcome with zero PnL (breakeven)."""
        tracker = PerformanceTracker()

        record_id = tracker.record_signal(
            symbol=sample_signal["symbol"],
            timestamp=sample_signal["timestamp"],
            direction=sample_signal["direction"],
            strength=sample_signal["strength"],
            confidence=sample_signal["confidence"],
        )

        tracker.record_outcome(
            signal_id=record_id,
            exit_time=datetime.now(),
            exit_price=175.50,  # Same as entry
            pnl=0.0,
            pnl_percent=0.0,
        )

        record = tracker.get_signal(record_id)
        assert record.outcome.pnl == 0.0
        assert record.outcome.is_winner is False  # Breakeven is not a winner


# =============================================================================
# Persistence Tests
# =============================================================================


class TestPerformanceTrackerPersistence:
    """Tests for performance tracker data persistence."""

    def test_save_and_load_history(self, tmp_path, sample_signals_list):
        """Test saving and loading signal history."""
        storage_file = tmp_path / "test_performance.db"
        tracker = PerformanceTracker(storage_path=str(storage_file))

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        tracker.save()

        # Create new tracker and load
        tracker2 = PerformanceTracker(storage_path=str(storage_file))
        tracker2.load()

        history = tracker2.get_signal_history()
        assert len(history) == len(sample_signals_list)

    def test_export_to_csv(self, tmp_path, sample_signals_list):
        """Test exporting history to CSV."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        csv_path = tmp_path / "signals.csv"
        tracker.export_to_csv(str(csv_path))

        # Verify file exists and is valid CSV
        assert csv_path.exists()
        df = pd.read_csv(csv_path)
        assert len(df) == len(sample_signals_list)

    def test_export_to_json(self, tmp_path, sample_signals_list):
        """Test exporting history to JSON."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        json_path = tmp_path / "signals.json"
        tracker.export_to_json(str(json_path))

        assert json_path.exists()


# =============================================================================
# Health Check Tests
# =============================================================================


class TestPerformanceTrackerHealthCheck:
    """Tests for PerformanceTracker health check."""

    def test_health_check_returns_true(self):
        """Test that health_check returns True when healthy."""
        tracker = PerformanceTracker()
        assert tracker.health_check() is True

    def test_health_check_with_data(self, sample_signals_list):
        """Test health check after recording data."""
        tracker = PerformanceTracker()

        for signal in sample_signals_list:
            tracker.record_signal(
                symbol=signal["symbol"],
                timestamp=signal["timestamp"],
                direction=signal["direction"],
                strength=signal["strength"],
                confidence=signal["confidence"],
            )

        assert tracker.health_check() is True
