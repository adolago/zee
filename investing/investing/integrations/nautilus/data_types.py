"""
Data Type Converters for OpenBB to NautilusTrader

Provides conversion utilities between OpenBB DataFrame formats
and NautilusTrader data objects (Bar, QuoteTick, TradeTick, etc.).
"""

import logging
from datetime import datetime
from decimal import Decimal
from typing import Optional

import pandas as pd

from nautilus_trader.core.datetime import dt_to_unix_nanos
from nautilus_trader.model.data import Bar, BarType, QuoteTick, TradeTick
from nautilus_trader.model.enums import (
    AggregationSource,
    AggressorSide,
    BarAggregation,
    PriceType,
)
from nautilus_trader.model.identifiers import InstrumentId, TradeId, Venue
from nautilus_trader.model.instruments import Equity
from nautilus_trader.model.objects import Price, Quantity

from investing.integrations.nautilus.config import InstrumentConfig

logger = logging.getLogger(__name__)


def create_instrument_id(symbol: str, venue: str = "OPENBB") -> InstrumentId:
    """
    Create a NautilusTrader InstrumentId from symbol and venue.

    Args:
        symbol: Instrument symbol (e.g., "AAPL").
        venue: Venue identifier (e.g., "OPENBB", "NASDAQ").

    Returns:
        InstrumentId for the given symbol and venue.
    """
    return InstrumentId.from_str(f"{symbol}.{venue}")


def create_bar_type(
    instrument_id: InstrumentId,
    bar_aggregation: BarAggregation = BarAggregation.MINUTE,
    step: int = 1,
    price_type: PriceType = PriceType.LAST,
    aggregation_source: AggregationSource = AggregationSource.EXTERNAL,
) -> BarType:
    """
    Create a NautilusTrader BarType specification.

    Args:
        instrument_id: The instrument identifier.
        bar_aggregation: Type of bar aggregation (MINUTE, HOUR, DAY, etc.).
        step: Aggregation step size.
        price_type: Price type for the bars.
        aggregation_source: Source of aggregation (INTERNAL or EXTERNAL).

    Returns:
        BarType specification.
    """
    return BarType(
        instrument_id=instrument_id,
        bar_spec=BarType.standard(
            step,
            bar_aggregation,
            price_type,
        ).bar_spec,
        aggregation_source=aggregation_source,
    )


def parse_aggregation_string(interval: str) -> tuple[int, BarAggregation]:
    """
    Parse an interval string into step and bar aggregation type.

    Args:
        interval: Interval string like "1m", "5m", "1h", "1d".

    Returns:
        Tuple of (step, BarAggregation).
    """
    interval = interval.lower().strip()

    # Extract numeric part and unit
    step = int("".join(filter(str.isdigit, interval)) or "1")
    unit = "".join(filter(str.isalpha, interval)) or "m"

    aggregation_map = {
        "m": BarAggregation.MINUTE,
        "min": BarAggregation.MINUTE,
        "minute": BarAggregation.MINUTE,
        "h": BarAggregation.HOUR,
        "hr": BarAggregation.HOUR,
        "hour": BarAggregation.HOUR,
        "d": BarAggregation.DAY,
        "day": BarAggregation.DAY,
        "w": BarAggregation.WEEK,
        "wk": BarAggregation.WEEK,
        "week": BarAggregation.WEEK,
        "mo": BarAggregation.MONTH,
        "month": BarAggregation.MONTH,
    }

    bar_agg = aggregation_map.get(unit, BarAggregation.MINUTE)
    return step, bar_agg


