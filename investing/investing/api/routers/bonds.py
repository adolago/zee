"""
Bonds API Router

Provides fixed income endpoints for government, corporate, and municipal bonds.
"""

import logging
import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from investing.bonds import (
    BondAnalyzer,
    BondReference,
    BondScreener,
    BondScreenRequest,
    BondScreenResponse,
    BondType,
    CreditSpreadAnalysis,
    MuniBondReference,
    YieldCurve,
)
from investing.data.providers.terrapin_provider import (
    TerrapinError,
    TerrapinNotFoundError,
    TerrapinProvider,
)
from investing.api.utils import sanitize_log_input, sanitize_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bonds", tags=["bonds"])

# Global provider and analyzer instances
_provider: Optional[TerrapinProvider] = None
_analyzer: Optional[BondAnalyzer] = None
_screener: Optional[BondScreener] = None


async def get_provider() -> TerrapinProvider:
    """Get the Terrapin provider instance."""
    global _provider
    if _provider is None:
        api_key = os.getenv("TERRAPIN_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="Terrapin API key not configured. Set TERRAPIN_API_KEY environment variable.",
            )
        _provider = TerrapinProvider(api_key=api_key)
        await _provider.initialize()
    return _provider


async def get_analyzer() -> BondAnalyzer:
    """Get the bond analyzer instance."""
    global _analyzer
    if _analyzer is None:
        provider = await get_provider()
        _analyzer = BondAnalyzer(provider)
    return _analyzer


async def get_screener() -> BondScreener:
    """Get the bond screener instance."""
    global _screener
    if _screener is None:
        provider = await get_provider()
        _screener = BondScreener(provider)
    return _screener


@router.on_event("shutdown")
async def shutdown_provider():
    """Close the provider on shutdown."""
    global _provider
    if _provider:
        await _provider.close()
        _provider = None


@router.get("/health")
async def bonds_health():
    """Check bonds service health."""
    try:
        provider = await get_provider()
        healthy = await provider.health_check()
        return {
            "status": "healthy" if healthy else "unhealthy",
            "service": "bonds",
            "provider": "terrapin",
        }
    except HTTPException:
        return {
            "status": "not_configured",
            "service": "bonds",
            "error": "TERRAPIN_API_KEY not set",
        }
    except Exception as e:
        logger.error(f"Bonds health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "bonds",
            "error": str(e),
        }


# ========================================================================
# Bond Search
# ========================================================================


@router.post("/search", response_model=BondScreenResponse)
async def search_bonds(
    request: BondScreenRequest,
    screener: BondScreener = Depends(get_screener),
):
    """
    Search and screen bonds based on criteria.

    Supports filtering by:
    - Bond type (government, corporate, municipal)
    - Yield range
    - Coupon range
    - Credit rating
    - Maturity date range
    - Country/currency
    - State (for municipal bonds)
    """
    try:
        return await screener.screen_from_request(request)
    except TerrapinError as e:
        logger.error(f"Bond search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/search/government")
async def search_government_bonds(
    country: str = Query("US", description="Country code"),
    maturity_min: Optional[date] = Query(None, description="Minimum maturity date"),
    maturity_max: Optional[date] = Query(None, description="Maximum maturity date"),
    limit: int = Query(50, ge=1, le=500, description="Maximum results"),
    screener: BondScreener = Depends(get_screener),
):
    """Search for government bonds."""
    try:
        return await screener.screen(
            bond_type=BondType.GOVERNMENT,
            countries=[country],
            maturity_min=maturity_min,
            maturity_max=maturity_max,
            limit=limit,
        )
    except TerrapinError as e:
        logger.error(f"Government bond search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/search/corporate")
