"""
Stanley Validation Module

Comprehensive input/output validation for the Stanley API,
including data quality checks, outlier detection, and validation middleware.
"""

from .models import (
    # Base validators
    StanleyBaseModel,
    # Symbol validation
    SymbolValidator,
    SymbolField,
    # Financial validators
    PositiveFloat,
    NonNegativeFloat,
    Percentage,
    PriceField,
    VolumeField,
    SharesField,
    RatioField,
    # Date validators
    DateRangeValidator,
    TradingDateField,
    # Request models
    ValidatedMoneyFlowRequest,
    ValidatedPortfolioRequest,
    ValidatedPortfolioHolding,
    ValidatedResearchRequest,
    ValidatedCommoditiesRequest,
    ValidatedOptionsRequest,
    # Response validators
    ValidatedMarketData,
    ValidatedPortfolioAnalytics,
    ValidatedValuationMetrics,
)

from .errors import (
    ValidationError,
    DataQualityError,
    OutlierError,
    SanityCheckError,
    TemporalValidationError,
    CrossFieldValidationError,
)

# NOTE: The following modules are planned but not yet implemented:
# - data_quality.py: Data quality checks and reporting
# - outliers.py: Outlier detection for financial data
# - sanity_checks.py: Sanity checks for calculated values
# - temporal.py: Temporal validation and market calendar
# - middleware.py: FastAPI validation middleware

__all__ = [
    # Models
    "StanleyBaseModel",
    "SymbolValidator",
    "SymbolField",
    "PositiveFloat",
    "NonNegativeFloat",
    "Percentage",
    "PriceField",
    "VolumeField",
    "SharesField",
    "RatioField",
    "DateRangeValidator",
    "TradingDateField",
    # Request models
    "ValidatedMoneyFlowRequest",
    "ValidatedPortfolioRequest",
    "ValidatedPortfolioHolding",
    "ValidatedResearchRequest",
    "ValidatedCommoditiesRequest",
    "ValidatedOptionsRequest",
    # Response validators
    "ValidatedMarketData",
    "ValidatedPortfolioAnalytics",
    "ValidatedValuationMetrics",
    # Errors
    "ValidationError",
    "DataQualityError",
    "OutlierError",
    "SanityCheckError",
    "TemporalValidationError",
    "CrossFieldValidationError",
]
