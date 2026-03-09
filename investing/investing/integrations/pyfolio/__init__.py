"""
Pyfolio Integration for Investing

Provides performance analysis and tear sheets:
- Return analysis and attribution
- Risk metrics and drawdown analysis
- Benchmark comparison
- Position analysis
"""

from .tearsheet import TearSheetGenerator, PerformanceTearSheet

__all__ = [
    "TearSheetGenerator",
    "PerformanceTearSheet",
]
