"""
NautilusTrader Strategy Templates for Investing

Production-ready trading strategies that integrate Investing's institutional
analytics with NautilusTrader's execution framework.

Available Strategies:
- InstitutionalMomentumStrategy: Long/short based on institutional accumulation
- DarkPoolBreakoutStrategy: Breakout trades triggered by unusual dark pool activity
- SmartMoneyReversalStrategy: Mean-reversion when smart money diverges from price
"""

from investing.integrations.nautilus.strategies.base import (
    InvestingStrategyConfig,
    InvestingStrategy,
)
from investing.integrations.nautilus.strategies.institutional_momentum import (
    InstitutionalMomentumStrategy,
    InstitutionalMomentumStrategyConfig,
)
from investing.integrations.nautilus.strategies.dark_pool_breakout import (
    DarkPoolBreakoutStrategy,
    DarkPoolBreakoutStrategyConfig,
)
from investing.integrations.nautilus.strategies.smart_money_reversal import (
    SmartMoneyReversalStrategy,
    SmartMoneyReversalStrategyConfig,
)

__all__ = [
    # Base
    "InvestingStrategyConfig",
    "InvestingStrategy",
    # Strategies
    "InstitutionalMomentumStrategy",
    "InstitutionalMomentumStrategyConfig",
    "DarkPoolBreakoutStrategy",
    "DarkPoolBreakoutStrategyConfig",
    "SmartMoneyReversalStrategy",
    "SmartMoneyReversalStrategyConfig",
]