class OpenBBBarConverter:
    """
    Converts OpenBB OHLCV DataFrames to NautilusTrader Bar objects.
    """

    def __init__(
        self,
        instrument_id: InstrumentId,
        bar_type: BarType,
        price_precision: int = 2,
        size_precision: int = 0,
    ):
        """
        Initialize the bar converter.

        Args:
            instrument_id: The instrument identifier.
            bar_type: The bar type specification.
            price_precision: Decimal precision for prices.
            size_precision: Decimal precision for sizes/volumes.
        """
        self.instrument_id = instrument_id
        self.bar_type = bar_type
        self.price_precision = price_precision
        self.size_precision = size_precision

    def convert_dataframe(self, df: pd.DataFrame) -> list[Bar]:
        """
        Convert an OpenBB OHLCV DataFrame to a list of Nautilus Bars.

        Expected DataFrame columns:
        - date/datetime/timestamp: Bar timestamp
        - open: Open price
        - high: High price
        - low: Low price
        - close: Close price
        - volume: Volume

        Args:
            df: OpenBB OHLCV DataFrame.

        Returns:
            List of NautilusTrader Bar objects.
        """
        bars = []

        # Identify timestamp column
        ts_col = self._find_timestamp_column(df)
        if ts_col is None and not self._index_is_timestamp(df):
            logger.warning("No timestamp column found in DataFrame")
            return bars

        for idx, row in df.iterrows():
            try:
                bar = self._convert_row_to_bar(row, ts_col)
                if bar is not None:
                    bars.append(bar)
            except Exception as e:
                logger.warning(f"Failed to convert row {idx}: {e}")
                continue

        return bars

    def _find_timestamp_column(self, df: pd.DataFrame) -> Optional[str]:
        """Find the timestamp column in the DataFrame."""
        candidates = ["date", "datetime", "timestamp", "time", "Date", "Datetime"]
        for col in candidates:
            if col in df.columns:
                return col
        return None

    def _index_is_timestamp(self, df: pd.DataFrame) -> bool:
        """Return True if the index looks like a timestamp series."""
        name = (df.index.name or "").lower()
        if name in {"date", "datetime", "timestamp", "time"}:
            return True
        try:
            sample = df.index[0]
        except Exception:
            return False
        try:
            pd.Timestamp(sample)
        except Exception:
            return False
        return True

    def _convert_row_to_bar(
        self, row: pd.Series, ts_col: Optional[str]
    ) -> Optional[Bar]:
        """
        Convert a single DataFrame row to a Bar.

        Args:
            row: DataFrame row with OHLCV data.
            ts_col: Name of timestamp column or None if using index.

        Returns:
            Bar object or None if conversion fails.
        """
        # Extract timestamp
        if ts_col is not None:
            ts = row[ts_col]
        else:
            ts = row.name

        # Convert timestamp to nanoseconds
        ts_ns = self._to_unix_nanos(ts)
        if ts_ns is None:
            return None

        # Extract OHLCV values
        open_price = self._to_price(row.get("open") or row.get("Open"))
        high_price = self._to_price(row.get("high") or row.get("High"))
        low_price = self._to_price(row.get("low") or row.get("Low"))
        close_price = self._to_price(row.get("close") or row.get("Close"))
        volume = self._to_quantity(row.get("volume") or row.get("Volume"))

        if any(
            v is None for v in [open_price, high_price, low_price, close_price, volume]
        ):
            return None

        return Bar(
            bar_type=self.bar_type,
            open=open_price,
            high=high_price,
            low=low_price,
            close=close_price,
            volume=volume,
            ts_event=ts_ns,
            ts_init=ts_ns,
        )

    def _to_unix_nanos(self, ts) -> Optional[int]:
        """Convert timestamp to Unix nanoseconds."""
        try:
            if isinstance(ts, pd.Timestamp):
                return int(ts.value)
            elif isinstance(ts, datetime):
                return dt_to_unix_nanos(ts)
            elif isinstance(ts, (int, float)):
                # Assume already in nanoseconds if large enough
                if ts > 1e15:
                    return int(ts)
                # Assume seconds
                return int(ts * 1e9)
            else:
                # Try to parse string
                dt = pd.Timestamp(ts)
                return int(dt.value)
        except Exception as e:
            logger.warning(f"Failed to convert timestamp {ts}: {e}")
            return None

    def _to_price(self, value) -> Optional[Price]:
        """Convert value to NautilusTrader Price."""
        try:
            if value is None or pd.isna(value):
                return None
            return Price(Decimal(str(value)), precision=self.price_precision)
        except Exception as e:
            logger.warning(f"Failed to convert price {value}: {e}")
            return None

    def _to_quantity(self, value) -> Optional[Quantity]:
        """Convert value to NautilusTrader Quantity."""
        try:
            if value is None or pd.isna(value):
                return None
            return Quantity(Decimal(str(abs(value))), precision=self.size_precision)
        except Exception as e:
            logger.warning(f"Failed to convert quantity {value}: {e}")
            return None


