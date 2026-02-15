"""
Performance Tracker Module

Track signal performance over time to measure
signal quality and improve future predictions.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from enum import Enum

import numpy as np
import pandas as pd

from .signal_generator import Signal, SignalStrength, SignalType

logger = logging.getLogger(__name__)


class TradeOutcome(Enum):
    """Trade outcome classification."""

    WIN = "win"
    LOSS = "loss"
    BREAKEVEN = "breakeven"
    PENDING = "pending"


@dataclass
class TrackingPeriod:
    """Time period for tracking performance."""

    start: datetime
    end: datetime

    def contains(self, dt: datetime) -> bool:
        """Check if datetime is within period."""
        return self.start <= dt <= self.end


@dataclass
class OutcomeRecord:
    """Record of a trade outcome."""

    outcome_id: str
    signal_id: str
    exit_time: datetime
    exit_price: float
    pnl: float
    pnl_percent: float
    holding_period_days: int = 0

    @property
    def is_winner(self) -> bool:
        """Check if this was a winning trade."""
        return self.pnl > 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "outcomeId": self.outcome_id,
            "signalId": self.signal_id,
            "exitTime": self.exit_time.isoformat(),
            "exitPrice": round(self.exit_price, 2),
            "pnl": round(self.pnl, 2),
            "pnlPercent": round(self.pnl_percent, 4),
            "holdingPeriodDays": self.holding_period_days,
            "isWinner": self.is_winner,
        }


@dataclass
class SignalRecord:
    """Record of a trading signal with optional outcome."""

    record_id: str
    symbol: str
    timestamp: datetime
    direction: str  # "BULLISH", "BEARISH", "NEUTRAL"
    strength: float
    confidence: float
    conviction: float = 0.0
    factors: Dict[str, float] = field(default_factory=dict)
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    outcome: Optional[OutcomeRecord] = None

    @property
    def has_outcome(self) -> bool:
        """Check if outcome has been recorded."""
        return self.outcome is not None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "recordId": self.record_id,
            "symbol": self.symbol,
            "timestamp": self.timestamp.isoformat(),
            "direction": self.direction,
            "strength": round(self.strength, 4),
            "confidence": round(self.confidence, 4),
            "conviction": round(self.conviction, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "entryPrice": self.entry_price,
            "targetPrice": self.target_price,
            "stopLoss": self.stop_loss,
            "metadata": self.metadata,
            "hasOutcome": self.has_outcome,
            "outcome": self.outcome.to_dict() if self.outcome else None,
        }


@dataclass
class TradeRecord:
    """Record of a signal and its outcome."""

    signal_id: str
    symbol: str
    signal_type: SignalType
    strength: SignalStrength
    conviction: float
    factors: Dict[str, float]

    # Entry details
    signal_date: datetime
    entry_price: float
    target_price: Optional[float]
    stop_loss: Optional[float]

    # Outcome details (filled when closed)
    exit_date: Optional[datetime] = None
    exit_price: Optional[float] = None
    outcome: TradeOutcome = TradeOutcome.PENDING
    pnl: float = 0.0
    pnl_percent: float = 0.0
    holding_days: int = 0
    exit_reason: str = ""

    # Performance context
    max_favorable: float = 0.0  # Maximum favorable excursion
    max_adverse: float = 0.0  # Maximum adverse excursion
    peak_price: Optional[float] = None
    trough_price: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "signalId": self.signal_id,
            "symbol": self.symbol,
            "signalType": self.signal_type.value,
            "strength": self.strength.value,
            "conviction": round(self.conviction, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "signalDate": self.signal_date.isoformat(),
            "entryPrice": self.entry_price,
            "targetPrice": self.target_price,
            "stopLoss": self.stop_loss,
            "exitDate": self.exit_date.isoformat() if self.exit_date else None,
            "exitPrice": self.exit_price,
            "outcome": self.outcome.value,
            "pnl": round(self.pnl, 2),
            "pnlPercent": round(self.pnl_percent, 4),
            "holdingDays": self.holding_days,
            "exitReason": self.exit_reason,
            "maxFavorable": round(self.max_favorable, 4),
            "maxAdverse": round(self.max_adverse, 4),
        }


@dataclass
class PerformanceStats:
    """Aggregate performance statistics."""

    # Overall performance
    total_signals: int = 0
    closed_signals: int = 0
    pending_signals: int = 0
    signals_with_outcomes: int = 0  # Alias for closed_signals
    win_rate: float = 0.0
    avg_return: float = 0.0
    average_pnl: float = 0.0  # Alias for avg_return
    total_return: float = 0.0

    # By signal type
    buy_count: int = 0
    buy_win_rate: float = 0.0
    buy_avg_return: float = 0.0
    sell_count: int = 0
    sell_win_rate: float = 0.0
    sell_avg_return: float = 0.0

    # By strength
    weak_signals: int = 0
    weak_win_rate: float = 0.0
    moderate_signals: int = 0
    moderate_win_rate: float = 0.0
    strong_signals: int = 0
    strong_win_rate: float = 0.0
    very_strong_signals: int = 0
    very_strong_win_rate: float = 0.0

    # Risk metrics
    avg_holding_days: float = 0.0
    avg_max_favorable: float = 0.0
    avg_max_adverse: float = 0.0
    profit_factor: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0

    # Factor performance
    factor_performance: Dict[str, float] = field(default_factory=dict)

    # Time series
    cumulative_returns: pd.Series = field(default_factory=pd.Series)
    rolling_win_rate: pd.Series = field(default_factory=pd.Series)

    def __post_init__(self):
        """Set alias values."""
        self.signals_with_outcomes = self.closed_signals
        self.average_pnl = self.avg_return

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "overall": {
                "totalSignals": self.total_signals,
                "closedSignals": self.closed_signals,
                "pendingSignals": self.pending_signals,
                "winRate": round(self.win_rate, 4),
                "avgReturn": round(self.avg_return, 4),
                "totalReturn": round(self.total_return, 4),
            },
            "bySignalType": {
                "buy": {
                    "count": self.buy_count,
                    "winRate": round(self.buy_win_rate, 4),
                    "avgReturn": round(self.buy_avg_return, 4),
                },
                "sell": {
                    "count": self.sell_count,
                    "winRate": round(self.sell_win_rate, 4),
                    "avgReturn": round(self.sell_avg_return, 4),
                },
            },
            "byStrength": {
                "weak": {
                    "count": self.weak_signals,
                    "winRate": round(self.weak_win_rate, 4),
                },
                "moderate": {
                    "count": self.moderate_signals,
                    "winRate": round(self.moderate_win_rate, 4),
                },
                "strong": {
                    "count": self.strong_signals,
                    "winRate": round(self.strong_win_rate, 4),
                },
                "veryStrong": {
                    "count": self.very_strong_signals,
                    "winRate": round(self.very_strong_win_rate, 4),
                },
            },
            "risk": {
                "avgHoldingDays": round(self.avg_holding_days, 1),
                "avgMaxFavorable": round(self.avg_max_favorable, 4),
                "avgMaxAdverse": round(self.avg_max_adverse, 4),
                "profitFactor": round(self.profit_factor, 4),
                "avgWin": round(self.avg_win, 4),
                "avgLoss": round(self.avg_loss, 4),
            },
            "factorPerformance": {
                k: round(v, 4) for k, v in self.factor_performance.items()
            },
        }


class PerformanceTracker:
    """
    Track signal performance over time.

    Records signals, updates their outcomes, and provides
    performance analytics for signal quality assessment.

    Supports two interfaces:
    1. Signal-based: record_signal(signal: Signal) - uses Signal objects
    2. Dict-based: record_signal(symbol=, timestamp=, ...) - uses keyword args
    """

    def __init__(
        self,
        data_manager=None,
        storage_path: Optional[str] = None,
        retention_days: int = 365,
    ):
        """
        Initialize performance tracker.

        Args:
            data_manager: DataManager instance for price data
            storage_path: Optional path for persistent storage
            retention_days: Number of days to retain records
        """
        self.data_manager = data_manager
        self.storage_path = storage_path
        self.retention_days = retention_days
        self._records: Dict[str, TradeRecord] = {}
        self._signal_records: Dict[str, SignalRecord] = {}
        self._outcome_counter = 0
        logger.info("PerformanceTracker initialized")

    def record_signal(
        self,
        signal: Optional[Signal] = None,
        entry_price: Optional[float] = None,
        # Keyword-based interface
        symbol: Optional[str] = None,
        timestamp: Optional[datetime] = None,
        direction: Optional[str] = None,
        strength: Optional[float] = None,
        confidence: Optional[float] = None,
        conviction: Optional[Any] = None,
        factors: Optional[Dict[str, float]] = None,
        target_price: Optional[float] = None,
        stop_loss: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """
        Record a new signal for tracking.

        Supports two calling conventions:
        1. record_signal(signal=Signal(...)) - Signal object
        2. record_signal(symbol="AAPL", direction="BULLISH", ...) - kwargs

        Args:
            signal: Signal object to record (optional)
            entry_price: Entry price
            symbol: Stock symbol (for dict-based API)
            timestamp: Signal timestamp (for dict-based API)
            direction: Signal direction (for dict-based API)
            strength: Signal strength (for dict-based API)
            confidence: Confidence level (for dict-based API)
            conviction: Conviction level (for dict-based API)
            factors: Factor scores (for dict-based API)
            target_price: Target price (for dict-based API)
            stop_loss: Stop loss price (for dict-based API)
            metadata: Additional metadata (for dict-based API)

        Returns:
            TradeRecord (for Signal API) or str record_id (for dict API)
        """
        import uuid

        # Dict-based interface
        if signal is None and symbol is not None:
            record_id = str(uuid.uuid4())[:8]
            conv_value = 0.0
            if isinstance(conviction, str):
                conv_map = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}
                conv_value = conv_map.get(conviction.upper(), 0.5)
            elif isinstance(conviction, (int, float)):
                conv_value = float(conviction)

            signal_record = SignalRecord(
                record_id=record_id,
                symbol=symbol,
                timestamp=timestamp or datetime.now(),
                direction=direction or "NEUTRAL",
                strength=strength or 0.0,
                confidence=confidence or 0.0,
                conviction=conv_value,
                factors=factors or {},
                entry_price=entry_price,
                target_price=target_price,
                stop_loss=stop_loss,
                metadata=metadata or {},
            )
            self._signal_records[record_id] = signal_record
            logger.info(f"Recorded signal {record_id} for {symbol}")
            return record_id

        # Signal object-based interface
        if signal is not None:
            price = entry_price or signal.price_at_signal or 0.0

            record = TradeRecord(
                signal_id=signal.signal_id,
                symbol=signal.symbol,
                signal_type=signal.signal_type,
                strength=signal.strength,
                conviction=signal.conviction,
                factors=signal.factors,
                signal_date=signal.timestamp,
                entry_price=price,
                target_price=signal.target_price,
                stop_loss=signal.stop_loss,
                peak_price=price,
                trough_price=price,
            )

            self._records[signal.signal_id] = record
            logger.info(f"Recorded signal {signal.signal_id} for {signal.symbol}")
            return record

        raise ValueError("Either signal or symbol must be provided")

    def record_outcome(
        self,
        signal_id: str,
        exit_price: float,
        exit_date: Optional[datetime] = None,
        exit_time: Optional[datetime] = None,
        exit_reason: str = "manual",
        pnl: Optional[float] = None,
        pnl_percent: Optional[float] = None,
        holding_period_days: Optional[int] = None,
    ) -> Optional[Any]:
        """
        Record the outcome of a signal.

        Args:
            signal_id: Signal ID to update
            exit_price: Exit price
            exit_date: Exit date (defaults to now)
            exit_time: Alias for exit_date
            exit_reason: Reason for exit
            pnl: Pre-calculated PnL (optional)
            pnl_percent: Pre-calculated PnL percent (optional)
            holding_period_days: Holding period in days (optional)

        Returns:
            Updated record or outcome_id
        """
        # Use exit_time if exit_date not provided
        exit_dt = exit_date or exit_time or datetime.now()

        # Check dict-based interface first
        if signal_id in self._signal_records:
            record = self._signal_records[signal_id]

            # Check if outcome already recorded
            if record.outcome is not None:
                raise ValueError("Outcome already recorded for this signal")

            # Calculate PnL if not provided
            if pnl is None and record.entry_price:
                if record.direction == "BULLISH":
                    pnl = exit_price - record.entry_price
                elif record.direction == "BEARISH":
                    pnl = record.entry_price - exit_price
                else:
                    pnl = 0.0

            if pnl_percent is None and record.entry_price:
                pnl_percent = pnl / record.entry_price if record.entry_price else 0.0

            holding_days = holding_period_days or (exit_dt - record.timestamp).days

            self._outcome_counter += 1
            outcome_id = f"outcome_{self._outcome_counter:04d}"

            record.outcome = OutcomeRecord(
                outcome_id=outcome_id,
                signal_id=signal_id,
                exit_time=exit_dt,
                exit_price=exit_price,
                pnl=pnl or 0.0,
                pnl_percent=pnl_percent or 0.0,
                holding_period_days=holding_days,
            )

            logger.info(f"Recorded outcome for {signal_id}: PnL={pnl_percent:.2%}")
            return outcome_id

        # Check Signal-based interface
        if signal_id not in self._records:
            raise ValueError(f"Signal not found: {signal_id}")

        record = self._records[signal_id]

        # Calculate outcome
        holding_days = (exit_dt - record.signal_date).days

        if pnl is None:
            if record.signal_type == SignalType.BUY:
                pnl = exit_price - record.entry_price
            elif record.signal_type == SignalType.SELL:
                pnl = record.entry_price - exit_price
            else:
                pnl = 0

        if pnl_percent is None:
            pnl_percent = pnl / record.entry_price if record.entry_price > 0 else 0

        # Determine outcome
        if pnl_percent > 0.005:  # More than 0.5% profit
            outcome = TradeOutcome.WIN
        elif pnl_percent < -0.005:  # More than 0.5% loss
            outcome = TradeOutcome.LOSS
        else:
            outcome = TradeOutcome.BREAKEVEN

        # Update record
        record.exit_date = exit_dt
        record.exit_price = exit_price
        record.pnl = pnl
        record.pnl_percent = pnl_percent
        record.holding_days = holding_days
        record.outcome = outcome
        record.exit_reason = exit_reason

        logger.info(
            f"Recorded outcome for {signal_id}: {outcome.value}, "
            f"PnL={pnl_percent:.2%}, held {holding_days} days"
        )

        return record

    def get_signal(self, record_id: str) -> Optional[SignalRecord]:
        """
        Get a specific signal record.

        Args:
            record_id: Record ID to retrieve

        Returns:
            SignalRecord or None if not found
        """
        return self._signal_records.get(record_id)

    def get_signal_history(
        self,
        symbol: Optional[str] = None,
        direction: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        with_outcomes_only: bool = False,
    ) -> List[SignalRecord]:
        """
        Get signal history as a list.

        Args:
            symbol: Filter by symbol
            direction: Filter by direction
            start_date: Filter by start date
            end_date: Filter by end date
            with_outcomes_only: Only return signals with outcomes

        Returns:
            List of SignalRecord objects
        """
        records = list(self._signal_records.values())

        if symbol:
            records = [r for r in records if r.symbol == symbol]
        if direction:
            records = [r for r in records if r.direction == direction]
        if start_date:
            records = [r for r in records if r.timestamp >= start_date]
        if end_date:
            records = [r for r in records if r.timestamp <= end_date]
        if with_outcomes_only:
            records = [r for r in records if r.has_outcome]

        return sorted(records, key=lambda r: r.timestamp, reverse=True)

    def get_signal_history_df(self) -> pd.DataFrame:
        """
        Get signal history as DataFrame.

        Returns:
            DataFrame with signal records
        """
        records = list(self._signal_records.values())
        if not records:
            return pd.DataFrame(
                columns=[
                    "record_id",
                    "symbol",
                    "direction",
                    "strength",
                    "confidence",
                    "timestamp",
                    "has_outcome",
                ]
            )

        data = []
        for r in records:
            data.append(
                {
                    "record_id": r.record_id,
                    "symbol": r.symbol,
                    "direction": r.direction,
                    "strength": r.strength,
                    "confidence": r.confidence,
                    "timestamp": r.timestamp,
                    "entry_price": r.entry_price,
                    "target_price": r.target_price,
                    "has_outcome": r.has_outcome,
                }
            )

        return pd.DataFrame(data)

    def save(self) -> None:
        """Save records to storage."""
        if self.storage_path:
            import json

            data = {
                "signal_records": {
                    k: v.to_dict() for k, v in self._signal_records.items()
                }
            }
            with open(self.storage_path, "w") as f:
                json.dump(data, f)
            logger.info(
                f"Saved {len(self._signal_records)} records to {self.storage_path}"
            )

    def load(self) -> None:
        """Load records from storage."""
        if self.storage_path:
            import json
            import os

            if os.path.exists(self.storage_path):
                with open(self.storage_path, "r") as f:
                    data = json.load(f)
                # Reconstruct records from data
                signal_records_data = data.get("signal_records", {})
                for record_id, record_data in signal_records_data.items():
                    self._signal_records[record_id] = SignalRecord(
                        record_id=record_data.get("record_id", record_id),
                        symbol=record_data.get("symbol", ""),
                        timestamp=datetime.fromisoformat(record_data["timestamp"]),
                        direction=record_data.get("direction", ""),
                        strength=record_data.get("strength", 0.0),
                        confidence=record_data.get("confidence", 0.0),
                        factors=record_data.get("factors", {}),
                    )
                logger.info(
                    f"Loaded {len(self._signal_records)} records from {self.storage_path}"
                )

    def export_to_csv(self, path: str) -> None:
        """Export signal history to CSV."""
        df = self.get_signal_history_df()
        df.to_csv(path, index=False)
        logger.info(f"Exported {len(df)} records to {path}")

    def export_to_json(self, path: str) -> None:
        """Export signal history to JSON."""
        import json

        records = [r.to_dict() for r in self._signal_records.values()]
        with open(path, "w") as f:
            json.dump(records, f, indent=2, default=str)
        logger.info(f"Exported {len(records)} records to {path}")

    def update_price(
        self,
        signal_id: str,
        current_price: float,
    ) -> Optional[TradeRecord]:
        """
        Update current price for an open position.

        Updates max favorable/adverse excursion tracking.

        Args:
            signal_id: Signal ID to update
            current_price: Current market price

        Returns:
            Updated TradeRecord or None if not found
        """
        if signal_id not in self._records:
            return None

        record = self._records[signal_id]

        if record.outcome != TradeOutcome.PENDING:
            return record  # Already closed

        # Update peak/trough
        if record.peak_price is None or current_price > record.peak_price:
            record.peak_price = current_price
        if record.trough_price is None or current_price < record.trough_price:
            record.trough_price = current_price

        # Calculate excursions
        entry = record.entry_price
        if entry > 0:
            if record.signal_type == SignalType.BUY:
                record.max_favorable = (record.peak_price - entry) / entry
                record.max_adverse = (entry - record.trough_price) / entry
            elif record.signal_type == SignalType.SELL:
                record.max_favorable = (entry - record.trough_price) / entry
                record.max_adverse = (record.peak_price - entry) / entry

        return record

    def get_performance_stats(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        symbols: Optional[List[str]] = None,
        group_by: Optional[str] = None,
        period: Optional[TrackingPeriod] = None,
    ) -> Any:
        """
        Get aggregate performance statistics.

        Args:
            start_date: Filter signals from this date
            end_date: Filter signals to this date
            symbols: Filter to specific symbols
            group_by: Group results by dimension ("symbol", "direction")
            period: TrackingPeriod to filter by

        Returns:
            PerformanceStats with comprehensive metrics, or Dict if group_by specified
        """
        # Apply period filter
        if period:
            start_date = period.start
            end_date = period.end

        # Try dict-based SignalRecord API first
        if self._signal_records:
            return self._get_signal_record_stats(
                start_date, end_date, symbols, group_by
            )

        # Fall back to Signal object-based TradeRecord API
        records = list(self._records.values())

        if start_date:
            records = [r for r in records if r.signal_date >= start_date]
        if end_date:
            records = [r for r in records if r.signal_date <= end_date]
        if symbols:
            records = [r for r in records if r.symbol in symbols]

        if not records:
            return self._empty_stats()

        # Separate closed and pending
        closed = [r for r in records if r.outcome != TradeOutcome.PENDING]
        pending = [r for r in records if r.outcome == TradeOutcome.PENDING]

        # Overall metrics
        total_signals = len(records)
        closed_signals = len(closed)
        pending_signals = len(pending)

        if closed:
            wins = [r for r in closed if r.outcome == TradeOutcome.WIN]
            win_rate = len(wins) / len(closed)
            avg_return = np.mean([r.pnl_percent for r in closed])
            total_return = sum(r.pnl_percent for r in closed)
        else:
            win_rate = 0
            avg_return = 0
            total_return = 0

        # By signal type
        buy_records = [r for r in closed if r.signal_type == SignalType.BUY]
        sell_records = [r for r in closed if r.signal_type == SignalType.SELL]

        buy_count = len(buy_records)
        buy_wins = [r for r in buy_records if r.outcome == TradeOutcome.WIN]
        buy_win_rate = len(buy_wins) / len(buy_records) if buy_records else 0
        buy_avg_return = (
            np.mean([r.pnl_percent for r in buy_records]) if buy_records else 0
        )

        sell_count = len(sell_records)
        sell_wins = [r for r in sell_records if r.outcome == TradeOutcome.WIN]
        sell_win_rate = len(sell_wins) / len(sell_records) if sell_records else 0
        sell_avg_return = (
            np.mean([r.pnl_percent for r in sell_records]) if sell_records else 0
        )

        # By strength
        strength_stats = {}
        for strength in SignalStrength:
            strength_records = [r for r in closed if r.strength == strength]
            strength_wins = [
                r for r in strength_records if r.outcome == TradeOutcome.WIN
            ]
            strength_stats[strength] = {
                "count": len(strength_records),
                "win_rate": (
                    len(strength_wins) / len(strength_records)
                    if strength_records
                    else 0
                ),
            }

        # Risk metrics
        if closed:
            avg_holding_days = np.mean([r.holding_days for r in closed])
            avg_max_favorable = np.mean([r.max_favorable for r in closed])
            avg_max_adverse = np.mean([r.max_adverse for r in closed])

            wins_pnl = [r.pnl for r in closed if r.pnl > 0]
            losses_pnl = [abs(r.pnl) for r in closed if r.pnl < 0]

            total_wins = sum(wins_pnl) if wins_pnl else 0
            total_losses = sum(losses_pnl) if losses_pnl else 0
            profit_factor = (
                total_wins / total_losses if total_losses > 0 else float("inf")
            )

            avg_win = (
                np.mean([r.pnl_percent for r in closed if r.pnl > 0]) if wins_pnl else 0
            )
            avg_loss = (
                np.mean([r.pnl_percent for r in closed if r.pnl < 0])
                if losses_pnl
                else 0
            )
        else:
            avg_holding_days = 0
            avg_max_favorable = 0
            avg_max_adverse = 0
            profit_factor = 0
            avg_win = 0
            avg_loss = 0

        # Factor performance
        factor_performance = self._calculate_factor_performance(closed)

        # Time series
        cumulative_returns = self._calculate_cumulative_returns(closed)
        rolling_win_rate = self._calculate_rolling_win_rate(closed, window=20)

        return PerformanceStats(
            total_signals=total_signals,
            closed_signals=closed_signals,
            pending_signals=pending_signals,
            win_rate=win_rate,
            avg_return=avg_return,
            total_return=total_return,
            buy_count=buy_count,
            buy_win_rate=buy_win_rate,
            buy_avg_return=buy_avg_return,
            sell_count=sell_count,
            sell_win_rate=sell_win_rate,
            sell_avg_return=sell_avg_return,
            weak_signals=strength_stats[SignalStrength.WEAK]["count"],
            weak_win_rate=strength_stats[SignalStrength.WEAK]["win_rate"],
            moderate_signals=strength_stats[SignalStrength.MODERATE]["count"],
            moderate_win_rate=strength_stats[SignalStrength.MODERATE]["win_rate"],
            strong_signals=strength_stats[SignalStrength.STRONG]["count"],
            strong_win_rate=strength_stats[SignalStrength.STRONG]["win_rate"],
            very_strong_signals=strength_stats[SignalStrength.VERY_STRONG]["count"],
            very_strong_win_rate=strength_stats[SignalStrength.VERY_STRONG]["win_rate"],
            avg_holding_days=avg_holding_days,
            avg_max_favorable=avg_max_favorable,
            avg_max_adverse=avg_max_adverse,
            profit_factor=profit_factor,
            avg_win=avg_win,
            avg_loss=avg_loss,
            factor_performance=factor_performance,
            cumulative_returns=cumulative_returns,
            rolling_win_rate=rolling_win_rate,
        )

    def get_trade_history_df(
        self,
        symbol: Optional[str] = None,
        signal_type: Optional[SignalType] = None,
        outcome: Optional[TradeOutcome] = None,
        limit: int = 100,
    ) -> pd.DataFrame:
        """
        Get trade history as DataFrame (for Signal object-based API).

        Args:
            symbol: Filter by symbol
            signal_type: Filter by signal type
            outcome: Filter by outcome
            limit: Maximum records to return

        Returns:
            DataFrame with trade history
        """
        records = list(self._records.values())

        # Apply filters
        if symbol:
            records = [r for r in records if r.symbol == symbol]
        if signal_type:
            records = [r for r in records if r.signal_type == signal_type]
        if outcome:
            records = [r for r in records if r.outcome == outcome]

        # Sort by date, most recent first
        records = sorted(records, key=lambda r: r.signal_date, reverse=True)[:limit]

        if not records:
            return pd.DataFrame(
                columns=[
                    "signal_id",
                    "symbol",
                    "signal_type",
                    "strength",
                    "conviction",
                    "signal_date",
                    "entry_price",
                    "exit_price",
                    "pnl_percent",
                    "outcome",
                    "holding_days",
                ]
            )

        data = []
        for r in records:
            data.append(
                {
                    "signal_id": r.signal_id,
                    "symbol": r.symbol,
                    "signal_type": r.signal_type.value,
                    "strength": r.strength.value,
                    "conviction": r.conviction,
                    "signal_date": r.signal_date,
                    "entry_price": r.entry_price,
                    "exit_price": r.exit_price,
                    "pnl_percent": r.pnl_percent,
                    "outcome": r.outcome.value,
                    "holding_days": r.holding_days,
                    "exit_reason": r.exit_reason,
                }
            )

        return pd.DataFrame(data)

    def get_pending_signals(self) -> List[TradeRecord]:
        """Get all pending (open) signals."""
        return [r for r in self._records.values() if r.outcome == TradeOutcome.PENDING]

    def get_record(self, signal_id: str) -> Optional[TradeRecord]:
        """Get a specific trade record."""
        return self._records.get(signal_id)

    def clear_history(self, before_date: Optional[datetime] = None) -> int:
        """
        Clear signal history.

        Args:
            before_date: Only clear records before this date (clears all if None)

        Returns:
            Number of records cleared
        """
        if before_date is None:
            count = len(self._records)
            self._records.clear()
            logger.info(f"Cleared all {count} records")
            return count

        to_remove = [
            sig_id
            for sig_id, record in self._records.items()
            if record.signal_date < before_date
            and record.outcome != TradeOutcome.PENDING
        ]

        for sig_id in to_remove:
            del self._records[sig_id]

        logger.info(f"Cleared {len(to_remove)} records before {before_date}")
        return len(to_remove)

    def _calculate_factor_performance(
        self,
        records: List[TradeRecord],
    ) -> Dict[str, float]:
        """Calculate which factors correlate with winning trades."""
        if not records:
            return {}

        factor_names = set()
        for r in records:
            factor_names.update(r.factors.keys())

        performance = {}

        for factor in factor_names:
            # Get records with this factor
            factor_records = [r for r in records if factor in r.factors]
            if not factor_records:
                continue

            # Correlate factor value with outcome
            factor_values = [r.factors[factor] for r in factor_records]
            outcomes = [
                (
                    1
                    if r.outcome == TradeOutcome.WIN
                    else -1 if r.outcome == TradeOutcome.LOSS else 0
                )
                for r in factor_records
            ]

            # Simple correlation
            if len(set(factor_values)) > 1 and len(set(outcomes)) > 1:
                correlation = np.corrcoef(factor_values, outcomes)[0, 1]
                performance[factor] = correlation if not np.isnan(correlation) else 0
            else:
                performance[factor] = 0

        return performance

    def _calculate_cumulative_returns(
        self,
        records: List[TradeRecord],
    ) -> pd.Series:
        """Calculate cumulative returns over time."""
        if not records:
            return pd.Series()

        sorted_records = sorted(records, key=lambda r: r.exit_date or r.signal_date)

        dates = []
        cumulative = []
        running_total = 0

        for r in sorted_records:
            if r.exit_date:
                running_total += r.pnl_percent
                dates.append(r.exit_date)
                cumulative.append(running_total)

        if not dates:
            return pd.Series()

        return pd.Series(cumulative, index=pd.DatetimeIndex(dates))

    def _calculate_rolling_win_rate(
        self,
        records: List[TradeRecord],
        window: int = 20,
    ) -> pd.Series:
        """Calculate rolling win rate over time."""
        if not records:
            return pd.Series()

        sorted_records = sorted(records, key=lambda r: r.exit_date or r.signal_date)

        dates = []
        win_rates = []

        for i in range(len(sorted_records)):
            start_idx = max(0, i - window + 1)
            window_records = sorted_records[start_idx : i + 1]

            wins = sum(1 for r in window_records if r.outcome == TradeOutcome.WIN)
            total = len(window_records)

            if sorted_records[i].exit_date:
                dates.append(sorted_records[i].exit_date)
                win_rates.append(wins / total if total > 0 else 0)

        if not dates:
            return pd.Series()

        return pd.Series(win_rates, index=pd.DatetimeIndex(dates))

    def _get_signal_record_stats(
        self,
        start_date: Optional[datetime],
        end_date: Optional[datetime],
        symbols: Optional[List[str]],
        group_by: Optional[str],
    ) -> Any:
        """Get stats for dict-based SignalRecord API."""
        records = list(self._signal_records.values())

        # Apply filters
        if start_date:
            records = [r for r in records if r.timestamp >= start_date]
        if end_date:
            records = [r for r in records if r.timestamp <= end_date]
        if symbols:
            records = [r for r in records if r.symbol in symbols]

        if not records:
            return self._empty_stats()

        # Handle group_by
        if group_by:
            grouped = {}
            if group_by == "symbol":
                for r in records:
                    if r.symbol not in grouped:
                        grouped[r.symbol] = []
                    grouped[r.symbol].append(r)
            elif group_by == "direction":
                for r in records:
                    if r.direction not in grouped:
                        grouped[r.direction] = []
                    grouped[r.direction].append(r)
            else:
                grouped = {"all": records}

            result = {}
            for key, group_records in grouped.items():
                with_outcomes = [r for r in group_records if r.has_outcome]
                if with_outcomes:
                    wins = [r for r in with_outcomes if r.outcome and r.outcome.pnl > 0]
                    win_rate = len(wins) / len(with_outcomes)
                    avg_pnl = np.mean(
                        [r.outcome.pnl_percent for r in with_outcomes if r.outcome]
                    )
                else:
                    win_rate = 0.0
                    avg_pnl = 0.0
                result[key] = PerformanceStats(
                    total_signals=len(group_records),
                    closed_signals=len(with_outcomes),
                    signals_with_outcomes=len(with_outcomes),
                    win_rate=win_rate,
                    avg_return=avg_pnl,
                    average_pnl=avg_pnl,
                )
            return result

        # Calculate overall stats
        with_outcomes = [r for r in records if r.has_outcome]
        without_outcomes = [r for r in records if not r.has_outcome]

        if with_outcomes:
            wins = [r for r in with_outcomes if r.outcome and r.outcome.pnl > 0]
            win_rate = len(wins) / len(with_outcomes)
            avg_return = np.mean(
                [r.outcome.pnl_percent for r in with_outcomes if r.outcome]
            )
            total_return = sum(
                r.outcome.pnl_percent for r in with_outcomes if r.outcome
            )
        else:
            win_rate = 0.0
            avg_return = 0.0
            total_return = 0.0

        # By direction
        bullish = [r for r in with_outcomes if r.direction == "BULLISH"]
        bearish = [r for r in with_outcomes if r.direction == "BEARISH"]

        return PerformanceStats(
            total_signals=len(records),
            closed_signals=len(with_outcomes),
            pending_signals=len(without_outcomes),
            signals_with_outcomes=len(with_outcomes),
            win_rate=win_rate,
            avg_return=avg_return,
            average_pnl=avg_return,
            total_return=total_return,
            buy_count=len(bullish),
            buy_win_rate=(
                len([r for r in bullish if r.outcome and r.outcome.pnl > 0])
                / len(bullish)
                if bullish
                else 0
            ),
            buy_avg_return=(
                np.mean([r.outcome.pnl_percent for r in bullish if r.outcome])
                if bullish
                else 0
            ),
            sell_count=len(bearish),
            sell_win_rate=(
                len([r for r in bearish if r.outcome and r.outcome.pnl > 0])
                / len(bearish)
                if bearish
                else 0
            ),
            sell_avg_return=(
                np.mean([r.outcome.pnl_percent for r in bearish if r.outcome])
                if bearish
                else 0
            ),
        )

    def _empty_stats(self) -> PerformanceStats:
        """Return empty performance stats."""
        return PerformanceStats(
            total_signals=0,
            closed_signals=0,
            pending_signals=0,
            win_rate=0,
            avg_return=0,
            total_return=0,
            buy_count=0,
            buy_win_rate=0,
            buy_avg_return=0,
            sell_count=0,
            sell_win_rate=0,
            sell_avg_return=0,
            weak_signals=0,
            weak_win_rate=0,
            moderate_signals=0,
            moderate_win_rate=0,
            strong_signals=0,
            strong_win_rate=0,
            very_strong_signals=0,
            very_strong_win_rate=0,
            avg_holding_days=0,
            avg_max_favorable=0,
            avg_max_adverse=0,
            profit_factor=0,
            avg_win=0,
            avg_loss=0,
            factor_performance={},
            cumulative_returns=pd.Series(),
            rolling_win_rate=pd.Series(),
        )

    def export_to_dataframe(self) -> pd.DataFrame:
        """Export all records to a DataFrame."""
        records = list(self._records.values())
        if not records:
            return pd.DataFrame()

        data = [r.to_dict() for r in records]
        return pd.DataFrame(data)

    def import_from_dataframe(self, df: pd.DataFrame) -> int:
        """
        Import records from a DataFrame.

        Args:
            df: DataFrame with trade records

        Returns:
            Number of records imported
        """
        count = 0

        for _, row in df.iterrows():
            try:
                record = TradeRecord(
                    signal_id=row.get("signalId", f"imported_{count}"),
                    symbol=row.get("symbol", ""),
                    signal_type=SignalType(row.get("signalType", "hold")),
                    strength=SignalStrength(row.get("strength", "weak")),
                    conviction=row.get("conviction", 0),
                    factors=row.get("factors", {}),
                    signal_date=pd.to_datetime(row.get("signalDate")),
                    entry_price=row.get("entryPrice", 0),
                    target_price=row.get("targetPrice"),
                    stop_loss=row.get("stopLoss"),
                    exit_date=(
                        pd.to_datetime(row.get("exitDate"))
                        if row.get("exitDate")
                        else None
                    ),
                    exit_price=row.get("exitPrice"),
                    outcome=TradeOutcome(row.get("outcome", "pending")),
                    pnl=row.get("pnl", 0),
                    pnl_percent=row.get("pnlPercent", 0),
                    holding_days=row.get("holdingDays", 0),
                    exit_reason=row.get("exitReason", ""),
                )

                self._records[record.signal_id] = record
                count += 1

            except Exception as e:
                logger.warning(f"Failed to import row: {e}")

        logger.info(f"Imported {count} records")
        return count

    def health_check(self) -> bool:
        """Check if performance tracker is operational."""
        return True
