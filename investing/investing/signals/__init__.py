"""
Signals Module

Provides signal generation, backtesting, and performance tracking
for institutional investment analysis.
"""

from .backtester import (
    AttributionAnalysis,
    BacktestConfig,
    BacktestResult,
    Backtester,
    PerformanceMetrics,
    SignalBacktester,
    Trade,
    TradeResult,
)
from .performance_tracker import (
    OutcomeRecord,
    PerformanceStats,
    PerformanceTracker,
    SignalRecord,
    TrackingPeriod,
    TradeOutcome,
    TradeRecord,
)
from .signal_generator import (
    CompositeSignal,
    Signal,
    SignalGenerator,
    SignalStrength,
    SignalType,
)

__all__ = [
    # Signal generation
    "SignalType",
    "SignalStrength",
    "Signal",
    "CompositeSignal",
    "SignalGenerator",
    # Backtesting
    "BacktestConfig",
    "BacktestResult",
    "TradeResult",
    "Trade",
    "SignalBacktester",
    "Backtester",
    "PerformanceMetrics",
    "AttributionAnalysis",
    # Performance tracking
    "TradeRecord",
    "TradeOutcome",
    "PerformanceStats",
    "PerformanceTracker",
    "SignalRecord",
    "OutcomeRecord",
    "TrackingPeriod",
]
