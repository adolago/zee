"""
Investing Prediction Markets Router

Provides read-only endpoints for Polymarket and Kalshi data via Dome API.
"""

import logging
import os
from typing import Any, Dict, List, Optional

import aiohttp
from fastapi import APIRouter, HTTPException, Query

from investing.api.routers.base import ApiResponse, create_response
from investing.api.utils import sanitize_error, sanitize_log_input

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prediction-markets", tags=["Prediction Markets"])

DOME_BASE_URL = os.getenv("DOME_API_BASE_URL", "https://api.domeapi.io/v1").rstrip("/")
DOME_TIMEOUT = float(os.getenv("DOME_API_TIMEOUT", "20"))


def _get_dome_token() -> str:
    token = os.getenv("DOME_API_KEY") or os.getenv("DOME_API_TOKEN")
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Dome API token not configured. Set DOME_API_KEY environment variable.",
        )
    return token


def _clean_params(params: Dict[str, Any]) -> Dict[str, Any]:
    cleaned: Dict[str, Any] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, list) and not value:
            continue
        cleaned[key] = value
    return cleaned


async def _dome_get(path: str, params: Dict[str, Any]) -> Dict[str, Any]:
    token = _get_dome_token()
    url = f"{DOME_BASE_URL}/{path.lstrip('/')}"
    headers = {"Authorization": f"Bearer {token}"}
    timeout = aiohttp.ClientTimeout(total=DOME_TIMEOUT)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params, headers=headers) as response:
            if response.status >= 400:
                body = await response.text()
                logger.warning(
                    "Dome API error %s for %s: %s",
                    response.status,
                    sanitize_log_input(url),
                    sanitize_log_input(body, max_length=200),
                )
                raise HTTPException(
                    status_code=response.status,
                    detail=f"Dome API error: {body}",
                )
            try:
                return await response.json()
            except aiohttp.ContentTypeError:
                body = await response.text()
                raise HTTPException(
                    status_code=502,
                    detail=f"Dome API returned non-JSON response: {body}",
                )