class OpenBBQuoteTickConverter:
    """
    Converts OpenBB quote data to NautilusTrader QuoteTick objects.
    """

    def __init__(
        self,
        instrument_id: InstrumentId,
        price_precision: int = 2,
        size_precision: int = 0,
    ):
        """
        Initialize the quote tick converter.

        Args:
            instrument_id: The instrument identifier.
            price_precision: Decimal precision for prices.
            size_precision: Decimal precision for sizes.
        """
        self.instrument_id = instrument_id
        self.price_precision = price_precision
        self.size_precision = size_precision

    def convert_dataframe(self, df: pd.DataFrame) -> list[QuoteTick]:
        """
        Convert an OpenBB quote DataFrame to a list of QuoteTicks.

        Expected DataFrame columns:
        - timestamp: Quote timestamp
        - bid: Bid price
        - ask: Ask price
        - bid_size: Bid size
        - ask_size: Ask size

        Args:
            df: OpenBB quote DataFrame.

        Returns:
            List of NautilusTrader QuoteTick objects.
        """
        ticks = []

        for idx, row in df.iterrows():
            try:
                tick = self._convert_row_to_quote(row)
                if tick is not None:
                    ticks.append(tick)
            except Exception as e:
                logger.warning(f"Failed to convert row {idx}: {e}")
                continue

        return ticks

    def _convert_row_to_quote(self, row: pd.Series) -> Optional[QuoteTick]:
        """Convert a single row to a QuoteTick."""
        # Extract timestamp
        ts = row.get("timestamp") or row.get("datetime") or row.name
        ts_ns = self._to_unix_nanos(ts)
        if ts_ns is None:
            return None

        # Extract quote data
        bid_price = self._to_price(row.get("bid"))
        ask_price = self._to_price(row.get("ask"))
        bid_size = self._to_quantity(row.get("bid_size", 1))
        ask_size = self._to_quantity(row.get("ask_size", 1))

        if any(v is None for v in [bid_price, ask_price, bid_size, ask_size]):
            return None

        return QuoteTick(
            instrument_id=self.instrument_id,
            bid_price=bid_price,
            ask_price=ask_price,
            bid_size=bid_size,
            ask_size=ask_size,
            ts_event=ts_ns,
            ts_init=ts_ns,
        )

    def _to_unix_nanos(self, ts) -> Optional[int]:
        """Convert timestamp to Unix nanoseconds."""
        try:
            if isinstance(ts, pd.Timestamp):
                return int(ts.value)
            elif isinstance(ts, datetime):
                return dt_to_unix_nanos(ts)
            elif isinstance(ts, (int, float)):
                if ts > 1e15:
                    return int(ts)
                return int(ts * 1e9)
            else:
                dt = pd.Timestamp(ts)
                return int(dt.value)
        except Exception:
            return None

    def _to_price(self, value) -> Optional[Price]:
        """Convert value to Price."""
        try:
            if value is None or pd.isna(value):
                return None
            return Price(Decimal(str(value)), precision=self.price_precision)
        except Exception:
            return None

    def _to_quantity(self, value) -> Optional[Quantity]:
        """Convert value to Quantity."""
        try:
            if value is None or pd.isna(value):
                return None
            return Quantity(Decimal(str(abs(value))), precision=self.size_precision)
        except Exception:
            return None


