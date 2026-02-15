"""
Risk Metrics Module

Calculate Value at Risk (VaR), Conditional VaR (CVaR), beta,
and other portfolio risk metrics using historical simulation
and parametric methods.
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class VaRResult:
    """Value at Risk calculation result."""

    var_95: float  # 95% VaR (dollar amount)
    var_99: float  # 99% VaR (dollar amount)
    cvar_95: float  # 95% CVaR/Expected Shortfall
    cvar_99: float  # 99% CVaR/Expected Shortfall
    var_95_percent: float  # As percentage of portfolio
    var_99_percent: float
    method: str  # Calculation method used
    lookback_days: int


@dataclass
class BetaResult:
    """Beta calculation result."""

    beta: float
    alpha: float  # Jensen's alpha
    r_squared: float
    correlation: float
    benchmark: str
    lookback_days: int


@dataclass
class VolatilityMetrics:
    """Volatility metrics for portfolio."""

    daily_volatility: float
    annualized_volatility: float
    downside_volatility: float  # Sortino denominator
    max_drawdown: float
    max_drawdown_duration: int  # Days


def calculate_returns(prices: pd.Series) -> pd.Series:
    """Calculate log returns from price series."""
    return np.log(prices / prices.shift(1)).dropna()


def calculate_var_historical(
    returns: pd.Series,
    portfolio_value: float,
    confidence_levels: List[float] = [0.95, 0.99],
) -> Dict[float, float]:
    """
    Calculate VaR using historical simulation method.

    Args:
        returns: Series of portfolio returns
        portfolio_value: Current portfolio value
        confidence_levels: Confidence levels for VaR

    Returns:
        Dictionary mapping confidence level to VaR amount
    """
    results = {}
    for confidence in confidence_levels:
        # VaR is the negative of the percentile (since we want loss)
        percentile = (1 - confidence) * 100
        var_return = np.percentile(returns, percentile)
        results[confidence] = -var_return * portfolio_value
    return results


def calculate_var_parametric(
    returns: pd.Series,
    portfolio_value: float,
    confidence_levels: List[float] = [0.95, 0.99],
) -> Dict[float, float]:
    """
    Calculate VaR using parametric (variance-covariance) method.
    Assumes normal distribution of returns.

    Args:
        returns: Series of portfolio returns
        portfolio_value: Current portfolio value
        confidence_levels: Confidence levels for VaR

    Returns:
        Dictionary mapping confidence level to VaR amount
    """
    mu = returns.mean()
    sigma = returns.std()

    results = {}
    for confidence in confidence_levels:
        z_score = stats.norm.ppf(1 - confidence)
        var_return = mu + z_score * sigma
        results[confidence] = -var_return * portfolio_value
    return results


def calculate_cvar(
    returns: pd.Series,
    portfolio_value: float,
    confidence_levels: List[float] = [0.95, 0.99],
) -> Dict[float, float]:
    """
    Calculate Conditional VaR (Expected Shortfall).
    CVaR is the expected loss given that the loss exceeds VaR.

    Args:
        returns: Series of portfolio returns
        portfolio_value: Current portfolio value
        confidence_levels: Confidence levels for CVaR

    Returns:
        Dictionary mapping confidence level to CVaR amount
    """
    results = {}
    for confidence in confidence_levels:
        percentile = (1 - confidence) * 100
        var_return = np.percentile(returns, percentile)
        # CVaR is the mean of returns below VaR
        tail_returns = returns[returns <= var_return]
        if len(tail_returns) > 0:
            cvar_return = tail_returns.mean()
        else:
            cvar_return = var_return
        results[confidence] = -cvar_return * portfolio_value
    return results


def calculate_portfolio_var(
    returns_matrix: pd.DataFrame,
    weights: np.ndarray,
    portfolio_value: float,
    method: str = "historical",
    lookback_days: int = 252,
) -> VaRResult:
    """
    Calculate portfolio VaR with multiple methods.

    Args:
        returns_matrix: DataFrame with asset returns (columns = assets)
        weights: Portfolio weights array
        portfolio_value: Total portfolio value
        method: 'historical' or 'parametric'
        lookback_days: Number of days to use

    Returns:
        VaRResult with VaR and CVaR metrics
    """
    # Calculate portfolio returns
    if len(returns_matrix) > lookback_days:
        returns_matrix = returns_matrix.tail(lookback_days)

    portfolio_returns = (returns_matrix * weights).sum(axis=1)

    if method == "parametric":
        var_dict = calculate_var_parametric(portfolio_returns, portfolio_value)
    else:
        var_dict = calculate_var_historical(portfolio_returns, portfolio_value)

    cvar_dict = calculate_cvar(portfolio_returns, portfolio_value)

    return VaRResult(
        var_95=var_dict[0.95],
        var_99=var_dict[0.99],
        cvar_95=cvar_dict[0.95],
        cvar_99=cvar_dict[0.99],
        var_95_percent=(var_dict[0.95] / portfolio_value) * 100,
        var_99_percent=(var_dict[0.99] / portfolio_value) * 100,
        method=method,
        lookback_days=min(lookback_days, len(returns_matrix)),
    )


def calculate_beta(
    asset_returns: pd.Series,
    benchmark_returns: pd.Series,
    risk_free_rate: float = 0.0,
) -> BetaResult:
    """
    Calculate beta and related regression metrics.

    Args:
        asset_returns: Series of asset/portfolio returns
        benchmark_returns: Series of benchmark returns
        risk_free_rate: Annual risk-free rate (default 0)

    Returns:
        BetaResult with beta, alpha, r-squared
    """
    # Align the series
    aligned = pd.concat([asset_returns, benchmark_returns], axis=1).dropna()
    if len(aligned) < 10:
        logger.warning("Insufficient data for beta calculation")
        return BetaResult(
            beta=1.0,
            alpha=0.0,
            r_squared=0.0,
            correlation=0.0,
            benchmark="N/A",
            lookback_days=len(aligned),
        )

    asset_ret = aligned.iloc[:, 0]
    bench_ret = aligned.iloc[:, 1]

    # Calculate beta using covariance method
    covariance = np.cov(asset_ret, bench_ret)[0, 1]
    benchmark_variance = np.var(bench_ret)

    if benchmark_variance == 0:
        beta = 1.0
    else:
        beta = covariance / benchmark_variance

    # Calculate alpha (Jensen's alpha)
    daily_rf = risk_free_rate / 252
    excess_asset = asset_ret.mean() - daily_rf
    excess_bench = bench_ret.mean() - daily_rf
    alpha = excess_asset - beta * excess_bench

    # Annualize alpha
    alpha_annual = alpha * 252

    # R-squared
    correlation = np.corrcoef(asset_ret, bench_ret)[0, 1]
    r_squared = correlation**2

    return BetaResult(
        beta=beta,
        alpha=alpha_annual,
        r_squared=r_squared,
        correlation=correlation,
        benchmark="",  # Will be set by caller
        lookback_days=len(aligned),
    )


def calculate_volatility_metrics(
    returns: pd.Series,
    prices: Optional[pd.Series] = None,
    annualization_factor: int = 252,
) -> VolatilityMetrics:
    """
    Calculate comprehensive volatility metrics.

    Args:
        returns: Series of returns
        prices: Optional price series for drawdown calculation
        annualization_factor: Trading days per year

    Returns:
        VolatilityMetrics with various volatility measures
    """
    # Daily and annualized volatility
    daily_vol = returns.std()
    annual_vol = daily_vol * np.sqrt(annualization_factor)

    # Downside volatility (for Sortino ratio)
    negative_returns = returns[returns < 0]
    if len(negative_returns) > 0:
        downside_vol = negative_returns.std() * np.sqrt(annualization_factor)
    else:
        downside_vol = 0.0

    # Max drawdown
    if prices is not None and len(prices) > 0:
        cummax = prices.cummax()
        drawdown = (prices - cummax) / cummax
        max_dd = drawdown.min()

        # Max drawdown duration
        in_drawdown = drawdown < 0
        if in_drawdown.any():
            drawdown_periods = (
                (~in_drawdown)
                .cumsum()
                .where(in_drawdown)
                .groupby((~in_drawdown).cumsum())
            )
            if len(drawdown_periods) > 0:
                max_dd_duration = (
                    in_drawdown.groupby((~in_drawdown).cumsum()).sum().max()
                )
            else:
                max_dd_duration = 0
        else:
            max_dd_duration = 0
    else:
        # Estimate from returns
        cumulative = (1 + returns).cumprod()
        cummax = cumulative.cummax()
        drawdown = (cumulative - cummax) / cummax
        max_dd = drawdown.min()
        max_dd_duration = 0

    return VolatilityMetrics(
        daily_volatility=daily_vol,
        annualized_volatility=annual_vol,
        downside_volatility=downside_vol,
        max_drawdown=max_dd,
        max_drawdown_duration=max_dd_duration,
    )


def calculate_sharpe_ratio(
    returns: pd.Series,
    risk_free_rate: float = 0.0,
    annualization_factor: int = 252,
) -> float:
    """
    Calculate Sharpe ratio.

    Args:
        returns: Series of returns
        risk_free_rate: Annual risk-free rate
        annualization_factor: Trading days per year

    Returns:
        Sharpe ratio
    """
    daily_rf = risk_free_rate / annualization_factor
    excess_returns = returns - daily_rf

    if excess_returns.std() == 0:
        return 0.0

    return (excess_returns.mean() / excess_returns.std()) * np.sqrt(
        annualization_factor
    )


def calculate_sortino_ratio(
    returns: pd.Series,
    risk_free_rate: float = 0.0,
    annualization_factor: int = 252,
) -> float:
    """
    Calculate Sortino ratio (uses downside volatility).

    Args:
        returns: Series of returns
        risk_free_rate: Annual risk-free rate
        annualization_factor: Trading days per year

    Returns:
        Sortino ratio
    """
    daily_rf = risk_free_rate / annualization_factor
    excess_returns = returns - daily_rf

    negative_returns = excess_returns[excess_returns < 0]
    if len(negative_returns) == 0 or negative_returns.std() == 0:
        return 0.0 if excess_returns.mean() <= 0 else float("inf")

    downside_std = negative_returns.std()
    return (excess_returns.mean() / downside_std) * np.sqrt(annualization_factor)


def calculate_sector_exposure(
    holdings: Dict[str, float],
    sector_mapping: Dict[str, str],
) -> Dict[str, float]:
    """
    Calculate sector exposure from holdings.

    Args:
        holdings: Dict mapping symbol to weight
        sector_mapping: Dict mapping symbol to sector

    Returns:
        Dict mapping sector to total weight
    """
    sector_weights = {}
    for symbol, weight in holdings.items():
        sector = sector_mapping.get(symbol, "Other")
        sector_weights[sector] = sector_weights.get(sector, 0) + weight

    return sector_weights


def calculate_correlation_matrix(returns_matrix: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate correlation matrix for portfolio assets.

    Args:
        returns_matrix: DataFrame with asset returns

    Returns:
        Correlation matrix DataFrame
    """
    return returns_matrix.corr()


def calculate_covariance_matrix(
    returns_matrix: pd.DataFrame,
    annualize: bool = True,
) -> pd.DataFrame:
    """
    Calculate covariance matrix for portfolio assets.

    Args:
        returns_matrix: DataFrame with asset returns
        annualize: Whether to annualize (multiply by 252)

    Returns:
        Covariance matrix DataFrame
    """
    cov = returns_matrix.cov()
    if annualize:
        cov = cov * 252
    return cov
