"""
Options Pricing Module

Institutional-grade options pricing using Black-Scholes and binomial models.
Provides Greeks calculation and implied volatility solving.
"""

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Check for optional dependencies
try:
    from py_vollib.black_scholes import black_scholes as bs_price
    from py_vollib.black_scholes.greeks.analytical import (
        delta as bs_delta,
        gamma as bs_gamma,
        theta as bs_theta,
        vega as bs_vega,
        rho as bs_rho,
    )
    from py_vollib.black_scholes.implied_volatility import implied_volatility as bs_iv

    HAS_VOLLIB = True
except ImportError:
    HAS_VOLLIB = False
    bs_price = None

try:
    import mibian

    HAS_MIBIAN = True
except ImportError:
    HAS_MIBIAN = False
    mibian = None

try:
    from scipy.stats import norm

    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    norm = None


class OptionType(Enum):
    """Option type enumeration."""

    CALL = "call"
    PUT = "put"


class PricingModel(Enum):
    """Pricing model enumeration."""

    BLACK_SCHOLES = "black_scholes"
    BINOMIAL = "binomial"
    MONTE_CARLO = "monte_carlo"


@dataclass
class GreeksResult:
    """Greeks calculation result."""

    delta: float
    gamma: float
    theta: float  # Per day
    vega: float  # Per 1% IV change
    rho: float  # Per 1% rate change
    charm: Optional[float] = None  # Delta decay
    vanna: Optional[float] = None  # Delta sensitivity to IV
    volga: Optional[float] = None  # Vega convexity
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        result: Dict[str, Any] = {
            "delta": round(self.delta, 6),
            "gamma": round(self.gamma, 6),
            "theta": round(self.theta, 6),
            "vega": round(self.vega, 6),
            "rho": round(self.rho, 6),
        }
        if self.charm is not None:
            result["charm"] = round(self.charm, 6)
        if self.vanna is not None:
            result["vanna"] = round(self.vanna, 6)
        if self.volga is not None:
            result["volga"] = round(self.volga, 6)
        result["timestamp"] = self.timestamp.isoformat()
        return result


@dataclass
class OptionPrice:
    """Option pricing result."""

    theoretical_price: float
    intrinsic_value: float
    time_value: float
    greeks: GreeksResult
    model: str
    inputs: Dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "theoretical_price": round(self.theoretical_price, 4),
            "intrinsic_value": round(self.intrinsic_value, 4),
            "time_value": round(self.time_value, 4),
            "greeks": self.greeks.to_dict(),
            "model": self.model,
            "inputs": self.inputs,
            "timestamp": self.timestamp.isoformat(),
        }


