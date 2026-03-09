"""
Signal Backtester Module

Backtest investment signals against historical data
to evaluate signal quality and performance.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .signal_generator import Signal, SignalType

logger = logging.getLogger(__name__)


@dataclass
class BacktestConfig:
    """Configuration for backtesting."""

    # Time period (optional with defaults)
    start_date: datetime = field(
        default_factory=lambda: datetime.now() - timedelta(days=365)
    )
    end_date: datetime = field(default_factory=datetime.now)

    # Position sizing
    initial_capital: float = 100_000.0
    position_size_pct: float = 0.10  # 10% per position
    max_position_size_pct: float = 0.10  # Alias for position_size_pct
    max_positions: int = 10
    max_sector_exposure: float = 0.30  # 30% max per sector

    # Trade execution
    slippage_bps: float = 10.0  # 10 basis points
    slippage_pct: float = 0.001  # 0.1% slippage
    commission_per_trade: float = 1.0

    # Risk management
    use_stop_loss: bool = True
    use_target_price: bool = True
    stop_loss_pct: float = 0.05  # 5% stop loss
    take_profit_pct: float = 0.15  # 15% take profit
    trailing_stop_pct: Optional[float] = None
    max_holding_days: int = 90

    # Signal thresholds
    signal_threshold: float = 0.4
    confidence_threshold: float = 0.6

    # Benchmark
    benchmark: str = "SPY"

    def __post_init__(self):
        """Validate configuration after initialization."""
        if self.max_position_size_pct > 1.0:
            raise ValueError("max_position_size_pct cannot exceed 1.0 (100%)")
        if self.initial_capital < 0:
            raise ValueError("initial_capital cannot be negative")

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "startDate": self.start_date.isoformat(),
            "endDate": self.end_date.isoformat(),
            "initialCapital": self.initial_capital,
            "positionSizePct": self.position_size_pct,
            "maxPositions": self.max_positions,
            "maxSectorExposure": self.max_sector_exposure,
            "slippageBps": self.slippage_bps,
            "commissionPerTrade": self.commission_per_trade,
            "useStopLoss": self.use_stop_loss,
            "useTargetPrice": self.use_target_price,
            "trailingStopPct": self.trailing_stop_pct,
            "maxHoldingDays": self.max_holding_days,
            "benchmark": self.benchmark,
        }


@dataclass
class Trade:
    """Result of a single trade."""

    trade_id: str
    symbol: str
    entry_time: datetime
    exit_time: datetime
    direction: str  # "LONG" or "SHORT"
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float
    pnl_percent: float
    signal_strength: float = 0.0
    signal_confidence: float = 0.0
    signal_id: str = ""
    signal_type: Optional[SignalType] = None
    holding_days: int = 0
    exit_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "tradeId": self.trade_id,
            "symbol": self.symbol,
            "entryTime": self.entry_time.isoformat(),
            "exitTime": self.exit_time.isoformat(),
            "direction": self.direction,
            "entryPrice": round(self.entry_price, 2),
            "exitPrice": round(self.exit_price, 2),
            "quantity": round(self.quantity, 2),
            "pnl": round(self.pnl, 2),
            "pnlPercent": round(self.pnl_percent, 4),
            "signalStrength": round(self.signal_strength, 4),
            "signalConfidence": round(self.signal_confidence, 4),
        }


@dataclass
class TradeResult:
    """Result of a single trade (legacy format)."""

    symbol: str
    signal_id: str
    signal_type: SignalType
    entry_date: datetime
    entry_price: float
    exit_date: datetime
    exit_price: float
    shares: float
    pnl: float
    pnl_percent: float
    holding_days: int
    exit_reason: (
        str  # "target", "stop_loss", "max_holding", "reversal", "end_of_period"
    )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "signalId": self.signal_id,
            "signalType": self.signal_type.value,
            "entryDate": self.entry_date.isoformat(),
            "entryPrice": round(self.entry_price, 2),
            "exitDate": self.exit_date.isoformat(),
            "exitPrice": round(self.exit_price, 2),
            "shares": round(self.shares, 2),
            "pnl": round(self.pnl, 2),
            "pnlPercent": round(self.pnl_percent, 4),
            "holdingDays": self.holding_days,
            "exitReason": self.exit_reason,
        }


@dataclass
class BacktestResult:
    """Complete backtest result with metrics."""

    config: BacktestConfig
    trades: List[Any]  # Can be Trade or TradeResult

    # Performance metrics
    total_return: float
    total_return_percent: float
    annualized_return: float
    benchmark_return: float
    alpha: float
    beta: float

    # Risk metrics
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    max_drawdown_duration_days: int
    volatility: float

    # Trade statistics
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    avg_holding_days: float

    # Signal breakdown
    buy_signal_performance: Dict[str, float]
    sell_signal_performance: Dict[str, float]

    # Commission tracking
    total_commission: float = 0.0

    # Time series
    equity_curve: pd.Series = field(default_factory=pd.Series)
    drawdown_series: pd.Series = field(default_factory=pd.Series)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "config": self.config.to_dict(),
            "trades": [t.to_dict() for t in self.trades],
            "performance": {
                "totalReturn": round(self.total_return, 2),
                "totalReturnPercent": round(self.total_return_percent, 4),
                "annualizedReturn": round(self.annualized_return, 4),
                "benchmarkReturn": round(self.benchmark_return, 4),
                "alpha": round(self.alpha, 4),
                "beta": round(self.beta, 4),
            },
            "risk": {
                "sharpeRatio": round(self.sharpe_ratio, 4),
                "sortinoRatio": round(self.sortino_ratio, 4),
                "maxDrawdown": round(self.max_drawdown, 4),
                "maxDrawdownDurationDays": self.max_drawdown_duration_days,
                "volatility": round(self.volatility, 4),
            },
            "tradeStats": {
                "totalTrades": self.total_trades,
                "winningTrades": self.winning_trades,
                "losingTrades": self.losing_trades,
                "winRate": round(self.win_rate, 4),
                "avgWin": round(self.avg_win, 4),
                "avgLoss": round(self.avg_loss, 4),
                "profitFactor": round(self.profit_factor, 4),
                "avgHoldingDays": round(self.avg_holding_days, 1),
            },
            "signalBreakdown": {
                "buySignals": {
                    k: round(v, 4) for k, v in self.buy_signal_performance.items()
                },
                "sellSignals": {
                    k: round(v, 4) for k, v in self.sell_signal_performance.items()
                },
            },
        }


class SignalBacktester:
    """
    Backtest investment signals against historical data.

    Simulates trade execution with realistic assumptions
    including slippage, commissions, and position sizing.
    """

    def __init__(self, data_manager=None):
        """
        Initialize backtester.

        Args:
            data_manager: DataManager instance for price data
        """
        self.data_manager = data_manager
        logger.info("SignalBacktester initialized")

    async def run_backtest(
        self,
        signals: List[Signal],
        price_data: Optional[Dict[str, pd.DataFrame]] = None,
        config: Optional[BacktestConfig] = None,
    ) -> BacktestResult:
        """
        Run backtest on a list of signals.

        Args:
            signals: List of Signal objects to backtest
            price_data: Dict of symbol to OHLCV DataFrame (optional, will fetch if not provided)
            config: BacktestConfig (optional, uses defaults if not provided)

        Returns:
            BacktestResult with performance metrics
        """
        if not signals:
            return self._empty_result(config or self._default_config())

        if config is None:
            # Infer config from signals
            timestamps = [s.timestamp for s in signals]
            config = BacktestConfig(
                start_date=min(timestamps),
                end_date=max(timestamps) + timedelta(days=90),
            )

        logger.info(
            f"Running backtest on {len(signals)} signals from "
            f"{config.start_date.date()} to {config.end_date.date()}"
        )

        # Get price data if not provided
        if price_data is None:
            price_data = await self._fetch_price_data(signals, config)

        # Sort signals by timestamp
        sorted_signals = sorted(signals, key=lambda s: s.timestamp)

        # Simulate trades
        trades = await self._simulate_trades(sorted_signals, price_data, config)

        # Calculate performance metrics
        result = self.calculate_performance_metrics(trades, config, price_data)

        logger.info(
            f"Backtest complete: {result.total_trades} trades, "
            f"{result.win_rate:.1%} win rate, "
            f"{result.total_return_percent:.2%} total return"
        )

        return result

    async def _fetch_price_data(
        self,
        signals: List[Signal],
        config: BacktestConfig,
    ) -> Dict[str, pd.DataFrame]:
        """Fetch price data for all symbols in signals."""
        symbols = list(set(s.symbol for s in signals))
        symbols.append(config.benchmark)

        price_data = {}

        for symbol in symbols:
            try:
                if self.data_manager:
                    data = await self.data_manager.get_stock_data(
                        symbol,
                        config.start_date - timedelta(days=30),
                        config.end_date + timedelta(days=30),
                    )
                    if not data.empty:
                        price_data[symbol] = data
                else:
                    # Generate mock price data
                    price_data[symbol] = self._generate_mock_prices(
                        symbol, config.start_date, config.end_date
                    )
            except Exception as e:
                logger.warning(f"Failed to fetch price data for {symbol}: {e}")
                price_data[symbol] = self._generate_mock_prices(
                    symbol, config.start_date, config.end_date
                )

        return price_data

    async def _simulate_trades(
        self,
        signals: List[Signal],
        price_data: Dict[str, pd.DataFrame],
        config: BacktestConfig,
    ) -> List[Trade]:
        """Simulate trade execution for signals."""
        trades = []
        open_positions = {}
        cash = config.initial_capital

        for signal in signals:
            symbol = signal.symbol

            if symbol not in price_data or price_data[symbol].empty:
                continue

            prices = price_data[symbol]

            # Check if signal timestamp is within price data range (with tolerance)
            if "date" in prices.columns:
                date_col = pd.to_datetime(prices["date"])
                min_date = date_col.min()
                max_date = date_col.max()
            else:
                min_date = prices.index.min()
                max_date = prices.index.max()

            # Allow signals within a reasonable buffer (30 days) of the data range
            buffer = timedelta(days=30)
            if (
                signal.timestamp < min_date - buffer
                or signal.timestamp > max_date + buffer
            ):
                # Signal is outside price data range (with buffer)
                continue

            # Check if we can take this position
            if signal.signal_type in [SignalType.BUY, SignalType.SELL]:
                if len(open_positions) >= config.max_positions:
                    continue

                # Get entry price
                entry_date = signal.timestamp
                entry_price = self._get_price_at_date(prices, entry_date)

                if entry_price is None:
                    continue

                # Apply slippage
                slippage = entry_price * config.slippage_bps / 10000
                if signal.signal_type == SignalType.BUY:
                    entry_price += slippage
                else:
                    entry_price -= slippage

                # Calculate position size
                position_value = cash * config.position_size_pct
                shares = position_value / entry_price

                # Store open position
                open_positions[signal.signal_id] = {
                    "signal": signal,
                    "symbol": symbol,
                    "entry_date": entry_date,
                    "entry_price": entry_price,
                    "shares": shares,
                    "target_price": signal.target_price,
                    "stop_loss": signal.stop_loss,
                    "max_holding_date": entry_date
                    + timedelta(days=config.max_holding_days),
                }

                # Deduct from cash
                cash -= position_value + config.commission_per_trade

        # Close all open positions at end of period or based on exit conditions
        for signal_id, position in open_positions.items():
            symbol = position["symbol"]
            prices = price_data.get(symbol)

            if prices is None or prices.empty:
                continue

            # Determine exit
            exit_date, exit_price, exit_reason = self._determine_exit(
                position, prices, config
            )

            # Apply slippage
            slippage = exit_price * config.slippage_bps / 10000
            if position["signal"].signal_type == SignalType.BUY:
                exit_price -= slippage  # Selling at lower price
            else:
                exit_price += slippage  # Covering short at higher price

            # Calculate PnL
            if position["signal"].signal_type == SignalType.BUY:
                pnl = (exit_price - position["entry_price"]) * position["shares"]
            else:
                pnl = (position["entry_price"] - exit_price) * position["shares"]

            pnl -= config.commission_per_trade
            pnl_percent = pnl / (position["entry_price"] * position["shares"])

            holding_days = (exit_date - position["entry_date"]).days

            direction = (
                "LONG" if position["signal"].signal_type == SignalType.BUY else "SHORT"
            )
            trades.append(
                Trade(
                    trade_id=signal_id,
                    symbol=symbol,
                    entry_time=position["entry_date"],
                    exit_time=exit_date,
                    direction=direction,
                    entry_price=position["entry_price"],
                    exit_price=exit_price,
                    quantity=position["shares"],
                    pnl=pnl,
                    pnl_percent=pnl_percent,
                    signal_id=signal_id,
                    signal_type=position["signal"].signal_type,
                    signal_strength=position["signal"].conviction,
                    signal_confidence=position["signal"].conviction,
                    holding_days=holding_days,
                    exit_reason=exit_reason,
                )
            )

        return trades

    def _determine_exit(
        self,
        position: Dict[str, Any],
        prices: pd.DataFrame,
        config: BacktestConfig,
    ) -> tuple[datetime, float, str]:
        """Determine when and why to exit a position."""
        entry_date = position["entry_date"]
        max_date = min(position["max_holding_date"], config.end_date)
        signal_type = position["signal"].signal_type

        # Handle date column format vs DatetimeIndex
        if "date" in prices.columns:
            date_col = pd.to_datetime(prices["date"])
            mask = (date_col >= entry_date) & (date_col <= max_date)
            period_prices = prices[mask].copy()
            if not period_prices.empty:
                period_prices = period_prices.set_index(
                    pd.to_datetime(period_prices["date"])
                )
        else:
            mask = (prices.index >= entry_date) & (prices.index <= max_date)
            period_prices = prices[mask]

        if period_prices.empty:
            # No data, use entry price
            return max_date, position["entry_price"], "no_data"

        # Check for stop loss and target hits
        for idx, row in period_prices.iterrows():
            high = row.get("high", row.get("close", 0))
            low = row.get("low", row.get("close", 0))
            # close = row.get("close", 0)  # Reserved for future use

            if signal_type == SignalType.BUY:
                # Check stop loss
                if config.use_stop_loss and position["stop_loss"]:
                    if low <= position["stop_loss"]:
                        return idx, position["stop_loss"], "stop_loss"

                # Check target
                if config.use_target_price and position["target_price"]:
                    if high >= position["target_price"]:
                        return idx, position["target_price"], "target"

            elif signal_type == SignalType.SELL:
                # Check stop loss (for short)
                if config.use_stop_loss and position["stop_loss"]:
                    if high >= position["stop_loss"]:
                        return idx, position["stop_loss"], "stop_loss"

                # Check target (for short)
                if config.use_target_price and position["target_price"]:
                    if low <= position["target_price"]:
                        return idx, position["target_price"], "target"

        # Exit at end of period
        last_price = period_prices["close"].iloc[-1]
        return period_prices.index[-1], last_price, "max_holding"

    def calculate_performance_metrics(
        self,
        trades: List[Trade],
        config: BacktestConfig,
        price_data: Dict[str, pd.DataFrame],
    ) -> BacktestResult:
        """Calculate comprehensive performance metrics from trades."""
        if not trades:
            return self._empty_result(config)

        # Basic trade statistics
        total_trades = len(trades)
        winning_trades = sum(1 for t in trades if t.pnl > 0)
        losing_trades = sum(1 for t in trades if t.pnl < 0)
        win_rate = winning_trades / total_trades if total_trades > 0 else 0

        # PnL statistics
        wins = [t.pnl_percent for t in trades if t.pnl > 0]
        losses = [t.pnl_percent for t in trades if t.pnl < 0]

        avg_win = np.mean(wins) if wins else 0
        avg_loss = np.mean(losses) if losses else 0

        total_wins = sum(t.pnl for t in trades if t.pnl > 0)
        total_losses = abs(sum(t.pnl for t in trades if t.pnl < 0))
        profit_factor = total_wins / total_losses if total_losses > 0 else float("inf")

        avg_holding_days = np.mean([t.holding_days for t in trades])

        # Total return
        total_pnl = sum(t.pnl for t in trades)
        total_return_percent = total_pnl / config.initial_capital

        # Calculate equity curve
        equity_curve = self._calculate_equity_curve(trades, config)

        # Annualized return
        days = (config.end_date - config.start_date).days
        years = days / 365.25
        annualized_return = (
            (1 + total_return_percent) ** (1 / years) - 1 if years > 0 else 0
        )

        # Benchmark return
        benchmark_return = self._calculate_benchmark_return(config, price_data)

        # Alpha and beta
        alpha = annualized_return - benchmark_return
        beta = 1.0  # Simplified, would need proper regression

        # Risk metrics
        if not equity_curve.empty:
            returns = equity_curve.pct_change().dropna()
            volatility = returns.std() * np.sqrt(252) if len(returns) > 0 else 0
            sharpe_ratio = annualized_return / volatility if volatility > 0 else 0

            downside_returns = returns[returns < 0]
            downside_vol = (
                downside_returns.std() * np.sqrt(252)
                if len(downside_returns) > 0
                else 0
            )
            sortino_ratio = annualized_return / downside_vol if downside_vol > 0 else 0

            drawdown_series = self._calculate_drawdown(equity_curve)
            max_drawdown = drawdown_series.min() if not drawdown_series.empty else 0
            max_drawdown_duration = self._calculate_max_drawdown_duration(
                drawdown_series
            )
        else:
            volatility = 0
            sharpe_ratio = 0
            sortino_ratio = 0
            max_drawdown = 0
            max_drawdown_duration = 0
            drawdown_series = pd.Series()

        # Signal breakdown
        buy_trades = [t for t in trades if t.signal_type == SignalType.BUY]
        sell_trades = [t for t in trades if t.signal_type == SignalType.SELL]

        buy_signal_performance = {
            "count": len(buy_trades),
            "win_rate": (
                sum(1 for t in buy_trades if t.pnl > 0) / len(buy_trades)
                if buy_trades
                else 0
            ),
            "avg_return": (
                np.mean([t.pnl_percent for t in buy_trades]) if buy_trades else 0
            ),
        }

        sell_signal_performance = {
            "count": len(sell_trades),
            "win_rate": (
                sum(1 for t in sell_trades if t.pnl > 0) / len(sell_trades)
                if sell_trades
                else 0
            ),
            "avg_return": (
                np.mean([t.pnl_percent for t in sell_trades]) if sell_trades else 0
            ),
        }

        # Calculate total commission (entry + exit for each trade)
        total_commission = total_trades * 2 * config.commission_per_trade

        return BacktestResult(
            config=config,
            trades=trades,
            total_return=total_pnl,
            total_return_percent=total_return_percent,
            annualized_return=annualized_return,
            benchmark_return=benchmark_return,
            alpha=alpha,
            beta=beta,
            sharpe_ratio=sharpe_ratio,
            sortino_ratio=sortino_ratio,
            max_drawdown=max_drawdown,
            max_drawdown_duration_days=max_drawdown_duration,
            volatility=volatility,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            profit_factor=profit_factor,
            avg_holding_days=avg_holding_days,
            buy_signal_performance=buy_signal_performance,
            sell_signal_performance=sell_signal_performance,
            total_commission=total_commission,
            equity_curve=equity_curve,
            drawdown_series=drawdown_series,
        )

    def generate_attribution_report(
        self,
        result: BacktestResult,
    ) -> Dict[str, Any]:
        """
        Generate performance attribution report.

        Args:
            result: BacktestResult from run_backtest

        Returns:
            Dict with attribution breakdown
        """
        trades = result.trades

        if not trades:
            return {
                "summary": "No trades to analyze",
                "by_exit_reason": {},
                "by_holding_period": {},
                "by_symbol": {},
                "monthly_performance": {},
            }

        # Attribution by exit reason
        exit_reasons = {}
        for trade in trades:
            reason = trade.exit_reason
            if reason not in exit_reasons:
                exit_reasons[reason] = {"count": 0, "total_pnl": 0, "win_rate": 0}
            exit_reasons[reason]["count"] += 1
            exit_reasons[reason]["total_pnl"] += trade.pnl

        for reason in exit_reasons:
            reason_trades = [t for t in trades if t.exit_reason == reason]
            wins = sum(1 for t in reason_trades if t.pnl > 0)
            exit_reasons[reason]["win_rate"] = (
                wins / len(reason_trades) if reason_trades else 0
            )

        # Attribution by holding period bucket
        holding_buckets = {
            "< 7 days": {"count": 0, "total_pnl": 0, "avg_return": 0},
            "7-30 days": {"count": 0, "total_pnl": 0, "avg_return": 0},
            "30-60 days": {"count": 0, "total_pnl": 0, "avg_return": 0},
            "> 60 days": {"count": 0, "total_pnl": 0, "avg_return": 0},
        }

        for trade in trades:
            if trade.holding_days < 7:
                bucket = "< 7 days"
            elif trade.holding_days < 30:
                bucket = "7-30 days"
            elif trade.holding_days < 60:
                bucket = "30-60 days"
            else:
                bucket = "> 60 days"

            holding_buckets[bucket]["count"] += 1
            holding_buckets[bucket]["total_pnl"] += trade.pnl

        for bucket in holding_buckets:
            if holding_buckets[bucket]["count"] > 0:
                bucket_trades = [
                    t for t in trades if self._get_bucket(t.holding_days) == bucket
                ]
                holding_buckets[bucket]["avg_return"] = np.mean(
                    [t.pnl_percent for t in bucket_trades]
                )

        # Attribution by symbol
        symbol_perf = {}
        for trade in trades:
            if trade.symbol not in symbol_perf:
                symbol_perf[trade.symbol] = {"count": 0, "total_pnl": 0, "win_rate": 0}
            symbol_perf[trade.symbol]["count"] += 1
            symbol_perf[trade.symbol]["total_pnl"] += trade.pnl

        for symbol in symbol_perf:
            symbol_trades = [t for t in trades if t.symbol == symbol]
            wins = sum(1 for t in symbol_trades if t.pnl > 0)
            symbol_perf[symbol]["win_rate"] = (
                wins / len(symbol_trades) if symbol_trades else 0
            )

        # Sort by total PnL
        symbol_perf = dict(
            sorted(symbol_perf.items(), key=lambda x: x[1]["total_pnl"], reverse=True)
        )

        # Monthly performance
        monthly = {}
        for trade in trades:
            exit_dt = getattr(trade, "exit_time", None) or getattr(
                trade, "exit_date", None
            )
            if exit_dt is None:
                continue
            month_key = exit_dt.strftime("%Y-%m")
            if month_key not in monthly:
                monthly[month_key] = {"count": 0, "total_pnl": 0, "win_rate": 0}
            monthly[month_key]["count"] += 1
            monthly[month_key]["total_pnl"] += trade.pnl

        for month in monthly:
            month_trades = [
                t
                for t in trades
                if (
                    getattr(t, "exit_time", None) or getattr(t, "exit_date", None)
                ).strftime("%Y-%m")
                == month
            ]
            wins = sum(1 for t in month_trades if t.pnl > 0)
            monthly[month]["win_rate"] = wins / len(month_trades) if month_trades else 0

        return {
            "summary": {
                "total_trades": len(trades),
                "total_pnl": sum(t.pnl for t in trades),
                "best_trade": max(t.pnl for t in trades),
                "worst_trade": min(t.pnl for t in trades),
            },
            "by_exit_reason": exit_reasons,
            "by_holding_period": holding_buckets,
            "by_symbol": symbol_perf,
            "monthly_performance": monthly,
        }

    def _get_bucket(self, holding_days: int) -> str:
        """Get holding period bucket for a trade."""
        if holding_days < 7:
            return "< 7 days"
        elif holding_days < 30:
            return "7-30 days"
        elif holding_days < 60:
            return "30-60 days"
        else:
            return "> 60 days"

    def _get_price_at_date(
        self,
        prices: pd.DataFrame,
        date: datetime,
    ) -> Optional[float]:
        """Get price at or near a specific date."""
        if prices.empty:
            return None

        # Check if 'date' column exists (fixture format)
        if "date" in prices.columns:
            # Use date column for lookups
            date_col = pd.to_datetime(prices["date"])

            # Exact match
            exact_match = prices[date_col == date]
            if not exact_match.empty:
                return exact_match.iloc[0]["close"]

            # Find next available date
            future_mask = date_col >= date
            if future_mask.any():
                return prices[future_mask].iloc[0]["close"]

            # Find previous date
            past_mask = date_col < date
            if past_mask.any():
                return prices[past_mask].iloc[-1]["close"]

            return None

        # Fall back to index-based lookups (DatetimeIndex)
        if date in prices.index:
            return prices.loc[date, "close"]

        # Find next available date
        future_dates = prices.index[prices.index >= date]
        if len(future_dates) > 0:
            return prices.loc[future_dates[0], "close"]

        # Find previous date
        past_dates = prices.index[prices.index < date]
        if len(past_dates) > 0:
            return prices.loc[past_dates[-1], "close"]

        return None

    def _calculate_equity_curve(
        self,
        trades: List[Trade],
        config: BacktestConfig,
    ) -> pd.Series:
        """Calculate equity curve from trades."""
        # Create daily equity curve (always return initial capital even with no trades)
        dates = pd.date_range(config.start_date, config.end_date, freq="D")
        equity = pd.Series(index=dates, data=float(config.initial_capital), dtype=float)

        if not trades:
            return equity

        # Apply trade results
        cumulative_pnl = 0
        for trade in sorted(trades, key=lambda t: t.exit_time):
            cumulative_pnl += trade.pnl
            # Update equity from exit date forward
            equity[trade.exit_time :] = config.initial_capital + cumulative_pnl

        return equity

    def _calculate_drawdown(self, equity_curve: pd.Series) -> pd.Series:
        """Calculate drawdown series from equity curve."""
        if equity_curve.empty:
            return pd.Series()

        rolling_max = equity_curve.expanding().max()
        drawdown = (equity_curve - rolling_max) / rolling_max
        return drawdown

    def _calculate_max_drawdown_duration(self, drawdown_series: pd.Series) -> int:
        """Calculate maximum drawdown duration in days."""
        if drawdown_series.empty:
            return 0

        in_drawdown = drawdown_series < 0
        if not in_drawdown.any():
            return 0

        # Find consecutive drawdown periods
        drawdown_starts = in_drawdown.ne(in_drawdown.shift()).cumsum()
        drawdown_groups = in_drawdown.groupby(drawdown_starts)

        max_duration = 0
        for group_id, group in drawdown_groups:
            if group.any():
                duration = len(group)
                max_duration = max(max_duration, duration)

        return max_duration

    def _calculate_benchmark_return(
        self,
        config: BacktestConfig,
        price_data: Dict[str, pd.DataFrame],
    ) -> float:
        """Calculate benchmark return over the backtest period."""
        benchmark = config.benchmark

        if benchmark not in price_data or price_data[benchmark].empty:
            return 0.10  # Default 10% annual

        prices = price_data[benchmark]

        start_price = self._get_price_at_date(prices, config.start_date)
        end_price = self._get_price_at_date(prices, config.end_date)

        if start_price and end_price and start_price > 0:
            total_return = (end_price / start_price) - 1
            days = (config.end_date - config.start_date).days
            years = days / 365.25
            annualized = (1 + total_return) ** (1 / years) - 1 if years > 0 else 0
            return annualized

        return 0.10

    def _generate_mock_prices(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
    ) -> pd.DataFrame:
        """Generate mock price data for testing."""
        dates = pd.date_range(start_date, end_date, freq="D")
        n = len(dates)

        # Random walk with drift
        returns = np.random.normal(0.0005, 0.02, n)
        prices = 100 * np.cumprod(1 + returns)

        df = pd.DataFrame(
            {
                "open": prices * (1 + np.random.uniform(-0.01, 0.01, n)),
                "high": prices * (1 + np.random.uniform(0, 0.02, n)),
                "low": prices * (1 - np.random.uniform(0, 0.02, n)),
                "close": prices,
                "volume": np.random.randint(1000000, 10000000, n),
            },
            index=dates,
        )

        return df

    def _default_config(self) -> BacktestConfig:
        """Return default backtest configuration."""
        return BacktestConfig(
            start_date=datetime.now() - timedelta(days=365),
            end_date=datetime.now(),
        )

    def _empty_result(self, config: BacktestConfig) -> BacktestResult:
        """Return empty backtest result."""
        # Generate equity curve with initial capital even for empty results
        dates = pd.date_range(config.start_date, config.end_date, freq="D")
        equity_curve = pd.Series(
            index=dates, data=float(config.initial_capital), dtype=float
        )
        drawdown_series = pd.Series(index=dates, data=0.0, dtype=float)

        return BacktestResult(
            config=config,
            trades=[],
            total_return=0,
            total_return_percent=0,
            annualized_return=0,
            benchmark_return=0,
            alpha=0,
            beta=1,
            sharpe_ratio=0,
            sortino_ratio=0,
            max_drawdown=0,
            max_drawdown_duration_days=0,
            volatility=0,
            total_trades=0,
            winning_trades=0,
            losing_trades=0,
            win_rate=0,
            avg_win=0,
            avg_loss=0,
            profit_factor=0,
            avg_holding_days=0,
            buy_signal_performance={},
            sell_signal_performance={},
            equity_curve=equity_curve,
            drawdown_series=drawdown_series,
        )

    def health_check(self) -> bool:
        """Check if backtester is operational."""
        return True


@dataclass
class PerformanceMetrics:
    """Performance metrics for backtesting."""

    total_return: float = 0.0
    sharpe_ratio: float = 0.0
    max_drawdown: float = 0.0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    sortino_ratio: float = 0.0
    calmar_ratio: float = 0.0
    avg_trade_duration: timedelta = field(default_factory=lambda: timedelta(days=0))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "totalReturn": round(self.total_return, 4),
            "sharpeRatio": round(self.sharpe_ratio, 4),
            "maxDrawdown": round(self.max_drawdown, 4),
            "winRate": round(self.win_rate, 4),
            "profitFactor": round(self.profit_factor, 4),
            "sortinoRatio": round(self.sortino_ratio, 4),
            "calmarRatio": round(self.calmar_ratio, 4),
            "avgTradeDurationDays": self.avg_trade_duration.days,
        }


@dataclass
class AttributionAnalysis:
    """Attribution analysis breakdown."""

    breakdown: Dict[str, float] = field(default_factory=dict)
    total_pnl: float = 0.0
    by_symbol: Dict[str, float] = field(default_factory=dict)
    by_direction: Dict[str, float] = field(default_factory=dict)
    by_signal_strength: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "breakdown": {k: round(v, 2) for k, v in self.breakdown.items()},
            "totalPnl": round(self.total_pnl, 2),
            "bySymbol": {k: round(v, 2) for k, v in self.by_symbol.items()},
            "byDirection": {k: round(v, 2) for k, v in self.by_direction.items()},
            "bySignalStrength": {
                k: round(v, 2) for k, v in self.by_signal_strength.items()
            },
        }


class Backtester:
    """
    Backtester class for testing signal strategies.

    Wraps SignalBacktester with a simpler synchronous interface
    for testing and evaluation purposes.
    """

    def __init__(
        self,
        config: Optional[BacktestConfig] = None,
        data_manager=None,
        signal_generator=None,
    ):
        """
        Initialize backtester.

        Args:
            config: BacktestConfig for backtest settings
            data_manager: DataManager instance for price data
            signal_generator: SignalGenerator for generating signals
        """
        self.config = config or self._default_config()
        self.data_manager = data_manager
        self.signal_generator = signal_generator
        self._backtester = SignalBacktester(data_manager=data_manager)

    def _default_config(self) -> BacktestConfig:
        """Return default backtest configuration."""
        return BacktestConfig(
            start_date=datetime.now() - timedelta(days=365),
            end_date=datetime.now(),
        )

    def run_backtest(
        self,
        symbols: List[str],
        start_date: datetime,
        end_date: datetime,
        signals: Optional[List[Any]] = None,
    ) -> BacktestResult:
        """
        Run backtest synchronously.

        Args:
            symbols: List of symbols to backtest
            start_date: Start date
            end_date: End date
            signals: Optional list of signals

        Returns:
            BacktestResult with performance metrics
        """
        import asyncio
        from .signal_generator import Signal, SignalType, SignalStrength

        config = BacktestConfig(
            start_date=start_date,
            end_date=end_date,
            initial_capital=self.config.initial_capital,
            position_size_pct=self.config.position_size_pct,
        )

        if signals is None:
            signals = []

        # Convert signal dicts to Signal objects if needed
        processed_signals = []
        for sig in signals:
            if isinstance(sig, dict):
                direction = sig.get("direction", "BULLISH")
                if direction == "BULLISH":
                    signal_type = SignalType.BUY
                elif direction == "BEARISH":
                    signal_type = SignalType.SELL
                else:
                    signal_type = SignalType.HOLD
                processed_signals.append(
                    Signal(
                        signal_id=f"sig_{len(processed_signals)}",
                        symbol=sig.get("symbol", ""),
                        timestamp=sig.get("timestamp", datetime.now()),
                        signal_type=signal_type,
                        strength=SignalStrength.MODERATE,
                        conviction=sig.get("confidence", 0.5),
                        factors=sig.get("factors", {}),
                        price_at_signal=sig.get("entry_price"),
                        target_price=sig.get("target_price"),
                        stop_loss=sig.get("stop_loss"),
                    )
                )
            else:
                processed_signals.append(sig)

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                self._backtester.run_backtest(signals=processed_signals, config=config)
            )
        finally:
            loop.close()

    def run_backtest_with_data(
        self,
        price_data: Dict[str, pd.DataFrame],
        signals: List[Any],
    ) -> BacktestResult:
        """
        Run backtest with provided price data.

        Args:
            price_data: Dict of symbol to price DataFrame
            signals: List of signals

        Returns:
            BacktestResult with performance metrics
        """
        import asyncio

        # Convert signal dicts to Signal objects if needed
        from .signal_generator import Signal, SignalType, SignalStrength

        processed_signals = []
        for sig in signals:
            if isinstance(sig, dict):
                direction = sig.get("direction", "BULLISH")
                if direction == "BULLISH":
                    signal_type = SignalType.BUY
                elif direction == "BEARISH":
                    signal_type = SignalType.SELL
                else:
                    signal_type = SignalType.HOLD
                processed_signals.append(
                    Signal(
                        signal_id=f"sig_{len(processed_signals)}",
                        symbol=sig.get("symbol", ""),
                        timestamp=sig.get("timestamp", datetime.now()),
                        signal_type=signal_type,
                        strength=SignalStrength.MODERATE,
                        conviction=sig.get("confidence", 0.5),
                        factors=sig.get("factors", {}),
                        price_at_signal=sig.get("entry_price"),
                        target_price=sig.get("target_price"),
                        stop_loss=sig.get("stop_loss"),
                    )
                )
            else:
                processed_signals.append(sig)

        config = self.config

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                self._backtester.run_backtest(
                    signals=processed_signals,
                    price_data=price_data,
                    config=config,
                )
            )
        finally:
            loop.close()

    def analyze_attribution(
        self, trades: List[Trade], by: str = "symbol"
    ) -> AttributionAnalysis:
        """
        Analyze trade attribution by various dimensions.

        Args:
            trades: List of Trade objects
            by: Dimension to analyze by ("symbol", "direction", "signal_strength")

        Returns:
            AttributionAnalysis with breakdown
        """
        breakdown = {}

        if by == "symbol":
            for trade in trades:
                if trade.symbol not in breakdown:
                    breakdown[trade.symbol] = 0.0
                breakdown[trade.symbol] += trade.pnl
        elif by == "direction":
            for trade in trades:
                direction = trade.direction
                if direction not in breakdown:
                    breakdown[direction] = 0.0
                breakdown[direction] += trade.pnl
        elif by == "signal_strength":
            # Bucket by signal strength
            for trade in trades:
                strength = trade.signal_strength
                if strength >= 0.75:
                    bucket = "strong"
                elif strength >= 0.5:
                    bucket = "moderate"
                else:
                    bucket = "weak"
                if bucket not in breakdown:
                    breakdown[bucket] = 0.0
                breakdown[bucket] += trade.pnl

        return AttributionAnalysis(
            breakdown=breakdown,
            total_pnl=sum(t.pnl for t in trades),
        )

    def _calculate_total_return(self, equity_curve: pd.Series) -> float:
        """Calculate total return from equity curve."""
        if equity_curve.empty or len(equity_curve) < 2:
            return 0.0
        return (equity_curve.iloc[-1] - equity_curve.iloc[0]) / equity_curve.iloc[0]

    def _calculate_sharpe_ratio(
        self, returns: pd.Series, risk_free_rate: float = 0.02
    ) -> float:
        """Calculate Sharpe ratio."""
        if returns.empty or returns.std() == 0:
            return 0.0
        excess_returns = returns.mean() * 252 - risk_free_rate
        return excess_returns / (returns.std() * np.sqrt(252))

    def _calculate_max_drawdown(self, equity_curve: pd.Series) -> float:
        """Calculate maximum drawdown."""
        if equity_curve.empty:
            return 0.0
        rolling_max = equity_curve.expanding().max()
        drawdown = (equity_curve - rolling_max) / rolling_max
        return abs(drawdown.min())

    def _calculate_win_rate(self, trades: List[Trade]) -> float:
        """Calculate win rate from trades."""
        if not trades:
            return 0.0
        wins = sum(1 for t in trades if t.pnl > 0)
        return wins / len(trades)

    def _calculate_profit_factor(self, trades: List[Trade]) -> float:
        """Calculate profit factor."""
        gross_profit = sum(t.pnl for t in trades if t.pnl > 0)
        gross_loss = abs(sum(t.pnl for t in trades if t.pnl < 0))
        if gross_loss == 0:
            return 0.0 if gross_profit == 0 else float("inf")
        return gross_profit / gross_loss

    def _calculate_sortino_ratio(
        self, returns: pd.Series, risk_free_rate: float = 0.02
    ) -> float:
        """Calculate Sortino ratio."""
        if returns.empty:
            return 0.0
        downside_returns = returns[returns < 0]
        if downside_returns.empty or downside_returns.std() == 0:
            return 0.0
        excess_returns = returns.mean() * 252 - risk_free_rate
        return excess_returns / (downside_returns.std() * np.sqrt(252))

    def _calculate_calmar_ratio(
        self, annual_return: float, max_drawdown: float
    ) -> float:
        """Calculate Calmar ratio."""
        if max_drawdown == 0:
            return 0.0
        return annual_return / max_drawdown

    def _calculate_average_trade_duration(self, trades: List[Trade]) -> timedelta:
        """Calculate average trade duration."""
        if not trades:
            return timedelta(days=0)
        total_days = sum(
            (t.exit_time - t.entry_time).days for t in trades if t.exit_time
        )
        return timedelta(days=total_days / len(trades))

    def health_check(self) -> bool:
        """Check if backtester is operational."""
        return True
