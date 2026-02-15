"""
Stanley API Router Base Utilities

Shared utilities, dependencies, and response models for all API routers.

This module provides:
- Response Models: Standardized API response structures
- Dependencies: FastAPI dependency injection for app_state access
- Utility Functions: Common helpers for response formatting and data conversion
- Error Handlers: Standard exception handling patterns
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

import numpy as np
import pandas as pd
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

from stanley.api.request_context import get_current_app_state
from stanley.api.utils import sanitize_error

logger = logging.getLogger(__name__)


# =============================================================================
# Response Models
# =============================================================================


class ApiResponse(BaseModel):
    """
    Standard API response wrapper.

    All API endpoints should return responses wrapped in this model
    for consistent client-side handling.
    """

    success: bool = Field(..., description="Whether the request succeeded")
    data: Optional[Any] = Field(default=None, description="Response payload")
    error: Optional[str] = Field(default=None, description="Error message if failed")
    timestamp: str = Field(..., description="ISO timestamp of response")


class SuccessResponse(BaseModel):
    """Simplified success response for documentation."""

    success: bool = True
    data: Any
    timestamp: str


class ErrorResponse(BaseModel):
    """Simplified error response for documentation."""

    success: bool = False
    error: str
    timestamp: str


class PaginatedResponse(BaseModel):
    """Response wrapper for paginated endpoints."""

    success: bool = True
    data: List[Any]
    total: int = Field(..., description="Total number of items")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Items per page")
    has_next: bool = Field(..., description="Whether there are more pages")
    timestamp: str


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(
        ..., description="Overall status: healthy, degraded, or unhealthy"
    )
    version: str = Field(..., description="API version")
    components: Dict[str, bool] = Field(..., description="Component health status")
    timestamp: str


# =============================================================================
# Common Data Response Models
# =============================================================================


class MarketData(BaseModel):
    """Stock market data response."""

    symbol: str
    price: float
    change: float
    changePercent: float
    volume: int
    marketCap: Optional[float] = None
    timestamp: str


class InstitutionalHolding(BaseModel):
    """Institutional holding data."""

    managerName: str
    managerCik: str
    sharesHeld: int
    valueHeld: float
    ownershipPercentage: float
    changeFromLastQuarter: Optional[float] = None


class MoneyFlowData(BaseModel):
    """Money flow analysis data."""

    symbol: str
    netFlow1m: float
    netFlow3m: float
    institutionalChange: float
    smartMoneySentiment: float
    flowAcceleration: float
    confidenceScore: float


class PortfolioHolding(BaseModel):
    """Portfolio holding with current values."""

    symbol: str
    shares: float
    averageCost: float
    currentPrice: float
    marketValue: float
    weight: float


# =============================================================================
# Common Request Models
# =============================================================================


class SymbolRequest(BaseModel):
    """Request with a single symbol."""

    symbol: str = Field(
        ..., description="Stock ticker symbol", min_length=1, max_length=10
    )


class MultiSymbolRequest(BaseModel):
    """Request with multiple symbols."""

    symbols: List[str] = Field(
        ..., description="List of stock ticker symbols", min_length=1, max_length=100
    )


class DateRangeRequest(BaseModel):
    """Request with date range parameters."""

    start_date: Optional[str] = Field(
        default=None, description="Start date (YYYY-MM-DD)"
    )
    end_date: Optional[str] = Field(default=None, description="End date (YYYY-MM-DD)")


class LookbackRequest(BaseModel):
    """Request with lookback period."""

    lookback_days: int = Field(
        default=20, ge=1, le=365, description="Number of days to analyze"
    )


# =============================================================================
# Helper Functions
# =============================================================================


def get_timestamp() -> str:
    """Get current ISO timestamp with Z suffix."""
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def convert_numpy_types(obj: Any) -> Any:
    """
    Convert numpy types to native Python types for JSON serialization.

    Handles:
    - numpy.bool_ -> bool
    - numpy.integer -> int
    - numpy.floating -> float (or None if NaN)
    - numpy.ndarray -> list
    - dict/list -> recursively converted
    - pandas.Timestamp -> ISO string

    Args:
        obj: Any object that may contain numpy types

    Returns:
        Object with numpy types converted to native Python types
    """
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(v) for v in obj]
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj) if not np.isnan(obj) else None
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    elif pd.isna(obj):
        return None
    return obj


# Alias for backward compatibility
_convert_numpy_types = convert_numpy_types


def create_response(
    data: Any = None, error: Optional[str] = None, success: bool = True
) -> ApiResponse:
    """
    Create a standardized API response.

    Automatically converts numpy types and handles error state.

    Args:
        data: Response payload (will be converted for JSON compatibility)
        error: Error message if request failed
        success: Whether the request succeeded (auto-set to False if error provided)

    Returns:
        ApiResponse model instance

    Example:
        >>> create_response(data={"price": 150.25})
        ApiResponse(success=True, data={"price": 150.25}, error=None, timestamp="...")

        >>> create_response(error="Symbol not found")
        ApiResponse(success=False, data=None, error="Symbol not found", timestamp="...")
    """
    converted_data = convert_numpy_types(data) if data is not None else None

    return ApiResponse(
        success=success and error is None,
        data=converted_data,
        error=error,
        timestamp=get_timestamp(),
    )


def create_paginated_response(
    data: List[Any],
    total: int,
    page: int = 1,
    page_size: int = 20,
) -> PaginatedResponse:
    """
    Create a paginated API response.

    Args:
        data: List of items for current page
        total: Total number of items across all pages
        page: Current page number (1-indexed)
        page_size: Number of items per page

    Returns:
        PaginatedResponse model instance
    """
    converted_data = [convert_numpy_types(item) for item in data]
    has_next = (page * page_size) < total

    return PaginatedResponse(
        success=True,
        data=converted_data,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
        timestamp=get_timestamp(),
    )


def normalize_symbol(symbol: str) -> str:
    """
    Normalize a stock symbol to uppercase and stripped.

    Args:
        symbol: Raw symbol input

    Returns:
        Normalized uppercase symbol
    """
    return symbol.strip().upper()


def parse_symbols(symbols: Optional[str]) -> Optional[List[str]]:
    """
    Parse a comma-separated string of symbols into a list.

    Args:
        symbols: Comma-separated symbols string (e.g., "AAPL,MSFT,GOOGL")

    Returns:
        List of normalized symbols, or None if input is None/empty
    """
    if not symbols:
        return None
    return [normalize_symbol(s) for s in symbols.split(",") if s.strip()]


def dataframe_to_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Convert a DataFrame to a list of records with numpy type conversion.

    Args:
        df: Pandas DataFrame

    Returns:
        List of dictionaries with converted values
    """
    if df.empty:
        return []
    return [convert_numpy_types(record) for record in df.to_dict(orient="records")]


