"""
Terrapin Finance API Provider

Client for Terrapin Finance fixed income data API.
Provides access to government, corporate, and municipal bond data.

API Documentation: https://docs.terrapinfinance.com/
"""

import logging
from datetime import date, datetime
from typing import Any, Optional

import httpx
import pandas as pd
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class TerrapinError(Exception):
    """Base exception for Terrapin API errors."""


class TerrapinAuthError(TerrapinError):
    """Authentication failed."""


class TerrapinRateLimitError(TerrapinError):
    """Rate limit exceeded."""


class TerrapinNotFoundError(TerrapinError):
    """Requested resource not found."""


# Request/Response Models


class BondSearchFilters(BaseModel):
    """Filters for bond search."""

    isins: Optional[list[str]] = None
    issuer_types: Optional[list[str]] = Field(None, description="government, corporate")
    countries: Optional[list[str]] = None
    currencies: Optional[list[str]] = None
    interest_types: Optional[list[str]] = Field(
        None, description="fixed rate, floating, zero coupon"
    )
    maturity_date_min: Optional[date] = None
    maturity_date_max: Optional[date] = None
    coupon_min: Optional[float] = None
    coupon_max: Optional[float] = None
    is_callable: Optional[bool] = None
    ratings: Optional[list[str]] = None
    limit: int = Field(100, ge=1, le=1000)
    offset: int = Field(0, ge=0)


class MuniSearchFilters(BaseModel):
    """Filters for municipal bond search."""

    isins: Optional[list[str]] = None
    issuers: Optional[list[str]] = None
    states: Optional[list[str]] = None
    interest_types: Optional[list[str]] = None
    maturity_date_min: Optional[date] = None
    maturity_date_max: Optional[date] = None
    issue_date_min: Optional[date] = None
    issue_date_max: Optional[date] = None
    coupon_min: Optional[float] = None
    coupon_max: Optional[float] = None
    is_callable: Optional[bool] = None
    is_insured: Optional[bool] = None
    ratings: Optional[list[str]] = Field(
        None, description="investment_grade, high_yield, etc."
    )
    limit: int = Field(100, ge=1, le=1000)
    offset: int = Field(0, ge=0)


