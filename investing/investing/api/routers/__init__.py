"""
Investing API Routers Package

This package contains modular routers that split the monolithic main.py (4346 lines)
into domain-specific endpoints. Each router handles a specific category of endpoints.

Router Structure:
-----------------
- system.py        : /api/health - System health and status endpoints
- market.py        : /api/market/* - Market data endpoints
- institutional.py : /api/institutional/* - 13F institutional holdings and analytics
- analytics.py     : /api/money-flow, /api/dark-pool, /api/equity-flow - Analytics
- portfolio.py     : /api/portfolio* - Portfolio analytics endpoints
- research.py      : /api/research, /api/valuation, /api/earnings, /api/peers
- commodities.py   : /api/commodities/* - Commodity market endpoints
- options.py       : /api/options/* - Options flow and analysis endpoints
- etf.py           : /api/etf/* - ETF flow and rotation endpoints
- macro.py         : /api/macro/* - Macro economic indicators
- accounting.py    : /api/accounting/* - SEC filings, earnings quality, red flags
- signals.py       : /api/signals/* - Signal generation and backtesting
- notes.py         : /api/notes, /api/theses, /api/trades, /api/events, /api/people, /api/sectors
- settings.py      : /api/settings/* - Application settings endpoints
- search.py        : /api/search/* - Semantic search (Qdrant vector search)
- bonds.py         : /api/bonds/* - Fixed income/bond data (Terrapin)

Usage:
------
    from fastapi import FastAPI
    from investing.api.routers import register_routers

    app = FastAPI()
    registered = register_routers(app)
    print(f"Registered {len(registered)} routers")
"""

import logging
from typing import List, Tuple, Optional

from fastapi import FastAPI

logger = logging.getLogger(__name__)

# Router configuration: (module_name, prefix, tags)
# Order matters - more specific routes should come before general ones
ROUTER_CONFIG: List[Tuple[str, str, List[str]]] = [
    # System endpoints (health check at /api/health)
    ("system", "/api", ["System"]),
    # Market data endpoints
    ("market", "/api", ["Market Data"]),
    # Institutional analytics endpoints (13F, whale tracking, smart money)
    ("institutional", "/api", ["Institutional", "Institutional Analytics"]),
    # Money flow and dark pool analytics
    ("analytics", "/api", ["Analytics", "Money Flow"]),
    # Portfolio analytics endpoints
    ("portfolio", "/api", ["Portfolio"]),
    # Research and valuation endpoints
    ("research", "/api", ["Research"]),
    # Prediction markets (Dome API)
    ("prediction_markets", "/api", ["Prediction Markets"]),
    # Commodities market endpoints
    ("commodities", "/api", ["Commodities"]),
    # Options flow and analysis endpoints
    ("options", "/api", ["Options"]),
    # ETF flow and rotation endpoints
    ("etf", "/api", ["ETF Analytics"]),
    # Macro economic indicators
    ("macro", "/api", ["Macro"]),
    # Accounting quality endpoints
    ("accounting", "/api", ["Accounting Quality"]),
    # Signal generation and performance tracking
    ("signals", "/api", ["Signals"]),
    # Research vault: notes, theses, trades, events, people, sectors
    ("notes", "/api", ["Notes"]),
    # Application settings
    ("settings", "/api", ["Settings"]),
    # Semantic search (Qdrant)
    ("search", "/api", ["Search"]),
    # Fixed income / bonds (Terrapin)
    ("bonds", "/api", ["Bonds"]),
    # WebSocket real-time data streams
    ("websocket", "", ["WebSocket"]),
]


def register_routers(app: FastAPI, skip_missing: bool = True) -> List[str]:
    """
    Register all API routers with the FastAPI application.

    This function dynamically imports and registers all routers defined
    in ROUTER_CONFIG. Each router is mounted with its configured prefix
    and tags.

    Args:
        app: The FastAPI application instance
        skip_missing: If True, skip routers that don't exist yet (default: True)

    Returns:
        List of successfully registered router names

    Example:
        >>> from fastapi import FastAPI
        >>> from investing.api.routers import register_routers
        >>> app = FastAPI()
        >>> registered = register_routers(app)
        >>> print(f"Registered {len(registered)} routers")
    """
    import importlib

    registered = []

    for module_name, prefix, tags in ROUTER_CONFIG:
        try:
            # Import the router module
            module = importlib.import_module(f".{module_name}", package=__name__)

            # Get the router from the module
            router = getattr(module, "router", None)

            if router is None:
                logger.warning(
                    f"Router module '{module_name}' has no 'router' attribute"
                )
                continue

            # Include the router with prefix and tags
            app.include_router(router, prefix=prefix, tags=tags)
            registered.append(module_name)
            logger.info(f"Registered router: {module_name} at {prefix}")

        except ImportError as e:
            if skip_missing:
                logger.debug(f"Router module '{module_name}' not found (skipping): {e}")
            else:
                logger.warning(f"Could not import router module '{module_name}': {e}")
        except Exception as e:
            logger.error(f"Error registering router '{module_name}': {e}")

    return registered


