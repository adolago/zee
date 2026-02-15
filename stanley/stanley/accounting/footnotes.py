"""
Footnotes Module

Extract and analyze explanatory notes from SEC filings.
Handles parsing of 10-K and 10-Q footnotes for detailed
accounting policy analysis and disclosure extraction.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .edgar_adapter import EdgarAdapter

logger = logging.getLogger(__name__)


class FootnoteType(Enum):
    """Types of financial statement footnotes."""

    ACCOUNTING_POLICIES = "accounting_policies"
    REVENUE_RECOGNITION = "revenue_recognition"
    INVENTORY = "inventory"
    PROPERTY_PLANT_EQUIPMENT = "property_plant_equipment"
    INTANGIBLE_ASSETS = "intangible_assets"
    GOODWILL = "goodwill"
    DEBT = "debt"
    LEASES = "leases"
    COMMITMENTS_CONTINGENCIES = "commitments_contingencies"
    STOCKHOLDERS_EQUITY = "stockholders_equity"
    STOCK_COMPENSATION = "stock_compensation"
    INCOME_TAXES = "income_taxes"
    PENSION_BENEFITS = "pension_benefits"
    FAIR_VALUE = "fair_value"
    DERIVATIVES = "derivatives"
    SEGMENT_INFORMATION = "segment_information"
    RELATED_PARTY = "related_party"
    SUBSEQUENT_EVENTS = "subsequent_events"
    OTHER = "other"


@dataclass
class Footnote:
    """Represents a single footnote from a filing."""

    footnote_type: FootnoteType
    title: str
    content: str
    note_number: Optional[int] = None
    filing_date: Optional[datetime] = None
    tables: List[pd.DataFrame] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LeaseDisclosure:
    """Structured lease disclosure data."""

    operating_lease_liability: Optional[float] = None
    finance_lease_liability: Optional[float] = None
    operating_lease_rou_asset: Optional[float] = None
    finance_lease_rou_asset: Optional[float] = None
    weighted_avg_lease_term_operating: Optional[float] = None
    weighted_avg_lease_term_finance: Optional[float] = None
    weighted_avg_discount_rate_operating: Optional[float] = None
    weighted_avg_discount_rate_finance: Optional[float] = None
    future_minimum_payments: Optional[pd.DataFrame] = None


@dataclass
class DebtDisclosure:
    """Structured debt disclosure data."""

    total_debt: Optional[float] = None
    short_term_debt: Optional[float] = None
    long_term_debt: Optional[float] = None
    current_portion_long_term: Optional[float] = None
    weighted_avg_interest_rate: Optional[float] = None
    maturity_schedule: Optional[pd.DataFrame] = None
    debt_covenants: Optional[str] = None


@dataclass
class RevenueDisclosure:
    """Structured revenue recognition disclosure data."""

    revenue_by_segment: Optional[pd.DataFrame] = None
    revenue_by_geography: Optional[pd.DataFrame] = None
    revenue_by_product: Optional[pd.DataFrame] = None
    deferred_revenue: Optional[float] = None
    contract_assets: Optional[float] = None
    contract_liabilities: Optional[float] = None
    performance_obligations: Optional[str] = None


@dataclass
class ContingencyDisclosure:
    """Structured contingency disclosure data."""

    litigation_matters: List[str] = field(default_factory=list)
    environmental_liabilities: Optional[float] = None
    warranty_obligations: Optional[float] = None
    guarantees: Optional[float] = None
    other_contingencies: List[str] = field(default_factory=list)
    accrued_contingencies: Optional[float] = None


class FootnoteAnalyzer:
    """
    Extract and analyze explanatory notes from SEC filings.

    Parses 10-K and 10-Q footnotes to extract:
    - Accounting policy summaries
    - Structured disclosure data (leases, debt, revenue, etc.)
    - Risk factors and contingencies
    - Key metrics embedded in footnotes
    """

    # Patterns to identify footnote sections
    FOOTNOTE_PATTERNS = {
        FootnoteType.ACCOUNTING_POLICIES: [
            r"summary\s+of\s+significant\s+accounting\s+policies",
            r"significant\s+accounting\s+policies",
            r"basis\s+of\s+presentation",
        ],
        FootnoteType.REVENUE_RECOGNITION: [
            r"revenue\s+recognition",
            r"revenue\s+from\s+contracts",
            r"disaggregation\s+of\s+revenue",
        ],
        FootnoteType.INVENTORY: [
            r"inventor(?:y|ies)",
        ],
        FootnoteType.PROPERTY_PLANT_EQUIPMENT: [
            r"property[\s,]+plant[\s,]+and\s+equipment",
            r"property\s+and\s+equipment",
        ],
        FootnoteType.INTANGIBLE_ASSETS: [
            r"intangible\s+assets",
            r"other\s+intangible\s+assets",
        ],
        FootnoteType.GOODWILL: [
            r"goodwill",
        ],
        FootnoteType.DEBT: [
            r"debt\s+and\s+credit\s+facilit",
            r"long[\s-]term\s+debt",
            r"short[\s-]term\s+borrowings",
            r"notes\s+payable",
        ],
        FootnoteType.LEASES: [
            r"leases",
            r"lease\s+obligations",
        ],
        FootnoteType.COMMITMENTS_CONTINGENCIES: [
            r"commitments\s+and\s+contingencies",
            r"contingencies",
            r"legal\s+proceedings",
        ],
        FootnoteType.STOCKHOLDERS_EQUITY: [
            r"stockholders['']?\s+equity",
            r"shareholders['']?\s+equity",
            r"capital\s+stock",
        ],
        FootnoteType.STOCK_COMPENSATION: [
            r"stock[\s-]based\s+compensation",
            r"share[\s-]based\s+compensation",
            r"equity\s+compensation",
        ],
        FootnoteType.INCOME_TAXES: [
            r"income\s+taxes",
            r"provision\s+for\s+income\s+taxes",
        ],
        FootnoteType.PENSION_BENEFITS: [
            r"pension",
            r"retirement\s+benefits",
            r"post[\s-]?retirement\s+benefits",
        ],
        FootnoteType.FAIR_VALUE: [
            r"fair\s+value",
            r"fair\s+value\s+measurements",
        ],
        FootnoteType.DERIVATIVES: [
            r"derivatives",
            r"hedging\s+activities",
        ],
        FootnoteType.SEGMENT_INFORMATION: [
            r"segment\s+information",
            r"operating\s+segments",
            r"reportable\s+segments",
        ],
        FootnoteType.RELATED_PARTY: [
            r"related\s+party",
            r"transactions\s+with\s+related\s+parties",
        ],
        FootnoteType.SUBSEQUENT_EVENTS: [
            r"subsequent\s+events",
        ],
    }

    def __init__(self, edgar_adapter: Optional[EdgarAdapter] = None):
        """
        Initialize FootnoteAnalyzer.

        Args:
            edgar_adapter: EdgarAdapter instance for SEC data access
        """
        self.edgar = edgar_adapter or EdgarAdapter()

    def get_all_footnotes(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> List[Footnote]:
        """
        Extract all footnotes from a filing.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type ('10-K' or '10-Q')

        Returns:
            List of Footnote objects
        """
        if filing_type == "10-K":
            filing = self.edgar.get_latest_10k(ticker)
        else:
            filing = self.edgar.get_latest_10q(ticker)

        if filing is None:
            logger.warning(f"No {filing_type} filing found for {ticker}")
            return []

        # Get the full text of the filing
        text = self.edgar.get_filing_text(filing)
        if not text:
            return []

        footnotes = []

        # Extract footnote sections
        sections = self._extract_footnote_sections(text)

        for title, content, note_num in sections:
            footnote_type = self._classify_footnote(title)
            footnotes.append(
                Footnote(
                    footnote_type=footnote_type,
                    title=title,
                    content=content,
                    note_number=note_num,
                    tables=self._extract_tables(content),
                    metrics=self._extract_metrics(content),
                )
            )

        return footnotes

    def get_footnote(
        self,
        ticker: str,
        footnote_type: FootnoteType,
        filing_type: str = "10-K",
    ) -> Optional[Footnote]:
        """
        Get a specific footnote by type.

        Args:
            ticker: Stock ticker symbol
            footnote_type: Type of footnote to retrieve
            filing_type: Filing type ('10-K' or '10-Q')

        Returns:
            Footnote object or None
        """
        footnotes = self.get_all_footnotes(ticker, filing_type)

        for fn in footnotes:
            if fn.footnote_type == footnote_type:
                return fn

        return None

    def get_lease_disclosures(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> LeaseDisclosure:
        """
        Extract structured lease disclosure data.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type

        Returns:
            LeaseDisclosure with extracted data
        """
        footnote = self.get_footnote(ticker, FootnoteType.LEASES, filing_type)

        if footnote is None:
            return LeaseDisclosure()

        disclosure = LeaseDisclosure()

        # Extract metrics from footnote
        metrics = footnote.metrics

        # Map common metric patterns
        metric_mappings = {
            r"operating\s+lease\s+liabilit": "operating_lease_liability",
            r"finance\s+lease\s+liabilit": "finance_lease_liability",
            r"operating\s+lease\s+right[\s-]of[\s-]use": "operating_lease_rou_asset",
            r"finance\s+lease\s+right[\s-]of[\s-]use": "finance_lease_rou_asset",
        }

        for pattern, attr in metric_mappings.items():
            for key, value in metrics.items():
                if re.search(pattern, key, re.IGNORECASE):
                    setattr(disclosure, attr, value)
                    break

        # Extract future minimum payments table
        if footnote.tables:
            for table in footnote.tables:
                if self._is_maturity_table(table):
                    disclosure.future_minimum_payments = table
                    break

        return disclosure

    def get_debt_disclosures(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> DebtDisclosure:
        """
        Extract structured debt disclosure data.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type

        Returns:
            DebtDisclosure with extracted data
        """
        footnote = self.get_footnote(ticker, FootnoteType.DEBT, filing_type)

        if footnote is None:
            return DebtDisclosure()

        disclosure = DebtDisclosure()
        metrics = footnote.metrics

        # Extract debt amounts
        for key, value in metrics.items():
            key_lower = key.lower()
            if "total" in key_lower and "debt" in key_lower:
                disclosure.total_debt = value
            elif "short" in key_lower and "term" in key_lower:
                disclosure.short_term_debt = value
            elif "long" in key_lower and "term" in key_lower:
                disclosure.long_term_debt = value
            elif "current portion" in key_lower:
                disclosure.current_portion_long_term = value
            elif "interest rate" in key_lower or "weighted" in key_lower:
                disclosure.weighted_avg_interest_rate = value

        # Extract maturity schedule
        if footnote.tables:
            for table in footnote.tables:
                if self._is_maturity_table(table):
                    disclosure.maturity_schedule = table
                    break

        # Extract covenant information
        disclosure.debt_covenants = self._extract_covenant_text(footnote.content)

        return disclosure

    def get_revenue_disclosures(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> RevenueDisclosure:
        """
        Extract structured revenue recognition disclosure data.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type

        Returns:
            RevenueDisclosure with extracted data
        """
        footnote = self.get_footnote(
            ticker, FootnoteType.REVENUE_RECOGNITION, filing_type
        )

        if footnote is None:
            return RevenueDisclosure()

        disclosure = RevenueDisclosure()
        metrics = footnote.metrics

        # Extract key metrics
        for key, value in metrics.items():
            key_lower = key.lower()
            if "deferred revenue" in key_lower:
                disclosure.deferred_revenue = value
            elif "contract asset" in key_lower:
                disclosure.contract_assets = value
            elif "contract liabilit" in key_lower:
                disclosure.contract_liabilities = value

        # Extract revenue breakdown tables
        if footnote.tables:
            for table in footnote.tables:
                table_str = table.to_string().lower()
                if "segment" in table_str:
                    disclosure.revenue_by_segment = table
                elif "geograph" in table_str or "region" in table_str:
                    disclosure.revenue_by_geography = table
                elif "product" in table_str:
                    disclosure.revenue_by_product = table

        return disclosure

    def get_contingency_disclosures(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> ContingencyDisclosure:
        """
        Extract structured contingency disclosure data.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type

        Returns:
            ContingencyDisclosure with extracted data
        """
        footnote = self.get_footnote(
            ticker, FootnoteType.COMMITMENTS_CONTINGENCIES, filing_type
        )

        if footnote is None:
            return ContingencyDisclosure()

        disclosure = ContingencyDisclosure()
        metrics = footnote.metrics

        # Extract quantified contingencies
        for key, value in metrics.items():
            key_lower = key.lower()
            if "environmental" in key_lower:
                disclosure.environmental_liabilities = value
            elif "warranty" in key_lower:
                disclosure.warranty_obligations = value
            elif "guarantee" in key_lower:
                disclosure.guarantees = value
            elif "accrued" in key_lower or "reserve" in key_lower:
                disclosure.accrued_contingencies = value

        # Extract litigation matters
        disclosure.litigation_matters = self._extract_litigation_matters(
            footnote.content
        )

        return disclosure

    def get_accounting_policies(
        self,
        ticker: str,
        filing_type: str = "10-K",
    ) -> Dict[str, str]:
        """
        Extract summary of significant accounting policies.

        Args:
            ticker: Stock ticker symbol
            filing_type: Filing type

        Returns:
            Dictionary mapping policy name to description
        """
        footnote = self.get_footnote(
            ticker, FootnoteType.ACCOUNTING_POLICIES, filing_type
        )

        if footnote is None:
            return {}

        policies = {}
        content = footnote.content

        # Common policy topics to look for
        policy_topics = [
            "revenue recognition",
            "inventory",
            "property, plant and equipment",
            "depreciation",
            "intangible assets",
            "goodwill",
            "impairment",
            "leases",
            "stock-based compensation",
            "income taxes",
            "foreign currency",
            "cash and cash equivalents",
            "fair value",
            "derivatives",
            "consolidation",
        ]

        for topic in policy_topics:
            # Try to find the section for this topic
            pattern = rf"({topic})[:\s]*(.{{100,500}}?)(?=\n\n|\n[A-Z])"
            match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
            if match:
                policies[topic] = match.group(2).strip()

        return policies

    def compare_disclosures(
        self,
        ticker: str,
        disclosure_type: FootnoteType,
        num_periods: int = 2,
    ) -> pd.DataFrame:
        """
        Compare disclosures across multiple periods.

        Args:
            ticker: Stock ticker symbol
            disclosure_type: Type of disclosure to compare
            num_periods: Number of periods to compare

        Returns:
            DataFrame with comparison
        """
        filings = self.edgar.get_filings(ticker, form_type="10-K", limit=num_periods)

        comparisons = []

        for filing in filings:
            text = self.edgar.get_filing_text(filing)
            sections = self._extract_footnote_sections(text)

            for title, content, note_num in sections:
                if self._classify_footnote(title) == disclosure_type:
                    metrics = self._extract_metrics(content)
                    metrics["filing_date"] = getattr(filing, "filing_date", None)
                    comparisons.append(metrics)
                    break

        return pd.DataFrame(comparisons)

    def _extract_footnote_sections(
        self,
        text: str,
    ) -> List[Tuple[str, str, Optional[int]]]:
        """Extract individual footnote sections from filing text."""
        sections = []

        # Pattern to match footnote headers (e.g., "Note 1 - Summary of...")
        note_pattern = r"(?:note|item)\s*(\d+)[.\s:-]+([^\n]+)"

        matches = list(re.finditer(note_pattern, text, re.IGNORECASE))

        for i, match in enumerate(matches):
            note_num = int(match.group(1))
            title = match.group(2).strip()

            # Content is from this match to the next match (or end)
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            content = text[start:end].strip()

            # Limit content length to avoid memory issues
            if len(content) > 50000:
                content = content[:50000] + "..."

            sections.append((title, content, note_num))

        return sections

    def _classify_footnote(self, title: str) -> FootnoteType:
        """Classify a footnote based on its title."""
        title_lower = title.lower()

        for footnote_type, patterns in self.FOOTNOTE_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, title_lower):
                    return footnote_type

        return FootnoteType.OTHER

    def _extract_tables(self, content: str) -> List[pd.DataFrame]:
        """Extract tables from footnote content."""
        tables = []

        # Simple table detection - look for structured numeric data
        # This is a placeholder - real implementation would use HTML/XBRL parsing
        # edgartools handles this internally

        return tables

    def _extract_metrics(self, content: str) -> Dict[str, float]:
        """Extract quantified metrics from footnote text."""
        metrics = {}

        # Pattern to match dollar amounts with context
        # e.g., "total debt of $1.5 billion" or "$500 million in lease obligations"
        amount_pattern = r"(\$[\d,.]+\s*(?:million|billion|thousand)?|\d+\.?\d*\s*(?:million|billion|thousand))"
        context_pattern = rf"([^.]*?{amount_pattern}[^.]*)"

        for match in re.finditer(context_pattern, content, re.IGNORECASE):
            context = match.group(1).strip()
            amount_str = match.group(2)

            # Parse the amount
            amount = self._parse_amount(amount_str)
            if amount is not None:
                # Use the context as the key (truncated)
                key = context[:100].strip()
                metrics[key] = amount

        return metrics

    def _parse_amount(self, amount_str: str) -> Optional[float]:
        """Parse a dollar amount string to float."""
        try:
            # Remove $ and commas
            clean = amount_str.replace("$", "").replace(",", "").strip()

            # Extract numeric part
            num_match = re.search(r"[\d.]+", clean)
            if not num_match:
                return None

            value = float(num_match.group())

            # Apply multiplier
            if "billion" in amount_str.lower():
                value *= 1e9
            elif "million" in amount_str.lower():
                value *= 1e6
            elif "thousand" in amount_str.lower():
                value *= 1e3

            return value
        except (ValueError, AttributeError):
            return None

    def _is_maturity_table(self, table: pd.DataFrame) -> bool:
        """Check if a table is a maturity/payment schedule."""
        columns_lower = [str(c).lower() for c in table.columns]
        index_str = table.index.astype(str).str.lower().tolist()

        maturity_keywords = ["year", "2024", "2025", "2026", "2027", "thereafter"]

        for keyword in maturity_keywords:
            if any(keyword in col for col in columns_lower):
                return True
            if any(keyword in idx for idx in index_str):
                return True

        return False

    def _extract_covenant_text(self, content: str) -> Optional[str]:
        """Extract debt covenant descriptions."""
        covenant_patterns = [
            r"covenant[s]?\s*[:.]?\s*(.{100,500})",
            r"financial\s+covenant[s]?\s*[:.]?\s*(.{100,500})",
            r"maintain[s]?\s+(?:a\s+)?(?:minimum|maximum)\s+(.{50,200})",
        ]

        for pattern in covenant_patterns:
            match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
            if match:
                return match.group(1).strip()

        return None

    def _extract_litigation_matters(self, content: str) -> List[str]:
        """Extract descriptions of litigation matters."""
        matters = []

        # Pattern to find litigation descriptions
        litigation_pattern = r"(?:lawsuit|litigation|legal\s+action|claim|proceeding)[^.]*\.(?:[^.]*\.){0,2}"

        for match in re.finditer(litigation_pattern, content, re.IGNORECASE):
            matter = match.group().strip()
            if len(matter) > 50:  # Skip very short matches
                matters.append(matter)

        return matters[:10]  # Limit to top 10 matters