# =============================================================================
# Application State Access
# =============================================================================

# Global app_state reference - set by main app during startup
_app_state = None


def set_app_state(state) -> None:
    """Set the application state reference from the main app."""
    global _app_state
    _app_state = state


def get_app_state():
    """Get the application state.

    Prefer the request-scoped state set by middleware in `stanley.api.main_new`.
    Falls back to the legacy module-level `_app_state` for backward compatibility.
    """
    state = get_current_app_state()
    if state is not None:
        return state

    if _app_state is not None:
        return _app_state

    raise HTTPException(status_code=503, detail="Application state not initialized")


# =============================================================================
# Analyzer Dependencies
# =============================================================================


def get_data_manager():
    """Dependency to get data manager, raising 503 if not initialized."""
    state = get_app_state()
    if state is None or state.data_manager is None:
        raise HTTPException(status_code=503, detail="Data manager not initialized")
    return state.data_manager


def get_money_flow_analyzer():
    """Dependency to get money flow analyzer."""
    state = get_app_state()
    if state is None or state.money_flow_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Money flow analyzer not initialized"
        )
    return state.money_flow_analyzer


def get_institutional_analyzer():
    """Dependency to get institutional analyzer."""
    state = get_app_state()
    if state is None or state.institutional_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Institutional analyzer not initialized"
        )
    return state.institutional_analyzer


def get_portfolio_analyzer():
    """Dependency to get portfolio analyzer."""
    state = get_app_state()
    if state is None or state.portfolio_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Portfolio analyzer not initialized"
        )
    return state.portfolio_analyzer


def get_research_analyzer():
    """Dependency to get research analyzer."""
    state = get_app_state()
    if state is None or state.research_analyzer is None:
        raise HTTPException(status_code=503, detail="Research analyzer not initialized")
    return state.research_analyzer


def get_commodities_analyzer():
    """Dependency to get commodities analyzer."""
    state = get_app_state()
    if state is None or state.commodities_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Commodities analyzer not initialized"
        )
    return state.commodities_analyzer


def get_options_analyzer():
    """Dependency to get options analyzer."""
    state = get_app_state()
    if state is None or state.options_analyzer is None:
        raise HTTPException(status_code=503, detail="Options analyzer not initialized")
    return state.options_analyzer


def get_etf_analyzer():
    """Dependency to get ETF analyzer."""
    state = get_app_state()
    if state is None or state.etf_analyzer is None:
        raise HTTPException(status_code=503, detail="ETF analyzer not initialized")
    return state.etf_analyzer


