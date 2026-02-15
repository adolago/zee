"""
Notes Module

Obsidian-style note-taking system for investment research.
Features markdown files with YAML frontmatter, wiki-style linking,
and full-text search.

Example usage:
    from stanley.notes import NoteManager

    # Initialize with vault path
    manager = NoteManager("~/Documents/StanleyVault")

    # Create an investment thesis
    thesis = manager.create_thesis(
        symbol="AAPL",
        company_name="Apple Inc.",
        sector="Technology"
    )

    # Create a trade journal entry
    trade = manager.create_trade(
        symbol="AAPL",
        direction="long",
        entry_price=175.50,
        shares=100
    )

    # Search notes
    results = manager.search("Apple valuation")

    # Get all active theses
    active = manager.get_theses(status="active")
"""

from .models import (
    # Core
    AssetClass,
    ConvictionLevel,
    Note,
    NoteFrontmatter,
    NoteType,
    # Thesis
    ThesisFrontmatter,
    ThesisStatus,
    MoatRating,
    MoatSource,
    # Trade
    TradeFrontmatter,
    TradeDirection,
    TradeStatus,
    # Event
    EventFrontmatter,
    EventType,
    # Person
    PersonFrontmatter,
    # Sector
    SectorFrontmatter,
)
from .templates import Templates
from .vault import Vault

__all__ = [
    # Main classes
    "NoteManager",
    "Vault",
    "Templates",
    # Models
    "Note",
    "NoteFrontmatter",
    "ThesisFrontmatter",
    "TradeFrontmatter",
    "EventFrontmatter",
    "PersonFrontmatter",
    "SectorFrontmatter",
    # Enums
    "NoteType",
    "AssetClass",
    "ThesisStatus",
    "TradeStatus",
    "TradeDirection",
    "ConvictionLevel",
    "MoatRating",
    "MoatSource",
    "EventType",
]