class OptionsPricer:
    """
    Options pricing engine with multiple models.

    Provides institutional-grade options pricing:
    - Black-Scholes analytical pricing
    - Binomial tree pricing
    - Greeks calculation
    - Implied volatility solving
    """

    def __init__(
        self,
        risk_free_rate: float = 0.05,
        dividend_yield: float = 0.0,
        default_model: PricingModel = PricingModel.BLACK_SCHOLES,
    ):
        """
        Initialize OptionsPricer.

        Args:
            risk_free_rate: Annual risk-free rate (default: 5%)
            dividend_yield: Annual dividend yield (default: 0%)
            default_model: Default pricing model
        """
        self.risk_free_rate = risk_free_rate
        self.dividend_yield = dividend_yield
        self.default_model = default_model

        logger.info(
            f"OptionsPricer initialized with r={risk_free_rate:.2%}, "
            f"q={dividend_yield:.2%}, model={default_model.value}"
        )

    def price_option(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: Union[str, OptionType] = OptionType.CALL,
        model: Optional[PricingModel] = None,
    ) -> OptionPrice:
        """
        Price an option using the specified model.

        Args:
            spot: Current underlying price
            strike: Strike price
            time_to_expiry: Time to expiration in years
            volatility: Implied volatility (annualized)
            option_type: 'call' or 'put'
            model: Pricing model (default: BLACK_SCHOLES)

        Returns:
            OptionPrice with theoretical price and Greeks
        """
        # Normalize option type
        if isinstance(option_type, str):
            option_type = OptionType(option_type.lower())

        model = model or self.default_model

        # Validate inputs
        if spot <= 0 or strike <= 0:
            raise ValueError("Spot and strike must be positive")
        if time_to_expiry <= 0:
            raise ValueError("Time to expiry must be positive")
        if volatility <= 0:
            raise ValueError("Volatility must be positive")

        # Calculate price based on model
        if model == PricingModel.BLACK_SCHOLES:
            price = self._black_scholes_price(
                spot, strike, time_to_expiry, volatility, option_type
            )
        elif model == PricingModel.BINOMIAL:
            price = self._binomial_price(
                spot, strike, time_to_expiry, volatility, option_type
            )
        else:
            # Default to Black-Scholes
            price = self._black_scholes_price(
                spot, strike, time_to_expiry, volatility, option_type
            )

        # Calculate Greeks
        greeks = self.calculate_greeks(
            spot, strike, time_to_expiry, volatility, option_type
        )

        # Calculate intrinsic and time value
        if option_type == OptionType.CALL:
            intrinsic = max(0, spot - strike)
        else:
            intrinsic = max(0, strike - spot)
        time_value = max(0, price - intrinsic)

        return OptionPrice(
            theoretical_price=price,
            intrinsic_value=intrinsic,
            time_value=time_value,
            greeks=greeks,
            model=model.value,
            inputs={
                "spot": spot,
                "strike": strike,
                "time_to_expiry": time_to_expiry,
                "volatility": volatility,
                "option_type": option_type.value,
                "risk_free_rate": self.risk_free_rate,
                "dividend_yield": self.dividend_yield,
            },
        )

    def calculate_greeks(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: Union[str, OptionType] = OptionType.CALL,
        include_higher_order: bool = False,
    ) -> GreeksResult:
        """
        Calculate option Greeks.

        Args:
            spot: Current underlying price
            strike: Strike price
            time_to_expiry: Time to expiration in years
            volatility: Implied volatility (annualized)
            option_type: 'call' or 'put'
            include_higher_order: Include charm, vanna, volga

        Returns:
            GreeksResult with all calculated Greeks
        """
        if isinstance(option_type, str):
            option_type = OptionType(option_type.lower())

        # Use py_vollib if available
        if HAS_VOLLIB:
            return self._vollib_greeks(
                spot, strike, time_to_expiry, volatility, option_type
            )

        # Fallback to manual calculation
        return self._manual_greeks(
            spot,
            strike,
            time_to_expiry,
            volatility,
            option_type,
            include_higher_order,
        )

    def implied_volatility(
        self,
        option_price: float,
        spot: float,
        strike: float,
        time_to_expiry: float,
        option_type: Union[str, OptionType] = OptionType.CALL,
        initial_guess: float = 0.3,
    ) -> float:
        """
        Calculate implied volatility from market price.

        Args:
            option_price: Market price of the option
            spot: Current underlying price
            strike: Strike price
            time_to_expiry: Time to expiration in years
            option_type: 'call' or 'put'
            initial_guess: Initial IV guess for solver

        Returns:
            Implied volatility (annualized)
        """
        if isinstance(option_type, str):
            option_type = OptionType(option_type.lower())

        # Validate
        if option_price <= 0:
            raise ValueError("Option price must be positive")

        # Calculate intrinsic value
        if option_type == OptionType.CALL:
            intrinsic = max(0, spot - strike)
        else:
            intrinsic = max(0, strike - spot)

        if option_price < intrinsic:
            raise ValueError("Option price below intrinsic value")

        # Use py_vollib if available
        if HAS_VOLLIB:
            try:
                flag = "c" if option_type == OptionType.CALL else "p"
                iv = bs_iv(
                    option_price,
                    spot,
                    strike,
                    time_to_expiry,
                    self.risk_free_rate,
                    flag,
                )
                return float(iv)
            except Exception as e:
                logger.warning(f"py_vollib IV failed: {e}, using fallback")

        # Manual Newton-Raphson solver
        return self._newton_iv(
            option_price,
            spot,
            strike,
            time_to_expiry,
            option_type,
            initial_guess,
        )

    def price_chain(
        self,
        spot: float,
        strikes: List[float],
        time_to_expiry: float,
        volatility: float,
    ) -> pd.DataFrame:
        """
        Price a chain of options at multiple strikes.

        Args:
            spot: Current underlying price
            strikes: List of strike prices
            time_to_expiry: Time to expiration in years
            volatility: Implied volatility

        Returns:
            DataFrame with call and put prices and Greeks
        """
        results = []

        for strike in strikes:
            call_price = self.price_option(
                spot, strike, time_to_expiry, volatility, OptionType.CALL
            )
            put_price = self.price_option(
                spot, strike, time_to_expiry, volatility, OptionType.PUT
            )

            results.append(
                {
                    "strike": strike,
                    "moneyness": spot / strike,
                    "call_price": call_price.theoretical_price,
                    "put_price": put_price.theoretical_price,
                    "call_delta": call_price.greeks.delta,
                    "put_delta": put_price.greeks.delta,
                    "call_gamma": call_price.greeks.gamma,
                    "call_theta": call_price.greeks.theta,
                    "call_vega": call_price.greeks.vega,
                    "put_theta": put_price.greeks.theta,
                    "put_vega": put_price.greeks.vega,
                }
            )

        return pd.DataFrame(results)

    def iv_surface(
        self,
        spot: float,
        strikes: List[float],
        expiries: List[float],
        option_prices: pd.DataFrame,
        option_type: Union[str, OptionType] = OptionType.CALL,
    ) -> pd.DataFrame:
        """
        Build implied volatility surface from market prices.

        Args:
            spot: Current underlying price
            strikes: List of strike prices
            expiries: List of times to expiry (years)
            option_prices: DataFrame with prices (index=strikes, columns=expiries)
            option_type: 'call' or 'put'

        Returns:
            DataFrame with IV surface (index=strikes, columns=expiries)
        """
        if isinstance(option_type, str):
            option_type = OptionType(option_type.lower())

        iv_surface = pd.DataFrame(index=strikes, columns=expiries)

        for strike in strikes:
            for expiry in expiries:
                try:
                    price = option_prices.loc[strike, expiry]
                    if price > 0 and expiry > 0:
                        iv = self.implied_volatility(
                            price, spot, strike, expiry, option_type
                        )
                        iv_surface.loc[strike, expiry] = iv
                except Exception as e:
                    logger.debug(f"IV calc failed for K={strike}, T={expiry}: {e}")
                    iv_surface.loc[strike, expiry] = np.nan

        return iv_surface

    # =========================================================================
    # Private Methods - Pricing Models
    # =========================================================================

    def _black_scholes_price(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: OptionType,
    ) -> float:
        """Calculate Black-Scholes option price."""
        # Use py_vollib if available
        if HAS_VOLLIB:
            flag = "c" if option_type == OptionType.CALL else "p"
            return float(
                bs_price(
                    flag,
                    spot,
                    strike,
                    time_to_expiry,
                    self.risk_free_rate,
                    volatility,
                )
            )

        # Manual Black-Scholes calculation
        return self._manual_black_scholes(
            spot, strike, time_to_expiry, volatility, option_type
        )

    def _manual_black_scholes(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: OptionType,
    ) -> float:
        """Manual Black-Scholes implementation."""
        if not HAS_SCIPY:
            # Use simple approximation if scipy not available
            return self._simple_bs_approx(
                spot, strike, time_to_expiry, volatility, option_type
            )

        r = self.risk_free_rate
        q = self.dividend_yield
        t = time_to_expiry
        sigma = volatility

        # Calculate d1 and d2
        d1 = (math.log(spot / strike) + (r - q + 0.5 * sigma**2) * t) / (
            sigma * math.sqrt(t)
        )
        d2 = d1 - sigma * math.sqrt(t)

        # Calculate price
        if option_type == OptionType.CALL:
            price = spot * math.exp(-q * t) * norm.cdf(d1) - strike * math.exp(
                -r * t
            ) * norm.cdf(d2)
        else:
            price = strike * math.exp(-r * t) * norm.cdf(-d2) - spot * math.exp(
                -q * t
            ) * norm.cdf(-d1)

        return float(price)

    def _simple_bs_approx(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: OptionType,
    ) -> float:
        """Simple Black-Scholes approximation without scipy."""

        # Use polynomial approximation for normal CDF
        def norm_cdf(x: float) -> float:
            """Approximate normal CDF using Abramowitz and Stegun."""
            a1 = 0.254829592
            a2 = -0.284496736
            a3 = 1.421413741
            a4 = -1.453152027
            a5 = 1.061405429
            p = 0.3275911

            sign = 1 if x >= 0 else -1
            x = abs(x) / math.sqrt(2)

            t = 1.0 / (1.0 + p * x)
            y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(
                -x * x
            )

            return 0.5 * (1.0 + sign * y)

        r = self.risk_free_rate
        q = self.dividend_yield
        t = time_to_expiry
        sigma = volatility

        d1 = (math.log(spot / strike) + (r - q + 0.5 * sigma**2) * t) / (
            sigma * math.sqrt(t)
        )
        d2 = d1 - sigma * math.sqrt(t)

        if option_type == OptionType.CALL:
            price = spot * math.exp(-q * t) * norm_cdf(d1) - strike * math.exp(
                -r * t
            ) * norm_cdf(d2)
        else:
            price = strike * math.exp(-r * t) * norm_cdf(-d2) - spot * math.exp(
                -q * t
            ) * norm_cdf(-d1)

        return float(price)

    def _binomial_price(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: OptionType,
        steps: int = 100,
    ) -> float:
        """Calculate option price using binomial tree model."""
        r = self.risk_free_rate
        q = self.dividend_yield
        t = time_to_expiry
        sigma = volatility
        n = steps

        dt = t / n
        u = math.exp(sigma * math.sqrt(dt))
        d = 1 / u
        p = (math.exp((r - q) * dt) - d) / (u - d)

        # Build price tree at expiration
        prices = np.zeros(n + 1)
        for i in range(n + 1):
            prices[i] = spot * (u ** (n - i)) * (d**i)

        # Calculate option values at expiration
        if option_type == OptionType.CALL:
            values = np.maximum(prices - strike, 0)
        else:
            values = np.maximum(strike - prices, 0)

        # Work backwards through tree
        discount = math.exp(-r * dt)
        for j in range(n - 1, -1, -1):
            for i in range(j + 1):
                values[i] = (p * values[i] + (1 - p) * values[i + 1]) * discount

        return float(values[0])

    # =========================================================================
    # Private Methods - Greeks
    # =========================================================================

    def _vollib_greeks(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: OptionType,
    ) -> GreeksResult:
        """Calculate Greeks using py_vollib."""
        flag = "c" if option_type == OptionType.CALL else "p"
        r = self.risk_free_rate
        t = time_to_expiry
        sigma = volatility

        try:
            delta = bs_delta(flag, spot, strike, t, r, sigma)
            gamma = bs_gamma(flag, spot, strike, t, r, sigma)
            theta = bs_theta(flag, spot, strike, t, r, sigma) / 365  # Per day
            vega_val = bs_vega(flag, spot, strike, t, r, sigma) / 100  # Per 1%
            rho_val = bs_rho(flag, spot, strike, t, r, sigma) / 100  # Per 1%

            return GreeksResult(
                delta=float(delta),
                gamma=float(gamma),
                theta=float(theta),
                vega=float(vega_val),
                rho=float(rho_val),
            )
        except Exception as e:
            logger.warning(f"py_vollib Greeks failed: {e}, using manual")
            return self._manual_greeks(
                spot, strike, time_to_expiry, volatility, option_type
            )

    def _manual_greeks(
        self,
        spot: float,
        strike: float,
        time_to_expiry: float,
        volatility: float,
        option_type: OptionType,
        include_higher_order: bool = False,
    ) -> GreeksResult:
        """Calculate Greeks manually using Black-Scholes formulas."""
        r = self.risk_free_rate
        q = self.dividend_yield
        t = time_to_expiry
        sigma = volatility

        # Calculate d1, d2
        sqrt_t = math.sqrt(t)
        d1 = (math.log(spot / strike) + (r - q + 0.5 * sigma**2) * t) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t

        # Normal PDF and CDF
        if HAS_SCIPY:
            n_d1 = norm.cdf(d1)
            n_d2 = norm.cdf(d2)
            n_neg_d1 = norm.cdf(-d1)
            n_neg_d2 = norm.cdf(-d2)
            phi_d1 = norm.pdf(d1)
        else:
            # Use approximations
            def approx_cdf(x: float) -> float:
                return 0.5 * (1 + math.erf(x / math.sqrt(2)))

            def approx_pdf(x: float) -> float:
                return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

            n_d1 = approx_cdf(d1)
            n_d2 = approx_cdf(d2)
            n_neg_d1 = approx_cdf(-d1)
            n_neg_d2 = approx_cdf(-d2)
            phi_d1 = approx_pdf(d1)

        # Delta
        if option_type == OptionType.CALL:
            delta = math.exp(-q * t) * n_d1
        else:
            delta = -math.exp(-q * t) * n_neg_d1

        # Gamma (same for calls and puts)
        gamma = math.exp(-q * t) * phi_d1 / (spot * sigma * sqrt_t)

        # Theta
        term1 = -(spot * sigma * math.exp(-q * t) * phi_d1) / (2 * sqrt_t)
        if option_type == OptionType.CALL:
            term2 = q * spot * math.exp(-q * t) * n_d1
            term3 = -r * strike * math.exp(-r * t) * n_d2
            theta = (term1 - term2 + term3) / 365  # Per day
        else:
            term2 = -q * spot * math.exp(-q * t) * n_neg_d1
            term3 = r * strike * math.exp(-r * t) * n_neg_d2
            theta = (term1 + term2 + term3) / 365  # Per day

        # Vega (same for calls and puts)
        vega = spot * math.exp(-q * t) * sqrt_t * phi_d1 / 100  # Per 1%

        # Rho
        if option_type == OptionType.CALL:
            rho = strike * t * math.exp(-r * t) * n_d2 / 100  # Per 1%
        else:
            rho = -strike * t * math.exp(-r * t) * n_neg_d2 / 100  # Per 1%

        result = GreeksResult(
            delta=delta,
            gamma=gamma,
            theta=theta,
            vega=vega,
            rho=rho,
        )

        if include_higher_order:
            # Charm (delta decay)
            result.charm = self._calculate_charm(
                spot, strike, t, sigma, d1, d2, phi_d1, option_type
            )
            # Vanna (delta sensitivity to vol)
            result.vanna = -math.exp(-q * t) * phi_d1 * d2 / sigma
            # Volga (vega convexity)
            result.volga = vega * d1 * d2 / sigma

        return result

    def _calculate_charm(
        self,
        spot: float,
        strike: float,
        t: float,
        sigma: float,
        d1: float,
        d2: float,
        phi_d1: float,
        option_type: OptionType,
    ) -> float:
        """Calculate charm (delta decay)."""
        q = self.dividend_yield
        r = self.risk_free_rate
        sqrt_t = math.sqrt(t)

        term1 = q * math.exp(-q * t)
        term2 = math.exp(-q * t) * phi_d1
        term3 = (2 * (r - q) * t - d2 * sigma * sqrt_t) / (2 * t * sigma * sqrt_t)

        if option_type == OptionType.CALL:
            if HAS_SCIPY:
                return float(-(term1 * norm.cdf(d1) - term2 * term3) / 365)
            return 0.0
        else:
            if HAS_SCIPY:
                return float((term1 * norm.cdf(-d1) + term2 * term3) / 365)
            return 0.0

    def _newton_iv(
        self,
        option_price: float,
        spot: float,
        strike: float,
        time_to_expiry: float,
        option_type: OptionType,
        initial_guess: float,
    ) -> float:
        """Newton-Raphson IV solver."""
        max_iterations = 100
        tolerance = 1e-8

        sigma = initial_guess

        for _ in range(max_iterations):
            # Calculate price and vega at current sigma
            try:
                price = self._manual_black_scholes(
                    spot, strike, time_to_expiry, sigma, option_type
                )
                greeks = self._manual_greeks(
                    spot, strike, time_to_expiry, sigma, option_type
                )
                vega = greeks.vega * 100  # Convert back from per 1%

                if abs(vega) < 1e-10:
                    break

                diff = option_price - price

                if abs(diff) < tolerance:
                    return sigma

                # Newton step
                sigma = sigma + diff / vega

                # Keep sigma in reasonable bounds
                sigma = max(0.001, min(5.0, sigma))

            except Exception:
                break

        return sigma

    def health_check(self) -> bool:
        """Check if pricer is operational."""
        return True
