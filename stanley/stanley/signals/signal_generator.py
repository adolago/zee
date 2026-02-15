"""
Signal Generator Module

Generate investment signals based on multi-factor analysis combining
money flow, institutional positioning, and fundamental research.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def _generate_signal_id() -> str:
    """Generate a unique signal ID."""
    return f"sig_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"


class SignalType(Enum):
    """Investment signal direction."""

    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


class SignalStrength(Enum):
    """Signal conviction strength."""

    WEAK = "weak"
    MODERATE = "moderate"
    STRONG = "strong"
    VERY_STRONG = "very_strong"

    @classmethod
    def from_score(cls, score: float) -> "SignalStrength":
        """Determine strength from a score between 0 and 1."""
        if score >= 0.8:
            return cls.VERY_STRONG
        elif score >= 0.6:
            return cls.STRONG
        elif score >= 0.4:
            return cls.MODERATE
        else:
            return cls.WEAK


@dataclass
class Signal:
    """Investment signal with metadata."""

    symbol: str
    signal_type: SignalType
    strength: SignalStrength
    conviction: float  # 0 to 1 scale
    factors: Dict[str, float]  # Factor name to contribution
    timestamp: datetime = field(default_factory=datetime.now)
    signal_id: str = field(default_factory=_generate_signal_id)
    price_at_signal: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    holding_period_days: Optional[int] = None
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "signalId": self.signal_id,
            "symbol": self.symbol,
            "signalType": self.signal_type.value,
            "strength": self.strength.value,
            "conviction": round(self.conviction, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "timestamp": self.timestamp.isoformat(),
            "priceAtSignal": self.price_at_signal,
            "targetPrice": self.target_price,
            "stopLoss": self.stop_loss,
            "holdingPeriodDays": self.holding_period_days,
            "notes": self.notes,
        }


@dataclass
class CompositeSignal:
    """Multi-factor composite signal with detailed scoring."""

    symbol: str
    overall_score: float  # -1 to 1 scale (negative = sell, positive = buy)
    signal_type: SignalType
    strength: SignalStrength
    conviction: float

    # Factor scores (-1 to 1 each)
    money_flow_score: float
    institutional_score: float
    valuation_score: float
    momentum_score: float
    quality_score: float

    # Factor weights used
    weights: Dict[str, float]

    # Signal metadata
    timestamp: datetime = field(default_factory=datetime.now)
    factors_aligned: int = 0  # Count of factors pointing same direction
    conflicting_factors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "overallScore": round(self.overall_score, 4),
            "signalType": self.signal_type.value,
            "strength": self.strength.value,
            "conviction": round(self.conviction, 4),
            "factorScores": {
                "moneyFlow": round(self.money_flow_score, 4),
                "institutional": round(self.institutional_score, 4),
                "valuation": round(self.valuation_score, 4),
                "momentum": round(self.momentum_score, 4),
                "quality": round(self.quality_score, 4),
            },
            "weights": {k: round(v, 4) for k, v in self.weights.items()},
            "factorsAligned": self.factors_aligned,
            "conflictingFactors": self.conflicting_factors,
            "timestamp": self.timestamp.isoformat(),
        }


class SignalGenerator:
    """
    Generate investment signals based on multi-factor analysis.

    Combines money flow analysis, institutional positioning,
    and fundamental research into actionable signals.
    """

    # Default factor weights
    DEFAULT_WEIGHTS = {
        "money_flow": 0.25,
        "institutional": 0.25,
        "valuation": 0.20,
        "momentum": 0.15,
        "quality": 0.15,
    }

    # Signal thresholds
    BUY_THRESHOLD = 0.2
    SELL_THRESHOLD = -0.2

    def __init__(
        self,
        money_flow_analyzer=None,
        institutional_analyzer=None,
        research_analyzer=None,
        portfolio_analyzer=None,
        data_manager=None,
        weights: Optional[Dict[str, float]] = None,
    ):
        """
        Initialize signal generator.

        Args:
            money_flow_analyzer: MoneyFlowAnalyzer instance
            institutional_analyzer: InstitutionalAnalyzer instance
            research_analyzer: ResearchAnalyzer instance
            portfolio_analyzer: PortfolioAnalyzer instance
            data_manager: DataManager instance for price data
            weights: Custom factor weights (optional)
        """
        self.money_flow_analyzer = money_flow_analyzer
        self.institutional_analyzer = institutional_analyzer
        self.research_analyzer = research_analyzer
        self.portfolio_analyzer = portfolio_analyzer
        self.data_manager = data_manager
        self.weights = weights or self.DEFAULT_WEIGHTS.copy()

        # Normalize weights to sum to 1
        weight_sum = sum(self.weights.values())
        if weight_sum > 0:
            self.weights = {k: v / weight_sum for k, v in self.weights.items()}

        logger.info("SignalGenerator initialized with weights: %s", self.weights)

    async def generate_signal(
        self,
        symbol: str,
        include_price_targets: bool = True,
    ) -> Signal:
        """
        Generate investment signal for a single stock.

        Args:
            symbol: Stock symbol
            include_price_targets: Whether to calculate price targets

        Returns:
            Signal with recommendation and factors
        """
        logger.info(f"Generating signal for {symbol}")

        # Get composite score with all factors
        composite = await self.get_composite_score(symbol)

        # Build factor contributions
        factors = {
            "money_flow": composite.money_flow_score
            * self.weights.get("money_flow", 0),
            "institutional": composite.institutional_score
            * self.weights.get("institutional", 0),
            "valuation": composite.valuation_score * self.weights.get("valuation", 0),
            "momentum": composite.momentum_score * self.weights.get("momentum", 0),
            "quality": composite.quality_score * self.weights.get("quality", 0),
        }

        # Get current price and calculate targets if requested
        current_price = await self._get_current_price(symbol)
        target_price = None
        stop_loss = None

        if include_price_targets and current_price:
            target_price, stop_loss = self._calculate_price_targets(
                current_price,
                composite.signal_type,
                composite.conviction,
            )

        # Calculate holding period based on signal strength
        holding_period = self._estimate_holding_period(composite.strength)

        # Generate notes
        notes = self._generate_signal_notes(composite)

        signal = Signal(
            symbol=symbol,
            signal_type=composite.signal_type,
            strength=composite.strength,
            conviction=composite.conviction,
            factors=factors,
            price_at_signal=current_price,
            target_price=target_price,
            stop_loss=stop_loss,
            holding_period_days=holding_period,
            notes=notes,
        )

        logger.info(
            f"Generated {signal.signal_type.value} signal for {symbol} "
            f"with {signal.strength.value} strength, conviction={signal.conviction:.2f}"
        )

        return signal

    async def generate_universe_signals(
        self,
        universe: List[str],
        min_conviction: float = 0.3,
        signal_types: Optional[List[SignalType]] = None,
    ) -> pd.DataFrame:
        """
        Generate signals for a universe of stocks.

        Args:
            universe: List of stock symbols
            min_conviction: Minimum conviction threshold to include
            signal_types: Filter to specific signal types (optional)

        Returns:
            DataFrame with signals sorted by conviction
        """
        if not universe:
            return pd.DataFrame(
                columns=[
                    "symbol",
                    "signal_type",
                    "strength",
                    "conviction",
                    "overall_score",
                    "money_flow_score",
                    "institutional_score",
                    "timestamp",
                ]
            )

        logger.info(f"Generating signals for universe of {len(universe)} stocks")

        signals = []
        for symbol in universe:
            try:
                signal = await self.generate_signal(symbol, include_price_targets=False)

                # Apply filters
                if signal.conviction < min_conviction:
                    continue
                if signal_types and signal.signal_type not in signal_types:
                    continue

                composite = await self.get_composite_score(symbol)

                signals.append(
                    {
                        "symbol": symbol,
                        "signal_type": signal.signal_type.value,
                        "strength": signal.strength.value,
                        "conviction": signal.conviction,
                        "overall_score": composite.overall_score,
                        "money_flow_score": composite.money_flow_score,
                        "institutional_score": composite.institutional_score,
                        "valuation_score": composite.valuation_score,
                        "momentum_score": composite.momentum_score,
                        "quality_score": composite.quality_score,
                        "factors_aligned": composite.factors_aligned,
                        "timestamp": signal.timestamp,
                    }
                )

            except Exception as e:
                logger.error(f"Error generating signal for {symbol}: {e}")
                continue

        df = pd.DataFrame(signals)

        if not df.empty:
            # Sort by absolute conviction (strongest signals first)
            df = df.sort_values("conviction", ascending=False)

        logger.info(f"Generated {len(df)} signals from universe of {len(universe)}")
        return df

    async def get_composite_score(self, symbol: str) -> CompositeSignal:
        """
        Calculate multi-factor composite score.

        Args:
            symbol: Stock symbol

        Returns:
            CompositeSignal with detailed factor breakdown
        """
        # Get individual factor scores
        money_flow_score = await self._get_money_flow_score(symbol)
        institutional_score = await self._get_institutional_score(symbol)
        valuation_score = await self._get_valuation_score(symbol)
        momentum_score = await self._get_momentum_score(symbol)
        quality_score = await self._get_quality_score(symbol)

        # Calculate weighted overall score
        overall_score = (
            money_flow_score * self.weights.get("money_flow", 0)
            + institutional_score * self.weights.get("institutional", 0)
            + valuation_score * self.weights.get("valuation", 0)
            + momentum_score * self.weights.get("momentum", 0)
            + quality_score * self.weights.get("quality", 0)
        )

        # Determine signal type from overall score
        if overall_score >= self.BUY_THRESHOLD:
            signal_type = SignalType.BUY
        elif overall_score <= self.SELL_THRESHOLD:
            signal_type = SignalType.SELL
        else:
            signal_type = SignalType.HOLD

        # Calculate conviction and strength
        conviction = self.calculate_conviction(
            {
                "money_flow": money_flow_score,
                "institutional": institutional_score,
                "valuation": valuation_score,
                "momentum": momentum_score,
                "quality": quality_score,
            }
        )

        strength = SignalStrength.from_score(conviction)

        # Count aligned factors
        factor_scores = [
            money_flow_score,
            institutional_score,
            valuation_score,
            momentum_score,
            quality_score,
        ]
        factor_names = [
            "money_flow",
            "institutional",
            "valuation",
            "momentum",
            "quality",
        ]

        if signal_type == SignalType.BUY:
            factors_aligned = sum(1 for s in factor_scores if s > 0)
            conflicting = [
                factor_names[i] for i, s in enumerate(factor_scores) if s < -0.1
            ]
        elif signal_type == SignalType.SELL:
            factors_aligned = sum(1 for s in factor_scores if s < 0)
            conflicting = [
                factor_names[i] for i, s in enumerate(factor_scores) if s > 0.1
            ]
        else:
            factors_aligned = sum(1 for s in factor_scores if abs(s) < 0.2)
            conflicting = [
                factor_names[i] for i, s in enumerate(factor_scores) if abs(s) > 0.3
            ]

        return CompositeSignal(
            symbol=symbol,
            overall_score=overall_score,
            signal_type=signal_type,
            strength=strength,
            conviction=conviction,
            money_flow_score=money_flow_score,
            institutional_score=institutional_score,
            valuation_score=valuation_score,
            momentum_score=momentum_score,
            quality_score=quality_score,
            weights=self.weights,
            factors_aligned=factors_aligned,
            conflicting_factors=conflicting,
        )

    def calculate_conviction(self, factors: Dict[str, float]) -> float:
        """
        Calculate conviction indicator from factor scores.

        Conviction is higher when:
        - Factor scores are all in the same direction
        - Factor scores have high absolute values
        - There is agreement across different factor types

        Args:
            factors: Dict of factor name to score (-1 to 1)

        Returns:
            Conviction score from 0 to 1
        """
        if not factors:
            return 0.0

        factor_values = list(factors.values())

        # Base conviction on average absolute factor strength
        avg_strength = np.mean([abs(v) for v in factor_values])

        # Bonus for factor alignment (all pointing same direction)
        signs = [np.sign(v) for v in factor_values if abs(v) > 0.1]
        if signs:
            alignment = abs(sum(signs)) / len(
                signs
            )  # 1 if all same sign, lower if mixed
        else:
            alignment = 0.5

        # Bonus for number of strong factors
        strong_factors = sum(1 for v in factor_values if abs(v) > 0.3)
        strength_bonus = min(1.0, strong_factors / len(factors))

        # Combine components
        conviction = 0.4 * avg_strength + 0.4 * alignment + 0.2 * strength_bonus

        return min(1.0, max(0.0, conviction))

    async def _get_money_flow_score(self, symbol: str) -> float:
        """Get money flow score for symbol."""
        if not self.money_flow_analyzer:
            # Return mock data if no analyzer
            return np.random.uniform(-0.5, 0.5)

        try:
            flow_data = self.money_flow_analyzer.analyze_equity_flow(symbol)
            return flow_data.get("money_flow_score", 0.0)
        except Exception as e:
            logger.warning(f"Failed to get money flow score for {symbol}: {e}")
            return 0.0

    async def _get_institutional_score(self, symbol: str) -> float:
        """Get institutional positioning score for symbol."""
        if not self.institutional_analyzer:
            # Return mock data if no analyzer
            return np.random.uniform(-0.5, 0.5)

        try:
            holdings = await self.institutional_analyzer.async_get_holdings(symbol)
            return holdings.get("smart_money_score", 0.0)
        except Exception as e:
            logger.warning(f"Failed to get institutional score for {symbol}: {e}")
            return 0.0

    async def _get_valuation_score(self, symbol: str) -> float:
        """Get valuation score for symbol."""
        if not self.research_analyzer:
            # Return mock data if no analyzer
            return np.random.uniform(-0.5, 0.5)

        try:
            valuation = await self.research_analyzer.get_valuation(symbol)
            dcf = valuation.get("dcf", {})

            # Calculate valuation score based on upside potential
            upside = dcf.get("upsidePercentage", 0) if dcf else 0

            # Convert upside percentage to -1 to 1 score
            # +50% upside -> score of 1, -50% upside -> score of -1
            score = np.clip(upside / 50, -1, 1)
            return score

        except Exception as e:
            logger.warning(f"Failed to get valuation score for {symbol}: {e}")
            return 0.0

    async def _get_momentum_score(self, symbol: str) -> float:
        """Get price momentum score for symbol."""
        if not self.data_manager:
            # Return mock data if no data manager
            return np.random.uniform(-0.5, 0.5)

        try:
            # Get price data for momentum calculation
            from datetime import timedelta

            end_date = datetime.now()
            start_date = end_date - timedelta(days=126)  # 6 months

            price_data = await self.data_manager.get_stock_data(
                symbol, start_date, end_date
            )

            if price_data.empty or "close" not in price_data.columns:
                return 0.0

            prices = price_data["close"]

            # Calculate returns at different horizons
            if len(prices) >= 21:
                ret_1m = (
                    (prices.iloc[-1] / prices.iloc[-21] - 1) if len(prices) > 21 else 0
                )
            else:
                ret_1m = 0

            if len(prices) >= 63:
                ret_3m = (
                    (prices.iloc[-1] / prices.iloc[-63] - 1) if len(prices) > 63 else 0
                )
            else:
                ret_3m = 0

            if len(prices) >= 126:
                ret_6m = (
                    (prices.iloc[-1] / prices.iloc[-126] - 1)
                    if len(prices) > 126
                    else 0
                )
            else:
                ret_6m = 0

            # Weight recent momentum more heavily
            momentum = 0.5 * ret_1m + 0.3 * ret_3m + 0.2 * ret_6m

            # Normalize to -1 to 1 range (assume typical range is -30% to +30%)
            score = np.clip(momentum / 0.3, -1, 1)
            return score

        except Exception as e:
            logger.warning(f"Failed to get momentum score for {symbol}: {e}")
            return 0.0

    async def _get_quality_score(self, symbol: str) -> float:
        """Get fundamental quality score for symbol."""
        if not self.research_analyzer:
            # Return mock data if no analyzer
            return np.random.uniform(-0.5, 0.5)

        try:
            report = await self.research_analyzer.generate_report(symbol)

            # Convert overall score (0-100) to -1 to 1 range
            # 50 is neutral, <50 is negative, >50 is positive
            score = (report.overall_score - 50) / 50
            return np.clip(score, -1, 1)

        except Exception as e:
            logger.warning(f"Failed to get quality score for {symbol}: {e}")
            return 0.0

    async def _get_current_price(self, symbol: str) -> Optional[float]:
        """Get current price for symbol."""
        if not self.data_manager:
            # Return mock price if no data manager
            return 100.0 + np.random.uniform(-20, 50)

        try:
            from datetime import timedelta

            end_date = datetime.now()
            start_date = end_date - timedelta(days=5)

            price_data = await self.data_manager.get_stock_data(
                symbol, start_date, end_date
            )

            if not price_data.empty and "close" in price_data.columns:
                return float(price_data["close"].iloc[-1])

            return None

        except Exception as e:
            logger.warning(f"Failed to get current price for {symbol}: {e}")
            return None

    def _calculate_price_targets(
        self,
        current_price: float,
        signal_type: SignalType,
        conviction: float,
    ) -> tuple[Optional[float], Optional[float]]:
        """Calculate target price and stop loss."""
        if current_price is None or current_price <= 0:
            return None, None

        # Base target move depends on conviction
        base_move = 0.10 + (conviction * 0.20)  # 10% to 30%
        stop_loss_pct = 0.05 + (conviction * 0.05)  # 5% to 10%

        if signal_type == SignalType.BUY:
            target_price = current_price * (1 + base_move)
            stop_loss = current_price * (1 - stop_loss_pct)
        elif signal_type == SignalType.SELL:
            target_price = current_price * (1 - base_move)
            stop_loss = current_price * (1 + stop_loss_pct)
        else:
            return None, None

        return round(target_price, 2), round(stop_loss, 2)

    def _estimate_holding_period(self, strength: SignalStrength) -> int:
        """Estimate holding period based on signal strength."""
        holding_periods = {
            SignalStrength.WEAK: 30,
            SignalStrength.MODERATE: 60,
            SignalStrength.STRONG: 90,
            SignalStrength.VERY_STRONG: 120,
        }
        return holding_periods.get(strength, 60)

    def _generate_signal_notes(self, composite: CompositeSignal) -> str:
        """Generate explanatory notes for the signal."""
        notes = []

        # Describe signal direction
        if composite.signal_type == SignalType.BUY:
            notes.append(f"Buy signal with {composite.strength.value} conviction.")
        elif composite.signal_type == SignalType.SELL:
            notes.append(f"Sell signal with {composite.strength.value} conviction.")
        else:
            notes.append("Hold/neutral signal.")

        # Note factor alignment
        notes.append(f"{composite.factors_aligned}/5 factors aligned.")

        # Note strongest factors
        factor_scores = {
            "Money flow": composite.money_flow_score,
            "Institutional": composite.institutional_score,
            "Valuation": composite.valuation_score,
            "Momentum": composite.momentum_score,
            "Quality": composite.quality_score,
        }

        sorted_factors = sorted(
            factor_scores.items(), key=lambda x: abs(x[1]), reverse=True
        )
        strongest = sorted_factors[0]
        direction = "positive" if strongest[1] > 0 else "negative"
        notes.append(f"Strongest factor: {strongest[0]} ({direction}).")

        # Note conflicts
        if composite.conflicting_factors:
            notes.append(
                f"Conflicting signals from: {', '.join(composite.conflicting_factors)}."
            )

        return " ".join(notes)

    def set_weights(self, weights: Dict[str, float]) -> None:
        """
        Update factor weights.

        Args:
            weights: New weights dict (will be normalized to sum to 1)
        """
        weight_sum = sum(weights.values())
        if weight_sum > 0:
            self.weights = {k: v / weight_sum for k, v in weights.items()}
        else:
            self.weights = self.DEFAULT_WEIGHTS.copy()

        logger.info(f"Updated weights: {self.weights}")

    def health_check(self) -> bool:
        """Check if signal generator is operational."""
        return True
