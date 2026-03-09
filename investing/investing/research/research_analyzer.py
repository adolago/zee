"""
Research Analyzer Module

High-level fundamental research combining valuation, earnings,
and accounting analysis for comprehensive company research.
"""

import logging
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np


# Mock classes for news_digest fallback
class MockNewsArticle:
    def __init__(
        self,
        ticker="UNKNOWN",
        title="News service unavailable",
        url="",
        source="System",
        category="general",
        sentiment="neutral",
        impact="low",
    ):
        self.ticker = ticker
        self.title = title
        self.url = url
        self.source = source
        self.category = category
        self.sentiment = sentiment
        self.impact = impact

    def to_dict(self):
        return {
            "ticker": self.ticker,
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "category": self.category,
            "sentiment": self.sentiment,
            "impact": self.impact,
        }


class MockDigest:
    def __init__(self, tickers, range_str="24h"):
        import datetime

        self.articles = []
        self.tickers = tickers
        self.range = range_str
        self.generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def to_dict(self):
        return {
            "generatedAt": self.generated_at,
            "tickers": self.tickers,
            "range": self.range,
            "articles": [],
            "summary": {"totalArticles": 0, "bySentiment": {}, "byTicker": {}},
        }


async def mock_generate_digest(tickers, range_str="24h", *args, **kwargs):
    """Mock digest generator when service is unavailable."""
    return MockDigest(tickers, range_str)


from .earnings import (
    EarningsAnalysis,
    EarningsQuarter,
    EstimateRevision,
    analyze_earnings_quality,
    calculate_beat_rate,
    calculate_cagr,
    calculate_earnings_consistency,
    calculate_earnings_surprise,
    calculate_growth_rate,
)
from .valuation import (
    DCFResult,
    ValuationMetrics,
    calculate_dcf,
    calculate_dcf_sensitivity,
    calculate_valuation_multiples,
    compare_to_peers,
    estimate_fair_value_range,
)

logger = logging.getLogger(__name__)


@dataclass
class ResearchReport:
    """Comprehensive research report for a company."""

    symbol: str
    company_name: str
    sector: str
    industry: str

    # Current status
    current_price: float
    market_cap: float

    # Valuation
    valuation: ValuationMetrics
    dcf: Optional[DCFResult]
    fair_value_range: Dict[str, float]
    valuation_rating: str  # "undervalued", "fairly_valued", "overvalued"

    # Earnings
    earnings: EarningsAnalysis
    estimate_revisions: Optional[EstimateRevision]
    earnings_quality_score: float

    # Growth
    revenue_growth_5yr: float
    eps_growth_5yr: float
    projected_growth: float

    # Profitability
    gross_margin: float
    operating_margin: float
    net_margin: float
    roe: float
    roic: float

    # Financial health
    debt_to_equity: float
    current_ratio: float
    interest_coverage: float

    # Overall assessment
    overall_score: float  # 0-100
    strengths: List[str]
    weaknesses: List[str]
    catalysts: List[str]
    risks: List[str]

    # Recent news
    recent_news: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "symbol": self.symbol,
            "companyName": self.company_name,
            "sector": self.sector,
            "industry": self.industry,
            "currentPrice": self.current_price,
            "marketCap": self.market_cap,
            "valuation": self.valuation.to_dict() if self.valuation else None,
            "dcf": self.dcf.to_dict() if self.dcf else None,
            "fairValueRange": self.fair_value_range,
            "valuationRating": self.valuation_rating,
            "earnings": self.earnings.to_dict() if self.earnings else None,
            "estimateRevisions": (
                self.estimate_revisions.to_dict() if self.estimate_revisions else None
            ),
            "earningsQualityScore": self.earnings_quality_score,
            "revenueGrowth5yr": self.revenue_growth_5yr,
            "epsGrowth5yr": self.eps_growth_5yr,
            "projectedGrowth": self.projected_growth,
            "grossMargin": self.gross_margin,
            "operatingMargin": self.operating_margin,
            "netMargin": self.net_margin,
            "roe": self.roe,
            "roic": self.roic,
            "debtToEquity": self.debt_to_equity,
            "currentRatio": self.current_ratio,
            "interestCoverage": self.interest_coverage,
            "overallScore": self.overall_score,
            "strengths": self.strengths,
            "weaknesses": self.weaknesses,
            "catalysts": self.catalysts,
            "risks": self.risks,
            "recentNews": self.recent_news,
        }


