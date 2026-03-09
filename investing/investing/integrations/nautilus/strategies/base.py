"""
Base Strategy Classes for Investing-NautilusTrader Integration

Provides common functionality for all Investing trading strategies:
- Position sizing with risk management
- Stop loss and take profit handling
- Signal tracking from Investing actors
- Logging and metrics collection
"""

from __future__ import annotations

import logging
from abc import abstractmethod
from typing import Any, Dict, Optional

try:
    from nautilus_trader.config import StrategyConfig
    from nautilus_trader.model.currencies import USD
    from nautilus_trader.model.data import Bar
    from nautilus_trader.model.enums import OrderSide, TimeInForce
    from nautilus_trader.model.identifiers import InstrumentId
    from nautilus_trader.model.objects import Quantity
    from nautilus_trader.trading.strategy import Strategy

    NAUTILUS_AVAILABLE = True
except ImportError:
    NAUTILUS_AVAILABLE = False
    StrategyConfig = object
    Strategy = object

logger = logging.getLogger(__name__)


class InvestingStrategyConfig(StrategyConfig if NAUTILUS_AVAILABLE else object):
    """
    Base configuration for all Investing strategies.

    Attributes:
        instrument_ids: Tuple of instrument IDs to trade
        max_position_size_pct: Maximum position size as percentage of equity
        stop_loss_pct: Stop loss percentage
        take_profit_pct: Take profit percentage
        confidence_threshold: Minimum confidence for entry signals
    """

    instrument_ids: tuple[str, ...] = ()
    max_position_size_pct: float = 0.10
    stop_loss_pct: float = 0.05
    take_profit_pct: float = 0.15
    confidence_threshold: float = 0.6