@router.get("/health", response_model=ApiResponse)
async def prediction_markets_health() -> ApiResponse:
    try:
        data = await _dome_get("/polymarket/markets", {"limit": 1})
        markets = data.get("markets", [])
        return create_response(
            data={
                "status": "healthy",
                "provider": "dome",
                "polymarket_sample_size": len(markets),
            }
        )
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Prediction markets health error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/markets", response_model=ApiResponse)
async def get_polymarket_markets(
    market_slug: Optional[List[str]] = Query(None),
    event_slug: Optional[List[str]] = Query(None),
    condition_id: Optional[List[str]] = Query(None),
    tags: Optional[List[str]] = Query(None),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    min_volume: Optional[float] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=100),
    offset: Optional[int] = Query(None, ge=0),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "market_slug": market_slug,
                "event_slug": event_slug,
                "condition_id": condition_id,
                "tags": tags,
                "search": search,
                "status": status,
                "min_volume": min_volume,
                "limit": limit,
                "offset": offset,
                "start_time": start_time,
                "end_time": end_time,
            }
        )
        data = await _dome_get("/polymarket/markets", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket markets error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/market-price/{token_id}", response_model=ApiResponse)
async def get_polymarket_market_price(
    token_id: str,
    at_time: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params({"at_time": at_time})
        data = await _dome_get(f"/polymarket/market-price/{token_id}", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket market price error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/orderbooks", response_model=ApiResponse)
async def get_polymarket_orderbooks(
    token_id: str = Query(...),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=200),
    pagination_key: Optional[str] = Query(None),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "token_id": token_id,
                "start_time": start_time,
                "end_time": end_time,
                "limit": limit,
                "pagination_key": pagination_key,
            }
        )
        data = await _dome_get("/polymarket/orderbooks", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket orderbooks error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/orders", response_model=ApiResponse)
async def get_polymarket_orders(
    market_slug: Optional[str] = Query(None),
    condition_id: Optional[str] = Query(None),
    token_id: Optional[str] = Query(None),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(None, ge=0),
    user: Optional[str] = Query(None),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "market_slug": market_slug,
                "condition_id": condition_id,
                "token_id": token_id,
                "start_time": start_time,
                "end_time": end_time,
                "limit": limit,
                "offset": offset,
                "user": user,
            }
        )
        data = await _dome_get("/polymarket/orders", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket orders error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/activity", response_model=ApiResponse)
async def get_polymarket_activity(
    user: str = Query(...),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    market_slug: Optional[str] = Query(None),
    condition_id: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "user": user,
                "start_time": start_time,
                "end_time": end_time,
                "market_slug": market_slug,
                "condition_id": condition_id,
                "limit": limit,
                "offset": offset,
            }
        )
        data = await _dome_get("/polymarket/activity", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket activity error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/positions/{wallet_address}", response_model=ApiResponse)
async def get_polymarket_positions(
    wallet_address: str,
    limit: Optional[int] = Query(None, ge=1, le=100),
    pagination_key: Optional[str] = Query(None),
) -> ApiResponse:
    try:
        params = _clean_params({"limit": limit, "pagination_key": pagination_key})
        data = await _dome_get(f"/polymarket/positions/wallet/{wallet_address}", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket positions error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/wallet", response_model=ApiResponse)
async def get_polymarket_wallet(
    eoa: Optional[str] = Query(None),
    proxy: Optional[str] = Query(None),
    handle: Optional[str] = Query(None),
    with_metrics: Optional[bool] = Query(None),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        identifiers = [value for value in (eoa, proxy, handle) if value]
        if len(identifiers) != 1:
            raise HTTPException(
                status_code=400,
                detail="Provide exactly one of eoa, proxy, or handle.",
            )

        params = _clean_params(
            {
                "eoa": eoa,
                "proxy": proxy,
                "handle": handle,
                "with_metrics": (
                    str(with_metrics).lower() if with_metrics is not None else None
                ),
                "start_time": start_time,
                "end_time": end_time,
            }
        )
        data = await _dome_get("/polymarket/wallet", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket wallet error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/wallet-pnl/{wallet_address}", response_model=ApiResponse)
async def get_polymarket_wallet_pnl(
    wallet_address: str,
    granularity: str = Query(...),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "granularity": granularity,
                "start_time": start_time,
                "end_time": end_time,
            }
        )
        data = await _dome_get(f"/polymarket/wallet/pnl/{wallet_address}", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket wallet pnl error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/polymarket/candlesticks/{condition_id}", response_model=ApiResponse)
async def get_polymarket_candlesticks(
    condition_id: str,
    start_time: int = Query(..., ge=0),
    end_time: int = Query(..., ge=0),
    interval: Optional[int] = Query(None, ge=1),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "start_time": start_time,
                "end_time": end_time,
                "interval": interval,
            }
        )
        data = await _dome_get(f"/polymarket/candlesticks/{condition_id}", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Polymarket candlesticks error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/kalshi/markets", response_model=ApiResponse)
async def get_kalshi_markets(
    market_ticker: Optional[List[str]] = Query(None),
    event_ticker: Optional[List[str]] = Query(None),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    min_volume: Optional[float] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=100),
    offset: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "market_ticker": market_ticker,
                "event_ticker": event_ticker,
                "search": search,
                "status": status,
                "min_volume": min_volume,
                "limit": limit,
                "offset": offset,
            }
        )
        data = await _dome_get("/kalshi/markets", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Kalshi markets error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/kalshi/market-price/{market_ticker}", response_model=ApiResponse)
async def get_kalshi_market_price(
    market_ticker: str,
    at_time: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params({"at_time": at_time})
        data = await _dome_get(f"/kalshi/market-price/{market_ticker}", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Kalshi market price error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/kalshi/trades", response_model=ApiResponse)
async def get_kalshi_trades(
    ticker: Optional[str] = Query(None),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=1000),
    offset: Optional[int] = Query(None, ge=0),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "ticker": ticker,
                "start_time": start_time,
                "end_time": end_time,
                "limit": limit,
                "offset": offset,
            }
        )
        data = await _dome_get("/kalshi/trades", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Kalshi trades error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/kalshi/orderbooks", response_model=ApiResponse)
async def get_kalshi_orderbooks(
    ticker: str = Query(...),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=200),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "ticker": ticker,
                "start_time": start_time,
                "end_time": end_time,
                "limit": limit,
            }
        )
        data = await _dome_get("/kalshi/orderbooks", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Kalshi orderbooks error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/matching-markets/sports", response_model=ApiResponse)
async def get_matching_markets_sports(
    polymarket_market_slug: Optional[str] = Query(None),
    kalshi_event_ticker: Optional[str] = Query(None),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "polymarket_market_slug": polymarket_market_slug,
                "kalshi_event_ticker": kalshi_event_ticker,
            }
        )
        data = await _dome_get("/matching-markets/sports", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Matching markets sports error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/matching-markets/sports/{sport}", response_model=ApiResponse)
async def get_matching_markets_sports_by_sport(
    sport: str,
    date: str = Query(...),
) -> ApiResponse:
    try:
        params = _clean_params({"date": date})
        data = await _dome_get(f"/matching-markets/sports/{sport}", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Matching markets by sport error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/crypto/binance", response_model=ApiResponse)
async def get_crypto_prices_binance(
    currency: str = Query(...),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=1000),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "currency": currency,
                "start_time": start_time,
                "end_time": end_time,
                "limit": limit,
            }
        )
        data = await _dome_get("/crypto-prices/binance", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Binance crypto prices error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)


@router.get("/crypto/chainlink", response_model=ApiResponse)
async def get_crypto_prices_chainlink(
    currency: str = Query(...),
    start_time: Optional[int] = Query(None, ge=0),
    end_time: Optional[int] = Query(None, ge=0),
    limit: Optional[int] = Query(None, ge=1, le=1000),
) -> ApiResponse:
    try:
        params = _clean_params(
            {
                "currency": currency,
                "start_time": start_time,
                "end_time": end_time,
                "limit": limit,
            }
        )
        data = await _dome_get("/crypto-prices/chainlink", params)
        return create_response(data=data)
    except HTTPException as exc:
        return create_response(error=exc.detail, success=False)
    except Exception as exc:
        logger.error("Chainlink crypto prices error: %s", exc)
        return create_response(error=sanitize_error(exc), success=False)
