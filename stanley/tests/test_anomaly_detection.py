"""Tests for anomaly detection."""

import pytest
import pandas as pd
import numpy as np
from unittest.mock import Mock, patch

from stanley.accounting.anomaly_detection import (
    AnomalyType,
    Anomaly,
    AnomalyReport,
    TimeSeriesAnomalyDetector,
    BenfordAnalyzer,
    PeerComparisonAnalyzer,
    FootnoteAnomalyDetector,
    DisclosureQualityScorer,
    SeasonalAnomalyDetector,
    AnomalyAggregator,
)


class TestAnomalyType:
    """Tests for AnomalyType enum."""

    def test_type_values(self):
        """Test anomaly type enum values."""
        assert AnomalyType.STATISTICAL_OUTLIER.value == "statistical_outlier"
        assert AnomalyType.TREND_BREAK.value == "trend_break"
        assert AnomalyType.PEER_DEVIATION.value == "peer_deviation"
        assert AnomalyType.BENFORD_VIOLATION.value == "benford_violation"
        assert AnomalyType.DISCLOSURE_CHANGE.value == "disclosure_change"
        assert AnomalyType.SEASONAL_ANOMALY.value == "seasonal_anomaly"


class TestAnomaly:
    """Tests for Anomaly dataclass."""

    def test_create_anomaly(self):
        """Test creating an Anomaly instance."""
        anomaly = Anomaly(
            anomaly_type=AnomalyType.STATISTICAL_OUTLIER,
            metric="revenue",
            period="2023-Q4",
            expected_value=100.0,
            actual_value=150.0,
            deviation=2.5,
            confidence=0.85,
            explanation="Revenue is 2.5 std deviations from mean",
        )
        assert anomaly.anomaly_type == AnomalyType.STATISTICAL_OUTLIER
        assert anomaly.metric == "revenue"
        assert anomaly.period == "2023-Q4"
        assert anomaly.expected_value == 100.0
        assert anomaly.actual_value == 150.0
        assert anomaly.deviation == 2.5
        assert anomaly.confidence == 0.85

    def test_anomaly_with_trend_break(self):
        """Test creating a trend break anomaly."""
        anomaly = Anomaly(
            anomaly_type=AnomalyType.TREND_BREAK,
            metric="net_income",
            period="2024-Q1",
            expected_value=50.0,
            actual_value=20.0,
            deviation=3.0,
            confidence=0.75,
            explanation="Net income breaks trend",
        )
        assert anomaly.anomaly_type == AnomalyType.TREND_BREAK


class TestAnomalyReport:
    """Tests for AnomalyReport dataclass."""

    def test_create_report(self):
        """Test creating an AnomalyReport."""
        anomalies = [
            Anomaly(
                anomaly_type=AnomalyType.STATISTICAL_OUTLIER,
                metric="revenue",
                period="Q4",
                expected_value=100.0,
                actual_value=150.0,
                deviation=2.5,
                confidence=0.85,
                explanation="Test",
            )
        ]
        report = AnomalyReport(
            ticker="AAPL",
            anomalies=anomalies,
            anomaly_score=65.0,
            time_series_health="fair",
            peer_alignment="well_aligned",
            disclosure_quality="B",
        )
        assert report.ticker == "AAPL"
        assert len(report.anomalies) == 1
        assert report.anomaly_score == 65.0
        assert report.time_series_health == "fair"

    def test_empty_report(self):
        """Test creating an empty report."""
        report = AnomalyReport(
            ticker="MSFT",
            anomalies=[],
            anomaly_score=0.0,
            time_series_health="healthy",
            peer_alignment="well_aligned",
            disclosure_quality="A",
        )
        assert len(report.anomalies) == 0
        assert report.anomaly_score == 0.0


