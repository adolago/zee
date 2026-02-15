"""Tests for red flag detection."""

import pytest
from unittest.mock import Mock, patch

from stanley.accounting.red_flags import (
    RedFlag,
    RedFlagSeverity,
    RedFlagCategory,
    RedFlagReport,
    RevenueRedFlagDetector,
    ExpenseRedFlagDetector,
    AccrualRedFlagDetector,
    OffBalanceSheetDetector,
    CashFlowRedFlagDetector,
    RedFlagScorer,
)


class TestRedFlagSeverity:
    """Tests for RedFlagSeverity enum."""

    def test_severity_values(self):
        """Test severity enum values."""
        assert RedFlagSeverity.LOW.value == "low"
        assert RedFlagSeverity.MEDIUM.value == "medium"
        assert RedFlagSeverity.HIGH.value == "high"
        assert RedFlagSeverity.CRITICAL.value == "critical"


class TestRedFlagCategory:
    """Tests for RedFlagCategory enum."""

    def test_category_values(self):
        """Test category enum values exist."""
        # Just verify the enum has some categories
        assert hasattr(RedFlagCategory, "REVENUE")
        assert hasattr(RedFlagCategory, "EXPENSES")  # Note: plural
        assert hasattr(RedFlagCategory, "ACCRUALS")
        assert hasattr(RedFlagCategory, "BALANCE_SHEET")
        assert hasattr(RedFlagCategory, "OFF_BALANCE")
        assert hasattr(RedFlagCategory, "CASH_FLOW")
        assert hasattr(RedFlagCategory, "RELATED_PARTY")
        assert hasattr(RedFlagCategory, "AUDIT")

    def test_category_values_content(self):
        """Test category enum values."""
        assert RedFlagCategory.REVENUE.value == "revenue_recognition"
        assert RedFlagCategory.EXPENSES.value == "expense_manipulation"
        assert RedFlagCategory.ACCRUALS.value == "accrual_anomaly"


class TestRedFlag:
    """Tests for RedFlag dataclass."""

    def test_red_flag_creation(self):
        """Test creating a RedFlag instance."""
        flag = RedFlag(
            category=RedFlagCategory.REVENUE,
            severity=RedFlagSeverity.HIGH,
            description="Test red flag",
            metric_name="test_metric",
            metric_value=1.5,
            threshold=1.0,
            confidence=0.85,
            recommendation="Take action",
        )
        assert flag.category == RedFlagCategory.REVENUE
        assert flag.severity == RedFlagSeverity.HIGH
        assert flag.description == "Test red flag"
        assert flag.metric_value == 1.5
        assert flag.threshold == 1.0
        assert flag.confidence == 0.85

    def test_red_flag_with_expense_category(self):
        """Test creating a red flag with expense category."""
        flag = RedFlag(
            category=RedFlagCategory.EXPENSES,
            severity=RedFlagSeverity.MEDIUM,
            description="Expense anomaly",
            metric_name="sga_ratio",
            metric_value=0.5,
            threshold=0.3,
            confidence=0.70,
            recommendation="Review expenses",
        )
        assert flag.category == RedFlagCategory.EXPENSES


class TestRedFlagReport:
    """Tests for RedFlagReport dataclass."""

    def test_report_creation(self):
        """Test creating a RedFlagReport."""
        flags = [
            RedFlag(
                category=RedFlagCategory.REVENUE,
                severity=RedFlagSeverity.HIGH,
                description="Test",
                metric_name="test",
                metric_value=1.0,
                threshold=0.5,
                confidence=0.8,
                recommendation="Test",
            )
        ]
        report = RedFlagReport(
            ticker="AAPL",
            total_score=65.0,
            risk_level="Medium",
            flags=flags,
            summary="Test summary",
            top_concerns=["Concern 1"],
        )
        assert report.ticker == "AAPL"
        assert report.total_score == 65.0
        assert len(report.flags) == 1


