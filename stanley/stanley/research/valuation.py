"""
Valuation Module

Provides valuation analysis including DCF, multiples comparison,
and relative valuation metrics for fundamental research.
"""

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class ValuationMetrics:
    """Key valuation metrics for a company."""

    symbol: str
    price: float
    market_cap: float
    enterprise_value: float

    # Earnings multiples
    pe_ratio: float
    forward_pe: float
    peg_ratio: float

    # Sales multiples
    price_to_sales: float
    ev_to_sales: float

    # Book value
    price_to_book: float
    price_to_tangible_book: float

    # Cash flow
    ev_to_ebitda: float
    price_to_fcf: float
    ev_to_fcf: float

    # Yield metrics
    earnings_yield: float
    fcf_yield: float
    dividend_yield: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "price": self.price,
            "marketCap": self.market_cap,
            "enterpriseValue": self.enterprise_value,
            "peRatio": self.pe_ratio,
            "forwardPe": self.forward_pe,
            "pegRatio": self.peg_ratio,
            "priceToSales": self.price_to_sales,
            "evToSales": self.ev_to_sales,
            "priceToBook": self.price_to_book,
            "priceToTangibleBook": self.price_to_tangible_book,
            "evToEbitda": self.ev_to_ebitda,
            "priceToFcf": self.price_to_fcf,
            "evToFcf": self.ev_to_fcf,
            "earningsYield": self.earnings_yield,
            "fcfYield": self.fcf_yield,
            "dividendYield": self.dividend_yield,
        }


@dataclass
class DCFResult:
    """Discounted Cash Flow valuation result."""

    symbol: str
    intrinsic_value: float
    current_price: float
    upside_percentage: float
    margin_of_safety: float

    # Assumptions
    discount_rate: float
    terminal_growth_rate: float
    projection_years: int

    # Value breakdown
    pv_cash_flows: float
    pv_terminal_value: float
    net_debt: float
    shares_outstanding: float

    # Sensitivity
    sensitivity_matrix: Optional[Dict[str, List[float]]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "intrinsicValue": self.intrinsic_value,
            "currentPrice": self.current_price,
            "upsidePercentage": self.upside_percentage,
            "marginOfSafety": self.margin_of_safety,
            "discountRate": self.discount_rate,
            "terminalGrowthRate": self.terminal_growth_rate,
            "projectionYears": self.projection_years,
            "pvCashFlows": self.pv_cash_flows,
            "pvTerminalValue": self.pv_terminal_value,
            "netDebt": self.net_debt,
            "sharesOutstanding": self.shares_outstanding,
            "sensitivityMatrix": self.sensitivity_matrix,
        }


def calculate_dcf(
    free_cash_flows: List[float],
    discount_rate: float = 0.10,
    terminal_growth_rate: float = 0.025,
    net_debt: float = 0,
    shares_outstanding: float = 1,
    current_price: float = 0,
    symbol: str = "",
) -> DCFResult:
    """
    Calculate intrinsic value using DCF model.

    Args:
        free_cash_flows: Projected FCF for each year
        discount_rate: WACC or required return
        terminal_growth_rate: Long-term growth rate
        net_debt: Net debt (debt - cash)
        shares_outstanding: Shares outstanding
        current_price: Current stock price
        symbol: Stock symbol

    Returns:
        DCFResult with intrinsic value and analysis
    """
    if not free_cash_flows or shares_outstanding <= 0:
        return DCFResult(
            symbol=symbol,
            intrinsic_value=0,
            current_price=current_price,
            upside_percentage=0,
            margin_of_safety=0,
            discount_rate=discount_rate,
            terminal_growth_rate=terminal_growth_rate,
            projection_years=len(free_cash_flows),
            pv_cash_flows=0,
            pv_terminal_value=0,
            net_debt=net_debt,
            shares_outstanding=shares_outstanding,
        )

    # Calculate PV of projected cash flows
    pv_cash_flows = 0
    for i, fcf in enumerate(free_cash_flows):
        pv_cash_flows += fcf / ((1 + discount_rate) ** (i + 1))

    # Terminal value (Gordon Growth Model)
    terminal_fcf = free_cash_flows[-1] * (1 + terminal_growth_rate)
    terminal_value = terminal_fcf / (discount_rate - terminal_growth_rate)

    # Discount terminal value
    pv_terminal = terminal_value / ((1 + discount_rate) ** len(free_cash_flows))

    # Enterprise value
    enterprise_value = pv_cash_flows + pv_terminal

    # Equity value
    equity_value = enterprise_value - net_debt

    # Intrinsic value per share
    intrinsic_value = max(0, equity_value / shares_outstanding)

    # Calculate upside and margin of safety
    if current_price > 0:
        upside = ((intrinsic_value / current_price) - 1) * 100
        margin_of_safety = max(0, upside)
    else:
        upside = 0
        margin_of_safety = 0

    return DCFResult(
        symbol=symbol,
        intrinsic_value=intrinsic_value,
        current_price=current_price,
        upside_percentage=upside,
        margin_of_safety=margin_of_safety,
        discount_rate=discount_rate,
        terminal_growth_rate=terminal_growth_rate,
        projection_years=len(free_cash_flows),
        pv_cash_flows=pv_cash_flows,
        pv_terminal_value=pv_terminal,
        net_debt=net_debt,
        shares_outstanding=shares_outstanding,
    )


