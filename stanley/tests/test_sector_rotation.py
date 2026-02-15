"""
Tests for SectorRotationAnalyzer module.
"""

import pytest
from unittest.mock import Mock

from stanley.analytics.sector_rotation import (
    SectorRotationAnalyzer,
    BusinessCyclePhase,
    SECTOR_ETFS,
    CYCLE_SECTOR_MAP,
    RISK_ON_SECTORS,
    RISK_OFF_SECTORS,
)


class TestSectorRotationInit:
    """Tests for SectorRotationAnalyzer initialization."""

    def test_init_without_data_manager(self):
        """Test initialization without data manager."""
        analyzer = SectorRotationAnalyzer()
        assert analyzer is not None
        assert analyzer.data_manager is None

    def test_init_with_data_manager(self):
        """Test initialization with data manager."""
        mock_dm = Mock()
        analyzer = SectorRotationAnalyzer(data_manager=mock_dm)
        assert analyzer.data_manager is mock_dm

    def test_sector_etfs_loaded(self):
        """Test sector ETFs are loaded."""
        analyzer = SectorRotationAnalyzer()
        assert analyzer.sector_etfs == SECTOR_ETFS

    def test_cycle_sector_map_loaded(self):
        """Test cycle sector map is loaded."""
        analyzer = SectorRotationAnalyzer()
        assert analyzer.cycle_sector_map == CYCLE_SECTOR_MAP


class TestBusinessCyclePhase:
    """Tests for BusinessCyclePhase enum."""

    def test_phase_values(self):
        """Test business cycle phase values."""
        assert BusinessCyclePhase.EARLY_CYCLE.value == "early_cycle"
        assert BusinessCyclePhase.MID_CYCLE.value == "mid_cycle"
        assert BusinessCyclePhase.LATE_CYCLE.value == "late_cycle"
        assert BusinessCyclePhase.RECESSION.value == "recession"


class TestSectorConstants:
    """Tests for sector constants."""

    def test_sector_etfs_has_major_sectors(self):
        """Test that major sector ETFs are defined."""
        assert "XLK" in SECTOR_ETFS  # Technology
        assert "XLF" in SECTOR_ETFS  # Financials
        assert "XLE" in SECTOR_ETFS  # Energy
        assert "XLV" in SECTOR_ETFS  # Healthcare

    def test_risk_on_sectors(self):
        """Test risk-on sectors are defined."""
        assert "XLK" in RISK_ON_SECTORS
        assert "XLY" in RISK_ON_SECTORS

    def test_risk_off_sectors(self):
        """Test risk-off sectors are defined."""
        assert "XLU" in RISK_OFF_SECTORS
        assert "XLV" in RISK_OFF_SECTORS

    def test_cycle_sector_map_all_phases(self):
        """Test all business cycle phases have sectors."""
        assert BusinessCyclePhase.EARLY_CYCLE in CYCLE_SECTOR_MAP
        assert BusinessCyclePhase.MID_CYCLE in CYCLE_SECTOR_MAP
        assert BusinessCyclePhase.LATE_CYCLE in CYCLE_SECTOR_MAP
        assert BusinessCyclePhase.RECESSION in CYCLE_SECTOR_MAP


class TestSectorRotationMethods:
    """Tests for SectorRotationAnalyzer methods."""

    def test_has_sector_etfs_attribute(self):
        """Test sector_etfs attribute exists."""
        analyzer = SectorRotationAnalyzer()
        assert hasattr(analyzer, "sector_etfs")
        assert len(analyzer.sector_etfs) > 0

    def test_has_cycle_sector_map(self):
        """Test cycle_sector_map attribute exists."""
        analyzer = SectorRotationAnalyzer()
        assert hasattr(analyzer, "cycle_sector_map")


class TestSectorRotationEdgeCases:
    """Edge case tests for SectorRotationAnalyzer."""

    def test_none_data_manager(self):
        """Test with None data manager."""
        analyzer = SectorRotationAnalyzer(data_manager=None)
        assert analyzer.data_manager is None
