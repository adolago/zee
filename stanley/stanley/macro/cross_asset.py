"""
Cross-Asset Correlation Analyzer

Analyzes inter-market relationships for regime detection:
- Stock-bond correlation regimes
- USD-commodities relationships
- Risk-on/risk-off indicator
- Rolling correlation dynamics
- Cross-asset momentum
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import logging

logger = logging.getLogger(__name__)


class CorrelationRegime(Enum):
    """Cross-asset correlation regime classification."""

    RISK_ON = "risk_on"  # Positive stock-risk asset correlation
    RISK_OFF = "risk_off"  # Flight to safety, negative correlations
    DISLOCATED = "dislocated"  # Unusual correlation patterns
    TRANSITIONING = "transitioning"  # Regime change underway


@dataclass
class CrossAssetState:
    """Current cross-asset correlation state."""

    regime: CorrelationRegime
    stock_bond_correlation: float  # Rolling 60d correlation SPY-TLT
    stock_commodity_correlation: float  # SPY vs broad commodities
    usd_risk_correlation: float  # DXY vs risk assets
    risk_on_off_score: float  # -1 (risk off) to +1 (risk on)
    correlation_stability: float  # How stable are correlations
    regime_confidence: float
    asset_momentum: Dict[str, float] = field(
        default_factory=dict
    )  # Momentum by asset class
    timestamp: datetime = field(default_factory=datetime.now)


class CrossAssetAnalyzer:
    """
    Analyze cross-asset correlations and risk regimes.

    Provides:
    - Stock-bond correlation analysis
    - Risk-on/risk-off scoring
    - Correlation regime detection
    - Asset class momentum analysis
    - Cross-asset correlation matrices
    """

    # Asset class proxies (ETFs)
    ASSET_PROXIES = {
        "us_equity": "SPY",
        "us_bonds": "TLT",
        "gold": "GLD",
        "commodities": "DBC",
        "usd": "UUP",
        "emerging_markets": "EEM",
        "high_yield": "HYG",
        "investment_grade": "LQD",
        "tips": "TIP",
        "reits": "VNQ",
    }

    # Default correlation window in days
    DEFAULT_CORRELATION_WINDOW = 60

    # Thresholds for regime classification
    STOCK_BOND_CORR_THRESHOLD_HIGH = 0.3  # Above = unusual correlation
    STOCK_BOND_CORR_THRESHOLD_LOW = -0.3  # Below = strong diversification

    def __init__(self, data_manager: Optional[Any] = None):
        """
        Initialize CrossAssetAnalyzer.

        Args:
            data_manager: DataManager instance for fetching price data
        """
        self.data_manager = data_manager
        logger.info("CrossAssetAnalyzer initialized")

    async def get_cross_asset_state(
        self,
        correlation_window: int = 60,
        lookback_days: int = 252,
    ) -> CrossAssetState:
        """
        Get current cross-asset correlation state.

        Args:
            correlation_window: Rolling window for correlations (days)
            lookback_days: Total lookback period for data

        Returns:
            CrossAssetState with current regime and metrics
        """
        # Calculate key correlations
        stock_bond_corr, _ = await self.calculate_stock_bond_correlation(
            window=correlation_window,
            lookback_days=lookback_days,
        )

        stock_commodity_corr = await self._calculate_correlation_pair(
            "us_equity", "commodities", window=correlation_window
        )

        usd_risk_corr = await self._calculate_correlation_pair(
            "usd", "us_equity", window=correlation_window
        )

        # Get additional inputs for risk score
        hy_spread_z = await self._get_credit_spread_z_score()
        vix_level = await self._get_vix_level()
        usd_momentum = await self._get_asset_momentum("usd", lookback_days=20)

        # Calculate composite risk score
        risk_score = self.calculate_risk_on_off_score(
            stock_bond_corr=stock_bond_corr,
            hy_spread_z=hy_spread_z,
            vix_level=vix_level,
            usd_momentum=usd_momentum,
        )

        # Calculate correlation stability
        _, rolling_corr = await self.calculate_stock_bond_correlation(
            window=correlation_window,
            lookback_days=lookback_days,
        )
        corr_stability = self.calculate_correlation_stability(rolling_corr)

        # Determine regime
        regime = self.detect_correlation_regime(
            stock_bond_corr=stock_bond_corr,
            corr_stability=corr_stability,
            risk_score=risk_score,
        )

        # Calculate regime confidence
        confidence = self._calculate_regime_confidence(
            stock_bond_corr, corr_stability, risk_score
        )

        # Get asset momentum
        asset_momentum = await self.calculate_asset_momentum(lookback_days=20)

        return CrossAssetState(
            regime=regime,
            stock_bond_correlation=stock_bond_corr,
            stock_commodity_correlation=stock_commodity_corr,
            usd_risk_correlation=usd_risk_corr,
            risk_on_off_score=risk_score,
            correlation_stability=corr_stability,
            regime_confidence=confidence,
            asset_momentum=asset_momentum,
        )

    async def calculate_rolling_correlations(
        self,
        assets: List[str],
        window: int = 60,
        lookback_days: int = 252,
    ) -> pd.DataFrame:
        """
        Calculate rolling correlation matrix for multiple assets.

        Args:
            assets: List of asset keys from ASSET_PROXIES
            window: Rolling correlation window in days
            lookback_days: Total lookback period for data

        Returns:
            DataFrame with rolling correlations over time
        """
        # Get price data for all assets
        price_data = await self._get_multi_asset_prices(assets, lookback_days)

        if price_data.empty:
            logger.warning("No price data available for correlation calculation")
            return pd.DataFrame()

        # Calculate returns
        returns = price_data.pct_change().dropna()

        if len(returns) < window:
            logger.warning(
                f"Insufficient data for rolling correlation: {len(returns)} < {window}"
            )
            return pd.DataFrame()

        # Calculate rolling correlation matrix
        rolling_corr = returns.rolling(window=window).corr()

        return rolling_corr

    async def calculate_stock_bond_correlation(
        self,
        window: int = 60,
        lookback_days: int = 252,
    ) -> Tuple[float, pd.Series]:
        """
        Calculate stock-bond correlation (SPY-TLT).

        Stock-bond correlation is a key regime indicator:
        - Positive: Risk-on, growth concerns dominate
        - Negative: Normal diversification benefit
        - Strongly positive: Inflation fear or liquidity crisis

        Args:
            window: Rolling correlation window
            lookback_days: Total lookback period

        Returns:
            Tuple of (current correlation, rolling correlation series)
        """
        assets = ["us_equity", "us_bonds"]
        price_data = await self._get_multi_asset_prices(assets, lookback_days)

        if price_data.empty or len(price_data.columns) < 2:
            logger.warning("Insufficient data for stock-bond correlation")
            return 0.0, pd.Series()

        returns = price_data.pct_change().dropna()

        if len(returns) < window:
            logger.warning("Insufficient returns data for correlation window")
            return 0.0, pd.Series()

        # Get the actual column names from the data
        cols = returns.columns.tolist()
        if len(cols) < 2:
            return 0.0, pd.Series()

        # Calculate rolling correlation
        rolling_corr = returns[cols[0]].rolling(window=window).corr(returns[cols[1]])

        # Current correlation is the last value
        current_corr = rolling_corr.iloc[-1] if not rolling_corr.empty else 0.0

        # Handle NaN
        if pd.isna(current_corr):
            current_corr = 0.0

        return current_corr, rolling_corr

    def calculate_risk_on_off_score(
        self,
        stock_bond_corr: float,
        hy_spread_z: float,
        vix_level: float,
        usd_momentum: float,
    ) -> float:
        """
        Calculate composite risk-on/risk-off score.

        Components (equal weight 25% each):
        - Stock-bond correlation: Higher = more risk-on
        - Credit spreads (z-score): Tighter spreads = risk-on
        - VIX level: Lower VIX = risk-on
        - USD momentum: Weaker USD = risk-on (inverse)

        Args:
            stock_bond_corr: Current stock-bond correlation
            hy_spread_z: High yield spread z-score (positive = widening)
            vix_level: Current VIX level
            usd_momentum: USD momentum (positive = strengthening)

        Returns:
            Risk score from -1 (extreme risk-off) to +1 (extreme risk-on)
        """
        # Normalize each component to -1 to +1 range

        # Stock-bond correlation: map from [-1, 1] to [-1, 1]
        # Positive correlation = risk-on behavior
        corr_score = np.clip(stock_bond_corr, -1, 1)

        # Credit spread z-score: map to risk score
        # Negative z-score (tighter spreads) = risk-on
        # Typical z-score range: -3 to +3
        spread_score = -np.clip(hy_spread_z / 3, -1, 1)

        # VIX level: map to risk score
        # VIX 12 = extreme risk-on (+1), VIX 35 = extreme risk-off (-1)
        # Center around VIX 20
        vix_score = np.clip((20 - vix_level) / 15, -1, 1)

        # USD momentum: stronger USD = risk-off (inverse relationship)
        # Normalize assuming momentum in range [-0.1, 0.1] (10%)
        usd_score = -np.clip(usd_momentum * 10, -1, 1)

        # Weighted average (equal weights)
        risk_score = (corr_score + spread_score + vix_score + usd_score) / 4

        return float(np.clip(risk_score, -1, 1))

    async def calculate_asset_momentum(
        self,
        lookback_days: int = 20,
    ) -> Dict[str, float]:
        """
        Calculate momentum scores for each asset class.

        Momentum is calculated as the return over the lookback period,
        normalized to a z-score for comparability.

        Args:
            lookback_days: Lookback period for momentum calculation

        Returns:
            Dictionary mapping asset class names to momentum scores
        """
        momentum_scores = {}

        for asset_name in self.ASSET_PROXIES.keys():
            try:
                momentum = await self._get_asset_momentum(asset_name, lookback_days)
                momentum_scores[asset_name] = momentum
            except Exception as e:
                logger.debug(f"Failed to calculate momentum for {asset_name}: {e}")
                momentum_scores[asset_name] = 0.0

        return momentum_scores

    def detect_correlation_regime(
        self,
        stock_bond_corr: float,
        corr_stability: float,
        risk_score: float,
    ) -> CorrelationRegime:
        """
        Classify current correlation regime.

        Regime classification logic:
        - RISK_ON: Positive stock-bond correlation, positive risk score
        - RISK_OFF: Negative stock-bond correlation, negative risk score
        - DISLOCATED: Unusual patterns (e.g., positive correlation with negative risk score)
        - TRANSITIONING: Low correlation stability indicates regime change

        Args:
            stock_bond_corr: Current stock-bond correlation
            corr_stability: Correlation stability metric (0-1)
            risk_score: Composite risk-on/off score (-1 to +1)

        Returns:
            CorrelationRegime enum value
        """
        # Low stability indicates transitioning regime
        if corr_stability < 0.3:
            return CorrelationRegime.TRANSITIONING

        # Check for dislocated state (conflicting signals)
        is_corr_positive = stock_bond_corr > self.STOCK_BOND_CORR_THRESHOLD_HIGH
        is_corr_negative = stock_bond_corr < self.STOCK_BOND_CORR_THRESHOLD_LOW
        is_risk_on = risk_score > 0.2
        is_risk_off = risk_score < -0.2

        # Dislocated: correlation and risk score are conflicting
        if (is_corr_positive and is_risk_off) or (is_corr_negative and is_risk_on):
            return CorrelationRegime.DISLOCATED

        # Risk-on regime
        if is_corr_positive or (is_risk_on and stock_bond_corr > 0):
            return CorrelationRegime.RISK_ON

        # Risk-off regime
        if is_risk_off or stock_bond_corr < -0.1:
            return CorrelationRegime.RISK_OFF

        # Default to risk-on if neutral but slight positive bias
        if risk_score >= 0:
            return CorrelationRegime.RISK_ON
        else:
            return CorrelationRegime.RISK_OFF

    async def get_correlation_matrix(
        self,
        assets: Optional[List[str]] = None,
        window: int = 60,
        lookback_days: int = 252,
    ) -> pd.DataFrame:
        """
        Get current correlation matrix for specified assets.

        Args:
            assets: List of asset keys (default: all proxies)
            window: Correlation window in days
            lookback_days: Total lookback period

        Returns:
            DataFrame with correlation matrix
        """
        if assets is None:
            assets = list(self.ASSET_PROXIES.keys())

        # Get price data
        price_data = await self._get_multi_asset_prices(assets, lookback_days)

        if price_data.empty:
            return pd.DataFrame()

        # Calculate returns
        returns = price_data.pct_change().dropna()

        # Use the most recent 'window' days for current correlation
        if len(returns) >= window:
            returns = returns.tail(window)

        # Calculate correlation matrix
        corr_matrix = returns.corr()

        return corr_matrix

    def calculate_correlation_stability(
        self,
        rolling_corr: pd.Series,
        window: int = 20,
    ) -> float:
        """
        Measure correlation stability.

        Low stability (high volatility of correlation) indicates regime change.

        Args:
            rolling_corr: Series of rolling correlations
            window: Window for stability calculation

        Returns:
            Stability score from 0 (unstable) to 1 (stable)
        """
        if rolling_corr.empty or len(rolling_corr.dropna()) < window:
            return 0.5  # Default to neutral

        # Get recent correlations
        recent_corr = rolling_corr.dropna().tail(window)

        if len(recent_corr) < 2:
            return 0.5

        # Calculate standard deviation of correlations
        corr_std = recent_corr.std()

        # Map std to stability score
        # Low std (< 0.1) = high stability (1.0)
        # High std (> 0.5) = low stability (0.0)
        stability = 1 - np.clip(corr_std * 2, 0, 1)

        return float(stability)

    # ========================================================================
    # Private Helper Methods
    # ========================================================================

    async def _get_multi_asset_prices(
        self,
        assets: List[str],
        lookback_days: int,
    ) -> pd.DataFrame:
        """Get price data for multiple assets."""
        if self.data_manager is None:
            logger.warning("No data manager available, returning empty DataFrame")
            return pd.DataFrame()

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days)

        price_dict = {}
        available_assets = []

        for asset_name in assets:
            symbol = self.ASSET_PROXIES.get(asset_name)
            if symbol is None:
                continue

            try:
                df = await self.data_manager.get_stock_data(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                )

                if not df.empty and "close" in df.columns:
                    # Set date as index if available
                    if "date" in df.columns:
                        df = df.set_index("date")
                    price_dict[asset_name] = df["close"]
                    available_assets.append(asset_name)

            except Exception as e:
                logger.debug(
                    f"Failed to get price data for {asset_name} ({symbol}): {e}"
                )

        if not price_dict:
            return pd.DataFrame()

        # Combine into single DataFrame
        price_df = pd.DataFrame(price_dict)

        # Forward fill missing values then drop remaining NaNs
        price_df = price_df.ffill().dropna()

        return price_df

    async def _calculate_correlation_pair(
        self,
        asset1: str,
        asset2: str,
        window: int = 60,
        lookback_days: int = 252,
    ) -> float:
        """Calculate correlation between two assets."""
        price_data = await self._get_multi_asset_prices([asset1, asset2], lookback_days)

        if price_data.empty or len(price_data.columns) < 2:
            return 0.0

        returns = price_data.pct_change().dropna()

        if len(returns) < window:
            return 0.0

        # Use recent window for correlation
        recent_returns = returns.tail(window)

        cols = recent_returns.columns.tolist()
        if len(cols) < 2:
            return 0.0

        corr = recent_returns[cols[0]].corr(recent_returns[cols[1]])

        return float(corr) if not pd.isna(corr) else 0.0

    async def _get_asset_momentum(
        self,
        asset_name: str,
        lookback_days: int = 20,
    ) -> float:
        """Get momentum (return) for a single asset."""
        if self.data_manager is None:
            return 0.0

        symbol = self.ASSET_PROXIES.get(asset_name)
        if symbol is None:
            return 0.0

        end_date = datetime.now()
        start_date = end_date - timedelta(days=lookback_days + 10)  # Buffer

        try:
            df = await self.data_manager.get_stock_data(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
            )

            if df.empty or "close" not in df.columns:
                return 0.0

            # Calculate return over lookback period
            prices = df["close"].dropna()
            if len(prices) < 2:
                return 0.0

            # Get first and last prices in lookback window
            start_price = prices.iloc[0]
            end_price = prices.iloc[-1]

            if start_price <= 0:
                return 0.0

            momentum = (end_price - start_price) / start_price

            return float(momentum)

        except Exception as e:
            logger.debug(f"Failed to calculate momentum for {asset_name}: {e}")
            return 0.0

    async def _get_credit_spread_z_score(self) -> float:
        """
        Get credit spread z-score.

        Positive z-score = spreads widening (risk-off)
        Negative z-score = spreads tightening (risk-on)

        Uses HYG-LQD spread as a proxy.
        """
        try:
            # Calculate spread using HYG (high yield) and LQD (investment grade)
            hy_mom = await self._get_asset_momentum("high_yield", lookback_days=60)
            ig_mom = await self._get_asset_momentum(
                "investment_grade", lookback_days=60
            )

            # When HY underperforms IG, spreads are widening
            spread_indicator = ig_mom - hy_mom

            # Normalize to z-score range (rough approximation)
            z_score = spread_indicator * 20  # Scale factor

            return float(np.clip(z_score, -3, 3))

        except Exception:
            return 0.0

    async def _get_vix_level(self) -> float:
        """
        Get current VIX level.

        If VIX data not available, estimate from equity volatility.
        """
        # For now, estimate VIX from equity volatility
        try:
            if self.data_manager is None:
                return 20.0  # Default neutral level

            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)

            df = await self.data_manager.get_stock_data(
                symbol="SPY",
                start_date=start_date,
                end_date=end_date,
            )

            if df.empty or "close" not in df.columns:
                return 20.0

            # Calculate realized volatility and annualize
            returns = df["close"].pct_change().dropna()
            if len(returns) < 5:
                return 20.0

            vol = returns.std() * np.sqrt(252) * 100  # Annualized vol in %

            # VIX is typically slightly higher than realized vol
            vix_estimate = vol * 1.1

            return float(np.clip(vix_estimate, 10, 80))

        except Exception:
            return 20.0

    def _calculate_regime_confidence(
        self,
        stock_bond_corr: float,
        corr_stability: float,
        risk_score: float,
    ) -> float:
        """
        Calculate confidence in the regime classification.

        Higher confidence when:
        - Correlation is clearly positive or negative (not near zero)
        - Correlation is stable
        - Risk score is strongly positive or negative
        """
        # Correlation strength (0-1)
        corr_strength = abs(stock_bond_corr)

        # Risk score strength (0-1)
        risk_strength = abs(risk_score)

        # Weighted combination
        confidence = corr_strength * 0.3 + corr_stability * 0.4 + risk_strength * 0.3

        return float(np.clip(confidence, 0, 1))

    async def get_regime_history(
        self,
        lookback_days: int = 252,
        correlation_window: int = 60,
    ) -> pd.DataFrame:
        """
        Get historical regime classifications.

        Args:
            lookback_days: Total lookback period
            correlation_window: Window for rolling correlations

        Returns:
            DataFrame with regime history and metrics
        """
        assets = ["us_equity", "us_bonds"]
        price_data = await self._get_multi_asset_prices(assets, lookback_days)

        if price_data.empty:
            return pd.DataFrame()

        returns = price_data.pct_change().dropna()
        cols = returns.columns.tolist()

        if len(cols) < 2:
            return pd.DataFrame()

        # Calculate rolling correlation
        rolling_corr = (
            returns[cols[0]].rolling(window=correlation_window).corr(returns[cols[1]])
        )

        # Calculate rolling stability
        rolling_stability = (
            rolling_corr.rolling(window=20)
            .std()
            .apply(lambda x: 1 - np.clip(x * 2, 0, 1))
        )

        # Build history DataFrame
        history = pd.DataFrame(
            {
                "stock_bond_correlation": rolling_corr,
                "correlation_stability": rolling_stability,
            }
        )

        # Classify each point (simplified - uses correlation only)
        def classify_point(row):
            corr = row["stock_bond_correlation"]
            stability = row["correlation_stability"]

            if pd.isna(corr) or pd.isna(stability):
                return None

            if stability < 0.3:
                return CorrelationRegime.TRANSITIONING.value
            elif corr > self.STOCK_BOND_CORR_THRESHOLD_HIGH:
                return CorrelationRegime.RISK_ON.value
            elif corr < self.STOCK_BOND_CORR_THRESHOLD_LOW:
                return CorrelationRegime.RISK_OFF.value
            else:
                return CorrelationRegime.RISK_ON.value  # Default

        history["regime"] = history.apply(classify_point, axis=1)

        return history.dropna()

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return self.data_manager is not None
