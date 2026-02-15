"""Tests for earnings quality metrics."""

import pytest
import pandas as pd
import numpy as np
from unittest.mock import Mock, patch, MagicMock

from stanley.accounting.earnings_quality import (
    BeneishMScore,
    PiotroskiFScore,
    AltmanZScore,
    AccrualAnalyzer,
    EarningsQualityAnalyzer,
    QualityRating,
    MScoreResult,
    FScoreResult,
    ZScoreResult,
    EarningsQualityResult,
)
from stanley.accounting.financial_statements import FinancialStatements, StatementData


@pytest.fixture
def mock_statements():
    """Create mock financial statements for testing."""
    balance_sheet = pd.DataFrame(
        {
            "accounts_receivable": [100, 120],
            "total_assets": [1000, 1100],
            "current_assets": [500, 550],
            "ppe_net": [300, 320],
            "total_liabilities": [400, 450],
            "current_liabilities": [150, 160],
            "shareholders_equity": [600, 650],
            "retained_earnings": [400, 450],
            "long_term_debt": [200, 220],
            "short_term_debt": [50, 60],
            "common_stock": [100, 100],
            "cash_and_equivalents": [150, 170],
        }
    )

    income_statement = pd.DataFrame(
        {
            "revenue": [1000, 1100],
            "cost_of_revenue": [600, 660],
            "gross_profit": [400, 440],
            "sga_expense": [200, 220],
            "operating_income": [170, 190],
            "net_income": [100, 120],
        }
    )

    cash_flow = pd.DataFrame(
        {
            "cfo": [120, 140],
            "depreciation": [30, 35],
            "capex": [-50, -55],
        }
    )

    return {
        "balance_sheet": StatementData(
            statement_type="balance_sheet",
            ticker="TEST",
            data=balance_sheet,
        ),
        "income_statement": StatementData(
            statement_type="income_statement",
            ticker="TEST",
            data=income_statement,
        ),
        "cash_flow": StatementData(
            statement_type="cash_flow",
            ticker="TEST",
            data=cash_flow,
        ),
    }


class TestQualityRating:
    """Test QualityRating enum."""

    def test_quality_rating_values(self):
        """Test quality rating enum values."""
        assert QualityRating.EXCELLENT.value == "excellent"
        assert QualityRating.GOOD.value == "good"
        assert QualityRating.FAIR.value == "fair"
        assert QualityRating.POOR.value == "poor"
        assert QualityRating.CRITICAL.value == "critical"


class TestMScoreResult:
    """Test MScoreResult dataclass."""

    def test_mscore_result_creation(self):
        """Test creating an MScoreResult."""
        result = MScoreResult(
            m_score=-2.5,
            is_likely_manipulator=False,
            components={"dsri": 1.0, "gmi": 1.0},
            risk_level=QualityRating.GOOD,
        )
        assert result.m_score == -2.5
        assert result.is_likely_manipulator is False
        assert "dsri" in result.components
        assert result.risk_level == QualityRating.GOOD


class TestFScoreResult:
    """Test FScoreResult dataclass."""

    def test_fscore_result_creation(self):
        """Test creating an FScoreResult."""
        result = FScoreResult(
            f_score=7,
            signals={"roa_positive": True, "cfo_positive": True},
            category="Neutral",
        )
        assert result.f_score == 7
        assert result.signals["roa_positive"] is True
        assert result.category == "Neutral"


class TestZScoreResult:
    """Test ZScoreResult dataclass."""

    def test_zscore_result_creation(self):
        """Test creating a ZScoreResult."""
        result = ZScoreResult(
            z_score=3.5,
            zone="Safe",
            components={"working_capital_to_assets": 0.35},
        )
        assert result.z_score == 3.5
        assert result.zone == "Safe"
        assert "working_capital_to_assets" in result.components


