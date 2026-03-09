"""
Tests for Investing core module.
"""

import pytest
import pandas as pd
from pathlib import Path

from investing.core import Investing


class TestInvestingInit:
    """Tests for Investing initialization."""

    def test_init_no_config(self):
        """Test initialization without config path."""
        investing = Investing()
        assert investing is not None

    def test_init_with_config_path_string(self, tmp_path):
        """Test initialization with string config path."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text("test: value")
        investing = Investing(config_path=str(config_file))
        assert investing is not None

    def test_init_with_config_path_object(self, tmp_path):
        """Test initialization with Path config path."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text("test: value")
        investing = Investing(config_path=config_file)
        assert investing is not None

    def test_multiple_instances(self):
        """Test creating multiple Investing instances."""
        s1 = Investing()
        s2 = Investing()
        assert s1 is not s2


class TestAnalyzeSectorMoneyFlow:
    """Tests for analyze_sector_money_flow method."""

    def test_returns_dataframe(self):
        """Test that method returns a DataFrame."""
        investing = Investing()
        result = investing.analyze_sector_money_flow(["XLK", "XLF", "XLE"])
        assert isinstance(result, pd.DataFrame)

    def test_dataframe_has_expected_columns(self):
        """Test that DataFrame has expected columns."""
        investing = Investing()
        result = investing.analyze_sector_money_flow(["XLK", "XLF"])
        assert "sector" in result.columns
        assert "money_flow_score" in result.columns

    def test_empty_sectors_list(self):
        """Test with empty sectors list."""
        investing = Investing()
        result = investing.analyze_sector_money_flow([])
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0

    def test_single_sector(self):
        """Test with single sector."""
        investing = Investing()
        result = investing.analyze_sector_money_flow(["XLK"])
        assert len(result) == 1

    def test_multiple_sectors(self):
        """Test with multiple sectors."""
        investing = Investing()
        sectors = ["XLK", "XLF", "XLE", "XLI", "XLV"]
        result = investing.analyze_sector_money_flow(sectors)
        assert len(result) == len(sectors)

    def test_lookback_days_parameter(self):
        """Test lookback_days parameter is accepted."""
        investing = Investing()
        result = investing.analyze_sector_money_flow(["XLK"], lookback_days=30)
        assert isinstance(result, pd.DataFrame)

    def test_sectors_preserved_in_output(self):
        """Test that input sectors appear in output."""
        investing = Investing()
        sectors = ["XLK", "XLF"]
        result = investing.analyze_sector_money_flow(sectors)
        assert set(result["sector"].tolist()) == set(sectors)


class TestGetInstitutionalHoldings:
    """Tests for get_institutional_holdings method."""

    def test_returns_dict(self):
        """Test that method returns a dictionary."""
        investing = Investing()
        result = investing.get_institutional_holdings("AAPL")
        assert isinstance(result, dict)

    def test_has_expected_keys(self):
        """Test that result has expected keys."""
        investing = Investing()
        result = investing.get_institutional_holdings("AAPL")
        assert "symbol" in result
        assert "institutional_ownership" in result
        assert "top_holders" in result

    def test_symbol_echoed_in_result(self):
        """Test that input symbol appears in result."""
        investing = Investing()
        result = investing.get_institutional_holdings("MSFT")
        assert result["symbol"] == "MSFT"

    def test_institutional_ownership_range(self):
        """Test that institutional_ownership is in valid range."""
        investing = Investing()
        result = investing.get_institutional_holdings("AAPL")
        assert 0 <= result["institutional_ownership"] <= 1

    def test_top_holders_is_list(self):
        """Test that top_holders is a list."""
        investing = Investing()
        result = investing.get_institutional_holdings("AAPL")
        assert isinstance(result["top_holders"], list)


class TestHealthCheck:
    """Tests for health_check method."""

    def test_returns_dict(self):
        """Test that health_check returns a dictionary."""
        investing = Investing()
        result = investing.health_check()
        assert isinstance(result, dict)

    def test_has_core_key(self):
        """Test that result has 'core' key."""
        investing = Investing()
        result = investing.health_check()
        assert "core" in result

    def test_has_status_key(self):
        """Test that result has 'status' key."""
        investing = Investing()
        result = investing.health_check()
        assert "status" in result

    def test_core_is_boolean(self):
        """Test that 'core' value is boolean."""
        investing = Investing()
        result = investing.health_check()
        assert isinstance(result["core"], bool)

    def test_status_is_string(self):
        """Test that 'status' value is string."""
        investing = Investing()
        result = investing.health_check()
        assert isinstance(result["status"], str)

    def test_healthy_state(self):
        """Test that healthy Investing reports operational status."""
        investing = Investing()
        result = investing.health_check()
        assert result["core"] is True
        assert result["status"] == "operational"