def calculate_dcf_sensitivity(
    free_cash_flows: List[float],
    base_discount_rate: float = 0.10,
    base_terminal_growth: float = 0.025,
    net_debt: float = 0,
    shares_outstanding: float = 1,
) -> Dict[str, List[float]]:
    """
    Calculate DCF sensitivity matrix for different assumptions.

    Returns intrinsic values for various discount rate and growth rate combinations.
    """
    discount_rates = [
        base_discount_rate - 0.02,
        base_discount_rate - 0.01,
        base_discount_rate,
        base_discount_rate + 0.01,
        base_discount_rate + 0.02,
    ]

    growth_rates = [
        base_terminal_growth - 0.01,
        base_terminal_growth - 0.005,
        base_terminal_growth,
        base_terminal_growth + 0.005,
        base_terminal_growth + 0.01,
    ]

    matrix = {}
    for dr in discount_rates:
        row = []
        for gr in growth_rates:
            result = calculate_dcf(
                free_cash_flows=free_cash_flows,
                discount_rate=dr,
                terminal_growth_rate=gr,
                net_debt=net_debt,
                shares_outstanding=shares_outstanding,
            )
            row.append(round(result.intrinsic_value, 2))
        matrix[f"dr_{int(dr * 100)}"] = row

    matrix["growth_rates"] = [round(g * 100, 1) for g in growth_rates]
    matrix["discount_rates"] = [round(d * 100, 1) for d in discount_rates]

    return matrix


def calculate_valuation_multiples(
    price: float,
    shares_outstanding: float,
    earnings: float,
    forward_earnings: float,
    revenue: float,
    book_value: float,
    tangible_book_value: float,
    ebitda: float,
    free_cash_flow: float,
    total_debt: float,
    cash: float,
    dividends_per_share: float,
    earnings_growth_rate: float = 0,
    symbol: str = "",
) -> ValuationMetrics:
    """
    Calculate comprehensive valuation multiples.

    Args:
        price: Current stock price
        shares_outstanding: Shares outstanding
        earnings: Net income (annual)
        forward_earnings: Forward year earnings estimate
        revenue: Total revenue (annual)
        book_value: Total equity
        tangible_book_value: Equity minus intangibles
        ebitda: EBITDA
        free_cash_flow: Free cash flow
        total_debt: Total debt
        cash: Cash and equivalents
        dividends_per_share: Annual dividend per share
        earnings_growth_rate: Expected earnings growth rate
        symbol: Stock symbol

    Returns:
        ValuationMetrics with all multiples
    """
    market_cap = price * shares_outstanding
    enterprise_value = market_cap + total_debt - cash

    # Calculate EPS
    eps = earnings / shares_outstanding if shares_outstanding > 0 else 0
    forward_eps = forward_earnings / shares_outstanding if shares_outstanding > 0 else 0

    # P/E ratios
    pe_ratio = price / eps if eps > 0 else float("inf")
    forward_pe = price / forward_eps if forward_eps > 0 else float("inf")

    # PEG ratio
    if earnings_growth_rate > 0 and pe_ratio < float("inf"):
        peg_ratio = pe_ratio / (earnings_growth_rate * 100)
    else:
        peg_ratio = float("inf")

    # Price to sales
    sales_per_share = revenue / shares_outstanding if shares_outstanding > 0 else 0
    price_to_sales = price / sales_per_share if sales_per_share > 0 else float("inf")
    ev_to_sales = enterprise_value / revenue if revenue > 0 else float("inf")

    # Book value ratios
    book_per_share = book_value / shares_outstanding if shares_outstanding > 0 else 0
    tangible_book_per_share = (
        tangible_book_value / shares_outstanding if shares_outstanding > 0 else 0
    )
    price_to_book = price / book_per_share if book_per_share > 0 else float("inf")
    price_to_tangible_book = (
        price / tangible_book_per_share if tangible_book_per_share > 0 else float("inf")
    )

    # EV multiples
    ev_to_ebitda = enterprise_value / ebitda if ebitda > 0 else float("inf")

    # FCF ratios
    fcf_per_share = free_cash_flow / shares_outstanding if shares_outstanding > 0 else 0
    price_to_fcf = price / fcf_per_share if fcf_per_share > 0 else float("inf")
    ev_to_fcf = (
        enterprise_value / free_cash_flow if free_cash_flow > 0 else float("inf")
    )

    # Yields
    earnings_yield = (eps / price) * 100 if price > 0 else 0
    fcf_yield = (fcf_per_share / price) * 100 if price > 0 else 0
    dividend_yield = (dividends_per_share / price) * 100 if price > 0 else 0

    return ValuationMetrics(
        symbol=symbol,
        price=price,
        market_cap=market_cap,
        enterprise_value=enterprise_value,
        pe_ratio=pe_ratio if pe_ratio < 1000 else float("inf"),
        forward_pe=forward_pe if forward_pe < 1000 else float("inf"),
        peg_ratio=peg_ratio if peg_ratio < 100 else float("inf"),
        price_to_sales=price_to_sales if price_to_sales < 1000 else float("inf"),
        ev_to_sales=ev_to_sales if ev_to_sales < 1000 else float("inf"),
        price_to_book=price_to_book if price_to_book < 1000 else float("inf"),
        price_to_tangible_book=(
            price_to_tangible_book if price_to_tangible_book < 1000 else float("inf")
        ),
        ev_to_ebitda=ev_to_ebitda if ev_to_ebitda < 1000 else float("inf"),
        price_to_fcf=price_to_fcf if price_to_fcf < 1000 else float("inf"),
        ev_to_fcf=ev_to_fcf if ev_to_fcf < 1000 else float("inf"),
        earnings_yield=earnings_yield,
        fcf_yield=fcf_yield,
        dividend_yield=dividend_yield,
    )


