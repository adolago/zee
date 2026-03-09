"""
Accounting Analyzer Module

High-level interface for comprehensive accounting analysis.
Combines financial statement parsing, footnote analysis,
and computed metrics for fundamental research.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd

from .edgar_adapter import EdgarAdapter
from .financial_statements import FinancialStatements, StatementData
from .footnotes import (
    FootnoteAnalyzer,
    FootnoteType,
    LeaseDisclosure,
    DebtDisclosure,
    RevenueDisclosure,
    ContingencyDisclosure,
)

logger = logging.getLogger(__name__)


@dataclass
class AccountingQuality:
    """Assessment of accounting quality and potential red flags."""

    overall_score: float  # 0-100
    accrual_quality: float
    revenue_quality: float
    earnings_persistence: float
    cash_conversion: float
    red_flags: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


@dataclass
class CompanyFundamentals:
    """Complete fundamental analysis for a company."""

    ticker: str
    company_name: Optional[str]
    filing_date: Optional[datetime]

    # Financial statements
    balance_sheet: Optional[StatementData] = None
    income_statement: Optional[StatementData] = None
    cash_flow_statement: Optional[StatementData] = None

    # Computed metrics
    ratios: Optional[pd.DataFrame] = None
    growth_rates: Optional[pd.DataFrame] = None

    # Disclosures
    lease_disclosures: Optional[LeaseDisclosure] = None
    debt_disclosures: Optional[DebtDisclosure] = None
    revenue_disclosures: Optional[RevenueDisclosure] = None
    contingencies: Optional[ContingencyDisclosure] = None

    # Quality assessment
    accounting_quality: Optional[AccountingQuality] = None

    # Accounting policies
    policies: Dict[str, str] = field(default_factory=dict)


class AccountingAnalyzer:
    """
    Comprehensive accounting and fundamental analysis.

    Provides:
    - Financial statement analysis
    - Footnote extraction and analysis
    - Accounting quality assessment
    - Red flag detection
    - Peer comparison
    """

    def __init__(
        self,
        edgar_identity: Optional[str] = None,
        data_manager: Optional[Any] = None,
    ):
        """
        Initialize AccountingAnalyzer.

        Args:
            edgar_identity: Email for SEC API compliance
            data_manager: Optional DataManager instance
        """
        self.edgar = EdgarAdapter(identity=edgar_identity)
        self.statements = FinancialStatements(self.edgar)
        self.footnotes = FootnoteAnalyzer(self.edgar)
        self.data_manager = data_manager

        logger.info("AccountingAnalyzer initialized")

    def get_fundamentals(
        self,
        ticker: str,
        include_footnotes: bool = True,
        include_quality: bool = True,
    ) -> CompanyFundamentals:
        """
        Get comprehensive fundamental analysis for a company.

        Args:
            ticker: Stock ticker symbol
            include_footnotes: Include detailed footnote analysis
            include_quality: Include accounting quality assessment

        Returns:
            CompanyFundamentals with complete analysis
        """
        company_info = self.edgar.get_company_info(ticker)

        fundamentals = CompanyFundamentals(
            ticker=ticker,
            company_name=company_info.get("name"),
            filing_date=None,
        )

        # Get financial statements
        try:
            statements = self.statements.get_all_statements(ticker)
            fundamentals.balance_sheet = statements.get("balance_sheet")
            fundamentals.income_statement = statements.get("income_statement")
            fundamentals.cash_flow_statement = statements.get("cash_flow")
        except Exception as e:
            logger.error(f"Failed to get statements for {ticker}: {e}")

        # Compute ratios and growth
        try:
            fundamentals.ratios = self.statements.compute_ratios(ticker)
            fundamentals.growth_rates = self.statements.compute_growth_rates(ticker)
        except Exception as e:
            logger.error(f"Failed to compute metrics for {ticker}: {e}")

        # Get footnote disclosures
        if include_footnotes:
            try:
                fundamentals.lease_disclosures = self.footnotes.get_lease_disclosures(
                    ticker
                )
                fundamentals.debt_disclosures = self.footnotes.get_debt_disclosures(
                    ticker
                )
                fundamentals.revenue_disclosures = (
                    self.footnotes.get_revenue_disclosures(ticker)
                )
                fundamentals.contingencies = self.footnotes.get_contingency_disclosures(
                    ticker
                )
                fundamentals.policies = self.footnotes.get_accounting_policies(ticker)
            except Exception as e:
                logger.error(f"Failed to get footnotes for {ticker}: {e}")

        # Assess accounting quality
        if include_quality:
            try:
                fundamentals.accounting_quality = self.assess_accounting_quality(ticker)
            except Exception as e:
                logger.error(f"Failed to assess quality for {ticker}: {e}")

        return fundamentals

    def assess_accounting_quality(self, ticker: str) -> AccountingQuality:
        """
        Assess accounting quality and detect red flags.

        Args:
            ticker: Stock ticker symbol

        Returns:
            AccountingQuality assessment
        """
        statements = self.statements.get_all_statements(ticker)
        inc = statements["income_statement"].data
        cf = statements["cash_flow"].data
        bs = statements["balance_sheet"].data

        red_flags = []
        notes = []

        # Initialize scores
        accrual_quality = 100.0
        revenue_quality = 100.0
        earnings_persistence = 100.0
        cash_conversion = 100.0

        # 1. Accrual Quality - Compare net income to operating cash flow
        if "net_income" in inc.columns and "cfo" in cf.columns:
            net_income = inc["net_income"].iloc[0] if len(inc) > 0 else 0
            cfo = cf["cfo"].iloc[0] if len(cf) > 0 else 0

            if net_income != 0:
                accrual_ratio = cfo / net_income
                if accrual_ratio < 0.5:
                    red_flags.append(
                        f"Low cash conversion: CFO/Net Income = {accrual_ratio:.2f}"
                    )
                    accrual_quality -= 30
                elif accrual_ratio < 0.8:
                    notes.append(
                        f"Moderate cash conversion: CFO/Net Income = {accrual_ratio:.2f}"
                    )
                    accrual_quality -= 10

                cash_conversion = min(100, max(0, accrual_ratio * 100))

        # 2. Revenue Quality - Check for unusual revenue patterns
        if "revenue" in inc.columns and len(inc) > 1:
            revenue = inc["revenue"]
            revenue_growth = revenue.pct_change(periods=-1).iloc[0]

            if revenue_growth > 0.5:
                notes.append(f"High revenue growth: {revenue_growth:.1%}")
            elif revenue_growth < -0.2:
                red_flags.append(f"Significant revenue decline: {revenue_growth:.1%}")
                revenue_quality -= 20

        # 3. Earnings Persistence - Check earnings volatility
        if "net_income" in inc.columns and len(inc) > 2:
            earnings = inc["net_income"]
            earnings_std = earnings.std()
            earnings_mean = earnings.mean()

            if earnings_mean != 0:
                cv = earnings_std / abs(earnings_mean)
                if cv > 1:
                    red_flags.append(f"High earnings volatility: CV = {cv:.2f}")
                    earnings_persistence -= 30
                elif cv > 0.5:
                    notes.append(f"Moderate earnings volatility: CV = {cv:.2f}")
                    earnings_persistence -= 10

        # 4. Check for debt concerns
        if "total_liabilities" in bs.columns and "shareholders_equity" in bs.columns:
            liabilities = bs["total_liabilities"].iloc[0] if len(bs) > 0 else 0
            equity = bs["shareholders_equity"].iloc[0] if len(bs) > 0 else 1

            if equity > 0:
                debt_equity = liabilities / equity
                if debt_equity > 3:
                    red_flags.append(f"High leverage: D/E = {debt_equity:.2f}")
                elif debt_equity > 2:
                    notes.append(f"Elevated leverage: D/E = {debt_equity:.2f}")

        # 5. Check for negative equity
        if "shareholders_equity" in bs.columns:
            equity = bs["shareholders_equity"].iloc[0] if len(bs) > 0 else 0
            if equity < 0:
                red_flags.append("Negative shareholders' equity")
                accrual_quality -= 20

        # 6. Check days sales outstanding trend
        if "accounts_receivable" in bs.columns and "revenue" in inc.columns:
            ar = bs["accounts_receivable"].iloc[0] if len(bs) > 0 else 0
            revenue = inc["revenue"].iloc[0] if len(inc) > 0 else 1

            dso = (ar / revenue) * 365 if revenue > 0 else 0
            if dso > 90:
                red_flags.append(f"High days sales outstanding: {dso:.0f} days")
                revenue_quality -= 15
            elif dso > 60:
                notes.append(f"Elevated DSO: {dso:.0f} days")

        # 7. Check inventory turnover
        if "inventory" in bs.columns and "cost_of_revenue" in inc.columns:
            inventory = bs["inventory"].iloc[0] if len(bs) > 0 else 0
            cogs = inc["cost_of_revenue"].iloc[0] if len(inc) > 0 else 1

            if cogs > 0 and inventory > 0:
                dio = (inventory / cogs) * 365
                if dio > 180:
                    red_flags.append(f"Slow inventory turnover: {dio:.0f} days")
                elif dio > 120:
                    notes.append(f"Elevated inventory days: {dio:.0f} days")

        # Calculate overall score
        overall_score = (
            accrual_quality * 0.3
            + revenue_quality * 0.25
            + earnings_persistence * 0.25
            + cash_conversion * 0.2
        )

        return AccountingQuality(
            overall_score=max(0, min(100, overall_score)),
            accrual_quality=max(0, min(100, accrual_quality)),
            revenue_quality=max(0, min(100, revenue_quality)),
            earnings_persistence=max(0, min(100, earnings_persistence)),
            cash_conversion=max(0, min(100, cash_conversion)),
            red_flags=red_flags,
            notes=notes,
        )

    def compare_peers(
        self,
        tickers: List[str],
        metrics: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Compare accounting metrics across peer companies.

        Args:
            tickers: List of stock ticker symbols
            metrics: Specific metrics to compare

        Returns:
            DataFrame with peer comparison
        """
        if metrics is None:
            metrics = [
                "revenue",
                "net_income",
                "gross_margin",
                "operating_margin",
                "net_margin",
                "roe",
                "roa",
                "current_ratio",
                "debt_to_equity",
            ]

        comparison = self.statements.compare_companies(tickers, metrics)

        # Add accounting quality scores
        quality_scores = {}
        for ticker in tickers:
            try:
                quality = self.assess_accounting_quality(ticker)
                quality_scores[ticker] = quality.overall_score
            except Exception:
                quality_scores[ticker] = None

        comparison["accounting_quality_score"] = pd.Series(quality_scores)

        return comparison

    def get_disclosure_summary(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> Dict[str, Any]:
        """
        Get a summary of key disclosures from footnotes.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type

        Returns:
            Dictionary with disclosure summaries
        """
        summary = {
            "ticker": ticker,
            "filing_type": filing_type,
        }

        # Lease summary
        leases = self.footnotes.get_lease_disclosures(ticker, filing_type)
        if leases.operating_lease_liability or leases.finance_lease_liability:
            summary["lease_obligations"] = {
                "operating": leases.operating_lease_liability,
                "finance": leases.finance_lease_liability,
                "total": (leases.operating_lease_liability or 0)
                + (leases.finance_lease_liability or 0),
            }

        # Debt summary
        debt = self.footnotes.get_debt_disclosures(ticker, filing_type)
        if debt.total_debt:
            summary["debt"] = {
                "total": debt.total_debt,
                "short_term": debt.short_term_debt,
                "long_term": debt.long_term_debt,
                "avg_rate": debt.weighted_avg_interest_rate,
                "has_covenants": debt.debt_covenants is not None,
            }

        # Revenue summary
        revenue = self.footnotes.get_revenue_disclosures(ticker, filing_type)
        if revenue.deferred_revenue or revenue.contract_liabilities:
            summary["revenue_deferrals"] = {
                "deferred_revenue": revenue.deferred_revenue,
                "contract_liabilities": revenue.contract_liabilities,
                "contract_assets": revenue.contract_assets,
            }

        # Contingencies
        contingencies = self.footnotes.get_contingency_disclosures(ticker, filing_type)
        if contingencies.litigation_matters or contingencies.accrued_contingencies:
            summary["contingencies"] = {
                "litigation_matters_count": len(contingencies.litigation_matters),
                "accrued_amount": contingencies.accrued_contingencies,
                "environmental": contingencies.environmental_liabilities,
                "warranties": contingencies.warranty_obligations,
            }

        # Accounting policies summary
        policies = self.footnotes.get_accounting_policies(ticker, filing_type)
        if policies:
            summary["key_policies"] = list(policies.keys())

        return summary

    def get_xbrl_metrics(
        self,
        ticker: str,
        concepts: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Get specific XBRL metrics from filings.

        Args:
            ticker: Stock ticker symbol
            concepts: List of XBRL concept names to retrieve

        Returns:
            DataFrame with XBRL metrics
        """
        filing = self.edgar.get_latest_10k(ticker)
        if filing is None:
            return pd.DataFrame()

        facts = self.edgar.get_xbrl_facts(filing)

        if facts.empty:
            return pd.DataFrame()

        if concepts:
            # Filter to requested concepts
            if "concept" in facts.columns:
                facts = facts[facts["concept"].isin(concepts)]

        return facts

    def track_disclosure_changes(
        self,
        ticker: str,
        disclosure_type: FootnoteType,
        num_periods: int = 4,
    ) -> Dict[str, Any]:
        """
        Track changes in disclosures over time.

        Args:
            ticker: Stock ticker symbol
            disclosure_type: Type of disclosure to track
            num_periods: Number of periods to compare

        Returns:
            Dictionary with change analysis
        """
        comparison = self.footnotes.compare_disclosures(
            ticker, disclosure_type, num_periods
        )

        changes = {
            "ticker": ticker,
            "disclosure_type": disclosure_type.value,
            "periods_analyzed": len(comparison),
            "data": comparison,
            "trends": {},
        }

        # Identify trends in numeric columns
        for col in comparison.select_dtypes(include=["number"]).columns:
            values = comparison[col].dropna()
            if len(values) > 1:
                trend = (
                    "increasing" if values.iloc[0] > values.iloc[-1] else "decreasing"
                )
                pct_change = (
                    (values.iloc[0] - values.iloc[-1]) / abs(values.iloc[-1]) * 100
                )
                changes["trends"][col] = {
                    "direction": trend,
                    "pct_change": pct_change,
                }

        return changes

    def health_check(self) -> bool:
        """Check if analyzer is operational."""
        return self.edgar.health_check()
