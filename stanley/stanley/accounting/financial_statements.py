"""
Financial Statements Module

Parse and analyze financial statements from SEC filings.
Provides standardized access to balance sheets, income statements,
and cash flow statements with computed metrics.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

import numpy as np
import pandas as pd

from .edgar_adapter import EdgarAdapter

logger = logging.getLogger(__name__)


@dataclass
class StatementPeriod:
    """Represents a financial statement period."""

    end_date: datetime
    start_date: Optional[datetime] = None
    fiscal_year: Optional[int] = None
    fiscal_quarter: Optional[int] = None
    is_annual: bool = True


@dataclass
class FinancialMetric:
    """A single financial metric with context."""

    name: str
    value: float
    period: StatementPeriod
    unit: str = "USD"
    concept: Optional[str] = None  # XBRL concept name


@dataclass
class StatementData:
    """Container for a financial statement's data."""

    statement_type: str  # 'balance_sheet', 'income_statement', 'cash_flow'
    ticker: str
    periods: List[StatementPeriod] = field(default_factory=list)
    data: pd.DataFrame = field(default_factory=pd.DataFrame)
    raw_xbrl: Optional[Dict[str, Any]] = None


class FinancialStatements:
    """
    Parse and analyze financial statements from SEC filings.

    Provides standardized access to:
    - Balance sheets
    - Income statements
    - Cash flow statements
    - Computed financial ratios and metrics
    """

    # Standard line item mappings (XBRL concept -> standardized name)
    BALANCE_SHEET_MAPPING = {
        # Assets
        "Assets": "total_assets",
        "AssetsCurrent": "current_assets",
        "CashAndCashEquivalentsAtCarryingValue": "cash_and_equivalents",
        "ShortTermInvestments": "short_term_investments",
        "AccountsReceivableNetCurrent": "accounts_receivable",
        "InventoryNet": "inventory",
        "PrepaidExpenseAndOtherAssetsCurrent": "prepaid_expenses",
        "PropertyPlantAndEquipmentNet": "ppe_net",
        "Goodwill": "goodwill",
        "IntangibleAssetsNetExcludingGoodwill": "intangibles",
        # Liabilities
        "Liabilities": "total_liabilities",
        "LiabilitiesCurrent": "current_liabilities",
        "AccountsPayableCurrent": "accounts_payable",
        "AccruedLiabilitiesCurrent": "accrued_liabilities",
        "ShortTermBorrowings": "short_term_debt",
        "LongTermDebtNoncurrent": "long_term_debt",
        "DeferredRevenueCurrent": "deferred_revenue",
        # Equity
        "StockholdersEquity": "shareholders_equity",
        "RetainedEarningsAccumulatedDeficit": "retained_earnings",
        "CommonStockValue": "common_stock",
        "AdditionalPaidInCapital": "additional_paid_in_capital",
        "TreasuryStockValue": "treasury_stock",
    }

    INCOME_STATEMENT_MAPPING = {
        "Revenues": "revenue",
        "RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
        "SalesRevenueNet": "revenue",
        "CostOfGoodsAndServicesSold": "cost_of_revenue",
        "CostOfRevenue": "cost_of_revenue",
        "GrossProfit": "gross_profit",
        "OperatingExpenses": "operating_expenses",
        "ResearchAndDevelopmentExpense": "rd_expense",
        "SellingGeneralAndAdministrativeExpense": "sga_expense",
        "OperatingIncomeLoss": "operating_income",
        "InterestExpense": "interest_expense",
        "InterestIncome": "interest_income",
        "IncomeTaxExpenseBenefit": "income_tax",
        "NetIncomeLoss": "net_income",
        "EarningsPerShareBasic": "eps_basic",
        "EarningsPerShareDiluted": "eps_diluted",
        "WeightedAverageNumberOfSharesOutstandingBasic": "shares_basic",
        "WeightedAverageNumberOfDilutedSharesOutstanding": "shares_diluted",
    }

    CASH_FLOW_MAPPING = {
        "NetCashProvidedByUsedInOperatingActivities": "cfo",
        "NetCashProvidedByUsedInInvestingActivities": "cfi",
        "NetCashProvidedByUsedInFinancingActivities": "cff",
        "DepreciationDepletionAndAmortization": "depreciation",
        "PaymentsToAcquirePropertyPlantAndEquipment": "capex",
        "PaymentsForRepurchaseOfCommonStock": "stock_repurchases",
        "PaymentsOfDividendsCommonStock": "dividends_paid",
        "ProceedsFromIssuanceOfLongTermDebt": "debt_issued",
        "RepaymentsOfLongTermDebt": "debt_repaid",
    }

    def __init__(self, edgar_adapter: Optional[EdgarAdapter] = None):
        """
        Initialize FinancialStatements.

        Args:
            edgar_adapter: EdgarAdapter instance for SEC data access
        """
        self.edgar = edgar_adapter or EdgarAdapter()

    def get_balance_sheet(
        self,
        ticker: str,
        periods: int = 4,
        quarterly: bool = False,
    ) -> StatementData:
        """
        Get balance sheet data for a company.

        Args:
            ticker: Stock ticker symbol
            periods: Number of periods to retrieve
            quarterly: If True, get quarterly data

        Returns:
            StatementData with balance sheet
        """
        df = self.edgar.get_balance_sheet(ticker, quarterly=quarterly)

        # Standardize column names
        df = self._standardize_columns(df, self.BALANCE_SHEET_MAPPING)

        return StatementData(
            statement_type="balance_sheet",
            ticker=ticker,
            data=df,
        )

    def get_income_statement(
        self,
        ticker: str,
        periods: int = 4,
        quarterly: bool = False,
    ) -> StatementData:
        """
        Get income statement data for a company.

        Args:
            ticker: Stock ticker symbol
            periods: Number of periods to retrieve
            quarterly: If True, get quarterly data

        Returns:
            StatementData with income statement
        """
        df = self.edgar.get_income_statement(ticker, quarterly=quarterly)

        # Standardize column names
        df = self._standardize_columns(df, self.INCOME_STATEMENT_MAPPING)

        return StatementData(
            statement_type="income_statement",
            ticker=ticker,
            data=df,
        )

    def get_cash_flow_statement(
        self,
        ticker: str,
        periods: int = 4,
        quarterly: bool = False,
    ) -> StatementData:
        """
        Get cash flow statement data for a company.

        Args:
            ticker: Stock ticker symbol
            periods: Number of periods to retrieve
            quarterly: If True, get quarterly data

        Returns:
            StatementData with cash flow statement
        """
        df = self.edgar.get_cash_flow_statement(ticker, quarterly=quarterly)

        # Standardize column names
        df = self._standardize_columns(df, self.CASH_FLOW_MAPPING)

        return StatementData(
            statement_type="cash_flow",
            ticker=ticker,
            data=df,
        )

    def get_all_statements(
        self,
        ticker: str,
        periods: int = 4,
        quarterly: bool = False,
    ) -> Dict[str, StatementData]:
        """
        Get all three financial statements.

        Args:
            ticker: Stock ticker symbol
            periods: Number of periods to retrieve
            quarterly: If True, get quarterly data

        Returns:
            Dictionary with balance_sheet, income_statement, cash_flow
        """
        return {
            "balance_sheet": self.get_balance_sheet(ticker, periods, quarterly),
            "income_statement": self.get_income_statement(ticker, periods, quarterly),
            "cash_flow": self.get_cash_flow_statement(ticker, periods, quarterly),
        }

    def compute_ratios(self, ticker: str) -> pd.DataFrame:
        """
        Compute common financial ratios.

        Args:
            ticker: Stock ticker symbol

        Returns:
            DataFrame with computed ratios
        """
        statements = self.get_all_statements(ticker)
        bs = statements["balance_sheet"].data
        inc = statements["income_statement"].data
        cf = statements["cash_flow"].data

        ratios = {}

        # Liquidity Ratios
        if "current_assets" in bs.columns and "current_liabilities" in bs.columns:
            ratios["current_ratio"] = self._safe_divide(
                bs["current_assets"], bs["current_liabilities"]
            )

        if "cash_and_equivalents" in bs.columns and "current_liabilities" in bs.columns:
            ratios["cash_ratio"] = self._safe_divide(
                bs["cash_and_equivalents"], bs["current_liabilities"]
            )

        # Quick ratio (current assets - inventory) / current liabilities
        if all(
            c in bs.columns
            for c in ["current_assets", "inventory", "current_liabilities"]
        ):
            quick_assets = bs["current_assets"] - bs.get("inventory", 0)
            ratios["quick_ratio"] = self._safe_divide(
                quick_assets, bs["current_liabilities"]
            )

        # Profitability Ratios
        if "gross_profit" in inc.columns and "revenue" in inc.columns:
            ratios["gross_margin"] = self._safe_divide(
                inc["gross_profit"], inc["revenue"]
            )

        if "operating_income" in inc.columns and "revenue" in inc.columns:
            ratios["operating_margin"] = self._safe_divide(
                inc["operating_income"], inc["revenue"]
            )

        if "net_income" in inc.columns and "revenue" in inc.columns:
            ratios["net_margin"] = self._safe_divide(inc["net_income"], inc["revenue"])

        # Return on Assets (ROA)
        if "net_income" in inc.columns and "total_assets" in bs.columns:
            ratios["roa"] = self._safe_divide(inc["net_income"], bs["total_assets"])

        # Return on Equity (ROE)
        if "net_income" in inc.columns and "shareholders_equity" in bs.columns:
            ratios["roe"] = self._safe_divide(
                inc["net_income"], bs["shareholders_equity"]
            )

        # Leverage Ratios
        if "total_liabilities" in bs.columns and "total_assets" in bs.columns:
            ratios["debt_to_assets"] = self._safe_divide(
                bs["total_liabilities"], bs["total_assets"]
            )

        if "total_liabilities" in bs.columns and "shareholders_equity" in bs.columns:
            ratios["debt_to_equity"] = self._safe_divide(
                bs["total_liabilities"], bs["shareholders_equity"]
            )

        # Interest Coverage
        if "operating_income" in inc.columns and "interest_expense" in inc.columns:
            ratios["interest_coverage"] = self._safe_divide(
                inc["operating_income"], inc["interest_expense"]
            )

        # Cash Flow Ratios
        if "cfo" in cf.columns and "net_income" in inc.columns:
            ratios["cash_flow_to_net_income"] = self._safe_divide(
                cf["cfo"], inc["net_income"]
            )

        # Free Cash Flow
        if "cfo" in cf.columns and "capex" in cf.columns:
            ratios["free_cash_flow"] = cf["cfo"] - abs(cf.get("capex", 0))

        return pd.DataFrame(ratios)

    def compute_growth_rates(
        self,
        ticker: str,
        metrics: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Compute year-over-year growth rates.

        Args:
            ticker: Stock ticker symbol
            metrics: List of metrics to compute growth for

        Returns:
            DataFrame with growth rates
        """
        if metrics is None:
            metrics = ["revenue", "net_income", "total_assets", "shareholders_equity"]

        statements = self.get_all_statements(ticker)

        growth_rates = {}

        for statement_name, statement_data in statements.items():
            df = statement_data.data
            for metric in metrics:
                if metric in df.columns:
                    growth = df[metric].pct_change(periods=-1)  # YoY change
                    growth_rates[f"{metric}_growth"] = growth

        return pd.DataFrame(growth_rates)

    def get_metric(
        self,
        ticker: str,
        metric_name: str,
        periods: int = 4,
    ) -> pd.Series:
        """
        Get a specific metric across periods.

        Args:
            ticker: Stock ticker symbol
            metric_name: Name of the metric (e.g., 'revenue', 'net_income')
            periods: Number of periods

        Returns:
            Series with metric values
        """
        statements = self.get_all_statements(ticker, periods=periods)

        for statement in statements.values():
            if metric_name in statement.data.columns:
                return statement.data[metric_name]

        logger.warning(f"Metric '{metric_name}' not found for {ticker}")
        return pd.Series(dtype=float)

    def compare_companies(
        self,
        tickers: List[str],
        metrics: Optional[List[str]] = None,
    ) -> pd.DataFrame:
        """
        Compare financial metrics across companies.

        Args:
            tickers: List of stock ticker symbols
            metrics: List of metrics to compare

        Returns:
            DataFrame with comparison
        """
        if metrics is None:
            metrics = [
                "revenue",
                "net_income",
                "gross_margin",
                "operating_margin",
                "roe",
                "roa",
                "current_ratio",
                "debt_to_equity",
            ]

        comparison = {}

        for ticker in tickers:
            try:
                ratios = self.compute_ratios(ticker)
                statements = self.get_all_statements(ticker)

                ticker_data = {}

                # Get latest values from ratios
                for metric in metrics:
                    if metric in ratios.columns:
                        ticker_data[metric] = (
                            ratios[metric].iloc[0] if len(ratios) > 0 else None
                        )

                # Get latest values from statements
                for statement in statements.values():
                    for metric in metrics:
                        if (
                            metric in statement.data.columns
                            and metric not in ticker_data
                        ):
                            ticker_data[metric] = statement.data[metric].iloc[0]

                comparison[ticker] = ticker_data

            except Exception as e:
                logger.error(f"Failed to get data for {ticker}: {e}")
                comparison[ticker] = {}

        return pd.DataFrame(comparison).T

    def _standardize_columns(
        self,
        df: pd.DataFrame,
        mapping: Dict[str, str],
    ) -> pd.DataFrame:
        """Standardize column names using mapping."""
        rename_map = {}
        for col in df.columns:
            if col in mapping:
                rename_map[col] = mapping[col]

        return df.rename(columns=rename_map)

    def _safe_divide(
        self,
        numerator: Union[pd.Series, float],
        denominator: Union[pd.Series, float],
    ) -> Union[pd.Series, float]:
        """Safely divide, returning NaN for division by zero."""
        if isinstance(denominator, pd.Series):
            return numerator / denominator.replace(0, np.nan)
        elif denominator == 0:
            return np.nan
        return numerator / denominator