def compare_to_peers(
    target: ValuationMetrics,
    peers: List[ValuationMetrics],
) -> Dict[str, Any]:
    """
    Compare target company valuation to peer group.

    Returns:
        Dict with relative valuation analysis
    """
    if not peers:
        return {"target": target.to_dict(), "peers": [], "premium_discount": {}}

    # Calculate peer averages for key metrics
    metrics = [
        "pe_ratio",
        "forward_pe",
        "ev_to_ebitda",
        "price_to_sales",
        "price_to_book",
    ]

    peer_averages = {}
    for metric in metrics:
        values = [
            getattr(p, metric) for p in peers if getattr(p, metric) < float("inf")
        ]
        if values:
            peer_averages[metric] = np.mean(values)
        else:
            peer_averages[metric] = None

    # Calculate premium/discount
    premium_discount = {}
    for metric in metrics:
        target_val = getattr(target, metric)
        peer_avg = peer_averages.get(metric)

        if peer_avg and target_val < float("inf") and peer_avg > 0:
            premium = ((target_val / peer_avg) - 1) * 100
            premium_discount[metric] = round(premium, 2)
        else:
            premium_discount[metric] = None

    return {
        "target": target.to_dict(),
        "peerAverages": {
            k: round(v, 2) if v else None for k, v in peer_averages.items()
        },
        "premiumDiscount": premium_discount,
        "peers": [p.to_dict() for p in peers],
    }


def estimate_fair_value_range(
    valuation: ValuationMetrics,
    peer_averages: Dict[str, float],
    industry_averages: Optional[Dict[str, float]] = None,
) -> Dict[str, float]:
    """
    Estimate fair value range using multiple valuation methods.

    Returns:
        Dict with low, mid, high fair value estimates
    """
    values = []

    # Method 1: P/E based
    if "pe_ratio" in peer_averages and peer_averages["pe_ratio"]:
        eps = (
            valuation.price / valuation.pe_ratio
            if valuation.pe_ratio < float("inf")
            else 0
        )
        if eps > 0:
            pe_value = eps * peer_averages["pe_ratio"]
            values.append(("P/E", pe_value))

    # Method 2: EV/EBITDA based
    if "ev_to_ebitda" in peer_averages and peer_averages["ev_to_ebitda"]:
        if valuation.ev_to_ebitda < float("inf") and valuation.ev_to_ebitda > 0:
            ebitda = valuation.enterprise_value / valuation.ev_to_ebitda
            ev = ebitda * peer_averages["ev_to_ebitda"]
            # Convert EV to equity value (simplified)
            equity_value = ev - (valuation.enterprise_value - valuation.market_cap)
            shares = (
                valuation.market_cap / valuation.price if valuation.price > 0 else 1
            )
            ebitda_value = equity_value / shares
            if ebitda_value > 0:
                values.append(("EV/EBITDA", ebitda_value))

    # Method 3: P/S based
    if "price_to_sales" in peer_averages and peer_averages["price_to_sales"]:
        if valuation.price_to_sales < float("inf") and valuation.price_to_sales > 0:
            sales_per_share = valuation.price / valuation.price_to_sales
            ps_value = sales_per_share * peer_averages["price_to_sales"]
            if ps_value > 0:
                values.append(("P/S", ps_value))

    if not values:
        return {
            "low": valuation.price * 0.8,
            "mid": valuation.price,
            "high": valuation.price * 1.2,
            "methods": [],
        }

    all_values = [v[1] for v in values]

    return {
        "low": round(min(all_values), 2),
        "mid": round(np.mean(all_values), 2),
        "high": round(max(all_values), 2),
        "methods": [{"method": v[0], "value": round(v[1], 2)} for v in values],
        "currentPrice": valuation.price,
    }
