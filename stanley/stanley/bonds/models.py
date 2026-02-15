"""
Bond Module Data Models

Pydantic models for fixed income analytics.
"""

from datetime import date as DateType, datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class BondType(str, Enum):
    """Type of bond."""

    GOVERNMENT = "government"
    CORPORATE = "corporate"
    MUNICIPAL = "municipal"


class InterestType(str, Enum):
    """Type of interest payment."""

    FIXED = "fixed rate"
    FLOATING = "floating"
    ZERO_COUPON = "zero coupon"


class RatingCategory(str, Enum):
    """Credit rating category."""

    INVESTMENT_GRADE = "investment_grade"
    HIGH_YIELD = "high_yield"
    NOT_RATED = "not_rated"


class TaxStatus(str, Enum):
    """Tax status for municipal bonds."""

    TAX_EXEMPT = "tax_exempt"
    TAXABLE = "taxable"
    AMT = "amt"  # Alternative Minimum Tax


class CallDate(BaseModel):
    """Call schedule entry."""

    call_date: DateType = Field(..., description="Date the bond can be called")
    call_price: float = Field(..., description="Price at which bond can be called")
    call_type: str = Field(
        "optional", description="Type of call (optional, mandatory, etc.)"
    )


class SinkingFundPayment(BaseModel):
    """Sinking fund schedule entry."""

    payment_date: DateType = Field(..., description="Date of sinking fund payment")
    amount: float = Field(..., description="Payment amount")


class BondReference(BaseModel):
    """Reference data for a government or corporate bond."""

    isin: str = Field(..., description="International Securities Identification Number")
    name: str = Field(..., description="Bond name/description")
    issuer_name: str = Field(..., description="Name of the issuing entity")
    issuer_type: str = Field(..., description="Type of issuer (government, corporate)")
    country_code: str = Field(..., description="Country of issue (ISO 3166-1 alpha-2)")
    currency: str = Field(..., description="Currency (ISO 4217)")
    coupon: float = Field(..., description="Coupon rate (e.g., 1.875 for 1.875%)")
    coupon_frequency: int = Field(..., description="Coupon payments per year")
    interest_type: str = Field(
        ..., description="Interest type (fixed rate, floating, etc.)"
    )
    issue_date: DateType = Field(..., description="Issue date")
    maturity_date: DateType = Field(..., description="Maturity date")
    issued_amount: float = Field(..., description="Total amount issued")
    is_callable: bool = Field(False, description="Whether bond is callable")
    is_inflation_linked: bool = Field(
        False, description="Whether bond is inflation-linked"
    )
    rating_composite: Optional[str] = Field(None, description="Composite credit rating")
    rating_issuer: Optional[str] = Field(None, description="Issuer credit rating")
    sector: Optional[str] = Field(None, description="Sector (for corporates)")
    lei: Optional[str] = Field(None, description="Legal Entity Identifier")
    figi: Optional[str] = Field(
        None, description="Financial Instrument Global Identifier"
    )
    ticker: Optional[str] = Field(None, description="Bond ticker symbol")

    @property
    def bond_type(self) -> BondType:
        """Get the bond type."""
        if self.issuer_type == "government":
            return BondType.GOVERNMENT
        return BondType.CORPORATE

    @property
    def years_to_maturity(self) -> float:
        """Calculate years to maturity from today."""
        today = DateType.today()
        delta = self.maturity_date - today
        return delta.days / 365.25


class MuniBondReference(BondReference):
    """Reference data for a US municipal bond."""

    state: str = Field(..., description="US state (two-letter code)")
    tax_status: str = Field(..., description="Tax status (tax_exempt, taxable, amt)")
    use_of_proceeds: Optional[str] = Field(None, description="Use of proceeds category")
    is_insured: bool = Field(False, description="Whether bond is insured")
    call_schedule: list[CallDate] = Field(
        default_factory=list, description="Call schedule"
    )
    sinking_fund_schedule: list[SinkingFundPayment] = Field(
        default_factory=list, description="Sinking fund schedule"
    )
    security_type: Optional[str] = Field(None, description="Security type")
    source_of_repayment: Optional[str] = Field(None, description="Source of repayment")

    @property
    def bond_type(self) -> BondType:
        return BondType.MUNICIPAL


class BondPricing(BaseModel):
    """Pricing data for a bond."""

    isin: str = Field(..., description="Bond ISIN")
    date: DateType = Field(..., description="Pricing date")
    price: float = Field(..., description="Clean price (percentage of par)")
    yield_to_maturity: float = Field(..., description="Yield to maturity (percentage)")
    yield_to_worst: Optional[float] = Field(
        None, description="Yield to worst (percentage)"
    )
    spread_to_benchmark: Optional[float] = Field(
        None, description="Spread to benchmark (basis points)"
    )
    duration: Optional[float] = Field(None, description="Modified duration (years)")
    convexity: Optional[float] = Field(None, description="Convexity")
    accrued_interest: Optional[float] = Field(None, description="Accrued interest")