class TestRevenueRedFlagDetector:
    """Tests for RevenueRedFlagDetector."""

    def test_init(self):
        """Test initialization."""
        mock_statements = Mock()
        mock_footnotes = Mock()
        detector = RevenueRedFlagDetector(
            statements=mock_statements, footnotes=mock_footnotes
        )
        assert detector is not None
        assert detector.statements is mock_statements
        assert detector.footnotes is mock_footnotes

    def test_detect_returns_list(self):
        """Test detect returns list of flags."""
        mock_statements = Mock()
        mock_statements.get_all_statements.return_value = {
            "balance_sheet": Mock(data=Mock()),
            "income_statement": Mock(data=Mock()),
        }
        mock_footnotes = Mock()
        detector = RevenueRedFlagDetector(
            statements=mock_statements, footnotes=mock_footnotes
        )
        result = detector.detect("AAPL")
        assert isinstance(result, list)


class TestExpenseRedFlagDetector:
    """Tests for ExpenseRedFlagDetector."""

    def test_init(self):
        """Test initialization."""
        mock_statements = Mock()
        detector = ExpenseRedFlagDetector(statements=mock_statements)
        assert detector is not None
        assert detector.statements is mock_statements

    def test_detect_returns_list(self):
        """Test detect returns list of flags."""
        mock_statements = Mock()
        mock_statements.get_all_statements.return_value = {
            "income_statement": Mock(data=Mock()),
            "cash_flow": Mock(data=Mock()),
        }
        detector = ExpenseRedFlagDetector(statements=mock_statements)
        result = detector.detect("AAPL")
        assert isinstance(result, list)


class TestAccrualRedFlagDetector:
    """Tests for AccrualRedFlagDetector."""

    def test_init(self):
        """Test initialization."""
        mock_statements = Mock()
        detector = AccrualRedFlagDetector(statements=mock_statements)
        assert detector is not None
        assert detector.statements is mock_statements


class TestOffBalanceSheetDetector:
    """Tests for OffBalanceSheetDetector."""

    def test_init(self):
        """Test initialization."""
        mock_statements = Mock()
        mock_footnotes = Mock()
        detector = OffBalanceSheetDetector(
            statements=mock_statements, footnotes=mock_footnotes
        )
        assert detector is not None
        assert detector.statements is mock_statements
        assert detector.footnotes is mock_footnotes


class TestCashFlowRedFlagDetector:
    """Tests for CashFlowRedFlagDetector."""

    def test_init(self):
        """Test initialization."""
        mock_statements = Mock()
        detector = CashFlowRedFlagDetector(statements=mock_statements)
        assert detector is not None
        assert detector.statements is mock_statements


class TestRedFlagScorer:
    """Tests for RedFlagScorer."""

    def test_init(self):
        """Test initialization."""
        with patch("stanley.accounting.red_flags.EdgarAdapter"):
            with patch("stanley.accounting.red_flags.FinancialStatements"):
                with patch("stanley.accounting.red_flags.FootnoteAnalyzer"):
                    scorer = RedFlagScorer()
                    assert scorer is not None

    def test_severity_weights_defined(self):
        """Test severity weights are defined."""
        assert RedFlagScorer.SEVERITY_WEIGHTS is not None
        assert RedFlagSeverity.LOW in RedFlagScorer.SEVERITY_WEIGHTS
        assert RedFlagSeverity.MEDIUM in RedFlagScorer.SEVERITY_WEIGHTS
        assert RedFlagSeverity.HIGH in RedFlagScorer.SEVERITY_WEIGHTS
        assert RedFlagSeverity.CRITICAL in RedFlagScorer.SEVERITY_WEIGHTS

    def test_severity_weights_ordering(self):
        """Test severity weights increase with severity."""
        weights = RedFlagScorer.SEVERITY_WEIGHTS
        assert weights[RedFlagSeverity.LOW] < weights[RedFlagSeverity.MEDIUM]
        assert weights[RedFlagSeverity.MEDIUM] < weights[RedFlagSeverity.HIGH]
        assert weights[RedFlagSeverity.HIGH] < weights[RedFlagSeverity.CRITICAL]
