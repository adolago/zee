"""
Options Integration for Stanley

Provides options pricing and analysis:
- Black-Scholes pricing
- Greeks calculation (delta, gamma, theta, vega, rho)
- Implied volatility solving
- Options strategy analysis
"""

from .pricing import OptionsPricer, OptionPrice, GreeksResult
from .strategies import OptionsStrategyAnalyzer, StrategyPayoff

__all__ = [
    "OptionsPricer",
    "OptionPrice",
    "GreeksResult",
    "OptionsStrategyAnalyzer",
    "StrategyPayoff",
]
