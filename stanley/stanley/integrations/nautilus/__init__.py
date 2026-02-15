"""
NautilusTrader Integration for Stanley

Provides Actors, Indicators, and Data Clients that integrate Stanley's
institutional analytics with the NautilusTrader algorithmic trading framework.

Components:
- Actors: Event-driven components for institutional analysis (standalone, no nautilus required)
- Indicators: Custom indicators for smart money tracking (requires nautilus_trader)
- Data Client: OpenBB-based data provider for NautilusTrader (requires nautilus_trader)

Usage:
    # Actors work without nautilus_trader installed:
    from stanley.integrations.nautilus.actors import (
        MoneyFlowActor,
        MoneyFlowActorConfig,
    )

    # Full integration requires nautilus_trader:
    from stanley.integrations.nautilus import (
        OpenBBDataClient,
        OpenBBDataClientConfig,
        SmartMoneyIndicator,
    )
"""

# Actors are standalone and don't require nautilus_trader
from stanley.integrations.nautilus.actors import (
    MoneyFlowActor,
    MoneyFlowActorConfig,
    InstitutionalActor,
    InstitutionalActorConfig,
)

# Config module is also standalone
from stanley.integrations.nautilus.config import (
    OpenBBDataClientConfig,
    OpenBBDataClientConfigFull,
    OpenBBProviderConfig,
    InstrumentConfig,
    BarSubscriptionConfig,
)

# Check if nautilus_trader is available for optional components
try:
    import nautilus_trader as _nt  # noqa: F401

    _HAS_NAUTILUS = True
except ImportError:
    _HAS_NAUTILUS = False

# Conditionally import components that require nautilus_trader
if _HAS_NAUTILUS:
    from stanley.integrations.nautilus.indicators import (
        SmartMoneyIndicator,
        InstitutionalMomentumIndicator,
    )
    from stanley.integrations.nautilus.data_client import (
        OpenBBDataClient,
        OpenBBLiveDataClient,
    )
    from stanley.integrations.nautilus.data_types import (
        OpenBBBarConverter,
        OpenBBQuoteTickConverter,
        OpenBBTradeTickConverter,
        OpenBBInstrumentProvider,
        create_instrument_id,
        create_bar_type,
        parse_aggregation_string,
    )

__all__ = [
    # Actors (always available)
    "MoneyFlowActor",
    "MoneyFlowActorConfig",
    "InstitutionalActor",
    "InstitutionalActorConfig",
    # Configuration (always available)
    "OpenBBDataClientConfig",
    "OpenBBDataClientConfigFull",
    "OpenBBProviderConfig",
    "InstrumentConfig",
    "BarSubscriptionConfig",
]

# Add nautilus-dependent exports when available
if _HAS_NAUTILUS:
    __all__.extend(
        [
            # Indicators
            "SmartMoneyIndicator",
            "InstitutionalMomentumIndicator",
            # Data Client
            "OpenBBDataClient",
            "OpenBBLiveDataClient",
            # Data Types
            "OpenBBBarConverter",
            "OpenBBQuoteTickConverter",
            "OpenBBTradeTickConverter",
            "OpenBBInstrumentProvider",
            # Utilities
            "create_instrument_id",
            "create_bar_type",
            "parse_aggregation_string",
        ]
    )
