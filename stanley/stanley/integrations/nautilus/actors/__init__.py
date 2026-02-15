"""
NautilusTrader Actors for Stanley Analytics

Actors that integrate Stanley's institutional analysis capabilities
into the NautilusTrader event-driven architecture.
"""

from stanley.integrations.nautilus.actors.money_flow_actor import (
    MoneyFlowActor,
    MoneyFlowActorConfig,
)
from stanley.integrations.nautilus.actors.institutional_actor import (
    InstitutionalActor,
    InstitutionalActorConfig,
)

__all__ = [
    "MoneyFlowActor",
    "MoneyFlowActorConfig",
    "InstitutionalActor",
    "InstitutionalActorConfig",
]
