"""
Tests for DataManager module.
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import asyncio

from stanley.data.data_manager import DataManager


def run_async(coro):
    """Helper to run async functions in tests."""
    return asyncio.new_event_loop().run_until_complete(coro)


class TestDataManagerInit:
    """Tests for DataManager initialization."""

    def test_init_with_config(self, sample_config):
        """Test initialization with config."""
        manager = DataManager(config=sample_config, use_mock=True)
        assert manager is not None
        assert manager.config == sample_config

    def test_init_not_initialized(self, sample_config):
        """Test that DataManager is not initialized at creation."""
        manager = DataManager(config=sample_config, use_mock=True)
        assert manager._initialized is False

    def test_init_mock_mode(self, sample_config):
        """Test that mock mode is properly set."""
        manager = DataManager(config=sample_config, use_mock=True)
        assert manager._use_mock is True


class TestGetStockData:
    """Tests for get_stock_data async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_stock_data("AAPL", start_date, end_date))
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self, sample_config):
        """Test that DataFrame has expected OHLCV columns."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_stock_data("AAPL", start_date, end_date))
        expected_cols = ["date", "open", "high", "low", "close", "volume"]
        for col in expected_cols:
            assert col in result.columns

    def test_ohlc_constraints(self, sample_config):
        """Test that OHLC constraints are maintained (high >= low)."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_stock_data("AAPL", start_date, end_date))
        # High should always be >= Low
        assert all(result["high"] >= result["low"])

    def test_prices_positive(self, sample_config):
        """Test that all prices are positive."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_stock_data("AAPL", start_date, end_date))
        assert all(result["close"] > 0)
        assert all(result["open"] > 0)
        assert all(result["high"] > 0)
        assert all(result["low"] > 0)

    def test_volume_positive(self, sample_config):
        """Test that volume is positive."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_stock_data("AAPL", start_date, end_date))
        assert all(result["volume"] > 0)

    def test_single_day_data(self, sample_config):
        """Test fetching single day of data."""
        manager = DataManager(config=sample_config, use_mock=True)
        date = datetime.now()
        result = run_async(manager.get_stock_data("AAPL", date, date))
        assert len(result) >= 1


class TestGetETFFlows:
    """Tests for get_etf_flows async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_etf_flows("SPY", start_date, end_date))
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self, sample_config):
        """Test that DataFrame has expected columns."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_etf_flows("SPY", start_date, end_date))
        expected_cols = ["date", "net_flow", "creation_units", "redemption_units"]
        for col in expected_cols:
            assert col in result.columns

    def test_creation_redemption_logic(self, sample_config):
        """Test that creation/redemption units follow net_flow logic."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        result = run_async(manager.get_etf_flows("SPY", start_date, end_date))
        # When net_flow > 0, creation_units should be > 0
        positive_flow = result[result["net_flow"] > 0]
        if len(positive_flow) > 0:
            assert all(positive_flow["creation_units"] > 0)


class TestGetInstitutionalHoldings:
    """Tests for get_institutional_holdings async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_institutional_holdings("AAPL"))
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self, sample_config):
        """Test that DataFrame has expected columns."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_institutional_holdings("AAPL"))
        expected_cols = [
            "manager_name",
            "manager_cik",
            "shares_held",
            "value_held",
            "ownership_percentage",
        ]
        for col in expected_cols:
            assert col in result.columns

    def test_shares_positive(self, sample_config):
        """Test that shares_held is positive."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_institutional_holdings("AAPL"))
        assert all(result["shares_held"] > 0)


class TestGetOptionsFlow:
    """Tests for get_options_flow async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_options_flow("AAPL"))
        assert isinstance(result, pd.DataFrame)

    def test_unusual_only_parameter(self, sample_config):
        """Test unusual_only parameter."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_options_flow("AAPL", unusual_only=False))
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self, sample_config):
        """Test that DataFrame has expected columns."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_options_flow("AAPL"))
        expected_cols = [
            "date",
            "contract_symbol",
            "volume",
            "open_interest",
            "notional_value",
            "unusual_activity",
        ]
        for col in expected_cols:
            assert col in result.columns


class TestGetDarkPoolVolume:
    """Tests for get_dark_pool_volume async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_dark_pool_volume("AAPL"))
        assert isinstance(result, pd.DataFrame)

    def test_lookback_days_parameter(self, sample_config):
        """Test lookback_days parameter."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_dark_pool_volume("AAPL", lookback_days=10))
        assert len(result) == 10

    def test_dark_pool_percentage_bounded(self, sample_config):
        """Test that dark_pool_percentage is in expected range."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_dark_pool_volume("AAPL"))
        assert all(result["dark_pool_percentage"] >= 0)
        assert all(result["dark_pool_percentage"] <= 1)


