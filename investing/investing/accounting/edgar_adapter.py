"""
Edgar Adapter Module

Provides interface to SEC EDGAR filings using edgartools library.
Handles company lookups, filing retrieval, XBRL parsing, and text extraction.
"""

import logging
from typing import Any, Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

# Lazy import to handle optional dependency
_edgar_available = None


def _check_edgar_available():
    """Check if edgartools is available."""
    global _edgar_available
    if _edgar_available is None:
        try:
            import edgar  # noqa: F401

            _edgar_available = True
        except ImportError:
            _edgar_available = False
    return _edgar_available


class EdgarAdapter:
    """
    Adapter for SEC EDGAR filings using edgartools.

    Provides access to company filings, financial statements,
    XBRL data, and text sections including footnotes.
    """

    def __init__(
        self,
        identity: Optional[str] = None,
        cache_enabled: bool = True,
    ):
        """
        Initialize the Edgar adapter.

        Args:
            identity: Email address for SEC API compliance (required by SEC)
            cache_enabled: Enable caching of fetched data
        """
        self._identity = identity
        self._cache_enabled = cache_enabled
        self._initialized = False
        self._company_cache: Dict[str, Any] = {}
        self._filing_cache: Dict[str, Any] = {}

    def initialize(self, identity: Optional[str] = None) -> None:
        """
        Initialize the adapter with SEC identity.

        Args:
            identity: Email for SEC API compliance
        """
        if self._initialized:
            return

        if not _check_edgar_available():
            raise ImportError(
                "edgartools is not installed. Install with: pip install edgartools"
            )

        from edgar import set_identity

        email = identity or self._identity
        if email:
            set_identity(email)
            logger.info(f"EdgarAdapter initialized with identity: {email}")
        else:
            logger.warning(
                "EdgarAdapter initialized without identity. "
                "SEC requires identification for API access."
            )

        self._initialized = True

    def _ensure_initialized(self) -> None:
        """Ensure adapter is initialized before operations."""
        if not self._initialized:
            self.initialize()

    def get_company(self, ticker: str):  # -> edgar.Company
        """
        Get a Company object for the given ticker.

        Args:
            ticker: Stock ticker symbol

        Returns:
            edgartools Company object
        """
        self._ensure_initialized()

        if self._cache_enabled and ticker in self._company_cache:
            return self._company_cache[ticker]

        from edgar import Company

        company = Company(ticker)
        if self._cache_enabled:
            self._company_cache[ticker] = company

        return company

    def get_filings(
        self,
        ticker: str,
        form_type: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Any]:
        """
        Get filings for a company.

        Args:
            ticker: Stock ticker symbol
            form_type: Filter by form type (e.g., '10-K', '10-Q', '8-K')
            limit: Maximum number of filings to return

        Returns:
            List of Filing objects
        """
        self._ensure_initialized()

        company = self.get_company(ticker)

        if form_type:
            filings = company.get_filings(form=form_type)
        else:
            filings = company.get_filings()

        # Convert to list first to avoid pyarrow ChunkedArray compatibility issues
        # (edgartools FilingList slicing triggers pyarrow API that changed in v20+)
        filings_list = list(filings)

        if limit:
            filings_list = filings_list[:limit]

        return filings_list

    def get_latest_10k(self, ticker: str) -> Optional[Any]:
        """
        Get the most recent 10-K filing for a company.

        Args:
            ticker: Stock ticker symbol

        Returns:
            Filing object or None
        """
        filings = self.get_filings(ticker, form_type="10-K", limit=1)
        return filings[0] if filings else None

    def get_latest_10q(self, ticker: str) -> Optional[Any]:
        """
        Get the most recent 10-Q filing for a company.

        Args:
            ticker: Stock ticker symbol

        Returns:
            Filing object or None
        """
        filings = self.get_filings(ticker, form_type="10-Q", limit=1)
        return filings[0] if filings else None

    def get_financials(self, ticker: str) -> Optional[Any]:
        """
        Get standardized financial data for a company.

        Args:
            ticker: Stock ticker symbol

        Returns:
            Financials object with balance_sheet, income_statement, cash_flow
        """
        self._ensure_initialized()

        try:
            company = self.get_company(ticker)
            return company.get_financials()
        except Exception as e:
            logger.error(f"Failed to get financials for {ticker}: {e}")
            return None

    def get_balance_sheet(
        self,
        ticker: str,
        quarterly: bool = False,
    ) -> pd.DataFrame:
        """
        Get balance sheet data.

        Args:
            ticker: Stock ticker symbol
            quarterly: If True, get quarterly data; otherwise annual

        Returns:
            DataFrame with balance sheet items
        """
        financials = self.get_financials(ticker)
        if financials is None:
            return pd.DataFrame()

        try:
            # edgartools returns methods that need to be called
            bs = financials.balance_sheet()
            if hasattr(bs, "to_dataframe"):
                return bs.to_dataframe()
            return pd.DataFrame(bs) if bs else pd.DataFrame()
        except Exception as e:
            logger.error(f"Failed to get balance sheet for {ticker}: {e}")
            return pd.DataFrame()

    def get_income_statement(
        self,
        ticker: str,
        quarterly: bool = False,
    ) -> pd.DataFrame:
        """
        Get income statement data.

        Args:
            ticker: Stock ticker symbol
            quarterly: If True, get quarterly data; otherwise annual

        Returns:
            DataFrame with income statement items
        """
        financials = self.get_financials(ticker)
        if financials is None:
            return pd.DataFrame()

        try:
            # edgartools returns methods that need to be called
            inc = financials.income_statement()
            if hasattr(inc, "to_dataframe"):
                return inc.to_dataframe()
            return pd.DataFrame(inc) if inc else pd.DataFrame()
        except Exception as e:
            logger.error(f"Failed to get income statement for {ticker}: {e}")
            return pd.DataFrame()

    def get_cash_flow_statement(
        self,
        ticker: str,
        quarterly: bool = False,
    ) -> pd.DataFrame:
        """
        Get cash flow statement data.

        Args:
            ticker: Stock ticker symbol
            quarterly: If True, get quarterly data; otherwise annual

        Returns:
            DataFrame with cash flow items
        """
        financials = self.get_financials(ticker)
        if financials is None:
            return pd.DataFrame()

        try:
            # edgartools uses 'cashflow_statement' (no underscore) as a method
            cf = financials.cashflow_statement()
            if hasattr(cf, "to_dataframe"):
                return cf.to_dataframe()
            return pd.DataFrame(cf) if cf else pd.DataFrame()
        except Exception as e:
            logger.error(f"Failed to get cash flow statement for {ticker}: {e}")
            return pd.DataFrame()

    def get_filing_document(self, filing: Any) -> Optional[Any]:
        """
        Get the parsed document from a filing.

        Args:
            filing: Filing object from get_filings()

        Returns:
            Parsed filing document
        """
        self._ensure_initialized()

        try:
            return filing.obj()
        except Exception as e:
            logger.error(f"Failed to parse filing: {e}")
            return None

    def get_xbrl_data(self, filing: Any) -> Optional[Any]:
        """
        Get XBRL data from a filing.

        Args:
            filing: Filing object

        Returns:
            XBRLData object with facts, statements, and labels
        """
        self._ensure_initialized()

        try:
            doc = self.get_filing_document(filing)
            if doc and hasattr(doc, "xbrl"):
                return doc.xbrl
            return None
        except Exception as e:
            logger.error(f"Failed to get XBRL data: {e}")
            return None

    def get_xbrl_facts(self, filing: Any) -> pd.DataFrame:
        """
        Get XBRL facts as a DataFrame.

        Args:
            filing: Filing object

        Returns:
            DataFrame with XBRL facts
        """
        xbrl = self.get_xbrl_data(filing)
        if xbrl is None:
            return pd.DataFrame()

        try:
            if hasattr(xbrl, "facts"):
                return xbrl.facts
            return pd.DataFrame()
        except Exception as e:
            logger.error(f"Failed to get XBRL facts: {e}")
            return pd.DataFrame()

    def get_filing_text(self, filing: Any, section: Optional[str] = None) -> str:
        """
        Get text content from a filing.

        Args:
            filing: Filing object
            section: Specific section to extract (e.g., 'risk_factors', 'mda')

        Returns:
            Text content
        """
        self._ensure_initialized()

        try:
            doc = self.get_filing_document(filing)
            if doc is None:
                return ""

            if section and hasattr(doc, section):
                return getattr(doc, section)

            if hasattr(doc, "text"):
                return doc.text

            return str(doc)
        except Exception as e:
            logger.error(f"Failed to get filing text: {e}")
            return ""

    def search_companies(self, query: str, limit: int = 10) -> pd.DataFrame:
        """
        Search for companies by name or ticker.

        Args:
            query: Search query
            limit: Maximum results

        Returns:
            DataFrame with matching companies
        """
        self._ensure_initialized()

        try:
            from edgar import find_company

            results = find_company(query)
            if hasattr(results, "to_dataframe"):
                df = results.to_dataframe()
            else:
                df = pd.DataFrame(results)

            return df.head(limit) if len(df) > limit else df
        except Exception as e:
            logger.error(f"Failed to search companies: {e}")
            return pd.DataFrame()

    def get_company_info(self, ticker: str) -> Dict[str, Any]:
        """
        Get company metadata.

        Args:
            ticker: Stock ticker symbol

        Returns:
            Dictionary with company information
        """
        self._ensure_initialized()

        try:
            company = self.get_company(ticker)
            return {
                "ticker": ticker,
                "name": getattr(company, "name", None),
                "cik": getattr(company, "cik", None),
                "sic": getattr(company, "sic", None),
                "sic_description": getattr(company, "sic_description", None),
                "industry": getattr(company, "industry", None),
                "state": getattr(company, "state", None),
                "exchange": getattr(company, "exchange", None),
            }
        except Exception as e:
            logger.error(f"Failed to get company info for {ticker}: {e}")
            return {"ticker": ticker, "error": str(e)}

    def clear_cache(self) -> None:
        """Clear all cached data."""
        self._company_cache.clear()
        self._filing_cache.clear()
        logger.info("EdgarAdapter cache cleared")

    def health_check(self) -> bool:
        """
        Check if the adapter is operational.

        Returns:
            True if healthy
        """
        if not _check_edgar_available():
            return False

        try:
            self._ensure_initialized()
            # Try a simple operation
            from edgar import Company

            Company("AAPL")
            return True
        except Exception as e:
            logger.error(f"EdgarAdapter health check failed: {e}")
            return False
