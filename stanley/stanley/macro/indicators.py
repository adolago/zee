"""
Economic Indicators Module

Defines standard economic indicators with their sources,
transformations, and metadata for consistent macro analysis.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class IndicatorCategory(Enum):
    """Categories of economic indicators."""

    OUTPUT = "output"  # GDP, industrial production
    INFLATION = "inflation"  # CPI, PPI, deflators
    EMPLOYMENT = "employment"  # Unemployment, labor force
    MONETARY = "monetary"  # Interest rates, money supply
    FISCAL = "fiscal"  # Government debt, deficit
    EXTERNAL = "external"  # Trade balance, current account
    FINANCIAL = "financial"  # Stock markets, credit
    SENTIMENT = "sentiment"  # PMI, consumer confidence
    HOUSING = "housing"  # Home prices, construction
    COMMODITIES = "commodities"  # Oil, metals, agriculture


class Frequency(Enum):
    """Data frequency."""

    DAILY = "D"
    WEEKLY = "W"
    MONTHLY = "M"
    QUARTERLY = "Q"
    ANNUAL = "A"


class Transformation(Enum):
    """Data transformation types."""

    LEVEL = "level"  # Raw level
    YOY = "yoy"  # Year-over-year change
    QOQ = "qoq"  # Quarter-over-quarter change
    MOM = "mom"  # Month-over-month change
    DIFF = "diff"  # First difference
    LOG = "log"  # Natural log
    LOG_DIFF = "log_diff"  # Log difference


@dataclass
class DataSource:
    """Specification for a data source."""

    provider: str
    dataset: str
    series_template: str  # Template with {country} placeholder
    frequency: Frequency = Frequency.MONTHLY
    notes: str = ""


@dataclass
class EconomicIndicator:
    """Definition of an economic indicator."""

    code: str
    name: str
    category: IndicatorCategory
    description: str
    unit: str
    sources: List[DataSource] = field(default_factory=list)
    default_transform: Transformation = Transformation.LEVEL
    seasonal_adjustment: bool = True
    countries: List[str] = field(default_factory=list)  # Empty = all
    tags: List[str] = field(default_factory=list)


# =============================================================================
# Indicator Registry
# =============================================================================

INDICATOR_REGISTRY: Dict[str, EconomicIndicator] = {}


def register_indicator(indicator: EconomicIndicator) -> EconomicIndicator:
    """Register an indicator in the global registry."""
    INDICATOR_REGISTRY[indicator.code] = indicator
    return indicator


# =============================================================================
# Output Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="GDP_REAL",
        name="Real GDP",
        category=IndicatorCategory.OUTPUT,
        description="Gross Domestic Product adjusted for inflation",
        unit="National Currency (Billions)",
        sources=[
            DataSource(
                provider="OECD",
                dataset="QNA",
                series_template="{country}.B1_GE.VOBARSA.Q",
                frequency=Frequency.QUARTERLY,
            ),
            DataSource(
                provider="IMF",
                dataset="WEO:latest",
                series_template="{country}.NGDP_R",
                frequency=Frequency.ANNUAL,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["growth", "output", "headline"],
    )
)

register_indicator(
    EconomicIndicator(
        code="GDP_NOMINAL",
        name="Nominal GDP",
        category=IndicatorCategory.OUTPUT,
        description="Gross Domestic Product at current prices",
        unit="National Currency (Billions)",
        sources=[
            DataSource(
                provider="OECD",
                dataset="QNA",
                series_template="{country}.B1_GE.CQRSA.Q",
                frequency=Frequency.QUARTERLY,
            ),
            DataSource(
                provider="IMF",
                dataset="WEO:latest",
                series_template="{country}.NGDP",
                frequency=Frequency.ANNUAL,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["growth", "output"],
    )
)

register_indicator(
    EconomicIndicator(
        code="INDUSTRIAL_PRODUCTION",
        name="Industrial Production",
        category=IndicatorCategory.OUTPUT,
        description="Index of industrial output",
        unit="Index (2015=100)",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.PRINTO01.IXOBSA.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["manufacturing", "output"],
    )
)

register_indicator(
    EconomicIndicator(
        code="CAPACITY_UTILIZATION",
        name="Capacity Utilization",
        category=IndicatorCategory.OUTPUT,
        description="Percentage of productive capacity in use",
        unit="Percent",
        sources=[
            DataSource(
                provider="FRED",
                dataset="TCU",
                series_template="TCU",
                frequency=Frequency.MONTHLY,
                notes="US only",
            ),
        ],
        default_transform=Transformation.LEVEL,
        countries=["USA"],
        tags=["manufacturing", "capacity"],
    )
)

# =============================================================================
# Inflation Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="CPI",
        name="Consumer Price Index",
        category=IndicatorCategory.INFLATION,
        description="Consumer price inflation",
        unit="Index",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.CPALTT01.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
            DataSource(
                provider="Eurostat",
                dataset="prc_hicp_manr",
                series_template="M.RCH_A.CP00.{country}",
                frequency=Frequency.MONTHLY,
                notes="EU countries only",
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["prices", "headline"],
    )
)

register_indicator(
    EconomicIndicator(
        code="CPI_CORE",
        name="Core CPI",
        category=IndicatorCategory.INFLATION,
        description="CPI excluding food and energy",
        unit="Index",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.CPGRLE01.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["prices", "core"],
    )
)

register_indicator(
    EconomicIndicator(
        code="PPI",
        name="Producer Price Index",
        category=IndicatorCategory.INFLATION,
        description="Producer/wholesale price inflation",
        unit="Index",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.PIEAMP01.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["prices", "producer"],
    )
)

register_indicator(
    EconomicIndicator(
        code="GDP_DEFLATOR",
        name="GDP Deflator",
        category=IndicatorCategory.INFLATION,
        description="Broad measure of price changes",
        unit="Index",
        sources=[
            DataSource(
                provider="IMF",
                dataset="WEO:latest",
                series_template="{country}.NGDP_D",
                frequency=Frequency.ANNUAL,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["prices", "gdp"],
    )
)

# =============================================================================
# Employment Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="UNEMPLOYMENT_RATE",
        name="Unemployment Rate",
        category=IndicatorCategory.EMPLOYMENT,
        description="Percentage of labor force unemployed",
        unit="Percent",
        sources=[
            DataSource(
                provider="OECD",
                dataset="STLABOUR",
                series_template="{country}.LRUNTTTT.STSA.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["labor", "headline"],
    )
)

register_indicator(
    EconomicIndicator(
        code="EMPLOYMENT",
        name="Total Employment",
        category=IndicatorCategory.EMPLOYMENT,
        description="Number of employed persons",
        unit="Thousands",
        sources=[
            DataSource(
                provider="OECD",
                dataset="STLABOUR",
                series_template="{country}.LFEMTTTT.STSA.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["labor", "employment"],
    )
)

register_indicator(
    EconomicIndicator(
        code="LABOR_FORCE_PARTICIPATION",
        name="Labor Force Participation Rate",
        category=IndicatorCategory.EMPLOYMENT,
        description="Percentage of working-age population in labor force",
        unit="Percent",
        sources=[
            DataSource(
                provider="OECD",
                dataset="STLABOUR",
                series_template="{country}.LFACTTTT.STSA.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["labor"],
    )
)

register_indicator(
    EconomicIndicator(
        code="WAGES",
        name="Average Wages",
        category=IndicatorCategory.EMPLOYMENT,
        description="Average hourly or weekly wages",
        unit="National Currency",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.LCEAMN01.IXOB.Q",
                frequency=Frequency.QUARTERLY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["labor", "wages"],
    )
)

# =============================================================================
# Monetary Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="POLICY_RATE",
        name="Central Bank Policy Rate",
        category=IndicatorCategory.MONETARY,
        description="Main policy interest rate",
        unit="Percent",
        sources=[
            DataSource(
                provider="BIS",
                dataset="WS_CBPOL_D",
                series_template="D.{country}..",
                frequency=Frequency.DAILY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["interest_rates", "central_bank"],
    )
)

register_indicator(
    EconomicIndicator(
        code="SHORT_RATE",
        name="Short-Term Interest Rate",
        category=IndicatorCategory.MONETARY,
        description="3-month money market rate",
        unit="Percent",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.IRSTCI01.ST.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["interest_rates"],
    )
)

register_indicator(
    EconomicIndicator(
        code="LONG_RATE",
        name="Long-Term Interest Rate",
        category=IndicatorCategory.MONETARY,
        description="10-year government bond yield",
        unit="Percent",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.IRLTLT01.ST.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["interest_rates", "bonds"],
    )
)

register_indicator(
    EconomicIndicator(
        code="M2",
        name="M2 Money Supply",
        category=IndicatorCategory.MONETARY,
        description="Broad money supply",
        unit="National Currency (Billions)",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI",
                series_template="{country}.MANM2.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["money_supply"],
    )
)

register_indicator(
    EconomicIndicator(
        code="CREDIT_PRIVATE",
        name="Private Credit",
        category=IndicatorCategory.MONETARY,
        description="Credit to private non-financial sector",
        unit="Percent of GDP",
        sources=[
            DataSource(
                provider="BIS",
                dataset="WS_CREDIT_GAP",
                series_template="{country}..",
                frequency=Frequency.QUARTERLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["credit"],
    )
)

# =============================================================================
# External Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="CURRENT_ACCOUNT",
        name="Current Account Balance",
        category=IndicatorCategory.EXTERNAL,
        description="Current account balance",
        unit="Percent of GDP",
        sources=[
            DataSource(
                provider="IMF",
                dataset="BOP",
                series_template="{country}.BCA..",
                frequency=Frequency.QUARTERLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["trade", "balance_of_payments"],
    )
)

register_indicator(
    EconomicIndicator(
        code="TRADE_BALANCE",
        name="Trade Balance",
        category=IndicatorCategory.EXTERNAL,
        description="Goods and services trade balance",
        unit="USD Millions",
        sources=[
            DataSource(
                provider="IMF",
                dataset="DOT",
                series_template="{country}..TMG_CIF_USD",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["trade"],
    )
)

register_indicator(
    EconomicIndicator(
        code="EXCHANGE_RATE",
        name="Exchange Rate",
        category=IndicatorCategory.EXTERNAL,
        description="Nominal effective exchange rate",
        unit="Index",
        sources=[
            DataSource(
                provider="BIS",
                dataset="WS_EER_D",
                series_template="D.N.{country}.",
                frequency=Frequency.DAILY,
            ),
        ],
        default_transform=Transformation.YOY,
        tags=["fx"],
    )
)

# =============================================================================
# Sentiment Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="PMI_MANUFACTURING",
        name="Manufacturing PMI",
        category=IndicatorCategory.SENTIMENT,
        description="Purchasing Managers Index for manufacturing",
        unit="Index (50=neutral)",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI_CLI",
                series_template="{country}.BSCICP03.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        seasonal_adjustment=False,
        tags=["survey", "manufacturing", "leading"],
    )
)

register_indicator(
    EconomicIndicator(
        code="CONSUMER_CONFIDENCE",
        name="Consumer Confidence",
        category=IndicatorCategory.SENTIMENT,
        description="Consumer confidence index",
        unit="Index",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI_CLI",
                series_template="{country}.CSCICP03.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        seasonal_adjustment=False,
        tags=["survey", "consumer", "leading"],
    )
)

register_indicator(
    EconomicIndicator(
        code="BUSINESS_CONFIDENCE",
        name="Business Confidence",
        category=IndicatorCategory.SENTIMENT,
        description="Business confidence index",
        unit="Index",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI_CLI",
                series_template="{country}.BSCICP02.IXOB.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        seasonal_adjustment=False,
        tags=["survey", "business", "leading"],
    )
)

register_indicator(
    EconomicIndicator(
        code="CLI",
        name="Composite Leading Indicator",
        category=IndicatorCategory.SENTIMENT,
        description="OECD Composite Leading Indicator",
        unit="Index (100=trend)",
        sources=[
            DataSource(
                provider="OECD",
                dataset="MEI_CLI",
                series_template="{country}.LOLITOAA.STSA.M",
                frequency=Frequency.MONTHLY,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["leading", "composite"],
    )
)

# =============================================================================
# Fiscal Indicators
# =============================================================================

register_indicator(
    EconomicIndicator(
        code="GOVT_DEBT",
        name="Government Debt",
        category=IndicatorCategory.FISCAL,
        description="General government gross debt",
        unit="Percent of GDP",
        sources=[
            DataSource(
                provider="IMF",
                dataset="WEO:latest",
                series_template="{country}.GGXWDG_NGDP",
                frequency=Frequency.ANNUAL,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["debt", "government"],
    )
)

register_indicator(
    EconomicIndicator(
        code="GOVT_DEFICIT",
        name="Government Deficit",
        category=IndicatorCategory.FISCAL,
        description="General government net lending/borrowing",
        unit="Percent of GDP",
        sources=[
            DataSource(
                provider="IMF",
                dataset="WEO:latest",
                series_template="{country}.GGXCNL_NGDP",
                frequency=Frequency.ANNUAL,
            ),
        ],
        default_transform=Transformation.LEVEL,
        tags=["deficit", "government"],
    )
)


# =============================================================================
# Helper Functions
# =============================================================================


def get_indicators_by_category(category: IndicatorCategory) -> List[EconomicIndicator]:
    """Get all indicators in a category."""
    return [i for i in INDICATOR_REGISTRY.values() if i.category == category]


def get_indicators_by_tag(tag: str) -> List[EconomicIndicator]:
    """Get all indicators with a specific tag."""
    return [i for i in INDICATOR_REGISTRY.values() if tag in i.tags]


def get_indicator(code: str) -> Optional[EconomicIndicator]:
    """Get indicator by code."""
    return INDICATOR_REGISTRY.get(code)


def list_indicators() -> List[str]:
    """List all indicator codes."""
    return list(INDICATOR_REGISTRY.keys())
