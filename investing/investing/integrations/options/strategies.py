"""
Options Strategy Analyzer

Analyze multi-leg options strategies including payoff diagrams,
Greeks aggregation, and risk/reward analysis.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union

import numpy as np
import pandas as pd

from .pricing import OptionsPricer, OptionType, GreeksResult

logger = logging.getLogger(__name__)


class StrategyType(Enum):
    """Common options strategy types."""

    LONG_CALL = "long_call"
    LONG_PUT = "long_put"
    SHORT_CALL = "short_call"
    SHORT_PUT = "short_put"
    COVERED_CALL = "covered_call"
    PROTECTIVE_PUT = "protective_put"
    BULL_CALL_SPREAD = "bull_call_spread"
    BEAR_PUT_SPREAD = "bear_put_spread"
    BULL_PUT_SPREAD = "bull_put_spread"
    BEAR_CALL_SPREAD = "bear_call_spread"
    LONG_STRADDLE = "long_straddle"
    SHORT_STRADDLE = "short_straddle"
    LONG_STRANGLE = "long_strangle"
    SHORT_STRANGLE = "short_strangle"
    IRON_CONDOR = "iron_condor"
    IRON_BUTTERFLY = "iron_butterfly"
    BUTTERFLY = "butterfly"
    CALENDAR_SPREAD = "calendar_spread"
    DIAGONAL_SPREAD = "diagonal_spread"
    COLLAR = "collar"
    CUSTOM = "custom"


@dataclass
class StrategyLeg:
    """Individual leg of an options strategy."""

    option_type: OptionType
    strike: float
    quantity: int  # Positive for long, negative for short
    expiry: float  # Time to expiry in years
    premium: Optional[float] = None  # Price paid/received per contract


@dataclass
class StrategyPayoff:
    """Strategy payoff analysis result."""

    strategy_type: str
    legs: List[Dict[str, Any]]
    net_premium: float  # Net premium paid (positive) or received (negative)
    max_profit: float
    max_loss: float
    breakeven_prices: List[float]
    profit_probability: Optional[float]
    aggregate_greeks: GreeksResult
    payoff_at_expiry: pd.DataFrame
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "strategy_type": self.strategy_type,
            "legs": self.legs,
            "net_premium": round(self.net_premium, 2),
            "max_profit": (
                round(self.max_profit, 2)
                if self.max_profit != float("inf")
                else "unlimited"
            ),
            "max_loss": (
                round(self.max_loss, 2)
                if self.max_loss != float("-inf")
                else "unlimited"
            ),
            "breakeven_prices": [round(b, 2) for b in self.breakeven_prices],
            "profit_probability": (
                round(self.profit_probability, 3) if self.profit_probability else None
            ),
            "aggregate_greeks": self.aggregate_greeks.to_dict(),
            "timestamp": self.timestamp.isoformat(),
        }


class OptionsStrategyAnalyzer:
    """
    Analyze options strategies with multi-leg support.

    Provides:
    - Payoff diagram calculation
    - Breakeven analysis
    - Risk/reward metrics
    - Greeks aggregation
    - Probability of profit
    """

    def __init__(
        self,
        pricer: Optional[OptionsPricer] = None,
        risk_free_rate: float = 0.05,
    ):
        """
        Initialize OptionsStrategyAnalyzer.

        Args:
            pricer: OptionsPricer instance (created if not provided)
            risk_free_rate: Annual risk-free rate
        """
        self.pricer = pricer or OptionsPricer(risk_free_rate=risk_free_rate)
        logger.info("OptionsStrategyAnalyzer initialized")

    def analyze_strategy(
        self,
        spot: float,
        legs: List[StrategyLeg],
        volatility: float,
        strategy_name: str = "custom",
        price_range_pct: float = 0.3,
    ) -> StrategyPayoff:
        """
        Analyze a custom multi-leg options strategy.

        Args:
            spot: Current underlying price
            legs: List of StrategyLeg objects
            volatility: Implied volatility for pricing
            strategy_name: Name of the strategy
            price_range_pct: Price range for payoff diagram (+/- %)

        Returns:
            StrategyPayoff with complete analysis
        """
        # Calculate premium for each leg if not provided
        leg_details = []
        net_premium = 0.0

        for leg in legs:
            if leg.premium is None:
                price_result = self.pricer.price_option(
                    spot=spot,
                    strike=leg.strike,
                    time_to_expiry=leg.expiry,
                    volatility=volatility,
                    option_type=leg.option_type,
                )
                leg.premium = price_result.theoretical_price

            # Net premium: positive qty = buy (pay), negative qty = sell (receive)
            leg_premium = leg.premium * leg.quantity * 100  # per contract
            net_premium += leg_premium

            leg_details.append(
                {
                    "option_type": leg.option_type.value,
                    "strike": leg.strike,
                    "quantity": leg.quantity,
                    "expiry_years": leg.expiry,
                    "premium": leg.premium,
                    "total_premium": leg_premium,
                }
            )

        # Calculate payoff at expiry
        min_price = spot * (1 - price_range_pct)
        max_price = spot * (1 + price_range_pct)
        prices = np.linspace(min_price, max_price, 200)

        payoffs = self._calculate_payoff_at_expiry(legs, prices, net_premium)
        payoff_df = pd.DataFrame({"underlying_price": prices, "profit_loss": payoffs})

        # Find max profit/loss and breakeven
        max_profit = float(np.max(payoffs))
        max_loss = float(np.min(payoffs))
        breakevens = self._find_breakeven_points(prices, payoffs)

        # Check for unlimited profit/loss
        if abs(payoffs[-1]) > abs(payoffs[0]) * 10:
            max_profit = float("inf")
        if abs(payoffs[0]) > abs(payoffs[-1]) * 10:
            max_loss = float("-inf")

        # Calculate aggregate Greeks
        aggregate_greeks = self._aggregate_greeks(spot, legs, volatility)

        # Calculate profit probability (simplified)
        profit_prob = self._estimate_profit_probability(
            spot, volatility, legs, breakevens
        )

        return StrategyPayoff(
            strategy_type=strategy_name,
            legs=leg_details,
            net_premium=net_premium,
            max_profit=max_profit,
            max_loss=max_loss,
            breakeven_prices=breakevens,
            profit_probability=profit_prob,
            aggregate_greeks=aggregate_greeks,
            payoff_at_expiry=payoff_df,
        )

    def create_bull_call_spread(
        self,
        spot: float,
        lower_strike: float,
        upper_strike: float,
        expiry: float,
        volatility: float,
    ) -> StrategyPayoff:
        """Create and analyze a bull call spread."""
        legs = [
            StrategyLeg(OptionType.CALL, lower_strike, 1, expiry),
            StrategyLeg(OptionType.CALL, upper_strike, -1, expiry),
        ]
        return self.analyze_strategy(
            spot, legs, volatility, StrategyType.BULL_CALL_SPREAD.value
        )

    def create_bear_put_spread(
        self,
        spot: float,
        lower_strike: float,
        upper_strike: float,
        expiry: float,
        volatility: float,
    ) -> StrategyPayoff:
        """Create and analyze a bear put spread."""
        legs = [
            StrategyLeg(OptionType.PUT, upper_strike, 1, expiry),
            StrategyLeg(OptionType.PUT, lower_strike, -1, expiry),
        ]
        return self.analyze_strategy(
            spot, legs, volatility, StrategyType.BEAR_PUT_SPREAD.value
        )

    def create_iron_condor(
        self,
        spot: float,
        put_long_strike: float,
        put_short_strike: float,
        call_short_strike: float,
        call_long_strike: float,
        expiry: float,
        volatility: float,
    ) -> StrategyPayoff:
        """Create and analyze an iron condor."""
        legs = [
            StrategyLeg(OptionType.PUT, put_long_strike, 1, expiry),
            StrategyLeg(OptionType.PUT, put_short_strike, -1, expiry),
            StrategyLeg(OptionType.CALL, call_short_strike, -1, expiry),
            StrategyLeg(OptionType.CALL, call_long_strike, 1, expiry),
        ]
        return self.analyze_strategy(
            spot, legs, volatility, StrategyType.IRON_CONDOR.value
        )

    def create_straddle(
        self,
        spot: float,
        strike: float,
        expiry: float,
        volatility: float,
        is_long: bool = True,
    ) -> StrategyPayoff:
        """Create and analyze a straddle."""
        qty = 1 if is_long else -1
        legs = [
            StrategyLeg(OptionType.CALL, strike, qty, expiry),
            StrategyLeg(OptionType.PUT, strike, qty, expiry),
        ]
        strategy_type = (
            StrategyType.LONG_STRADDLE if is_long else StrategyType.SHORT_STRADDLE
        )
        return self.analyze_strategy(spot, legs, volatility, strategy_type.value)

    def create_strangle(
        self,
        spot: float,
        put_strike: float,
        call_strike: float,
        expiry: float,
        volatility: float,
        is_long: bool = True,
    ) -> StrategyPayoff:
        """Create and analyze a strangle."""
        qty = 1 if is_long else -1
        legs = [
            StrategyLeg(OptionType.PUT, put_strike, qty, expiry),
            StrategyLeg(OptionType.CALL, call_strike, qty, expiry),
        ]
        strategy_type = (
            StrategyType.LONG_STRANGLE if is_long else StrategyType.SHORT_STRANGLE
        )
        return self.analyze_strategy(spot, legs, volatility, strategy_type.value)

    def create_butterfly(
        self,
        spot: float,
        lower_strike: float,
        middle_strike: float,
        upper_strike: float,
        expiry: float,
        volatility: float,
        option_type: Union[str, OptionType] = OptionType.CALL,
    ) -> StrategyPayoff:
        """Create and analyze a butterfly spread."""
        if isinstance(option_type, str):
            option_type = OptionType(option_type.lower())

        legs = [
            StrategyLeg(option_type, lower_strike, 1, expiry),
            StrategyLeg(option_type, middle_strike, -2, expiry),
            StrategyLeg(option_type, upper_strike, 1, expiry),
        ]
        return self.analyze_strategy(
            spot, legs, volatility, StrategyType.BUTTERFLY.value
        )

    def create_covered_call(
        self,
        spot: float,
        strike: float,
        expiry: float,
        volatility: float,
        stock_cost_basis: Optional[float] = None,
    ) -> StrategyPayoff:
        """
        Create and analyze a covered call.

        Note: This assumes ownership of 100 shares of stock per contract.
        """
        # Price the call
        call_price = self.pricer.price_option(
            spot, strike, expiry, volatility, OptionType.CALL
        )

        # Calculate payoff at various prices
        min_price = spot * 0.7
        max_price = spot * 1.3
        prices = np.linspace(min_price, max_price, 200)

        cost_basis = stock_cost_basis or spot
        stock_pl = (prices - cost_basis) * 100  # P/L on 100 shares
        call_pl = np.where(
            prices > strike,
            (strike - prices) * 100 + call_price.theoretical_price * 100,
            call_price.theoretical_price * 100,
        )

        payoffs = stock_pl + call_pl

        payoff_df = pd.DataFrame({"underlying_price": prices, "profit_loss": payoffs})

        # Max profit at strike
        max_profit = float((strike - cost_basis + call_price.theoretical_price) * 100)
        # Max loss is if stock goes to 0
        max_loss = float(-cost_basis * 100 + call_price.theoretical_price * 100)
        # Breakeven
        breakeven = cost_basis - call_price.theoretical_price

        # Get Greeks for short call position
        greeks = call_price.greeks
        # Adjust for short position
        adjusted_greeks = GreeksResult(
            delta=100 - greeks.delta * 100,  # 100 deltas from stock, minus call delta
            gamma=-greeks.gamma * 100,
            theta=-greeks.theta * 100,  # Theta is positive (time decay helps)
            vega=-greeks.vega * 100,
            rho=-greeks.rho * 100,
        )

        return StrategyPayoff(
            strategy_type=StrategyType.COVERED_CALL.value,
            legs=[
                {
                    "type": "stock",
                    "quantity": 100,
                    "cost_basis": cost_basis,
                },
                {
                    "option_type": "call",
                    "strike": strike,
                    "quantity": -1,
                    "expiry_years": expiry,
                    "premium": call_price.theoretical_price,
                },
            ],
            net_premium=-call_price.theoretical_price * 100,
            max_profit=max_profit,
            max_loss=max_loss,
            breakeven_prices=[breakeven],
            profit_probability=None,
            aggregate_greeks=adjusted_greeks,
            payoff_at_expiry=payoff_df,
        )

    def create_protective_put(
        self,
        spot: float,
        strike: float,
        expiry: float,
        volatility: float,
        stock_cost_basis: Optional[float] = None,
    ) -> StrategyPayoff:
        """
        Create and analyze a protective put.

        Note: This assumes ownership of 100 shares of stock per contract.
        """
        # Price the put
        put_price = self.pricer.price_option(
            spot, strike, expiry, volatility, OptionType.PUT
        )

        # Calculate payoff at various prices
        min_price = spot * 0.7
        max_price = spot * 1.3
        prices = np.linspace(min_price, max_price, 200)

        cost_basis = stock_cost_basis or spot
        stock_pl = (prices - cost_basis) * 100  # P/L on 100 shares
        put_pl = (
            np.maximum(strike - prices, 0) * 100 - put_price.theoretical_price * 100
        )

        payoffs = stock_pl + put_pl

        payoff_df = pd.DataFrame({"underlying_price": prices, "profit_loss": payoffs})

        # Max profit is unlimited
        max_profit = float("inf")
        # Max loss is limited
        max_loss = float((strike - cost_basis - put_price.theoretical_price) * 100)
        # Breakeven
        breakeven = cost_basis + put_price.theoretical_price

        # Get Greeks
        greeks = put_price.greeks
        adjusted_greeks = GreeksResult(
            delta=100 + greeks.delta * 100,  # 100 from stock plus put delta
            gamma=greeks.gamma * 100,
            theta=greeks.theta * 100,
            vega=greeks.vega * 100,
            rho=greeks.rho * 100,
        )

        return StrategyPayoff(
            strategy_type=StrategyType.PROTECTIVE_PUT.value,
            legs=[
                {
                    "type": "stock",
                    "quantity": 100,
                    "cost_basis": cost_basis,
                },
                {
                    "option_type": "put",
                    "strike": strike,
                    "quantity": 1,
                    "expiry_years": expiry,
                    "premium": put_price.theoretical_price,
                },
            ],
            net_premium=put_price.theoretical_price * 100,
            max_profit=max_profit,
            max_loss=max_loss,
            breakeven_prices=[breakeven],
            profit_probability=None,
            aggregate_greeks=adjusted_greeks,
            payoff_at_expiry=payoff_df,
        )

    # =========================================================================
    # Private Methods
    # =========================================================================

    def _calculate_payoff_at_expiry(
        self,
        legs: List[StrategyLeg],
        prices: np.ndarray,
        net_premium: float,
    ) -> np.ndarray:
        """Calculate strategy payoff at expiration for various underlying prices."""
        payoffs = np.zeros(len(prices))

        for leg in legs:
            if leg.option_type == OptionType.CALL:
                leg_payoff = np.maximum(prices - leg.strike, 0)
            else:
                leg_payoff = np.maximum(leg.strike - prices, 0)

            # Multiply by quantity (positive for long, negative for short)
            payoffs += leg_payoff * leg.quantity * 100

        # Subtract net premium paid
        payoffs -= net_premium

        return payoffs

    def _find_breakeven_points(
        self,
        prices: np.ndarray,
        payoffs: np.ndarray,
    ) -> List[float]:
        """Find breakeven points where payoff crosses zero."""
        breakevens = []

        for i in range(len(payoffs) - 1):
            if payoffs[i] * payoffs[i + 1] < 0:
                # Linear interpolation
                ratio = abs(payoffs[i]) / (abs(payoffs[i]) + abs(payoffs[i + 1]))
                breakeven = prices[i] + ratio * (prices[i + 1] - prices[i])
                breakevens.append(float(breakeven))

        return sorted(breakevens)

    def _aggregate_greeks(
        self,
        spot: float,
        legs: List[StrategyLeg],
        volatility: float,
    ) -> GreeksResult:
        """Calculate aggregate Greeks for all legs."""
        total_delta = 0.0
        total_gamma = 0.0
        total_theta = 0.0
        total_vega = 0.0
        total_rho = 0.0

        for leg in legs:
            greeks = self.pricer.calculate_greeks(
                spot=spot,
                strike=leg.strike,
                time_to_expiry=leg.expiry,
                volatility=volatility,
                option_type=leg.option_type,
            )

            # Scale by quantity and contracts (100 shares per contract)
            multiplier = leg.quantity * 100
            total_delta += greeks.delta * multiplier
            total_gamma += greeks.gamma * multiplier
            total_theta += greeks.theta * multiplier
            total_vega += greeks.vega * multiplier
            total_rho += greeks.rho * multiplier

        return GreeksResult(
            delta=total_delta,
            gamma=total_gamma,
            theta=total_theta,
            vega=total_vega,
            rho=total_rho,
        )

    def _estimate_profit_probability(
        self,
        spot: float,
        volatility: float,
        legs: List[StrategyLeg],
        breakevens: List[float],
    ) -> Optional[float]:
        """
        Estimate probability of profit at expiration.

        Uses log-normal distribution assumption.
        """
        if not breakevens:
            return None

        try:
            from scipy.stats import norm as scipy_norm

            # Use shortest expiry for estimation
            expiry = min(leg.expiry for leg in legs)

            # Log-normal parameters
            mean = (
                np.log(spot)
                + (self.pricer.risk_free_rate - 0.5 * volatility**2) * expiry
            )
            std = volatility * np.sqrt(expiry)

            # Calculate probability based on breakeven structure
            if len(breakevens) == 1:
                # Single breakeven
                be = breakevens[0]
                # Determine if profit is above or below breakeven
                # Check payoff at spot vs breakeven
                test_payoff = self._calculate_payoff_at_expiry(
                    legs, np.array([spot]), 0
                )[0]

                if test_payoff > 0:
                    # Profitable at current price, need to stay there
                    prob = 1 - scipy_norm.cdf((np.log(be) - mean) / std)
                else:
                    prob = scipy_norm.cdf((np.log(be) - mean) / std)

            elif len(breakevens) == 2:
                # Two breakevens (e.g., straddle)
                be_low, be_high = sorted(breakevens)
                prob_below = scipy_norm.cdf((np.log(be_low) - mean) / std)
                prob_above = 1 - scipy_norm.cdf((np.log(be_high) - mean) / std)

                # Determine if profit is inside or outside
                test_payoff = self._calculate_payoff_at_expiry(
                    legs, np.array([spot]), 0
                )[0]

                if test_payoff > 0:
                    # Profitable between breakevens
                    prob = 1 - prob_below - prob_above
                else:
                    prob = prob_below + prob_above

            else:
                # Complex case
                return None

            return float(max(0, min(1, prob)))

        except Exception as e:
            logger.debug(f"Profit probability calculation failed: {e}")
            return None

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return self.pricer.health_check()