class TestTimeSeriesAnomalyDetector:
    """Tests for TimeSeriesAnomalyDetector."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        detector = TimeSeriesAnomalyDetector(edgar_adapter=mock_adapter)
        assert detector is not None
        assert detector.edgar_adapter is mock_adapter

    def test_detect_returns_list(self):
        """Test detect method returns list."""
        mock_adapter = Mock()
        detector = TimeSeriesAnomalyDetector(edgar_adapter=mock_adapter)

        with patch.object(detector, "_extract_metric_series", return_value=None):
            result = detector.detect("AAPL", metrics=["revenue"])

        assert isinstance(result, list)

    def test_detect_with_empty_data(self):
        """Test detect with insufficient data."""
        mock_adapter = Mock()
        detector = TimeSeriesAnomalyDetector(edgar_adapter=mock_adapter)

        with patch.object(
            detector, "_extract_metric_series", return_value=pd.Series([1, 2])
        ):
            result = detector.detect("AAPL", metrics=["revenue"])

        assert isinstance(result, list)


class TestBenfordAnalyzer:
    """Tests for BenfordAnalyzer."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        analyzer = BenfordAnalyzer(edgar_adapter=mock_adapter)
        assert analyzer is not None
        assert analyzer.edgar_adapter is mock_adapter

    def test_benford_distribution_defined(self):
        """Test Benford's Law distribution is defined."""
        assert BenfordAnalyzer.BENFORD_DISTRIBUTION is not None
        assert len(BenfordAnalyzer.BENFORD_DISTRIBUTION) == 9
        assert 1 in BenfordAnalyzer.BENFORD_DISTRIBUTION
        assert 9 in BenfordAnalyzer.BENFORD_DISTRIBUTION

    def test_benford_distribution_sums_to_one(self):
        """Test Benford distribution sums to approximately 1."""
        total = sum(BenfordAnalyzer.BENFORD_DISTRIBUTION.values())
        assert np.isclose(total, 1.0, atol=0.01)

    def test_analyze_returns_dict(self):
        """Test analyze returns dictionary."""
        mock_adapter = Mock()
        analyzer = BenfordAnalyzer(edgar_adapter=mock_adapter)

        with patch(
            "stanley.accounting.anomaly_detection.FinancialStatements"
        ) as mock_fs:
            mock_fs.return_value.income_statement = None
            mock_fs.return_value.balance_sheet = None
            mock_fs.return_value.cash_flow_statement = None
            result = analyzer.analyze("AAPL")

        assert isinstance(result, dict)
        assert "conformity" in result


class TestPeerComparisonAnalyzer:
    """Tests for PeerComparisonAnalyzer."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        analyzer = PeerComparisonAnalyzer(edgar_adapter=mock_adapter)
        assert analyzer is not None
        assert analyzer.edgar_adapter is mock_adapter

    def test_analyze_returns_list(self):
        """Test analyze returns list of anomalies."""
        mock_adapter = Mock()
        analyzer = PeerComparisonAnalyzer(edgar_adapter=mock_adapter)

        with patch.object(analyzer, "_calculate_ratios", return_value=None):
            result = analyzer.analyze("AAPL", peers=["MSFT", "GOOGL"])

        assert isinstance(result, list)

    def test_analyze_with_no_peers(self):
        """Test analyze with empty peers list."""
        mock_adapter = Mock()
        analyzer = PeerComparisonAnalyzer(edgar_adapter=mock_adapter)

        result = analyzer.analyze("AAPL", peers=[])
        assert isinstance(result, list)


class TestFootnoteAnomalyDetector:
    """Tests for FootnoteAnomalyDetector."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        detector = FootnoteAnomalyDetector(edgar_adapter=mock_adapter)
        assert detector is not None
        assert detector.edgar_adapter is mock_adapter

    def test_detect_returns_list(self):
        """Test detect returns list of anomalies."""
        mock_adapter = Mock()
        detector = FootnoteAnomalyDetector(edgar_adapter=mock_adapter)

        with patch.object(
            detector.footnote_analyzer, "get_all_footnotes", return_value={}
        ):
            result = detector.detect("AAPL")

        assert isinstance(result, list)