async def search_corporate_bonds(
    min_rating: Optional[str] = Query(None, description="Minimum credit rating"),
    min_coupon: Optional[float] = Query(None, description="Minimum coupon rate"),
    maturity_min: Optional[date] = Query(None, description="Minimum maturity date"),
    maturity_max: Optional[date] = Query(None, description="Maximum maturity date"),
    limit: int = Query(50, ge=1, le=500, description="Maximum results"),
    screener: BondScreener = Depends(get_screener),
):
    """Search for corporate bonds."""
    try:
        return await screener.screen(
            bond_type=BondType.CORPORATE,
            min_rating=min_rating,
            min_coupon=min_coupon,
            maturity_min=maturity_min,
            maturity_max=maturity_max,
            limit=limit,
        )
    except TerrapinError as e:
        logger.error(f"Corporate bond search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


# ========================================================================
# Yield Curve
# ========================================================================


@router.get("/yield-curve", response_model=YieldCurve)
async def get_yield_curve(
    country: str = Query("US", description="Country code"),
    as_of_date: Optional[date] = Query(None, description="Date for yield curve"),
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """
    Get the sovereign yield curve for a country.

    Returns yield curve with standard tenor points (1M, 3M, 6M, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 20Y, 30Y).
    """
    try:
        curve = await analyzer.get_yield_curve(country, as_of_date)
        return curve
    except TerrapinError as e:
        logger.error(
            "Failed to get yield curve for %s: %s", sanitize_log_input(country), e
        )
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/yield-curve/{country}", response_model=YieldCurve)
async def get_country_yield_curve(
    country: str,
    as_of_date: Optional[date] = Query(None, description="Date for yield curve"),
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """Get yield curve for a specific country."""
    try:
        curve = await analyzer.get_yield_curve(country, as_of_date)
        return curve
    except TerrapinError as e:
        logger.error(
            "Failed to get yield curve for %s: %s", sanitize_log_input(country), e
        )
        raise HTTPException(status_code=500, detail=sanitize_error(e))


# ========================================================================
# Company Bonds & Credit Spreads
# ========================================================================


@router.get("/company/{symbol}")
async def get_company_bonds(
    symbol: str,
    lei: Optional[str] = Query(None, description="Legal Entity Identifier"),
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """
    Get all outstanding bonds for a company.

    Note: LEI (Legal Entity Identifier) provides more reliable results
    if available.
    """
    try:
        bonds = await analyzer.get_company_bonds(symbol, lei)
        return {
            "symbol": symbol.upper(),
            "bonds_count": len(bonds),
            "bonds": bonds,
        }
    except TerrapinError as e:
        logger.error(
            "Failed to get company bonds for %s: %s", sanitize_log_input(symbol), e
        )
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/credit-spread/{symbol}", response_model=CreditSpreadAnalysis)
async def get_credit_spread(
    symbol: str,
    lei: Optional[str] = Query(None, description="Legal Entity Identifier"),
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """
    Get credit spread analysis for a company.

    Returns aggregate credit metrics including average spread,
    yield to maturity, and total debt outstanding.
    """
    try:
        return await analyzer.get_company_credit_spread(symbol, lei)
    except TerrapinError as e:
        logger.error(
            "Failed to get credit spread for %s: %s", sanitize_log_input(symbol), e
        )
        raise HTTPException(status_code=500, detail=sanitize_error(e))


# ========================================================================
# Municipal Bonds
# ========================================================================


@router.post("/munis/search")
async def search_municipal_bonds(
    states: Optional[list[str]] = Query(None, description="Filter by states"),
    min_yield: Optional[float] = Query(None, description="Minimum yield"),
    tax_exempt_only: bool = Query(False, description="Only tax-exempt bonds"),
    insured_only: bool = Query(False, description="Only insured bonds"),
    maturity_min: Optional[date] = Query(None, description="Minimum maturity date"),
    maturity_max: Optional[date] = Query(None, description="Maximum maturity date"),
    limit: int = Query(50, ge=1, le=500, description="Maximum results"),
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """
    Search for US municipal bonds.

    Supports filtering by state, yield, tax status, insurance, and maturity.
    """
    try:
        bonds, total = await analyzer.search_munis(
            states=states,
            min_yield=min_yield,
            tax_exempt_only=tax_exempt_only,
            insured_only=insured_only,
            maturity_min=maturity_min,
            maturity_max=maturity_max,
            limit=limit,
        )

        return {
            "bonds": bonds,
            "total": total,
            "filters": {
                "states": states,
                "min_yield": min_yield,
                "tax_exempt_only": tax_exempt_only,
                "insured_only": insured_only,
            },
        }

    except TerrapinError as e:
        logger.error(f"Municipal bond search failed: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/munis/states")
async def get_muni_yields_by_state(
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """
    Get average municipal bond yields by state.

    Returns a summary of average yields across US states.
    """
    try:
        df = await analyzer.get_muni_yield_by_state()

        if df.empty:
            return {"states": []}

        return {
            "states": df.to_dict(orient="records"),
        }

    except TerrapinError as e:
        logger.error(f"Failed to get muni yields by state: {e}")
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/munis/{isin}", response_model=MuniBondReference)
async def get_municipal_bond(
    isin: str,
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """Get reference data for a municipal bond."""
    try:
        bond = await analyzer.get_muni_bond(isin)
        if not bond:
            raise HTTPException(
                status_code=404,
                detail=f"Municipal bond not found: {isin}",
            )
        return bond

    except TerrapinNotFoundError:
        raise HTTPException(status_code=404, detail=f"Municipal bond not found: {isin}")
    except TerrapinError as e:
        logger.error("Failed to get municipal bond %s: %s", sanitize_log_input(isin), e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


# ========================================================================
# Bond Reference Data (path parameter routes - must be last)
# ========================================================================


@router.get("/{isin}", response_model=BondReference)
async def get_bond(
    isin: str,
    analyzer: BondAnalyzer = Depends(get_analyzer),
):
    """
    Get reference data for a government or corporate bond.

    Args:
        isin: Bond ISIN (International Securities Identification Number)
    """
    try:
        bond = await analyzer.get_bond(isin)
        if not bond:
            raise HTTPException(
                status_code=404,
                detail=f"Bond not found: {isin}",
            )
        return bond

    except TerrapinNotFoundError:
        raise HTTPException(status_code=404, detail=f"Bond not found: {isin}")
    except TerrapinError as e:
        logger.error("Failed to get bond %s: %s", sanitize_log_input(isin), e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))


@router.get("/{isin}/pricing")
async def get_bond_pricing(
    isin: str,
    start_date: Optional[date] = Query(
        None, description="Start date for pricing history"
    ),
    end_date: Optional[date] = Query(None, description="End date for pricing history"),
    provider: TerrapinProvider = Depends(get_provider),
):
    """
    Get pricing history for a bond.

    Returns historical price, yield, and spread data.
    """
    try:
        pricing_df = await provider.get_bond_pricing(
            [isin],
            start_date=start_date,
            end_date=end_date,
        )

        if pricing_df.empty:
            return {"isin": isin, "pricing": []}

        # Convert to list of dicts
        pricing_df["date"] = pricing_df["date"].dt.strftime("%Y-%m-%d")
        return {
            "isin": isin,
            "pricing": pricing_df.to_dict(orient="records"),
        }

    except TerrapinError as e:
        logger.error("Failed to get pricing for %s: %s", sanitize_log_input(isin), e)
        raise HTTPException(status_code=500, detail=sanitize_error(e))
