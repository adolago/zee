"""
SEC EDGAR filings access.
"""

from typing import Any


SEC_FORM_TYPES = {
    "10-K": "Annual Report",
    "10-Q": "Quarterly Report",
    "8-K": "Current Report",
    "13F": "Institutional Holdings",
    "DEF14A": "Proxy Statement",
    "S-1": "IPO Registration",
    "4": "Insider Trading",
    "SC 13D": "Beneficial Ownership",
    "SC 13G": "Passive Investor",
}


def get_sec_filing(ticker: str, form_type: str = "10-K", year: int | None = None) -> dict[str, Any]:
    """
    Get a specific SEC filing.

    Args:
        ticker: Company ticker symbol
        form_type: SEC form type (10-K, 10-Q, 8-K, etc.)
        year: Filing year (defaults to most recent)

    Returns:
        Dictionary containing filing data
    """
    try:
        from sec_edgar_downloader import Downloader  # type: ignore
        import tempfile
        import os
        from pathlib import Path

        # Validate form type
        if form_type.upper() not in SEC_FORM_TYPES and form_type.lower() != "all":
            return {
                "ok": False,
                "error": f"Invalid form type: {form_type}. Valid types: {', '.join(SEC_FORM_TYPES.keys())}",
            }

        # Download to temp directory
        with tempfile.TemporaryDirectory() as tmpdir:
            dl = Downloader("stanley", "stanley@zee.local", tmpdir)

            # Download the filing
            dl.get(form_type.upper(), ticker.upper(), limit=1)

            # Find the downloaded file
            ticker_dir = Path(tmpdir) / "sec-edgar-filings" / ticker.upper() / form_type.upper()
            if not ticker_dir.exists():
                return {"ok": False, "error": f"No {form_type} filing found for {ticker}"}

            # Get the most recent filing
            filing_dirs = sorted(ticker_dir.iterdir(), reverse=True)
            if not filing_dirs:
                return {"ok": False, "error": f"No {form_type} filing found for {ticker}"}

            filing_dir = filing_dirs[0]

            # Read the filing content
            content = ""
            for file in filing_dir.iterdir():
                if file.suffix in [".txt", ".html", ".htm"]:
                    content = file.read_text(errors="ignore")[:50000]  # Limit content size
                    break

            return {
                "ok": True,
                "data": {
                    "ticker": ticker.upper(),
                    "form_type": form_type.upper(),
                    "form_description": SEC_FORM_TYPES.get(form_type.upper(), "Unknown"),
                    "filing_date": filing_dir.name,
                    "content_preview": content[:5000] if content else None,
                    "content_length": len(content),
                },
            }

    except ImportError:
        return {"ok": False, "error": "sec-edgar-downloader not installed. Run: pip install sec-edgar-downloader"}
    except Exception as e:
        return {"ok": False, "error": f"Failed to get SEC filing: {str(e)}"}


def list_sec_filings(ticker: str, form_type: str = "all", limit: int = 10) -> dict[str, Any]:
    """
    List available SEC filings for a company.

    Args:
        ticker: Company ticker symbol
        form_type: Filter by form type (or "all")
        limit: Maximum number of filings to return

    Returns:
        Dictionary containing list of filings
    """
    try:
        from openbb import obb

        # Get SEC filings via OpenBB
        result = obb.equity.fundamental.filings(symbol=ticker.upper(), limit=limit)

        if result and hasattr(result, "results") and result.results:
            filings = []
            for filing in result.results:
                filing_type = getattr(filing, "type", "")
                if form_type.lower() != "all" and filing_type.upper() != form_type.upper():
                    continue

                filings.append(
                    {
                        "type": filing_type,
                        "type_description": SEC_FORM_TYPES.get(filing_type.upper(), "Unknown"),
                        "date": str(getattr(filing, "date", "")),
                        "url": getattr(filing, "url", None),
                    }
                )

            return {
                "ok": True,
                "data": {
                    "ticker": ticker.upper(),
                    "filter": form_type,
                    "count": len(filings),
                    "filings": filings[:limit],
                },
            }

        return {"ok": False, "error": f"No filings found for {ticker}"}

    except ImportError:
        return {"ok": False, "error": "OpenBB not installed. Run: pip install openbb"}
    except Exception as e:
        return {"ok": False, "error": f"Failed to list filings: {str(e)}"}
