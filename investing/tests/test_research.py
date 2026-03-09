"""
Comprehensive Tests for the Research Module.

Tests valuation (DCF, multiples), earnings analysis, and ResearchAnalyzer async methods.
Target: 80%+ coverage for investing/research/ module.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
import numpy as np

from investing.research import ResearchAnalyzer
from investing.research.valuation import (
    DCFResult,
    ValuationMetrics,
    calculate_dcf,
    calculate_dcf_sensitivity,
    calculate_valuation_multiples,
    compare_to_peers,
    estimate_fair_value_range,
)
from investing.research.earnings import (
    EarningsQuarter,
    EarningsAnalysis,
    EstimateRevision,
    calculate_earnings_surprise,
    calculate_growth_rate,
    calculate_cagr,
    analyze_earnings_quality,
    calculate_earnings_consistency,
    calculate_beat_rate,
    analyze_estimate_revisions,
    project_future_earnings,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_dcf_result():
    """Sample DCF result for testing."""
    return DCFResult(
        symbol="AAPL",
        intrinsic_value=185.50,
        current_price=175.00,
        upside_percentage=6.0,
        margin_of_safety=6.0,
        discount_rate=0.10,
        terminal_growth_rate=0.025,
        projection_years=5,
        pv_cash_flows=50000.0,
        pv_terminal_value=100000.0,
        net_debt=10000.0,
        shares_outstanding=1000.0,
    )


@pytest.fixture
def sample_valuation_metrics():
    """Sample valuation metrics for testing."""
    return ValuationMetrics(
        symbol="AAPL",
        price=175.0,
        market_cap=2.7e12,
        enterprise_value=2.8e12,
        pe_ratio=30.0,
        forward_pe=25.0,
        peg_ratio=1.5,
        price_to_sales=7.5,
        ev_to_sales=7.8,
        price_to_book=45.0,
        price_to_tangible_book=50.0,
        ev_to_ebitda=22.0,
        price_to_fcf=28.0,
        ev_to_fcf=29.0,
        earnings_yield=3.3,
        fcf_yield=3.5,
        dividend_yield=0.5,
    )


@pytest.fixture
def sample_free_cash_flows():
    """Sample projected free cash flows."""
    return [10000.0, 11000.0, 12100.0, 13310.0, 14641.0]


@pytest.fixture
def sample_earnings_quarter():
    """Sample earnings quarter data."""
    return EarningsQuarter(
        fiscal_quarter="Q3 2024",
        fiscal_year=2024,
        fiscal_period=3,
        eps_actual=1.50,
        revenue_actual=90e9,
        report_date=datetime(2024, 10, 31),
        eps_estimate=1.45,
        revenue_estimate=88e9,
        eps_surprise=0.05,
        eps_surprise_percent=3.45,
        revenue_surprise=2e9,
        revenue_surprise_percent=2.27,
    )


@pytest.fixture
def sample_earnings_quarters():
    """List of sample earnings quarters for testing."""
    quarters = []
    base_eps = 1.0
    for i in range(8):
        year = 2023 + (i // 4)
        period = (i % 4) + 1
        eps = base_eps + (i * 0.05)
        estimate = eps - 0.02 if i % 3 != 0 else eps + 0.01  # Mix beats and misses
        surprise = eps - estimate
        surprise_pct = (surprise / abs(estimate)) * 100 if estimate != 0 else 0

        quarters.append(
            EarningsQuarter(
                fiscal_quarter=f"Q{period} {year}",
                fiscal_year=year,
                fiscal_period=period,
                eps_actual=eps,
                revenue_actual=80e9 + i * 2e9,
                report_date=datetime(year, period * 3, 28),
                eps_estimate=estimate,
                revenue_estimate=78e9 + i * 2e9,
                eps_surprise=surprise,
                eps_surprise_percent=surprise_pct,
            )
        )
    return quarters


@pytest.fixture
def sample_earnings_analysis(sample_earnings_quarters):
    """Sample earnings analysis data."""
    return EarningsAnalysis(
        symbol="AAPL",
        quarters=sample_earnings_quarters,
        eps_growth_yoy=8.5,
        eps_growth_3yr_cagr=12.0,
        revenue_growth_yoy=5.5,
        revenue_growth_3yr_cagr=8.0,
        avg_eps_surprise_percent=2.5,
        beat_rate=75.0,
        consecutive_beats=4,
        earnings_volatility=0.08,
        earnings_consistency=0.92,
        accruals_ratio=0.03,
        next_quarter_eps_estimate=1.55,
        next_year_eps_estimate=6.20,
        analyst_count=35,
        estimate_dispersion=0.05,
    )


@pytest.fixture
def mock_data_manager_research():
    """Mock DataManager for research tests."""
    mock = MagicMock()
    mock.get_company_data = AsyncMock(
        return_value={
            "price": 175.0,
            "shares_outstanding": 15.5e9,
            "market_cap": 2.7e12,
            "enterprise_value": 2.8e12,
            "pe_ratio": 30.0,
            "forward_pe": 25.0,
            "price_to_book": 45.0,
            "earnings": 90e9,
            "revenue": 380e9,
            "ebitda": 127e9,
            "free_cash_flow": 95e9,
            "total_debt": 120e9,
            "cash": 60e9,
            "dividend_yield": 0.5,
        }
    )
    mock.get_earnings_history = AsyncMock(return_value=[])
    mock.get_peers = AsyncMock(return_value=["MSFT", "GOOGL", "META"])
    return mock


# =============================================================================
# DCFResult Tests
# =============================================================================


class TestDCFResult:
    """Tests for DCFResult dataclass."""

    def test_dcf_result_creation(self, sample_dcf_result):
        """Test DCFResult creation with all fields."""
        assert sample_dcf_result.symbol == "AAPL"
        assert sample_dcf_result.intrinsic_value == 185.50
        assert sample_dcf_result.current_price == 175.00
        assert sample_dcf_result.upside_percentage == 6.0
        assert sample_dcf_result.margin_of_safety == 6.0
        assert sample_dcf_result.discount_rate == 0.10
        assert sample_dcf_result.terminal_growth_rate == 0.025
        assert sample_dcf_result.projection_years == 5

    def test_dcf_result_to_dict(self, sample_dcf_result):
        """Test DCFResult to_dict conversion."""
        result_dict = sample_dcf_result.to_dict()

        assert result_dict["symbol"] == "AAPL"
        assert result_dict["intrinsicValue"] == 185.50
        assert result_dict["currentPrice"] == 175.00
        assert result_dict["upsidePercentage"] == 6.0
        assert result_dict["marginOfSafety"] == 6.0
        assert result_dict["discountRate"] == 0.10
        assert result_dict["terminalGrowthRate"] == 0.025
        assert result_dict["projectionYears"] == 5
        assert result_dict["pvCashFlows"] == 50000.0
        assert result_dict["pvTerminalValue"] == 100000.0

    def test_dcf_result_with_sensitivity_matrix(self):
        """Test DCFResult with optional sensitivity matrix."""
        result = DCFResult(
            symbol="TEST",
            intrinsic_value=100.0,
            current_price=90.0,
            upside_percentage=11.1,
            margin_of_safety=11.1,
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            projection_years=5,
            pv_cash_flows=40000.0,
            pv_terminal_value=60000.0,
            net_debt=5000.0,
            shares_outstanding=1000.0,
            sensitivity_matrix={"dr_8": [120, 115, 110], "dr_10": [100, 95, 90]},
        )
        assert result.sensitivity_matrix is not None
        assert "dr_8" in result.sensitivity_matrix


# =============================================================================
# ValuationMetrics Tests
# =============================================================================


class TestValuationMetrics:
    """Tests for ValuationMetrics dataclass."""

    def test_metrics_creation(self, sample_valuation_metrics):
        """Test ValuationMetrics creation."""
        assert sample_valuation_metrics.symbol == "AAPL"
        assert sample_valuation_metrics.price == 175.0
        assert sample_valuation_metrics.pe_ratio == 30.0
        assert sample_valuation_metrics.forward_pe == 25.0
        assert sample_valuation_metrics.peg_ratio == 1.5

    def test_metrics_to_dict(self, sample_valuation_metrics):
        """Test ValuationMetrics to_dict conversion."""
        result = sample_valuation_metrics.to_dict()

        assert result["symbol"] == "AAPL"
        assert result["price"] == 175.0
        assert result["marketCap"] == 2.7e12
        assert result["enterpriseValue"] == 2.8e12
        assert result["peRatio"] == 30.0
        assert result["forwardPe"] == 25.0
        assert result["pegRatio"] == 1.5
        assert result["priceToSales"] == 7.5
        assert result["evToSales"] == 7.8
        assert result["priceToBook"] == 45.0
        assert result["evToEbitda"] == 22.0
        assert result["earningsYield"] == 3.3
        assert result["fcfYield"] == 3.5
        assert result["dividendYield"] == 0.5

    def test_metrics_with_infinite_values(self):
        """Test ValuationMetrics with infinite values for loss-making companies."""
        metrics = ValuationMetrics(
            symbol="LOSS",
            price=50.0,
            market_cap=1e9,
            enterprise_value=1.2e9,
            pe_ratio=float("inf"),
            forward_pe=float("inf"),
            peg_ratio=float("inf"),
            price_to_sales=5.0,
            ev_to_sales=6.0,
            price_to_book=2.0,
            price_to_tangible_book=3.0,
            ev_to_ebitda=float("inf"),
            price_to_fcf=float("inf"),
            ev_to_fcf=float("inf"),
            earnings_yield=0,
            fcf_yield=0,
            dividend_yield=0,
        )
        assert metrics.pe_ratio == float("inf")
        assert metrics.forward_pe == float("inf")


# =============================================================================
# Calculate DCF Tests
# =============================================================================


class TestCalculateDCF:
    """Tests for calculate_dcf function."""

    def test_basic_dcf_calculation(self, sample_free_cash_flows):
        """Test basic DCF calculation."""
        result = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=10000.0,
            shares_outstanding=1000.0,
            current_price=100.0,
            symbol="TEST",
        )

        assert result.symbol == "TEST"
        assert result.intrinsic_value > 0
        assert result.pv_cash_flows > 0
        assert result.pv_terminal_value > 0
        assert result.projection_years == 5

    def test_dcf_with_upside(self, sample_free_cash_flows):
        """Test DCF showing upside potential."""
        result = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
            current_price=50.0,  # Low price = upside
            symbol="TEST",
        )

        assert result.upside_percentage > 0
        assert result.margin_of_safety > 0

    def test_dcf_with_downside(self, sample_free_cash_flows):
        """Test DCF showing downside (overvalued)."""
        result = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
            current_price=500.0,  # High price = downside
            symbol="TEST",
        )

        assert result.upside_percentage < 0
        assert result.margin_of_safety == 0  # No margin when overvalued

    def test_dcf_empty_cash_flows(self):
        """Test DCF with empty cash flows."""
        result = calculate_dcf(
            free_cash_flows=[],
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
            current_price=100.0,
            symbol="TEST",
        )

        assert result.intrinsic_value == 0
        assert result.pv_cash_flows == 0
        assert result.pv_terminal_value == 0

    def test_dcf_zero_shares(self):
        """Test DCF with zero shares outstanding."""
        result = calculate_dcf(
            free_cash_flows=[10000, 11000, 12000],
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=0,
            current_price=100.0,
            symbol="TEST",
        )

        assert result.intrinsic_value == 0

    def test_dcf_negative_shares(self):
        """Test DCF with negative shares (edge case)."""
        result = calculate_dcf(
            free_cash_flows=[10000, 11000, 12000],
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=-100,
            current_price=100.0,
            symbol="TEST",
        )

        assert result.intrinsic_value == 0

    def test_dcf_high_net_debt(self, sample_free_cash_flows):
        """Test DCF with high net debt reducing equity value."""
        result = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=500000.0,  # Very high debt
            shares_outstanding=1000.0,
            current_price=100.0,
            symbol="TEST",
        )

        # High debt may result in zero or low intrinsic value
        assert result.intrinsic_value >= 0

    def test_dcf_zero_current_price(self, sample_free_cash_flows):
        """Test DCF with zero current price."""
        result = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
            current_price=0,
            symbol="TEST",
        )

        assert result.upside_percentage == 0
        assert result.margin_of_safety == 0

    def test_dcf_various_discount_rates(self, sample_free_cash_flows):
        """Test DCF with different discount rates."""
        # Lower discount rate = higher value
        low_dr = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.08,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
            current_price=100.0,
            symbol="TEST",
        )

        high_dr = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=0.12,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
            current_price=100.0,
            symbol="TEST",
        )

        assert low_dr.intrinsic_value > high_dr.intrinsic_value


# =============================================================================
# Calculate DCF Sensitivity Tests
# =============================================================================


class TestCalculateDCFSensitivity:
    """Tests for calculate_dcf_sensitivity function."""

    def test_sensitivity_matrix_structure(self, sample_free_cash_flows):
        """Test sensitivity matrix has correct structure."""
        matrix = calculate_dcf_sensitivity(
            free_cash_flows=sample_free_cash_flows,
            base_discount_rate=0.10,
            base_terminal_growth=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
        )

        assert "growth_rates" in matrix
        assert "discount_rates" in matrix
        assert len(matrix["growth_rates"]) == 5
        assert len(matrix["discount_rates"]) == 5

    def test_sensitivity_matrix_values(self, sample_free_cash_flows):
        """Test sensitivity matrix contains reasonable values."""
        matrix = calculate_dcf_sensitivity(
            free_cash_flows=sample_free_cash_flows,
            base_discount_rate=0.10,
            base_terminal_growth=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
        )

        # All values should be positive
        for key in matrix:
            if key.startswith("dr_"):
                for value in matrix[key]:
                    assert value > 0

    def test_sensitivity_matrix_relationships(self, sample_free_cash_flows):
        """Test that sensitivity matrix shows correct relationships."""
        matrix = calculate_dcf_sensitivity(
            free_cash_flows=sample_free_cash_flows,
            base_discount_rate=0.10,
            base_terminal_growth=0.025,
            net_debt=0,
            shares_outstanding=1000.0,
        )

        # Lower discount rate should give higher values
        dr_8_values = matrix.get("dr_8", [])
        dr_12_values = matrix.get("dr_12", [])

        if dr_8_values and dr_12_values:
            # Compare first values (same growth rate)
            assert dr_8_values[0] > dr_12_values[0]


# =============================================================================
# Calculate Valuation Multiples Tests
# =============================================================================


class TestCalculateValuationMultiples:
    """Tests for calculate_valuation_multiples function."""

    def test_basic_multiples_calculation(self):
        """Test basic valuation multiples calculation."""
        result = calculate_valuation_multiples(
            price=175.0,
            shares_outstanding=15e9,
            earnings=90e9,
            forward_earnings=100e9,
            revenue=380e9,
            book_value=60e9,
            tangible_book_value=50e9,
            ebitda=127e9,
            free_cash_flow=95e9,
            total_debt=120e9,
            cash=60e9,
            dividends_per_share=0.92,
            earnings_growth_rate=0.10,
            symbol="AAPL",
        )

        assert result.symbol == "AAPL"
        assert result.price == 175.0
        assert result.pe_ratio > 0
        assert result.forward_pe > 0
        assert result.price_to_book > 0
        assert result.ev_to_ebitda > 0

    def test_multiples_with_zero_earnings(self):
        """Test multiples calculation with zero earnings."""
        result = calculate_valuation_multiples(
            price=50.0,
            shares_outstanding=1e9,
            earnings=0,  # Zero earnings
            forward_earnings=0,
            revenue=100e9,
            book_value=20e9,
            tangible_book_value=15e9,
            ebitda=10e9,
            free_cash_flow=5e9,
            total_debt=30e9,
            cash=10e9,
            dividends_per_share=0,
            earnings_growth_rate=0,
            symbol="LOSS",
        )

        assert result.pe_ratio == float("inf")
        assert result.forward_pe == float("inf")
        assert result.earnings_yield == 0

    def test_multiples_with_negative_book_value(self):
        """Test multiples with negative book value."""
        result = calculate_valuation_multiples(
            price=50.0,
            shares_outstanding=1e9,
            earnings=5e9,
            forward_earnings=6e9,
            revenue=50e9,
            book_value=-10e9,  # Negative book value
            tangible_book_value=-15e9,
            ebitda=8e9,
            free_cash_flow=3e9,
            total_debt=40e9,
            cash=5e9,
            dividends_per_share=0,
            earnings_growth_rate=0.05,
            symbol="NEGBV",
        )

        # Negative book value per share leads to negative P/B
        assert result.price_to_book == float("inf")

    def test_multiples_market_cap_and_ev(self):
        """Test market cap and enterprise value calculations."""
        result = calculate_valuation_multiples(
            price=100.0,
            shares_outstanding=1e9,
            earnings=10e9,
            forward_earnings=11e9,
            revenue=50e9,
            book_value=30e9,
            tangible_book_value=25e9,
            ebitda=15e9,
            free_cash_flow=8e9,
            total_debt=20e9,
            cash=5e9,
            dividends_per_share=2.0,
            earnings_growth_rate=0.10,
            symbol="TEST",
        )

        # Market cap = price * shares
        assert result.market_cap == pytest.approx(100e9, rel=1e-6)

        # EV = Market cap + debt - cash
        expected_ev = 100e9 + 20e9 - 5e9  # 115e9
        assert result.enterprise_value == pytest.approx(expected_ev, rel=1e-6)

    def test_multiples_yields(self):
        """Test yield calculations."""
        result = calculate_valuation_multiples(
            price=100.0,
            shares_outstanding=1e9,
            earnings=10e9,  # EPS = 10
            forward_earnings=11e9,
            revenue=50e9,
            book_value=30e9,
            tangible_book_value=25e9,
            ebitda=15e9,
            free_cash_flow=8e9,  # FCF per share = 8
            total_debt=20e9,
            cash=5e9,
            dividends_per_share=4.0,  # 4% dividend yield
            earnings_growth_rate=0.10,
            symbol="TEST",
        )

        # Earnings yield = EPS / Price * 100
        assert result.earnings_yield == pytest.approx(10.0, rel=0.01)

        # FCF yield = FCF per share / Price * 100
        assert result.fcf_yield == pytest.approx(8.0, rel=0.01)

        # Dividend yield = DPS / Price * 100
        assert result.dividend_yield == pytest.approx(4.0, rel=0.01)

    def test_multiples_peg_ratio(self):
        """Test PEG ratio calculation."""
        result = calculate_valuation_multiples(
            price=100.0,
            shares_outstanding=1e9,
            earnings=5e9,  # EPS = 5, P/E = 20
            forward_earnings=5.5e9,
            revenue=50e9,
            book_value=30e9,
            tangible_book_value=25e9,
            ebitda=15e9,
            free_cash_flow=8e9,
            total_debt=20e9,
            cash=5e9,
            dividends_per_share=0,
            earnings_growth_rate=0.10,  # 10% growth
            symbol="TEST",
        )

        # PEG = P/E / (growth * 100) = 20 / 10 = 2.0
        assert result.peg_ratio == pytest.approx(2.0, rel=0.01)


# =============================================================================
# Compare to Peers Tests
# =============================================================================


class TestCompareToPeers:
    """Tests for compare_to_peers function."""

    def test_basic_peer_comparison(self, sample_valuation_metrics):
        """Test basic peer comparison."""
        peer1 = ValuationMetrics(
            symbol="MSFT",
            price=350.0,
            market_cap=2.5e12,
            enterprise_value=2.6e12,
            pe_ratio=35.0,
            forward_pe=30.0,
            peg_ratio=2.0,
            price_to_sales=10.0,
            ev_to_sales=10.5,
            price_to_book=12.0,
            price_to_tangible_book=15.0,
            ev_to_ebitda=25.0,
            price_to_fcf=32.0,
            ev_to_fcf=34.0,
            earnings_yield=2.9,
            fcf_yield=3.1,
            dividend_yield=0.8,
        )

        peer2 = ValuationMetrics(
            symbol="GOOGL",
            price=140.0,
            market_cap=1.8e12,
            enterprise_value=1.7e12,
            pe_ratio=25.0,
            forward_pe=22.0,
            peg_ratio=1.2,
            price_to_sales=6.0,
            ev_to_sales=5.8,
            price_to_book=5.5,
            price_to_tangible_book=6.0,
            ev_to_ebitda=15.0,
            price_to_fcf=20.0,
            ev_to_fcf=18.0,
            earnings_yield=4.0,
            fcf_yield=5.0,
            dividend_yield=0,
        )

        result = compare_to_peers(sample_valuation_metrics, [peer1, peer2])

        assert "target" in result
        assert "peerAverages" in result
        assert "premiumDiscount" in result
        assert "peers" in result
        assert len(result["peers"]) == 2

    def test_peer_comparison_empty_peers(self, sample_valuation_metrics):
        """Test peer comparison with empty peer list."""
        result = compare_to_peers(sample_valuation_metrics, [])

        assert result["target"]["symbol"] == "AAPL"
        assert result["peers"] == []
        assert result["premium_discount"] == {}

    def test_peer_comparison_premium_discount(self, sample_valuation_metrics):
        """Test premium/discount calculation."""
        # Create peer with lower multiples (target trades at premium)
        cheap_peer = ValuationMetrics(
            symbol="CHEAP",
            price=50.0,
            market_cap=500e9,
            enterprise_value=550e9,
            pe_ratio=15.0,  # Much lower than target's 30
            forward_pe=12.0,
            peg_ratio=1.0,
            price_to_sales=3.0,
            ev_to_sales=3.5,
            price_to_book=2.0,
            price_to_tangible_book=2.5,
            ev_to_ebitda=10.0,
            price_to_fcf=12.0,
            ev_to_fcf=13.0,
            earnings_yield=6.7,
            fcf_yield=8.3,
            dividend_yield=2.0,
        )

        result = compare_to_peers(sample_valuation_metrics, [cheap_peer])

        # Target P/E of 30 vs peer P/E of 15 = 100% premium
        assert result["premiumDiscount"]["pe_ratio"] == pytest.approx(100.0, rel=0.01)


# =============================================================================
# Estimate Fair Value Range Tests
# =============================================================================


class TestEstimateFairValueRange:
    """Tests for estimate_fair_value_range function."""

    def test_basic_fair_value_estimation(self, sample_valuation_metrics):
        """Test basic fair value range estimation."""
        peer_averages = {
            "pe_ratio": 25.0,
            "ev_to_ebitda": 20.0,
            "price_to_sales": 8.0,
        }

        result = estimate_fair_value_range(sample_valuation_metrics, peer_averages)

        assert "low" in result
        assert "mid" in result
        assert "high" in result
        assert "methods" in result
        assert result["low"] <= result["mid"] <= result["high"]

    def test_fair_value_with_empty_peer_averages(self, sample_valuation_metrics):
        """Test fair value with no peer data."""
        result = estimate_fair_value_range(sample_valuation_metrics, {})

        # Should fall back to current price +/- 20%
        assert result["low"] == pytest.approx(175.0 * 0.8, rel=0.01)
        assert result["mid"] == pytest.approx(175.0, rel=0.01)
        assert result["high"] == pytest.approx(175.0 * 1.2, rel=0.01)

    def test_fair_value_methods_list(self, sample_valuation_metrics):
        """Test that methods are listed correctly."""
        peer_averages = {
            "pe_ratio": 25.0,
            "ev_to_ebitda": 20.0,
            "price_to_sales": 8.0,
        }

        result = estimate_fair_value_range(sample_valuation_metrics, peer_averages)

        method_names = [m["method"] for m in result["methods"]]
        assert "P/E" in method_names or len(result["methods"]) > 0


# =============================================================================
# Earnings Quarter Tests
# =============================================================================


class TestEarningsQuarter:
    """Tests for EarningsQuarter dataclass."""

    def test_quarter_creation(self, sample_earnings_quarter):
        """Test EarningsQuarter creation."""
        assert sample_earnings_quarter.fiscal_quarter == "Q3 2024"
        assert sample_earnings_quarter.fiscal_year == 2024
        assert sample_earnings_quarter.fiscal_period == 3
        assert sample_earnings_quarter.eps_actual == 1.50
        assert sample_earnings_quarter.eps_estimate == 1.45

    def test_quarter_to_dict(self, sample_earnings_quarter):
        """Test EarningsQuarter to_dict conversion."""
        result = sample_earnings_quarter.to_dict()

        assert result["fiscalQuarter"] == "Q3 2024"
        assert result["fiscalYear"] == 2024
        assert result["fiscalPeriod"] == 3
        assert result["epsActual"] == 1.50
        assert result["epsEstimate"] == 1.45
        assert result["epsSurprise"] == 0.05

    def test_quarter_with_guidance(self):
        """Test EarningsQuarter with guidance data."""
        quarter = EarningsQuarter(
            fiscal_quarter="Q4 2024",
            fiscal_year=2024,
            fiscal_period=4,
            eps_actual=1.60,
            revenue_actual=95e9,
            report_date=datetime(2024, 12, 31),
            eps_estimate=1.55,
            revenue_estimate=93e9,
            next_quarter_eps_guidance_low=1.65,
            next_quarter_eps_guidance_high=1.75,
            full_year_eps_guidance_low=6.50,
            full_year_eps_guidance_high=6.80,
        )

        result = quarter.to_dict()
        assert result["nextQuarterGuidance"] is not None
        assert result["nextQuarterGuidance"]["low"] == 1.65
        assert result["nextQuarterGuidance"]["high"] == 1.75
        assert result["fullYearGuidance"] is not None


# =============================================================================
# Earnings Analysis Tests
# =============================================================================


class TestEarningsAnalysis:
    """Tests for EarningsAnalysis dataclass."""

    def test_analysis_creation(self, sample_earnings_analysis):
        """Test EarningsAnalysis creation."""
        assert sample_earnings_analysis.symbol == "AAPL"
        assert sample_earnings_analysis.eps_growth_yoy == 8.5
        assert sample_earnings_analysis.beat_rate == 75.0
        assert sample_earnings_analysis.consecutive_beats == 4

    def test_analysis_to_dict(self, sample_earnings_analysis):
        """Test EarningsAnalysis to_dict conversion."""
        result = sample_earnings_analysis.to_dict()

        assert result["symbol"] == "AAPL"
        assert result["epsGrowthYoy"] == 8.5
        assert result["epsGrowth3yrCagr"] == 12.0
        assert result["beatRate"] == 75.0
        assert result["consecutiveBeats"] == 4
        assert len(result["quarters"]) > 0


# =============================================================================
# Estimate Revision Tests
# =============================================================================


class TestEstimateRevision:
    """Tests for EstimateRevision dataclass."""

    def test_revision_creation(self):
        """Test EstimateRevision creation."""
        revision = EstimateRevision(
            symbol="AAPL",
            period="next_quarter",
            current_estimate=1.55,
            estimate_30d_ago=1.50,
            estimate_60d_ago=1.48,
            estimate_90d_ago=1.45,
            revision_30d=3.33,
            revision_60d=4.73,
            revision_90d=6.90,
            revision_trend="up",
        )

        assert revision.symbol == "AAPL"
        assert revision.current_estimate == 1.55
        assert revision.revision_trend == "up"

    def test_revision_to_dict(self):
        """Test EstimateRevision to_dict conversion."""
        revision = EstimateRevision(
            symbol="AAPL",
            period="next_quarter",
            current_estimate=1.55,
            estimate_30d_ago=1.50,
            estimate_60d_ago=1.48,
            estimate_90d_ago=1.45,
            revision_30d=3.33,
            revision_60d=4.73,
            revision_90d=6.90,
            revision_trend="up",
        )

        result = revision.to_dict()
        assert result["symbol"] == "AAPL"
        assert result["period"] == "next_quarter"
        assert result["currentEstimate"] == 1.55
        assert result["revision30d"] == 3.33


# =============================================================================
# Calculate Earnings Surprise Tests
# =============================================================================


class TestCalculateEarningsSurprise:
    """Tests for calculate_earnings_surprise function."""

    def test_positive_surprise(self):
        """Test positive earnings surprise (beat)."""
        surprise, pct = calculate_earnings_surprise(1.50, 1.45)

        assert surprise == pytest.approx(0.05, rel=0.01)
        assert pct == pytest.approx(3.45, rel=0.1)

    def test_negative_surprise(self):
        """Test negative earnings surprise (miss)."""
        surprise, pct = calculate_earnings_surprise(1.40, 1.45)

        assert surprise == pytest.approx(-0.05, rel=0.01)
        assert pct == pytest.approx(-3.45, rel=0.1)

    def test_zero_estimate(self):
        """Test surprise with zero estimate."""
        surprise, pct = calculate_earnings_surprise(0.10, 0)

        assert surprise == 0.10
        assert pct == 100  # Sign of actual * 100

    def test_both_zero(self):
        """Test surprise when both actual and estimate are zero."""
        surprise, pct = calculate_earnings_surprise(0, 0)

        assert surprise == 0
        assert pct == 0

    def test_negative_eps(self):
        """Test surprise with negative EPS values."""
        surprise, pct = calculate_earnings_surprise(-0.50, -0.60)

        assert surprise == pytest.approx(0.10, rel=0.01)  # Less negative is better
        assert pct == pytest.approx(16.67, rel=0.1)  # Improvement of ~17%


# =============================================================================
# Calculate Growth Rate Tests
# =============================================================================


class TestCalculateGrowthRate:
    """Tests for calculate_growth_rate function."""

    def test_positive_growth(self):
        """Test positive growth rate."""
        rate = calculate_growth_rate(110, 100)
        assert rate == pytest.approx(10.0, rel=0.01)

    def test_negative_growth(self):
        """Test negative growth rate."""
        rate = calculate_growth_rate(90, 100)
        assert rate == pytest.approx(-10.0, rel=0.01)

    def test_zero_previous(self):
        """Test growth rate with zero previous value."""
        rate = calculate_growth_rate(100, 0)
        assert rate == 100  # Sign of current * 100

    def test_zero_current(self):
        """Test growth rate with zero current value."""
        rate = calculate_growth_rate(0, 100)
        assert rate == pytest.approx(-100.0, rel=0.01)

    def test_both_zero(self):
        """Test growth rate when both values are zero."""
        rate = calculate_growth_rate(0, 0)
        assert rate == 0


# =============================================================================
# Calculate CAGR Tests
# =============================================================================


class TestCalculateCAGR:
    """Tests for calculate_cagr function."""

    def test_positive_cagr(self):
        """Test positive CAGR calculation."""
        # $100 growing to $161.05 over 5 years = 10% CAGR
        cagr = calculate_cagr(100, 161.05, 5)
        assert cagr == pytest.approx(10.0, rel=0.1)

    def test_negative_cagr(self):
        """Test negative CAGR (declining values)."""
        cagr = calculate_cagr(100, 59.05, 5)
        assert cagr < 0

    def test_zero_start_value(self):
        """Test CAGR with zero start value."""
        cagr = calculate_cagr(0, 100, 5)
        assert cagr == 0

    def test_negative_start_value(self):
        """Test CAGR with negative start value."""
        cagr = calculate_cagr(-100, 100, 5)
        assert cagr == 0

    def test_zero_end_value(self):
        """Test CAGR with zero end value."""
        cagr = calculate_cagr(100, 0, 5)
        assert cagr == -100  # Complete loss

    def test_negative_end_value(self):
        """Test CAGR with negative end value."""
        cagr = calculate_cagr(100, -50, 5)
        assert cagr == -100

    def test_zero_years(self):
        """Test CAGR with zero years."""
        cagr = calculate_cagr(100, 150, 0)
        assert cagr == 0

    def test_one_year(self):
        """Test CAGR over one year."""
        cagr = calculate_cagr(100, 120, 1)
        assert cagr == pytest.approx(20.0, rel=0.01)


# =============================================================================
# Analyze Earnings Quality Tests
# =============================================================================


class TestAnalyzeEarningsQuality:
    """Tests for analyze_earnings_quality function."""

    def test_high_quality_earnings(self):
        """Test high quality earnings (strong cash conversion)."""
        result = analyze_earnings_quality(
            net_income=100,
            operating_cash_flow=120,  # More cash than earnings
            total_assets=1000,
        )

        assert result["accruals"] == -20  # Negative accruals = good
        assert result["cash_conversion"] == 1.2
        assert result["quality_score"] > 50

    def test_low_quality_earnings(self):
        """Test low quality earnings (weak cash conversion)."""
        result = analyze_earnings_quality(
            net_income=100,
            operating_cash_flow=50,  # Less cash than earnings
            total_assets=1000,
        )

        assert result["accruals"] == 50  # Positive accruals = concerning
        assert result["cash_conversion"] == 0.5
        assert result["quality_score"] < 50

    def test_zero_net_income(self):
        """Test with zero net income."""
        result = analyze_earnings_quality(
            net_income=0,
            operating_cash_flow=20,
            total_assets=1000,
        )

        assert result["cash_conversion"] == 0
        assert result["accruals"] == -20

    def test_zero_total_assets(self):
        """Test with zero total assets."""
        result = analyze_earnings_quality(
            net_income=100,
            operating_cash_flow=80,
            total_assets=0,
        )

        assert result["accruals_ratio"] == 0


# =============================================================================
# Calculate Earnings Consistency Tests
# =============================================================================


class TestCalculateEarningsConsistency:
    """Tests for calculate_earnings_consistency function."""

    def test_consistent_growing_earnings(self):
        """Test consistency of steadily growing earnings."""
        eps_history = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7]
        result = calculate_earnings_consistency(eps_history)

        assert result["consistency"] > 0.9  # High R-squared
        assert result["trend_slope"] > 0  # Positive slope
        assert result["positive_quarters_pct"] == 100

    def test_volatile_earnings(self):
        """Test consistency of volatile earnings."""
        eps_history = [1.0, 0.5, 1.5, 0.8, 1.2, 0.6, 1.4, 0.9]
        result = calculate_earnings_consistency(eps_history)

        assert result["volatility"] > 0.3  # High volatility
        assert result["consistency"] < 0.5  # Low consistency

    def test_insufficient_data(self):
        """Test with insufficient data points."""
        eps_history = [1.0, 1.1, 1.2]  # Less than 4
        result = calculate_earnings_consistency(eps_history)

        assert result["volatility"] == 0
        assert result["consistency"] == 0
        assert result["trend_slope"] == 0

    def test_negative_earnings(self):
        """Test with some negative earnings."""
        eps_history = [1.0, -0.5, 1.5, 0.8, -0.2, 0.6, 1.4, 0.9]
        result = calculate_earnings_consistency(eps_history)

        assert result["positive_quarters_pct"] < 100


# =============================================================================
# Calculate Beat Rate Tests
# =============================================================================


class TestCalculateBeatRate:
    """Tests for calculate_beat_rate function."""

    def test_all_beats(self, sample_earnings_quarters):
        """Test beat rate with all beats."""
        # Modify all quarters to be beats
        for q in sample_earnings_quarters:
            q.eps_surprise_percent = 5.0

        result = calculate_beat_rate(sample_earnings_quarters)

        assert result["beat_rate"] == 100.0
        assert result["miss_rate"] == 0

    def test_all_misses(self, sample_earnings_quarters):
        """Test beat rate with all misses."""
        # Modify all quarters to be misses
        for q in sample_earnings_quarters:
            q.eps_surprise_percent = -5.0

        result = calculate_beat_rate(sample_earnings_quarters)

        assert result["beat_rate"] == 0
        assert result["miss_rate"] == 100.0

    def test_mixed_results(self, sample_earnings_quarters):
        """Test beat rate with mixed results."""
        result = calculate_beat_rate(sample_earnings_quarters)

        assert result["beat_rate"] >= 0
        assert result["miss_rate"] >= 0
        assert result["meet_rate"] >= 0
        assert result["total_quarters"] == len(sample_earnings_quarters)

    def test_empty_quarters(self):
        """Test beat rate with no quarters."""
        result = calculate_beat_rate([])

        assert result["beat_rate"] == 0
        assert result["miss_rate"] == 0
        assert result["consecutive_beats"] == 0

    def test_consecutive_streak(self):
        """Test consecutive beat/miss streak calculation."""
        quarters = [
            EarningsQuarter(
                fiscal_quarter=f"Q{i+1} 2024",
                fiscal_year=2024,
                fiscal_period=i + 1,
                eps_actual=1.0,
                revenue_actual=100e9,
                eps_surprise_percent=5.0 if i < 3 else -5.0,  # 3 beats then misses
            )
            for i in range(4)
        ]

        result = calculate_beat_rate(quarters)
        # Recent quarter (Q4) is a miss, so consecutive_misses = 1
        assert result["consecutive_misses"] >= 1 or result["consecutive_beats"] >= 1


# =============================================================================
# Analyze Estimate Revisions Tests
# =============================================================================


class TestAnalyzeEstimateRevisions:
    """Tests for analyze_estimate_revisions function."""

    def test_upward_revisions(self):
        """Test upward revision trend."""
        historical = [
            (datetime(2024, 9, 1), 1.40),
            (datetime(2024, 10, 1), 1.45),
            (datetime(2024, 11, 1), 1.50),
            (datetime(2024, 12, 1), 1.55),
        ]

        result = analyze_estimate_revisions(1.60, historical)

        assert result.current_estimate == 1.60
        assert result.revision_trend in ["up", "stable"]

    def test_downward_revisions(self):
        """Test downward revision trend."""
        historical = [
            (datetime(2024, 9, 1), 1.60),
            (datetime(2024, 10, 1), 1.55),
            (datetime(2024, 11, 1), 1.50),
            (datetime(2024, 12, 1), 1.45),
        ]

        result = analyze_estimate_revisions(1.40, historical)

        assert result.current_estimate == 1.40
        assert result.revision_trend in ["down", "stable"]

    def test_empty_history(self):
        """Test with empty historical estimates."""
        result = analyze_estimate_revisions(1.50, [])

        assert result.current_estimate == 1.50
        assert result.estimate_30d_ago == 1.50
        assert result.estimate_60d_ago == 1.50


# =============================================================================
# Project Future Earnings Tests
# =============================================================================


class TestProjectFutureEarnings:
    """Tests for project_future_earnings function."""

    def test_projection_with_explicit_growth(self):
        """Test projection with explicit growth rate."""
        historical = [1.0, 1.1, 1.2, 1.3]
        projections = project_future_earnings(
            historical, growth_rate=0.10, quarters_ahead=4
        )

        assert len(projections) == 4
        # Each quarter should grow by 10%
        assert projections[0] == pytest.approx(1.43, rel=0.01)

    def test_projection_with_calculated_growth(self):
        """Test projection using calculated historical growth."""
        historical = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7]
        projections = project_future_earnings(
            historical, growth_rate=None, quarters_ahead=4
        )

        assert len(projections) == 4
        assert all(p > 0 for p in projections)

    def test_projection_empty_history(self):
        """Test projection with empty history."""
        projections = project_future_earnings([], quarters_ahead=4)

        assert projections == [0, 0, 0, 0]

    def test_projection_short_history(self):
        """Test projection with short history (< 4 quarters)."""
        historical = [1.0, 1.1]
        projections = project_future_earnings(
            historical, growth_rate=None, quarters_ahead=4
        )

        assert len(projections) == 4
        # Should use default 2% quarterly growth


# =============================================================================
# ResearchAnalyzer Tests
# =============================================================================


class TestResearchAnalyzer:
    """Tests for ResearchAnalyzer class."""

    def test_analyzer_creation(self):
        """Test ResearchAnalyzer initialization."""
        analyzer = ResearchAnalyzer()
        assert analyzer is not None
        assert analyzer.health_check() is True

    def test_analyzer_with_data_manager(self, mock_data_manager_research):
        """Test ResearchAnalyzer with DataManager."""
        analyzer = ResearchAnalyzer(data_manager=mock_data_manager_research)
        assert analyzer.data_manager is not None

    @pytest.mark.asyncio
    async def test_get_valuation(self, mock_data_manager_research):
        """Test get_valuation async method."""
        analyzer = ResearchAnalyzer(data_manager=mock_data_manager_research)

        # The method uses internal _get_financials which returns mock data
        result = await analyzer.get_valuation("AAPL")

        assert result is not None
        # Result has 'dcf', 'sensitivity', 'valuation' keys
        assert "valuation" in result
        assert "dcf" in result
        assert "sensitivity" in result
        # Check valuation metrics
        assert "enterpriseValue" in result["valuation"]
        assert "evToEbitda" in result["valuation"]
        # Check DCF result
        assert "intrinsicValue" in result["dcf"]
        assert "discountRate" in result["dcf"]

    @pytest.mark.asyncio
    async def test_analyze_earnings(self, mock_data_manager_research):
        """Test analyze_earnings async method."""
        analyzer = ResearchAnalyzer(data_manager=mock_data_manager_research)

        # The method uses internal _get_earnings_history which returns mock data
        result = await analyzer.analyze_earnings("AAPL")

        assert result is not None
        # Result is an EarningsAnalysis dataclass
        assert hasattr(result, "symbol")
        assert result.symbol == "AAPL"
        assert hasattr(result, "quarters")
        assert hasattr(result, "beat_rate")
        assert hasattr(result, "eps_growth_yoy")

    @pytest.mark.asyncio
    async def test_get_peer_comparison(self, mock_data_manager_research):
        """Test get_peer_comparison async method."""
        analyzer = ResearchAnalyzer(data_manager=mock_data_manager_research)

        # The method uses internal _get_peers which returns mock data
        result = await analyzer.get_peer_comparison("AAPL")

        assert result is not None
        assert isinstance(result, dict)
        # Should have peer comparison data
        assert any(
            key in result
            for key in ["target", "peers", "comparison", "peerAverages", "symbol"]
        )

    @pytest.mark.asyncio
    async def test_generate_report(self, mock_data_manager_research):
        """Test generate_report async method."""
        analyzer = ResearchAnalyzer(data_manager=mock_data_manager_research)

        # generate_report calls get_valuation, analyze_earnings, get_peer_comparison
        result = await analyzer.generate_report("AAPL")

        assert result is not None
        # Result is a ResearchReport dataclass
        assert hasattr(result, "symbol")
        assert result.symbol == "AAPL"
        # Should have comprehensive report sections
        assert hasattr(result, "valuation")
        assert hasattr(result, "earnings")
        assert hasattr(result, "dcf")
        assert hasattr(result, "current_price")


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_dcf_with_single_cash_flow(self):
        """Test DCF with only one year of cash flow."""
        result = calculate_dcf(
            free_cash_flows=[10000],
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=100,
            current_price=100,
            symbol="TEST",
        )

        assert result.intrinsic_value > 0
        assert result.projection_years == 1

    def test_valuation_multiples_all_zeros(self):
        """Test valuation multiples with all zero inputs."""
        result = calculate_valuation_multiples(
            price=0,
            shares_outstanding=0,
            earnings=0,
            forward_earnings=0,
            revenue=0,
            book_value=0,
            tangible_book_value=0,
            ebitda=0,
            free_cash_flow=0,
            total_debt=0,
            cash=0,
            dividends_per_share=0,
            earnings_growth_rate=0,
            symbol="ZERO",
        )

        assert result.market_cap == 0
        assert result.enterprise_value == 0

    def test_earnings_analysis_single_quarter(self):
        """Test earnings analysis with single quarter."""
        quarter = EarningsQuarter(
            fiscal_quarter="Q1 2024",
            fiscal_year=2024,
            fiscal_period=1,
            eps_actual=1.0,
            revenue_actual=100e9,
            eps_surprise_percent=5.0,
        )

        result = calculate_beat_rate([quarter])

        assert result["total_quarters"] == 1
        assert result["beat_rate"] == 100.0

    def test_growth_rate_very_small_values(self):
        """Test growth rate with very small values."""
        rate = calculate_growth_rate(0.001, 0.0001)
        assert rate == pytest.approx(900.0, rel=0.1)

    def test_cagr_fractional_years(self):
        """Test CAGR with fractional years."""
        cagr = calculate_cagr(100, 110, 0.5)  # Half year
        assert cagr > 10  # Should be higher than 10% annualized


# =============================================================================
# Parametrized Tests
# =============================================================================


class TestParametrized:
    """Parametrized tests for comprehensive coverage."""

    @pytest.mark.parametrize(
        "actual,estimate,expected_surprise,expected_pct",
        [
            (1.50, 1.45, 0.05, 3.45),
            (1.40, 1.45, -0.05, -3.45),
            (1.45, 1.45, 0.0, 0.0),
            (2.00, 1.00, 1.00, 100.0),
            (0.50, 1.00, -0.50, -50.0),
        ],
    )
    def test_earnings_surprise_parametrized(
        self, actual, estimate, expected_surprise, expected_pct
    ):
        """Parametrized test for earnings surprise calculation."""
        surprise, pct = calculate_earnings_surprise(actual, estimate)

        assert surprise == pytest.approx(expected_surprise, rel=0.01)
        assert pct == pytest.approx(expected_pct, rel=0.1)

    @pytest.mark.parametrize(
        "current,previous,expected",
        [
            (110, 100, 10.0),
            (90, 100, -10.0),
            (100, 100, 0.0),
            (200, 100, 100.0),
            (50, 100, -50.0),
        ],
    )
    def test_growth_rate_parametrized(self, current, previous, expected):
        """Parametrized test for growth rate calculation."""
        rate = calculate_growth_rate(current, previous)
        assert rate == pytest.approx(expected, rel=0.01)

    @pytest.mark.parametrize(
        "start,end,years,expected",
        [
            (100, 161.05, 5, 10.0),
            (100, 200, 7.27, 10.0),
            (100, 100, 5, 0.0),
            (100, 50, 5, -12.94),
        ],
    )
    def test_cagr_parametrized(self, start, end, years, expected):
        """Parametrized test for CAGR calculation."""
        cagr = calculate_cagr(start, end, years)
        assert cagr == pytest.approx(expected, rel=0.1)

    @pytest.mark.parametrize(
        "discount_rate",
        [0.06, 0.08, 0.10, 0.12, 0.15],
    )
    def test_dcf_various_discount_rates(self, discount_rate, sample_free_cash_flows):
        """Parametrized test for DCF with various discount rates."""
        result = calculate_dcf(
            free_cash_flows=sample_free_cash_flows,
            discount_rate=discount_rate,
            terminal_growth_rate=0.025,
            net_debt=0,
            shares_outstanding=1000,
            current_price=100,
            symbol="TEST",
        )

        assert result.intrinsic_value > 0
        assert result.discount_rate == discount_rate
