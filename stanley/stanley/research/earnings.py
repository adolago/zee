"""
Earnings Analysis Module

Analyze earnings trends, surprises, revisions, and quality
for fundamental research.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class EarningsQuarter:
    """Earnings data for a single quarter."""

    fiscal_quarter: str  # e.g., "Q1 2024"
    fiscal_year: int
    fiscal_period: int  # 1-4

    # Actual results
    eps_actual: float
    revenue_actual: float
    report_date: Optional[datetime] = None

    # Estimates
    eps_estimate: float = 0
    revenue_estimate: float = 0

    # Surprise
    eps_surprise: float = 0
    eps_surprise_percent: float = 0
    revenue_surprise: float = 0
    revenue_surprise_percent: float = 0

    # Guidance
    next_quarter_eps_guidance_low: Optional[float] = None
    next_quarter_eps_guidance_high: Optional[float] = None
    full_year_eps_guidance_low: Optional[float] = None
    full_year_eps_guidance_high: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "fiscalQuarter": self.fiscal_quarter,
            "fiscalYear": self.fiscal_year,
            "fiscalPeriod": self.fiscal_period,
            "epsActual": self.eps_actual,
            "revenueActual": self.revenue_actual,
            "reportDate": self.report_date.isoformat() if self.report_date else None,
            "epsEstimate": self.eps_estimate,
            "revenueEstimate": self.revenue_estimate,
            "epsSurprise": self.eps_surprise,
            "epsSurprisePercent": self.eps_surprise_percent,
            "revenueSurprise": self.revenue_surprise,
            "revenueSurprisePercent": self.revenue_surprise_percent,
            "nextQuarterGuidance": (
                {
                    "low": self.next_quarter_eps_guidance_low,
                    "high": self.next_quarter_eps_guidance_high,
                }
                if self.next_quarter_eps_guidance_low
                else None
            ),
            "fullYearGuidance": (
                {
                    "low": self.full_year_eps_guidance_low,
                    "high": self.full_year_eps_guidance_high,
                }
                if self.full_year_eps_guidance_low
                else None
            ),
        }


@dataclass
class EarningsAnalysis:
    """Comprehensive earnings analysis for a company."""

    symbol: str

    # Historical earnings
    quarters: List[EarningsQuarter] = field(default_factory=list)

    # Trend metrics
    eps_growth_yoy: float = 0  # Year-over-year EPS growth
    eps_growth_3yr_cagr: float = 0  # 3-year CAGR
    revenue_growth_yoy: float = 0
    revenue_growth_3yr_cagr: float = 0

    # Surprise metrics
    avg_eps_surprise_percent: float = 0
    beat_rate: float = 0  # % of quarters beating estimates
    consecutive_beats: int = 0

    # Quality metrics
    earnings_volatility: float = 0
    earnings_consistency: float = 0  # R-squared of earnings trend
    accruals_ratio: float = 0  # Earnings quality indicator

    # Estimates
    next_quarter_eps_estimate: float = 0
    next_year_eps_estimate: float = 0
    analyst_count: int = 0
    estimate_dispersion: float = 0  # Standard deviation of estimates

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "quarters": [q.to_dict() for q in self.quarters],
            "epsGrowthYoy": self.eps_growth_yoy,
            "epsGrowth3yrCagr": self.eps_growth_3yr_cagr,
            "revenueGrowthYoy": self.revenue_growth_yoy,
            "revenueGrowth3yrCagr": self.revenue_growth_3yr_cagr,
            "avgEpsSurprisePercent": self.avg_eps_surprise_percent,
            "beatRate": self.beat_rate,
            "consecutiveBeats": self.consecutive_beats,
            "earningsVolatility": self.earnings_volatility,
            "earningsConsistency": self.earnings_consistency,
            "accruals_ratio": self.accruals_ratio,
            "nextQuarterEpsEstimate": self.next_quarter_eps_estimate,
            "nextYearEpsEstimate": self.next_year_eps_estimate,
            "analystCount": self.analyst_count,
            "estimateDispersion": self.estimate_dispersion,
        }


@dataclass
class EstimateRevision:
    """Track estimate revisions over time."""

    symbol: str
    period: str  # "next_quarter", "next_year"

    current_estimate: float
    estimate_30d_ago: float
    estimate_60d_ago: float
    estimate_90d_ago: float

    revision_30d: float = 0
    revision_60d: float = 0
    revision_90d: float = 0

    revision_trend: str = "stable"  # "up", "down", "stable"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "period": self.period,
            "currentEstimate": self.current_estimate,
            "revision30d": self.revision_30d,
            "revision60d": self.revision_60d,
            "revision90d": self.revision_90d,
            "revisionTrend": self.revision_trend,
        }


def calculate_earnings_surprise(
    actual: float,
    estimate: float,
) -> tuple[float, float]:
    """
    Calculate earnings surprise in dollars and percentage.

    Returns:
        Tuple of (surprise_amount, surprise_percent)
    """
    surprise = actual - estimate
    if estimate != 0:
        surprise_percent = (surprise / abs(estimate)) * 100
    else:
        surprise_percent = 0 if actual == 0 else 100 * np.sign(actual)

    return surprise, surprise_percent


def calculate_growth_rate(
    current: float,
    previous: float,
) -> float:
    """Calculate growth rate between two values."""
    if previous == 0:
        return 0 if current == 0 else 100 * np.sign(current)
    return ((current / previous) - 1) * 100


def calculate_cagr(
    start_value: float,
    end_value: float,
    years: float,
) -> float:
    """Calculate Compound Annual Growth Rate."""
    if start_value <= 0 or years <= 0:
        return 0
    if end_value <= 0:
        return -100  # Complete loss

    return ((end_value / start_value) ** (1 / years) - 1) * 100


def analyze_earnings_quality(
    net_income: float,
    operating_cash_flow: float,
    total_assets: float,
) -> Dict[str, float]:
    """
    Analyze earnings quality using accruals and cash flow metrics.

    Returns:
        Dict with quality metrics
    """
    # Accruals = Net Income - Operating Cash Flow
    accruals = net_income - operating_cash_flow

    # Accruals ratio (lower is better - more cash-backed earnings)
    if total_assets > 0:
        accruals_ratio = accruals / total_assets
    else:
        accruals_ratio = 0

    # Cash conversion (higher is better)
    if net_income > 0:
        cash_conversion = operating_cash_flow / net_income
    else:
        cash_conversion = 0

    # Quality score (0-100)
    # High cash conversion + low accruals = high quality
    quality_score = min(
        100, max(0, 50 + (cash_conversion - 1) * 25 - accruals_ratio * 100)
    )

    return {
        "accruals": accruals,
        "accruals_ratio": accruals_ratio,
        "cash_conversion": cash_conversion,
        "quality_score": quality_score,
    }


def calculate_earnings_consistency(
    eps_history: List[float],
) -> Dict[str, float]:
    """
    Calculate earnings consistency and trend metrics.

    Returns:
        Dict with consistency metrics
    """
    if len(eps_history) < 4:
        return {
            "volatility": 0,
            "consistency": 0,
            "trend_slope": 0,
            "positive_quarters_pct": 0,
        }

    eps_array = np.array(eps_history)

    # Volatility (coefficient of variation)
    mean_eps = np.mean(eps_array)
    if mean_eps != 0:
        volatility = np.std(eps_array) / abs(mean_eps)
    else:
        volatility = np.std(eps_array)

    # Trend consistency (R-squared of linear fit)
    x = np.arange(len(eps_array))
    if len(eps_array) > 1:
        correlation = np.corrcoef(x, eps_array)[0, 1]
        consistency = correlation**2 if not np.isnan(correlation) else 0
    else:
        consistency = 0

    # Trend slope
    if len(eps_array) > 1:
        slope = np.polyfit(x, eps_array, 1)[0]
    else:
        slope = 0

    # Positive quarters percentage
    positive_pct = np.sum(eps_array > 0) / len(eps_array) * 100

    return {
        "volatility": volatility,
        "consistency": consistency,
        "trend_slope": slope,
        "positive_quarters_pct": positive_pct,
    }


def calculate_beat_rate(
    quarters: List[EarningsQuarter],
) -> Dict[str, Any]:
    """
    Calculate earnings beat rate and streak.

    Returns:
        Dict with beat metrics
    """
    if not quarters:
        return {
            "beat_rate": 0,
            "miss_rate": 0,
            "meet_rate": 0,
            "consecutive_beats": 0,
            "consecutive_misses": 0,
        }

    beats = 0
    misses = 0
    meets = 0

    for q in quarters:
        if q.eps_surprise_percent > 1:  # Beat by more than 1%
            beats += 1
        elif q.eps_surprise_percent < -1:  # Miss by more than 1%
            misses += 1
        else:
            meets += 1

    total = len(quarters)

    # Calculate current streak
    consecutive_beats = 0
    consecutive_misses = 0

    for q in sorted(
        quarters, key=lambda x: (x.fiscal_year, x.fiscal_period), reverse=True
    ):
        if q.eps_surprise_percent > 0:
            if consecutive_misses == 0:
                consecutive_beats += 1
            else:
                break
        else:
            if consecutive_beats == 0:
                consecutive_misses += 1
            else:
                break

    return {
        "beat_rate": (beats / total) * 100 if total > 0 else 0,
        "miss_rate": (misses / total) * 100 if total > 0 else 0,
        "meet_rate": (meets / total) * 100 if total > 0 else 0,
        "consecutive_beats": consecutive_beats,
        "consecutive_misses": consecutive_misses,
        "total_quarters": total,
    }


def analyze_estimate_revisions(
    current_estimate: float,
    historical_estimates: List[tuple[datetime, float]],
) -> EstimateRevision:
    """
    Analyze estimate revision trends.

    Args:
        current_estimate: Current consensus estimate
        historical_estimates: List of (date, estimate) tuples

    Returns:
        EstimateRevision with trend analysis
    """
    if not historical_estimates:
        return EstimateRevision(
            symbol="",
            period="",
            current_estimate=current_estimate,
            estimate_30d_ago=current_estimate,
            estimate_60d_ago=current_estimate,
            estimate_90d_ago=current_estimate,
        )

    now = datetime.now()
    df = pd.DataFrame(historical_estimates, columns=["date", "estimate"])
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")

    def get_estimate_at_days_ago(days: int) -> float:
        target_date = now - pd.Timedelta(days=days)
        past_estimates = df[df["date"] <= target_date]
        if past_estimates.empty:
            return df.iloc[0]["estimate"] if not df.empty else current_estimate
        return past_estimates.iloc[-1]["estimate"]

    est_30d = get_estimate_at_days_ago(30)
    est_60d = get_estimate_at_days_ago(60)
    est_90d = get_estimate_at_days_ago(90)

    # Calculate revisions
    rev_30d = calculate_growth_rate(current_estimate, est_30d)
    rev_60d = calculate_growth_rate(current_estimate, est_60d)
    rev_90d = calculate_growth_rate(current_estimate, est_90d)

    # Determine trend
    if rev_30d > 2 and rev_60d > 2:
        trend = "up"
    elif rev_30d < -2 and rev_60d < -2:
        trend = "down"
    else:
        trend = "stable"

    return EstimateRevision(
        symbol="",
        period="",
        current_estimate=current_estimate,
        estimate_30d_ago=est_30d,
        estimate_60d_ago=est_60d,
        estimate_90d_ago=est_90d,
        revision_30d=rev_30d,
        revision_60d=rev_60d,
        revision_90d=rev_90d,
        revision_trend=trend,
    )


def project_future_earnings(
    historical_eps: List[float],
    growth_rate: Optional[float] = None,
    quarters_ahead: int = 4,
) -> List[float]:
    """
    Project future earnings based on historical data.

    Args:
        historical_eps: List of historical EPS values
        growth_rate: Optional explicit growth rate to use
        quarters_ahead: Number of quarters to project

    Returns:
        List of projected EPS values
    """
    if not historical_eps:
        return [0] * quarters_ahead

    if growth_rate is None:
        # Calculate historical growth rate
        if len(historical_eps) >= 4:
            yoy_growth = calculate_growth_rate(historical_eps[-1], historical_eps[-4])
            growth_rate = yoy_growth / 100 / 4  # Quarterly growth
        else:
            growth_rate = 0.02  # Default 2% quarterly

    # Project forward
    projections = []
    last_eps = historical_eps[-1]

    for i in range(quarters_ahead):
        projected = last_eps * (1 + growth_rate)
        projections.append(projected)
        last_eps = projected

    return projections