def get_router_info() -> List[dict]:
    """
    Get information about all configured routers.

    Returns:
        List of dicts with router configuration details
    """
    return [
        {
            "module": module_name,
            "prefix": prefix,
            "tags": tags,
        }
        for module_name, prefix, tags in ROUTER_CONFIG
    ]


def get_available_routers() -> List[str]:
    """
    Get list of router modules that are currently available (can be imported).

    Returns:
        List of available router module names
    """
    import importlib

    available = []
    for module_name, _, _ in ROUTER_CONFIG:
        try:
            module = importlib.import_module(f".{module_name}", package=__name__)
            if hasattr(module, "router"):
                available.append(module_name)
        except ImportError:
            pass
    return available


def set_all_app_states(app_state) -> None:
    """
    Set app_state for all routers that need it.

    This should be called during application startup to inject
    the app_state into all router modules.

    Args:
        app_state: The application state object with initialized analyzers
    """
    import importlib

    # Modules that have set_app_state functions
    modules_with_state = [
        "base",
        "accounting",
        "signals",
        "institutional",
        "analytics",
        "portfolio",
        "research",
        "commodities",
        "options",
        "etf",
        "macro",
        "notes",
        "market",
        "system",
        "settings",
    ]

    for module_name in modules_with_state:
        try:
            module = importlib.import_module(f".{module_name}", package=__name__)
            set_state_fn = getattr(module, "set_app_state", None)
            if set_state_fn:
                set_state_fn(app_state)
                logger.debug(f"Set app_state for router: {module_name}")
        except (ImportError, AttributeError) as e:
            logger.debug(f"Could not set app_state for {module_name}: {e}")


# Direct imports for backward compatibility
from .base import set_app_state as set_base_app_state


# Lazy loading for routers to avoid circular imports
def __getattr__(name: str):
    """Lazy load routers on demand."""
    import importlib

    # Map attribute names to module names
    router_map = {
        "system_router": "system",
        "market_router": "market",
        "institutional_router": "institutional",
        "analytics_router": "analytics",
        "portfolio_router": "portfolio",
        "research_router": "research",
        "commodities_router": "commodities",
        "options_router": "options",
        "etf_router": "etf",
        "macro_router": "macro",
        "accounting_router": "accounting",
        "signals_router": "signals",
        "notes_router": "notes",
        "settings_router": "settings",
        "search_router": "search",
        "bonds_router": "bonds",
        "websocket_router": "websocket",
    }

    # Handle setter functions
    setter_map = {
        "set_accounting_app_state": "accounting",
        "set_signals_app_state": "signals",
    }

    # Allow direct module access (e.g., routers.market, routers.analytics)
    # This is needed for patching in tests
    module_names = {
        "system",
        "market",
        "institutional",
        "analytics",
        "portfolio",
        "research",
        "commodities",
        "options",
        "etf",
        "macro",
        "accounting",
        "signals",
        "notes",
        "settings",
        "search",
        "bonds",
        "websocket",
        "base",
    }

    if name in router_map:
        module_name = router_map[name]
        try:
            module = importlib.import_module(f".{module_name}", package=__name__)
            return getattr(module, "router")
        except ImportError as e:
            raise AttributeError(
                f"Router '{name}' not available. Module '{module_name}' could not be imported: {e}"
            )

    if name in setter_map:
        module_name = setter_map[name]
        try:
            module = importlib.import_module(f".{module_name}", package=__name__)
            return getattr(module, "set_app_state")
        except (ImportError, AttributeError) as e:
            raise AttributeError(f"Function '{name}' not available: {e}")

    # Allow direct module access for patching
    if name in module_names:
        try:
            return importlib.import_module(f".{name}", package=__name__)
        except ImportError as e:
            raise AttributeError(f"Module '{name}' could not be imported: {e}")

    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


__all__ = [
    # Registration functions
    "register_routers",
    "get_router_info",
    "get_available_routers",
    "set_all_app_states",
    "ROUTER_CONFIG",
    # Individual routers (lazy loaded)
    "system_router",
    "market_router",
    "institutional_router",
    "analytics_router",
    "portfolio_router",
    "research_router",
    "commodities_router",
    "options_router",
    "etf_router",
    "macro_router",
    "accounting_router",
    "signals_router",
    "notes_router",
    "settings_router",
    "search_router",
    "bonds_router",
    "websocket_router",
    # Setter functions
    "set_base_app_state",
    "set_accounting_app_state",
    "set_signals_app_state",
]