class TerrapinProvider:
    """
    Terrapin Finance API client for bond data.

    Provides access to:
    - Government and corporate bond reference data
    - Government and corporate bond pricing
    - US Municipal bond reference data
    - US Municipal bond pricing

    Example usage:
        provider = TerrapinProvider(api_key="your_key")
        await provider.initialize()

        # Get bond reference data
        bonds = await provider.get_bond_reference(["US912828Y958"])

        # Search municipal bonds
        munis = await provider.search_munis(MuniSearchFilters(states=["CA"]))
    """

    BASE_URL = "https://terrapinfinance.com/api/v1"

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        rate_limit: float = 10.0,
    ):
        """
        Initialize the Terrapin provider.

        Args:
            api_key: Terrapin API key
            base_url: Override base URL (for testing)
            timeout: Request timeout in seconds
            rate_limit: Maximum requests per second
        """
        self._api_key = api_key
        self._base_url = base_url or self.BASE_URL
        self._timeout = timeout
        self._rate_limit = rate_limit
        self._client: Optional[httpx.AsyncClient] = None
        self._initialized = False

    @property
    def name(self) -> str:
        return "terrapin"

    async def initialize(self) -> None:
        """Initialize the HTTP client."""
        if self._initialized:
            return

        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        self._initialized = True
        logger.info("Terrapin provider initialized")

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
        self._initialized = False

    async def __aenter__(self):
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    def _get_client(self) -> httpx.AsyncClient:
        """Get the HTTP client, ensuring it's initialized."""
        if not self._client:
            raise TerrapinError("Provider not initialized. Call initialize() first.")
        return self._client

    async def _request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> dict:
        """
        Make an API request.

        Args:
            method: HTTP method
            endpoint: API endpoint
            json_data: JSON body data
            params: Query parameters

        Returns:
            Response JSON data

        Raises:
            TerrapinError: On API errors
        """
        client = self._get_client()

        try:
            response = await client.request(
                method=method,
                url=endpoint,
                json=json_data,
                params=params,
            )

            if response.status_code == 401:
                raise TerrapinAuthError("Authentication failed. Check your API key.")
            elif response.status_code == 402:
                raise TerrapinError("Payment required. Check your subscription.")
            elif response.status_code == 403:
                raise TerrapinAuthError("Access forbidden.")
            elif response.status_code == 404:
                raise TerrapinNotFoundError("Resource not found.")
            elif response.status_code == 422:
                raise TerrapinError(f"Validation error: {response.text}")
            elif response.status_code == 429:
                raise TerrapinRateLimitError("Rate limit exceeded.")
            elif response.status_code >= 500:
                raise TerrapinError(f"Server error: {response.status_code}")

            response.raise_for_status()
            return response.json()

        except httpx.RequestError as e:
            raise TerrapinError(f"Request failed: {e}")

    # ========================================================================
    # Government and Corporate Bond Endpoints
    # ========================================================================

    async def get_bond_reference(self, isins: list[str]) -> list[dict]:
        """
        Get reference data for government and corporate bonds.

        Args:
            isins: List of ISINs to look up

        Returns:
            List of bond reference data dictionaries
        """
        if not isins:
            return []

        response = await self._request(
            method="POST",
            endpoint="/bond_reference",
            json_data={"isins": isins},
        )

        return response.get("data", [])

    async def get_bond_pricing(
        self,
        isins: list[str],
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> pd.DataFrame:
        """
        Get historical pricing for government and corporate bonds.

        Args:
            isins: List of ISINs
            start_date: Start date for pricing history
            end_date: End date for pricing history

        Returns:
            DataFrame with pricing data
        """
        if not isins:
            return pd.DataFrame()

        json_data = {"isins": isins}
        if start_date:
            json_data["start_date"] = start_date.isoformat()
        if end_date:
            json_data["end_date"] = end_date.isoformat()

        response = await self._request(
            method="POST",
            endpoint="/bond_pricing",
            json_data=json_data,
        )

        data = response.get("data", [])
        if not data:
            return pd.DataFrame()

        df = pd.DataFrame(data)
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
        return df

    async def search_bonds(self, filters: BondSearchFilters) -> list[dict]:
        """
        Search for government and corporate bonds.

        Args:
            filters: Search filters

        Returns:
            List of matching bond summaries
        """
        json_data = filters.model_dump(exclude_none=True)

        # Convert date fields to ISO format
        if "maturity_date_min" in json_data:
            json_data["maturity_date_min"] = json_data["maturity_date_min"].isoformat()
        if "maturity_date_max" in json_data:
            json_data["maturity_date_max"] = json_data["maturity_date_max"].isoformat()

        response = await self._request(
            method="POST",
            endpoint="/bond_search",
            json_data=json_data,
        )

        return response.get("data", [])

    # ========================================================================
    # Municipal Bond Endpoints
    # ========================================================================

    async def get_muni_reference(self, isins: list[str]) -> list[dict]:
        """
        Get reference data for municipal bonds.

        Args:
            isins: List of ISINs to look up

        Returns:
            List of municipal bond reference data dictionaries
        """
        if not isins:
            return []

        response = await self._request(
            method="POST",
            endpoint="/muni_reference",
            json_data={"isins": isins},
        )

        return response.get("data", [])

    async def search_munis(self, filters: MuniSearchFilters) -> tuple[list[dict], int]:
        """
        Search for municipal bonds.

        Args:
            filters: Search filters

        Returns:
            Tuple of (list of matching bonds, total count)
        """
        json_data = filters.model_dump(exclude_none=True)

        # Convert date fields to ISO format
        for date_field in [
            "maturity_date_min",
            "maturity_date_max",
            "issue_date_min",
            "issue_date_max",
        ]:
            if date_field in json_data and json_data[date_field]:
                json_data[date_field] = json_data[date_field].isoformat()

        response = await self._request(
            method="POST",
            endpoint="/muni_search",
            json_data=json_data,
        )

        return response.get("data", []), response.get("total", 0)

    async def get_muni_pricing(
        self,
        isins: list[str],
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> pd.DataFrame:
        """
        Get historical pricing for municipal bonds.

        Args:
            isins: List of ISINs
            start_date: Start date for pricing history
            end_date: End date for pricing history

        Returns:
            DataFrame with pricing data
        """
        if not isins:
            return pd.DataFrame()

        json_data = {"isins": isins}
        if start_date:
            json_data["start_date"] = start_date.isoformat()
        if end_date:
            json_data["end_date"] = end_date.isoformat()

        response = await self._request(
            method="POST",
            endpoint="/muni_pricing",
            json_data=json_data,
        )

        data = response.get("data", [])
        if not data:
            return pd.DataFrame()

        df = pd.DataFrame(data)
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
        return df

    # ========================================================================
    # Utility Methods
    # ========================================================================

    async def health_check(self) -> bool:
        """Check if the API is accessible."""
        try:
            # Try to search for a single bond to verify connectivity
            await self.search_bonds(BondSearchFilters(limit=1))
            return True
        except Exception as e:
            logger.error(f"Terrapin health check failed: {e}")
            return False

    async def get_bond_by_ticker(self, ticker: str) -> Optional[dict]:
        """
        Get bond reference data by ticker.

        Note: Terrapin uses ISIN as primary identifier.
        This method searches by ticker and returns the first match.

        Args:
            ticker: Bond ticker (e.g., "T 1.875 07/31/26")

        Returns:
            Bond reference data or None if not found
        """
        # Terrapin doesn't have direct ticker lookup, so we'd need to
        # search and filter. For now, return None as this requires
        # additional API capability.
        logger.warning("Ticker lookup not directly supported by Terrapin API")
        return None

    async def get_treasury_yields(self) -> pd.DataFrame:
        """
        Get current US Treasury yield curve.

        Returns:
            DataFrame with treasury yields by maturity
        """
        # Search for US Treasury bonds
        results = await self.search_bonds(
            BondSearchFilters(
                issuer_types=["government"],
                countries=["US"],
                interest_types=["fixed rate"],
                limit=100,
            )
        )

        if not results:
            return pd.DataFrame()

        # Get ISINs and fetch pricing
        isins = [b["isin"] for b in results if "isin" in b]
        if not isins:
            return pd.DataFrame()

        pricing = await self.get_bond_pricing(isins)
        return pricing