class TestBeneishMScore:
    """Test Beneish M-Score calculation."""

    def test_init_default(self):
        """Test initialization with default FinancialStatements."""
        calculator = BeneishMScore()
        assert calculator.fin_stmt is not None

    def test_init_with_statements(self):
        """Test initialization with custom FinancialStatements."""
        mock_fin_stmt = Mock(spec=FinancialStatements)
        calculator = BeneishMScore(financial_statements=mock_fin_stmt)
        assert calculator.fin_stmt == mock_fin_stmt

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_returns_mscore_result(
        self, mock_get_statements, mock_statements
    ):
        """Test calculate returns MScoreResult."""
        mock_get_statements.return_value = mock_statements

        calculator = BeneishMScore()
        result = calculator.calculate("TEST")

        assert isinstance(result, MScoreResult)
        assert hasattr(result, "m_score")
        assert hasattr(result, "is_likely_manipulator")
        assert hasattr(result, "components")
        assert hasattr(result, "risk_level")

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_handles_errors(self, mock_get_statements):
        """Test calculate handles errors gracefully."""
        mock_get_statements.side_effect = Exception("Data not available")

        calculator = BeneishMScore()
        result = calculator.calculate("ERROR")

        assert isinstance(result, MScoreResult)
        assert pd.isna(result.m_score)
        assert result.is_likely_manipulator is False
        assert result.risk_level == QualityRating.FAIR


class TestPiotroskiFScore:
    """Test Piotroski F-Score calculation."""

    def test_init_default(self):
        """Test initialization with default FinancialStatements."""
        calculator = PiotroskiFScore()
        assert calculator.fin_stmt is not None

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_returns_fscore_result(
        self, mock_get_statements, mock_statements
    ):
        """Test calculate returns FScoreResult."""
        mock_get_statements.return_value = mock_statements

        calculator = PiotroskiFScore()
        result = calculator.calculate("TEST")

        assert isinstance(result, FScoreResult)
        assert hasattr(result, "f_score")
        assert hasattr(result, "signals")
        assert hasattr(result, "category")
        assert 0 <= result.f_score <= 9

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_signals_dict(self, mock_get_statements, mock_statements):
        """Test calculate returns signals dictionary."""
        mock_get_statements.return_value = mock_statements

        calculator = PiotroskiFScore()
        result = calculator.calculate("TEST")

        assert isinstance(result.signals, dict)

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_handles_errors(self, mock_get_statements):
        """Test calculate handles errors gracefully."""
        mock_get_statements.side_effect = Exception("Data not available")

        calculator = PiotroskiFScore()
        result = calculator.calculate("ERROR")

        assert isinstance(result, FScoreResult)
        assert result.f_score == 0
        assert result.category == "Unknown"


class TestAltmanZScore:
    """Test Altman Z-Score calculation."""

    def test_init_default(self):
        """Test initialization with default FinancialStatements."""
        calculator = AltmanZScore()
        assert calculator.fin_stmt is not None

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_returns_zscore_result(
        self, mock_get_statements, mock_statements
    ):
        """Test calculate returns ZScoreResult."""
        mock_get_statements.return_value = mock_statements

        calculator = AltmanZScore()
        result = calculator.calculate("TEST")

        assert isinstance(result, ZScoreResult)
        assert hasattr(result, "z_score")
        assert hasattr(result, "zone")
        assert hasattr(result, "components")

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_zone_classification(self, mock_get_statements, mock_statements):
        """Test calculate assigns correct zone."""
        mock_get_statements.return_value = mock_statements

        calculator = AltmanZScore()
        result = calculator.calculate("TEST")

        assert result.zone in ["Safe", "Grey", "Distress", "Unknown"]

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_manufacturing_formula(
        self, mock_get_statements, mock_statements
    ):
        """Test calculate with manufacturing formula."""
        mock_get_statements.return_value = mock_statements

        calculator = AltmanZScore()
        result = calculator.calculate("TEST", manufacturing=True)

        assert isinstance(result, ZScoreResult)
        # Manufacturing formula includes sales_to_assets
        assert "sales_to_assets" in result.components

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_handles_errors(self, mock_get_statements):
        """Test calculate handles errors gracefully."""
        mock_get_statements.side_effect = Exception("Data not available")

        calculator = AltmanZScore()
        result = calculator.calculate("ERROR")

        assert isinstance(result, ZScoreResult)
        assert result.zone == "Unknown"


