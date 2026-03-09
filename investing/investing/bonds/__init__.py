"""
Investing Bonds Module

Provides fixed income analytics for government, corporate, and municipal bonds.
Uses Terrapin Finance API for bond data.

Example usage:
    from investing.bonds import BondAnalyzer, BondScreener
    from investing.data.providers.terrapin_provider import TerrapinProvider

    # Initialize provider
    provider = TerrapinProvider(api_key="your_key")
    await provider.initialize()

    # Create analyzer
    analyzer = BondAnalyzer(provider)

    # Get yield curve
    curve = await analyzer.get_yield_curve("US")

    # Search municipal bonds
    screener = BondScreener(provider)
    results = await screener.screen(
        states=["CA", "NY"],
        min_yield=4.0,
        tax_exempt_only=True,
    )
"""

from .analyzer import BondAnalyzer
from .models import (
    BondPricing,
    BondReference,
    BondScreenRequest,
    BondScreenResponse,
    BondSummary,
    BondType,
    CallDate,
    CreditSpreadAnalysis,
    DivergenceSignal,
    InterestType,
    MuniBondReference,
    RatingCategory,
    SinkingFundPayment,
    TaxStatus,
    YieldCurve,
    YieldCurvePoint,
)
from .screener import BondScreener

__all__ = [
    # Analyzers
    "BondAnalyzer",
    "BondScreener",
    # Models
    "BondType",
    "InterestType",
    "RatingCategory",
    "TaxStatus",
    "CallDate",
    "SinkingFundPayment",
    "BondReference",
    "MuniBondReference",
    "BondPricing",
    "BondSummary",
    "CreditSpreadAnalysis",
    "YieldCurvePoint",
    "YieldCurve",
    "BondScreenRequest",
    "BondScreenResponse",
    "DivergenceSignal",
]
