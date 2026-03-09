"""
Wide event logging middleware for Investing API.

Emits one canonical JSON event per request with high-cardinality context,
tail-sampled for cost control.
"""

from __future__ import annotations

import json
import os
import random
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Dict, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp

from investing.config.logging import (
    clear_request_context,
    get_request_id,
    set_request_context,
    user_id_var,
)


@dataclass(frozen=True)
class WideEventsSettings:
    enabled: bool
    file_path: str
    sample_rate: float
    slow_ms: float
    payloads: str


def _hash_value(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()[:12]


def _resolve_settings() -> WideEventsSettings:
    base_dir = os.environ.get(
        "ZEE_INVESTING_WIDE_EVENTS_DIR",
        os.path.join(os.path.expanduser("~"), ".zee/investing", "logs"),
    )
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    file_path = os.environ.get(
        "ZEE_INVESTING_WIDE_EVENTS_FILE",
        os.path.join(base_dir, f"investing-wide-{today}.jsonl"),
    )
    enabled = os.environ.get("ZEE_INVESTING_WIDE_EVENTS_ENABLED", "1") != "0"
    sample_rate = float(os.environ.get("ZEE_INVESTING_WIDE_EVENTS_SAMPLE_RATE", "0.02"))
    slow_ms = float(os.environ.get("ZEE_INVESTING_WIDE_EVENTS_SLOW_MS", "2000"))
    payloads = os.environ.get("ZEE_INVESTING_WIDE_EVENTS_PAYLOADS", "debug")
    return WideEventsSettings(
        enabled=enabled,
        file_path=file_path,
        sample_rate=max(0.0, min(1.0, sample_rate)),
        slow_ms=slow_ms,
        payloads=payloads,
    )


def _summarize_query(params: Dict[str, str], payloads: str) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"keys": sorted(params.keys())}
    if payloads == "full":
        summary["values"] = params
    elif payloads == "debug":
        summary["value_hashes"] = {k: _hash_value(v) for k, v in params.items()}
    return summary


def _should_keep(
    status_code: int, duration_ms: float, settings: WideEventsSettings, debug: bool
) -> Dict[str, Any]:
    if debug:
        return {"kept": True, "reason": "debug"}
    if status_code >= 500:
        return {"kept": True, "reason": "error"}
    if duration_ms >= settings.slow_ms:
        return {"kept": True, "reason": "slow"}
    kept = random.random() < settings.sample_rate
    return {"kept": kept, "reason": "sample", "rate": settings.sample_rate}


def _write_event(settings: WideEventsSettings, event: Dict[str, Any]) -> None:
    try:
        os.makedirs(os.path.dirname(settings.file_path), exist_ok=True)
        with open(settings.file_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event) + "\n")
    except Exception:
        # Never block the request path on logging failures.
        return


class WideEventsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        settings = _resolve_settings()
        if not settings.enabled:
            return await call_next(request)

        trace_id = (
            request.headers.get("x-trace-id")
            or request.headers.get("x-request-id")
            or str(uuid.uuid4())
        )
        set_request_context(request_id=trace_id)
        start = time.perf_counter()
        status_code = 500
        error: Optional[str] = None

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as exc:
            error = str(exc)
            raise
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            debug = settings.payloads == "full"
            decision = _should_keep(status_code, duration_ms, settings, debug)
            event = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "service": "investing-api",
                "trace_id": trace_id,
                "request_id": get_request_id(),
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "duration_ms": round(duration_ms, 2),
                "slow": duration_ms >= settings.slow_ms,
                "user_id": user_id_var.get(),
                "query": _summarize_query(
                    dict(request.query_params), settings.payloads
                ),
                "client": {
                    "host": request.client.host if request.client else None,
                    "user_agent_hash": _hash_value(
                        request.headers.get("user-agent", "")
                    ),
                },
                "error": error,
                "sample": decision,
            }
            if decision.get("kept"):
                _write_event(settings, event)
            clear_request_context()