class TestAccrualAnalyzer:
    """Test accrual analysis."""

    def test_init_default(self):
        """Test initialization with default FinancialStatements."""
        analyzer = AccrualAnalyzer()
        assert analyzer.fin_stmt is not None

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_accrual_ratio(self, mock_get_statements, mock_statements):
        """Test accrual ratio calculation."""
        mock_get_statements.return_value = mock_statements

        analyzer = AccrualAnalyzer()
        ratio = analyzer.calculate_accrual_ratio("TEST")

        assert isinstance(ratio, float) or pd.isna(ratio)

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_cash_conversion(self, mock_get_statements, mock_statements):
        """Test cash conversion calculation."""
        mock_get_statements.return_value = mock_statements

        analyzer = AccrualAnalyzer()
        conversion = analyzer.calculate_cash_conversion("TEST")

        assert isinstance(conversion, float) or pd.isna(conversion)

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_accrual_ratio_handles_errors(self, mock_get_statements):
        """Test accrual ratio handles errors gracefully."""
        mock_get_statements.side_effect = Exception("Data not available")

        analyzer = AccrualAnalyzer()
        ratio = analyzer.calculate_accrual_ratio("ERROR")

        assert pd.isna(ratio)

    @patch.object(FinancialStatements, "get_all_statements")
    def test_calculate_cash_conversion_handles_errors(self, mock_get_statements):
        """Test cash conversion handles errors gracefully."""
        mock_get_statements.side_effect = Exception("Data not available")

        analyzer = AccrualAnalyzer()
        conversion = analyzer.calculate_cash_conversion("ERROR")

        assert pd.isna(conversion)


class TestEarningsQualityAnalyzer:
    """Test integrated earnings quality analysis."""

    def test_init_default(self):
        """Test initialization with default FinancialStatements."""
        analyzer = EarningsQualityAnalyzer()
        assert analyzer.fin_stmt is not None
        assert analyzer.m_score_calc is not None
        assert analyzer.f_score_calc is not None
        assert analyzer.z_score_calc is not None
        assert analyzer.accrual_calc is not None

    @patch.object(FinancialStatements, "get_all_statements")
    def test_analyze_returns_result(self, mock_get_statements, mock_statements):
        """Test analyze returns EarningsQualityResult."""
        mock_get_statements.return_value = mock_statements

        analyzer = EarningsQualityAnalyzer()
        result = analyzer.analyze("TEST")

        assert isinstance(result, EarningsQualityResult)
        assert hasattr(result, "overall_rating")
        assert hasattr(result, "overall_score")
        assert hasattr(result, "m_score")
        assert hasattr(result, "f_score")
        assert hasattr(result, "z_score")
        assert hasattr(result, "accrual_ratio")
        assert hasattr(result, "cash_conversion")
        assert hasattr(result, "red_flags")

    @patch.object(FinancialStatements, "get_all_statements")
    def test_analyze_overall_score_range(self, mock_get_statements, mock_statements):
        """Test analyze overall score is in valid range."""
        mock_get_statements.return_value = mock_statements

        analyzer = EarningsQualityAnalyzer()
        result = analyzer.analyze("TEST")

        assert 0 <= result.overall_score <= 100

    @patch.object(FinancialStatements, "get_all_statements")
    def test_analyze_red_flags_list(self, mock_get_statements, mock_statements):
        """Test analyze returns red flags as list."""
        mock_get_statements.return_value = mock_statements

        analyzer = EarningsQualityAnalyzer()
        result = analyzer.analyze("TEST")

        assert isinstance(result.red_flags, list)

    @patch.object(FinancialStatements, "get_all_statements")
    def test_analyze_handles_errors(self, mock_get_statements):
        """Test analyze handles errors gracefully."""
        mock_get_statements.side_effect = Exception("Data not available")

        analyzer = EarningsQualityAnalyzer()
        result = analyzer.analyze("ERROR")

        assert isinstance(result, EarningsQualityResult)
        # When errors occur, the analyzer returns CRITICAL rating with score 0
        assert result.overall_rating == QualityRating.CRITICAL
        assert result.overall_score == 0.0
