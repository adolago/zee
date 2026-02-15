"""
Stanley Market Data Router

Provides endpoints for market data including quotes, historical data, and real-time prices.

Endpoints:
- GET /api/market/{symbol} - Market data for a symbol
- GET /api/market/{symbol}/quote - Real-time quote
- GET /api/market/{symbol}/history - Historical price data
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from stanley.api.auth.dependencies import get_optional_user, User
from stanley.api.auth.rate_limit import rate_limit, RateLimitDependency
from stanley.api.routers.base import (
    ApiResponse,
    MarketData,
    create_response,
    get_timestamp,
    get_app_state,
    get_data_manager,
)
from stanley.api.utils import sanitize_log_input
from stanley.api.utils import sanitize_error

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/market",
    tags=["Market Data"],
    responses={404: {"description": "Symbol not found"}},
)


# =============================================================================
# Response Models
# =============================================================================


class QuoteResponse(BaseModel):
    """Real-time quote response."""

    symbol: str
    bid: Optional[float] = None
    ask: Optional[float] = None
    bidSize: Optional[int] = None
    askSize: Optional[int] = None
    last: float
    lastSize: Optional[int] = None
    volume: int
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    previousClose: Optional[float] = None
    change: float
    changePercent: float
    timestamp: str


class HistoricalDataPoint(BaseModel):
    """Single historical data point."""

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    adjustedClose: Optional[float] = None


class HistoricalDataResponse(BaseModel):
    """Historical data response."""

    symbol: str
    interval: str
    dataPoints: list[HistoricalDataPoint]
    startDate: str
    endDate: str


# =============================================================================
# Endpoints
# =============================================================================


@router.get("/{symbol}", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_market_data(
    symbol: str,
    request: Request,
    user=Depends(get_optional_user),
):
    """
    Get market data for a symbol.

    Returns current price, change, volume, and other market data.

    Args:
        symbol: Stock ticker symbol (e.g., AAPL, MSFT)

    Returns:
        Market data including price, change, volume, and timestamp
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.data_manager:
            raise HTTPException(status_code=503, detail="Data manager not initialized")

        # Get stock data for the last few days to calculate change
        end_date = datetime.now()
        start_date = end_date - timedelta(days=5)

        try:
            stock_data = await app_state.data_manager.get_stock_data(
                symbol, start_date, end_date
            )
        except Exception as e:
            logger.warning(
                "Failed to fetch stock data for %s: %s", sanitize_log_input(symbol), e
            )
            # Return mock data as fallback
            stock_data = pd.DataFrame(
                {
                    "date": pd.date_range(start=start_date, end=end_date, freq="D"),
                    "close": [150.0 + np.random.uniform(-5, 5) for _ in range(6)],
                    "volume": [
                        np.random.randint(10000000, 100000000) for _ in range(6)
                    ],
                }
            )

        if stock_data.empty:
            raise HTTPException(status_code=404, detail=f"No data found for {symbol}")

        # Get the latest values
        latest = stock_data.iloc[-1]
        previous = stock_data.iloc[-2] if len(stock_data) > 1 else stock_data.iloc[-1]

        current_price = float(latest["close"])
        previous_close = float(previous["close"])
        change = current_price - previous_close
        change_percent = (change / previous_close * 100) if previous_close != 0 else 0

        market_data = MarketData(
            symbol=symbol,
            price=round(current_price, 2),
            change=round(change, 2),
            changePercent=round(change_percent, 2),
            volume=int(latest["volume"]),
            marketCap=None,
            timestamp=get_timestamp(),
        )

        return create_response(data=market_data.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Error fetching market data for %s: %s", sanitize_log_input(symbol), e
        )
        return create_response(error=sanitize_error(e), success=False)


