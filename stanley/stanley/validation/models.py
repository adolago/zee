"""
Pydantic Validation Models

Comprehensive Pydantic models with custom validators for Stanley API.
Includes request/response validation, custom field types, and cross-field validation.
"""

import re
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Dict, List, Optional, Union

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from .errors import (
    CrossFieldValidationError,
    RangeValidationError,
    SymbolValidationError,
)

# =============================================================================
# Custom Field Types with Annotated
# =============================================================================

# Positive float for prices, values, etc.
PositiveFloat = Annotated[
    float,
    Field(gt=0, description="Positive floating-point number"),
]

# Non-negative float for shares, weights, etc.
NonNegativeFloat = Annotated[
    float,
    Field(ge=0, description="Non-negative floating-point number"),
]

# Percentage field (0-100)
Percentage = Annotated[
    float,
    Field(ge=0, le=100, description="Percentage value between 0 and 100"),
]

# Price field with realistic bounds
PriceField = Annotated[
    float,
    Field(ge=0.0001, le=1_000_000, description="Stock price in reasonable range"),
]

# Volume field (must be positive integer)
VolumeField = Annotated[
    int,
    Field(ge=0, le=10_000_000_000, description="Trading volume"),
]

# Shares field (can be fractional for partial shares)
SharesField = Annotated[
    float,
    Field(ge=0, le=1_000_000_000, description="Number of shares"),
]

# Ratio field (typically small positive numbers)
RatioField = Annotated[
    float,
    Field(ge=-1000, le=1000, description="Financial ratio"),
]

# Trading date field
TradingDateField = Annotated[
    date,
    Field(description="Valid trading date"),
]


# =============================================================================
# Symbol Validator
# =============================================================================


class SymbolValidator:
    """Validator for stock/commodity symbols."""

    # Valid symbol patterns
    STOCK_PATTERN = re.compile(r"^[A-Z]{1,5}$")  # 1-5 uppercase letters
    ETF_PATTERN = re.compile(r"^[A-Z]{2,5}$")  # ETF tickers
    COMMODITY_PATTERN = re.compile(r"^[A-Z]{1,3}$")  # Commodity symbols (CL, GC, etc.)
    CRYPTO_PATTERN = re.compile(r"^[A-Z]{2,10}-USD$")  # Crypto with USD pair
    OPTION_PATTERN = re.compile(r"^[A-Z]{1,5}\d{6}[CP]\d{8}$")  # Options OCC format

    # Reserved/invalid symbols
    INVALID_SYMBOLS = {"TEST", "NULL", "NONE", "NA", "N/A", "UNDEFINED", "XXX"}

    @classmethod
    def validate(cls, symbol: str, symbol_type: str = "stock") -> str:
        """
        Validate a symbol.

        Args:
            symbol: The symbol to validate
            symbol_type: Type of symbol ('stock', 'etf', 'commodity', 'crypto', 'option')

        Returns:
            Validated, normalized symbol

        Raises:
            SymbolValidationError: If symbol is invalid
        """
        if not symbol:
            raise SymbolValidationError(
                symbol=symbol,
                reason="Symbol cannot be empty",
            )

        # Normalize to uppercase
        symbol = symbol.upper().strip()

        # Check for reserved/invalid symbols
        if symbol in cls.INVALID_SYMBOLS:
            raise SymbolValidationError(
                symbol=symbol,
                reason="Reserved or invalid symbol",
            )

        # Validate based on type
        if symbol_type == "stock":
            if not cls.STOCK_PATTERN.match(symbol):
                raise SymbolValidationError(
                    symbol=symbol,
                    reason="Stock symbols must be 1-5 uppercase letters",
                    suggestions=[s for s in ["AAPL", "MSFT", "GOOGL"] if s != symbol],
                )
        elif symbol_type == "etf":
            if not cls.ETF_PATTERN.match(symbol):
                raise SymbolValidationError(
                    symbol=symbol,
                    reason="ETF symbols must be 2-5 uppercase letters",
                    suggestions=["SPY", "QQQ", "IWM"],
                )
        elif symbol_type == "commodity":
            if not cls.COMMODITY_PATTERN.match(symbol):
                raise SymbolValidationError(
                    symbol=symbol,
                    reason="Commodity symbols must be 1-3 uppercase letters",
                    suggestions=["CL", "GC", "SI", "NG"],
                )
        elif symbol_type == "crypto":
            if not cls.CRYPTO_PATTERN.match(symbol):
                raise SymbolValidationError(
                    symbol=symbol,
                    reason="Crypto symbols must be in format XXX-USD",
                    suggestions=["BTC-USD", "ETH-USD"],
                )
        elif symbol_type == "option":
            if not cls.OPTION_PATTERN.match(symbol):
                raise SymbolValidationError(
                    symbol=symbol,
                    reason="Option symbols must be in OCC format",
                )

        return symbol


