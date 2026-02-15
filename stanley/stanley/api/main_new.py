"""
Stanley REST API - Refactored Main Module
==========================================

FastAPI-based REST API for the Stanley institutional investment analysis platform.
This is the refactored entry point using modular routers and middleware integration.

Features:
    - Modular router architecture for better organization
    - Integrated authentication and rate limiting middleware
    - Dependency injection container for services
    - CORS configuration for frontend clients
    - Global exception handling
    - Structured logging

Usage:
    # Development
    uvicorn stanley.api.main_new:app --reload --port 8000

    # Production
    uvicorn stanley.api.main_new:app --host 0.0.0.0 --port 8000 --workers 4

Environment Variables:
    SEC_IDENTITY: Email for SEC EDGAR API identification
    STANLEY_AUTH_JWT_SECRET_KEY: JWT signing key (32+ chars)
    STANLEY_AUTH_CORS_ORIGINS: Comma-separated CORS origins
    STANLEY_AUTH_RATE_LIMIT_ENABLED: Enable rate limiting (default: true)
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from stanley.api.dependencies import get_container, Container
from stanley.api.middleware.security import SecurityHeadersMiddleware
from stanley.api.middleware.wide_events import WideEventsMiddleware
from stanley.api.request_context import reset_current_app_state, set_current_app_state
from stanley.api.routers.registration import register_routers
from stanley.api.utils import create_response, get_timestamp, is_debug_mode

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# =============================================================================
# Application Lifecycle
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle.

    Startup initializes the global service container unless the caller has
    already provided one via `app.state.app_state` (useful for tests).

    The container is stored in `app.state.app_state` for access by routers.
    """
    # Startup
    logger.info("Stanley API starting up...")

    container = getattr(app.state, "app_state", None)
    owns_container = False

    if container is None:
        container = get_container()
        await container.initialize()
        app.state.app_state = container
        owns_container = True
    else:
        logger.info("Using pre-configured app.state.app_state (skipping init)")

    logger.info("Stanley API ready")

    yield

    # Shutdown
    logger.info("Stanley API shutting down...")
    if owns_container:
        await container.close()
    else:
        close_fn = getattr(container, "close", None)
        if callable(close_fn):
            try:
                maybe = close_fn()
                if hasattr(maybe, "__await__"):
                    await maybe
            except Exception:
                # Best-effort shutdown for externally-managed containers
                logger.debug("Error closing external app_state", exc_info=True)

    logger.info("Stanley API shutdown complete")


# =============================================================================
# Application Factory
# =============================================================================


def create_app() -> FastAPI:
    """
    Application factory for creating the FastAPI instance.

    This factory pattern allows for:
    - Easy testing with custom configurations
    - Multiple app instances if needed
    - Clear separation of configuration

    Returns:
        Configured FastAPI application instance
    """
    # Load auth settings
    # We fail closed if auth is not configured correctly (missing secret key)
    from stanley.api.auth import get_auth_settings, RateLimitMiddleware

    try:
        settings = get_auth_settings()
        cors_origins = settings.CORS_ORIGINS
        rate_limit_enabled = settings.RATE_LIMIT_ENABLED
        has_auth = True
    except Exception as e:
        logger.critical(f"Auth settings not configured: {e}")
        logger.critical("STANLEY_AUTH_JWT_SECRET_KEY is required for security.")
        raise  # Re-raise the exception to stop startup

    app = FastAPI(
        title="Stanley API",
        description="Institutional Investment Analysis Platform - REST API",
        version="2.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=[
            {"name": "System", "description": "Health checks and system status"},
            {"name": "Settings", "description": "User preferences and configuration"},
            {
                "name": "Market Data",
                "description": "Real-time and historical market data",
            },
            {
                "name": "Institutional",
                "description": "13F holdings and institutional analysis",
            },
            {"name": "Analytics", "description": "Money flow and sector rotation"},
            {
                "name": "Research",
                "description": "Valuation, earnings, and peer analysis",
            },
            {"name": "Options", "description": "Options flow and Greeks analysis"},
            {"name": "ETF", "description": "ETF flows and sector rotation"},
            {
                "name": "Macro",
                "description": "Economic indicators and regime detection",
            },
            {"name": "Commodities", "description": "Commodity prices and correlations"},
            {"name": "Accounting", "description": "SEC filings and financial analysis"},
            {"name": "Signals", "description": "Signal generation and backtesting"},
            {"name": "Notes", "description": "Research vault and trade journal"},
            {
                "name": "Portfolio",
                "description": "Portfolio analytics and risk metrics",
            },
            {
                "name": "News",
                "description": "News digests and market briefings",
            },
        ],
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Rate limiting middleware (if auth is configured)
    if has_auth and rate_limit_enabled:
        app.add_middleware(RateLimitMiddleware)
        logger.info("Rate limiting middleware enabled")

    # Security headers middleware
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(WideEventsMiddleware)

    # Make app.state.app_state available to routers without importing a specific entrypoint.
    @app.middleware("http")
    async def app_state_context_middleware(request: Request, call_next):
        token = set_current_app_state(getattr(request.app.state, "app_state", None))
        try:
            return await call_next(request)
        finally:
            reset_current_app_state(token)

    # Register all routers
    register_routers(app)

    # Global exception handler
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """Handle uncaught exceptions with structured response."""
        logger.error(f"Unhandled error on {request.url.path}: {exc}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "Internal server error",
                "detail": str(exc) if is_debug_mode() else None,
                "timestamp": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        )

    # HTTP exception handler (for custom formatting)
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        """Handle HTTP exceptions with structured response."""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": exc.detail,
                "timestamp": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
            headers=exc.headers,
        )

    return app


# =============================================================================
# Application Instance
# =============================================================================

app = create_app()


# =============================================================================
# Run server (for development)
# =============================================================================


def run_dev_server(host: str = "0.0.0.0", port: int = 8000):
    """Run the development server."""
    import uvicorn

    uvicorn.run(
        "stanley.api.main_new:app",
        host=host,
        port=port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)

    args, _unknown = parser.parse_known_args()
    run_dev_server(host=args.host, port=args.port)


# =============================================================================
# Module Exports
# =============================================================================

__all__ = [
    "app",
    "create_app",
    "run_dev_server",
    "get_timestamp",
    "create_response",
]
