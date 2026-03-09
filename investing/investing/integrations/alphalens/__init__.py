"""
Alphalens Integration for Investing

Provides factor analysis capabilities:
- Information Coefficient (IC) analysis
- Factor returns and quantile analysis
- Turnover analysis
- Event studies
"""

from .analyzer import FactorAnalyzer, FactorAnalysisResult

__all__ = [
    "FactorAnalyzer",
    "FactorAnalysisResult",
]