def SymbolField(
    symbol_type: str = "stock",
    **kwargs,
) -> Any:
    """Create a symbol field with validation."""
    description = kwargs.pop("description", f"Valid {symbol_type} symbol")

    return Field(
        min_length=1,
        max_length=20,
        description=description,
        **kwargs,
    )


# =============================================================================
# Date Range Validator
# =============================================================================


class DateRangeValidator:
    """Validator for date ranges in API requests."""

    MAX_RANGE_DAYS = 3650  # 10 years max
    MIN_DATE = date(1990, 1, 1)  # No data before 1990

    @classmethod
    def validate(
        cls,
        start_date: date,
        end_date: date,
        max_range_days: Optional[int] = None,
    ) -> tuple[date, date]:
        """
        Validate a date range.

        Args:
            start_date: Start date
            end_date: End date
            max_range_days: Maximum allowed days in range

        Returns:
            Tuple of validated (start_date, end_date)

        Raises:
            RangeValidationError: If date range is invalid
        """
        max_days = max_range_days or cls.MAX_RANGE_DAYS

        # Check start date bounds
        if start_date < cls.MIN_DATE:
            raise RangeValidationError(
                field="start_date",
                value=start_date,
                min_value=cls.MIN_DATE,
            )

        # Check end date is not in future
        today = date.today()
        if end_date > today:
            end_date = today

        # Check start before end
        if start_date > end_date:
            raise CrossFieldValidationError(
                message="Start date must be before end date",
                fields=["start_date", "end_date"],
                values={"start_date": start_date, "end_date": end_date},
                constraint="start_date <= end_date",
            )

        # Check range not too large
        range_days = (end_date - start_date).days
        if range_days > max_days:
            raise RangeValidationError(
                field="date_range",
                value=range_days,
                max_value=max_days,
            )

        return start_date, end_date


# =============================================================================
# Base Model with Enhanced Configuration
# =============================================================================


