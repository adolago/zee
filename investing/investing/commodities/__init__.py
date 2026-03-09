"""
Commodities Module

Provides commodity price data, analysis, and macro linkage
for institutional investment research.
"""

from .commodities_analyzer import (
    CommoditiesAnalyzer,
    CommoditySummary,
    MacroLinkage,
)
from .price_data import (
    COMMODITY_REGISTRY,
    Commodity,
    CommodityCategory,
    CommodityPrice,
    CommodityPriceProvider,
    get_commodities_by_category,
    get_commodity,
    list_all_commodities,
)

__all__ = [
    # Main analyzer
    "CommoditiesAnalyzer",
    "CommoditySummary",
    "MacroLinkage",
    # Price data
    "CommodityPriceProvider",
    "CommodityPrice",
    "Commodity",
    "CommodityCategory",
    "COMMODITY_REGISTRY",
    "get_commodity",
    "get_commodities_by_category",
    "list_all_commodities",
]