class TestDisclosureQualityScorer:
    """Tests for DisclosureQualityScorer."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)
        assert scorer is not None
        assert scorer.edgar_adapter is mock_adapter

    def test_score_returns_dict(self):
        """Test score returns dictionary."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)

        with patch.object(
            scorer.footnote_analyzer, "get_all_footnotes", return_value={}
        ):
            result = scorer.score("AAPL")

        assert isinstance(result, dict)
        assert "overall_score" in result

    def test_get_grade_a(self):
        """Test grade A for high scores."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)
        assert scorer._get_grade(95) == "A"
        assert scorer._get_grade(90) == "A"

    def test_get_grade_b(self):
        """Test grade B for good scores."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)
        assert scorer._get_grade(85) == "B"
        assert scorer._get_grade(80) == "B"

    def test_get_grade_c(self):
        """Test grade C for average scores."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)
        assert scorer._get_grade(75) == "C"
        assert scorer._get_grade(70) == "C"

    def test_get_grade_d(self):
        """Test grade D for below average scores."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)
        assert scorer._get_grade(65) == "D"
        assert scorer._get_grade(60) == "D"

    def test_get_grade_f(self):
        """Test grade F for poor scores."""
        mock_adapter = Mock()
        scorer = DisclosureQualityScorer(edgar_adapter=mock_adapter)
        assert scorer._get_grade(50) == "F"
        assert scorer._get_grade(0) == "F"


class TestSeasonalAnomalyDetector:
    """Tests for SeasonalAnomalyDetector."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        detector = SeasonalAnomalyDetector(edgar_adapter=mock_adapter)
        assert detector is not None
        assert detector.edgar_adapter is mock_adapter

    def test_detect_returns_list(self):
        """Test detect returns list of anomalies."""
        mock_adapter = Mock()
        detector = SeasonalAnomalyDetector(edgar_adapter=mock_adapter)

        with patch(
            "stanley.accounting.anomaly_detection.FinancialStatements"
        ) as mock_fs:
            mock_fs.return_value.income_statement = None
            result = detector.detect("AAPL")

        assert isinstance(result, list)


class TestAnomalyAggregator:
    """Tests for AnomalyAggregator."""

    def test_init(self):
        """Test initialization."""
        mock_adapter = Mock()
        aggregator = AnomalyAggregator(edgar_adapter=mock_adapter)
        assert aggregator is not None
        assert aggregator.edgar_adapter is mock_adapter
        assert aggregator.time_series_detector is not None
        assert aggregator.benford_analyzer is not None
        assert aggregator.peer_analyzer is not None
        assert aggregator.footnote_detector is not None
        assert aggregator.disclosure_scorer is not None
        assert aggregator.seasonal_detector is not None

    def test_aggregate_returns_report(self):
        """Test aggregate returns AnomalyReport."""
        mock_adapter = Mock()
        aggregator = AnomalyAggregator(edgar_adapter=mock_adapter)

        with patch.object(aggregator.time_series_detector, "detect", return_value=[]):
            with patch.object(
                aggregator.benford_analyzer,
                "analyze",
                return_value={"conformity": "conforms"},
            ):
                with patch.object(
                    aggregator.footnote_detector, "detect", return_value=[]
                ):
                    with patch.object(
                        aggregator.seasonal_detector, "detect", return_value=[]
                    ):
                        with patch.object(
                            aggregator.disclosure_scorer,
                            "score",
                            return_value={"overall_score": 80, "grade": "B"},
                        ):
                            result = aggregator.aggregate("AAPL")

        assert isinstance(result, AnomalyReport)
        assert result.ticker == "AAPL"

    def test_assess_time_series_health_healthy(self):
        """Test healthy time series assessment."""
        mock_adapter = Mock()
        aggregator = AnomalyAggregator(edgar_adapter=mock_adapter)
        assert aggregator._assess_time_series_health([]) == "healthy"

    def test_assess_time_series_health_poor(self):
        """Test poor time series assessment."""
        mock_adapter = Mock()
        aggregator = AnomalyAggregator(edgar_adapter=mock_adapter)

        high_conf_anomalies = [
            Anomaly(
                anomaly_type=AnomalyType.STATISTICAL_OUTLIER,
                metric="test",
                period="Q1",
                expected_value=0,
                actual_value=0,
                deviation=0,
                confidence=0.9,
                explanation="test",
            )
            for _ in range(3)
        ]
        assert aggregator._assess_time_series_health(high_conf_anomalies) == "poor"

    def test_assess_peer_alignment_well_aligned(self):
        """Test well aligned peer assessment."""
        mock_adapter = Mock()
        aggregator = AnomalyAggregator(edgar_adapter=mock_adapter)
        assert aggregator._assess_peer_alignment([]) == "well_aligned"
