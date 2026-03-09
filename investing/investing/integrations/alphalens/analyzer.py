"""
Alphalens Factor Analyzer

Quantitative factor analysis using alphalens-reloaded.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Check if alphalens is available
try:
    import alphalens as al
    from alphalens.utils import get_clean_factor_and_forward_returns

    HAS_ALPHALENS = True
except ImportError:
    HAS_ALPHALENS = False
    al = None


@dataclass
class FactorAnalysisResult:
    """Result of factor analysis."""

    factor_name: str
    mean_ic: float
    ic_std: float
    ir: float  # Information Ratio (IC / std)
    t_stat: float
    p_value: float
    quantile_returns: Dict[int, float]
    turnover: float
    factor_autocorrelation: float
    periods: List[str]
    is_significant: bool
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "factor_name": self.factor_name,
            "mean_ic": round(self.mean_ic, 4),
            "ic_std": round(self.ic_std, 4),
            "information_ratio": round(self.ir, 4),
            "t_statistic": round(self.t_stat, 4),
            "p_value": round(self.p_value, 4),
            "quantile_returns": {
                str(k): round(v, 4) for k, v in self.quantile_returns.items()
            },
            "turnover": round(self.turnover, 4),
            "factor_autocorrelation": round(self.factor_autocorrelation, 4),
            "periods": self.periods,
            "is_significant": self.is_significant,
            "timestamp": self.timestamp.isoformat(),
        }


class FactorAnalyzer:
    """
    Factor analysis using alphalens.

    Provides institutional-grade factor validation:
    - Information Coefficient (IC) analysis
    - Factor returns by quantile
    - Turnover and trading cost analysis
    - Statistical significance testing
    """

    def __init__(
        self,
        data_manager: Optional[Any] = None,
        quantiles: int = 5,
        periods: Optional[List[int]] = None,
    ):
        """
        Initialize FactorAnalyzer.

        Args:
            data_manager: DataManager for fetching price data
            quantiles: Number of quantiles for analysis
            periods: Forward return periods in days (default: [1, 5, 21])
        """
        if not HAS_ALPHALENS:
            raise ImportError(
                "alphalens-reloaded is required. "
                "Install with: pip install alphalens-reloaded"
            )

        self.data_manager = data_manager
        self.quantiles = quantiles
        self.periods = periods or [1, 5, 21]
        logger.info("FactorAnalyzer initialized")

    async def analyze_factor(
        self,
        factor_data: pd.DataFrame,
        price_data: pd.DataFrame,
        factor_name: str = "factor",
    ) -> FactorAnalysisResult:
        """
        Analyze a factor's predictive power.

        Args:
            factor_data: DataFrame with MultiIndex (date, asset) and factor values
            price_data: DataFrame with prices (columns = assets, index = dates)
            factor_name: Name of the factor

        Returns:
            FactorAnalysisResult with comprehensive metrics
        """
        # Prepare data for alphalens
        factor_clean, forward_returns = self._prepare_data(factor_data, price_data)

        if factor_clean.empty:
            raise ValueError("No valid factor data after cleaning")

        # Calculate IC (Information Coefficient)
        ic = al.performance.factor_information_coefficient(
            forward_returns, factor_clean
        )
        mean_ic = ic.mean()
        ic_std = ic.std()

        # Information Ratio
        ir = mean_ic / ic_std if ic_std > 0 else 0

        # T-statistic and p-value
        n = len(ic)
        t_stat = mean_ic * np.sqrt(n) / ic_std if ic_std > 0 else 0
        from scipy import stats

        p_value = 2 * (1 - stats.t.cdf(abs(t_stat), n - 1)) if n > 1 else 1.0

        # Quantile returns
        quantile_returns = al.performance.mean_return_by_quantile(
            forward_returns, factor_clean, by_date=False
        )[0]

        # Use the first period for quantile returns
        first_period = quantile_returns.columns[0]
        qr_dict = {
            int(q): float(quantile_returns.loc[q, first_period])
            for q in quantile_returns.index
        }

        # Turnover analysis
        turnover = al.performance.factor_rank_autocorrelation(factor_clean).mean()

        # Factor autocorrelation
        factor_autocorr = al.performance.factor_autocorrelation(factor_clean).mean()

        # Determine significance (IR > 0.5 and p < 0.05)
        is_significant = abs(ir) > 0.5 and p_value < 0.05

        return FactorAnalysisResult(
            factor_name=factor_name,
            mean_ic=(
                float(mean_ic.iloc[0]) if hasattr(mean_ic, "iloc") else float(mean_ic)
            ),
            ic_std=float(ic_std.iloc[0]) if hasattr(ic_std, "iloc") else float(ic_std),
            ir=float(ir.iloc[0]) if hasattr(ir, "iloc") else float(ir),
            t_stat=float(t_stat.iloc[0]) if hasattr(t_stat, "iloc") else float(t_stat),
            p_value=float(p_value),
            quantile_returns=qr_dict,
            turnover=float(turnover),
            factor_autocorrelation=float(factor_autocorr),
            periods=[f"{p}D" for p in self.periods],
            is_significant=is_significant,
        )

    async def analyze_signal_factor(
        self,
        signals: List[Dict[str, Any]],
        lookback_days: int = 252,
        factor_name: str = "signal_strength",
    ) -> FactorAnalysisResult:
        """
        Analyze Investing signals as a factor.

        Args:
            signals: List of signal dictionaries with symbol, timestamp, strength
            lookback_days: Historical data lookback
            factor_name: Name for the factor

        Returns:
            FactorAnalysisResult
        """
        # Extract unique symbols
        symbols = list(set(s["symbol"] for s in signals))

        # Fetch price data
        price_data = await self._fetch_prices(symbols, lookback_days)

        if price_data.empty:
            raise ValueError("Could not fetch price data")

        # Build factor DataFrame from signals
        factor_records = []
        for signal in signals:
            factor_records.append(
                {
                    "date": pd.Timestamp(signal["timestamp"]),
                    "asset": signal["symbol"],
                    "factor": signal.get("strength", signal.get("confidence", 0.5)),
                }
            )

        factor_df = pd.DataFrame(factor_records)
        factor_df = factor_df.set_index(["date", "asset"])["factor"]

        return await self.analyze_factor(
            factor_data=factor_df,
            price_data=price_data,
            factor_name=factor_name,
        )

    def _prepare_data(
        self,
        factor_data: pd.DataFrame,
        price_data: pd.DataFrame,
    ) -> Tuple[pd.Series, pd.DataFrame]:
        """Prepare data for alphalens analysis."""
        # Ensure factor is a Series with MultiIndex
        if isinstance(factor_data, pd.DataFrame):
            if factor_data.index.nlevels == 2:
                factor = factor_data.iloc[:, 0]
            else:
                # Assume columns are assets, reshape
                factor = factor_data.stack()
                factor.index.names = ["date", "asset"]
        else:
            factor = factor_data

        # Get clean factor and forward returns
        try:
            factor_clean, forward_returns = get_clean_factor_and_forward_returns(
                factor=factor,
                prices=price_data,
                quantiles=self.quantiles,
                periods=tuple(self.periods),
            )
        except Exception as e:
            logger.error(f"Error preparing factor data: {e}")
            return pd.Series(), pd.DataFrame()

        return factor_clean, forward_returns

    async def _fetch_prices(
        self,
        symbols: List[str],
        lookback_days: int,
    ) -> pd.DataFrame:
        """Fetch historical prices for symbols."""
        from datetime import timedelta

        if self.data_manager is None:
            # Generate mock data for testing
            dates = pd.date_range(end=datetime.now(), periods=lookback_days, freq="D")
            return pd.DataFrame(
                np.random.randn(lookback_days, len(symbols)).cumsum(axis=0) + 100,
                index=dates,
                columns=symbols,
            )

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days + 30)

        price_data = {}
        for symbol in symbols:
            try:
                data = await self.data_manager.get_stock_data(
                    symbol, start_date, end_date
                )
                if not data.empty and "close" in data.columns:
                    price_data[symbol] = data["close"]
            except Exception as e:
                logger.warning(f"Failed to fetch data for {symbol}: {e}")

        if not price_data:
            return pd.DataFrame()

        return pd.DataFrame(price_data)

    def generate_tear_sheet(
        self,
        factor_data: pd.DataFrame,
        price_data: pd.DataFrame,
    ) -> Dict[str, Any]:
        """
        Generate a comprehensive factor tear sheet.

        Args:
            factor_data: Factor values
            price_data: Price data

        Returns:
            Dictionary with tear sheet components
        """
        factor_clean, forward_returns = self._prepare_data(factor_data, price_data)

        if factor_clean.empty:
            return {"error": "Insufficient data for tear sheet"}

        # IC analysis
        ic = al.performance.factor_information_coefficient(
            forward_returns, factor_clean
        )

        # Returns by quantile
        quantile_returns = al.performance.mean_return_by_quantile(
            forward_returns, factor_clean
        )

        # Cumulative returns by quantile
        cumulative_returns = al.performance.factor_cumulative_returns(
            forward_returns, factor_clean
        )

        return {
            "ic_summary": ic.describe().to_dict(),
            "quantile_returns": quantile_returns[0].to_dict(),
            "cumulative_returns": cumulative_returns.to_dict(),
            "ic_by_period": ic.mean().to_dict(),
        }

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return HAS_ALPHALENS
