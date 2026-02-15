"""
Position and Holdings Module

Data structures and utilities for managing portfolio positions,
holdings, and calculating position-level metrics.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class Position:
    """Represents a single position in a portfolio."""

    symbol: str
    shares: float
    average_cost: float
    current_price: float = 0.0
    sector: str = "Unknown"
    asset_class: str = "Equity"

    @property
    def market_value(self) -> float:
        """Current market value of the position."""
        return self.shares * self.current_price

    @property
    def cost_basis(self) -> float:
        """Total cost basis of the position."""
        return self.shares * self.average_cost

    @property
    def unrealized_pnl(self) -> float:
        """Unrealized profit/loss."""
        return self.market_value - self.cost_basis

    @property
    def unrealized_pnl_percent(self) -> float:
        """Unrealized P&L as percentage of cost basis."""
        if self.cost_basis == 0:
            return 0.0
        return (self.unrealized_pnl / self.cost_basis) * 100

    def to_dict(self) -> Dict[str, Any]:
        """Convert position to dictionary."""
        return {
            "symbol": self.symbol,
            "shares": self.shares,
            "average_cost": self.average_cost,
            "current_price": self.current_price,
            "market_value": self.market_value,
            "cost_basis": self.cost_basis,
            "unrealized_pnl": self.unrealized_pnl,
            "unrealized_pnl_percent": self.unrealized_pnl_percent,
            "sector": self.sector,
            "asset_class": self.asset_class,
        }


@dataclass
class Holdings:
    """Container for portfolio holdings with aggregate metrics."""

    positions: List[Position] = field(default_factory=list)
    cash: float = 0.0
    updated_at: datetime = field(default_factory=datetime.now)

    @property
    def total_market_value(self) -> float:
        """Total market value including cash."""
        return sum(p.market_value for p in self.positions) + self.cash

    @property
    def total_cost_basis(self) -> float:
        """Total cost basis of all positions."""
        return sum(p.cost_basis for p in self.positions)

    @property
    def total_unrealized_pnl(self) -> float:
        """Total unrealized P&L."""
        return sum(p.unrealized_pnl for p in self.positions)

    @property
    def total_unrealized_pnl_percent(self) -> float:
        """Total unrealized P&L as percentage."""
        if self.total_cost_basis == 0:
            return 0.0
        return (self.total_unrealized_pnl / self.total_cost_basis) * 100

    def get_weights(self) -> Dict[str, float]:
        """Get portfolio weights by symbol."""
        total = self.total_market_value
        if total == 0:
            return {}
        return {p.symbol: p.market_value / total for p in self.positions}

    def get_sector_weights(self) -> Dict[str, float]:
        """Get portfolio weights by sector."""
        total = self.total_market_value
        if total == 0:
            return {}

        sector_values = {}
        for p in self.positions:
            sector_values[p.sector] = sector_values.get(p.sector, 0) + p.market_value

        return {sector: value / total for sector, value in sector_values.items()}

    def add_position(self, position: Position) -> None:
        """Add a position to holdings."""
        # Check if position already exists
        for i, p in enumerate(self.positions):
            if p.symbol == position.symbol:
                # Merge positions
                total_shares = p.shares + position.shares
                if total_shares > 0:
                    new_avg_cost = (p.cost_basis + position.cost_basis) / total_shares
                else:
                    new_avg_cost = 0
                self.positions[i] = Position(
                    symbol=position.symbol,
                    shares=total_shares,
                    average_cost=new_avg_cost,
                    current_price=position.current_price,
                    sector=position.sector,
                    asset_class=position.asset_class,
                )
                return

        self.positions.append(position)

    def remove_position(self, symbol: str) -> Optional[Position]:
        """Remove a position from holdings."""
        for i, p in enumerate(self.positions):
            if p.symbol == symbol:
                return self.positions.pop(i)
        return None

    def get_position(self, symbol: str) -> Optional[Position]:
        """Get position by symbol."""
        for p in self.positions:
            if p.symbol == symbol:
                return p
        return None

    def update_prices(self, prices: Dict[str, float]) -> None:
        """Update current prices for all positions."""
        for p in self.positions:
            if p.symbol in prices:
                p.current_price = prices[p.symbol]
        self.updated_at = datetime.now()

    def to_dataframe(self) -> pd.DataFrame:
        """Convert holdings to DataFrame."""
        if not self.positions:
            return pd.DataFrame()

        data = [p.to_dict() for p in self.positions]
        df = pd.DataFrame(data)

        # Add weight column
        total = self.total_market_value
        if total > 0:
            df["weight"] = df["market_value"] / total * 100
        else:
            df["weight"] = 0

        return df

    def to_dict(self) -> Dict[str, Any]:
        """Convert holdings to dictionary."""
        return {
            "positions": [p.to_dict() for p in self.positions],
            "cash": self.cash,
            "total_market_value": self.total_market_value,
            "total_cost_basis": self.total_cost_basis,
            "total_unrealized_pnl": self.total_unrealized_pnl,
            "total_unrealized_pnl_percent": self.total_unrealized_pnl_percent,
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Holdings":
        """Create Holdings from dictionary."""
        positions = [
            Position(
                symbol=p["symbol"],
                shares=p["shares"],
                average_cost=p["average_cost"],
                current_price=p.get("current_price", 0),
                sector=p.get("sector", "Unknown"),
                asset_class=p.get("asset_class", "Equity"),
            )
            for p in data.get("positions", [])
        ]
        return cls(
            positions=positions,
            cash=data.get("cash", 0),
        )


# Default sector mappings for common stocks
DEFAULT_SECTOR_MAP = {
    # Technology
    "AAPL": "Technology",
    "MSFT": "Technology",
    "GOOGL": "Technology",
    "GOOG": "Technology",
    "META": "Technology",
    "NVDA": "Technology",
    "AMD": "Technology",
    "INTC": "Technology",
    "CRM": "Technology",
    "ORCL": "Technology",
    "ADBE": "Technology",
    "CSCO": "Technology",
    "AVGO": "Technology",
    "TXN": "Technology",
    "QCOM": "Technology",
    # Healthcare
    "JNJ": "Healthcare",
    "UNH": "Healthcare",
    "PFE": "Healthcare",
    "ABBV": "Healthcare",
    "MRK": "Healthcare",
    "LLY": "Healthcare",
    "TMO": "Healthcare",
    "ABT": "Healthcare",
    "DHR": "Healthcare",
    "BMY": "Healthcare",
    # Financial
    "JPM": "Financial",
    "BAC": "Financial",
    "WFC": "Financial",
    "GS": "Financial",
    "MS": "Financial",
    "C": "Financial",
    "BLK": "Financial",
    "SCHW": "Financial",
    "AXP": "Financial",
    "V": "Financial",
    "MA": "Financial",
    # Consumer
    "AMZN": "Consumer",
    "TSLA": "Consumer",
    "HD": "Consumer",
    "MCD": "Consumer",
    "NKE": "Consumer",
    "SBUX": "Consumer",
    "TGT": "Consumer",
    "COST": "Consumer",
    "WMT": "Consumer",
    "PG": "Consumer",
    "KO": "Consumer",
    "PEP": "Consumer",
    # Energy
    "XOM": "Energy",
    "CVX": "Energy",
    "COP": "Energy",
    "SLB": "Energy",
    "EOG": "Energy",
    "OXY": "Energy",
    # Industrial
    "CAT": "Industrial",
    "BA": "Industrial",
    "HON": "Industrial",
    "UPS": "Industrial",
    "RTX": "Industrial",
    "LMT": "Industrial",
    "GE": "Industrial",
    "MMM": "Industrial",
    # Communication
    "DIS": "Communication",
    "NFLX": "Communication",
    "CMCSA": "Communication",
    "T": "Communication",
    "VZ": "Communication",
    # Utilities
    "NEE": "Utilities",
    "DUK": "Utilities",
    "SO": "Utilities",
    # Real Estate
    "AMT": "Real Estate",
    "PLD": "Real Estate",
    "CCI": "Real Estate",
    # Materials
    "LIN": "Materials",
    "APD": "Materials",
    "DD": "Materials",
}


def get_sector(symbol: str, sector_map: Optional[Dict[str, str]] = None) -> str:
    """Get sector for a symbol."""
    if sector_map is None:
        sector_map = DEFAULT_SECTOR_MAP
    return sector_map.get(symbol.upper(), "Other")


def create_holdings_from_input(
    holdings_input: List[Dict[str, Any]],
    prices: Optional[Dict[str, float]] = None,
) -> Holdings:
    """
    Create Holdings object from input list.

    Args:
        holdings_input: List of dicts with 'symbol', 'shares', 'average_cost'
        prices: Optional dict of current prices

    Returns:
        Holdings object
    """
    positions = []
    for h in holdings_input:
        symbol = h.get("symbol", "").upper()
        shares = float(h.get("shares", 0))
        avg_cost = float(h.get("average_cost", 0))

        current_price = avg_cost  # Default to cost
        if prices and symbol in prices:
            current_price = prices[symbol]

        position = Position(
            symbol=symbol,
            shares=shares,
            average_cost=avg_cost,
            current_price=current_price,
            sector=get_sector(symbol),
        )
        positions.append(position)

    return Holdings(positions=positions)
