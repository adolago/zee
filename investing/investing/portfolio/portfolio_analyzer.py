"""
Portfolio Analyzer Module

High-level portfolio analytics combining risk metrics, position management,
and performance attribution. Integrates with DataManager for price data.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List

import numpy as np
import pandas as pd

from .position import create_holdings_from_input, get_sector
from .risk_metrics import (
    BetaResult,
    VaRResult,
    VolatilityMetrics,
    calculate_beta,
    calculate_correlation_matrix,
    calculate_portfolio_var,
    calculate_returns,
    calculate_sharpe_ratio,
    calculate_sortino_ratio,
    calculate_volatility_metrics,
)

logger = logging.getLogger(__name__)


@dataclass
class PortfolioSummary:
    """Summary of portfolio analytics."""

    total_value: float
    total_cost: float
    total_return: float
    total_return_percent: float
    beta: float
    alpha: float
    sharpe_ratio: float
    sortino_ratio: float
    var_95: float
    var_99: float
    var_95_percent: float
    var_99_percent: float
    volatility: float
    max_drawdown: float
    sector_exposure: Dict[str, float]
    top_holdings: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "totalValue": self.total_value,
            "totalCost": self.total_cost,
            "totalReturn": self.total_return,
            "totalReturnPercent": self.total_return_percent,
            "beta": self.beta,
            "alpha": self.alpha,
            "sharpeRatio": self.sharpe_ratio,
            "sortinoRatio": self.sortino_ratio,
            "var95": self.var_95,
            "var99": self.var_99,
            "var95Percent": self.var_95_percent,
            "var99Percent": self.var_99_percent,
            "volatility": self.volatility,
            "maxDrawdown": self.max_drawdown,
            "sectorExposure": self.sector_exposure,
            "topHoldings": self.top_holdings,
        }


class PortfolioAnalyzer:
    """
    Analyze portfolio risk and performance metrics.

    Provides VaR, beta, sector exposure, and performance attribution
    using historical data from DataManager.
    """

    def __init__(self, data_manager=None):
        """
        Initialize portfolio analyzer.

        Args:
            data_manager: DataManager instance for price data
        """
        self.data_manager = data_manager
        self._benchmark = "SPY"
        self._lookback_days = 252  # 1 year default
        logger.info("PortfolioAnalyzer initialized")

    async def analyze(
        self,
        holdings: List[Dict[str, Any]],
        benchmark: str = "SPY",
        lookback_days: int = 252,
    ) -> PortfolioSummary:
        """
        Perform comprehensive portfolio analysis.

        Args:
            holdings: List of holdings with symbol, shares, average_cost
            benchmark: Benchmark symbol for beta calculation
            lookback_days: Days of history for calculations

        Returns:
            PortfolioSummary with all analytics
        """
        if not holdings:
            return self._empty_summary()

        # Fetch current prices and create Holdings object
        prices = await self._fetch_current_prices([h["symbol"] for h in holdings])
        portfolio = create_holdings_from_input(holdings, prices)

        # Calculate basic metrics
        total_value = portfolio.total_market_value
        total_cost = portfolio.total_cost_basis
        total_return = portfolio.total_unrealized_pnl
        total_return_pct = portfolio.total_unrealized_pnl_percent

        # Get historical returns for risk calculations
        symbols = [p.symbol for p in portfolio.positions]
        returns_matrix = await self._fetch_returns_matrix(symbols, lookback_days)

        # Calculate weights
        weights = np.array([portfolio.get_weights().get(s, 0) for s in symbols])

        # VaR calculation
        var_result = await self.calculate_var(holdings, lookback_days=lookback_days)

        # Beta calculation
        beta_result = await self.calculate_beta(holdings, benchmark, lookback_days)

        # Calculate portfolio returns for Sharpe/Sortino
        if not returns_matrix.empty and len(weights) == len(returns_matrix.columns):
            portfolio_returns = (returns_matrix * weights).sum(axis=1)
            sharpe = calculate_sharpe_ratio(portfolio_returns)
            sortino = calculate_sortino_ratio(portfolio_returns)
            vol_metrics = calculate_volatility_metrics(portfolio_returns)
        else:
            sharpe = 0.0
            sortino = 0.0
            vol_metrics = VolatilityMetrics(0, 0, 0, 0, 0)

        # Sector exposure
        sector_exposure = portfolio.get_sector_weights()
        # Convert to percentages
        sector_exposure = {k: round(v * 100, 2) for k, v in sector_exposure.items()}

        # Top holdings
        holdings_df = portfolio.to_dataframe()
        if not holdings_df.empty:
            top_holdings = (
                holdings_df.nlargest(10, "market_value")[
                    [
                        "symbol",
                        "shares",
                        "average_cost",
                        "current_price",
                        "market_value",
                        "weight",
                    ]
                ]
                .round(2)
                .to_dict("records")
            )
        else:
            top_holdings = []

        return PortfolioSummary(
            total_value=round(total_value, 2),
            total_cost=round(total_cost, 2),
            total_return=round(total_return, 2),
            total_return_percent=round(total_return_pct, 2),
            beta=round(beta_result.beta, 3),
            alpha=round(beta_result.alpha, 4),
            sharpe_ratio=round(sharpe, 3),
            sortino_ratio=round(sortino, 3),
            var_95=round(var_result.var_95, 2),
            var_99=round(var_result.var_99, 2),
            var_95_percent=round(var_result.var_95_percent, 2),
            var_99_percent=round(var_result.var_99_percent, 2),
            volatility=round(vol_metrics.annualized_volatility * 100, 2),
            max_drawdown=round(vol_metrics.max_drawdown * 100, 2),
            sector_exposure=sector_exposure,
            top_holdings=top_holdings,
        )

    async def calculate_var(
        self,
        holdings: List[Dict[str, Any]],
        confidence: float = 0.95,
        method: str = "historical",
        lookback_days: int = 252,
    ) -> VaRResult:
        """
        Calculate Value at Risk for portfolio.

        Args:
            holdings: List of holdings with symbol, shares, average_cost
            confidence: Confidence level (default 95%)
            method: 'historical' or 'parametric'
            lookback_days: Days of history

        Returns:
            VaRResult with VaR and CVaR metrics
        """
        if not holdings:
            return VaRResult(0, 0, 0, 0, 0, 0, method, 0)

        # Fetch prices and create holdings
        prices = await self._fetch_current_prices([h["symbol"] for h in holdings])
        portfolio = create_holdings_from_input(holdings, prices)
        total_value = portfolio.total_market_value

        if total_value == 0:
            return VaRResult(0, 0, 0, 0, 0, 0, method, 0)

        # Get returns matrix
        symbols = [p.symbol for p in portfolio.positions]
        returns_matrix = await self._fetch_returns_matrix(symbols, lookback_days)

        if returns_matrix.empty:
            # Fallback to simple estimate
            return VaRResult(
                var_95=total_value * 0.02,
                var_99=total_value * 0.035,
                cvar_95=total_value * 0.025,
                cvar_99=total_value * 0.045,
                var_95_percent=2.0,
                var_99_percent=3.5,
                method="estimated",
                lookback_days=0,
            )

        # Calculate weights
        weights = np.array([portfolio.get_weights().get(s, 0) for s in symbols])

        # Ensure weights align with returns matrix columns
        aligned_weights = []
        for col in returns_matrix.columns:
            w = portfolio.get_weights().get(col, 0)
            aligned_weights.append(w)
        weights = np.array(aligned_weights)

        return calculate_portfolio_var(
            returns_matrix=returns_matrix,
            weights=weights,
            portfolio_value=total_value,
            method=method,
            lookback_days=lookback_days,
        )

    async def calculate_beta(
        self,
        holdings: List[Dict[str, Any]],
        benchmark: str = "SPY",
        lookback_days: int = 252,
    ) -> BetaResult:
        """
        Calculate portfolio beta against benchmark.

        Args:
            holdings: List of holdings
            benchmark: Benchmark symbol (default SPY)
            lookback_days: Days of history

        Returns:
            BetaResult with beta, alpha, r-squared
        """
        if not holdings:
            return BetaResult(1.0, 0.0, 0.0, 0.0, benchmark, 0)

        # Fetch prices and create holdings
        prices = await self._fetch_current_prices([h["symbol"] for h in holdings])
        portfolio = create_holdings_from_input(holdings, prices)

        # Get returns
        symbols = [p.symbol for p in portfolio.positions]
        returns_matrix = await self._fetch_returns_matrix(symbols, lookback_days)
        benchmark_returns = await self._fetch_returns(benchmark, lookback_days)

        if returns_matrix.empty or benchmark_returns.empty:
            return BetaResult(1.0, 0.0, 0.0, 0.0, benchmark, 0)

        # Calculate portfolio returns
        weights = np.array(
            [portfolio.get_weights().get(s, 0) for s in returns_matrix.columns]
        )
        portfolio_returns = (returns_matrix * weights).sum(axis=1)

        result = calculate_beta(portfolio_returns, benchmark_returns)
        result.benchmark = benchmark
        return result

    async def get_sector_exposure(
        self,
        holdings: List[Dict[str, Any]],
    ) -> Dict[str, float]:
        """
        Get portfolio sector exposure.

        Args:
            holdings: List of holdings

        Returns:
            Dict mapping sector to weight percentage
        """
        if not holdings:
            return {}

        prices = await self._fetch_current_prices([h["symbol"] for h in holdings])
        portfolio = create_holdings_from_input(holdings, prices)

        sector_weights = portfolio.get_sector_weights()
        return {k: round(v * 100, 2) for k, v in sector_weights.items()}

    async def get_correlation_matrix(
        self,
        holdings: List[Dict[str, Any]],
        lookback_days: int = 252,
    ) -> pd.DataFrame:
        """
        Get correlation matrix for portfolio holdings.

        Args:
            holdings: List of holdings
            lookback_days: Days of history

        Returns:
            Correlation matrix DataFrame
        """
        symbols = [h["symbol"] for h in holdings]
        returns_matrix = await self._fetch_returns_matrix(symbols, lookback_days)

        if returns_matrix.empty:
            return pd.DataFrame()

        return calculate_correlation_matrix(returns_matrix)

    async def get_performance_attribution(
        self,
        holdings: List[Dict[str, Any]],
        period: str = "1M",
    ) -> Dict[str, Any]:
        """
        Get performance attribution by sector.

        Args:
            holdings: List of holdings
            period: Period for attribution ('1M', '3M', '1Y')

        Returns:
            Dict with attribution breakdown
        """
        if not holdings:
            return {"total_return": 0, "by_sector": {}, "by_holding": []}

        period_days = {"1M": 21, "3M": 63, "6M": 126, "1Y": 252}.get(period, 21)

        # Fetch historical and current prices
        symbols = [h["symbol"] for h in holdings]
        returns_matrix = await self._fetch_returns_matrix(symbols, period_days)
        current_prices = await self._fetch_current_prices(symbols)

        portfolio = create_holdings_from_input(holdings, current_prices)
        weights = portfolio.get_weights()

        # Calculate contribution by holding
        by_holding = []
        by_sector = {}

        for symbol in symbols:
            if symbol not in returns_matrix.columns:
                continue

            period_return = (returns_matrix[symbol] + 1).prod() - 1
            weight = weights.get(symbol, 0)
            contribution = period_return * weight * 100

            sector = get_sector(symbol)
            by_sector[sector] = by_sector.get(sector, 0) + contribution

            by_holding.append(
                {
                    "symbol": symbol,
                    "weight": round(weight * 100, 2),
                    "return": round(period_return * 100, 2),
                    "contribution": round(contribution, 2),
                    "sector": sector,
                }
            )

        # Sort by contribution
        by_holding.sort(key=lambda x: abs(x["contribution"]), reverse=True)

        total_return = sum(h["contribution"] for h in by_holding)

        return {
            "period": period,
            "total_return": round(total_return, 2),
            "by_sector": {k: round(v, 2) for k, v in by_sector.items()},
            "by_holding": by_holding[:10],  # Top 10 contributors
        }

    async def _fetch_current_prices(
        self,
        symbols: List[str],
    ) -> Dict[str, float]:
        """Fetch current prices for symbols."""
        prices = {}
        end_date = datetime.now()
        start_date = end_date - timedelta(days=5)

        for symbol in symbols:
            try:
                if self.data_manager:
                    data = await self.data_manager.get_stock_data(
                        symbol, start_date, end_date
                    )
                    if not data.empty:
                        prices[symbol] = float(data.iloc[-1]["close"])
                    else:
                        prices[symbol] = 100.0  # Fallback
                else:
                    prices[symbol] = 100.0 + np.random.uniform(-20, 50)
            except Exception as e:
                logger.warning(f"Failed to fetch price for {symbol}: {e}")
                prices[symbol] = 100.0

        return prices

    async def _fetch_returns_matrix(
        self,
        symbols: List[str],
        lookback_days: int,
    ) -> pd.DataFrame:
        """Fetch returns matrix for symbols."""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days + 10)  # Extra buffer

        returns_dict = {}

        for symbol in symbols:
            try:
                if self.data_manager:
                    data = await self.data_manager.get_stock_data(
                        symbol, start_date, end_date
                    )
                    if not data.empty and "close" in data.columns:
                        returns = calculate_returns(data["close"])
                        returns_dict[symbol] = returns
                else:
                    # Mock returns
                    dates = pd.date_range(start=start_date, end=end_date, freq="D")
                    returns = pd.Series(
                        np.random.normal(0.001, 0.02, len(dates)), index=dates
                    )
                    returns_dict[symbol] = returns
            except Exception as e:
                logger.warning(f"Failed to fetch returns for {symbol}: {e}")

        if not returns_dict:
            return pd.DataFrame()

        # Combine into matrix
        df = pd.DataFrame(returns_dict)
        return df.dropna()

    async def _fetch_returns(
        self,
        symbol: str,
        lookback_days: int,
    ) -> pd.Series:
        """Fetch returns for a single symbol."""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days + 10)

        try:
            if self.data_manager:
                data = await self.data_manager.get_stock_data(
                    symbol, start_date, end_date
                )
                if not data.empty and "close" in data.columns:
                    return calculate_returns(data["close"])
            else:
                dates = pd.date_range(start=start_date, end=end_date, freq="D")
                return pd.Series(np.random.normal(0.001, 0.02, len(dates)), index=dates)
        except Exception as e:
            logger.warning(f"Failed to fetch returns for {symbol}: {e}")

        return pd.Series()

    def _empty_summary(self) -> PortfolioSummary:
        """Return empty portfolio summary."""
        return PortfolioSummary(
            total_value=0,
            total_cost=0,
            total_return=0,
            total_return_percent=0,
            beta=1.0,
            alpha=0,
            sharpe_ratio=0,
            sortino_ratio=0,
            var_95=0,
            var_99=0,
            var_95_percent=0,
            var_99_percent=0,
            volatility=0,
            max_drawdown=0,
            sector_exposure={},
            top_holdings=[],
        )

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return True
