"""
Pyfolio Tear Sheet Generator

Institutional performance analysis using pyfolio-reloaded.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Check if pyfolio is available
try:
    import pyfolio as pf

    HAS_PYFOLIO = True
except ImportError:
    HAS_PYFOLIO = False
    pf = None

# Check if empyrical is available
try:
    import empyrical as ep

    HAS_EMPYRICAL = True
except ImportError:
    HAS_EMPYRICAL = False
    ep = None


@dataclass
class PerformanceTearSheet:
    """Comprehensive performance tear sheet."""

    # Return metrics
    total_return: float
    annual_return: float
    annual_volatility: float
    sharpe_ratio: float
    sortino_ratio: float
    calmar_ratio: float

    # Risk metrics
    max_drawdown: float
    max_drawdown_duration: int  # days
    var_95: float
    cvar_95: float
    tail_ratio: float
    stability: float

    # Benchmark metrics
    alpha: float
    beta: float
    information_ratio: float
    tracking_error: float

    # Drawdown analysis
    top_drawdowns: List[Dict[str, Any]]

    # Monthly returns
    monthly_returns: Dict[str, float]

    # Rolling metrics
    rolling_sharpe_6m: Optional[float] = None
    rolling_beta_6m: Optional[float] = None

    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "returns": {
                "total_return": round(self.total_return, 4),
                "annual_return": round(self.annual_return, 4),
                "annual_volatility": round(self.annual_volatility, 4),
            },
            "ratios": {
                "sharpe_ratio": round(self.sharpe_ratio, 4),
                "sortino_ratio": round(self.sortino_ratio, 4),
                "calmar_ratio": round(self.calmar_ratio, 4),
            },
            "risk": {
                "max_drawdown": round(self.max_drawdown, 4),
                "max_drawdown_duration_days": self.max_drawdown_duration,
                "var_95": round(self.var_95, 4),
                "cvar_95": round(self.cvar_95, 4),
                "tail_ratio": round(self.tail_ratio, 4),
                "stability": round(self.stability, 4),
            },
            "benchmark": {
                "alpha": round(self.alpha, 4),
                "beta": round(self.beta, 4),
                "information_ratio": round(self.information_ratio, 4),
                "tracking_error": round(self.tracking_error, 4),
            },
            "drawdowns": self.top_drawdowns,
            "monthly_returns": {
                k: round(v, 4) for k, v in self.monthly_returns.items()
            },
            "timestamp": self.timestamp.isoformat(),
        }


class TearSheetGenerator:
    """
    Generate institutional tear sheets using pyfolio.

    Provides comprehensive performance and risk analysis:
    - Return and risk metrics
    - Drawdown analysis
    - Benchmark comparison
    - Position analysis
    """

    def __init__(
        self,
        data_manager: Optional[Any] = None,
        risk_free_rate: float = 0.05,
    ):
        """
        Initialize TearSheetGenerator.

        Args:
            data_manager: DataManager for fetching benchmark data
            risk_free_rate: Annual risk-free rate
        """
        self.data_manager = data_manager
        self.risk_free_rate = risk_free_rate
        logger.info("TearSheetGenerator initialized")

    async def generate_tear_sheet(
        self,
        returns: pd.Series,
        benchmark_returns: Optional[pd.Series] = None,
        benchmark_symbol: str = "SPY",
        positions: Optional[pd.DataFrame] = None,
        transactions: Optional[pd.DataFrame] = None,
    ) -> PerformanceTearSheet:
        """
        Generate a comprehensive tear sheet.

        Args:
            returns: Portfolio returns series (daily)
            benchmark_returns: Benchmark returns (optional)
            benchmark_symbol: Benchmark symbol to fetch if not provided
            positions: Position data (optional)
            transactions: Transaction data (optional)

        Returns:
            PerformanceTearSheet with all metrics
        """
        # Fetch benchmark if not provided
        if benchmark_returns is None:
            benchmark_returns = await self._fetch_benchmark(
                benchmark_symbol, returns.index
            )

        # Calculate return metrics
        total_return = self._calculate_total_return(returns)
        annual_return = self._calculate_annual_return(returns)
        annual_vol = self._calculate_annual_volatility(returns)
        sharpe = self._calculate_sharpe(returns)
        sortino = self._calculate_sortino(returns)
        calmar = self._calculate_calmar(returns)

        # Calculate risk metrics
        max_dd = self._calculate_max_drawdown(returns)
        max_dd_duration = self._calculate_max_drawdown_duration(returns)
        var_95 = self._calculate_var(returns, 0.95)
        cvar_95 = self._calculate_cvar(returns, 0.95)
        tail_ratio = self._calculate_tail_ratio(returns)
        stability = self._calculate_stability(returns)

        # Calculate benchmark metrics
        alpha, beta = self._calculate_alpha_beta(returns, benchmark_returns)
        ir = self._calculate_information_ratio(returns, benchmark_returns)
        tracking_error = self._calculate_tracking_error(returns, benchmark_returns)

        # Drawdown analysis
        top_drawdowns = self._get_top_drawdowns(returns, n=5)

        # Monthly returns
        monthly_returns = self._calculate_monthly_returns(returns)

        # Rolling metrics
        rolling_sharpe = self._calculate_rolling_sharpe(returns, window=126)
        rolling_beta = self._calculate_rolling_beta(
            returns, benchmark_returns, window=126
        )

        return PerformanceTearSheet(
            total_return=total_return,
            annual_return=annual_return,
            annual_volatility=annual_vol,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            calmar_ratio=calmar,
            max_drawdown=max_dd,
            max_drawdown_duration=max_dd_duration,
            var_95=var_95,
            cvar_95=cvar_95,
            tail_ratio=tail_ratio,
            stability=stability,
            alpha=alpha,
            beta=beta,
            information_ratio=ir,
            tracking_error=tracking_error,
            top_drawdowns=top_drawdowns,
            monthly_returns=monthly_returns,
            rolling_sharpe_6m=rolling_sharpe,
            rolling_beta_6m=rolling_beta,
        )

    def _calculate_total_return(self, returns: pd.Series) -> float:
        """Calculate cumulative total return."""
        return float((1 + returns).prod() - 1)

    def _calculate_annual_return(self, returns: pd.Series) -> float:
        """Calculate annualized return."""
        if HAS_EMPYRICAL:
            return float(ep.annual_return(returns))
        total_return = self._calculate_total_return(returns)
        n_years = len(returns) / 252
        return (1 + total_return) ** (1 / n_years) - 1 if n_years > 0 else 0

    def _calculate_annual_volatility(self, returns: pd.Series) -> float:
        """Calculate annualized volatility."""
        if HAS_EMPYRICAL:
            return float(ep.annual_volatility(returns))
        return float(returns.std() * np.sqrt(252))

    def _calculate_sharpe(self, returns: pd.Series) -> float:
        """Calculate Sharpe ratio."""
        if HAS_EMPYRICAL:
            return float(ep.sharpe_ratio(returns, risk_free=self.risk_free_rate / 252))
        annual_ret = self._calculate_annual_return(returns)
        annual_vol = self._calculate_annual_volatility(returns)
        return (annual_ret - self.risk_free_rate) / annual_vol if annual_vol > 0 else 0

    def _calculate_sortino(self, returns: pd.Series) -> float:
        """Calculate Sortino ratio."""
        if HAS_EMPYRICAL:
            return float(
                ep.sortino_ratio(returns, required_return=self.risk_free_rate / 252)
            )
        downside = returns[returns < 0].std() * np.sqrt(252)
        annual_ret = self._calculate_annual_return(returns)
        return (annual_ret - self.risk_free_rate) / downside if downside > 0 else 0

    def _calculate_calmar(self, returns: pd.Series) -> float:
        """Calculate Calmar ratio."""
        if HAS_EMPYRICAL:
            return float(ep.calmar_ratio(returns))
        annual_ret = self._calculate_annual_return(returns)
        max_dd = abs(self._calculate_max_drawdown(returns))
        return annual_ret / max_dd if max_dd > 0 else 0

    def _calculate_max_drawdown(self, returns: pd.Series) -> float:
        """Calculate maximum drawdown."""
        if HAS_EMPYRICAL:
            return float(ep.max_drawdown(returns))
        cumulative = (1 + returns).cumprod()
        running_max = cumulative.cummax()
        drawdown = (cumulative - running_max) / running_max
        return float(drawdown.min())

    def _calculate_max_drawdown_duration(self, returns: pd.Series) -> int:
        """Calculate maximum drawdown duration in days."""
        cumulative = (1 + returns).cumprod()
        running_max = cumulative.cummax()
        drawdown = (cumulative - running_max) / running_max

        # Find drawdown periods
        is_drawdown = drawdown < 0
        duration = 0
        max_duration = 0

        for in_dd in is_drawdown:
            if in_dd:
                duration += 1
                max_duration = max(max_duration, duration)
            else:
                duration = 0

        return max_duration

    def _calculate_var(self, returns: pd.Series, confidence: float) -> float:
        """Calculate Value at Risk."""
        return float(np.percentile(returns, (1 - confidence) * 100))

    def _calculate_cvar(self, returns: pd.Series, confidence: float) -> float:
        """Calculate Conditional VaR (Expected Shortfall)."""
        var = self._calculate_var(returns, confidence)
        return float(returns[returns <= var].mean())

    def _calculate_tail_ratio(self, returns: pd.Series) -> float:
        """Calculate tail ratio (95th percentile / 5th percentile)."""
        if HAS_EMPYRICAL:
            return float(ep.tail_ratio(returns))
        p95 = np.percentile(returns, 95)
        p5 = abs(np.percentile(returns, 5))
        return p95 / p5 if p5 > 0 else 0

    def _calculate_stability(self, returns: pd.Series) -> float:
        """Calculate stability of returns (R-squared of cumulative returns)."""
        if HAS_EMPYRICAL:
            return float(ep.stability_of_timeseries(returns))
        cumulative = (1 + returns).cumprod()
        x = np.arange(len(cumulative))
        slope, intercept = np.polyfit(x, np.log(cumulative), 1)
        predicted = np.exp(intercept + slope * x)
        ss_res = np.sum((cumulative - predicted) ** 2)
        ss_tot = np.sum((cumulative - cumulative.mean()) ** 2)
        return 1 - ss_res / ss_tot if ss_tot > 0 else 0

    def _calculate_alpha_beta(
        self,
        returns: pd.Series,
        benchmark: pd.Series,
    ) -> tuple:
        """Calculate alpha and beta vs benchmark."""
        if benchmark is None or benchmark.empty:
            return 0.0, 1.0

        # Align series
        aligned = pd.concat([returns, benchmark], axis=1).dropna()
        if len(aligned) < 2:
            return 0.0, 1.0

        port_ret = aligned.iloc[:, 0]
        bench_ret = aligned.iloc[:, 1]

        if HAS_EMPYRICAL:
            alpha = float(
                ep.alpha(port_ret, bench_ret, risk_free=self.risk_free_rate / 252)
            )
            beta = float(ep.beta(port_ret, bench_ret))
            return alpha, beta

        # Manual calculation
        cov = np.cov(port_ret, bench_ret)
        beta = cov[0, 1] / cov[1, 1] if cov[1, 1] > 0 else 1.0
        alpha = self._calculate_annual_return(
            port_ret
        ) - beta * self._calculate_annual_return(bench_ret)
        return float(alpha), float(beta)

    def _calculate_information_ratio(
        self,
        returns: pd.Series,
        benchmark: pd.Series,
    ) -> float:
        """Calculate information ratio."""
        if benchmark is None or benchmark.empty:
            return 0.0

        aligned = pd.concat([returns, benchmark], axis=1).dropna()
        if len(aligned) < 2:
            return 0.0

        excess = aligned.iloc[:, 0] - aligned.iloc[:, 1]
        tracking = excess.std() * np.sqrt(252)
        return float(excess.mean() * 252 / tracking) if tracking > 0 else 0

    def _calculate_tracking_error(
        self,
        returns: pd.Series,
        benchmark: pd.Series,
    ) -> float:
        """Calculate tracking error."""
        if benchmark is None or benchmark.empty:
            return 0.0

        aligned = pd.concat([returns, benchmark], axis=1).dropna()
        if len(aligned) < 2:
            return 0.0

        excess = aligned.iloc[:, 0] - aligned.iloc[:, 1]
        return float(excess.std() * np.sqrt(252))

    def _get_top_drawdowns(
        self,
        returns: pd.Series,
        n: int = 5,
    ) -> List[Dict[str, Any]]:
        """Get top N drawdowns with details."""
        cumulative = (1 + returns).cumprod()
        running_max = cumulative.cummax()
        drawdown = (cumulative - running_max) / running_max

        # Find drawdown periods
        drawdowns = []
        in_drawdown = False
        start_idx = None

        for i, (dd, cum) in enumerate(zip(drawdown, cumulative)):
            if dd < 0 and not in_drawdown:
                in_drawdown = True
                start_idx = i
            elif dd >= 0 and in_drawdown:
                in_drawdown = False
                dd_period = drawdown.iloc[start_idx:i]
                drawdowns.append(
                    {
                        "start": str(returns.index[start_idx]),
                        "end": str(returns.index[i - 1]),
                        "depth": round(float(dd_period.min()), 4),
                        "duration": i - start_idx,
                    }
                )

        # Sort by depth and return top N
        drawdowns.sort(key=lambda x: x["depth"])
        return drawdowns[:n]

    def _calculate_monthly_returns(self, returns: pd.Series) -> Dict[str, float]:
        """Calculate monthly returns."""
        monthly = (1 + returns).resample("ME").prod() - 1
        return {str(idx): float(val) for idx, val in monthly.items()}

    def _calculate_rolling_sharpe(
        self,
        returns: pd.Series,
        window: int = 126,
    ) -> Optional[float]:
        """Calculate rolling Sharpe ratio."""
        if len(returns) < window:
            return None
        rolling_ret = returns.rolling(window).mean() * 252
        rolling_vol = returns.rolling(window).std() * np.sqrt(252)
        rolling_sharpe = (rolling_ret - self.risk_free_rate) / rolling_vol
        return float(rolling_sharpe.iloc[-1]) if not rolling_sharpe.empty else None

    def _calculate_rolling_beta(
        self,
        returns: pd.Series,
        benchmark: pd.Series,
        window: int = 126,
    ) -> Optional[float]:
        """Calculate rolling beta."""
        if benchmark is None or len(returns) < window:
            return None

        aligned = pd.concat([returns, benchmark], axis=1).dropna()
        if len(aligned) < window:
            return None

        port = aligned.iloc[:, 0]
        bench = aligned.iloc[:, 1]

        rolling_cov = port.rolling(window).cov(bench)
        rolling_var = bench.rolling(window).var()
        rolling_beta = rolling_cov / rolling_var

        return float(rolling_beta.iloc[-1]) if not rolling_beta.empty else None

    async def _fetch_benchmark(
        self,
        symbol: str,
        dates: pd.DatetimeIndex,
    ) -> pd.Series:
        """Fetch benchmark returns."""
        if self.data_manager is None:
            # Generate mock benchmark
            return pd.Series(
                np.random.randn(len(dates)) * 0.01,
                index=dates,
            )

        try:
            start_date = dates.min()
            end_date = dates.max()
            data = await self.data_manager.get_stock_data(symbol, start_date, end_date)
            if not data.empty and "close" in data.columns:
                return data["close"].pct_change().dropna()
        except Exception as e:
            logger.warning(f"Failed to fetch benchmark {symbol}: {e}")

        return pd.Series()

    def health_check(self) -> bool:
        """Check if generator is operational."""
        return HAS_PYFOLIO or HAS_EMPYRICAL
