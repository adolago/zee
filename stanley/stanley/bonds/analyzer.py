"""
Bond Analyzer Module

Core analytics for fixed income analysis.
Provides yield curves, credit spreads, and company bond lookup.
"""

import logging
from datetime import date, timedelta
from typing import Optional

import pandas as pd

from stanley.data.providers.terrapin_provider import (
    BondSearchFilters,
    MuniSearchFilters,
    TerrapinProvider,
)

from .models import (
    BondPricing,
    BondReference,
    BondSummary,
    BondType,
    CreditSpreadAnalysis,
    MuniBondReference,
    YieldCurve,
    YieldCurvePoint,
)

logger = logging.getLogger(__name__)


class BondAnalyzer:
    """
    Fixed income analytics for Stanley.

    Provides:
    - Bond reference data lookup
    - Yield curve construction
    - Credit spread analysis
    - Company bond lookup
    - Municipal bond analysis

    Example usage:
        analyzer = BondAnalyzer(terrapin_provider)

        # Get yield curve
        curve = await analyzer.get_yield_curve("US")

        # Get company bonds
        bonds = await analyzer.get_company_bonds("AAPL")

        # Credit spread analysis
        spread = await analyzer.get_company_credit_spread("AAPL")
    """

    # Standard tenor points for yield curves
    STANDARD_TENORS = [
        ("1M", 1 / 12),
        ("3M", 0.25),
        ("6M", 0.5),
        ("1Y", 1.0),
        ("2Y", 2.0),
        ("3Y", 3.0),
        ("5Y", 5.0),
        ("7Y", 7.0),
        ("10Y", 10.0),
        ("20Y", 20.0),
        ("30Y", 30.0),
    ]

    def __init__(self, provider: TerrapinProvider):
        """
        Initialize the bond analyzer.

        Args:
            provider: Terrapin provider for bond data
        """
        self.provider = provider

    # ========================================================================
    # Reference Data
    # ========================================================================

    async def get_bond(self, isin: str) -> Optional[BondReference]:
        """
        Get reference data for a single bond.

        Args:
            isin: Bond ISIN

        Returns:
            BondReference or None if not found
        """
        data = await self.provider.get_bond_reference([isin])
        if not data:
            return None

        return self._parse_bond_reference(data[0])

    async def get_bonds(self, isins: list[str]) -> list[BondReference]:
        """
        Get reference data for multiple bonds.

        Args:
            isins: List of ISINs

        Returns:
            List of BondReference objects
        """
        data = await self.provider.get_bond_reference(isins)
        return [self._parse_bond_reference(b) for b in data]

    async def get_muni_bond(self, isin: str) -> Optional[MuniBondReference]:
        """
        Get reference data for a municipal bond.

        Args:
            isin: Bond ISIN

        Returns:
            MuniBondReference or None if not found
        """
        data = await self.provider.get_muni_reference([isin])
        if not data:
            return None

        return self._parse_muni_reference(data[0])

    # ========================================================================
    # Yield Analysis
    # ========================================================================

    async def get_yield_curve(
        self,
        country: str = "US",
        as_of_date: Optional[date] = None,
    ) -> YieldCurve:
        """
        Get the sovereign yield curve for a country.

        Args:
            country: Country code (US, GB, DE, etc.)
            as_of_date: Date for the curve (defaults to today)

        Returns:
            YieldCurve with standard tenor points
        """
        curve_date = as_of_date or date.today()

        # Search for government bonds for this country
        results = await self.provider.search_bonds(
            BondSearchFilters(
                issuer_types=["government"],
                countries=[country],
                interest_types=["fixed rate"],
                maturity_date_min=curve_date,
                limit=200,
            )
        )

        if not results:
            logger.warning(f"No government bonds found for {country}")
            return YieldCurve(
                country=country,
                curve_date=curve_date,
                currency="USD" if country == "US" else country,
                points=[],
            )

        # Get pricing for these bonds
        isins = [b["isin"] for b in results if "isin" in b]
        pricing_df = await self.provider.get_bond_pricing(isins)

        if pricing_df.empty:
            logger.warning(f"No pricing data for {country} government bonds")
            return YieldCurve(
                country=country,
                curve_date=curve_date,
                currency="USD" if country == "US" else country,
                points=[],
            )

        # Build yield curve by matching to standard tenors
        points = []
        for tenor_label, tenor_years in self.STANDARD_TENORS:
            target_maturity = curve_date + timedelta(days=int(tenor_years * 365.25))

            # Find bonds maturing close to this tenor
            matching = [
                b
                for b in results
                if b.get("maturity_date")
                and abs((date.fromisoformat(b["maturity_date"]) - target_maturity).days)
                < 90
            ]

            if matching:
                # Get the closest match
                closest = min(
                    matching,
                    key=lambda b: abs(
                        (date.fromisoformat(b["maturity_date"]) - target_maturity).days
                    ),
                )

                # Find yield from pricing data
                bond_pricing = pricing_df[pricing_df["isin"] == closest["isin"]]
                if not bond_pricing.empty:
                    ytm = bond_pricing["yield_to_maturity"].iloc[-1]
                    points.append(
                        YieldCurvePoint(
                            tenor=tenor_label,
                            years=tenor_years,
                            yield_pct=ytm,
                        )
                    )

        return YieldCurve(
            country=country,
            curve_date=curve_date,
            currency="USD" if country == "US" else country,
            points=points,
        )

    async def get_credit_spreads(
        self,
        rating: str,
        sector: Optional[str] = None,
    ) -> pd.DataFrame:
        """
        Get average credit spreads for a rating category.

        Args:
            rating: Rating category (e.g., "A", "BBB", "BB")
            sector: Optional sector filter

        Returns:
            DataFrame with spread data by tenor
        """
        # Search for corporate bonds with this rating
        filters = BondSearchFilters(
            issuer_types=["corporate"],
            ratings=[rating],
            interest_types=["fixed rate"],
            limit=200,
        )

        results = await self.provider.search_bonds(filters)

        if not results:
            return pd.DataFrame()

        # Get pricing
        isins = [b["isin"] for b in results if "isin" in b]
        pricing_df = await self.provider.get_bond_pricing(isins)

        if pricing_df.empty or "spread_to_benchmark" not in pricing_df.columns:
            return pd.DataFrame()

        return pricing_df[["isin", "date", "spread_to_benchmark", "yield_to_maturity"]]

    # ========================================================================
    # Corporate Bond Analysis
    # ========================================================================

    async def get_company_bonds(
        self,
        symbol: str,
        lei: Optional[str] = None,
    ) -> list[BondReference]:
        """
        Get all outstanding bonds for a company.

        Args:
            symbol: Stock ticker symbol
            lei: Legal Entity Identifier (more reliable if known)

        Returns:
            List of company bonds
        """
        # Note: Terrapin API may not have direct ticker/symbol lookup
        # This would typically require a mapping from ticker to LEI
        # For now, we return empty list if LEI is not provided
        if not lei:
            logger.warning(
                f"LEI required for company bond lookup. Ticker {symbol} cannot be resolved."
            )
            return []

        # Search by issuer LEI would require Terrapin to support this
        # This is a placeholder for when that capability exists
        return []

    async def get_company_credit_spread(
        self,
        symbol: str,
        lei: Optional[str] = None,
    ) -> CreditSpreadAnalysis:
        """
        Get credit spread analysis for a company.

        Args:
            symbol: Stock ticker symbol
            lei: Legal Entity Identifier

        Returns:
            Credit spread analysis
        """
        bonds = await self.get_company_bonds(symbol, lei)

        if not bonds:
            return CreditSpreadAnalysis(
                symbol=symbol,
                bonds_outstanding=0,
            )

        # Get pricing for company bonds
        isins = [b.isin for b in bonds]
        pricing_df = await self.provider.get_bond_pricing(isins)

        if pricing_df.empty:
            return CreditSpreadAnalysis(
                symbol=symbol,
                bonds_outstanding=len(bonds),
            )

        # Calculate aggregate metrics
        spreads = pricing_df["spread_to_benchmark"].dropna()
        ytms = pricing_df["yield_to_maturity"].dropna()

        return CreditSpreadAnalysis(
            symbol=symbol,
            company_name=bonds[0].issuer_name if bonds else None,
            bonds_outstanding=len(bonds),
            average_spread_bps=spreads.mean() if not spreads.empty else None,
            min_spread_bps=spreads.min() if not spreads.empty else None,
            max_spread_bps=spreads.max() if not spreads.empty else None,
            average_ytm=ytms.mean() if not ytms.empty else None,
            total_debt_outstanding=sum(b.issued_amount for b in bonds),
        )

    # ========================================================================
    # Municipal Bond Analysis
    # ========================================================================

    async def search_munis(
        self,
        states: Optional[list[str]] = None,
        min_yield: Optional[float] = None,
        max_yield: Optional[float] = None,
        tax_exempt_only: bool = False,
        insured_only: bool = False,
        maturity_min: Optional[date] = None,
        maturity_max: Optional[date] = None,
        limit: int = 100,
    ) -> tuple[list[BondSummary], int]:
        """
        Search for municipal bonds.

        Args:
            states: Filter by states
            min_yield: Minimum yield
            max_yield: Maximum yield
            tax_exempt_only: Only tax-exempt bonds
            insured_only: Only insured bonds
            maturity_min: Minimum maturity date
            maturity_max: Maximum maturity date
            limit: Maximum results

        Returns:
            Tuple of (bond summaries, total count)
        """
        filters = MuniSearchFilters(
            states=states,
            is_insured=insured_only if insured_only else None,
            maturity_date_min=maturity_min,
            maturity_date_max=maturity_max,
            limit=limit,
        )

        results, total = await self.provider.search_munis(filters)

        summaries = [
            BondSummary(
                isin=b.get("isin", ""),
                name=b.get("name"),
                issuer_name=b.get("issuer_name"),
                coupon=b.get("coupon", 0),
                maturity_date=(
                    date.fromisoformat(b["maturity_date"])
                    if b.get("maturity_date")
                    else date.today()
                ),
                interest_type=b.get("interest_type", "fixed rate"),
                is_callable=b.get("is_callable", False),
                rating=b.get("rating"),
                ticker=b.get("ticker"),
                state=b.get("state"),
            )
            for b in results
        ]

        return summaries, total

    async def get_muni_yield_by_state(self) -> pd.DataFrame:
        """
        Get average municipal bond yields by state.

        Returns:
            DataFrame with state-level yield data
        """
        # This would require aggregating data across states
        # Placeholder implementation
        states = [
            "CA",
            "NY",
            "TX",
            "FL",
            "IL",
            "PA",
            "OH",
            "GA",
            "NC",
            "MI",
            "NJ",
            "VA",
            "WA",
            "AZ",
            "MA",
            "TN",
            "IN",
            "MO",
            "MD",
            "WI",
        ]

        data = []
        for state in states:
            results, _ = await self.provider.search_munis(
                MuniSearchFilters(states=[state], limit=50)
            )

            if results:
                isins = [b["isin"] for b in results if "isin" in b]
                if isins:
                    pricing = await self.provider.get_muni_pricing(isins)
                    if not pricing.empty and "yield_to_maturity" in pricing.columns:
                        avg_yield = pricing["yield_to_maturity"].mean()
                        data.append({"state": state, "avg_yield": avg_yield})

        return pd.DataFrame(data)

    # ========================================================================
    # Helper Methods
    # ========================================================================

    def _parse_bond_reference(self, data: dict) -> BondReference:
        """Parse API response into BondReference model."""
        return BondReference(
            isin=data.get("isin", ""),
            name=data.get("name", ""),
            issuer_name=data.get("issuer_name", ""),
            issuer_type=data.get("issuer_type", "corporate"),
            country_code=data.get("country_code", ""),
            currency=data.get("currency", "USD"),
            coupon=data.get("coupon", 0),
            coupon_frequency=data.get("coupon_frequency", 2),
            interest_type=data.get("interest_type", "fixed rate"),
            issue_date=(
                date.fromisoformat(data["issue_date"])
                if data.get("issue_date")
                else date.today()
            ),
            maturity_date=(
                date.fromisoformat(data["maturity_date"])
                if data.get("maturity_date")
                else date.today()
            ),
            issued_amount=data.get("issued_amount", 0),
            is_callable=data.get("is_callable", False),
            is_inflation_linked=data.get("is_inflation_linked", False),
            rating_composite=data.get("rating_composite"),
            rating_issuer=data.get("rating_issuer"),
            sector=data.get("sector"),
            lei=data.get("lei"),
            figi=data.get("figi"),
            ticker=data.get("ticker"),
        )

    def _parse_muni_reference(self, data: dict) -> MuniBondReference:
        """Parse API response into MuniBondReference model."""
        return MuniBondReference(
            isin=data.get("isin", ""),
            name=data.get("name", ""),
            issuer_name=data.get("issuer_name", ""),
            issuer_type="municipal",
            country_code="US",
            currency="USD",
            coupon=data.get("coupon", 0),
            coupon_frequency=data.get("coupon_frequency", 2),
            interest_type=data.get("interest_type", "fixed rate"),
            issue_date=(
                date.fromisoformat(data["issue_date"])
                if data.get("issue_date")
                else date.today()
            ),
            maturity_date=(
                date.fromisoformat(data["maturity_date"])
                if data.get("maturity_date")
                else date.today()
            ),
            issued_amount=data.get("issued_amount", 0),
            is_callable=data.get("is_callable", False),
            is_inflation_linked=False,
            rating_composite=data.get("rating"),
            state=data.get("state", ""),
            tax_status=data.get("tax_status", "tax_exempt"),
            use_of_proceeds=data.get("use_of_proceeds"),
            is_insured=data.get("is_insured", False),
            call_schedule=[],  # Would need to parse from data
            sinking_fund_schedule=[],
            ticker=data.get("ticker"),
        )
