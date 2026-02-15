"""
NautilusTrader Strategy Templates for Stanley

Production-ready trading strategies that integrate Stanley's institutional
analytics with NautilusTrader's execution framework.

Available Strategies:
- InstitutionalMomentumStrategy: Long/short based on institutional accumulation
- DarkPoolBreakoutStrategy: Breakout trades triggered by unusual dark pool activity
- SmartMoneyReversalStrategy: Mean-reversion when smart money diverges from price
"""

from stanley.integrations.nautilus.strategies.base import (
    StanleyStrategyConfig,
    StanleyStrategy,
)
from stanley.integrations.nautilus.strategies.institutional_momentum import (
    InstitutionalMomentumStrategy,
    InstitutionalMomentumStrategyConfig,
)
from stanley.integrations.nautilus.strategies.dark_pool_breakout import (
    DarkPoolBreakoutStrategy,
    DarkPoolBreakoutStrategyConfig,
)
from stanley.integrations.nautilus.strategies.smart_money_reversal import (
    SmartMoneyReversalStrategy,
    SmartMoneyReversalStrategyConfig,
)

__all__ = [
    # Base
    "StanleyStrategyConfig",
    "StanleyStrategy",
    # Strategies
    "InstitutionalMomentumStrategy",
    "InstitutionalMomentumStrategyConfig",
    "DarkPoolBreakoutStrategy",
    "DarkPoolBreakoutStrategyConfig",
    "SmartMoneyReversalStrategy",
    "SmartMoneyReversalStrategyConfig",
]