class NoteManager:
    """
    High-level interface for the Stanley notes system.

    Provides simplified methods for common operations like
    creating theses, logging trades, and searching notes.
    """

    def __init__(self, vault_path: str = None):
        """
        Initialize the note manager.

        Args:
            vault_path: Path to the vault directory.
                       Defaults to ~/.stanley/vault
        """
        from pathlib import Path

        if vault_path is None:
            vault_path = Path.home() / ".stanley" / "vault"

        self.vault = Vault(vault_path)
        self.templates = Templates()
        self.vault.load()

    def create_thesis(
        self,
        symbol: str,
        company_name: str = "",
        sector: str = "",
        conviction: str = "medium",
        content: str = None,
    ) -> Note:
        """
        Create a new investment thesis.

        Args:
            symbol: Stock symbol (e.g., "AAPL")
            company_name: Full company name
            sector: Sector/industry
            conviction: low, medium, high, or very_high
            content: Optional custom content (uses template if None)

        Returns:
            Created Note
        """
        conviction_level = ConvictionLevel(conviction)
        frontmatter, template_content = self.templates.investment_thesis(
            symbol=symbol,
            company_name=company_name,
            sector=sector,
            conviction=conviction_level,
        )

        return self.vault.create_note(
            name=f"{symbol.upper()} Investment Thesis",
            content=content or template_content,
            frontmatter=frontmatter,
        )

    def create_trade(
        self,
        symbol: str,
        direction: str = "long",
        entry_price: float = 0.0,
        shares: float = 0.0,
        entry_date: str = None,
        content: str = None,
    ) -> Note:
        """
        Create a new trade journal entry.

        Args:
            symbol: Stock symbol
            direction: "long" or "short"
            entry_price: Entry price
            shares: Number of shares
            entry_date: Entry date (ISO format, defaults to today)
            content: Optional custom content

        Returns:
            Created Note
        """
        from datetime import datetime

        trade_direction = TradeDirection(direction)
        trade_date = (
            datetime.fromisoformat(entry_date) if entry_date else datetime.now()
        )

        frontmatter, template_content = self.templates.trade_journal(
            symbol=symbol,
            direction=trade_direction,
            entry_price=entry_price,
            shares=shares,
            entry_date=trade_date,
        )

        date_str = trade_date.strftime("%Y-%m-%d")
        return self.vault.create_note(
            name=f"{symbol.upper()} {direction.title()} - {date_str}",
            content=content or template_content,
            frontmatter=frontmatter,
        )

    def close_trade(
        self,
        trade_name: str,
        exit_price: float,
        exit_date: str = None,
        exit_reason: str = "",
        lessons: str = "",
        grade: str = "",
    ) -> Note:
        """
        Close an open trade.

        Args:
            trade_name: Name of the trade note
            exit_price: Exit price
            exit_date: Exit date (ISO format, defaults to today)
            exit_reason: Reason for exit
            lessons: Lessons learned
            grade: Self-assessment grade

        Returns:
            Updated Note
        """
        from datetime import datetime

        note = self.vault.get(trade_name)
        if not note:
            raise ValueError(f"Trade not found: {trade_name}")

        if not isinstance(note.frontmatter, TradeFrontmatter):
            raise ValueError(f"Note is not a trade: {trade_name}")

        fm = note.frontmatter
        fm.exit_price = exit_price
        fm.exit_date = (
            datetime.fromisoformat(exit_date) if exit_date else datetime.now()
        )
        fm.status = TradeStatus.CLOSED
        fm.exit_reason = exit_reason
        fm.lessons_learned = lessons
        fm.grade = grade

        return self.vault.update_note(trade_name, note.content, fm)

    def create_company(
        self,
        symbol: str,
        company_name: str = "",
        sector: str = "",
        content: str = None,
    ) -> Note:
        """
        Create a company research note.

        Args:
            symbol: Stock symbol
            company_name: Full company name
            sector: Sector/industry
            content: Optional custom content

        Returns:
            Created Note
        """
        frontmatter, template_content = self.templates.company_research(
            symbol=symbol,
            company_name=company_name,
            sector=sector,
        )

        return self.vault.create_note(
            name=f"{company_name or symbol.upper()}",
            content=content or template_content,
            frontmatter=frontmatter,
            folder="companies",
        )

    def create_daily_note(self, date: str = None, content: str = None) -> Note:
        """
        Create a daily note.

        Args:
            date: Date (ISO format, defaults to today)
            content: Optional custom content

        Returns:
            Created Note
        """
        from datetime import datetime

        note_date = datetime.fromisoformat(date) if date else datetime.now()
        frontmatter, template_content = self.templates.daily_note(date=note_date)

        return self.vault.create_note(
            name=note_date.strftime("%Y-%m-%d"),
            content=content or template_content,
            frontmatter=frontmatter,
        )

    def create_event(
        self,
        symbol: str,
        company_name: str = "",
        event_type: str = "conference",
        event_date: str = None,
        host: str = "",
        participants: list = None,
        content: str = None,
    ) -> Note:
        """
        Create an event note (conference call, investor day, etc.).

        Args:
            symbol: Stock symbol
            company_name: Company name
            event_type: Type of event (earnings_call, investor_day, conference,
                       analyst_meeting, site_visit, agm, guidance_update, m_and_a, other)
            event_date: Event date (ISO format, defaults to today)
            host: Bank/broker hosting the event
            participants: List of participant names
            content: Optional custom content

        Returns:
            Created Note
        """
        from datetime import datetime

        from .models import EventType as ET

        evt_type = ET(event_type)
        evt_date = datetime.fromisoformat(event_date) if event_date else datetime.now()

        frontmatter, template_content = self.templates.event_note(
            symbol=symbol,
            company_name=company_name,
            event_type=evt_type,
            event_date=evt_date,
            host=host,
            participants=participants or [],
        )

        # Name format: YYYY-MM-DD - SYMBOL - Event Type
        event_type_names = {
            ET.EARNINGS_CALL: "Earnings Call",
            ET.INVESTOR_DAY: "Investor Day",
            ET.CONFERENCE: "Conference",
            ET.ANALYST_MEETING: "Analyst Meeting",
            ET.SITE_VISIT: "Site Visit",
            ET.AGM: "AGM",
            ET.GUIDANCE_UPDATE: "Guidance Update",
            ET.M_AND_A: "M&A",
            ET.OTHER: "Event",
        }
        event_name = event_type_names.get(evt_type, "Event")
        if host:
            note_name = f"{evt_date.strftime('%Y-%m-%d')} - {symbol.upper()} - {host} {event_name}"
        else:
            note_name = (
                f"{evt_date.strftime('%Y-%m-%d')} - {symbol.upper()} - {event_name}"
            )

        return self.vault.create_note(
            name=note_name,
            content=content or template_content,
            frontmatter=frontmatter,
        )

    def create_person(
        self,
        full_name: str,
        current_role: str = "",
        current_company: str = "",
        linkedin_url: str = "",
        content: str = None,
    ) -> Note:
        """
        Create a person/executive profile note.

        Args:
            full_name: Person's full name
            current_role: Current role (CEO, CFO, IR, etc.)
            current_company: Current company name
            linkedin_url: LinkedIn profile URL
            content: Optional custom content

        Returns:
            Created Note
        """
        frontmatter, template_content = self.templates.person_profile(
            full_name=full_name,
            current_role=current_role,
            current_company=current_company,
            linkedin_url=linkedin_url,
        )

        return self.vault.create_note(
            name=full_name,
            content=content or template_content,
            frontmatter=frontmatter,
        )

    def create_sector(
        self,
        sector_name: str,
        sub_sectors: list = None,
        companies: list = None,
        content: str = None,
    ) -> Note:
        """
        Create a sector overview note.

        Args:
            sector_name: Sector name (e.g., "Health Care", "Financials")
            sub_sectors: List of sub-sectors
            companies: List of companies covered
            content: Optional custom content

        Returns:
            Created Note
        """
        frontmatter, template_content = self.templates.sector_overview_enhanced(
            sector_name=sector_name,
            sub_sectors=sub_sectors or [],
            companies=companies or [],
        )

        return self.vault.create_note(
            name=f"{sector_name} Sector",
            content=content or template_content,
            frontmatter=frontmatter,
            folder="sectors",
        )

    def search(self, query: str, limit: int = 50) -> list:
        """
        Full-text search across notes.

        Args:
            query: Search query
            limit: Maximum results

        Returns:
            List of search results
        """
        return self.vault.search(query, limit)

    def get_theses(self, status: str = None, symbol: str = None) -> list:
        """
        Get investment theses.

        Args:
            status: Filter by status (research, watchlist, active, closed, invalidated)
            symbol: Filter by symbol

        Returns:
            List of thesis notes
        """
        thesis_status = ThesisStatus(status) if status else None
        return self.vault.get_theses(status=thesis_status, symbol=symbol)

    def get_trades(self, status: str = None, symbol: str = None) -> list:
        """
        Get trade journal entries.

        Args:
            status: Filter by status (open, closed, partial)
            symbol: Filter by symbol

        Returns:
            List of trade notes
        """
        trade_status = TradeStatus(status) if status else None
        return self.vault.get_trades(status=trade_status, symbol=symbol)

    def get_events(
        self,
        event_type: str = None,
        symbol: str = None,
        company: str = None,
    ) -> list:
        """
        Get event notes (conference calls, investor days, etc.).

        Args:
            event_type: Filter by type (earnings_call, conference, investor_day, etc.)
            symbol: Filter by stock symbol
            company: Filter by company name

        Returns:
            List of event notes sorted by date (most recent first)
        """
        from .models import EventType as ET

        evt_type = ET(event_type) if event_type else None
        return self.vault.get_events(
            event_type=evt_type, symbol=symbol, company=company
        )

    def get_people(self, company: str = None, role: str = None) -> list:
        """
        Get person/executive profile notes.

        Args:
            company: Filter by company name
            role: Filter by role (CEO, CFO, etc.)

        Returns:
            List of person notes sorted alphabetically
        """
        return self.vault.get_people(company=company, role=role)

    def get_sectors(self) -> list:
        """
        Get all sector overview notes.

        Returns:
            List of sector notes sorted alphabetically
        """
        return self.vault.get_sectors()

    def get_trade_stats(self) -> dict:
        """
        Get aggregate trade statistics.

        Returns:
            Dict with win rate, P&L, etc.
        """
        return self.vault.get_trade_stats()

    def get_backlinks(self, note_name: str) -> list:
        """
        Get all notes that link to the given note.

        Args:
            note_name: Name of the note

        Returns:
            List of notes with backlinks
        """
        return self.vault.get_backlinks(note_name)

    def get_graph(self) -> dict:
        """
        Get the note graph for visualization.

        Returns:
            Dict with nodes and edges
        """
        return self.vault.get_graph()

    def get_note(self, name: str) -> Note:
        """Get a note by name."""
        return self.vault.get(name)

    def update_note(self, name: str, content: str) -> Note:
        """Update a note's content."""
        return self.vault.update_note(name, content)

    def create_note(self, name: str, content: str = "") -> Note:
        """Create a new note."""
        return self.vault.create_note(name, content)

    def upsert_note(self, name: str, content: str) -> Note:
        """Create or update a note."""
        try:
            return self.vault.update_note(name, content)
        except ValueError:
            # Note doesn't exist, create it
            return self.vault.create_note(name, content)

    def delete_note(self, name: str) -> bool:
        """Delete a note."""
        return self.vault.delete_note(name)

    def list_notes(
        self, note_type: str = None, tags: list = None, limit: int = 100
    ) -> list:
        """List notes with optional filters."""
        ntype = NoteType(note_type) if note_type else None
        return self.vault.list_notes(note_type=ntype, tags=tags, limit=limit)

    def health_check(self) -> bool:
        """Check if notes system is operational."""
        return self.vault.health_check()
