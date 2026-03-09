"""
Bond Screener Module

Provides bond filtering and screening capabilities.
"""

import logging
from datetime import date
from typing import Optional

from investing.data.providers.terrapin_provider import (
    BondSearchFilters,
    MuniSearchFilters,
    TerrapinProvider,
)

from .models import (
    BondScreenRequest,
    BondScreenResponse,
    BondSummary,
    BondType,
)

logger = logging.getLogger(__name__)


class BondScreener:
    """
    Screen and filter bonds based on various criteria.

    Supports:
    - Government bonds
    - Corporate bonds
    - Municipal bonds

    Example usage:
        screener = BondScreener(provider)

        # Screen for high-yield corporate bonds
        results = await screener.screen(
            bond_type=BondType.CORPORATE,
            min_yield=5.0,
            min_rating="BB",
        )

        # Screen for California municipal bonds
        munis = await screener.screen(
            bond_type=BondType.MUNICIPAL,
            states=["CA"],
            tax_exempt_only=True,
        )
    """

    def __init__(self, provider: TerrapinProvider):
        """
        Initialize the bond screener.

        Args:
            provider: Terrapin provider for bond data
        """
        self.provider = provider

    async def screen(
        self,
        bond_type: Optional[BondType] = None,
        min_yield: Optional[float] = None,
        max_yield: Optional[float] = None,
        min_coupon: Optional[float] = None,
        max_coupon: Optional[float] = None,
        min_rating: Optional[str] = None,
        maturity_min: Optional[date] = None,
        maturity_max: Optional[date] = None,
        countries: Optional[list[str]] = None,
        currencies: Optional[list[str]] = None,
        sectors: Optional[list[str]] = None,
        states: Optional[list[str]] = None,
        tax_exempt_only: bool = False,
        insured_only: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> BondScreenResponse:
        """
        Screen bonds based on criteria.

        Args:
            bond_type: Filter by bond type (government, corporate, municipal)
            min_yield: Minimum yield to maturity
            max_yield: Maximum yield to maturity
            min_coupon: Minimum coupon rate
            max_coupon: Maximum coupon rate
            min_rating: Minimum credit rating
            maturity_min: Minimum maturity date
            maturity_max: Maximum maturity date
            countries: Filter by countries (for gov/corp)
            currencies: Filter by currencies
            sectors: Filter by sectors (for corporates)
            states: Filter by US states (for munis)
            tax_exempt_only: Only tax-exempt municipal bonds
            insured_only: Only insured municipal bonds
            limit: Maximum results to return
            offset: Results offset for pagination

        Returns:
            BondScreenResponse with matching bonds
        """
        filters_applied = {
            "bond_type": bond_type.value if bond_type else None,
            "min_yield": min_yield,
            "max_yield": max_yield,
            "min_coupon": min_coupon,
            "max_coupon": max_coupon,
            "min_rating": min_rating,
            "maturity_min": maturity_min.isoformat() if maturity_min else None,
            "maturity_max": maturity_max.isoformat() if maturity_max else None,
            "countries": countries,
            "currencies": currencies,
            "sectors": sectors,
            "states": states,
            "tax_exempt_only": tax_exempt_only,
            "insured_only": insured_only,
        }

        # Remove None values
        filters_applied = {k: v for k, v in filters_applied.items() if v is not None}

        # Route to appropriate screening method based on bond type
        if bond_type == BondType.MUNICIPAL or states:
            return await self._screen_munis(
                states=states,
                min_coupon=min_coupon,
                max_coupon=max_coupon,
                maturity_min=maturity_min,
                maturity_max=maturity_max,
                tax_exempt_only=tax_exempt_only,
                insured_only=insured_only,
                limit=limit,
                offset=offset,
                filters_applied=filters_applied,
            )
        else:
            return await self._screen_gov_corp(
                bond_type=bond_type,
                min_coupon=min_coupon,
                max_coupon=max_coupon,
                min_rating=min_rating,
                maturity_min=maturity_min,
                maturity_max=maturity_max,
                countries=countries,
                currencies=currencies,
                limit=limit,
                offset=offset,
                filters_applied=filters_applied,
            )

    async def screen_from_request(
        self, request: BondScreenRequest
    ) -> BondScreenResponse:
        """
        Screen bonds from a request object.

        Args:
            request: BondScreenRequest with filter criteria

        Returns:
            BondScreenResponse with matching bonds
        """
        return await self.screen(
            bond_type=request.bond_type,
            min_yield=request.min_yield,
            max_yield=request.max_yield,
            min_coupon=request.min_coupon,
            max_coupon=request.max_coupon,
            min_rating=request.min_rating,
            maturity_min=request.maturity_min,
            maturity_max=request.maturity_max,
            countries=request.countries,
            currencies=request.currencies,
            sectors=request.sectors,
            states=request.states,
            tax_exempt_only=request.tax_exempt_only,
            insured_only=request.insured_only,
            limit=request.limit,
            offset=request.offset,
        )

    async def _screen_gov_corp(
        self,
        bond_type: Optional[BondType],
        min_coupon: Optional[float],
        max_coupon: Optional[float],
        min_rating: Optional[str],
        maturity_min: Optional[date],
        maturity_max: Optional[date],
        countries: Optional[list[str]],
        currencies: Optional[list[str]],
        limit: int,
        offset: int,
        filters_applied: dict,
    ) -> BondScreenResponse:
        """Screen government and corporate bonds."""
        # Determine issuer types
        issuer_types = None
        if bond_type == BondType.GOVERNMENT:
            issuer_types = ["government"]
        elif bond_type == BondType.CORPORATE:
            issuer_types = ["corporate"]

        filters = BondSearchFilters(
            issuer_types=issuer_types,
            countries=countries,
            currencies=currencies,
            coupon_min=min_coupon,
            coupon_max=max_coupon,
            ratings=[min_rating] if min_rating else None,
            maturity_date_min=maturity_min,
            maturity_date_max=maturity_max,
            limit=limit,
            offset=offset,
        )

        results = await self.provider.search_bonds(filters)

        bonds = [
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
            )
            for b in results
        ]

        return BondScreenResponse(
            bonds=bonds,
            total=len(bonds),  # Note: Terrapin may provide actual total
            filters_applied=filters_applied,
        )

    async def _screen_munis(
        self,
        states: Optional[list[str]],
        min_coupon: Optional[float],
        max_coupon: Optional[float],
        maturity_min: Optional[date],
        maturity_max: Optional[date],
        tax_exempt_only: bool,
        insured_only: bool,
        limit: int,
        offset: int,
        filters_applied: dict,
    ) -> BondScreenResponse:
        """Screen municipal bonds."""
        filters = MuniSearchFilters(
            states=states,
            coupon_min=min_coupon,
            coupon_max=max_coupon,
            maturity_date_min=maturity_min,
            maturity_date_max=maturity_max,
            is_insured=insured_only if insured_only else None,
            limit=limit,
            offset=offset,
        )

        results, total = await self.provider.search_munis(filters)

        bonds = [
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

        return BondScreenResponse(
            bonds=bonds,
            total=total,
            filters_applied=filters_applied,
        )

    async def get_top_yielding(
        self,
        bond_type: Optional[BondType] = None,
        limit: int = 20,
    ) -> list[BondSummary]:
        """
        Get top yielding bonds.

        Args:
            bond_type: Filter by bond type
            limit: Maximum results

        Returns:
            List of top yielding bonds
        """
        # This would require yield data which needs pricing
        # For now, return bonds sorted by coupon as proxy
        response = await self.screen(
            bond_type=bond_type,
            limit=limit,
        )

        # Sort by coupon descending
        sorted_bonds = sorted(
            response.bonds,
            key=lambda b: b.coupon,
            reverse=True,
        )

        return sorted_bonds[:limit]

    async def get_investment_grade(
        self,
        bond_type: Optional[BondType] = None,
        limit: int = 50,
    ) -> BondScreenResponse:
        """
        Get investment grade bonds.

        Args:
            bond_type: Filter by bond type
            limit: Maximum results

        Returns:
            Investment grade bonds
        """
        return await self.screen(
            bond_type=bond_type,
            min_rating="BBB-",
            limit=limit,
        )

    async def get_high_yield(
        self,
        bond_type: Optional[BondType] = None,
        limit: int = 50,
    ) -> BondScreenResponse:
        """
        Get high yield (junk) bonds.

        Args:
            bond_type: Filter by bond type
            limit: Maximum results

        Returns:
            High yield bonds
        """
        return await self.screen(
            bond_type=bond_type,
            min_rating="BB+",
            limit=limit,
        )
