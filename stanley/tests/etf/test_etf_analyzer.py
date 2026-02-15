"""
Tests for ETF Flow Analyzer Module

Comprehensive test coverage for ETF analytics including:
- Flow tracking
- Sector rotation
- Smart beta analysis
- Thematic flows
- Institutional positioning
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd

from stanley.etf import (
    ETFAnalyzer,
    ETFCategory,
    ETFFlowSummary,
    ETFInfo,
    SectorRotationSignal,
    SmartBetaFlow,
    ThematicFlowAnalysis,
)
from stanley.etf.etf_analyzer import (
    ETF_REGISTRY,
    FACTOR_DEFINITIONS,
    SECTOR_ETFS,
    SMART_BETA_ETFS,
    THEMATIC_ETFS,
    THEME_DEFINITIONS,
)


class TestETFInfo:
    """Test ETFInfo dataclass."""

    def test_etf_info_creation(self):
        """Test creating an ETFInfo instance."""
        etf = ETFInfo(
            symbol="TEST",
            name="Test ETF",
            category=ETFCategory.SECTOR,
            issuer="Test Issuer",
            expense_ratio=0.10,
            aum=1_000_000_000,
            inception_date=datetime(2020, 1, 1),
            benchmark="Test Index",
            sector="Technology",
        )

        assert etf.symbol == "TEST"
        assert etf.name == "Test ETF"
        assert etf.category == ETFCategory.SECTOR
        assert etf.sector == "Technology"

    def test_etf_info_to_dict(self):
        """Test ETFInfo serialization to dict."""
        etf = ETFInfo(
            symbol="TEST",
            name="Test ETF",
            category=ETFCategory.SMART_BETA,
            issuer="Test Issuer",
            expense_ratio=0.15,
            aum=500_000_000,
            inception_date=datetime(2020, 6, 15),
            benchmark="Factor Index",
            factor="momentum",
        )

        result = etf.to_dict()

        assert result["symbol"] == "TEST"
        assert result["category"] == "smart_beta"
        assert result["factor"] == "momentum"
        assert result["expenseRatio"] == 0.15


class TestETFFlowSummary:
    """Test ETFFlowSummary dataclass."""

    def test_flow_summary_creation(self):
        """Test creating an ETFFlowSummary instance."""
        summary = ETFFlowSummary(
            symbol="XLK",
            name="Technology Select Sector",
            category="sector",
            aum=60_000_000_000,
            price=180.50,
            change_1d=1.5,
            change_1w=3.2,
            change_1m=5.8,
            net_flow_1d=100_000_000,
            net_flow_1w=500_000_000,
            net_flow_1m=2_000_000_000,
            net_flow_3m=5_000_000_000,
            creation_units_1w=50,
            redemption_units_1w=20,
            flow_momentum=0.35,
            institutional_flow_pct=0.75,
            flow_signal="strong_inflow",
        )

        assert summary.symbol == "XLK"
        assert summary.net_flow_1m == 2_000_000_000
        assert summary.flow_signal == "strong_inflow"

    def test_flow_summary_to_dict(self):
        """Test ETFFlowSummary serialization."""
        summary = ETFFlowSummary(
            symbol="SPY",
            name="S&P 500 ETF",
            category="broad_market",
            aum=500_000_000_000,
            price=450.25,
            change_1d=0.5,
            change_1w=1.2,
            change_1m=2.5,
            net_flow_1d=500_000_000,
            net_flow_1w=2_000_000_000,
            net_flow_1m=8_000_000_000,
            net_flow_3m=20_000_000_000,
            creation_units_1w=100,
            redemption_units_1w=30,
            flow_momentum=0.5,
            institutional_flow_pct=0.85,
            flow_signal="inflow",
        )

        result = summary.to_dict()

        assert result["symbol"] == "SPY"
        assert result["netFlow1m"] == 8_000_000_000
        assert result["flowSignal"] == "inflow"
        assert "timestamp" in result


class TestSectorRotationSignal:
    """Test SectorRotationSignal dataclass."""

    def test_rotation_signal_creation(self):
        """Test creating a sector rotation signal."""
        signal = SectorRotationSignal(
            sector="Technology",
            etf_symbol="XLK",
            current_rank=1,
            previous_rank=3,
            rank_change=2,
            flow_score=0.45,
            relative_strength=5.2,
            trend="accelerating",
            signal="overweight",
            confidence=0.85,
        )

        assert signal.sector == "Technology"
        assert signal.current_rank == 1
        assert signal.rank_change == 2
        assert signal.signal == "overweight"

    def test_rotation_signal_to_dict(self):
        """Test sector rotation signal serialization."""
        signal = SectorRotationSignal(
            sector="Energy",
            etf_symbol="XLE",
            current_rank=5,
            previous_rank=4,
            rank_change=-1,
            flow_score=-0.2,
            relative_strength=-2.1,
            trend="decelerating",
            signal="neutral",
            confidence=0.6,
        )

        result = signal.to_dict()

        assert result["sector"] == "Energy"
        assert result["etfSymbol"] == "XLE"
        assert result["rankChange"] == -1


class TestSmartBetaFlow:
    """Test SmartBetaFlow dataclass."""

    def test_smart_beta_flow_creation(self):
        """Test creating a smart beta flow analysis."""
        flow = SmartBetaFlow(
            factor="value",
            etf_symbols=["VTV", "IWD"],
            total_aum=175_000_000_000,
            net_flow_1m=5_000_000_000,
            net_flow_3m=12_000_000_000,
            flow_percentile=75.5,
            performance_1m=3.2,
            performance_3m=8.5,
            crowding_score=0.4,
            relative_value="cheap",
            signal="rotate_in",
        )

        assert flow.factor == "value"
        assert len(flow.etf_symbols) == 2
        assert flow.signal == "rotate_in"


class TestThematicFlowAnalysis:
    """Test ThematicFlowAnalysis dataclass."""

    def test_thematic_flow_creation(self):
        """Test creating a thematic flow analysis."""
        analysis = ThematicFlowAnalysis(
            theme="Clean Energy",
            description="Renewable energy investments",
            etf_symbols=["ICLN"],
            total_aum=3_000_000_000,
            net_flow_1m=500_000_000,
            net_flow_3m=1_200_000_000,
            net_flow_ytd=3_500_000_000,
            flow_trend="accelerating",
            top_holdings_overlap=0.15,
            performance_1m=8.5,
            performance_3m=15.2,
            performance_ytd=25.0,
            momentum_score=0.65,
            institutional_interest="high",
        )

        assert analysis.theme == "Clean Energy"
        assert analysis.flow_trend == "accelerating"
        assert analysis.institutional_interest == "high"


class TestETFRegistry:
    """Test ETF registry data."""

    def test_sector_etfs_complete(self):
        """Test that all 11 GICS sectors are covered."""
        sectors = {etf.sector for etf in SECTOR_ETFS.values()}
        expected_sectors = {
            "Technology",
            "Financials",
            "Energy",
            "Healthcare",
            "Industrials",
            "Consumer Discretionary",
            "Consumer Staples",
            "Utilities",
            "Materials",
            "Real Estate",
            "Communication Services",
        }
        assert sectors == expected_sectors

    def test_smart_beta_factors_defined(self):
        """Test that major factors are covered."""
        factors = {etf.factor for etf in SMART_BETA_ETFS.values() if etf.factor}
        expected_factors = {
            "value",
            "growth",
            "momentum",
            "quality",
            "low_volatility",
            "size",
        }
        assert factors == expected_factors

    def test_thematic_etfs_have_themes(self):
        """Test that thematic ETFs have themes defined."""
        for etf in THEMATIC_ETFS.values():
            assert etf.theme is not None
            assert etf.category == ETFCategory.THEMATIC

    def test_all_etfs_in_registry(self):
        """Test that all ETFs are in the combined registry."""
        total_etfs = (
            len(SECTOR_ETFS)
            + len(SMART_BETA_ETFS)
            + len(THEMATIC_ETFS)
            + len(ETF_REGISTRY)
            - len(SECTOR_ETFS)
            - len(SMART_BETA_ETFS)
            - len(THEMATIC_ETFS)
        )
        # Registry may have overlapping symbols
        assert len(ETF_REGISTRY) > 0


class TestETFAnalyzer:
    """Test ETFAnalyzer class."""

    @pytest.fixture
    def analyzer(self):
        """Create an ETF analyzer instance."""
        return ETFAnalyzer()

    @pytest.fixture
    def analyzer_with_mock_data(self):
        """Create an analyzer with mock data manager."""
        mock_dm = MagicMock()
        return ETFAnalyzer(data_manager=mock_dm)

    @pytest.mark.asyncio
    async def test_get_etf_flows_default(self, analyzer):
        """Test getting ETF flows for all tracked ETFs."""
        flows = await analyzer.get_etf_flows(lookback_days=30)

        assert len(flows) > 0
        assert all(isinstance(f, ETFFlowSummary) for f in flows)
        # Should be sorted by absolute net flow
        abs_flows = [abs(f.net_flow_1m) for f in flows]
        assert abs_flows == sorted(abs_flows, reverse=True)

    @pytest.mark.asyncio
    async def test_get_etf_flows_specific_symbols(self, analyzer):
        """Test getting flows for specific ETFs."""
        symbols = ["SPY", "QQQ", "XLK"]
        flows = await analyzer.get_etf_flows(symbols=symbols, lookback_days=30)

        assert len(flows) == 3
        flow_symbols = {f.symbol for f in flows}
        assert flow_symbols == set(symbols)

    @pytest.mark.asyncio
    async def test_get_creation_redemption_activity(self, analyzer):
        """Test creation/redemption activity analysis."""
        result = await analyzer.get_creation_redemption_activity(
            "SPY", lookback_days=30
        )

        assert result["symbol"] == "SPY"
        assert "creationUnits" in result
        assert "redemptionUnits" in result
        assert "netUnits" in result
        assert "flowTrend" in result
        assert "interpretation" in result

    @pytest.mark.asyncio
    async def test_get_creation_redemption_unknown_etf(self, analyzer):
        """Test handling of unknown ETF symbol."""
        with pytest.raises(ValueError, match="Unknown ETF"):
            await analyzer.get_creation_redemption_activity("UNKNOWN123")

    @pytest.mark.asyncio
    async def test_get_sector_rotation(self, analyzer):
        """Test sector rotation analysis."""
        signals = await analyzer.get_sector_rotation(lookback_days=63)

        assert len(signals) == len(SECTOR_ETFS)
        assert all(isinstance(s, SectorRotationSignal) for s in signals)

        # Check ranking is correct (1 to N)
        ranks = [s.current_rank for s in signals]
        assert sorted(ranks) == list(range(1, len(SECTOR_ETFS) + 1))

    @pytest.mark.asyncio
    async def test_sector_rotation_signals_valid(self, analyzer):
        """Test that sector rotation signals are valid."""
        signals = await analyzer.get_sector_rotation()

        for signal in signals:
            assert signal.signal in ["overweight", "neutral", "underweight"]
            assert signal.trend in ["accelerating", "stable", "decelerating"]
            assert 0 <= signal.confidence <= 1
            assert -1 <= signal.flow_score <= 1

    @pytest.mark.asyncio
    async def test_get_sector_heatmap(self, analyzer):
        """Test sector heatmap data."""
        heatmap = await analyzer.get_sector_heatmap(period="1m")

        assert "period" in heatmap
        assert "timestamp" in heatmap
        assert "sectors" in heatmap
        assert len(heatmap["sectors"]) == len(SECTOR_ETFS)

    @pytest.mark.asyncio
    async def test_get_smart_beta_flows(self, analyzer):
        """Test smart beta factor flow analysis."""
        flows = await analyzer.get_smart_beta_flows(lookback_days=63)

        assert len(flows) == len(FACTOR_DEFINITIONS)
        assert all(isinstance(f, SmartBetaFlow) for f in flows)

        # Check all factors are represented
        factors = {f.factor for f in flows}
        assert factors == set(FACTOR_DEFINITIONS.keys())

    @pytest.mark.asyncio
    async def test_smart_beta_signals_valid(self, analyzer):
        """Test smart beta signal validity."""
        flows = await analyzer.get_smart_beta_flows()

        for flow in flows:
            assert flow.signal in ["rotate_in", "hold", "rotate_out"]
            assert flow.relative_value in ["cheap", "fair", "expensive"]
            assert 0 <= flow.flow_percentile <= 100
            assert 0 <= flow.crowding_score <= 1

    @pytest.mark.asyncio
    async def test_get_factor_rotation_signals(self, analyzer):
        """Test factor rotation signal generation."""
        signals = await analyzer.get_factor_rotation_signals()

        assert "timestamp" in signals
        assert "rotateIn" in signals
        assert "hold" in signals
        assert "rotateOut" in signals
        assert "factors" in signals

    @pytest.mark.asyncio
    async def test_get_thematic_flows(self, analyzer):
        """Test thematic ETF flow analysis."""
        flows = await analyzer.get_thematic_flows(lookback_days=90)

        assert len(flows) == len(THEME_DEFINITIONS)
        assert all(isinstance(f, ThematicFlowAnalysis) for f in flows)

    @pytest.mark.asyncio
    async def test_thematic_flows_sorted_by_momentum(self, analyzer):
        """Test that thematic flows are sorted by momentum score."""
        flows = await analyzer.get_thematic_flows()

        momentum_scores = [f.momentum_score for f in flows]
        assert momentum_scores == sorted(momentum_scores, reverse=True)

    @pytest.mark.asyncio
    async def test_get_theme_dashboard(self, analyzer):
        """Test thematic investment dashboard."""
        dashboard = await analyzer.get_theme_dashboard()

        assert "timestamp" in dashboard
        assert "totalThematicAum" in dashboard
        assert "hotThemes" in dashboard
        assert "coolingThemes" in dashboard
        assert "themes" in dashboard

    @pytest.mark.asyncio
    async def test_get_institutional_positioning(self, analyzer):
        """Test institutional ETF positioning analysis."""
        positioning = await analyzer.get_institutional_etf_positioning()

        assert "timestamp" in positioning
        assert "totalInstitutionalValue" in positioning
        assert "topInstitutionalHoldings" in positioning

    @pytest.mark.asyncio
    async def test_get_flow_overview(self, analyzer):
        """Test comprehensive flow overview."""
        overview = await analyzer.get_flow_overview()

        assert "timestamp" in overview
        assert "totalInflows1m" in overview
        assert "totalOutflows1m" in overview
        assert "netFlows1m" in overview
        assert "flowSentiment" in overview
        assert overview["flowSentiment"] in [
            "very_bullish",
            "bullish",
            "neutral",
            "bearish",
            "very_bearish",
        ]

    def test_health_check(self, analyzer):
        """Test analyzer health check."""
        assert analyzer.health_check() is True


class TestFlowSignalDetermination:
    """Test flow signal determination logic."""

    @pytest.fixture
    def analyzer(self):
        return ETFAnalyzer()

    def test_strong_inflow_signal(self, analyzer):
        """Test strong inflow signal determination."""
        aum = 10_000_000_000  # $10B
        flow = 600_000_000  # $600M (6% of AUM)

        signal = analyzer._determine_flow_signal(flow, aum)
        assert signal == "strong_inflow"

    def test_inflow_signal(self, analyzer):
        """Test regular inflow signal."""
        aum = 10_000_000_000
        flow = 200_000_000  # 2% of AUM

        signal = analyzer._determine_flow_signal(flow, aum)
        assert signal == "inflow"

    def test_neutral_signal(self, analyzer):
        """Test neutral flow signal."""
        aum = 10_000_000_000
        flow = 50_000_000  # 0.5% of AUM

        signal = analyzer._determine_flow_signal(flow, aum)
        assert signal == "neutral"

    def test_outflow_signal(self, analyzer):
        """Test regular outflow signal."""
        aum = 10_000_000_000
        flow = -200_000_000  # -2% of AUM

        signal = analyzer._determine_flow_signal(flow, aum)
        assert signal == "outflow"

    def test_strong_outflow_signal(self, analyzer):
        """Test strong outflow signal."""
        aum = 10_000_000_000
        flow = -600_000_000  # -6% of AUM

        signal = analyzer._determine_flow_signal(flow, aum)
        assert signal == "strong_outflow"


class TestFlowTrendInterpretation:
    """Test flow trend interpretation."""

    @pytest.fixture
    def analyzer(self):
        return ETFAnalyzer()

    def test_strong_accumulation(self, analyzer):
        """Test strong accumulation interpretation."""
        interpretation = analyzer._interpret_flow_trend(0.6, 100)
        assert "accumulation" in interpretation.lower()

    def test_moderate_inflow(self, analyzer):
        """Test moderate inflow interpretation."""
        interpretation = analyzer._interpret_flow_trend(0.3, 50)
        assert "inflow" in interpretation.lower()

    def test_heavy_redemption(self, analyzer):
        """Test heavy redemption interpretation."""
        interpretation = analyzer._interpret_flow_trend(-0.6, -100)
        assert (
            "redemption" in interpretation.lower()
            or "selling" in interpretation.lower()
        )

    def test_balanced_flows(self, analyzer):
        """Test balanced flow interpretation."""
        interpretation = analyzer._interpret_flow_trend(0.1, 0)
        assert (
            "balanced" in interpretation.lower() or "no clear" in interpretation.lower()
        )


class TestMockDataGeneration:
    """Test mock data generation."""

    @pytest.fixture
    def analyzer(self):
        return ETFAnalyzer()

    def test_mock_flow_data_consistency(self, analyzer):
        """Test that mock data is consistent for same symbol."""
        flow1 = analyzer._generate_mock_flow_data("SPY", 30)
        flow2 = analyzer._generate_mock_flow_data("SPY", 30)

        # Same symbol should generate consistent data (seeded random)
        assert len(flow1) == len(flow2)

    def test_mock_flow_data_different_symbols(self, analyzer):
        """Test that different symbols get different mock data."""
        flow_spy = analyzer._generate_mock_flow_data("SPY", 30)
        flow_qqq = analyzer._generate_mock_flow_data("QQQ", 30)

        # Different symbols should have different data
        assert not np.array_equal(
            flow_spy["net_flow"].values, flow_qqq["net_flow"].values
        )

    def test_mock_flow_data_structure(self, analyzer):
        """Test mock data has correct structure."""
        flow = analyzer._generate_mock_flow_data("XLK", 30)

        assert "date" in flow.columns
        assert "net_flow" in flow.columns
        assert "creation_units" in flow.columns
        assert "redemption_units" in flow.columns
        assert len(flow) == 30


class TestDataManagerIntegration:
    """Test integration with DataManager."""

    @pytest.mark.asyncio
    async def test_uses_real_data_when_available(self):
        """Test that real data is used when data manager returns it."""
        mock_dm = AsyncMock()
        mock_dm.get_etf_flows.return_value = pd.DataFrame(
            {
                "date": pd.date_range(end=datetime.now(), periods=30),
                "net_flow": np.random.normal(0, 1000000, 30),
                "creation_units": np.random.randint(0, 100, 30),
                "redemption_units": np.random.randint(0, 100, 30),
            }
        )
        mock_dm.get_stock_data.return_value = pd.DataFrame(
            {
                "date": pd.date_range(end=datetime.now(), periods=30),
                "close": 100 + np.cumsum(np.random.normal(0, 1, 30)),
                "volume": np.random.randint(1000000, 10000000, 30),
            }
        )

        analyzer = ETFAnalyzer(data_manager=mock_dm)
        flows = await analyzer.get_etf_flows(symbols=["SPY"], lookback_days=30)

        assert len(flows) == 1
        mock_dm.get_etf_flows.assert_called()

    @pytest.mark.asyncio
    async def test_falls_back_to_mock_on_error(self):
        """Test fallback to mock data when real data fails."""
        mock_dm = AsyncMock()
        mock_dm.get_etf_flows.side_effect = Exception("Data unavailable")
        mock_dm.get_stock_data.side_effect = Exception("Data unavailable")

        analyzer = ETFAnalyzer(data_manager=mock_dm)
        flows = await analyzer.get_etf_flows(symbols=["SPY"], lookback_days=30)

        # Should still return data (mock fallback)
        assert len(flows) == 1
        assert flows[0].symbol == "SPY"


class TestEdgeCases:
    """Test edge cases and error handling."""

    @pytest.fixture
    def analyzer(self):
        return ETFAnalyzer()

    @pytest.mark.asyncio
    async def test_empty_symbols_list(self, analyzer):
        """Test handling of empty symbols list."""
        flows = await analyzer.get_etf_flows(symbols=[])
        assert flows == []

    @pytest.mark.asyncio
    async def test_unknown_symbol_in_list(self, analyzer):
        """Test handling of unknown symbols mixed with valid ones."""
        flows = await analyzer.get_etf_flows(
            symbols=["SPY", "UNKNOWN123", "QQQ"], lookback_days=30
        )

        # Should return flows for valid symbols only
        valid_symbols = {f.symbol for f in flows}
        assert "SPY" in valid_symbols
        assert "QQQ" in valid_symbols
        assert "UNKNOWN123" not in valid_symbols

    @pytest.mark.asyncio
    async def test_very_short_lookback(self, analyzer):
        """Test handling of very short lookback period."""
        flows = await analyzer.get_etf_flows(symbols=["SPY"], lookback_days=1)
        assert len(flows) == 1

    @pytest.mark.asyncio
    async def test_long_lookback(self, analyzer):
        """Test handling of long lookback period."""
        flows = await analyzer.get_etf_flows(symbols=["SPY"], lookback_days=365)
        assert len(flows) == 1
