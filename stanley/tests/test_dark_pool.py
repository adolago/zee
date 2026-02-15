
import pytest
import pandas as pd
import numpy as np
from unittest.mock import MagicMock
from stanley.analytics.dark_pool import DarkPoolAnalyzer

class TestDarkPoolAnalyzer:

    @pytest.mark.asyncio
    async def test_get_dark_pool_by_venue_fallback_structure(self):
        """Test that fallback simulation returns correct structure."""
        # Force fallback by providing a mock provider that fails
        mock_provider = MagicMock()
        async def async_fail(*args, **kwargs):
            raise Exception("Force fallback")
        mock_provider.get_ats_venue_data = async_fail

        mock_provider._initialized = True
        async def async_init(*args, **kwargs): pass
        mock_provider.initialize = async_init

        analyzer = DarkPoolAnalyzer(finra_provider=mock_provider)

        df = await analyzer.get_dark_pool_by_venue("AAPL")

        assert isinstance(df, pd.DataFrame)
        expected_cols = ["venue_code", "venue_name", "volume", "percentage", "average_trade_size", "trade_count"]
        for col in expected_cols:
            assert col in df.columns

        assert len(df) > 0
        assert len(df) <= 8 # Fallback limits to 8 top venues

    @pytest.mark.asyncio
    async def test_get_dark_pool_by_venue_fallback_values(self):
        """Test that fallback simulation values are consistent."""
        # Force fallback
        mock_provider = MagicMock()
        async def async_fail(*args, **kwargs):
            raise Exception("Force fallback")
        mock_provider.get_ats_venue_data = async_fail

        mock_provider._initialized = True
        async def async_init(*args, **kwargs): pass
        mock_provider.initialize = async_init

        analyzer = DarkPoolAnalyzer(finra_provider=mock_provider)

        df = await analyzer.get_dark_pool_by_venue("AAPL")

        # Check percentage sums to <= 100
        total_pct = df["percentage"].sum()
        assert total_pct <= 100.0 + 0.1
        assert total_pct > 0.0

        # Check volume logic consistency
        # In the optimized version, percentages are calculated from volumes which are calculated from proportions
        # percentage = round(volume / total * 100, 2)
        # So volume / percentage should be roughly constant (total / 100)

        valid_rows = df[df["percentage"] > 1.0] # Avoid small number division issues
        if len(valid_rows) > 1:
            inferred_totals = valid_rows["volume"] / valid_rows["percentage"] * 100
            mean_total = inferred_totals.mean()
            # 5% tolerance due to rounding
            assert np.allclose(valid_rows["volume"] / valid_rows["percentage"] * 100, mean_total, rtol=0.05)