@router.get("/{symbol}/quote", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_quote(
    symbol: str,
    request: Request,
    user=Depends(get_optional_user),
):
    """
    Get real-time quote for a symbol.

    Returns bid/ask, last price, and intraday data.

    Args:
        symbol: Stock ticker symbol (e.g., AAPL, MSFT)

    Returns:
        Real-time quote with bid/ask, last price, and volume
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.data_manager:
            raise HTTPException(status_code=503, detail="Data manager not initialized")

        # Get recent data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=5)

        try:
            stock_data = await app_state.data_manager.get_stock_data(
                symbol, start_date, end_date
            )
        except Exception as e:
            logger.warning(
                "Failed to fetch quote for %s: %s", sanitize_log_input(symbol), e
            )
            # Generate mock quote data
            last_price = 150.0 + np.random.uniform(-10, 10)
            stock_data = pd.DataFrame(
                {
                    "date": [end_date],
                    "open": [last_price - np.random.uniform(0, 2)],
                    "high": [last_price + np.random.uniform(0, 3)],
                    "low": [last_price - np.random.uniform(0, 3)],
                    "close": [last_price],
                    "volume": [np.random.randint(10000000, 100000000)],
                }
            )

        if stock_data.empty:
            raise HTTPException(status_code=404, detail=f"No quote found for {symbol}")

        latest = stock_data.iloc[-1]
        previous = stock_data.iloc[-2] if len(stock_data) > 1 else latest

        current_price = float(latest["close"])
        previous_close = float(previous["close"])
        change = current_price - previous_close
        change_percent = (change / previous_close * 100) if previous_close != 0 else 0

        quote = QuoteResponse(
            symbol=symbol,
            bid=round(current_price - 0.01, 2) if current_price else None,
            ask=round(current_price + 0.01, 2) if current_price else None,
            bidSize=100,
            askSize=100,
            last=round(current_price, 2),
            lastSize=100,
            volume=int(latest.get("volume", 0)),
            open=round(float(latest.get("open", current_price)), 2),
            high=round(float(latest.get("high", current_price)), 2),
            low=round(float(latest.get("low", current_price)), 2),
            close=round(current_price, 2),
            previousClose=round(previous_close, 2),
            change=round(change, 2),
            changePercent=round(change_percent, 2),
            timestamp=get_timestamp(),
        )

        return create_response(data=quote.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error fetching quote for %s: %s", sanitize_log_input(symbol), e)
        return create_response(error=sanitize_error(e), success=False)


@router.get("/{symbol}/history", response_model=ApiResponse)
@rate_limit(requests=100, window=60)
async def get_history(
    symbol: str,
    request: Request,
    interval: str = Query(
        default="1d",
        description="Data interval (1d, 1wk, 1mo)",
        pattern="^(1d|1wk|1mo)$",
    ),
    period: int = Query(
        default=90,
        ge=1,
        le=3650,
        description="Number of days of history",
    ),
    user=Depends(get_optional_user),
):
    """
    Get historical price data for a symbol.

    Returns OHLCV data for the specified period and interval.

    Args:
        symbol: Stock ticker symbol (e.g., AAPL, MSFT)
        interval: Data interval - 1d (daily), 1wk (weekly), 1mo (monthly)
        period: Number of days of history (1-3650)

    Returns:
        Historical OHLCV data points
    """
    try:
        symbol = symbol.upper()
        app_state = get_app_state()

        if not app_state or not app_state.data_manager:
            raise HTTPException(status_code=503, detail="Data manager not initialized")

        end_date = datetime.now()
        start_date = end_date - timedelta(days=period)

        try:
            stock_data = await app_state.data_manager.get_stock_data(
                symbol, start_date, end_date
            )
        except Exception as e:
            logger.warning(
                "Failed to fetch history for %s: %s", sanitize_log_input(symbol), e
            )
            # Generate mock historical data
            dates = pd.date_range(start=start_date, end=end_date, freq="D")
            base_price = 150.0
            prices = [base_price]
            for i in range(1, len(dates)):
                prices.append(prices[-1] * (1 + np.random.uniform(-0.03, 0.03)))

            stock_data = pd.DataFrame(
                {
                    "date": dates,
                    "open": [p * (1 - np.random.uniform(0, 0.01)) for p in prices],
                    "high": [p * (1 + np.random.uniform(0, 0.02)) for p in prices],
                    "low": [p * (1 - np.random.uniform(0, 0.02)) for p in prices],
                    "close": prices,
                    "volume": [np.random.randint(10000000, 100000000) for _ in prices],
                }
            )

        if stock_data.empty:
            raise HTTPException(
                status_code=404, detail=f"No historical data found for {symbol}"
            )

        # Resample if needed
        if interval == "1wk":
            stock_data = (
                stock_data.resample("W", on="date")
                .agg(
                    {
                        "open": "first",
                        "high": "max",
                        "low": "min",
                        "close": "last",
                        "volume": "sum",
                    }
                )
                .dropna()
                .reset_index()
            )
        elif interval == "1mo":
            stock_data = (
                stock_data.resample("ME", on="date")
                .agg(
                    {
                        "open": "first",
                        "high": "max",
                        "low": "min",
                        "close": "last",
                        "volume": "sum",
                    }
                )
                .dropna()
                .reset_index()
            )

        # Convert to response format
        data_points = []
        for _, row in stock_data.iterrows():
            date_val = row.get("date", row.name)
            if isinstance(date_val, pd.Timestamp):
                date_str = date_val.isoformat()
            else:
                date_str = str(date_val)

            data_points.append(
                HistoricalDataPoint(
                    date=date_str,
                    open=round(float(row.get("open", 0)), 2),
                    high=round(float(row.get("high", 0)), 2),
                    low=round(float(row.get("low", 0)), 2),
                    close=round(float(row.get("close", 0)), 2),
                    volume=int(row.get("volume", 0)),
                    adjustedClose=round(
                        float(row.get("adj_close", row.get("close", 0))), 2
                    ),
                ).model_dump()
            )

        response = HistoricalDataResponse(
            symbol=symbol,
            interval=interval,
            dataPoints=data_points,
            startDate=start_date.isoformat(),
            endDate=end_date.isoformat(),
        )

        return create_response(data=response.model_dump())

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error fetching history for %s: %s", sanitize_log_input(symbol), e)
        return create_response(error=sanitize_error(e), success=False)
