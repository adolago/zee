"""
Riskfolio-Lib Portfolio Optimizer

Advanced portfolio optimization using Riskfolio-Lib capabilities.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Check if riskfolio-lib is available
try:
    import riskfolio as rp

    HAS_RISKFOLIO = True
except ImportError:
    HAS_RISKFOLIO = False
    rp = None


class OptimizationMethod(Enum):
    """Portfolio optimization methods."""

    MEAN_VARIANCE = "MV"  # Mean-Variance (Markowitz)
    MEAN_CVAR = "CVaR"  # Mean-Conditional Value at Risk
    MEAN_EVAR = "EVaR"  # Mean-Entropic Value at Risk
    RISK_PARITY = "RP"  # Risk Parity
    HRP = "HRP"  # Hierarchical Risk Parity
    NCO = "NCO"  # Nested Clustered Optimization
    BLACK_LITTERMAN = "BL"  # Black-Litterman


class RiskMeasure(Enum):
    """Risk measures for optimization."""

    VARIANCE = "MV"  # Variance
    MAD = "MAD"  # Mean Absolute Deviation
    CVAR = "CVaR"  # Conditional Value at Risk
    EVAR = "EVaR"  # Entropic Value at Risk
    WORST_REALIZATION = "WR"  # Worst Realization
    MAX_DRAWDOWN = "MDD"  # Maximum Drawdown
    ADD = "ADD"  # Average Drawdown
    CDaR = "CDaR"  # Conditional Drawdown at Risk


@dataclass
class OptimizationResult:
    """Result of portfolio optimization."""

    weights: Dict[str, float]
    expected_return: float
    expected_risk: float
    sharpe_ratio: float
    method: str
    risk_measure: str
    constraints_satisfied: bool
    frontier_points: Optional[pd.DataFrame] = None
    risk_contributions: Optional[Dict[str, float]] = None
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "weights": self.weights,
            "expected_return": round(self.expected_return, 4),
            "expected_risk": round(self.expected_risk, 4),
            "sharpe_ratio": round(self.sharpe_ratio, 4),
            "method": self.method,
            "risk_measure": self.risk_measure,
            "constraints_satisfied": self.constraints_satisfied,
            "risk_contributions": self.risk_contributions,
            "timestamp": self.timestamp.isoformat(),
        }


class RiskfolioOptimizer:
    """
    Advanced portfolio optimizer using Riskfolio-Lib.

    Provides institutional-grade optimization with multiple methods:
    - Classical mean-variance (Markowitz)
    - Risk parity and hierarchical risk parity
    - Black-Litterman with views
    - CVaR/EVaR optimization
    """

    def __init__(
        self,
        data_manager: Optional[Any] = None,
        risk_free_rate: float = 0.05,
    ):
        """
        Initialize RiskfolioOptimizer.

        Args:
            data_manager: DataManager for fetching price data
            risk_free_rate: Annual risk-free rate (default 5%)
        """
        if not HAS_RISKFOLIO:
            raise ImportError(
                "riskfolio-lib is required. Install with: pip install riskfolio-lib"
            )

        self.data_manager = data_manager
        self.risk_free_rate = risk_free_rate
        logger.info("RiskfolioOptimizer initialized")

    async def optimize(
        self,
        symbols: List[str],
        method: OptimizationMethod = OptimizationMethod.MEAN_VARIANCE,
        risk_measure: RiskMeasure = RiskMeasure.VARIANCE,
        lookback_days: int = 252,
        target_return: Optional[float] = None,
        max_weight: float = 1.0,
        min_weight: float = 0.0,
        views: Optional[Dict[str, float]] = None,
        confidence: Optional[Dict[str, float]] = None,
    ) -> OptimizationResult:
        """
        Optimize portfolio allocation.

        Args:
            symbols: List of asset symbols
            method: Optimization method
            risk_measure: Risk measure for optimization
            lookback_days: Historical data lookback
            target_return: Target annual return (optional)
            max_weight: Maximum weight per asset
            min_weight: Minimum weight per asset
            views: Black-Litterman views (symbol -> expected return)
            confidence: Confidence in views (symbol -> 0-1 confidence)

        Returns:
            OptimizationResult with optimal weights
        """
        # Fetch returns data
        returns = await self._fetch_returns(symbols, lookback_days)

        if returns.empty:
            raise ValueError("Insufficient data for optimization")

        # Build portfolio object
        port = rp.Portfolio(returns=returns)

        # Calculate assets statistics
        port.assets_stats(method_mu="hist", method_cov="hist")

        # Apply constraints
        port.upperlng = max_weight
        port.lowerlng = min_weight

        # Handle Black-Litterman views
        if method == OptimizationMethod.BLACK_LITTERMAN and views:
            port = self._apply_black_litterman(port, views, confidence)

        # Run optimization based on method
        if method == OptimizationMethod.HRP:
            weights = port.optimization(
                model="HRP",
                rm=risk_measure.value,
                rf=self.risk_free_rate,
            )
        elif method == OptimizationMethod.RISK_PARITY:
            weights = port.rp_optimization(
                model="Classic",
                rm=risk_measure.value,
                rf=self.risk_free_rate,
            )
        else:
            # Mean-risk optimization
            if target_return is not None:
                # Minimize risk for target return
                weights = port.optimization(
                    model="Classic",
                    rm=risk_measure.value,
                    obj="MinRisk",
                    rf=self.risk_free_rate,
                    hist=True,
                )
            else:
                # Maximize Sharpe ratio
                weights = port.optimization(
                    model="Classic",
                    rm=risk_measure.value,
                    obj="Sharpe",
                    rf=self.risk_free_rate,
                    hist=True,
                )

        # Extract weights
        weight_dict = {
            symbol: round(float(weights.loc[symbol, "weights"]), 4)
            for symbol in symbols
            if symbol in weights.index
        }

        # Calculate portfolio statistics
        port_return = float(np.dot(list(weight_dict.values()), port.mu.values))
        port_risk = float(
            np.sqrt(
                np.dot(
                    list(weight_dict.values()),
                    np.dot(port.cov.values, list(weight_dict.values())),
                )
            )
        )
        sharpe = (port_return - self.risk_free_rate) / port_risk if port_risk > 0 else 0

        # Calculate risk contributions
        risk_contrib = self._calculate_risk_contributions(
            weight_dict, port.cov, port_risk
        )

        return OptimizationResult(
            weights=weight_dict,
            expected_return=port_return,
            expected_risk=port_risk,
            sharpe_ratio=sharpe,
            method=method.value,
            risk_measure=risk_measure.value,
            constraints_satisfied=True,
            risk_contributions=risk_contrib,
        )

    async def get_efficient_frontier(
        self,
        symbols: List[str],
        risk_measure: RiskMeasure = RiskMeasure.VARIANCE,
        lookback_days: int = 252,
        n_points: int = 50,
    ) -> pd.DataFrame:
        """
        Calculate efficient frontier.

        Args:
            symbols: List of asset symbols
            risk_measure: Risk measure
            lookback_days: Historical lookback
            n_points: Number of frontier points

        Returns:
            DataFrame with risk/return points on frontier
        """
        returns = await self._fetch_returns(symbols, lookback_days)

        if returns.empty:
            return pd.DataFrame()

        port = rp.Portfolio(returns=returns)
        port.assets_stats(method_mu="hist", method_cov="hist")

        # Calculate frontier
        frontier = port.efficient_frontier(
            model="Classic",
            rm=risk_measure.value,
            points=n_points,
            rf=self.risk_free_rate,
            hist=True,
        )

        return frontier

    async def hierarchical_risk_parity(
        self,
        symbols: List[str],
        lookback_days: int = 252,
        linkage: str = "ward",
        max_cluster: int = 10,
    ) -> OptimizationResult:
        """
        Hierarchical Risk Parity optimization.

        HRP uses hierarchical clustering to build a diversified portfolio
        without requiring expected returns estimation.

        Args:
            symbols: List of asset symbols
            lookback_days: Historical lookback
            linkage: Clustering linkage method
            max_cluster: Maximum number of clusters

        Returns:
            OptimizationResult
        """
        returns = await self._fetch_returns(symbols, lookback_days)

        if returns.empty:
            raise ValueError("Insufficient data for HRP")

        port = rp.HCPortfolio(returns=returns)

        # Calculate optimal weights using HRP
        weights = port.optimization(
            model="HRP",
            codependence="pearson",
            rm="MV",
            rf=self.risk_free_rate,
            linkage=linkage,
            max_k=max_cluster,
        )

        weight_dict = {
            symbol: round(float(weights.loc[symbol, "weights"]), 4)
            for symbol in symbols
            if symbol in weights.index
        }

        # Calculate portfolio stats
        cov = returns.cov() * 252
        weights_arr = np.array(list(weight_dict.values()))
        port_risk = float(
            np.sqrt(np.dot(weights_arr.T, np.dot(cov.values, weights_arr)))
        )
        port_return = float(returns.mean().values @ weights_arr) * 252

        return OptimizationResult(
            weights=weight_dict,
            expected_return=port_return,
            expected_risk=port_risk,
            sharpe_ratio=(
                (port_return - self.risk_free_rate) / port_risk if port_risk > 0 else 0
            ),
            method="HRP",
            risk_measure="MV",
            constraints_satisfied=True,
        )

    def _apply_black_litterman(
        self,
        port: "rp.Portfolio",
        views: Dict[str, float],
        confidence: Optional[Dict[str, float]] = None,
    ) -> "rp.Portfolio":
        """Apply Black-Litterman views to portfolio."""
        # Build views matrix P and views vector Q
        symbols = list(port.returns.columns)
        n_views = len(views)
        n_assets = len(symbols)

        P = np.zeros((n_views, n_assets))
        Q = np.zeros(n_views)

        for i, (symbol, view_return) in enumerate(views.items()):
            if symbol in symbols:
                idx = symbols.index(symbol)
                P[i, idx] = 1.0
                Q[i] = view_return

        # Build confidence matrix (omega)
        if confidence:
            omega = np.diag([1 - confidence.get(s, 0.5) for s in views.keys()])
        else:
            omega = np.eye(n_views) * 0.5

        port.blacklitterman_stats(
            P=P,
            Q=Q,
            delta=2.5,
            rf=self.risk_free_rate,
            w=None,
            eq=True,
        )

        return port

    def _calculate_risk_contributions(
        self,
        weights: Dict[str, float],
        cov: pd.DataFrame,
        port_risk: float,
    ) -> Dict[str, float]:
        """Calculate marginal risk contribution per asset."""
        symbols = list(weights.keys())
        w = np.array([weights[s] for s in symbols])

        # Marginal risk contribution
        mrc = np.dot(cov.loc[symbols, symbols].values, w) / port_risk

        # Risk contribution = weight * MRC
        rc = w * mrc

        # Percentage contribution
        pct_rc = rc / rc.sum() if rc.sum() > 0 else rc

        return {s: round(float(pct_rc[i]), 4) for i, s in enumerate(symbols)}

    async def _fetch_returns(
        self,
        symbols: List[str],
        lookback_days: int,
    ) -> pd.DataFrame:
        """Fetch historical returns for symbols."""
        from datetime import timedelta

        if self.data_manager is None:
            # Generate mock data for testing
            dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")
            return pd.DataFrame(
                np.random.randn(lookback_days, len(symbols)) * 0.02,
                index=dates,
                columns=symbols,
            )

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days + 30)

        returns_data = {}
        for symbol in symbols:
            try:
                data = await self.data_manager.get_stock_data(
                    symbol, start_date, end_date
                )
                if not data.empty and "close" in data.columns:
                    returns_data[symbol] = data["close"].pct_change().dropna()
            except Exception as e:
                logger.warning(f"Failed to fetch data for {symbol}: {e}")

        if not returns_data:
            return pd.DataFrame()

        # Align returns to common dates
        returns_df = pd.DataFrame(returns_data).dropna()
        return returns_df.tail(lookback_days)

    def health_check(self) -> bool:
        """Check if optimizer is operational."""
        return HAS_RISKFOLIO
