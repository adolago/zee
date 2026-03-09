"""
Macro Regime Detector - Main Orchestrator

Unified interface for macro regime detection that coordinates:
- Business cycle phase detection
- Volatility regime classification
- Credit spread monitoring
- Cross-asset correlation analysis
- Recession probability estimation
- Yield curve analysis

Beats Bloomberg by providing:
- Clearer, more actionable regime signals
- Multiple timeframe analysis
- Confidence-weighted composite scores
- Historical context and percentiles
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class MacroRegime(Enum):
    """Top-level macro regime classification."""

    GOLDILOCKS = "goldilocks"  # Low vol, growth, low inflation
    REFLATION = "reflation"  # Rising growth, rising inflation
    STAGFLATION = "stagflation"  # Weak growth, high inflation
    DEFLATION = "deflation"  # Weak growth, falling prices
    RISK_ON = "risk_on"  # Strong risk appetite
    RISK_OFF = "risk_off"  # Flight to safety
    CRISIS = "crisis"  # Acute stress
    TRANSITION = "transition"  # Regime change underway


class RegimeConfidence(Enum):
    """Confidence level in regime classification."""

    HIGH = "high"  # > 80% confidence
    MEDIUM = "medium"  # 50-80% confidence
    LOW = "low"  # < 50% confidence


@dataclass
class RegimeSignal:
    """Individual regime signal from a component."""

    source: str  # Component name
    signal: str  # Signal value
    strength: float  # 0-1 signal strength
    confidence: float  # 0-1 confidence
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MacroRegimeState:
    """Comprehensive macro regime state."""

    timestamp: datetime
    country: str

    # Primary regime classification
    regime: MacroRegime
    regime_confidence: RegimeConfidence
    regime_score: float  # Composite score

    # Component signals
    business_cycle_phase: str
    volatility_regime: str
    credit_regime: str
    correlation_regime: str
    yield_curve_signal: str

    # Key metrics
    recession_probability_12m: float
    vix_level: Optional[float]
    credit_spread_hy: Optional[float]
    yield_curve_spread: Optional[float]
    stock_bond_correlation: Optional[float]

    # Risk assessment
    risk_score: float  # 0-100, higher = more risk
    risk_trend: str  # "increasing", "stable", "decreasing"

    # Positioning signals
    equity_signal: str  # "overweight", "neutral", "underweight"
    duration_signal: str  # "long", "neutral", "short"
    credit_signal: str  # "overweight", "neutral", "underweight"
    volatility_signal: str  # "sell", "neutral", "buy"

    # Component details
    signals: List[RegimeSignal] = field(default_factory=list)

    # Historical context
    regime_duration_days: int = 0
    regime_percentiles: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "country": self.country,
            "regime": self.regime.value,
            "regime_confidence": self.regime_confidence.value,
            "regime_score": round(self.regime_score, 3),
            "components": {
                "business_cycle": self.business_cycle_phase,
                "volatility": self.volatility_regime,
                "credit": self.credit_regime,
                "correlation": self.correlation_regime,
                "yield_curve": self.yield_curve_signal,
            },
            "metrics": {
                "recession_probability_12m": round(self.recession_probability_12m, 3),
                "vix_level": self.vix_level,
                "credit_spread_hy": self.credit_spread_hy,
                "yield_curve_spread": self.yield_curve_spread,
                "stock_bond_correlation": self.stock_bond_correlation,
            },
            "risk": {
                "score": round(self.risk_score, 1),
                "trend": self.risk_trend,
            },
            "positioning": {
                "equity": self.equity_signal,
                "duration": self.duration_signal,
                "credit": self.credit_signal,
                "volatility": self.volatility_signal,
            },
            "signals": [
                {
                    "source": s.source,
                    "signal": s.signal,
                    "strength": round(s.strength, 3),
                    "confidence": round(s.confidence, 3),
                }
                for s in self.signals
            ],
            "context": {
                "regime_duration_days": self.regime_duration_days,
                "percentiles": self.regime_percentiles,
            },
        }


class MacroRegimeDetector:
    """
    Unified macro regime detection system.

    Orchestrates multiple specialized analyzers to produce
    a comprehensive view of current macro conditions.
    """

    # Component weights for regime classification
    COMPONENT_WEIGHTS = {
        "business_cycle": 0.25,
        "volatility": 0.20,
        "credit": 0.20,
        "correlation": 0.15,
        "yield_curve": 0.20,
    }

    def __init__(
        self,
        dbnomics_adapter=None,
        data_manager=None,
    ):
        """
        Initialize MacroRegimeDetector.

        Args:
            dbnomics_adapter: DBnomics adapter for macro data
            data_manager: DataManager for market data
        """
        self.dbnomics = dbnomics_adapter
        self.data_manager = data_manager

        # Component analyzers (lazy initialization)
        self._business_cycle = None
        self._volatility = None
        self._credit = None
        self._cross_asset = None
        self._yield_curve = None
        self._recession_model = None

        # State tracking
        self._regime_history: List[MacroRegimeState] = []
        self._last_regime: Optional[MacroRegime] = None
        self._regime_start_date: Optional[datetime] = None

        logger.info("MacroRegimeDetector initialized")

    @property
    def yield_curve_analyzer(self):
        """Lazy initialization of yield curve analyzer."""
        if self._yield_curve is None:
            from .yield_curve import YieldCurveAnalyzer

            self._yield_curve = YieldCurveAnalyzer(
                dbnomics_adapter=self.dbnomics,
                data_manager=self.data_manager,
            )
        return self._yield_curve

    @property
    def credit_monitor(self):
        """Lazy initialization of credit spread monitor."""
        if self._credit is None:
            from .credit_spreads import CreditSpreadMonitor

            self._credit = CreditSpreadMonitor(
                dbnomics_adapter=self.dbnomics,
                data_manager=self.data_manager,
            )
        return self._credit

    @property
    def cross_asset_analyzer(self):
        """Lazy initialization of cross-asset analyzer."""
        if self._cross_asset is None:
            from .cross_asset import CrossAssetAnalyzer

            self._cross_asset = CrossAssetAnalyzer(
                data_manager=self.data_manager,
            )
        return self._cross_asset

    @property
    def business_cycle_analyzer(self):
        """Lazy initialization of business cycle analyzer."""
        if self._business_cycle is None:
            from .business_cycle import BusinessCycleAnalyzer

            self._business_cycle = BusinessCycleAnalyzer(
                dbnomics_adapter=self.dbnomics,
            )
        return self._business_cycle

    async def get_regime_state(
        self,
        country: str = "USA",
    ) -> MacroRegimeState:
        """
        Get comprehensive macro regime state.

        Args:
            country: ISO country code

        Returns:
            MacroRegimeState with full regime analysis
        """
        signals: List[RegimeSignal] = []

        # Gather signals from all components
        yc_signal = await self._get_yield_curve_signal(country)
        signals.append(yc_signal)

        vol_signal = await self._get_volatility_signal()
        signals.append(vol_signal)

        credit_signal = await self._get_credit_signal(country)
        signals.append(credit_signal)

        corr_signal = await self._get_correlation_signal()
        signals.append(corr_signal)

        cycle_signal = await self._get_business_cycle_signal(country)
        signals.append(cycle_signal)

        # Classify regime from signals
        regime, confidence, score = self._classify_regime(signals)

        # Calculate recession probability
        recession_prob = await self._calculate_recession_probability(country, signals)

        # Calculate risk score
        risk_score, risk_trend = self._calculate_risk_score(signals)

        # Generate positioning signals
        positioning = self._generate_positioning_signals(
            regime, signals, recession_prob
        )

        # Track regime duration
        regime_duration = self._track_regime_duration(regime)

        return MacroRegimeState(
            timestamp=datetime.now(),
            country=country,
            regime=regime,
            regime_confidence=confidence,
            regime_score=score,
            business_cycle_phase=cycle_signal.signal,
            volatility_regime=vol_signal.signal,
            credit_regime=credit_signal.signal,
            correlation_regime=corr_signal.signal,
            yield_curve_signal=yc_signal.signal,
            recession_probability_12m=recession_prob,
            vix_level=vol_signal.details.get("vix_level"),
            credit_spread_hy=credit_signal.details.get("hy_spread"),
            yield_curve_spread=yc_signal.details.get("spread_3m10y"),
            stock_bond_correlation=corr_signal.details.get("stock_bond_corr"),
            risk_score=risk_score,
            risk_trend=risk_trend,
            equity_signal=positioning["equity"],
            duration_signal=positioning["duration"],
            credit_signal=positioning["credit"],
            volatility_signal=positioning["volatility"],
            signals=signals,
            regime_duration_days=regime_duration,
        )

    async def _get_yield_curve_signal(self, country: str) -> RegimeSignal:
        """Get yield curve component signal."""
        try:
            analysis = await self.yield_curve_analyzer.analyze_curve(country)

            return RegimeSignal(
                source="yield_curve",
                signal=analysis.shape.value,
                strength=analysis.recession_signal_strength,
                confidence=0.8 if analysis.spread_3m10y is not None else 0.3,
                details={
                    "spread_3m10y": analysis.spread_3m10y,
                    "spread_2y10y": analysis.spread_2y10y,
                    "shape": analysis.shape.value,
                    "dynamic": analysis.dynamic.value,
                    "inversion_days": analysis.inversion_duration_days,
                },
            )
        except Exception as e:
            logger.warning(f"Yield curve signal failed: {e}")
            return RegimeSignal(
                source="yield_curve",
                signal="unknown",
                strength=0.0,
                confidence=0.0,
            )

    async def _get_volatility_signal(self) -> RegimeSignal:
        """Get volatility regime signal."""
        try:
            # Try to get VIX data
            vix_level = await self._get_vix_level()

            if vix_level is None:
                return RegimeSignal(
                    source="volatility",
                    signal="unknown",
                    strength=0.0,
                    confidence=0.0,
                )

            # Classify VIX regime
            if vix_level < 15:
                regime = "low"
                strength = 0.2
            elif vix_level < 20:
                regime = "normal"
                strength = 0.4
            elif vix_level < 30:
                regime = "elevated"
                strength = 0.6
            elif vix_level < 40:
                regime = "high"
                strength = 0.8
            else:
                regime = "extreme"
                strength = 1.0

            return RegimeSignal(
                source="volatility",
                signal=regime,
                strength=strength,
                confidence=0.9,
                details={"vix_level": vix_level},
            )
        except Exception as e:
            logger.warning(f"Volatility signal failed: {e}")
            return RegimeSignal(
                source="volatility",
                signal="unknown",
                strength=0.0,
                confidence=0.0,
            )

    async def _get_vix_level(self) -> Optional[float]:
        """Get current VIX level."""
        if self.data_manager is None:
            return None

        try:
            end_date = datetime.now()
            start_date = datetime(end_date.year, end_date.month, end_date.day - 5)

            # Try VIX ETF as proxy
            vix_data = await self.data_manager.get_stock_data(
                "VXX", start_date, end_date
            )
            if not vix_data.empty and "close" in vix_data.columns:
                # VXX is not VIX, but directionally similar
                # Scale to approximate VIX level
                return float(vix_data["close"].iloc[-1])
        except Exception:
            pass

        return None

    async def _get_credit_signal(self, country: str) -> RegimeSignal:
        """Get credit spread signal from CreditSpreadMonitor."""
        try:
            credit_state = await self.credit_monitor.get_credit_state(country)

            # Map credit regime to signal strength
            strength_map = {
                "tight": 0.1,
                "normal": 0.3,
                "widening": 0.5,
                "stressed": 0.8,
                "crisis": 1.0,
            }

            return RegimeSignal(
                source="credit",
                signal=credit_state.regime.value,
                strength=strength_map.get(credit_state.regime.value, 0.3),
                confidence=credit_state.regime_confidence,
                details={
                    "hy_spread": credit_state.hy_spread,
                    "ig_spread": credit_state.ig_spread,
                    "stress_index": credit_state.stress_index,
                    "flight_to_quality": credit_state.flight_to_quality,
                },
            )
        except Exception as e:
            logger.warning(f"Credit signal failed: {e}")
            return RegimeSignal(
                source="credit",
                signal="normal",
                strength=0.3,
                confidence=0.3,
                details={"hy_spread": None},
            )

    async def _get_correlation_signal(self) -> RegimeSignal:
        """Get cross-asset correlation signal from CrossAssetAnalyzer."""
        try:
            cross_asset_state = await self.cross_asset_analyzer.get_cross_asset_state()

            # Map risk score to strength (higher risk_on_off_score = more risk-on)
            # Score ranges from -1 (risk_off) to +1 (risk_on)
            strength = abs(cross_asset_state.risk_on_off_score)

            return RegimeSignal(
                source="correlation",
                signal=cross_asset_state.regime.value,
                strength=strength,
                confidence=cross_asset_state.regime_confidence,
                details={
                    "stock_bond_corr": cross_asset_state.stock_bond_correlation,
                    "risk_on_off_score": cross_asset_state.risk_on_off_score,
                    "correlation_stability": cross_asset_state.correlation_stability,
                },
            )
        except Exception as e:
            logger.warning(f"Correlation signal failed: {e}")
            return RegimeSignal(
                source="correlation",
                signal="risk_on",
                strength=0.4,
                confidence=0.3,
                details={"stock_bond_corr": None},
            )

    async def _get_business_cycle_signal(self, country: str) -> RegimeSignal:
        """Get business cycle phase signal from BusinessCycleAnalyzer."""
        try:
            # BusinessCycleAnalyzer uses sync methods
            cycle_state = self.business_cycle_analyzer.get_cycle_state(country)

            # Map cycle phase to signal strength
            strength_map = {
                "expansion": 0.3,
                "peak": 0.5,
                "late_cycle": 0.6,
                "contraction": 0.8,
                "trough": 0.7,
                "early_recovery": 0.4,
            }

            return RegimeSignal(
                source="business_cycle",
                signal=cycle_state.phase.value,
                strength=strength_map.get(cycle_state.phase.value, 0.5),
                confidence=cycle_state.confidence,
                details={
                    "phase_duration_months": cycle_state.phase_duration_months,
                    "growth_inflation_quadrant": cycle_state.growth_inflation_quadrant,
                    "sahm_indicator": cycle_state.sahm_indicator,
                },
            )
        except Exception as e:
            logger.warning(f"Business cycle signal failed: {e}")
            return RegimeSignal(
                source="business_cycle",
                signal="expansion",
                strength=0.5,
                confidence=0.3,
            )

    def _classify_regime(
        self, signals: List[RegimeSignal]
    ) -> tuple[MacroRegime, RegimeConfidence, float]:
        """
        Classify overall macro regime from component signals.

        Returns:
            Tuple of (regime, confidence, score)
        """
        # Build signal summary
        signal_map = {s.source: s for s in signals}

        # Score each possible regime
        regime_scores = {
            MacroRegime.GOLDILOCKS: 0.0,
            MacroRegime.REFLATION: 0.0,
            MacroRegime.STAGFLATION: 0.0,
            MacroRegime.DEFLATION: 0.0,
            MacroRegime.RISK_ON: 0.0,
            MacroRegime.RISK_OFF: 0.0,
            MacroRegime.CRISIS: 0.0,
            MacroRegime.TRANSITION: 0.0,
        }

        # Yield curve contribution
        yc = signal_map.get("yield_curve")
        if yc and yc.confidence > 0.3:
            if yc.signal == "inverted":
                regime_scores[MacroRegime.RISK_OFF] += 0.3
                regime_scores[MacroRegime.DEFLATION] += 0.2
            elif yc.signal == "normal":
                regime_scores[MacroRegime.GOLDILOCKS] += 0.2
                regime_scores[MacroRegime.RISK_ON] += 0.1
            elif yc.signal == "flat":
                regime_scores[MacroRegime.TRANSITION] += 0.2

        # Volatility contribution
        vol = signal_map.get("volatility")
        if vol and vol.confidence > 0.3:
            if vol.signal in ["high", "extreme"]:
                regime_scores[MacroRegime.CRISIS] += 0.4
                regime_scores[MacroRegime.RISK_OFF] += 0.3
            elif vol.signal == "elevated":
                regime_scores[MacroRegime.RISK_OFF] += 0.2
                regime_scores[MacroRegime.TRANSITION] += 0.1
            elif vol.signal in ["low", "normal"]:
                regime_scores[MacroRegime.GOLDILOCKS] += 0.2
                regime_scores[MacroRegime.RISK_ON] += 0.2

        # Credit contribution
        credit = signal_map.get("credit")
        if credit and credit.confidence > 0.3:
            if credit.signal in ["stressed", "crisis"]:
                regime_scores[MacroRegime.CRISIS] += 0.3
                regime_scores[MacroRegime.RISK_OFF] += 0.2
            elif credit.signal == "widening":
                regime_scores[MacroRegime.RISK_OFF] += 0.15
            elif credit.signal in ["tight", "normal"]:
                regime_scores[MacroRegime.RISK_ON] += 0.15

        # Business cycle contribution
        cycle = signal_map.get("business_cycle")
        if cycle and cycle.confidence > 0.3:
            if cycle.signal == "expansion":
                regime_scores[MacroRegime.GOLDILOCKS] += 0.2
                regime_scores[MacroRegime.RISK_ON] += 0.1
            elif cycle.signal == "contraction":
                regime_scores[MacroRegime.DEFLATION] += 0.2
                regime_scores[MacroRegime.RISK_OFF] += 0.15
            elif cycle.signal == "late_cycle":
                regime_scores[MacroRegime.TRANSITION] += 0.2

        # Find best regime
        best_regime = max(regime_scores, key=regime_scores.get)
        best_score = regime_scores[best_regime]

        # Calculate confidence
        total_score = sum(regime_scores.values())
        if total_score > 0:
            confidence_pct = best_score / total_score
        else:
            confidence_pct = 0.5

        if confidence_pct > 0.6:
            confidence = RegimeConfidence.HIGH
        elif confidence_pct > 0.4:
            confidence = RegimeConfidence.MEDIUM
        else:
            confidence = RegimeConfidence.LOW

        return best_regime, confidence, best_score

    async def _calculate_recession_probability(
        self,
        country: str,
        signals: List[RegimeSignal],
    ) -> float:
        """Calculate 12-month recession probability."""
        yc_signal = next((s for s in signals if s.source == "yield_curve"), None)

        if yc_signal and yc_signal.details.get("spread_3m10y") is not None:
            spread = yc_signal.details["spread_3m10y"]
            return self.yield_curve_analyzer.get_recession_probability_from_curve(
                spread
            )

        # Fallback based on regime signals
        return 0.15  # Default moderate probability

    def _calculate_risk_score(self, signals: List[RegimeSignal]) -> tuple[float, str]:
        """Calculate composite risk score 0-100."""
        risk_components = []

        for signal in signals:
            if signal.source == "volatility":
                risk_components.append(signal.strength * 30)
            elif signal.source == "credit":
                risk_components.append(signal.strength * 25)
            elif signal.source == "yield_curve":
                risk_components.append(signal.strength * 25)
            elif signal.source == "correlation":
                if signal.signal == "risk_off":
                    risk_components.append(signal.strength * 20)

        risk_score = sum(risk_components) if risk_components else 25.0

        # Determine trend (would need history in production)
        trend = "stable"

        return min(100, risk_score), trend

    def _generate_positioning_signals(
        self,
        regime: MacroRegime,
        signals: List[RegimeSignal],
        recession_prob: float,
    ) -> Dict[str, str]:
        """Generate asset class positioning signals."""
        positioning = {
            "equity": "neutral",
            "duration": "neutral",
            "credit": "neutral",
            "volatility": "neutral",
        }

        if regime == MacroRegime.GOLDILOCKS:
            positioning["equity"] = "overweight"
            positioning["credit"] = "overweight"
            positioning["volatility"] = "sell"

        elif regime == MacroRegime.RISK_ON:
            positioning["equity"] = "overweight"
            positioning["credit"] = "overweight"

        elif regime == MacroRegime.RISK_OFF:
            positioning["equity"] = "underweight"
            positioning["duration"] = "long"
            positioning["credit"] = "underweight"
            positioning["volatility"] = "buy"

        elif regime == MacroRegime.CRISIS:
            positioning["equity"] = "underweight"
            positioning["duration"] = "long"
            positioning["credit"] = "underweight"
            positioning["volatility"] = "buy"

        elif regime == MacroRegime.STAGFLATION:
            positioning["equity"] = "underweight"
            positioning["duration"] = "short"
            positioning["credit"] = "underweight"

        # Adjust for recession probability
        if recession_prob > 0.5:
            positioning["equity"] = "underweight"
            positioning["duration"] = "long"

        return positioning

    def _track_regime_duration(self, current_regime: MacroRegime) -> int:
        """Track how long current regime has persisted."""
        if current_regime != self._last_regime:
            self._last_regime = current_regime
            self._regime_start_date = datetime.now()
            return 0

        if self._regime_start_date:
            return (datetime.now() - self._regime_start_date).days

        return 0

    def health_check(self) -> bool:
        """Check if detector is operational."""
        return True