class OpenBBTradeTickConverter:
    """
    Converts OpenBB trade data to NautilusTrader TradeTick objects.
    """

    def __init__(
        self,
        instrument_id: InstrumentId,
        price_precision: int = 2,
        size_precision: int = 0,
    ):
        """
        Initialize the trade tick converter.

        Args:
            instrument_id: The instrument identifier.
            price_precision: Decimal precision for prices.
            size_precision: Decimal precision for sizes.
        """
        self.instrument_id = instrument_id
        self.price_precision = price_precision
        self.size_precision = size_precision
        self._trade_id_counter = 0

    def convert_dataframe(self, df: pd.DataFrame) -> list[TradeTick]:
        """
        Convert an OpenBB trade DataFrame to a list of TradeTicks.

        Expected DataFrame columns:
        - timestamp: Trade timestamp
        - price: Trade price
        - size: Trade size
        - side (optional): "buy" or "sell"

        Args:
            df: OpenBB trade DataFrame.

        Returns:
            List of NautilusTrader TradeTick objects.
        """
        ticks = []

        for idx, row in df.iterrows():
            try:
                tick = self._convert_row_to_trade(row)
                if tick is not None:
                    ticks.append(tick)
            except Exception as e:
                logger.warning(f"Failed to convert row {idx}: {e}")
                continue

        return ticks

    def _convert_row_to_trade(self, row: pd.Series) -> Optional[TradeTick]:
        """Convert a single row to a TradeTick."""
        # Extract timestamp
        ts = row.get("timestamp") or row.get("datetime") or row.name
        ts_ns = self._to_unix_nanos(ts)
        if ts_ns is None:
            return None

        # Extract trade data
        price = self._to_price(row.get("price"))
        size = self._to_quantity(row.get("size") or row.get("volume", 1))

        if price is None or size is None:
            return None

        # Determine aggressor side
        side_str = str(row.get("side", "")).lower()
        if side_str in ("buy", "b", "buyer"):
            aggressor_side = AggressorSide.BUYER
        elif side_str in ("sell", "s", "seller"):
            aggressor_side = AggressorSide.SELLER
        else:
            aggressor_side = AggressorSide.NO_AGGRESSOR

        # Generate trade ID
        self._trade_id_counter += 1
        trade_id = TradeId(str(row.get("trade_id", self._trade_id_counter)))

        return TradeTick(
            instrument_id=self.instrument_id,
            price=price,
            size=size,
            aggressor_side=aggressor_side,
            trade_id=trade_id,
            ts_event=ts_ns,
            ts_init=ts_ns,
        )

    def _to_unix_nanos(self, ts) -> Optional[int]:
        """Convert timestamp to Unix nanoseconds."""
        try:
            if isinstance(ts, pd.Timestamp):
                return int(ts.value)
            elif isinstance(ts, datetime):
                return dt_to_unix_nanos(ts)
            elif isinstance(ts, (int, float)):
                if ts > 1e15:
                    return int(ts)
                return int(ts * 1e9)
            else:
                dt = pd.Timestamp(ts)
                return int(dt.value)
        except Exception:
            return None

    def _to_price(self, value) -> Optional[Price]:
        """Convert value to Price."""
        try:
            if value is None or pd.isna(value):
                return None
            return Price(Decimal(str(value)), precision=self.price_precision)
        except Exception:
            return None

    def _to_quantity(self, value) -> Optional[Quantity]:
        """Convert value to Quantity."""
        try:
            if value is None or pd.isna(value):
                return None
            return Quantity(Decimal(str(abs(value))), precision=self.size_precision)
        except Exception:
            return None


class OpenBBInstrumentProvider:
    """
    Provides NautilusTrader instrument definitions from OpenBB data.
    """

    def __init__(self, venue: str = "OPENBB"):
        """
        Initialize the instrument provider.

        Args:
            venue: Default venue for instruments.
        """
        self.venue = Venue(venue)
        self._instruments: dict[InstrumentId, Equity] = {}

    def create_equity(
        self,
        config: InstrumentConfig,
        venue: Optional[str] = None,
    ) -> Equity:
        """
        Create an Equity instrument from configuration.

        Args:
            config: Instrument configuration.
            venue: Optional venue override.

        Returns:
            Equity instrument definition.
        """
        venue_obj = Venue(venue) if venue else self.venue
        instrument_id = InstrumentId.from_str(f"{config.symbol}.{venue_obj}")

        # Convert tick_size to Price with appropriate precision
        tick_precision = (
            len(str(config.tick_size).split(".")[-1])
            if "." in str(config.tick_size)
            else 0
        )

        equity = Equity(
            instrument_id=instrument_id,
            raw_symbol=instrument_id.symbol,
            currency=config.currency,
            price_precision=tick_precision,
            price_increment=Price(
                Decimal(str(config.tick_size)), precision=tick_precision
            ),
            lot_size=Quantity(Decimal(str(config.lot_size)), precision=0),
            ts_event=0,
            ts_init=0,
        )

        self._instruments[instrument_id] = equity
        return equity

    def get_instrument(self, instrument_id: InstrumentId) -> Optional[Equity]:
        """
        Get a cached instrument by ID.

        Args:
            instrument_id: The instrument identifier.

        Returns:
            Equity instrument or None.
        """
        return self._instruments.get(instrument_id)

    def add_instrument(self, instrument: Equity) -> None:
        """
        Add an instrument to the cache.

        Args:
            instrument: The instrument to add.
        """
        self._instruments[instrument.id] = instrument

    @property
    def instruments(self) -> dict[InstrumentId, Equity]:
        """Get all cached instruments."""
        return self._instruments.copy()
