"""
Red Flag Scoring Module

Detects accounting red flags and manipulation patterns:
- Revenue recognition anomalies
- Expense manipulation
- Off-balance-sheet items
- Unusual accrual patterns
- Related party transactions
"""

import logging
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

import numpy as np
import pandas as pd

from .financial_statements import FinancialStatements
from .footnotes import FootnoteAnalyzer, FootnoteType
from .edgar_adapter import EdgarAdapter

logger = logging.getLogger(__name__)


class RedFlagSeverity(Enum):
    """Severity levels for red flags."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RedFlagCategory(Enum):
    """Categories of accounting red flags."""

    REVENUE = "revenue_recognition"
    EXPENSES = "expense_manipulation"
    ACCRUALS = "accrual_anomaly"
    BALANCE_SHEET = "balance_sheet"
    OFF_BALANCE = "off_balance_sheet"
    CASH_FLOW = "cash_flow"
    RELATED_PARTY = "related_party"
    AUDIT = "audit_concerns"


@dataclass
class RedFlag:
    """Individual red flag detection."""

    category: RedFlagCategory
    severity: RedFlagSeverity
    description: str
    metric_name: str
    metric_value: float
    threshold: float
    confidence: float  # 0-1
    recommendation: str


@dataclass
class RedFlagReport:
    """Comprehensive red flag report."""

    ticker: str
    total_score: float  # 0-100, higher = more concerns
    risk_level: str  # "Low", "Medium", "High", "Critical"
    flags: List[RedFlag]
    summary: str
    top_concerns: List[str]


class RevenueRedFlagDetector:
    """Detect revenue recognition red flags."""

    def __init__(self, statements: FinancialStatements, footnotes: FootnoteAnalyzer):
        self.statements = statements
        self.footnotes = footnotes

    def detect(self, ticker: str) -> List[RedFlag]:
        """
        Detect revenue recognition red flags.

        Args:
            ticker: Stock ticker symbol

        Returns:
            List of detected red flags
        """
        flags = []

        try:
            # Get financial statements
            stmt_data = self.statements.get_all_statements(ticker, periods=8)
            bs = stmt_data["balance_sheet"].data
            inc = stmt_data["income_statement"].data

            # Check 1: Accounts receivable growing faster than revenue
            if "accounts_receivable" in bs.columns and "revenue" in inc.columns:
                ar_growth = self._calculate_growth_rate(bs["accounts_receivable"])
                rev_growth = self._calculate_growth_rate(inc["revenue"])

                if len(ar_growth) > 0 and len(rev_growth) > 0:
                    avg_ar_growth = ar_growth.mean()
                    avg_rev_growth = rev_growth.mean()

                    if avg_ar_growth > avg_rev_growth * 1.2:
                        ratio = (
                            avg_ar_growth / avg_rev_growth if avg_rev_growth != 0 else 0
                        )
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.REVENUE,
                                severity=RedFlagSeverity.HIGH,
                                description="Accounts receivable growing significantly faster than revenue",
                                metric_name="ar_to_revenue_growth_ratio",
                                metric_value=ratio,
                                threshold=1.2,
                                confidence=0.85,
                                recommendation="Review revenue recognition policies and accounts receivable aging. "
                                "May indicate channel stuffing or premature revenue recognition.",
                            )
                        )

            # Check 2: Deferred revenue declining while revenue grows
            if "deferred_revenue" in bs.columns and "revenue" in inc.columns:
                dr_growth = self._calculate_growth_rate(bs["deferred_revenue"])
                rev_growth = self._calculate_growth_rate(inc["revenue"])

                if len(dr_growth) > 0 and len(rev_growth) > 0:
                    # Check if deferred revenue is declining while revenue is growing
                    dr_declining = dr_growth.mean() < -0.05
                    rev_growing = rev_growth.mean() > 0.05

                    if dr_declining and rev_growing:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.REVENUE,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Deferred revenue declining while reported revenue grows",
                                metric_name="deferred_revenue_trend",
                                metric_value=dr_growth.mean(),
                                threshold=-0.05,
                                confidence=0.75,
                                recommendation="Investigate changes in business model or revenue recognition. "
                                "May indicate pulling forward revenue or declining subscription renewals.",
                            )
                        )

            # Check 3: Revenue spikes in Q4 (channel stuffing)
            quarterly_data = self.statements.get_income_statement(
                ticker, periods=8, quarterly=True
            )
            if (
                not quarterly_data.data.empty
                and "revenue" in quarterly_data.data.columns
            ):
                rev_quarterly = quarterly_data.data["revenue"]
                if len(rev_quarterly) >= 4:
                    # Check last year's quarters
                    recent_quarters = rev_quarterly.head(4)
                    q4_rev = recent_quarters.iloc[0] if len(recent_quarters) > 0 else 0
                    avg_other = (
                        recent_quarters.iloc[1:].mean()
                        if len(recent_quarters) > 1
                        else 0
                    )

                    if avg_other > 0 and q4_rev > avg_other * 1.3:
                        ratio = q4_rev / avg_other
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.REVENUE,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Significant Q4 revenue spike detected",
                                metric_name="q4_revenue_concentration",
                                metric_value=ratio,
                                threshold=1.3,
                                confidence=0.70,
                                recommendation="Examine Q4 sales practices and customer acceptance terms. "
                                "May indicate channel stuffing or aggressive end-of-year sales tactics.",
                            )
                        )

            # Check 4: Gross margin erosion with stable revenue
            if "gross_profit" in inc.columns and "revenue" in inc.columns:
                gross_margin = inc["gross_profit"] / inc["revenue"].replace(0, np.nan)
                margin_change = self._calculate_growth_rate(gross_margin)

                if len(margin_change) > 0 and margin_change.mean() < -0.10:
                    rev_growth = self._calculate_growth_rate(inc["revenue"])
                    if len(rev_growth) > 0 and abs(rev_growth.mean()) < 0.05:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.REVENUE,
                                severity=RedFlagSeverity.HIGH,
                                description="Gross margin declining significantly despite stable revenue",
                                metric_name="gross_margin_decline",
                                metric_value=margin_change.mean(),
                                threshold=-0.10,
                                confidence=0.80,
                                recommendation="Investigate pricing pressure, cost inflation, or product mix changes. "
                                "May indicate quality of revenue deterioration.",
                            )
                        )

            # Check 5: Revenue volatility (high standard deviation)
            if "revenue" in inc.columns and len(inc["revenue"]) >= 4:
                rev_growth = self._calculate_growth_rate(inc["revenue"])
                if len(rev_growth) >= 3:
                    volatility = rev_growth.std()
                    if volatility > 0.20:  # 20% standard deviation
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.REVENUE,
                                severity=RedFlagSeverity.MEDIUM,
                                description="High revenue volatility detected",
                                metric_name="revenue_volatility",
                                metric_value=volatility,
                                threshold=0.20,
                                confidence=0.65,
                                recommendation="Review revenue consistency and business model stability. "
                                "High volatility may indicate lumpy sales or accounting irregularities.",
                            )
                        )

        except Exception as e:
            logger.error(f"Error detecting revenue red flags for {ticker}: {e}")

        return flags

    def _calculate_growth_rate(self, series: pd.Series) -> pd.Series:
        """Calculate period-over-period growth rates."""
        return series.pct_change(periods=-1)


class ExpenseRedFlagDetector:
    """Detect expense manipulation red flags."""

    def __init__(self, statements: FinancialStatements):
        self.statements = statements

    def detect(self, ticker: str) -> List[RedFlag]:
        """
        Detect expense manipulation red flags.

        Args:
            ticker: Stock ticker symbol

        Returns:
            List of detected red flags
        """
        flags = []

        try:
            stmt_data = self.statements.get_all_statements(ticker, periods=8)
            inc = stmt_data["income_statement"].data
            cf = stmt_data["cash_flow"].data

            # Check 1: SG&A declining while revenue grows
            if (
                "sga_expense" in inc.columns
                and "revenue" in inc.columns
                and len(inc["sga_expense"]) >= 3
            ):
                sga_growth = inc["sga_expense"].pct_change(periods=-1)
                rev_growth = inc["revenue"].pct_change(periods=-1)

                if len(sga_growth) > 0 and len(rev_growth) > 0:
                    avg_sga_growth = sga_growth.mean()
                    avg_rev_growth = rev_growth.mean()

                    # SG&A declining while revenue grows
                    if avg_sga_growth < -0.05 and avg_rev_growth > 0.05:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.EXPENSES,
                                severity=RedFlagSeverity.MEDIUM,
                                description="SG&A expenses declining while revenue grows",
                                metric_name="sga_to_revenue_trend",
                                metric_value=avg_sga_growth,
                                threshold=-0.05,
                                confidence=0.70,
                                recommendation="Verify expense classification and capitalization policies. "
                                "Unusual declines may indicate expense deferrals or capitalization.",
                            )
                        )

            # Check 2: R&D capitalization increasing
            if "rd_expense" in inc.columns and len(inc["rd_expense"]) >= 4:
                rd_growth = inc["rd_expense"].pct_change(periods=-1)
                if len(rd_growth) >= 2:
                    # Check for sudden decline (potential capitalization)
                    recent_rd = inc["rd_expense"].head(2)
                    if len(recent_rd) == 2:
                        rd_change = (recent_rd.iloc[0] - recent_rd.iloc[1]) / abs(
                            recent_rd.iloc[1]
                        )
                        if rd_change < -0.15:  # 15% decline
                            flags.append(
                                RedFlag(
                                    category=RedFlagCategory.EXPENSES,
                                    severity=RedFlagSeverity.MEDIUM,
                                    description="Significant R&D expense decline detected",
                                    metric_name="rd_expense_decline",
                                    metric_value=rd_change,
                                    threshold=-0.15,
                                    confidence=0.65,
                                    recommendation="Review R&D capitalization policies. "
                                    "Sharp declines may indicate aggressive capitalization to boost earnings.",
                                )
                            )

            # Check 3: Depreciation rates declining
            if "depreciation" in cf.columns and len(cf["depreciation"]) >= 3:
                bs = stmt_data["balance_sheet"].data
                if "ppe_net" in bs.columns:
                    # Calculate depreciation rate
                    depr_rate = cf["depreciation"] / bs["ppe_net"].replace(0, np.nan)
                    rate_change = depr_rate.pct_change(periods=-1)

                    if len(rate_change) > 0 and rate_change.mean() < -0.10:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.EXPENSES,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Depreciation rate declining",
                                metric_name="depreciation_rate_decline",
                                metric_value=rate_change.mean(),
                                threshold=-0.10,
                                confidence=0.75,
                                recommendation="Examine asset useful life estimates. "
                                "Declining depreciation rates may indicate extended lives to reduce expenses.",
                            )
                        )

            # Check 4: Operating expense ratio unusually low
            if "operating_expenses" in inc.columns and "revenue" in inc.columns:
                opex_ratio = inc["operating_expenses"] / inc["revenue"].replace(
                    0, np.nan
                )
                if len(opex_ratio) > 0:
                    latest_ratio = opex_ratio.iloc[0]
                    if latest_ratio < 0.10:  # Less than 10% is unusual
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.EXPENSES,
                                severity=RedFlagSeverity.LOW,
                                description="Unusually low operating expense ratio",
                                metric_name="opex_to_revenue_ratio",
                                metric_value=latest_ratio,
                                threshold=0.10,
                                confidence=0.60,
                                recommendation="Verify expense classification. "
                                "Very low ratios may indicate misclassification or deferrals.",
                            )
                        )

        except Exception as e:
            logger.error(f"Error detecting expense red flags for {ticker}: {e}")

        return flags


class AccrualRedFlagDetector:
    """Detect accrual anomaly red flags."""

    def __init__(self, statements: FinancialStatements):
        self.statements = statements

    def detect(self, ticker: str) -> List[RedFlag]:
        """
        Detect accrual anomaly red flags.

        Args:
            ticker: Stock ticker symbol

        Returns:
            List of detected red flags
        """
        flags = []

        try:
            stmt_data = self.statements.get_all_statements(ticker, periods=8)
            bs = stmt_data["balance_sheet"].data
            inc = stmt_data["income_statement"].data
            cf = stmt_data["cash_flow"].data

            # Check 1: Total accruals as % of assets
            if (
                all(
                    col in inc.columns or col in cf.columns
                    for col in ["net_income", "cfo"]
                )
                and "total_assets" in bs.columns
            ):
                net_income = inc.get("net_income", pd.Series(dtype=float))
                cfo = cf.get("cfo", pd.Series(dtype=float))
                total_assets = bs.get("total_assets", pd.Series(dtype=float))

                # Total accruals = Net Income - CFO
                if len(net_income) > 0 and len(cfo) > 0 and len(total_assets) > 0:
                    min_len = min(len(net_income), len(cfo), len(total_assets))
                    accruals = (
                        net_income.head(min_len).values - cfo.head(min_len).values
                    )
                    accrual_ratio = accruals / total_assets.head(min_len).values

                    if len(accrual_ratio) > 0 and abs(accrual_ratio[0]) > 0.10:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.ACCRUALS,
                                severity=RedFlagSeverity.HIGH,
                                description="High total accruals relative to assets",
                                metric_name="accruals_to_assets",
                                metric_value=abs(accrual_ratio[0]),
                                threshold=0.10,
                                confidence=0.85,
                                recommendation="Review accrual quality and earnings management risk. "
                                "High accruals increase risk of earnings manipulation.",
                            )
                        )

            # Check 2: Accruals diverging from CFO
            if "net_income" in inc.columns and "cfo" in cf.columns:
                ni = inc["net_income"]
                cfo_series = cf["cfo"]

                if len(ni) >= 3 and len(cfo_series) >= 3:
                    min_len = min(len(ni), len(cfo_series))
                    # Check if NI and CFO moving in opposite directions
                    ni_trend = (
                        ni.head(min_len).iloc[0] - ni.head(min_len).iloc[-1]
                    ) / abs(ni.head(min_len).iloc[-1])
                    cfo_trend = (
                        cfo_series.head(min_len).iloc[0]
                        - cfo_series.head(min_len).iloc[-1]
                    ) / abs(cfo_series.head(min_len).iloc[-1])

                    if ni_trend * cfo_trend < 0 and abs(ni_trend) > 0.15:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.ACCRUALS,
                                severity=RedFlagSeverity.HIGH,
                                description="Net income and cash flow from operations diverging",
                                metric_name="ni_cfo_divergence",
                                metric_value=abs(ni_trend - cfo_trend),
                                threshold=0.15,
                                confidence=0.80,
                                recommendation="Examine quality of earnings. "
                                "Divergence suggests accrual-based earnings growth rather than cash generation.",
                            )
                        )

            # Check 3: Inventory buildup
            if "inventory" in bs.columns and "cost_of_revenue" in inc.columns:
                inventory = bs["inventory"]
                cogs = inc["cost_of_revenue"]

                if len(inventory) >= 3 and len(cogs) >= 3:
                    # Days inventory = (Inventory / COGS) * 365
                    days_inventory = (inventory / cogs.replace(0, np.nan)) * 365
                    days_change = days_inventory.pct_change(periods=-1)

                    if len(days_change) > 0 and days_change.mean() > 0.20:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.ACCRUALS,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Days inventory increasing significantly",
                                metric_name="days_inventory_growth",
                                metric_value=days_change.mean(),
                                threshold=0.20,
                                confidence=0.75,
                                recommendation="Investigate inventory obsolescence risk. "
                                "Rising days inventory may indicate slowing sales or channel stuffing.",
                            )
                        )

            # Check 4: Payables declining (paying faster than receiving)
            if "accounts_payable" in bs.columns and "accounts_receivable" in bs.columns:
                ap = bs["accounts_payable"]
                ar = bs["accounts_receivable"]

                if len(ap) >= 3 and len(ar) >= 3:
                    ap_growth = ap.pct_change(periods=-1)
                    ar_growth = ar.pct_change(periods=-1)

                    if (
                        len(ap_growth) > 0
                        and len(ar_growth) > 0
                        and ap_growth.mean() < -0.10
                        and ar_growth.mean() > 0.10
                    ):
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.ACCRUALS,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Accounts payable declining while receivables growing",
                                metric_name="working_capital_squeeze",
                                metric_value=ap_growth.mean() - ar_growth.mean(),
                                threshold=-0.20,
                                confidence=0.70,
                                recommendation="Review working capital management and cash flow sustainability. "
                                "Pattern suggests potential liquidity stress.",
                            )
                        )

        except Exception as e:
            logger.error(f"Error detecting accrual red flags for {ticker}: {e}")

        return flags


class OffBalanceSheetDetector:
    """Detect off-balance-sheet red flags."""

    def __init__(self, statements: FinancialStatements, footnotes: FootnoteAnalyzer):
        self.statements = statements
        self.footnotes = footnotes

    def detect(self, ticker: str) -> List[RedFlag]:
        """
        Detect off-balance-sheet red flags.

        Args:
            ticker: Stock ticker symbol

        Returns:
            List of detected red flags
        """
        flags = []

        try:
            # Get lease disclosures
            lease_disclosure = self.footnotes.get_lease_disclosures(ticker)

            # Check 1: Large operating lease obligations
            if lease_disclosure.operating_lease_liability:
                stmt_data = self.statements.get_all_statements(ticker, periods=1)
                bs = stmt_data["balance_sheet"].data

                if "total_assets" in bs.columns and len(bs["total_assets"]) > 0:
                    total_assets = bs["total_assets"].iloc[0]
                    lease_ratio = (
                        lease_disclosure.operating_lease_liability / total_assets
                    )

                    if lease_ratio > 0.15:  # 15% of assets
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.OFF_BALANCE,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Significant operating lease obligations",
                                metric_name="operating_lease_to_assets",
                                metric_value=lease_ratio,
                                threshold=0.15,
                                confidence=0.80,
                                recommendation="Consider lease obligations in leverage analysis. "
                                "Large leases represent hidden debt.",
                            )
                        )

            # Check 2: Contingencies and commitments
            contingency_disclosure = self.footnotes.get_contingency_disclosures(ticker)

            if contingency_disclosure.guarantees:
                stmt_data = self.statements.get_all_statements(ticker, periods=1)
                bs = stmt_data["balance_sheet"].data

                if "total_assets" in bs.columns and len(bs["total_assets"]) > 0:
                    total_assets = bs["total_assets"].iloc[0]
                    guarantee_ratio = contingency_disclosure.guarantees / total_assets

                    if guarantee_ratio > 0.10:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.OFF_BALANCE,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Significant guarantee obligations",
                                metric_name="guarantees_to_assets",
                                metric_value=guarantee_ratio,
                                threshold=0.10,
                                confidence=0.75,
                                recommendation="Review guarantee terms and counterparty risk. "
                                "May represent hidden liabilities.",
                            )
                        )

            # Check 3: Related party transactions
            related_party_footnote = self.footnotes.get_footnote(
                ticker, FootnoteType.RELATED_PARTY
            )

            if related_party_footnote:
                # Flag presence of related party transactions
                if len(related_party_footnote.content) > 500:  # Substantive disclosure
                    flags.append(
                        RedFlag(
                            category=RedFlagCategory.RELATED_PARTY,
                            severity=RedFlagSeverity.MEDIUM,
                            description="Significant related party transactions disclosed",
                            metric_name="related_party_disclosure_size",
                            metric_value=len(related_party_footnote.content),
                            threshold=500,
                            confidence=0.70,
                            recommendation="Review related party transactions for arm's length pricing. "
                            "May indicate conflict of interest or transfer pricing issues.",
                        )
                    )

        except Exception as e:
            logger.error(
                f"Error detecting off-balance-sheet red flags for {ticker}: {e}"
            )

        return flags


class CashFlowRedFlagDetector:
    """Detect cash flow red flags."""

    def __init__(self, statements: FinancialStatements):
        self.statements = statements

    def detect(self, ticker: str) -> List[RedFlag]:
        """
        Detect cash flow red flags.

        Args:
            ticker: Stock ticker symbol

        Returns:
            List of detected red flags
        """
        flags = []

        try:
            stmt_data = self.statements.get_all_statements(ticker, periods=8)
            inc = stmt_data["income_statement"].data
            cf = stmt_data["cash_flow"].data

            # Check 1: CFO < Net Income for 3+ years
            if "cfo" in cf.columns and "net_income" in inc.columns:
                min_len = min(len(cf["cfo"]), len(inc["net_income"]))
                cfo = cf["cfo"].head(min_len)
                ni = inc["net_income"].head(min_len)

                if min_len >= 3:
                    years_below = (cfo < ni).sum()
                    if years_below >= 3:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.CASH_FLOW,
                                severity=RedFlagSeverity.HIGH,
                                description="Cash flow from operations below net income for 3+ years",
                                metric_name="cfo_below_ni_years",
                                metric_value=float(years_below),
                                threshold=3.0,
                                confidence=0.85,
                                recommendation="Investigate earnings quality. "
                                "Persistent negative accruals suggest aggressive accounting.",
                            )
                        )

            # Check 2: Free cash flow negative while profitable
            if (
                "cfo" in cf.columns
                and "capex" in cf.columns
                and "net_income" in inc.columns
            ):
                min_len = min(len(cf["cfo"]), len(cf["capex"]), len(inc["net_income"]))
                fcf = cf["cfo"].head(min_len).values - abs(
                    cf["capex"].head(min_len).values
                )
                ni = inc["net_income"].head(min_len).values

                if min_len >= 2:
                    fcf_negative = fcf < 0
                    ni_positive = ni > 0
                    years_diverge = (fcf_negative & ni_positive).sum()

                    if years_diverge >= 2:
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.CASH_FLOW,
                                severity=RedFlagSeverity.HIGH,
                                description="Free cash flow negative while reporting profits",
                                metric_name="fcf_negative_years",
                                metric_value=float(years_diverge),
                                threshold=2.0,
                                confidence=0.80,
                                recommendation="Assess business model sustainability. "
                                "May indicate high growth capex or earnings quality issues.",
                            )
                        )

            # Check 3: Large "other" adjustments in CFO
            # This would require detailed cash flow statement parsing
            # Placeholder for now - would need to examine individual line items

            # Check 4: Capex significantly below depreciation
            if "capex" in cf.columns and "depreciation" in cf.columns:
                min_len = min(len(cf["capex"]), len(cf["depreciation"]))
                capex = abs(cf["capex"].head(min_len))
                depreciation = cf["depreciation"].head(min_len)

                if min_len >= 3:
                    # Capex should typically be >= depreciation to maintain assets
                    capex_ratio = capex / depreciation.replace(0, np.nan)
                    avg_ratio = capex_ratio.mean()

                    if avg_ratio < 0.80:  # Capex < 80% of depreciation
                        flags.append(
                            RedFlag(
                                category=RedFlagCategory.CASH_FLOW,
                                severity=RedFlagSeverity.MEDIUM,
                                description="Capital expenditures below depreciation",
                                metric_name="capex_to_depreciation",
                                metric_value=avg_ratio,
                                threshold=0.80,
                                confidence=0.70,
                                recommendation="Review asset maintenance and replacement cycle. "
                                "Low capex may indicate deferred maintenance or declining business.",
                            )
                        )

            # Check 5: Stock compensation > 10% of CFO
            # Would need stock compensation data from cash flow statement
            # Placeholder - similar implementation as above

        except Exception as e:
            logger.error(f"Error detecting cash flow red flags for {ticker}: {e}")

        return flags


class RedFlagScorer:
    """
    Aggregate red flag scoring and risk assessment.

    Combines all detector outputs into comprehensive risk score.
    """

    # Severity weights for scoring
    SEVERITY_WEIGHTS = {
        RedFlagSeverity.LOW: 5,
        RedFlagSeverity.MEDIUM: 15,
        RedFlagSeverity.HIGH: 30,
        RedFlagSeverity.CRITICAL: 50,
    }

    def __init__(self, edgar_adapter: Optional[EdgarAdapter] = None):
        """Initialize RedFlagScorer with optional EdgarAdapter."""
        self.edgar = edgar_adapter or EdgarAdapter()
        self.statements = FinancialStatements(self.edgar)
        self.footnotes = FootnoteAnalyzer(self.edgar)

        # Initialize detectors
        self.revenue_detector = RevenueRedFlagDetector(self.statements, self.footnotes)
        self.expense_detector = ExpenseRedFlagDetector(self.statements)
        self.accrual_detector = AccrualRedFlagDetector(self.statements)
        self.off_balance_detector = OffBalanceSheetDetector(
            self.statements, self.footnotes
        )
        self.cash_flow_detector = CashFlowRedFlagDetector(self.statements)

    def score(self, ticker: str) -> RedFlagReport:
        """
        Generate comprehensive red flag score and report.

        Args:
            ticker: Stock ticker symbol

        Returns:
            RedFlagReport with all detected flags and overall score
        """
        logger.info(f"Scoring red flags for {ticker}")

        # Run all detectors
        all_flags: List[RedFlag] = []

        try:
            all_flags.extend(self.revenue_detector.detect(ticker))
        except Exception as e:
            logger.error(f"Revenue detector failed for {ticker}: {e}")

        try:
            all_flags.extend(self.expense_detector.detect(ticker))
        except Exception as e:
            logger.error(f"Expense detector failed for {ticker}: {e}")

        try:
            all_flags.extend(self.accrual_detector.detect(ticker))
        except Exception as e:
            logger.error(f"Accrual detector failed for {ticker}: {e}")

        try:
            all_flags.extend(self.off_balance_detector.detect(ticker))
        except Exception as e:
            logger.error(f"Off-balance-sheet detector failed for {ticker}: {e}")

        try:
            all_flags.extend(self.cash_flow_detector.detect(ticker))
        except Exception as e:
            logger.error(f"Cash flow detector failed for {ticker}: {e}")

        # Calculate total score
        total_score = self._calculate_total_score(all_flags)

        # Determine risk level
        risk_level = self._categorize_risk(total_score)

        # Generate summary
        summary = self._generate_summary(all_flags, total_score, risk_level)

        # Extract top concerns
        top_concerns = self._extract_top_concerns(all_flags)

        return RedFlagReport(
            ticker=ticker,
            total_score=total_score,
            risk_level=risk_level,
            flags=all_flags,
            summary=summary,
            top_concerns=top_concerns,
        )

    def _calculate_total_score(self, flags: List[RedFlag]) -> float:
        """
        Calculate total red flag score (0-100).

        Higher scores indicate more accounting concerns.
        """
        if not flags:
            return 0.0

        # Sum weighted scores
        weighted_sum = 0.0
        for flag in flags:
            base_score = self.SEVERITY_WEIGHTS[flag.severity]
            # Adjust by confidence
            weighted_score = base_score * flag.confidence
            weighted_sum += weighted_score

        # Normalize to 0-100 scale
        # Cap at 100
        normalized_score = min(weighted_sum, 100.0)

        return round(normalized_score, 2)

    def _categorize_risk(self, score: float) -> str:
        """Categorize risk level based on score."""
        if score < 25:
            return "Low"
        elif score < 50:
            return "Medium"
        elif score < 75:
            return "High"
        else:
            return "Critical"

    def _generate_summary(
        self, flags: List[RedFlag], score: float, risk_level: str
    ) -> str:
        """Generate executive summary of red flags."""
        if not flags:
            return (
                f"{risk_level} risk ({score:.1f}/100): "
                "No significant accounting red flags detected."
            )

        # Count by severity
        severity_counts = {}
        for flag in flags:
            sev = flag.severity.value
            severity_counts[sev] = severity_counts.get(sev, 0) + 1

        # Count by category
        category_counts = {}
        for flag in flags:
            cat = flag.category.value
            category_counts[cat] = category_counts.get(cat, 0) + 1

        summary_parts = [
            f"{risk_level} risk ({score:.1f}/100): "
            f"Detected {len(flags)} red flag(s)."
        ]

        if severity_counts:
            sev_str = ", ".join(
                f"{count} {sev}" for sev, count in sorted(severity_counts.items())
            )
            summary_parts.append(f"Severity breakdown: {sev_str}.")

        if category_counts:
            top_categories = sorted(
                category_counts.items(), key=lambda x: x[1], reverse=True
            )[:3]
            cat_str = ", ".join(
                f"{count} {cat.replace('_', ' ')}" for cat, count in top_categories
            )
            summary_parts.append(f"Primary concerns: {cat_str}.")

        return " ".join(summary_parts)

    def _extract_top_concerns(self, flags: List[RedFlag], limit: int = 5) -> List[str]:
        """Extract top concerns from flags."""
        # Sort by severity and confidence
        sorted_flags = sorted(
            flags,
            key=lambda f: (
                self.SEVERITY_WEIGHTS[f.severity] * f.confidence,
                f.confidence,
            ),
            reverse=True,
        )

        top_concerns = []
        for flag in sorted_flags[:limit]:
            concern = (
                f"[{flag.severity.value.upper()}] {flag.description} "
                f"(confidence: {flag.confidence:.0%})"
            )
            top_concerns.append(concern)

        return top_concerns

    def compare_peer_red_flags(self, ticker: str, peers: List[str]) -> pd.DataFrame:
        """
        Compare red flag scores across peer companies.

        Args:
            ticker: Primary ticker to analyze
            peers: List of peer ticker symbols

        Returns:
            DataFrame with comparative scores
        """
        all_tickers = [ticker] + peers
        results = []

        for t in all_tickers:
            try:
                report = self.score(t)
                results.append(
                    {
                        "ticker": t,
                        "total_score": report.total_score,
                        "risk_level": report.risk_level,
                        "num_flags": len(report.flags),
                        "high_severity": sum(
                            1
                            for f in report.flags
                            if f.severity
                            in [RedFlagSeverity.HIGH, RedFlagSeverity.CRITICAL]
                        ),
                    }
                )
            except Exception as e:
                logger.error(f"Failed to score {t}: {e}")
                results.append(
                    {
                        "ticker": t,
                        "total_score": None,
                        "risk_level": "Error",
                        "num_flags": 0,
                        "high_severity": 0,
                    }
                )

        df = pd.DataFrame(results)
        df = df.sort_values("total_score", ascending=False)
        return df

    def trend_analysis(self, ticker: str, periods: int = 3) -> pd.DataFrame:
        """
        Analyze red flag score trends over time.

        Args:
            ticker: Stock ticker symbol
            periods: Number of historical periods to analyze

        Returns:
            DataFrame with historical scores
        """
        # This would require analyzing historical filings
        # Placeholder implementation
        logger.warning("Trend analysis not yet implemented")
        return pd.DataFrame()