def get_accounting_analyzer():
    """Dependency to get accounting analyzer."""
    state = get_app_state()
    if state is None or state.accounting_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Accounting analyzer not initialized"
        )
    return state.accounting_analyzer


def get_earnings_quality_analyzer():
    """Dependency to get earnings quality analyzer."""
    state = get_app_state()
    if state is None or state.earnings_quality_analyzer is None:
        raise HTTPException(
            status_code=503, detail="Earnings quality analyzer not initialized"
        )
    return state.earnings_quality_analyzer


def get_red_flag_scorer():
    """Dependency to get red flag scorer."""
    state = get_app_state()
    if state is None or state.red_flag_scorer is None:
        raise HTTPException(status_code=503, detail="Red flag scorer not initialized")
    return state.red_flag_scorer


def get_anomaly_aggregator():
    """Dependency to get anomaly aggregator."""
    state = get_app_state()
    if state is None or state.anomaly_aggregator is None:
        raise HTTPException(
            status_code=503, detail="Anomaly aggregator not initialized"
        )
    return state.anomaly_aggregator


def get_signal_generator():
    """Dependency to get signal generator."""
    state = get_app_state()
    if state is None or state.signal_generator is None:
        raise HTTPException(status_code=503, detail="Signal generator not initialized")
    return state.signal_generator


def get_signal_backtester():
    """Dependency to get signal backtester."""
    state = get_app_state()
    if state is None or state.signal_backtester is None:
        raise HTTPException(status_code=503, detail="Signal backtester not initialized")
    return state.signal_backtester


def get_performance_tracker():
    """Dependency to get performance tracker."""
    state = get_app_state()
    if state is None or state.performance_tracker is None:
        raise HTTPException(
            status_code=503, detail="Performance tracker not initialized"
        )
    return state.performance_tracker


def get_note_manager():
    """Dependency to get note manager."""
    state = get_app_state()
    if state is None or state.note_manager is None:
        raise HTTPException(status_code=503, detail="Note manager not initialized")
    return state.note_manager


# =============================================================================
# Error Handling
# =============================================================================


def handle_analyzer_error(
    symbol: str,
    error: Exception,
    operation: str = "processing",
) -> ApiResponse:
    """
    Create an error response for analyzer failures.

    Args:
        symbol: The symbol that was being processed
        error: The exception that occurred
        operation: Description of the operation that failed

    Returns:
        ApiResponse with error details
    """
    logger.error(f"Error {operation} for {symbol}: {error}")
    return create_response(error=sanitize_error(error), success=False)


class SymbolNotFoundError(HTTPException):
    """Raised when a requested symbol is not found."""

    def __init__(self, symbol: str):
        super().__init__(status_code=404, detail=f"Symbol not found: {symbol}")


class AnalyzerNotInitializedError(HTTPException):
    """Raised when a required analyzer is not initialized."""

    def __init__(self, analyzer_name: str):
        super().__init__(status_code=503, detail=f"{analyzer_name} not initialized")


class InvalidParameterError(HTTPException):
    """Raised when request parameters are invalid."""

    def __init__(self, message: str):
        super().__init__(status_code=400, detail=message)


# =============================================================================
# Exports
# =============================================================================


__all__ = [
    # Response Models
    "ApiResponse",
    "SuccessResponse",
    "ErrorResponse",
    "PaginatedResponse",
    "HealthResponse",
    # Data Response Models
    "MarketData",
    "InstitutionalHolding",
    "MoneyFlowData",
    "PortfolioHolding",
    # Request Models
    "SymbolRequest",
    "MultiSymbolRequest",
    "DateRangeRequest",
    "LookbackRequest",
    # App State
    "set_app_state",
    "get_app_state",
    # Analyzer Dependencies
    "get_data_manager",
    "get_money_flow_analyzer",
    "get_institutional_analyzer",
    "get_portfolio_analyzer",
    "get_research_analyzer",
    "get_commodities_analyzer",
    "get_options_analyzer",
    "get_etf_analyzer",
    "get_accounting_analyzer",
    "get_earnings_quality_analyzer",
    "get_red_flag_scorer",
    "get_anomaly_aggregator",
    "get_signal_generator",
    "get_signal_backtester",
    "get_performance_tracker",
    "get_note_manager",
    # Utility Functions
    "get_timestamp",
    "convert_numpy_types",
    "_convert_numpy_types",
    "create_response",
    "create_paginated_response",
    "normalize_symbol",
    "parse_symbols",
    "dataframe_to_records",
    # Error Handling
    "handle_analyzer_error",
    "SymbolNotFoundError",
    "AnalyzerNotInitializedError",
    "InvalidParameterError",
]
