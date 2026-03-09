"""
Investing Integrations Package

Provides integrations with external trading and data platforms:
- nautilus: NautilusTrader integration for algorithmic trading
- riskfolio: Riskfolio-Lib for advanced portfolio optimization
- alphalens: Factor analysis and validation
- pyfolio: Performance tear sheets and risk analysis
- options: Options pricing, Greeks, and strategy analysis

Users should import directly from submodules:
  from investing.integrations.nautilus.actors import MoneyFlowActor
  from investing.integrations.riskfolio import RiskfolioOptimizer
  from investing.integrations.alphalens import FactorAnalyzer
  from investing.integrations.pyfolio import TearSheetGenerator
  from investing.integrations.options import OptionsPricer, OptionsStrategyAnalyzer
"""

# Import nautilus subpackage - it handles its own ImportError for nautilus_trader
from . import nautilus

# Conditionally import optional integrations
_OPTIONAL_INTEGRATIONS = []

try:
    from . import riskfolio

    _OPTIONAL_INTEGRATIONS.append("riskfolio")
except ImportError:
    riskfolio = None

try:
    from . import alphalens

    _OPTIONAL_INTEGRATIONS.append("alphalens")
except ImportError:
    alphalens = None

try:
    from . import pyfolio

    _OPTIONAL_INTEGRATIONS.append("pyfolio")
except ImportError:
    pyfolio = None

try:
    from . import options

    _OPTIONAL_INTEGRATIONS.append("options")
except ImportError:
    options = None

__all__ = ["nautilus", "riskfolio", "alphalens", "pyfolio", "options"]