class StanleyBaseModel(BaseModel):
    """Base Pydantic model for all Stanley API models."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid",  # Reject extra fields
        populate_by_name=True,  # Allow both snake_case and camelCase
        json_schema_extra={
            "examples": [],
        },
    )

    def to_api_response(self) -> Dict[str, Any]:
        """Convert model to API response format (camelCase)."""
        return self.model_dump(by_alias=True, exclude_none=True)


# =============================================================================
# Request Validation Models
# =============================================================================


class ValidatedPortfolioHolding(StanleyBaseModel):
    """Validated portfolio holding with comprehensive checks."""

    symbol: str = SymbolField(symbol_type="stock")
    shares: SharesField
    average_cost: Optional[NonNegativeFloat] = Field(
        default=None,
        alias="averageCost",
        description="Average cost per share",
    )

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, v: str) -> str:
        """Validate stock symbol format."""
        return SymbolValidator.validate(v, symbol_type="stock")

    @field_validator("shares")
    @classmethod
    def validate_shares_positive(cls, v: float) -> float:
        """Ensure shares is positive for valid holdings."""
        if v <= 0:
            raise ValueError("Shares must be positive")
        return v


class ValidatedPortfolioRequest(StanleyBaseModel):
    """Validated portfolio analytics request."""

    holdings: List[ValidatedPortfolioHolding] = Field(
        min_length=1,
        max_length=500,
        description="Portfolio holdings (max 500)",
    )
    benchmark: str = Field(
        default="SPY",
        description="Benchmark symbol for comparison",
    )
    lookback_days: int = Field(
        default=252,
        ge=20,
        le=1260,
        alias="lookbackDays",
        description="Lookback period in trading days (20-1260)",
    )

    @field_validator("benchmark")
    @classmethod
    def validate_benchmark(cls, v: str) -> str:
        """Validate benchmark symbol."""
        return SymbolValidator.validate(v, symbol_type="etf")

    @model_validator(mode="after")
    def validate_portfolio(self) -> "ValidatedPortfolioRequest":
        """Cross-field validation for portfolio."""
        # Check for duplicate symbols
        symbols = [h.symbol for h in self.holdings]
        if len(symbols) != len(set(symbols)):
            duplicates = [s for s in symbols if symbols.count(s) > 1]
            raise CrossFieldValidationError(
                message=f"Duplicate symbols in portfolio: {set(duplicates)}",
                fields=["holdings"],
                values={"duplicates": list(set(duplicates))},
                constraint="unique_symbols",
            )

        # Check total weight doesn't exceed reasonable bounds
        # (weights will be calculated, but we can check share counts)
        total_shares = sum(h.shares for h in self.holdings)
        if total_shares > 1_000_000_000:
            raise RangeValidationError(
                field="total_shares",
                value=total_shares,
                max_value=1_000_000_000,
            )

        return self


class ValidatedMoneyFlowRequest(StanleyBaseModel):
    """Validated money flow analysis request."""

    sectors: List[str] = Field(
        min_length=1,
        max_length=50,
        description="Sector ETF symbols to analyze",
    )
    lookback_days: int = Field(
        default=63,
        ge=1,
        le=365,
        alias="lookbackDays",
        description="Lookback period in days",
    )

    @field_validator("sectors")
    @classmethod
    def validate_sectors(cls, v: List[str]) -> List[str]:
        """Validate sector symbols."""
        validated = []
        for sector in v:
            validated.append(SymbolValidator.validate(sector, symbol_type="etf"))
        return validated


class ValidatedResearchRequest(StanleyBaseModel):
    """Validated research analysis request."""

    symbol: str = SymbolField(symbol_type="stock")
    include_dcf: bool = Field(
        default=True,
        alias="includeDcf",
        description="Include DCF valuation analysis",
    )
    include_peers: bool = Field(
        default=True,
        alias="includePeers",
        description="Include peer comparison",
    )
    quarters: int = Field(
        default=12,
        ge=4,
        le=40,
        description="Number of quarters for earnings history",
    )

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, v: str) -> str:
        """Validate stock symbol."""
        return SymbolValidator.validate(v, symbol_type="stock")


class ValidatedCommoditiesRequest(StanleyBaseModel):
    """Validated commodities analysis request."""

    symbols: Optional[List[str]] = Field(
        default=None,
        max_length=30,
        description="Commodity symbols (all if not specified)",
    )
    lookback_days: int = Field(
        default=252,
        ge=20,
        le=1260,
        alias="lookbackDays",
        description="Lookback period in trading days",
    )
    include_correlations: bool = Field(
        default=True,
        alias="includeCorrelations",
        description="Include correlation matrix",
    )

    @field_validator("symbols")
    @classmethod
    def validate_symbols(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        """Validate commodity symbols."""
        if v is None:
            return None
        validated = []
        for symbol in v:
            validated.append(SymbolValidator.validate(symbol, symbol_type="commodity"))
        return validated


class ValidatedOptionsRequest(StanleyBaseModel):
    """Validated options flow request."""

    symbol: str = SymbolField(symbol_type="stock")
    lookback_days: int = Field(
        default=5,
        ge=1,
        le=30,
        alias="lookbackDays",
        description="Lookback period for options analysis",
    )
    min_premium: float = Field(
        default=0,
        ge=0,
        alias="minPremium",
        description="Minimum premium filter",
    )
    include_gamma: bool = Field(
        default=True,
        alias="includeGamma",
        description="Include gamma exposure analysis",
    )

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, v: str) -> str:
        """Validate stock symbol."""
        return SymbolValidator.validate(v, symbol_type="stock")


# =============================================================================
# Response Validation Models
# =============================================================================


class ValidatedMarketData(StanleyBaseModel):
    """Validated market data response."""

    symbol: str
    price: PriceField
    change: float = Field(ge=-99999, le=99999)
    change_percent: float = Field(
        ge=-100,
        le=10000,  # Allow for extreme moves
        alias="changePercent",
    )
    volume: VolumeField
    market_cap: Optional[float] = Field(
        default=None,
        ge=0,
        alias="marketCap",
    )
    timestamp: str

    @model_validator(mode="after")
    def validate_market_data(self) -> "ValidatedMarketData":
        """Cross-field validation for market data."""
        # Verify change_percent is consistent with change and price
        if self.price > 0 and self.change != 0:
            expected_pct = (self.change / (self.price - self.change)) * 100
            # Allow 0.1% tolerance for rounding
            if abs(self.change_percent - expected_pct) > 0.1:
                # Log warning but don't fail - data might be from different sources
                pass

        return self


class ValidatedPortfolioAnalytics(StanleyBaseModel):
    """Validated portfolio analytics response."""

    total_value: NonNegativeFloat = Field(alias="totalValue")
    total_return: float = Field(alias="totalReturn")
    total_return_percent: float = Field(
        ge=-100,
        le=100000,
        alias="totalReturnPercent",
    )
    beta: float = Field(ge=-10, le=10)
    var_95: NonNegativeFloat = Field(alias="var95")
    var_99: NonNegativeFloat = Field(alias="var99")
    sector_exposure: Dict[str, float] = Field(alias="sectorExposure")
    top_holdings: List[Dict[str, Any]] = Field(alias="topHoldings")

    @model_validator(mode="after")
    def validate_analytics(self) -> "ValidatedPortfolioAnalytics":
        """Cross-field validation for analytics."""
        # VaR 99 should be >= VaR 95
        if self.var_99 < self.var_95:
            raise CrossFieldValidationError(
                message="VaR 99% should be greater than or equal to VaR 95%",
                fields=["var_95", "var_99"],
                values={"var_95": self.var_95, "var_99": self.var_99},
                constraint="var_99 >= var_95",
            )

        # Sector exposure should sum to approximately 100%
        total_exposure = sum(self.sector_exposure.values())
        if abs(total_exposure - 100) > 1:  # 1% tolerance
            raise CrossFieldValidationError(
                message=f"Sector exposure should sum to 100%, got {total_exposure}%",
                fields=["sector_exposure"],
                values={"total": total_exposure},
                constraint="sum(sector_exposure) = 100",
            )

        return self


class ValidatedValuationMetrics(StanleyBaseModel):
    """Validated valuation metrics response."""

    symbol: str
    price: PriceField
    market_cap: NonNegativeFloat = Field(alias="marketCap")
    enterprise_value: float = Field(alias="enterpriseValue")  # Can be negative

    # Ratios with infinity handling
    pe_ratio: Optional[float] = Field(default=None, alias="peRatio")
    forward_pe: Optional[float] = Field(default=None, alias="forwardPe")
    peg_ratio: Optional[float] = Field(default=None, alias="pegRatio")
    price_to_sales: Optional[float] = Field(default=None, alias="priceToSales")
    ev_to_ebitda: Optional[float] = Field(default=None, alias="evToEbitda")
    price_to_book: Optional[float] = Field(default=None, alias="priceToBook")

    # Yields
    earnings_yield: float = Field(ge=-100, le=100, alias="earningsYield")
    fcf_yield: float = Field(ge=-100, le=100, alias="fcfYield")
    dividend_yield: float = Field(ge=0, le=50, alias="dividendYield")

    @field_validator(
        "pe_ratio",
        "forward_pe",
        "peg_ratio",
        "price_to_sales",
        "ev_to_ebitda",
        "price_to_book",
    )
    @classmethod
    def validate_ratio_bounds(cls, v: Optional[float]) -> Optional[float]:
        """Validate ratio is within reasonable bounds or None for infinity."""
        if v is None:
            return None
        if v == float("inf") or v > 1000:
            return None  # Convert infinity to None for JSON
        if v == float("-inf") or v < -1000:
            return None
        return v

    @model_validator(mode="after")
    def validate_valuation_metrics(self) -> "ValidatedValuationMetrics":
        """Cross-field validation for valuation."""
        # Enterprise value should be reasonable relative to market cap
        if self.market_cap > 0:
            ev_mc_ratio = self.enterprise_value / self.market_cap
            if ev_mc_ratio < -1 or ev_mc_ratio > 10:
                # Log warning for extreme EV/MC ratios
                pass

        return self