class TestGetShortInterest:
    """Tests for get_short_interest async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_short_interest("AAPL"))
        assert isinstance(result, pd.DataFrame)

    def test_has_expected_columns(self, sample_config):
        """Test that DataFrame has expected columns."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_short_interest("AAPL"))
        expected_cols = [
            "current_short_interest",
            "previous_short_interest",
            "days_to_cover",
            "short_ratio",
        ]
        for col in expected_cols:
            assert col in result.columns

    def test_days_to_cover_positive(self, sample_config):
        """Test that days_to_cover is positive."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_short_interest("AAPL"))
        assert all(result["days_to_cover"] > 0)


class TestGetInsiderTrading:
    """Tests for get_insider_trading async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_insider_trading("AAPL"))
        assert isinstance(result, pd.DataFrame)

    def test_lookback_days_parameter(self, sample_config):
        """Test lookback_days parameter returns correct number of rows."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_insider_trading("AAPL", lookback_days=30))
        # Mock generates one entry per day
        assert len(result) == 30

    def test_transaction_types(self, sample_config):
        """Test that transaction_type is Buy or Sell."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_insider_trading("AAPL"))
        assert all(result["transaction_type"].isin(["Buy", "Sell"]))


class TestGetEconomicData:
    """Tests for get_economic_data async method."""

    def test_returns_dataframe(self, sample_config):
        """Test that method returns a DataFrame."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=365)
        result = run_async(
            manager.get_economic_data("unemployment_rate", start_date, end_date)
        )
        assert isinstance(result, pd.DataFrame)

    def test_unemployment_rate_range(self, sample_config):
        """Test that unemployment_rate values are in expected range."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=365)
        result = run_async(
            manager.get_economic_data("unemployment_rate", start_date, end_date)
        )
        assert all(result["value"] >= 0)
        assert all(result["value"] <= 100)

    def test_indicator_echoed(self, sample_config):
        """Test that indicator name is echoed in result."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=365)
        result = run_async(
            manager.get_economic_data("gdp_growth", start_date, end_date)
        )
        assert all(result["indicator"] == "gdp_growth")


class TestHealthCheck:
    """Tests for health_check async method."""

    def test_returns_boolean(self, sample_config):
        """Test that health_check returns a boolean."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.health_check())
        assert isinstance(result, bool)

    def test_returns_true(self, sample_config):
        """Test that health_check returns True for operational state."""
        manager = DataManager(config=sample_config, use_mock=True)
        assert run_async(manager.health_check()) is True


class TestEdgeCases:
    """Edge case tests for DataManager."""

    def test_same_start_end_date(self, sample_config):
        """Test with same start and end date."""
        manager = DataManager(config=sample_config, use_mock=True)
        date = datetime.now()
        result = run_async(manager.get_stock_data("AAPL", date, date))
        assert isinstance(result, pd.DataFrame)

    def test_very_long_date_range(self, sample_config):
        """Test with very long date range."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=1000)
        result = run_async(manager.get_stock_data("AAPL", start_date, end_date))
        assert isinstance(result, pd.DataFrame)

    def test_lookback_one_day(self, sample_config):
        """Test with lookback_days = 1."""
        manager = DataManager(config=sample_config, use_mock=True)
        result = run_async(manager.get_dark_pool_volume("AAPL", lookback_days=1))
        assert len(result) == 1

    def test_concurrent_requests(self, sample_config):
        """Test multiple concurrent requests."""
        manager = DataManager(config=sample_config, use_mock=True)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=10)

        async def run_concurrent():
            return await asyncio.gather(
                manager.get_stock_data("AAPL", start_date, end_date),
                manager.get_stock_data("MSFT", start_date, end_date),
                manager.get_stock_data("GOOGL", start_date, end_date),
            )

        results = run_async(run_concurrent())
        assert len(results) == 3
        for result in results:
            assert isinstance(result, pd.DataFrame)