class ResearchAnalyzer:
    """
    Comprehensive fundamental research analyzer.

    Combines valuation, earnings, and financial analysis
    for thorough company research.
    """

    def __init__(self, data_manager=None, accounting_analyzer=None):
        """
        Initialize research analyzer.

        Args:
            data_manager: DataManager instance for data access
            accounting_analyzer: AccountingAnalyzer for financial statement data
        """
        self.data_manager = data_manager
        self.accounting_analyzer = accounting_analyzer
        logger.info("ResearchAnalyzer initialized")

    async def get_valuation(
        self,
        symbol: str,
        include_dcf: bool = True,
    ) -> Dict[str, Any]:
        """
        Get comprehensive valuation analysis.

        Args:
            symbol: Stock symbol
            include_dcf: Whether to include DCF analysis

        Returns:
            Dict with valuation analysis
        """
        # Fetch financial data
        financials = await self._get_financials(symbol)

        # Calculate valuation multiples
        valuation = calculate_valuation_multiples(
            price=financials.get("price", 0),
            shares_outstanding=financials.get("shares_outstanding", 1),
            earnings=financials.get("net_income", 0),
            forward_earnings=financials.get("forward_earnings", 0),
            revenue=financials.get("revenue", 0),
            book_value=financials.get("book_value", 0),
            tangible_book_value=financials.get("tangible_book_value", 0),
            ebitda=financials.get("ebitda", 0),
            free_cash_flow=financials.get("free_cash_flow", 0),
            total_debt=financials.get("total_debt", 0),
            cash=financials.get("cash", 0),
            dividends_per_share=financials.get("dividends_per_share", 0),
            earnings_growth_rate=financials.get("earnings_growth_rate", 0),
            symbol=symbol,
        )

        result = {"valuation": valuation.to_dict()}

        # DCF analysis
        if include_dcf:
            fcf_projections = await self._project_fcf(symbol, financials)
            dcf = calculate_dcf(
                free_cash_flows=fcf_projections,
                discount_rate=financials.get("wacc", 0.10),
                terminal_growth_rate=0.025,
                net_debt=financials.get("total_debt", 0) - financials.get("cash", 0),
                shares_outstanding=financials.get("shares_outstanding", 1),
                current_price=financials.get("price", 0),
                symbol=symbol,
            )
            result["dcf"] = dcf.to_dict()

            # Sensitivity analysis
            sensitivity = calculate_dcf_sensitivity(
                free_cash_flows=fcf_projections,
                base_discount_rate=financials.get("wacc", 0.10),
                net_debt=financials.get("total_debt", 0) - financials.get("cash", 0),
                shares_outstanding=financials.get("shares_outstanding", 1),
            )
            result["sensitivity"] = sensitivity

        return result

    async def analyze_earnings(
        self,
        symbol: str,
        quarters: int = 12,
    ) -> EarningsAnalysis:
        """
        Analyze earnings history and trends.

        Args:
            symbol: Stock symbol
            quarters: Number of quarters to analyze

        Returns:
            EarningsAnalysis with comprehensive metrics
        """
        # Fetch earnings history
        earnings_data = await self._get_earnings_history(symbol, quarters)

        if not earnings_data:
            return EarningsAnalysis(symbol=symbol)

        # Create quarter objects
        quarter_objects = []
        for q in earnings_data:
            surprise, surprise_pct = calculate_earnings_surprise(
                q.get("eps_actual", 0),
                q.get("eps_estimate", 0),
            )
            rev_surprise, rev_surprise_pct = calculate_earnings_surprise(
                q.get("revenue_actual", 0),
                q.get("revenue_estimate", 0),
            )

            quarter_objects.append(
                EarningsQuarter(
                    fiscal_quarter=q.get("fiscal_quarter", ""),
                    fiscal_year=q.get("fiscal_year", 0),
                    fiscal_period=q.get("fiscal_period", 0),
                    eps_actual=q.get("eps_actual", 0),
                    revenue_actual=q.get("revenue_actual", 0),
                    eps_estimate=q.get("eps_estimate", 0),
                    revenue_estimate=q.get("revenue_estimate", 0),
                    eps_surprise=surprise,
                    eps_surprise_percent=surprise_pct,
                    revenue_surprise=rev_surprise,
                    revenue_surprise_percent=rev_surprise_pct,
                )
            )

        # Calculate growth rates
        eps_history = [q.eps_actual for q in quarter_objects]

        if len(eps_history) >= 4:
            eps_growth_yoy = calculate_growth_rate(
                eps_history[0],
                eps_history[4] if len(eps_history) > 4 else eps_history[-1],
            )
        else:
            eps_growth_yoy = 0

        if len(eps_history) >= 12:
            eps_growth_3yr = calculate_cagr(eps_history[-1], eps_history[0], 3)
        else:
            eps_growth_3yr = 0

        # Beat rate
        beat_metrics = calculate_beat_rate(quarter_objects)

        # Consistency
        consistency_metrics = calculate_earnings_consistency(eps_history)

        return EarningsAnalysis(
            symbol=symbol,
            quarters=quarter_objects,
            eps_growth_yoy=eps_growth_yoy,
            eps_growth_3yr_cagr=eps_growth_3yr,
            avg_eps_surprise_percent=(
                np.mean([q.eps_surprise_percent for q in quarter_objects])
                if quarter_objects
                else 0
            ),
            beat_rate=beat_metrics["beat_rate"],
            consecutive_beats=beat_metrics["consecutive_beats"],
            earnings_volatility=consistency_metrics["volatility"],
            earnings_consistency=consistency_metrics["consistency"],
        )

    async def get_peer_comparison(
        self,
        symbol: str,
        peers: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Compare company valuation to peers.

        Args:
            symbol: Stock symbol
            peers: List of peer symbols (auto-detected if not provided)

        Returns:
            Dict with peer comparison analysis
        """
        if not peers:
            peers = await self._get_peers(symbol)

        # Get target valuation
        target_data = await self._get_financials(symbol)
        target_valuation = calculate_valuation_multiples(
            price=target_data.get("price", 0),
            shares_outstanding=target_data.get("shares_outstanding", 1),
            earnings=target_data.get("net_income", 0),
            forward_earnings=target_data.get("forward_earnings", 0),
            revenue=target_data.get("revenue", 0),
            book_value=target_data.get("book_value", 0),
            tangible_book_value=target_data.get("tangible_book_value", 0),
            ebitda=target_data.get("ebitda", 0),
            free_cash_flow=target_data.get("free_cash_flow", 0),
            total_debt=target_data.get("total_debt", 0),
            cash=target_data.get("cash", 0),
            dividends_per_share=target_data.get("dividends_per_share", 0),
            symbol=symbol,
        )

        # Get peer valuations
        peer_valuations = []
        for peer in peers:
            try:
                peer_data = await self._get_financials(peer)
                peer_valuation = calculate_valuation_multiples(
                    price=peer_data.get("price", 0),
                    shares_outstanding=peer_data.get("shares_outstanding", 1),
                    earnings=peer_data.get("net_income", 0),
                    forward_earnings=peer_data.get("forward_earnings", 0),
                    revenue=peer_data.get("revenue", 0),
                    book_value=peer_data.get("book_value", 0),
                    tangible_book_value=peer_data.get("tangible_book_value", 0),
                    ebitda=peer_data.get("ebitda", 0),
                    free_cash_flow=peer_data.get("free_cash_flow", 0),
                    total_debt=peer_data.get("total_debt", 0),
                    cash=peer_data.get("cash", 0),
                    dividends_per_share=peer_data.get("dividends_per_share", 0),
                    symbol=peer,
                )
                peer_valuations.append(peer_valuation)
            except Exception as e:
                logger.warning(f"Failed to get peer data for {peer}: {e}")

        comparison = compare_to_peers(target_valuation, peer_valuations)

        # Estimate fair value
        if comparison.get("peerAverages"):
            fair_value = estimate_fair_value_range(
                target_valuation,
                {k: v for k, v in comparison["peerAverages"].items() if v is not None},
            )
            comparison["fairValueRange"] = fair_value

        return comparison

    async def generate_report(
        self,
        symbol: str,
        include_news: bool = True,
    ) -> ResearchReport:
        """
        Generate comprehensive research report.

        Args:
            symbol: Stock symbol
            include_news: Whether to include recent news (default: True)

        Returns:
            ResearchReport with full analysis
        """
        # Fetch all data
        financials = await self._get_financials(symbol)
        valuation_result = await self.get_valuation(symbol)
        earnings = await self.analyze_earnings(symbol)

        # Fetch recent news
        recent_news = []
        if include_news:
            recent_news = await self._get_recent_news(symbol)

        valuation = valuation_result.get("valuation", {})
        dcf = valuation_result.get("dcf")

        # Determine valuation rating
        if dcf:
            upside = dcf.get("upsidePercentage", 0)
            if upside > 20:
                valuation_rating = "undervalued"
            elif upside < -20:
                valuation_rating = "overvalued"
            else:
                valuation_rating = "fairly_valued"
        else:
            valuation_rating = "fairly_valued"

        # Fair value range
        fair_value_range = {
            "low": financials.get("price", 0) * 0.8,
            "mid": financials.get("price", 0),
            "high": financials.get("price", 0) * 1.2,
        }

        # Earnings quality
        quality = analyze_earnings_quality(
            net_income=financials.get("net_income", 0),
            operating_cash_flow=financials.get("operating_cash_flow", 0),
            total_assets=financials.get("total_assets", 1),
        )

        # Identify strengths and weaknesses
        strengths, weaknesses = self._analyze_strengths_weaknesses(financials, earnings)

        # Calculate overall score
        overall_score = self._calculate_overall_score(
            financials, earnings, quality["quality_score"], valuation_rating
        )

        # Create ValuationMetrics object from dict
        valuation_metrics = ValuationMetrics(
            symbol=symbol,
            price=valuation.get("price", 0),
            market_cap=valuation.get("marketCap", 0),
            enterprise_value=valuation.get("enterpriseValue", 0),
            pe_ratio=valuation.get("peRatio", float("inf")),
            forward_pe=valuation.get("forwardPe", float("inf")),
            peg_ratio=valuation.get("pegRatio", float("inf")),
            price_to_sales=valuation.get("priceToSales", float("inf")),
            ev_to_sales=valuation.get("evToSales", float("inf")),
            price_to_book=valuation.get("priceToBook", float("inf")),
            price_to_tangible_book=valuation.get("priceToTangibleBook", float("inf")),
            ev_to_ebitda=valuation.get("evToEbitda", float("inf")),
            price_to_fcf=valuation.get("priceToFcf", float("inf")),
            ev_to_fcf=valuation.get("evToFcf", float("inf")),
            earnings_yield=valuation.get("earningsYield", 0),
            fcf_yield=valuation.get("fcfYield", 0),
            dividend_yield=valuation.get("dividendYield", 0),
        )

        # Create DCFResult if available
        dcf_result = None
        if dcf:
            dcf_result = DCFResult(
                symbol=symbol,
                intrinsic_value=dcf.get("intrinsicValue", 0),
                current_price=dcf.get("currentPrice", 0),
                upside_percentage=dcf.get("upsidePercentage", 0),
                margin_of_safety=dcf.get("marginOfSafety", 0),
                discount_rate=dcf.get("discountRate", 0.10),
                terminal_growth_rate=dcf.get("terminalGrowthRate", 0.025),
                projection_years=dcf.get("projectionYears", 5),
                pv_cash_flows=dcf.get("pvCashFlows", 0),
                pv_terminal_value=dcf.get("pvTerminalValue", 0),
                net_debt=dcf.get("netDebt", 0),
                shares_outstanding=dcf.get("sharesOutstanding", 1),
            )

        return ResearchReport(
            symbol=symbol,
            company_name=financials.get("company_name", symbol),
            sector=financials.get("sector", "Unknown"),
            industry=financials.get("industry", "Unknown"),
            current_price=financials.get("price", 0),
            market_cap=financials.get("market_cap", 0),
            valuation=valuation_metrics,
            dcf=dcf_result,
            fair_value_range=fair_value_range,
            valuation_rating=valuation_rating,
            earnings=earnings,
            estimate_revisions=None,
            earnings_quality_score=quality["quality_score"],
            revenue_growth_5yr=financials.get("revenue_growth_5yr", 0),
            eps_growth_5yr=financials.get("eps_growth_5yr", 0),
            projected_growth=financials.get("projected_growth", 0),
            gross_margin=financials.get("gross_margin", 0),
            operating_margin=financials.get("operating_margin", 0),
            net_margin=financials.get("net_margin", 0),
            roe=financials.get("roe", 0),
            roic=financials.get("roic", 0),
            debt_to_equity=financials.get("debt_to_equity", 0),
            current_ratio=financials.get("current_ratio", 0),
            interest_coverage=financials.get("interest_coverage", 0),
            overall_score=overall_score,
            strengths=strengths,
            weaknesses=weaknesses,
            catalysts=["Earnings growth", "Market expansion"],
            risks=["Competition", "Economic conditions"],
            recent_news=recent_news,
        )

    async def _get_financials(self, symbol: str) -> Dict[str, Any]:
        """Fetch financial data for a symbol."""
        # In production, this would fetch from DataManager and AccountingAnalyzer
        # For now, return mock data
        return {
            "symbol": symbol,
            "company_name": f"{symbol} Inc.",
            "sector": "Technology",
            "industry": "Software",
            "price": 150.0 + np.random.uniform(-20, 50),
            "shares_outstanding": 1_000_000_000,
            "market_cap": 150_000_000_000,
            "net_income": 10_000_000_000,
            "forward_earnings": 12_000_000_000,
            "revenue": 100_000_000_000,
            "book_value": 50_000_000_000,
            "tangible_book_value": 40_000_000_000,
            "ebitda": 20_000_000_000,
            "free_cash_flow": 15_000_000_000,
            "operating_cash_flow": 18_000_000_000,
            "total_debt": 20_000_000_000,
            "cash": 30_000_000_000,
            "total_assets": 200_000_000_000,
            "dividends_per_share": 0.50,
            "earnings_growth_rate": 0.15,
            "wacc": 0.10,
            "gross_margin": 45,
            "operating_margin": 25,
            "net_margin": 15,
            "roe": 20,
            "roic": 18,
            "debt_to_equity": 0.4,
            "current_ratio": 1.5,
            "interest_coverage": 10,
            "revenue_growth_5yr": 12,
            "eps_growth_5yr": 15,
            "projected_growth": 10,
        }

    async def _get_earnings_history(self, symbol: str, quarters: int) -> List[Dict]:
        """Fetch earnings history."""
        # Mock data
        history = []
        base_eps = 2.0
        base_revenue = 25_000_000_000

        for i in range(quarters):
            year = 2024 - i // 4
            quarter = 4 - (i % 4)

            eps_actual = base_eps * (1 + np.random.uniform(-0.1, 0.2))
            eps_estimate = base_eps * (1 + np.random.uniform(-0.05, 0.05))
            revenue_actual = base_revenue * (1 + np.random.uniform(-0.1, 0.15))
            revenue_estimate = base_revenue * (1 + np.random.uniform(-0.05, 0.05))

            history.append(
                {
                    "fiscal_quarter": f"Q{quarter} {year}",
                    "fiscal_year": year,
                    "fiscal_period": quarter,
                    "eps_actual": eps_actual,
                    "eps_estimate": eps_estimate,
                    "revenue_actual": revenue_actual,
                    "revenue_estimate": revenue_estimate,
                }
            )

            base_eps *= 0.98  # Slight decline going back
            base_revenue *= 0.97

        return history

    async def _get_peers(self, symbol: str) -> List[str]:
        """Get peer companies for comparison."""
        # Mock peer list based on common tech stocks
        peer_lists = {
            "AAPL": ["MSFT", "GOOGL", "META", "AMZN"],
            "MSFT": ["AAPL", "GOOGL", "ORCL", "CRM"],
            "GOOGL": ["META", "MSFT", "AMZN", "NFLX"],
            "default": ["AAPL", "MSFT", "GOOGL", "AMZN"],
        }
        return peer_lists.get(symbol.upper(), peer_lists["default"])

    async def _get_recent_news(
        self, symbol: str, max_articles: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Fetch recent news for a symbol using news_digest.

        Args:
            symbol: Stock symbol
            max_articles: Maximum number of articles to return

        Returns:
            List of news article dictionaries
        """
        try:
            # Import news_digest module
            try:
                from news_digest import generate_digest
            except ImportError:
                generate_digest = mock_generate_digest

            # Generate digest for key categories
            digest = await generate_digest(
                tickers=[symbol],
                range_str="7d",
                categories=["earnings", "analyst", "sec_filings"],
                summarize=False,
                max_articles=max_articles,
            )

            # Convert articles to dict format
            return [
                {
                    "title": a.title,
                    "url": a.url,
                    "source": a.source,
                    "category": a.category,
                    "sentiment": a.sentiment,
                    "impact": a.impact,
                }
                for a in digest.articles
            ]

        except Exception as e:
            logger.warning(f"Failed to fetch news for {symbol}: {e}")
            return []

    async def _project_fcf(self, symbol: str, financials: Dict) -> List[float]:
        """Project free cash flow for DCF."""
        current_fcf = financials.get("free_cash_flow", 0)
        growth_rate = financials.get("projected_growth", 10) / 100

        projections = []
        fcf = current_fcf

        for year in range(5):
            # Declining growth rate over time
            year_growth = growth_rate * (1 - year * 0.1)
            fcf = fcf * (1 + year_growth)
            projections.append(fcf)

        return projections

    def _analyze_strengths_weaknesses(
        self,
        financials: Dict,
        earnings: EarningsAnalysis,
    ) -> tuple[List[str], List[str]]:
        """Analyze company strengths and weaknesses."""
        strengths = []
        weaknesses = []

        # Margins
        if financials.get("gross_margin", 0) > 40:
            strengths.append("Strong gross margins")
        elif financials.get("gross_margin", 0) < 20:
            weaknesses.append("Low gross margins")

        if financials.get("operating_margin", 0) > 20:
            strengths.append("Healthy operating margins")
        elif financials.get("operating_margin", 0) < 10:
            weaknesses.append("Weak operating margins")

        # Growth
        if financials.get("revenue_growth_5yr", 0) > 15:
            strengths.append("Strong revenue growth")
        elif financials.get("revenue_growth_5yr", 0) < 5:
            weaknesses.append("Slow revenue growth")

        # Balance sheet
        if financials.get("current_ratio", 0) > 1.5:
            strengths.append("Strong liquidity")
        elif financials.get("current_ratio", 0) < 1:
            weaknesses.append("Weak liquidity")

        if financials.get("debt_to_equity", 1) < 0.5:
            strengths.append("Low debt levels")
        elif financials.get("debt_to_equity", 0) > 1.5:
            weaknesses.append("High debt levels")

        # Earnings
        if earnings.beat_rate > 75:
            strengths.append("Consistent earnings beats")
        elif earnings.beat_rate < 50:
            weaknesses.append("Inconsistent earnings performance")

        # ROE
        if financials.get("roe", 0) > 15:
            strengths.append("High return on equity")
        elif financials.get("roe", 0) < 8:
            weaknesses.append("Low return on equity")

        return strengths, weaknesses

    def _calculate_overall_score(
        self,
        financials: Dict,
        earnings: EarningsAnalysis,
        quality_score: float,
        valuation_rating: str,
    ) -> float:
        """Calculate overall investment score (0-100)."""
        score = 50  # Base score

        # Valuation (20 points)
        if valuation_rating == "undervalued":
            score += 15
        elif valuation_rating == "overvalued":
            score -= 10

        # Growth (20 points)
        growth = financials.get("revenue_growth_5yr", 0)
        if growth > 20:
            score += 15
        elif growth > 10:
            score += 8
        elif growth < 0:
            score -= 10

        # Profitability (20 points)
        margin = financials.get("operating_margin", 0)
        if margin > 25:
            score += 15
        elif margin > 15:
            score += 8
        elif margin < 5:
            score -= 10

        # Earnings quality (15 points)
        score += (quality_score - 50) * 0.3

        # Earnings beat rate (15 points)
        if earnings.beat_rate > 80:
            score += 12
        elif earnings.beat_rate > 60:
            score += 6
        elif earnings.beat_rate < 40:
            score -= 8

        # Financial health (10 points)
        if (
            financials.get("current_ratio", 0) > 1.5
            and financials.get("debt_to_equity", 1) < 1
        ):
            score += 8
        elif (
            financials.get("current_ratio", 0) < 1
            or financials.get("debt_to_equity", 1) > 2
        ):
            score -= 8

        return max(0, min(100, score))

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return True
