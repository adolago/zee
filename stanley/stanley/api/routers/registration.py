"""
Stanley Router Registration
============================

Provides the register_routers function for centralized router registration.

This module is separate from __init__.py to avoid conflicts with concurrent
modifications to the routers package during development.

Usage:
    from stanley.api.routers.registration import register_routers

    app = FastAPI()
    register_routers(app)
"""

import logging
from typing import Optional

from fastapi import FastAPI, APIRouter

logger = logging.getLogger(__name__)


def register_routers(app: FastAPI) -> None:
    """
    Register all API routers with the FastAPI application.

    This function imports and includes all router modules, organizing
    the API into logical groups. Each router is included with its
    appropriate prefix and tags. Routers that fail to import are skipped.

    Args:
        app: FastAPI application instance

    Router Categories:
        - system: Health checks, version info, system status
        - settings: User preferences and configuration
        - market: Market data endpoints
        - portfolio: Portfolio analytics and risk
        - analytics: Money flow, dark pool, sector rotation
        - research: Valuation, earnings, peer analysis
        - options: Options flow and analytics
        - etf: ETF flows and analysis
        - notes: Research vault and trade journal
        - commodities: Commodities data and correlations
        - macro: Economic indicators and regime detection
        - accounting: SEC filings and financial analysis
        - signals: Signal generation and backtesting
        - institutional: 13F holdings and institutional data
    """
    registered_count = 0

    # System routes (health, version, status)
    try:
        from stanley.api.routers.system import router as system_router

        app.include_router(system_router)
        logger.debug("Registered system router")
        registered_count += 1
    except ImportError as e:
        logger.warning(f"Could not register system router: {e}")

    # Settings routes
    try:
        from stanley.api.settings import router as settings_router

        app.include_router(settings_router)
        logger.debug("Registered settings router")
        registered_count += 1
    except ImportError as e:
        logger.warning(f"Could not register settings router: {e}")

    # Dynamic router registration with graceful fallback
    router_modules = [
        ("stanley.api.routers.market", "market"),
        ("stanley.api.routers.portfolio", "portfolio"),
        ("stanley.api.routers.analytics", "analytics"),
        ("stanley.api.routers.research", "research"),
        ("stanley.api.routers.prediction_markets", "prediction_markets"),
        ("stanley.api.routers.options", "options"),
        ("stanley.api.routers.etf", "etf"),
        ("stanley.api.routers.notes", "notes"),
        ("stanley.api.routers.commodities", "commodities"),
        ("stanley.api.routers.macro", "macro"),
        ("stanley.api.routers.accounting", "accounting"),
        ("stanley.api.routers.signals", "signals"),
        ("stanley.api.routers.institutional", "institutional"),
        ("stanley.api.routers.bonds", "bonds"),
        ("stanley.api.routers.news", "news"),
        ("stanley.api.routers.search", "search"),
    ]

    for module_path, name in router_modules:
        try:
            import importlib

            module = importlib.import_module(module_path)
            router = getattr(module, "router", None)
            if router is not None:
                app.include_router(router)
                logger.debug(f"Registered {name} router")
                registered_count += 1
        except ImportError as e:
            logger.warning(f"Could not register {name} router: {e}")
        except Exception as e:
            logger.error(f"Error registering {name} router: {e}")

    logger.info(f"Registered {registered_count} API routers successfully")


__all__ = ["register_routers"]
