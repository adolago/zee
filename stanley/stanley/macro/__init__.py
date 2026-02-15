"""
Macro Module

Macroeconomic data analysis using DBnomics and other sources.
Provides access to GDP, inflation, employment, interest rates,
credit spreads, and other economic indicators from global statistical institutions.

Also includes cross-asset correlation analysis for regime detection,
NBER-style business cycle analysis, and credit spread monitoring.
"""

from .business_cycle import (
    BusinessCycleAnalyzer,
    CyclePhase,
    CycleState,
    GrowthInflationQuadrant,
    LEIComponent,
    TurningPoint,
)
from .credit_spreads import (
    CreditRegime,
    CreditSpreadMonitor,
    CreditState,
)
from .cross_asset import (
    CorrelationRegime,
    CrossAssetAnalyzer,
    CrossAssetState,
)
from .dbnomics_adapter import DBnomicsAdapter
from .indicators import (
    EconomicIndicator,
    IndicatorCategory,
    INDICATOR_REGISTRY,
)
from .macro_analyzer import MacroAnalyzer
from .volatility_regime import (
    VolatilityRegime,
    VolatilityRegimeDetector,
    VolatilityState,
    VIXTermStructure,
)

__all__ = [
    "BusinessCycleAnalyzer",
    "CorrelationRegime",
    "CreditRegime",
    "CreditSpreadMonitor",
    "CreditState",
    "CrossAssetAnalyzer",
    "CrossAssetState",
    "CyclePhase",
    "CycleState",
    "DBnomicsAdapter",
    "EconomicIndicator",
    "GrowthInflationQuadrant",
    "IndicatorCategory",
    "INDICATOR_REGISTRY",
    "LEIComponent",
    "MacroAnalyzer",
    "TurningPoint",
    "VIXTermStructure",
    "VolatilityRegime",
    "VolatilityRegimeDetector",
    "VolatilityState",
]