class BondSummary(BaseModel):
    """Summary data for bond search results."""

    isin: str = Field(..., description="Bond ISIN")
    name: Optional[str] = Field(None, description="Bond name")
    issuer_name: Optional[str] = Field(None, description="Issuer name")
    coupon: float = Field(..., description="Coupon rate")
    maturity_date: DateType = Field(..., description="Maturity date")
    interest_type: str = Field(..., description="Interest type")
    is_callable: bool = Field(False, description="Whether callable")
    rating: Optional[str] = Field(None, description="Rating category")
    ticker: Optional[str] = Field(None, description="Ticker symbol")
    # Municipal-specific
    state: Optional[str] = Field(None, description="State (for munis)")


class CreditSpreadAnalysis(BaseModel):
    """Credit spread analysis for a company."""

    symbol: str = Field(..., description="Stock ticker symbol")
    company_name: Optional[str] = Field(None, description="Company name")
    bonds_outstanding: int = Field(0, description="Number of bonds outstanding")
    average_spread_bps: Optional[float] = Field(
        None, description="Average spread to benchmark (basis points)"
    )
    min_spread_bps: Optional[float] = Field(None, description="Minimum spread")
    max_spread_bps: Optional[float] = Field(None, description="Maximum spread")
    average_ytm: Optional[float] = Field(None, description="Average yield to maturity")
    average_duration: Optional[float] = Field(None, description="Average duration")
    total_debt_outstanding: Optional[float] = Field(
        None, description="Total debt outstanding"
    )
    analysis_date: DateType = Field(
        default_factory=DateType.today, description="Analysis date"
    )


class YieldCurvePoint(BaseModel):
    """A single point on the yield curve."""

    tenor: str = Field(..., description="Tenor label (e.g., '1M', '2Y', '10Y')")
    years: float = Field(..., description="Years to maturity")
    yield_pct: float = Field(..., description="Yield percentage")


class YieldCurve(BaseModel):
    """Yield curve data."""

    country: str = Field(..., description="Country code")
    curve_date: DateType = Field(..., description="Curve date")
    currency: str = Field(..., description="Currency")
    points: list[YieldCurvePoint] = Field(..., description="Yield curve points")

    @property
    def slope_2y_10y(self) -> Optional[float]:
        """Calculate 2Y-10Y spread (common slope measure)."""
        y2 = next((p.yield_pct for p in self.points if "2Y" in p.tenor), None)
        y10 = next((p.yield_pct for p in self.points if "10Y" in p.tenor), None)

        if y2 is not None and y10 is not None:
            return (y10 - y2) * 100  # In basis points
        return None


class BondScreenRequest(BaseModel):
    """Request for bond screening."""

    bond_type: Optional[BondType] = Field(None, description="Filter by bond type")
    min_yield: Optional[float] = Field(None, description="Minimum yield")
    max_yield: Optional[float] = Field(None, description="Maximum yield")
    min_coupon: Optional[float] = Field(None, description="Minimum coupon")
    max_coupon: Optional[float] = Field(None, description="Maximum coupon")
    min_rating: Optional[str] = Field(None, description="Minimum rating")
    maturity_min: Optional[DateType] = Field(None, description="Minimum maturity date")
    maturity_max: Optional[DateType] = Field(None, description="Maximum maturity date")
    countries: Optional[list[str]] = Field(None, description="Filter by countries")
    currencies: Optional[list[str]] = Field(None, description="Filter by currencies")
    sectors: Optional[list[str]] = Field(
        None, description="Filter by sectors (corporates)"
    )
    # Municipal-specific
    states: Optional[list[str]] = Field(None, description="Filter by states (munis)")
    tax_exempt_only: bool = Field(False, description="Only tax-exempt munis")
    insured_only: bool = Field(False, description="Only insured munis")
    # Pagination
    limit: int = Field(50, ge=1, le=500, description="Maximum results")
    offset: int = Field(0, ge=0, description="Results offset")


class BondScreenResponse(BaseModel):
    """Response from bond screening."""

    bonds: list[BondSummary] = Field(..., description="Matching bonds")
    total: int = Field(..., description="Total matching bonds")
    filters_applied: dict[str, Any] = Field(
        ..., description="Filters that were applied"
    )


class DivergenceSignal(BaseModel):
    """Equity-credit divergence signal."""

    symbol: str = Field(..., description="Stock ticker")
    signal_type: str = Field(..., description="bullish, bearish, neutral")
    signal_strength: float = Field(..., ge=0, le=1, description="Signal strength (0-1)")
    equity_return_30d: Optional[float] = Field(None, description="30-day equity return")
    spread_change_30d: Optional[float] = Field(
        None, description="30-day spread change (bps)"
    )
    analysis: str = Field(..., description="Signal analysis text")
    generated_at: datetime = Field(
        default_factory=datetime.now, description="Signal timestamp"
    )
