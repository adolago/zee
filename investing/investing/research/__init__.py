"""
Research Module

Provides fundamental research tools including valuation analysis,
earnings analysis, and comprehensive company research reports.
"""

from .earnings import (
    EarningsAnalysis,
    EarningsQuarter,
    EstimateRevision,
    analyze_earnings_quality,
    analyze_estimate_revisions,
    calculate_beat_rate,
    calculate_cagr,
    calculate_earnings_consistency,
    calculate_earnings_surprise,
    calculate_growth_rate,
    project_future_earnings,
)
from .research_analyzer import ResearchAnalyzer, ResearchReport
from .valuation import (
    DCFResult,
    ValuationMetrics,
    calculate_dcf,
    calculate_dcf_sensitivity,
    calculate_valuation_multiples,
    compare_to_peers,
    estimate_fair_value_range,
)

__all__ = [
    # Main analyzer
    "ResearchAnalyzer",
    "ResearchReport",
    # Valuation
    "ValuationMetrics",
    "DCFResult",
    "calculate_dcf",
    "calculate_dcf_sensitivity",
    "calculate_valuation_multiples",
    "compare_to_peers",
    "estimate_fair_value_range",
    # Earnings
    "EarningsAnalysis",
    "EarningsQuarter",
    "EstimateRevision",
    "calculate_earnings_surprise",
    "calculate_growth_rate",
    "calculate_cagr",
    "analyze_earnings_quality",
    "calculate_earnings_consistency",
    "calculate_beat_rate",
    "analyze_estimate_revisions",
    "project_future_earnings",
]
