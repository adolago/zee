"""
Portfolio Analytics Module

Provides portfolio risk metrics, VaR calculations, beta analysis,
sector exposure, and performance attribution.
"""

from .portfolio_analyzer import PortfolioAnalyzer, PortfolioSummary
from .position import Holdings, Position, create_holdings_from_input, get_sector
from .risk_metrics import (
    BetaResult,
    VaRResult,
    VolatilityMetrics,
    calculate_beta,
    calculate_correlation_matrix,
    calculate_covariance_matrix,
    calculate_portfolio_var,
    calculate_returns,
    calculate_sharpe_ratio,
    calculate_sortino_ratio,
    calculate_var_historical,
    calculate_var_parametric,
    calculate_volatility_metrics,
)

__all__ = [
    # Main analyzer
    "PortfolioAnalyzer",
    "PortfolioSummary",
    # Position management
    "Holdings",
    "Position",
    "create_holdings_from_input",
    "get_sector",
    # Risk metrics
    "VaRResult",
    "BetaResult",
    "VolatilityMetrics",
    "calculate_var_historical",
    "calculate_var_parametric",
    "calculate_portfolio_var",
    "calculate_beta",
    "calculate_returns",
    "calculate_sharpe_ratio",
    "calculate_sortino_ratio",
    "calculate_volatility_metrics",
    "calculate_correlation_matrix",
    "calculate_covariance_matrix",
]