class InvestingStrategy(Strategy if NAUTILUS_AVAILABLE else object):
    """
    Base class for Investing trading strategies.

    Provides common functionality:
    - Position sizing based on account equity
    - Entry price tracking for P&L calculation
    - Stop loss and take profit management
    - Signal caching from Investing actors
    """

    def __init__(self, config: InvestingStrategyConfig):
        if NAUTILUS_AVAILABLE:
            super().__init__(config)

        self.config = config

        # Track entry prices for P&L calculation
        self._entry_prices: Dict[str, float] = {}

        # Track positions by symbol
        self._positions: Dict[str, str] = {}

        # Signal caches (subclasses populate these)
        self._signals: Dict[str, Dict[str, Any]] = {}

        # Performance metrics
        self._trades_count = 0
        self._winning_trades = 0
        self._losing_trades = 0

    def on_start(self) -> None:
        """Called when strategy starts. Override in subclasses."""
        logger.info(f"{self.__class__.__name__} starting...")

    def on_stop(self) -> None:
        """Called when strategy stops. Close all open positions."""
        logger.info(f"{self.__class__.__name__} stopping...")

        if NAUTILUS_AVAILABLE:
            for position in self.cache.positions_open():
                self.close_position(position)

        self._log_performance()

    def _log_performance(self) -> None:
        """Log strategy performance metrics."""
        total_trades = self._winning_trades + self._losing_trades
        win_rate = self._winning_trades / total_trades * 100 if total_trades > 0 else 0

        logger.info(
            f"Strategy Performance: "
            f"Total={total_trades}, Wins={self._winning_trades}, "
            f"Losses={self._losing_trades}, WinRate={win_rate:.1f}%"
        )

    def _calculate_position_size(
        self,
        instrument_id: InstrumentId,
        current_price: float,
    ) -> int:
        """
        Calculate position size based on account equity and risk parameters.

        Args:
            instrument_id: The instrument to size
            current_price: Current price of the instrument

        Returns:
            Number of shares/contracts to trade
        """
        if not NAUTILUS_AVAILABLE:
            return 0

        account = self.cache.account_for_venue(instrument_id.venue)
        if account is None:
            logger.warning(f"No account found for venue {instrument_id.venue}")
            return 0

        equity = float(account.balance_total(USD))
        max_position_value = equity * self.config.max_position_size_pct
        quantity = int(max_position_value / current_price)

        return max(0, quantity)

    def _enter_long(
        self,
        symbol: str,
        bar: Bar,
        reason: str = "",
    ) -> None:
        """
        Enter a long position.

        Args:
            symbol: Symbol to trade
            bar: Current bar data
            reason: Reason for entry (for logging)
        """
        if not NAUTILUS_AVAILABLE:
            return

        instrument_id = bar.bar_type.instrument_id
        current_price = float(bar.close)

        quantity = self._calculate_position_size(instrument_id, current_price)
        if quantity < 1:
            return

        order = self.order_factory.market(
            instrument_id=instrument_id,
            order_side=OrderSide.BUY,
            quantity=Quantity.from_int(quantity),
            time_in_force=TimeInForce.GTC,
        )

        self.submit_order(order)
        self._entry_prices[symbol] = current_price
        self._positions[symbol] = str(order.client_order_id)

        logger.info(
            f"LONG ENTRY: {symbol} @ {current_price:.2f}, " f"qty={quantity} {reason}"
        )

    def _enter_short(
        self,
        symbol: str,
        bar: Bar,
        reason: str = "",
    ) -> None:
        """
        Enter a short position.

        Args:
            symbol: Symbol to trade
            bar: Current bar data
            reason: Reason for entry (for logging)
        """
        if not NAUTILUS_AVAILABLE:
            return

        instrument_id = bar.bar_type.instrument_id
        current_price = float(bar.close)

        quantity = self._calculate_position_size(instrument_id, current_price)
        if quantity < 1:
            return

        order = self.order_factory.market(
            instrument_id=instrument_id,
            order_side=OrderSide.SELL,
            quantity=Quantity.from_int(quantity),
            time_in_force=TimeInForce.GTC,
        )

        self.submit_order(order)
        self._entry_prices[symbol] = current_price
        self._positions[symbol] = str(order.client_order_id)

        logger.info(
            f"SHORT ENTRY: {symbol} @ {current_price:.2f}, " f"qty={quantity} {reason}"
        )

    def _check_exit_conditions(
        self,
        symbol: str,
        bar: Bar,
    ) -> Optional[str]:
        """
        Check if exit conditions are met for a position.

        Args:
            symbol: Symbol to check
            bar: Current bar data

        Returns:
            Exit reason if conditions met, None otherwise
        """
        if not NAUTILUS_AVAILABLE:
            return None

        if symbol not in self._entry_prices:
            return None

        entry_price = self._entry_prices[symbol]
        current_price = float(bar.close)

        instrument_id = bar.bar_type.instrument_id
        positions = self.cache.positions_open(instrument_id=instrument_id)

        if not positions:
            # Position was closed externally, clean up
            self._entry_prices.pop(symbol, None)
            self._positions.pop(symbol, None)
            return None

        position = positions[0]

        if position.is_long:
            pnl_pct = (current_price - entry_price) / entry_price

            if pnl_pct <= -self.config.stop_loss_pct:
                return f"STOP_LOSS ({pnl_pct:.2%})"
            elif pnl_pct >= self.config.take_profit_pct:
                return f"TAKE_PROFIT ({pnl_pct:.2%})"

        elif position.is_short:
            pnl_pct = (entry_price - current_price) / entry_price

            if pnl_pct <= -self.config.stop_loss_pct:
                return f"STOP_LOSS ({pnl_pct:.2%})"
            elif pnl_pct >= self.config.take_profit_pct:
                return f"TAKE_PROFIT ({pnl_pct:.2%})"

        return None

    def _exit_position(
        self,
        symbol: str,
        bar: Bar,
        reason: str = "",
    ) -> None:
        """
        Exit a position.

        Args:
            symbol: Symbol to exit
            bar: Current bar data
            reason: Reason for exit
        """
        if not NAUTILUS_AVAILABLE:
            return

        instrument_id = bar.bar_type.instrument_id
        positions = self.cache.positions_open(instrument_id=instrument_id)

        if not positions:
            return

        position = positions[0]
        entry_price = self._entry_prices.get(symbol, float(bar.close))
        current_price = float(bar.close)

        # Track win/loss
        if position.is_long:
            is_winner = current_price > entry_price
        else:
            is_winner = current_price < entry_price

        if is_winner:
            self._winning_trades += 1
        else:
            self._losing_trades += 1

        self.close_position(position)

        # Clean up tracking
        self._entry_prices.pop(symbol, None)
        self._positions.pop(symbol, None)

        logger.info(
            f"EXIT: {symbol} @ {current_price:.2f} "
            f"(entry={entry_price:.2f}) - {reason}"
        )

    @abstractmethod
    def _evaluate_entry(
        self,
        symbol: str,
        bar: Bar,
    ) -> None:
        """Evaluate entry conditions. Must be implemented by subclasses."""
        pass

    def on_bar(self, bar: Bar) -> None:
        """
        Process incoming bar data.

        Args:
            bar: The received bar data
        """
        symbol = str(bar.bar_type.instrument_id.symbol)

        # Check exit conditions for existing positions
        exit_reason = self._check_exit_conditions(symbol, bar)
        if exit_reason:
            self._exit_position(symbol, bar, exit_reason)
            return

        # Evaluate entry for new positions
        if symbol not in self._positions:
            self._evaluate_entry(symbol, bar)
