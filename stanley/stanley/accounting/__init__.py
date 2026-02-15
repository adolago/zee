"""
Accounting Module

SEC filings analysis, financial statement parsing, and footnote extraction
using edgartools for comprehensive fundamental analysis.
"""

from .edgar_adapter import EdgarAdapter
from .financial_statements import FinancialStatements
from .footnotes import FootnoteAnalyzer
from .accounting_analyzer import AccountingAnalyzer
from .earnings_quality import (
    EarningsQualityAnalyzer,
    BeneishMScore,
    PiotroskiFScore,
    AltmanZScore,
    AccrualAnalyzer,
    QualityRating,
    MScoreResult,
    FScoreResult,
    ZScoreResult,
    EarningsQualityResult,
)
from .red_flags import (
    RedFlagScorer,
    RedFlagReport,
    RedFlag,
    RedFlagSeverity,
    RevenueRedFlagDetector,
    ExpenseRedFlagDetector,
    AccrualRedFlagDetector,
    OffBalanceSheetDetector,
    CashFlowRedFlagDetector,
)
from .anomaly_detection import (
    AnomalyAggregator,
    AnomalyReport,
    TimeSeriesAnomalyDetector,
    BenfordAnalyzer,
    PeerComparisonAnalyzer,
    FootnoteAnomalyDetector,
    DisclosureQualityScorer,
    SeasonalAnomalyDetector,
)

__all__ = [
    # Core
    "EdgarAdapter",
    "FinancialStatements",
    "FootnoteAnalyzer",
    "AccountingAnalyzer",
    # Earnings Quality
    "EarningsQualityAnalyzer",
    "BeneishMScore",
    "PiotroskiFScore",
    "AltmanZScore",
    "AccrualAnalyzer",
    "QualityRating",
    "MScoreResult",
    "FScoreResult",
    "ZScoreResult",
    "EarningsQualityResult",
    # Red Flags
    "RedFlagScorer",
    "RedFlagReport",
    "RedFlag",
    "RedFlagSeverity",
    "RevenueRedFlagDetector",
    "ExpenseRedFlagDetector",
    "AccrualRedFlagDetector",
    "OffBalanceSheetDetector",
    "CashFlowRedFlagDetector",
    # Anomaly Detection
    "AnomalyAggregator",
    "AnomalyReport",
    "TimeSeriesAnomalyDetector",
    "BenfordAnalyzer",
    "PeerComparisonAnalyzer",
    "FootnoteAnomalyDetector",
    "DisclosureQualityScorer",
    "SeasonalAnomalyDetector",
]
